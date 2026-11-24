# YouTube OAuth — setup guide (draft-only, manual flow)

The YouTube plugin can read the Data API with an API key, but **uploading
needs OAuth 2.0**. This guide sets up the credentials an upload flow
would use later. Nothing here uploads or publishes anything — the upload
call itself is not implemented yet, and publishing will always need
explicit human approval per video.

## What this adds

`jarvis/plugins/youtube/oauth.py` — OAuth helpers only:

| Helper | What it does |
|---|---|
| `build_auth_url` | Builds the Google consent URL (scopes `youtube.readonly` + `youtube.upload`) |
| `exchange_code` | Exchanges the authorization code for access + refresh tokens |
| `refresh_access_token` | Trades a refresh token for a fresh access token |
| `TokenStore` | Saves/loads tokens to `data/youtube_token.json` (mode `0600`) |
| `is_authorized` / `ensure_access_token` | Checks credentials / returns a valid access token, refreshing first if needed |

No client secret, access token, or refresh token is ever stored in code
or in the repository. All secrets come from environment variables.

## Step 1 — Create Google Cloud credentials

1. Open [Google Cloud Console](https://console.cloud.google.com/) and
   create (or pick) a project.
2. **APIs & Services → Library**: enable **YouTube Data API v3**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** (or Internal if you use Google Workspace).
   - Fill in app name + your email; add yourself under **Test users**
     while the app is in testing mode.
   - Scopes: add `https://www.googleapis.com/auth/youtube.readonly`
     and `https://www.googleapis.com/auth/youtube.upload`.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Desktop app** (simplest for a local Jarvis).
   - Note the **Client ID** and **Client secret**.

## Step 2 — Protect the token file (do this first)

`data/youtube_token.json` will hold a refresh token — it must **never**
be committed. It is not covered by `.gitignore` yet, so add this line
to the repo's `.gitignore` before running the flow:

```gitignore
data/youtube_token.json
```

Verify with `git status` after step 4: the token file must not appear.

## Step 3 — Set the environment variables

```powershell
# Windows PowerShell (Jarvis runs on Windows)
$env:YOUTUBE_CLIENT_ID = "YOUR_CLIENT_ID.apps.googleusercontent.com"
$env:YOUTUBE_CLIENT_SECRET = "YOUR_CLIENT_SECRET"
```

The variables are read at runtime only; they are never written to any
file in the repo.

## Step 4 — Run the manual flow once

Desktop-app clients use `http://localhost` as the redirect URI. Run
this from the project root (it only prints a URL and saves the token —
it uploads nothing):

```python
from jarvis.plugins.youtube.oauth import (
    TokenStore, build_auth_url, exchange_code, require_client_credentials,
)

client_id, client_secret = require_client_credentials()
redirect_uri = "http://localhost"
print(build_auth_url(client_id, redirect_uri))
# 1. Open the printed URL, sign in, approve.
# 2. Google redirects to http://localhost/?code=4/0XXXX... — copy the code.
# 3. Then:
# import asyncio
# token = asyncio.run(exchange_code("4/0XXXX...", client_id, client_secret, redirect_uri))
# TokenStore().save(token)
# print("authorized, token saved to data/youtube_token.json")
```

## Step 5 — Check it worked

```python
from jarvis.plugins.youtube.oauth import is_authorized
print(is_authorized())  # True when a usable token is stored
```

## How the token is used later

- `ensure_access_token(client_id, client_secret)` returns a valid access
  token, refreshing it automatically when it expires (the stored refresh
  token is kept). A future upload tool would call this — it does not
  exist yet.
- If you revoke access in your Google account, the next refresh fails
  with `YouTubeOAuthError`; delete `data/youtube_token.json` and repeat
  step 4.
- Tokens expire after ~1 hour; the refresh token is what makes Jarvis
  usable without re-approving every time. Google may stop returning a
  refresh token if the consent screen stays in testing mode for a long
  time — in that case re-run step 4.

## Limits (deliberate)

- **No upload/publish call exists.** `youtube_prepare_upload` only
  builds a draft plan; this module only prepares credentials.
- Publishing will require explicit human approval **per video** when an
  upload tool is added later.
- The OAuth client secret is only ever read from the environment.
- Tests (`tests/test_youtube_oauth.py`) use mocked HTTP only — no real
  Google account or network is touched.
