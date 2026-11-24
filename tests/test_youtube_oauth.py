"""YouTube OAuth helper tests — no network, no real credentials.

All HTTP is faked with httpx.MockTransport; token files live in a
temporary directory. Nothing here calls Google, YouTube, or any real
account, and no secret is ever written to the repository.
"""
import asyncio
import json
import os
import tempfile
import time
import unittest
import urllib.parse
from pathlib import Path

import httpx

from jarvis.plugins.youtube.oauth import (
    AUTH_URL,
    DEFAULT_SCOPES,
    TOKEN_URL,
    TokenStore,
    YouTubeOAuthError,
    YouTubeOAuthNotConfigured,
    build_auth_url,
    default_token_path,
    ensure_access_token,
    exchange_code,
    is_authorized,
    refresh_access_token,
    require_client_credentials,
    token_is_expired,
)


def _token_response(**overrides):
    payload = {
        "access_token": "ya29.access",
        "token_type": "Bearer",
        "expires_in": 3600,
        "refresh_token": "1//refresh",
        "scope": " ".join(DEFAULT_SCOPES),
    }
    payload.update(overrides)
    return payload


def _mock_transport(handler):
    return httpx.MockTransport(handler)


class BuildAuthUrlTests(unittest.TestCase):
    def test_contains_required_params_and_scopes(self):
        url = build_auth_url("cid123", "http://localhost:8080/cb", state="s1")
        self.assertTrue(url.startswith(AUTH_URL + "?"))
        params = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
        self.assertEqual(params["client_id"], ["cid123"])
        self.assertEqual(params["redirect_uri"], ["http://localhost:8080/cb"])
        self.assertEqual(params["response_type"], ["code"])
        self.assertEqual(params["access_type"], ["offline"])
        self.assertEqual(params["prompt"], ["consent"])
        self.assertEqual(params["state"], ["s1"])
        scopes = params["scope"][0].split(" ")
        self.assertIn("https://www.googleapis.com/auth/youtube.upload", scopes)
        self.assertIn("https://www.googleapis.com/auth/youtube.readonly", scopes)

    def test_state_generated_when_missing(self):
        url1 = build_auth_url("cid", "http://localhost/cb")
        url2 = build_auth_url("cid", "http://localhost/cb")
        q1 = urllib.parse.parse_qs(urllib.parse.urlparse(url1).query)
        q2 = urllib.parse.parse_qs(urllib.parse.urlparse(url2).query)
        self.assertTrue(q1["state"][0])
        self.assertNotEqual(q1["state"][0], q2["state"][0])

    def test_no_secret_in_url(self):
        url = build_auth_url("cid", "http://localhost/cb")
        self.assertNotIn("secret", url.lower())

    def test_missing_client_id_or_redirect_raises(self):
        with self.assertRaises(ValueError):
            build_auth_url("", "http://localhost/cb")
        with self.assertRaises(ValueError):
            build_auth_url("cid", "")


class ExchangeCodeTests(unittest.TestCase):
    def test_success_stamps_expiry(self):
        def handler(request):
            self.assertEqual(str(request.url), TOKEN_URL)
            body = urllib.parse.parse_qs(request.content.decode())
            self.assertEqual(body["grant_type"], ["authorization_code"])
            self.assertEqual(body["code"], ["4/0code"])
            return httpx.Response(200, json=_token_response())

        before = int(time.time())
        token = asyncio.run(exchange_code(
            "4/0code", "cid", "csecret", "http://localhost/cb",
            transport=_mock_transport(handler),
        ))
        self.assertEqual(token["access_token"], "ya29.access")
        self.assertEqual(token["refresh_token"], "1//refresh")
        self.assertGreaterEqual(token["expires_at"], before + 3500)
        self.assertLessEqual(token["expires_at"], before + 3700)

    def test_error_response_raises(self):
        def handler(request):
            return httpx.Response(400, json={
                "error": "invalid_grant",
                "error_description": "Bad Request",
            })

        with self.assertRaises(YouTubeOAuthError):
            asyncio.run(exchange_code(
                "bad", "cid", "csecret", "http://localhost/cb",
                transport=_mock_transport(handler),
            ))

    def test_missing_access_token_raises(self):
        def handler(request):
            return httpx.Response(200, json={"expires_in": 3600})

        with self.assertRaises(YouTubeOAuthError):
            asyncio.run(exchange_code(
                "code", "cid", "csecret", "http://localhost/cb",
                transport=_mock_transport(handler),
            ))

    def test_empty_code_raises(self):
        with self.assertRaises(ValueError):
            asyncio.run(exchange_code(
                "", "cid", "csecret", "http://localhost/cb",
                transport=_mock_transport(lambda r: httpx.Response(200, json={})),
            ))


class RefreshTokenTests(unittest.TestCase):
    def test_refresh_keeps_no_new_refresh_token(self):
        # Google does not return a new refresh token on refresh, so the
        # reply has no refresh_token field at all.
        def handler(request):
            body = urllib.parse.parse_qs(request.content.decode())
            self.assertEqual(body["grant_type"], ["refresh_token"])
            self.assertEqual(body["refresh_token"], ["1//refresh"])
            payload = _token_response()
            payload.pop("refresh_token")
            return httpx.Response(200, json=payload)

        token = asyncio.run(refresh_access_token(
            "1//refresh", "cid", "csecret",
            transport=_mock_transport(handler),
        ))
        self.assertEqual(token["access_token"], "ya29.access")
        self.assertNotIn("refresh_token", token)
        self.assertGreater(token["expires_at"], int(time.time()))

    def test_refresh_error_raises(self):
        def handler(request):
            return httpx.Response(400, json={
                "error": "invalid_grant",
                "error_description": "Token has been expired or revoked.",
            })

        with self.assertRaises(YouTubeOAuthError):
            asyncio.run(refresh_access_token(
                "revoked", "cid", "csecret",
                transport=_mock_transport(handler),
            ))


class TokenStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "data" / "youtube_token.json"
        self.store = TokenStore(self.path)

    def tearDown(self):
        self.tmp.cleanup()

    def test_round_trip_and_mode(self):
        token = {"access_token": "ya29.x", "refresh_token": "1//r",
                 "expires_at": int(time.time()) + 3600}
        self.store.save(token)
        self.assertEqual(self.store.load(), token)
        if os.name == "posix":
            self.assertEqual(oct(self.path.stat().st_mode & 0o777), "0o600")

    def test_load_missing_returns_none(self):
        self.assertIsNone(self.store.load())

    def test_load_corrupt_returns_none(self):
        self.path.parent.mkdir(parents=True)
        self.path.write_text("{not json", encoding="utf-8")
        self.assertIsNone(self.store.load())

    def test_load_without_access_token_returns_none(self):
        self.path.parent.mkdir(parents=True)
        self.path.write_text(json.dumps({"refresh_token": "1//r"}), encoding="utf-8")
        self.assertIsNone(self.store.load())

    def test_save_without_access_token_raises(self):
        with self.assertRaises(ValueError):
            self.store.save({"refresh_token": "1//r"})

    def test_clear_removes_file(self):
        self.store.save({"access_token": "ya29.x"})
        self.store.clear()
        self.assertFalse(self.path.exists())
        self.store.clear()  # clearing twice is fine


class ExpiryAndAuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "youtube_token.json"
        self.store = TokenStore(self.path)

    def tearDown(self):
        self.tmp.cleanup()

    def test_fresh_token_is_authorized(self):
        self.store.save({"access_token": "ya29.x",
                         "expires_at": int(time.time()) + 3600})
        self.assertTrue(is_authorized(self.path))

    def test_expired_with_refresh_is_authorized(self):
        self.store.save({"access_token": "ya29.x", "refresh_token": "1//r",
                         "expires_at": int(time.time()) - 10})
        self.assertTrue(is_authorized(self.path))

    def test_expired_without_refresh_is_not_authorized(self):
        self.store.save({"access_token": "ya29.x",
                         "expires_at": int(time.time()) - 10})
        self.assertFalse(is_authorized(self.path))

    def test_missing_file_is_not_authorized(self):
        self.assertFalse(is_authorized(self.path))

    def test_token_is_expired_unknown_expiry(self):
        self.assertTrue(token_is_expired({"access_token": "ya29.x"}))


class EnsureAccessTokenTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "youtube_token.json"
        self.store = TokenStore(self.path)

    def tearDown(self):
        self.tmp.cleanup()

    def test_returns_cached_when_fresh(self):
        self.store.save({"access_token": "ya29.cached",
                         "expires_at": int(time.time()) + 3600})
        result = asyncio.run(ensure_access_token(
            "cid", "csecret", self.path,
            transport=_mock_transport(lambda r: (_ for _ in ()).throw(
                AssertionError("no HTTP call expected"))),
        ))
        self.assertEqual(result, "ya29.cached")

    def test_refreshes_when_expired_and_saves(self):
        calls = []

        def handler(request):
            calls.append(request)
            payload = _token_response(access_token="ya29.fresh")
            payload.pop("refresh_token")
            return httpx.Response(200, json=payload)

        self.store.save({"access_token": "ya29.old", "refresh_token": "1//r",
                         "expires_at": int(time.time()) - 5})
        result = asyncio.run(ensure_access_token(
            "cid", "csecret", self.path,
            transport=_mock_transport(handler),
        ))
        self.assertEqual(result, "ya29.fresh")
        self.assertEqual(len(calls), 1)
        saved = self.store.load()
        self.assertEqual(saved["access_token"], "ya29.fresh")
        # The old refresh token is kept for the next refresh.
        self.assertEqual(saved["refresh_token"], "1//r")

    def test_returns_none_when_no_credentials(self):
        result = asyncio.run(ensure_access_token(
            "cid", "csecret", self.path,
            transport=_mock_transport(lambda r: httpx.Response(200, json={})),
        ))
        self.assertIsNone(result)


class EnvCredentialsTests(unittest.TestCase):
    def test_missing_env_raises(self):
        old = {k: os.environ.pop(k, None)
               for k in ("YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET")}
        try:
            with self.assertRaises(YouTubeOAuthNotConfigured):
                require_client_credentials()
            os.environ["YOUTUBE_CLIENT_ID"] = "cid"
            with self.assertRaises(YouTubeOAuthNotConfigured):
                require_client_credentials()
        finally:
            for key, value in old.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def test_both_set_returns_them(self):
        old = {k: os.environ.get(k)
               for k in ("YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET")}
        try:
            os.environ["YOUTUBE_CLIENT_ID"] = "cid"
            os.environ["YOUTUBE_CLIENT_SECRET"] = "csecret"
            self.assertEqual(require_client_credentials(), ("cid", "csecret"))
        finally:
            for key, value in old.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def test_default_token_path(self):
        path = default_token_path("/some/root")
        self.assertEqual(path, Path("/some/root/data/youtube_token.json"))



class _FakeCfg:
    """Minimal config stub rooted at a tmp dir (same shape as test_geo.py)."""

    def __init__(self, root: Path):
        self._root = root
        self.plugins = {}

    def abs_path(self, p):
        return self._root / p


def _make_oauth_client(root: Path, transport):
    """In-process app with the aggregate router mounted under /api.

    Importing the aggregate router also proves the youtube_oauth router
    is registered in jarvis/server/routes/__init__.py.
    """
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from jarvis.server.routes import router

    app = FastAPI()
    app.state.cfg = _FakeCfg(root)
    app.state.orchestrator = None
    app.state.registry = None
    app.state.memory = None
    app.state.agents = None
    app.state.youtube_oauth_transport = transport
    app.include_router(router, prefix="/api")
    return TestClient(app)


class YoutubeOAuthRoutesTests(unittest.TestCase):
    """Route-level tests: status/start/callback over TestClient.

    All HTTP is faked with httpx.MockTransport; the token file lives in
    a temporary directory. No network, no real Google account, no secret
    ever leaves the test process.
    """

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.token_path = self.root / "data" / "youtube_token.json"
        self._old_env = {}
        for key in ("YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET",
                    "YOUTUBE_REDIRECT_URI"):
            self._old_env[key] = os.environ.pop(key, None)
        os.environ["YOUTUBE_CLIENT_ID"] = "test-client-id"
        os.environ["YOUTUBE_CLIENT_SECRET"] = "test-client-secret"
        self.transport = _mock_transport(
            lambda request: httpx.Response(200, json=_token_response()))
        self.client = _make_oauth_client(self.root, self.transport)

    def tearDown(self):
        for key, value in self._old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.tmp.cleanup()

    def _start_state(self):
        resp = self.client.get("/api/youtube/oauth/start",
                               follow_redirects=False)
        self.assertEqual(resp.status_code, 302, resp.text)
        location = resp.headers["location"]
        self.assertTrue(location.startswith(AUTH_URL + "?"), location)
        params = urllib.parse.parse_qs(urllib.parse.urlparse(location).query)
        self.assertEqual(params["client_id"], ["test-client-id"])
        self.assertEqual(
            params["redirect_uri"],
            ["http://localhost:7341/api/youtube/oauth/callback"])
        self.assertEqual(params["response_type"], ["code"])
        self.assertTrue(params["state"][0])
        return params["state"][0]

    def test_status_unconfigured_and_unauthorized(self):
        os.environ.pop("YOUTUBE_CLIENT_ID")
        os.environ.pop("YOUTUBE_CLIENT_SECRET")
        resp = self.client.get("/api/youtube/oauth/status")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body["ok"])
        self.assertFalse(body["configured"])
        self.assertFalse(body["authorized"])
        self.assertFalse(body["has_refresh_token"])
        self.assertIsNone(body["expires_at"])

    def test_status_authorized_after_token_saved(self):
        TokenStore(self.token_path).save({
            "access_token": "ya29.route-status",
            "refresh_token": "1//route-refresh",
            "expires_at": int(time.time()) + 3600})
        resp = self.client.get("/api/youtube/oauth/status")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body["configured"])
        self.assertTrue(body["authorized"])
        self.assertTrue(body["has_refresh_token"])
        self.assertGreater(body["expires_at"], int(time.time()))
        # The status response must never leak token values.
        self.assertNotIn("ya29.route-status", resp.text)
        self.assertNotIn("1//route-refresh", resp.text)

    def test_start_redirects_to_google_with_state(self):
        state = self._start_state()
        self.assertTrue(state)

    def test_start_unconfigured_returns_503(self):
        os.environ.pop("YOUTUBE_CLIENT_ID")
        os.environ.pop("YOUTUBE_CLIENT_SECRET")
        resp = self.client.get("/api/youtube/oauth/start",
                               follow_redirects=False)
        self.assertEqual(resp.status_code, 503)
        self.assertFalse(resp.json()["ok"])

    def test_callback_full_flow_stores_token(self):
        state = self._start_state()
        resp = self.client.get("/api/youtube/oauth/callback",
                               params={"code": "4/0test-code", "state": state})
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertEqual(resp.json(), {"ok": True, "authorized": True})
        # No token value is ever returned in the response.
        self.assertNotIn("ya29.access", resp.text)
        self.assertNotIn("1//refresh", resp.text)
        # Token stored ONLY at data/youtube_token.json, mode 0600.
        self.assertTrue(self.token_path.exists())
        saved = TokenStore(self.token_path).load()
        self.assertEqual(saved["access_token"], "ya29.access")
        self.assertEqual(saved["refresh_token"], "1//refresh")
        self.assertGreater(saved["expires_at"], int(time.time()))
        if os.name == "posix":
            self.assertEqual(oct(self.token_path.stat().st_mode & 0o777),
                             "0o600")

    def test_callback_state_mismatch_rejected(self):
        self._start_state()
        resp = self.client.get("/api/youtube/oauth/callback",
                               params={"code": "4/0test-code",
                                       "state": "bogus-state"})
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(resp.json()["ok"])
        self.assertFalse(self.token_path.exists())

    def test_callback_missing_state_rejected(self):
        resp = self.client.get("/api/youtube/oauth/callback",
                               params={"code": "4/0test-code"})
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(self.token_path.exists())

    def test_callback_missing_code_rejected(self):
        state = self._start_state()
        resp = self.client.get("/api/youtube/oauth/callback",
                               params={"state": state})
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(self.token_path.exists())

    def test_callback_state_is_single_use(self):
        state = self._start_state()
        first = self.client.get("/api/youtube/oauth/callback",
                                params={"code": "4/0test-code", "state": state})
        self.assertEqual(first.status_code, 200)
        second = self.client.get("/api/youtube/oauth/callback",
                                 params={"code": "4/0test-code", "state": state})
        self.assertEqual(second.status_code, 400)

    def test_callback_exchange_failure_returns_502(self):
        failing = _mock_transport(lambda request: httpx.Response(
            400, json={"error": "invalid_grant",
                       "error_description": "Bad Request"}))
        client = _make_oauth_client(self.root, failing)
        resp = client.get("/api/youtube/oauth/start", follow_redirects=False)
        state = urllib.parse.parse_qs(
            urllib.parse.urlparse(resp.headers["location"]).query)["state"][0]
        resp = client.get("/api/youtube/oauth/callback",
                          params={"code": "bad-code", "state": state})
        self.assertEqual(resp.status_code, 502)
        self.assertFalse(self.token_path.exists())

    def test_callback_google_error_rejected(self):
        resp = self.client.get("/api/youtube/oauth/callback",
                               params={"error": "access_denied"})
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(self.token_path.exists())


if __name__ == "__main__":
    unittest.main()
