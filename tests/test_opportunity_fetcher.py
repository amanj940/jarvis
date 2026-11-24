"""Opportunity fetcher tests — no network, no real API keys.

The production fetcher runs over the existing ``web_search`` tool, so
here that tool is a fake on a fake registry: it returns canned
``__JARVIS_MEDIA__`` payloads (or plain text, or failures) and the
tests assert parsing, per-source queries, dedup, and the end-to-end
scan into the SQLite leads store. Nothing here touches the network.
"""
import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path

from jarvis.config import Config
from jarvis.core.tasks import TaskScheduler, TaskStore
from jarvis.plugins.opportunity.jobs import (
    DAILY_SCHEDULE,
    MEDIA_PREFIX,
    build_web_search_fetcher,
    parse_web_search_result,
    register_opportunity_daily_job,
    run_opportunity_scan,
    source_queries,
)
from jarvis.plugins.opportunity.leads import LeadsStore


def _cfg(tmp: str) -> Config:
    cfg = Config()
    cfg.project_root = Path(tmp)
    cfg.memory.db_path = os.path.join(tmp, "memory.db")
    cfg.logging.action_log = os.path.join(tmp, "actions.jsonl")
    return cfg


def _media_payload(items: list[dict]) -> str:
    return MEDIA_PREFIX + json.dumps(
        {"kind": "search", "items": items, "summary": "test"}, ensure_ascii=False)


class _FakeTool:
    """Stands in for the web_search Tool: async invoke, canned results."""

    def __init__(self, results: dict, fail_queries: set | None = None):
        self.results = results
        self.fail_queries = set(fail_queries or [])
        self.calls: list[dict] = []

    async def invoke(self, args: dict):
        self.calls.append(dict(args))
        if args["query"] in self.fail_queries:
            raise RuntimeError("search provider down")
        return self.results.get(
            args["query"], "web search (duckduckgo): no results")


class _FakeRegistry:
    def __init__(self, tool=None):
        self._tool = tool

    def get(self, name: str):
        return self._tool if name == "web_search" else None


def _hackerone_items():
    return [
        {"url": "https://hackerone.com/opportunities/program-a",
         "title": "Bug bounty program A — security research",
         "snippet": "New program, urgent", "source": "hackerone.com"},
        {"url": "https://hackerone.com/opportunities/program-b",
         "title": "Bug bounty program B", "snippet": "", "source": "hackerone.com"},
    ]


# ----------------------------------------------------------------------
# Parsing
# ----------------------------------------------------------------------
class ParseWebSearchResultTests(unittest.TestCase):
    def test_media_payload_parses_items(self):
        cands = parse_web_search_result(_media_payload(_hackerone_items()))
        self.assertEqual(len(cands), 2)
        self.assertEqual(cands[0]["url"],
                         "https://hackerone.com/opportunities/program-a")
        self.assertEqual(cands[0]["description"], "New program, urgent")
        self.assertEqual(cands[0]["source"], "hackerone.com")

    def test_media_payload_skips_items_without_url_or_title(self):
        cands = parse_web_search_result(_media_payload([
            {"url": "", "title": "No URL"},
            {"url": "https://example.com/x", "title": ""},
            {"url": "https://example.com/y", "title": "Good lead"},
        ]))
        self.assertEqual([c["url"] for c in cands], ["https://example.com/y"])

    def test_malformed_media_json_is_empty(self):
        self.assertEqual(parse_web_search_result(MEDIA_PREFIX + "{not json"), [])
        self.assertEqual(parse_web_search_result(MEDIA_PREFIX + "[]"), [])

    def test_failure_and_no_results_are_empty(self):
        self.assertEqual(
            parse_web_search_result("web search failed (duckduckgo): boom"), [])
        self.assertEqual(
            parse_web_search_result("web search (duckduckgo): no results for 'x'"), [])
        self.assertEqual(parse_web_search_result(""), [])
        self.assertEqual(parse_web_search_result(None), [])

    def test_plain_text_fallback(self):
        text = (
            "Found 2 results for 'site:hackerone.com bug bounty programs':\n"
            "1. Bug bounty program A — https://hackerone.com/opportunities/a\n"
            "   New program, urgent\n"
            "2. Program B — https://hackerone.com/opportunities/b\n"
        )
        cands = parse_web_search_result(text)
        self.assertEqual(len(cands), 2)
        self.assertEqual(cands[0]["title"], "Bug bounty program A")
        self.assertEqual(cands[0]["description"], "New program, urgent")
        self.assertEqual(cands[1]["url"], "https://hackerone.com/opportunities/b")


# ----------------------------------------------------------------------
# Queries
# ----------------------------------------------------------------------
class SourceQueriesTests(unittest.TestCase):
    def test_one_query_per_curated_source(self):
        queries = source_queries()
        self.assertEqual(len(queries), 7)
        names = {q["name"] for q in queries}
        self.assertEqual(names, {"HackerOne", "Bugcrowd", "Intigriti", "YesWeHack",
                                 "Upwork", "Product Hunt", "Hacker News"})
        for q in queries:
            self.assertIn("site:", q["query"])
            self.assertTrue(q["kind"])
        self.assertIn("hackerone.com",
                      [q for q in queries if q["name"] == "HackerOne"][0]["query"])


# ----------------------------------------------------------------------
# Fetcher over a fake web_search tool
# ----------------------------------------------------------------------
class WebSearchFetcherTests(unittest.IsolatedAsyncioTestCase):
    def _registry(self, results, fail_queries=None):
        return _FakeRegistry(_FakeTool(results, fail_queries))

    async def test_fetcher_maps_source_and_kind(self):
        queries = source_queries()
        hq = [q for q in queries if q["name"] == "HackerOne"][0]["query"]
        registry = self._registry({hq: _media_payload(_hackerone_items())})
        fetcher = build_web_search_fetcher(registry, queries=[
            {"name": "HackerOne", "kind": "bug_bounty", "query": hq}])
        cands = await fetcher()
        self.assertEqual(len(cands), 2)
        self.assertTrue(all(c["source"] == "HackerOne" for c in cands))
        self.assertTrue(all(c["kind"] == "bug_bounty" for c in cands))

    async def test_fetcher_dedups_within_a_run(self):
        queries = source_queries()
        hq = [q for q in queries if q["name"] == "HackerOne"][0]["query"]
        bq = [q for q in queries if q["name"] == "Bugcrowd"][0]["query"]
        payload = _media_payload(_hackerone_items())
        registry = self._registry({hq: payload, bq: payload})
        fetcher = build_web_search_fetcher(registry, queries=[
            {"name": "HackerOne", "kind": "bug_bounty", "query": hq},
            {"name": "Bugcrowd", "kind": "bug_bounty", "query": bq},
        ])
        cands = await fetcher()
        self.assertEqual(len(cands), 2)  # same URLs twice -> one copy

    async def test_one_failing_query_does_not_kill_the_scan(self):
        queries = source_queries()
        hq = [q for q in queries if q["name"] == "HackerOne"][0]["query"]
        bq = [q for q in queries if q["name"] == "Bugcrowd"][0]["query"]
        registry = self._registry(
            {bq: _media_payload([{"url": "https://bugcrowd.com/p/1",
                                  "title": "Bugcrowd program", "snippet": ""}])},
            fail_queries={hq})
        fetcher = build_web_search_fetcher(registry, queries=[
            {"name": "HackerOne", "kind": "bug_bounty", "query": hq},
            {"name": "Bugcrowd", "kind": "bug_bounty", "query": bq},
        ])
        cands = await fetcher()
        self.assertEqual(len(cands), 1)
        self.assertEqual(cands[0]["source"], "Bugcrowd")

    async def test_missing_web_search_tool_finds_nothing(self):
        fetcher = build_web_search_fetcher(_FakeRegistry(None))
        self.assertEqual(await fetcher(), [])
        fetcher = build_web_search_fetcher(None)
        self.assertEqual(await fetcher(), [])


# ----------------------------------------------------------------------
# End-to-end scan + daily job with the real fetcher
# ----------------------------------------------------------------------
class FetcherScanTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.store = LeadsStore(Path(self.tmp) / "opportunity.db")

    def _registry_with_hackerone(self):
        queries = source_queries()
        hq = [q for q in queries if q["name"] == "HackerOne"][0]["query"]
        tool = _FakeTool({hq: _media_payload(_hackerone_items())})
        return _FakeRegistry(tool), tool

    def test_scan_with_web_search_fetcher_stores_leads(self):
        registry, tool = self._registry_with_hackerone()
        fetcher = build_web_search_fetcher(registry)
        summary = asyncio.run(run_opportunity_scan(self.store, fetcher=fetcher))
        self.assertTrue(summary["ok"])
        self.assertEqual(summary["new"], 2)
        self.assertEqual(self.store.count(), 2)
        self.assertIn("program A", summary["alerts"])
        self.assertEqual(len(tool.calls), 7)  # one query per source
        # Second run: everything is a duplicate.
        summary2 = asyncio.run(run_opportunity_scan(self.store, fetcher=fetcher))
        self.assertEqual(summary2["new"], 0)
        self.assertEqual(summary2["duplicates"], 2)

    def test_scan_with_no_fetcher_is_still_a_noop(self):
        summary = asyncio.run(run_opportunity_scan(self.store))
        self.assertEqual(summary["scanned"], 0)
        self.assertEqual(summary["new"], 0)

    def test_daily_job_with_registry_wires_fetcher(self):
        registry, _ = self._registry_with_hackerone()
        cfg = _cfg(self.tmp)
        task_store = TaskStore(cfg)
        scheduler = TaskScheduler(task_store)
        task = register_opportunity_daily_job(
            task_store, scheduler, self.store, registry=registry)
        self.assertEqual(task["kind"], "opportunity_scan")
        self.assertEqual(task["schedule"], DAILY_SCHEDULE)
        result = asyncio.run(scheduler.run_task(task["id"]))
        self.assertEqual(self.store.count(), 2)
        self.assertIn("program A", result.get("result") or "")


if __name__ == "__main__":
    unittest.main()
