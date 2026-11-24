"""YouTube OAuth routes — makes the ``oauth.py`` helpers reachable over HTTP.

Draft-only: these endpoints only complete the OAuth authorization flow
and store the resulting tokens locally. There is NO upload or publish
endpoint anywhere in Jarvis, and none is added here.

Endpoints (the aggregate router mounts these under ``/api``)::

    GET /youtube/oauth/status   — configured? authorized? (never returns tokens)
    GET /youtube/oauth/start    — 302 redirect to the Google consent screen
    GET /youtube/oauth/callback — validates ``state``, exchanges the code,
                                  stores the token at data/youtube_token.json

The owner must register the redirect URI in Google Cloud
(``YOUTUBE_REDIRECT_URI`` env, default
``http://localhost:7341/api/youtube/oauth/callback``) — see
``docs/youtube-oauth.md``. Tokens and secrets are never logged and never
appear in any response. The token file lives only at the existing
gitignored path ``data/youtube_token.json``.
"""
from __future__ import annotations

import logging
import os
import secrets
import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, RedirectResponse

from ...plugins.youtube.oauth import (
    TokenStore,
    YouTubeOAuthError,
    YouTubeOAuthNotConfigured,
    build_auth_url,
    client_id_from_env,
    client_secret_from_env,
    default_token_path,
    exchange_code,
    is_authorized,
    require_client_credentials,
)
from .common import _services

log = logging.getLogger("jarvis.youtube.oauth.routes")

router = APIRouter()

DEFAULT_REDIRECT_URI = "http://localhost:7341/api/youtube/oauth/callback"
# Pending authorization states live only in server memory (never on disk,
# never in a response body beyond the redirect URL). One-time use, 10 min.
STATE_TTL_SECONDS = 600


def _redirect_uri() -> str:
    """Callback URL Google redirects to; override with env when needed."""
    return os.environ.get("YOUTUBE_REDIRECT_URI", "").strip() or DEFAULT_REDIRECT_URI


def _token_store(request: Request) -> TokenStore:
    """Token store rooted at the project ``data/`` dir, like the geo store."""
    try:
        cfg, *_ = _services(request)
        return TokenStore(cfg.abs_path("data/youtube_token.json"))
    except Exception:
        # No app config (e.g. a bare test app): fall back to cwd/data/.
        return TokenStore(default_token_path())


def _pending_states(request: Request) -> dict:
    """In-memory ``state -> {created_at, redirect_uri}`` for this app."""
    states = getattr(request.app.state, "youtube_oauth_states", None)
    if states is None:
        states = {}
        request.app.state.youtube_oauth_states = states
    return states


def _prune_states(states: dict) -> None:
    now = time.time()
    for state in [s for s, v in states.items()
                  if now - v.get("created_at", 0) > STATE_TTL_SECONDS]:
        del states[state]


def _transport(request: Request):
    """Optional httpx transport (tests inject a MockTransport here)."""
    return getattr(request.app.state, "youtube_oauth_transport", None)


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"ok": False, "error": message})


@router.get("/youtube/oauth/status")
async def oauth_status(request: Request):
    """Whether OAuth is configured and whether a usable token is stored.

    Never returns any token value — only booleans and the expiry stamp.
    """
    store = _token_store(request)
    token = store.load()
    return {
        "ok": True,
        "configured": bool(client_id_from_env() and client_secret_from_env()),
        "authorized": is_authorized(store.path),
        "has_refresh_token": bool(token and token.get("refresh_token")),
        "expires_at": (token or {}).get("expires_at"),
    }


@router.get("/youtube/oauth/start")
async def oauth_start(request: Request):
    """Begin the flow: 302-redirect the owner's browser to Google consent."""
    try:
        client_id, _ = require_client_credentials()
    except YouTubeOAuthNotConfigured as exc:
        return _error(503, str(exc))
    redirect_uri = _redirect_uri()
    state = secrets.token_urlsafe(32)
    states = _pending_states(request)
    _prune_states(states)
    states[state] = {"created_at": time.time(), "redirect_uri": redirect_uri}
    url = build_auth_url(client_id, redirect_uri, state=state)
    return RedirectResponse(url, status_code=302)


@router.get("/youtube/oauth/callback")
async def oauth_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    """Google redirects here after consent.

    Validates the one-time ``state`` (CSRF guard), exchanges the code via
    the oauth helpers, and stores the token ONLY at
    ``data/youtube_token.json``. The token is never logged or returned.
    """
    if error:
        # Google refused (e.g. access_denied). Only the error code is
        # echoed back — never any description that could carry a secret.
        return _error(400, f"Google returned an OAuth error: {error}")
    states = _pending_states(request)
    _prune_states(states)
    pending = states.pop(state, None) if state else None
    if pending is None:
        return _error(
            400,
            "invalid or expired OAuth state — restart the flow at "
            "/api/youtube/oauth/start",
        )
    if not code:
        return _error(400, "missing authorization code")
    try:
        client_id, client_secret = require_client_credentials()
    except YouTubeOAuthNotConfigured as exc:
        return _error(503, str(exc))
    try:
        token = await exchange_code(
            code,
            client_id,
            client_secret,
            pending["redirect_uri"],
            transport=_transport(request),
        )
    except YouTubeOAuthError as exc:
        # The message carries only Google's error code, never a token.
        log.warning("YouTube OAuth code exchange failed: %s", exc)
        return _error(502, str(exc))
    _token_store(request).save(token)
    log.info("YouTube OAuth completed; token stored at data/youtube_token.json")
    return {"ok": True, "authorized": True}
