"""YouTube + opportunity-hunting tests — no network, no real API keys.

The YouTube client is exercised through httpx.MockTransport; the
opportunity scan through an injected fake fetcher. Nothing here calls
the real YouTube API, a search provider, or any platform.
"""
import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path

import httpx
import pytest

from jarvis.config import Config
from jarvis.core.tasks import TaskScheduler, TaskStore
from jarvis.plugins.opportunity.jobs import (
    DAILY_SCHEDULE,
    format_alerts,
    register_opportunity_daily_job,
    run_opportunity_scan,
)
from jarvis.plugins.opportunity.leads import LeadsStore, normalize_url
from jarvis.plugins.opportunity.scoring import score_lead
from jarvis.plugins.opportunity.sources import list_sources, validate_source
from jarvis.plugins.registry import PluginRegistry
from jarvis.plugins.youtube.client import (
    YouTubeClient,
    YouTubeNotConfigured,
    parse_channel_stats,
    parse_search_results,
    parse_video_stats,
)
from jarvis.plugins.youtube.metrics import ChannelMetricsStore
from jarvis.plugins.youtube.seo import build_video_plan, score_title, suggest_titles


def _cfg(tmp: str) -> Config:
    cfg = Config()
    cfg.project_root = Path(tmp)
    cfg.memory.db_path = os.path.join(tmp, "memory.db")
    cfg.logging.action_log = os.path.join(tmp, "actions.jsonl")
    return cfg


# ----------------------------------------------------------------------
# YouTube parsing (pure, no network)
# ----------------------------------------------------------------------
class YouTubeParsingTests(unittest.TestCase):
    def test_parse_channel_stats(self):
        stats = parse_channel_stats({
            "items": [{"id": "UC123", "snippet": {"title": "My Channel"},
                       "statistics": {"subscriberCount": "1200", "viewCount": "50000",
                                      "videoCount": "42"}}]})
        self.assertTrue(stats["ok"])
        self.assertEqual(stats["subscribers"], 1200)
        self.assertEqual(stats["views"], 50000)
        self.assertEqual(stats["videos"], 42)

    def test_parse_channel_stats_empty(self):
        self.assertFalse(parse_channel_stats({"items": []})["ok"])

    def test_parse_search_results_skips_non_videos(self):
        results = parse_search_results({"items": [
            {"id": {"kind": "youtube#channel", "channelId": "UC1"},
             "snippet": {"title": "A Channel"}},
            {"id": {"kind": "youtube#video", "videoId": "abc"},
             "snippet": {"title": "A Video", "channelTitle": "Chan",
                         "channelId": "UC1", "publishedAt": "2026-01-01T00:00:00Z",
                         "description": "d", "thumbnails": {"high": {"url": "http://t/x.jpg"}}}},
        ]})
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["video_id"], "abc")
        self.assertTrue(results[0]["url"].endswith("watch?v=abc"))

    def test_parse_video_stats(self):
        results = parse_video_stats({"items": [
            {"id": "v1", "snippet": {"title": "T", "channelTitle": "C",
                                     "publishedAt": "2026-01-01T00:00:00Z"},
             "statistics": {"viewCount": "10", "likeCount": "2", "commentCount": "1"}}]})
        self.assertEqual(results[0]["views"], 10)
        self.assertEqual(results[0]["likes"], 2)


class YouTubeClientTests(unittest.IsolatedAsyncioTestCase):
    def _transport(self, payload: dict, status: int = 200):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(status, json=payload)
        return httpx.MockTransport(handler)

    async def test_search_via_mock_transport(self):
        client = YouTubeClient(api_key="fake-key", transport=self._transport({
            "items": [{"id": {"kind": "youtube#video", "videoId": "x1"},
                       "snippet": {"title": "Hi", "channelTitle": "C",
                                   "channelId": "UC1", "publishedAt": "",
                                   "description": "", "thumbnails": {}}}]}))
        results = await client.search_videos("hi")
        self.assertEqual([r["video_id"] for r in results], ["x1"])

    async def test_missing_key_raises(self):
        client = YouTubeClient(api_key="", transport=self._transport({"items": []}))
        with self.assertRaises(YouTubeNotConfigured):
            await client.search_videos("hi")

    async def test_403_is_a_clear_error(self):
        client = YouTubeClient(api_key="bad", transport=self._transport(
            {"error": {"message": "quota"}}, status=403))
        with self.assertRaises(RuntimeError):
            await client.search_videos("hi")

    async def test_channel_stats_needs_channel_id(self):
        client = YouTubeClient(api_key="k", transport=self._transport({"items": []}))
        with self.assertRaises(ValueError):
            await client.channel_stats()


# ----------------------------------------------------------------------
# YouTube SEO + metrics store
# ----------------------------------------------------------------------
class YouTubeSeoTests(unittest.TestCase):
    def test_score_title_prefers_numbered_hook_titles(self):
        good = score_title("How to Grow on YouTube in 2026 — 5 Steps That Work")
        bad = score_title("video")
        self.assertGreater(good["score"], bad["score"])
        self.assertIn("components", good)

    def test_suggest_titles_returns_five(self):
        self.assertEqual(len(suggest_titles("grow on YouTube", ["youtube"])), 5)

    def test_video_plan_is_draft_only(self):
        plan = build_video_plan("grow on YouTube", ["youtube", "growth"])
        self.assertTrue(plan["approval_required"])
        self.assertFalse(plan["uploaded"])
        self.assertEqual(plan["best_title"], max(plan["titles"], key=lambda t: t["score"])["title"])


class YouTubeMetricsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.store = ChannelMetricsStore(Path(self.tmp) / "youtube.db")

    def test_record_latest_and_growth(self):
        self.store.record_channel({"channel_id": "UC1", "title": "C",
                                   "subscribers": 100, "views": 1000, "videos": 5},
                                  fetched_at=1000.0)
        self.store.record_channel({"channel_id": "UC1", "title": "C",
                                   "subscribers": 150, "views": 1500, "videos": 6},
                                  fetched_at=2000.0)
        self.assertEqual(self.store.latest_channel("UC1")["subscribers"], 150)
        growth = self.store.channel_growth("UC1")
        self.assertEqual(growth["subscribers_delta"], 50)
        self.assertEqual(growth["views_delta"], 500)

    def test_top_videos_ranked_by_views(self):
        self.store.record_videos([
            {"video_id": "a", "title": "A", "views": 10, "likes": 1, "comments": 0},
            {"video_id": "b", "title": "B", "views": 99, "likes": 5, "comments": 2},
        ])
        top = self.store.top_videos(limit=2)
        self.assertEqual(top[0]["video_id"], "b")


# ----------------------------------------------------------------------
# Opportunity scoring / sources / leads
# ----------------------------------------------------------------------
class OpportunityScoringTests(unittest.TestCase):
    def test_keyword_hits_raise_score(self):
        high = score_lead("Bug bounty program urgent", "security research",
                          ["bug bounty", "security"])
        low = score_lead("Random post", "nothing here", ["bug bounty"])
        self.assertGreater(high["score"], low["score"])
        self.assertTrue(high["reasons"])

    def test_stale_penalty(self):
        stale = score_lead("Program closed", "this bounty is expired", ["bug bounty"])
        fresh = score_lead("New bug bounty program", "security research", ["bug bounty"])
        self.assertLess(stale["score"], fresh["score"])

    def test_sources_are_curated_and_valid(self):
        sources = list_sources()
        self.assertTrue(any(s["name"] == "HackerOne" for s in sources))
        self.assertTrue(all(s["url"].startswith("https://") for s in sources))
        with self.assertRaises(ValueError):
            validate_source({"name": "X", "url": "not-a-url"})


class LeadsStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.store = LeadsStore(Path(self.tmp) / "opportunity.db")

    def test_add_and_dedup_by_normalized_url(self):
        lead, created = self.store.add_lead(
            "https://example.com/job?utm_source=x", "Great job", source="Upwork")
        self.assertTrue(created)
        lead2, created2 = self.store.add_lead(
            "HTTPS://EXAMPLE.COM/job/", "Great job again", source="Upwork")
        self.assertFalse(created2)
        self.assertEqual(lead2["id"], lead["id"])
        self.assertEqual(self.store.count(), 1)

    def test_normalize_url_strips_tracking(self):
        self.assertEqual(
            normalize_url("https://example.com/a/?utm_source=x&b=1"),
            "https://example.com/a?b=1")

    def test_invalid_url_and_title_rejected(self):
        with self.assertRaises(ValueError):
            self.store.add_lead("not-a-url", "Title")
        with self.assertRaises(ValueError):
            self.store.add_lead("https://example.com/x", "  ")

    def test_top_leads_ordered_by_score(self):
        self.store.add_lead("https://example.com/1", "Low", score=10)
        self.store.add_lead("https://example.com/2", "High", score=90)
        top = self.store.top_leads(limit=2)
        self.assertEqual(top[0]["title"], "High")

    def test_update_status_validates(self):
        lead, _ = self.store.add_lead("https://example.com/1", "Job")
        self.assertEqual(self.store.update_status(lead["id"], "pursuing")["status"], "pursuing")
        with self.assertRaises(ValueError):
            self.store.update_status(lead["id"], "nope")


# ----------------------------------------------------------------------
# Opportunity scan job + daily scheduler registration
# ----------------------------------------------------------------------
class OpportunityScanTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.store = LeadsStore(Path(self.tmp) / "opportunity.db")

    def test_no_fetcher_is_a_documented_noop(self):
        summary = asyncio.run(run_opportunity_scan(self.store))
        self.assertTrue(summary["ok"])
        self.assertEqual(summary["scanned"], 0)
        self.assertEqual(summary["new"], 0)

    def test_scan_with_fake_fetcher_dedups(self):
        candidates = [
            {"url": "https://example.com/a", "title": "Bug bounty urgent",
             "source": "HackerOne", "kind": "bug_bounty", "description": "security"},
            {"url": "https://example.com/a?utm_medium=x", "title": "Same bounty",
             "source": "HackerOne", "kind": "bug_bounty"},
            {"url": "https://example.com/b", "title": "Freelance AI work",
             "source": "Upwork", "kind": "freelance"},
        ]
        summary = asyncio.run(run_opportunity_scan(
            self.store, fetcher=lambda: candidates, keywords=["bug bounty", "security"]))
        self.assertEqual(summary["scanned"], 3)
        self.assertEqual(summary["new"], 2)
        self.assertEqual(summary["duplicates"], 1)
        # Second run: everything is a duplicate.
        summary2 = asyncio.run(run_opportunity_scan(
            self.store, fetcher=lambda: candidates))
        self.assertEqual(summary2["new"], 0)
        self.assertIn("Bug bounty", summary["alerts"])

    def test_format_alerts_empty(self):
        self.assertEqual(format_alerts([]), "No new opportunities.")

    def test_daily_job_registered_and_runs(self):
        cfg = _cfg(self.tmp)
        task_store = TaskStore(cfg)
        scheduler = TaskScheduler(task_store)
        task = register_opportunity_daily_job(task_store, scheduler, self.store,
                                              fetcher=lambda: [
                                                  {"url": "https://example.com/c",
                                                   "title": "New bounty", "source": "HackerOne",
                                                   "kind": "bug_bounty"}])
        self.assertEqual(task["kind"], "opportunity_scan")
        self.assertEqual(task["schedule"], DAILY_SCHEDULE)
        result = asyncio.run(scheduler.run_task(task["id"]))
        self.assertEqual(result["status"], "pending")  # cron task re-arms
        self.assertEqual(self.store.count(), 1)
        self.assertIn("New bounty", result.get("result") or "")


# ----------------------------------------------------------------------
# Plugin registration (no network)
# ----------------------------------------------------------------------
class PluginRegistrationTests(unittest.TestCase):
    def test_both_plugins_register_tools(self):
        cfg = _cfg(tempfile.mkdtemp())
        registry = PluginRegistry(cfg)
        from jarvis.plugins import opportunity as opp
        from jarvis.plugins import youtube as yt
        opp.register(registry)
        yt.register(registry)
        names = {t.name for t in registry.all_tools()}
        for expected in ("youtube_channel_stats", "youtube_search",
                         "youtube_video_plan", "youtube_prepare_upload",
                         "youtube_channel_growth", "opportunity_add_lead",
                         "opportunity_list_leads", "opportunity_top_leads",
                         "opportunity_scan", "opportunity_sources"):
            self.assertIn(expected, names)

    def test_youtube_search_without_key_returns_setup_not_scrape(self):
        cfg = _cfg(tempfile.mkdtemp())
        registry = PluginRegistry(cfg)
        from jarvis.plugins import youtube as yt
        yt.register(registry)
        tool = registry.get("youtube_search")
        out = json.loads(asyncio.run(tool.invoke({"query": "test"})))
        self.assertFalse(out["ok"])
        self.assertIn("YOUTUBE_API_KEY", out["error"])
        self.assertIn("fallback", out)

    def test_prepare_upload_is_draft_only(self):
        cfg = _cfg(tempfile.mkdtemp())
        registry = PluginRegistry(cfg)
        from jarvis.plugins import youtube as yt
        yt.register(registry)
        tool = registry.get("youtube_prepare_upload")
        out = json.loads(asyncio.run(tool.invoke({"topic": "grow on YouTube"})))
        self.assertTrue(out["draft"]["approval_required"])
        self.assertFalse(out["draft"]["uploaded"])
        missing = json.loads(asyncio.run(tool.invoke(
            {"topic": "x", "video_file": "/nonexistent/video.mp4"})))
        self.assertFalse(missing["ok"])


if __name__ == "__main__":
    unittest.main()
