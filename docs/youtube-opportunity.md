# YouTube + Opportunity Hunting

Two new plugin packages, both **read-only by default** and both storing
their own data in their own SQLite files. Neither publishes, submits,
applies, or spends anything.

## YouTube — `jarvis/plugins/youtube/`

### Setup (required for any API call)

1. Google Cloud Console → create a project → enable **YouTube Data API v3**.
2. Create an **API key** (not OAuth — the data tools below use the
   key; OAuth helpers for a future upload flow live in
   `jarvis/plugins/youtube/oauth.py`, see `docs/youtube-oauth.md`,
   and no upload call exists yet).
3. Set environment variables (never put keys in code or in `config.yaml`):

```bat
set YOUTUBE_API_KEY=AIza...
set YOUTUBE_CHANNEL_ID=UC...   :: optional, your channel
```

4. Optional config toggle (plugins load by default when absent):

```yaml
plugins:
  youtube:
    enabled: true
```

### What it does

| Tool | Permission | Behaviour |
|---|---|---|
| `youtube_channel_stats` | SAFE | Channel subscribers/views/videos via the Data API; records a snapshot in `data/youtube.db` |
| `youtube_search` | SAFE | Video search via the Data API. **No key → returns setup instructions**, not a scrape |
| `youtube_video_plan` | SAFE | Scored titles, description, tags, thumbnail checklist — draft only |
| `youtube_prepare_upload` | CAUTION | Builds an upload *draft* only. **Never uploads, schedules, or publishes** |
| `youtube_channel_growth` | SAFE | Subscriber/view delta from recorded snapshots |

### Scraping note

The old `_yt_search` in `plugins/web_tools.py` scrapes
`youtube.com/results`. It is **not** the main path here: it is fragile,
has no analytics, and breaks when YouTube changes its page. It remains
only as a read-only fallback for plain search via `web_search` when no
API key is configured — and the YouTube tools say so explicitly instead
of silently falling back to it.

### Metrics store

`data/youtube.db` — `channel_metrics` and `video_metrics`, append-only
snapshots. `ChannelMetricsStore.latest_channel()`,
`.channel_growth()`, `.top_videos()` are the read API.

### SEO workflow

`seo.build_video_plan(topic, keywords)` returns scored titles
(40–60 chars, hook words, a number, no clickbait), a description
template, tags, a thumbnail checklist, and a publishing checklist with
`approval_required: True` and `uploaded: False`.

## Opportunity hunting — `jarvis/plugins/opportunity/`

### Setup

No keys needed. Optional config toggle:

```yaml
plugins:
  opportunity:
    enabled: true
```

Data lives in `data/opportunity.db` (leads), separate from the memory DB.

### Sources

`opportunity/sources.py` — curated list (HackerOne, Bugcrowd, Intigriti,
YesWeHack, Upwork, Product Hunt, Hacker News). Edit the list there; a
source is only a *place to look*, never an account or a credential.

### Leads

`LeadsStore.add_lead(url, title, ...)` dedups by normalised URL
(lower-cased host, no fragment, no `utm_*`/`fbclid` tracking params, no
trailing slash) — the same opportunity under two tracking links is one
lead. Statuses: `new → reviewing → pursuing → won / lost / ignored`.
Scoring (`scoring.score_lead`) is explainable: keyword hits, urgency
signals, descriptive title, minus a penalty for stale/closed items.

### Daily job

The scan runs through the Phase 4 persistent task system, so it
survives restarts:

```python
from jarvis.core.tasks import build_task_system
from jarvis.plugins.opportunity.jobs import register_opportunity_daily_job
from jarvis.plugins.opportunity.leads import LeadsStore

store, scheduler = build_task_system(cfg)
leads = LeadsStore(cfg.abs_path("data/opportunity.db"))
# Wire the production fetcher: pass a registry and the daily job builds
# build_web_search_fetcher(registry) for you (or pass fetcher= explicitly).
register_opportunity_daily_job(store, scheduler, leads, registry=registry)
# task: kind "opportunity_scan", schedule "0 9 * * *" (daily 09:00 UTC)
```

The fetcher is `jobs.build_web_search_fetcher(registry)` — one
`web_search` query per curated source, built from `sources.py`
(`site:<domain>` + a phrase per kind):

| Source | Query |
|---|---|
| HackerOne | `site:hackerone.com bug bounty programs` |
| Bugcrowd | `site:bugcrowd.com bug bounty programs` |
| Intigriti | `site:intigriti.com bug bounty programs` |
| YesWeHack | `site:yeswehack.com bug bounty programs` |
| Upwork | `site:upwork.com freelance remote jobs` |
| Product Hunt | `site:producthunt.com new product launches` |
| Hacker News | `site:news.ycombinator.com startup launches` |

Limits: 5 results per query (35 candidates max per scan), one failing
source is logged and skipped instead of killing the scan, results are
deduped by normalised URL (within the run and in the store), and
`web_search` itself caches successful results for 10 minutes. The
default search provider is DuckDuckGo — no key, no paid API. Only
search-result snippets are read: no page is ever fetched, nothing
logs in anywhere. Links may still point at pages that need an account
to view or apply (Upwork, HackerOne); those are leads for a human to
review, never something Jarvis acts on.

The fetcher is injected — a callable returning candidate dicts
(`url`, `title`, `source`, `kind`, optional `description`), sync or
async — so tests (and any future source API) can still inject a fake.
The manual `opportunity_scan` tool runs with the production fetcher
wired at registration (`tools.py`: `build_web_search_fetcher(registry)`),
so it scans for real; it only returns `scanned: 0` when `web_search`
itself is unavailable. Calling `run_opportunity_scan` directly with no
fetcher is still a documented no-op (`scanned: 0`) rather than
pretending to work. The handler's result is the
morning alert text (`format_alerts`), surfaced like any other task
result.

### Tools

| Tool | Permission | Behaviour |
|---|---|---|
| `opportunity_add_lead` | CAUTION | Save one lead (deduped, scored) |
| `opportunity_list_leads` | SAFE | List leads, highest score first |
| `opportunity_top_leads` | SAFE | Top new leads as an alert summary |
| `opportunity_scan` | CAUTION | Run one scan now (production `web_search` fetcher wired at registration) |
| `opportunity_sources` | SAFE | List curated sources |

### Safety

- No tool submits a bug-bounty report, applies to a job, contacts
  anyone, or spends money. Leads are local rows a human reviews.
- Upload/publish paths do not exist in either package (OAuth
  credentials for a future upload flow are prepared in
  `docs/youtube-oauth.md`); adding one needs explicit human approval
  and a DANGEROUS permission, by design.

