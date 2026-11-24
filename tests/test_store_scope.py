"""Unit tests for store-layer scope enforcement + error normalisation.

No network, no live APIs. Covers worker F's scope:

* bounty store: out-of-scope ``add_target`` / ``add_finding`` refused with
  a structured ``OutOfScopeError``; in-scope writes still work; reads of
  legacy out-of-scope rows refused (single get) or excluded (lists);
  ``update_finding_status`` re-checks scope for advancing statuses only.
* leads store: allowlist (``allowed_hosts`` / ``allowed_sources``) refused
  writes/reads when configured; default store stays unrestricted so the
  scanner and manual add keep working; ``normalize_url`` untouched.
* ``jarvis.plugins.common.errors``: 429 / 5xx / timeouts / connection
  failures normalise to structured errors with no raw traceback or leaked
  provider detail; in-scope calls still work.
"""
from __future__ import annotations

import sqlite3
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jarvis.plugins.bounty.store import BountyStore  # noqa: E402
from jarvis.plugins.common.errors import (  # noqa: E402
    OutOfScopeError,
    ProviderError,
    RateLimitedError,
    StoreError,
    StructuredError,
    is_retryable,
    normalize_provider_error,
    to_error_dict,
)
from jarvis.plugins.opportunity.leads import (  # noqa: E402
    LeadsStore,
    normalize_url,
    url_hash,
)


# ---- helpers ----

def _bounty_program(store, scope=("example.com",)):
    return store.add_program("Acme", platform="hackerone",
                             url="https://hackerone.com/acme",
                             scope=list(scope))


def _insert_legacy_finding(db_path, program_id, target):
    """Insert a finding row directly, bypassing the store (legacy data)."""
    conn = sqlite3.connect(db_path)
    now = time.time()
    cur = conn.execute(
        "INSERT INTO bounty_findings(program_id, target, title, description,"
        " evidence, category, cwe, severity, status, created_at, updated_at)"
        " VALUES(?,?,?,?,?,?,?,?, 'draft', ?, ?)",
        (program_id, target, "Legacy", "", "", "Unclassified", "",
         "low", now, now))
    finding_id = cur.lastrowid
    conn.commit()
    conn.close()
    return finding_id


def _insert_legacy_lead(db_path, url, source=""):
    conn = sqlite3.connect(db_path)
    now = time.time()
    cur = conn.execute(
        "INSERT INTO leads(url_hash,url,title,source,kind,score,status,notes,"
        "lat,lon,location,created_at,updated_at)"
        " VALUES(?,?,?,?,?,?,?,?,NULL,NULL,'',?,?)",
        (url_hash(url), url, "Legacy", source, "", 0.0, "new", "", now, now))
    lead_id = cur.lastrowid
    conn.commit()
    conn.close()
    return lead_id


class _FakeHttpError(Exception):
    """httpx/requests-style error carrying only a status code."""

    def __init__(self, status_code, message="boom"):
        super().__init__(message)
        self.status_code = status_code
        self._message = message


class _FakeTimeoutError(Exception):
    """Provider timeout type that is not builtin TimeoutError."""


# ---- bounty: out-of-scope writes refused ----

def test_bounty_add_target_out_of_scope_refused(tmp_path):
    store = BountyStore(tmp_path / "bounty.db")
    program = _bounty_program(store)
    with pytest.raises(OutOfScopeError) as excinfo:
        store.add_target(program["id"], "evil.com")
    err = excinfo.value
    assert err.code == "out_of_scope"
    assert err.to_dict()["ok"] is False
    assert err.to_dict()["error"]["code"] == "out_of_scope"
    assert store.list_targets(program["id"]) == []


def test_bounty_add_finding_out_of_scope_refused(tmp_path):
    store = BountyStore(tmp_path / "bounty.db")
    program = _bounty_program(store)
    with pytest.raises(OutOfScopeError):
        store.add_finding(program["id"], "https://evil.com/login", "SQLi")
    assert store.list_findings(program["id"]) == []


def test_bounty_scope_bypass_attempt_via_subdomain_suffix(tmp_path):
    # "example.com.evil.com" must NOT pass an "example.com" scope entry.
    store = BountyStore(tmp_path / "bounty.db")
    program = _bounty_program(store)
    with pytest.raises(OutOfScopeError):
        store.add_finding(program["id"], "example.com.evil.com", "SQLi")


# ---- bounty: in-scope writes still work ----

def test_bounty_in_scope_writes_work(tmp_path):
    store = BountyStore(tmp_path / "bounty.db")
    program = _bounty_program(store, scope=["example.com", "*.api.example.com", "/admin/"])
    target = store.add_target(program["id"], "sub.example.com")
    assert target["target"] == "sub.example.com"
    finding = store.add_finding(program["id"], "x.api.example.com", "SQLi in login")
    assert finding["status"] == "draft"  # always draft on creation
    path_finding = store.add_finding(
        program["id"], "https://example.com/admin/users", "Broken access control")
    assert path_finding["id"] != finding["id"]
    assert len(store.list_findings(program["id"])) == 2
    assert store.is_in_scope(program["id"], "example.com") is True
    assert store.is_in_scope(program["id"], "evil.com") is False


def test_bounty_update_finding_status_signature_unchanged(tmp_path):
    store = BountyStore(tmp_path / "bounty.db")
    program = _bounty_program(store)
    finding = store.add_finding(program["id"], "example.com", "XSS")
    updated = store.update_finding_status(finding["id"], "verified")
    assert updated["status"] == "verified"


# ---- bounty: empty scope (default vs strict) ----

def test_bounty_empty_scope_allows_by_default(tmp_path):
    # A program with no scope declared yet stays usable (long-standing
    # behaviour: bare add_program("Acme") can record findings).
    store = BountyStore(tmp_path / "bounty.db")
    program = store.add_program("Acme")
    finding = store.add_finding(program["id"], "example.com", "XSS")
    assert store.get_finding(finding["id"])["id"] == finding["id"]


def test_bounty_empty_scope_refused_in_strict_mode(tmp_path):
    store = BountyStore(tmp_path / "bounty.db", strict_scope=True)
    program = store.add_program("Acme")
    with pytest.raises(OutOfScopeError):
        store.add_target(program["id"], "example.com")
    with pytest.raises(OutOfScopeError):
        store.add_finding(program["id"], "example.com", "XSS")


# ---- bounty: legacy out-of-scope rows (recorded before enforcement) ----

def test_bounty_legacy_out_of_scope_reads(tmp_path):
    db = tmp_path / "bounty.db"
    store = BountyStore(db)
    program = _bounty_program(store)
    good = store.add_finding(program["id"], "example.com", "In scope")
    legacy_id = _insert_legacy_finding(db, program["id"], "evil.com")
    with pytest.raises(OutOfScopeError):
        store.get_finding(legacy_id)
    listed = store.list_findings(program["id"])
    assert [f["id"] for f in listed] == [good["id"]]
    assert store.get_finding(good["id"])["id"] == good["id"]


def test_bounty_update_status_rechecks_scope(tmp_path):
    db = tmp_path / "bounty.db"
    store = BountyStore(db)
    program = _bounty_program(store)
    legacy_id = _insert_legacy_finding(db, program["id"], "evil.com")
    # Advancing toward reporting is refused...
    with pytest.raises(OutOfScopeError):
        store.update_finding_status(legacy_id, "verified")
    with pytest.raises(OutOfScopeError):
        store.update_finding_status(legacy_id, "reported")
    # ...but the out-of-scope verdict itself stays recordable.
    updated = store.update_finding_status(legacy_id, "out_of_scope")
    assert updated["status"] == "out_of_scope"


def test_bounty_store_db_failure_is_structured(tmp_path):
    # Pointing the store at a directory makes sqlite fail to open the DB:
    # that must surface as a structured StoreError, not a raw traceback.
    db_dir = tmp_path / "adir"
    db_dir.mkdir()
    with pytest.raises(StructuredError) as excinfo:
        BountyStore(db_dir)
    assert isinstance(excinfo.value, StoreError)
    assert "Traceback" not in str(excinfo.value)


# ---- leads: default store unrestricted (scanner / manual add) ----

def test_leads_default_store_accepts_any_url(tmp_path):
    store = LeadsStore(tmp_path / "opportunity.db")
    lead, created = store.add_lead("https://random-blog.example.org/post",
                                   "Interesting contract", source="web_search")
    assert created is True
    assert store.get(lead["id"])["id"] == lead["id"]
    assert store.count() == 1


def test_leads_dedup_and_normalize_url_unchanged(tmp_path):
    # normalize_url is owned by another worker: signature and behaviour
    # (tracking params stripped, case/host normalised) must be intact.
    assert normalize_url("https://Example.com/Path/?utm_source=x&b=1&utm_medium=y") == \
        "https://example.com/Path?b=1"
    store = LeadsStore(tmp_path / "opportunity.db")
    first, created = store.add_lead("https://example.com/job?utm_source=x", "Job")
    second, created2 = store.add_lead("https://example.com/job", "Job again")
    assert created is True and created2 is False
    assert second["id"] == first["id"]
    assert store.count() == 1


# ---- leads: allowlist enforcement ----

def test_leads_allowlist_host_refused_and_allowed(tmp_path):
    store = LeadsStore(tmp_path / "opportunity.db",
                       allowed_hosts=["upwork.com", "news.ycombinator.com"])
    lead, created = store.add_lead("https://www.upwork.com/freelance-jobs/",
                                   "Freelance gig", source="Upwork")
    assert created is True
    assert store.in_scope("https://news.ycombinator.com/item?id=1") is True
    with pytest.raises(OutOfScopeError) as excinfo:
        store.add_lead("https://evil-jobs.example.com/1", "Scam", source="web")
    assert excinfo.value.code == "out_of_scope"
    assert "upwork.com" in str(excinfo.value.to_dict())
    assert store.count() == 1


def test_leads_allowlist_source_refused_and_allowed(tmp_path):
    store = LeadsStore(tmp_path / "opportunity.db",
                       allowed_sources=["Hacker News"])
    lead, _ = store.add_lead("https://news.ycombinator.com/item?id=1",
                             "Launch", source="Hacker News")
    assert lead["source"] == "Hacker News"
    with pytest.raises(OutOfScopeError):
        store.add_lead("https://example.com/x", "Other", source="Upwork")
    with pytest.raises(OutOfScopeError):
        store.add_lead("https://example.com/y", "No source")
    assert store.count() == 1


def test_leads_legacy_out_of_scope_reads(tmp_path):
    db = tmp_path / "opportunity.db"
    store = LeadsStore(db, allowed_hosts=["upwork.com"])
    good, _ = store.add_lead("https://www.upwork.com/jobs/1", "Good gig",
                             source="Upwork")
    legacy_id = _insert_legacy_lead(db, "https://evil.example.com/1", source="web")
    with pytest.raises(OutOfScopeError):
        store.get(legacy_id)
    assert [lead["id"] for lead in store.list_leads()] == [good["id"]]
    assert store.count() == 1
    # Advancing is refused, dismissing ("ignored") stays possible.
    with pytest.raises(OutOfScopeError):
        store.update_status(legacy_id, "reviewing")
    dismissed = store.update_status(legacy_id, "ignored")
    assert dismissed["status"] == "ignored"


def test_leads_update_status_signature_unchanged(tmp_path):
    store = LeadsStore(tmp_path / "opportunity.db")
    lead, _ = store.add_lead("https://example.com/job", "Job")
    assert store.update_status(lead["id"], "reviewing")["status"] == "reviewing"
    assert store.update_status(999999, "reviewing") is None


# ---- errors: normalisation ----

def test_normalize_429_is_rate_limited_and_retryable():
    err = normalize_provider_error(_FakeHttpError(429), provider="hackerone")
    assert isinstance(err, RateLimitedError)
    assert err.code == "rate_limited"
    assert err.retryable is True
    assert err.to_dict()["error"]["details"]["status"] == 429


def test_normalize_5xx_is_provider_error_and_retryable():
    for status in (500, 502, 503, 504):
        err = normalize_provider_error(_FakeHttpError(status), provider="9router")
        assert isinstance(err, ProviderError)
        assert err.code == "provider_error"
        assert err.retryable is True


def test_normalize_4xx_is_provider_error_not_retryable():
    err = normalize_provider_error(_FakeHttpError(404), provider="x")
    assert err.code == "provider_error"
    assert err.retryable is False


def test_normalize_timeout():
    assert normalize_provider_error(TimeoutError("timed out")).code == "timeout"
    assert normalize_provider_error(_FakeTimeoutError("slow")).code == "timeout"
    assert is_retryable(TimeoutError()) is True


def test_normalize_connection_failure():
    err = normalize_provider_error(ConnectionError("refused"), provider="stripe")
    assert err.code == "provider_unavailable"
    assert err.retryable is True


def test_normalize_hides_raw_detail_and_tracebacks():
    # The raw exception text may hold secrets / URLs / internals: none of
    # it may reach the user-facing message or dict.
    nasty = _FakeHttpError(429, "rate limited; key=sk-fake-secret Traceback (most recent call)")
    err = normalize_provider_error(nasty, provider="hackerone")
    blob = err.message + str(err.to_dict())
    assert "sk-fake-secret" not in blob
    assert "Traceback" not in blob
    assert "boom" not in blob


def test_normalize_structured_error_passes_through():
    original = OutOfScopeError("nope", target="evil.com", scope=["example.com"])
    assert normalize_provider_error(original) is original
    assert to_error_dict(original)["error"]["code"] == "out_of_scope"


def test_normalize_sqlite_locked_is_retryable_store_error():
    import sqlite3 as _sqlite3
    err = normalize_provider_error(_sqlite3.OperationalError("database is locked"))
    assert isinstance(err, StoreError)
    assert err.code == "store_unavailable"
    assert err.retryable is True


def test_normalize_generic_error_is_safe():
    err = normalize_provider_error(RuntimeError("weird internal thing"))
    assert err.code == "provider_error"
    assert "weird internal thing" not in err.message
