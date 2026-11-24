"""YouTube OAuth 2.0 helpers — DRAFT-ONLY, never auto-publishing.

This module only prepares the credentials a future upload flow would
need. It contains **no upload or publish call at all** — publishing a
video still requires explicit human approval per video, and the actual
upload endpoint is not implemented anywhere in Jarvis yet.

Flow (all manual, run by the owner on their own machine):
1. Create OAuth client credentials in Google Cloud (see
   ``docs/youtube-oauth.md``) and set ``YOUTUBE_CLIENT_ID`` /
   ``YOUTUBE_CLIENT_SECRET`` in the environment.
2. ``build_auth_url`` -> open the URL in a browser, approve, copy the code.
3. ``exchange_code`` -> tokens, saved by :class:`TokenStore` to
   ``data/youtube_token.json`` — a local file **outside the repo**
   (never committed; it holds a refresh token).
4. Later, ``ensure_access_token`` refreshes the access token when it
   expires, using the stored refresh token.

No client secret, access token, or refresh token ever appears in code,
logs, or the repository. HTTP is mockable via ``transport`` so tests
never touch the network.
"""
from __future__ import annotations

import json
import logging
import os
import secrets
import time
import urllib.parse
from pathlib import Path
from typing import Any

import httpx

log = logging.getLogger("jarvis.youtube.oauth")

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"

SCOPE_READONLY = "https://www.googleapis.com/auth/youtube.readonly"
SCOPE_UPLOAD = "https://www.googleapis.com/auth/youtube.upload"
DEFAULT_SCOPES = (SCOPE_READONLY, SCOPE_UPLOAD)

TOKEN_FILENAME = "youtube_token.json"
# Small clock-skew margin so a token that is about to expire is treated
# as expired and refreshed instead of failing mid-request.
EXPIRY_SKEW_SECONDS = 60


class YouTubeOAuthError(RuntimeError):
    """Raised when an OAuth step fails (bad code, revoked token, ...)."""


class YouTubeOAuthNotConfigured(RuntimeError):
    """Raised when YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET are missing."""


def client_id_from_env() -> str:
    return os.environ.get("YOUTUBE_CLIENT_ID", "").strip()


def client_secret_from_env() -> str:
    return os.environ.get("YOUTUBE_CLIENT_SECRET", "").strip()


def require_client_credentials() -> tuple[str, str]:
    """Return (client_id, client_secret) from env or raise."""
    client_id = client_id_from_env()
    client_secret = client_secret_from_env()
    if not client_id or not client_secret:
        raise YouTubeOAuthNotConfigured(
            "YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET must both be set "
            "in the environment — see docs/youtube-oauth.md. No secret is "
            "ever stored in code or in the repository."
        )
    return client_id, client_secret


def build_auth_url(
    client_id: str,
    redirect_uri: str,
    state: str | None = None,
    scopes: tuple[str, ...] | list[str] | None = None,
) -> str:
    """Build the Google consent URL the owner opens in a browser.

    ``access_type=offline`` + ``prompt=consent`` are required so Google
    returns a refresh token (needed later to renew the access token
    without asking the owner again). The client secret is never part
    of this URL.
    """
    if not client_id or not redirect_uri:
        raise ValueError("client_id and redirect_uri are both required")
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(scopes or DEFAULT_SCOPES),
        "access_type": "offline",
        "include_granted_scopes": "true",
        "prompt": "consent",
        "state": state or secrets.token_urlsafe(16),
    }
    return f"{AUTH_URL}?{urllib.parse.urlencode(params)}"


def _parse_token_response(payload: dict) -> dict:
    """Validate a token-endpoint payload and stamp an absolute expiry."""
    if not isinstance(payload, dict):
        raise YouTubeOAuthError("Token endpoint returned an unexpected payload")
    if payload.get("error"):
        detail = payload.get("error_description") or payload.get("error")
        raise YouTubeOAuthError(f"Token endpoint error: {detail}")
    access_token = payload.get("access_token")
    if not access_token:
        raise YouTubeOAuthError("Token endpoint returned no access_token")
    token = {
        "access_token": access_token,
        "token_type": payload.get("token_type", "Bearer"),
        "scope": payload.get("scope", ""),
    }
    if payload.get("refresh_token"):
        token["refresh_token"] = payload["refresh_token"]
    expires_in = payload.get("expires_in")
    try:
        token["expires_at"] = int(time.time()) + int(expires_in)
    except (TypeError, ValueError):
        token["expires_at"] = 0  # unknown expiry: treat as already expired
    return token


async def exchange_code(
    code: str,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
    transport: httpx.BaseTransport | None = None,
) -> dict:
    """Exchange an authorization code for access + refresh tokens."""
    if not code:
        raise ValueError("authorization code is required")
    async with httpx.AsyncClient(transport=transport, timeout=30) as http:
        resp = await http.post(
            TOKEN_URL,
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    try:
        payload = resp.json()
    except ValueError:
        payload = {}
    if resp.status_code != 200:
        raise YouTubeOAuthError(
            f"Token exchange failed (HTTP {resp.status_code}): "
            f"{(payload or {}).get('error_description') or (payload or {}).get('error') or 'unknown error'}"
        )
    return _parse_token_response(payload)


async def refresh_access_token(
    refresh_token: str,
    client_id: str,
    client_secret: str,
    transport: httpx.BaseTransport | None = None,
) -> dict:
    """Trade a refresh token for a fresh access token.

    Google does not return a new refresh token here, so the caller must
    keep the old one — :func:`ensure_access_token` does that.
    """
    if not refresh_token:
        raise ValueError("refresh_token is required")
    async with httpx.AsyncClient(transport=transport, timeout=30) as http:
        resp = await http.post(
            TOKEN_URL,
            data={
                "refresh_token": refresh_token,
                "client_id": client_id,
                "client_secret": client_secret,
                "grant_type": "refresh_token",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    try:
        payload = resp.json()
    except ValueError:
        payload = {}
    if resp.status_code != 200:
        raise YouTubeOAuthError(
            f"Token refresh failed (HTTP {resp.status_code}): "
            f"{(payload or {}).get('error_description') or (payload or {}).get('error') or 'unknown error'}"
        )
    return _parse_token_response(payload)


def default_token_path(project_root: str | Path | None = None) -> Path:
    """Where the token file lives: ``<project_root>/data/youtube_token.json``.

    This is a local file outside the repository — it must never be
    committed. Defaults to the current working directory when no root
    is given.
    """
    root = Path(project_root) if project_root is not None else Path.cwd()
    return root / "data" / TOKEN_FILENAME


class TokenStore:
    """Load/save the OAuth token dict from a local JSON file.

    The file is written with mode 0600 (owner-only) and its parent
    directory is created on demand. Tokens are never logged.
    """

    def __init__(self, path: str | Path | None = None):
        self.path = Path(path) if path is not None else default_token_path()

    def load(self) -> dict | None:
        try:
            raw = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return None
        except OSError as exc:
            log.warning("Could not read YouTube token file %s: %s", self.path, exc)
            return None
        try:
            data = json.loads(raw)
        except ValueError:
            log.warning("YouTube token file %s is not valid JSON", self.path)
            return None
        if not isinstance(data, dict) or not data.get("access_token"):
            return None
        return data

    def save(self, token: dict) -> None:
        if not isinstance(token, dict) or not token.get("access_token"):
            raise ValueError("cannot save a token without an access_token")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(token, indent=2), encoding="utf-8")
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        os.replace(tmp, self.path)
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass

    def clear(self) -> None:
        try:
            self.path.unlink()
        except FileNotFoundError:
            pass


def token_is_expired(token: dict) -> bool:
    """True when the access token is expired (or its expiry is unknown)."""
    expires_at = token.get("expires_at") or 0
    try:
        return int(expires_at) <= int(time.time()) + EXPIRY_SKEW_SECONDS
    except (TypeError, ValueError):
        return True


def is_authorized(token_path: str | Path | None = None) -> bool:
    """True when usable credentials exist: a fresh access token, or an
    expired one that can be refreshed with a stored refresh token."""
    token = TokenStore(token_path).load()
    if token is None:
        return False
    if not token_is_expired(token):
        return True
    return bool(token.get("refresh_token"))


async def ensure_access_token(
    client_id: str,
    client_secret: str,
    token_path: str | Path | None = None,
    transport: httpx.BaseTransport | None = None,
) -> str | None:
    """Return a valid access token, refreshing it first if needed.

    Returns ``None`` when no credentials are stored. A refreshed token
    is saved back (keeping the existing refresh token) so the next call
    does not refresh again.
    """
    store = TokenStore(token_path)
    token = store.load()
    if token is None:
        return None
    if not token_is_expired(token):
        return str(token["access_token"])
    refresh_token = token.get("refresh_token")
    if not refresh_token:
        return None
    fresh = await refresh_access_token(
        refresh_token, client_id, client_secret, transport=transport
    )
    fresh.setdefault("refresh_token", refresh_token)
    store.save(fresh)
    return str(fresh["access_token"])
