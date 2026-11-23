"""System routes: health, stats, logs, files, processes, plugins/tools,
agents, intents, proxy/reader, cleanslate, mission, persona.

Split out of jarvis/server/routes.py (Phase 2). No model loading here —
only telemetry (NVML / nvidia-smi) and app-state reads.
"""
from __future__ import annotations

import asyncio
import base64
import collections
import json
import logging
import os
import platform
import re
import shutil
from pathlib import Path
from urllib.parse import urlparse

import httpx
import psutil
from fastapi import APIRouter, File, Query, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel

from .common import _services

router = APIRouter()

# connected clients via per-client asyncio.Queue.

_LOG_BUFFER: collections.deque = collections.deque(maxlen=300)
_LOG_QUEUES: set[asyncio.Queue] = set()
_LOG_LOOP: asyncio.AbstractEventLoop | None = None


class _SSELogHandler(logging.Handler):
    """Captures every log record, stores it, and fans out to live SSE clients."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            entry = {
                "ts":    record.created,
                "level": record.levelname,
                "name":  record.name,
                "msg":   self.format(record),
            }
            _LOG_BUFFER.append(entry)
            loop = _LOG_LOOP
            if loop and loop.is_running():
                for q in list(_LOG_QUEUES):
                    try:
                        loop.call_soon_threadsafe(q.put_nowait, entry)
                    except Exception:  # noqa: BLE001
                        pass
        except Exception:  # noqa: BLE001
            pass


def install_log_handler() -> None:
    """Wire the SSE handler so the in-app terminal sees every log record.

    The `jarvis` logger has `propagate=False` (see core/logger.py), so records
    emitted on `jarvis.*` never reach the root logger. Attach the SSE handler
    to BOTH root (uvicorn, fastapi, asyncio, third-party noise) AND the
    `jarvis` logger (every jarvis.* record). Without this fan-out the in-app
    terminal stays empty even though the console log is busy.
    """
    global _LOG_LOOP
    try:
        _LOG_LOOP = asyncio.get_event_loop()
    except RuntimeError:
        pass
    handler = _SSELogHandler()
    handler.setLevel(logging.DEBUG)
    handler.setFormatter(logging.Formatter("%(message)s"))
    # Attach to root + jarvis loggers; guard against duplicate adds.
    for logger_name in ("", "jarvis"):
        lg = logging.getLogger(logger_name)
        if not any(isinstance(h, _SSELogHandler) for h in lg.handlers):
            lg.addHandler(handler)
        if logger_name == "jarvis" and lg.level > logging.DEBUG:
            lg.setLevel(logging.DEBUG)


@router.get("/logs")
async def get_logs(n: int = 200):
    """Return the last `n` log records as JSON."""
    records = list(_LOG_BUFFER)[-n:]
    return {"logs": records, "total": len(_LOG_BUFFER)}


@router.get("/logs/stream")
async def stream_logs(request: Request):
    """Server-Sent Events stream of live log lines.

    Clients receive the last 100 buffered records on connect, then new
    records as they arrive.  A heartbeat comment is sent every 15 s so
    proxies don't kill idle connections.
    """
    async def _generate():
        q: asyncio.Queue = asyncio.Queue(maxsize=500)
        _LOG_QUEUES.add(q)
        try:
            # Replay recent history.
            for entry in list(_LOG_BUFFER)[-100:]:
                yield f"data: {json.dumps(entry)}\n\n"
            # Stream new events.
            while True:
                if await request.is_disconnected():
                    break
                try:
                    entry = await asyncio.wait_for(q.get(), timeout=15.0)
                    yield f"data: {json.dumps(entry)}\n\n"
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"   # keep-alive comment
        finally:
            _LOG_QUEUES.discard(q)

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # disable nginx buffering
        },
    )

@router.get("/health")
async def health(request: Request):
    cfg, orch, registry, memory, agents = _services(request)
    return {
        "status": "online",
        "name": cfg.A.name,
        "model": {
            "provider": cfg.model.provider,
            "model": cfg.model.model,
            "endpoint": cfg.model.endpoint,
            "configured": bool(cfg.model.api_key),
        },
        "image_model": getattr(getattr(cfg, "image_model", None), "selected", "flux2-klein"),
        "plugins": [p.name for p in registry.plugins()],
        "tools": len(registry.all_tools()),
        "agents": agents.names(),
        "permission_mode": cfg.permissions.mode,
        "voice": {"wake_word": cfg.voice.wake_word},
    }

@router.get("/stats")
async def stats(request: Request):
    cpu = psutil.cpu_percent(interval=0.1)
    mem = psutil.virtual_memory()
    root = "C:\\" if platform.system() == "Windows" else "/"
    disk = psutil.disk_usage(root)
    net = psutil.net_io_counters()
    b = psutil.sensors_battery() if hasattr(psutil, "sensors_battery") else None
    out = {
        "cpu": cpu,
        "cpu_count": psutil.cpu_count(logical=True),
        "ram": {"percent": mem.percent, "used_gb": mem.used / 1e9, "total_gb": mem.total / 1e9},
        "disk": {"percent": disk.percent, "used_gb": disk.used / 1e9, "total_gb": disk.total / 1e9},
        "net": {"sent_mb": net.bytes_sent / 1e6, "recv_mb": net.bytes_recv / 1e6},
        "os": {
            "system": platform.system(),
            "release": platform.release(),
            "node": platform.node(),
        },
        "gpu": _read_gpu(),
    }
    if b is not None:
        out["battery"] = {"percent": b.percent, "plugged": b.power_plugged}
    return out


# --- GPU telemetry ---------------------------------------------------------
_gpu_log = logging.getLogger("jarvis.gpu")
_pynvml = None
_pynvml_failed = False


def _try_pynvml():
    """Lazy-init NVML. Returns the module or None."""
    global _pynvml, _pynvml_failed
    if _pynvml is not None or _pynvml_failed:
        return _pynvml
    try:
        import pynvml  # type: ignore
        pynvml.nvmlInit()
        _pynvml = pynvml
        return _pynvml
    except Exception as e:  # noqa: BLE001
        _pynvml_failed = True
        _gpu_log.info("pynvml unavailable (%s) — falling back to nvidia-smi", e)
        return None


def _read_gpu() -> dict:
    """Read GPU utilisation via NVML (preferred) or nvidia-smi fallback.

    Returns:
      {available, name, load_percent, mem_percent, mem_used_gb, mem_total_gb, temp_c}
    """
    nv = _try_pynvml()
    if nv is not None:
        try:
            count = nv.nvmlDeviceGetCount()
            if count == 0:
                return {"available": False}
            h = nv.nvmlDeviceGetHandleByIndex(0)
            util = nv.nvmlDeviceGetUtilizationRates(h)
            meminfo = nv.nvmlDeviceGetMemoryInfo(h)
            try:
                temp = nv.nvmlDeviceGetTemperature(h, 0)  # NVML_TEMPERATURE_GPU = 0
            except Exception:
                temp = None
            name = nv.nvmlDeviceGetName(h)
            if isinstance(name, bytes):
                name = name.decode("utf-8", "replace")
            return {
                "available":   True,
                "source":      "nvml",
                "name":        name,
                "load_percent": float(util.gpu),
                "mem_percent":  float(util.memory),
                "mem_used_gb":  meminfo.used  / 1e9,
                "mem_total_gb": meminfo.total / 1e9,
                "temp_c":       temp,
            }
        except Exception as e:  # noqa: BLE001
            _gpu_log.debug("nvml query failed: %s", e)
    # nvidia-smi fallback
    smi = shutil.which("nvidia-smi")
    if not smi:
        return {"available": False}
    try:
        import subprocess
        out = subprocess.check_output(
            [smi, "--query-gpu=name,utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu",
             "--format=csv,noheader,nounits"],
            timeout=2, text=True, stderr=subprocess.DEVNULL,
        )
        line = out.strip().splitlines()[0]
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 6:
            return {"available": False}
        return {
            "available":    True,
            "source":       "nvidia-smi",
            "name":         parts[0],
            "load_percent": float(parts[1] or 0),
            "mem_percent":  float(parts[2] or 0),
            "mem_used_gb":  float(parts[3] or 0) / 1024.0,
            "mem_total_gb": float(parts[4] or 0) / 1024.0,
            "temp_c":       float(parts[5] or 0),
        }
    except Exception as e:  # noqa: BLE001
        _gpu_log.debug("nvidia-smi fallback failed: %s", e)
        return {"available": False}

@router.post("/upload")
async def upload_file(request: Request, file: UploadFile = File(...)):
    """Drag-drop upload sink. Saves under data/uploads/<uuid-name> and returns
    the public URL. Used by the drop-zone overlay for non-image files (and
    images that exceed the inline base64 cap)."""
    import uuid
    cfg = request.app.state.cfg
    up_dir = cfg.abs_path("data/uploads")
    up_dir.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", file.filename or "blob")
    uid = uuid.uuid4().hex[:8]
    out_path = up_dir / f"{uid}-{safe_name}"
    data = await file.read()
    if not data:
        return JSONResponse({"error": "empty file"}, status_code=400)
    out_path.write_bytes(data)
    # Build a data_url for images so the frontend can preview inline.
    data_url = None
    if file.content_type and file.content_type.startswith("image/"):
        b64 = base64.b64encode(data).decode("ascii")
        data_url = f"data:{file.content_type};base64,{b64}"
    return {
        "ok": True,
        "name": file.filename,
        "url": f"/api/files/uploads/{out_path.name}",
        "data_url": data_url,
        "size": len(data),
        "mime": file.content_type,
    }


_ALLOWED_FILE_ROOTS = {
    "screenshots", "voices", "backups", "sandbox", "uploads", "generated",
}


@router.get("/files/{full_path:path}")
async def serve_data_file(request: Request, full_path: str):
    """Serve files from `data/<allowlisted_root>/...`. Path-traversal safe.

    Each top-level component (the "root") must be in `_ALLOWED_FILE_ROOTS`.
    Subdirectories beneath that root are allowed so callers can use nested
    layouts like `generated/images/foo.png` or `generated/models3d/x.glb`.
    """
    from fastapi.responses import FileResponse
    cfg = request.app.state.cfg
    if not full_path:
        return JSONResponse({"error": "empty path"}, status_code=400)
    # Normalise + traversal-block.
    norm = full_path.replace("\\", "/").lstrip("/")
    if ".." in norm.split("/") or norm.startswith("."):
        return JSONResponse({"error": "bad path"}, status_code=400)
    root = norm.split("/", 1)[0]
    if root not in _ALLOWED_FILE_ROOTS:
        return JSONResponse({"error": f"root '{root}' not allowed"}, status_code=403)
    p = cfg.abs_path("data") / norm
    # Final containment check: resolved path must still live under data/.
    data_root = cfg.abs_path("data").resolve()
    try:
        resolved = p.resolve()
        resolved.relative_to(data_root)
    except (OSError, ValueError):
        return JSONResponse({"error": "path escaped"}, status_code=400)
    if not resolved.is_file():
        return JSONResponse({"error": "not found"}, status_code=404)
    return FileResponse(resolved)


@router.get("/processes")
async def processes(request: Request, limit: int = 15):
    rows = []
    for p in psutil.process_iter(["pid", "name", "cpu_percent", "memory_percent"]):
        try:
            rows.append(p.info)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    rows.sort(key=lambda x: (x.get("cpu_percent") or 0), reverse=True)
    return {"processes": rows[:limit]}


@router.get("/tools")
async def tools(request: Request):
    cfg, orch, registry, *_ = _services(request)
    return {
        "tools": [
            {
                "name": t.name,
                "description": t.description,
                "permission": t.permission.value,
                "plugin": t.plugin,
                "parameters": t.parameters,
            }
            for t in registry.all_tools()
        ]
    }


@router.get("/plugins")
async def plugins(request: Request):
    cfg, orch, registry, *_ = _services(request)
    return {
        "plugins": [
            {
                "name": p.name,
                "description": p.description,
                "permissions": [perm.value for perm in p.permissions_needed],
            }
            for p in registry.plugins()
        ]
    }


@router.get("/agents")
async def list_agents(request: Request):
    *_, agents = _services(request)
    return {
        "agents": [
            {"name": a.name, "description": a.description, "tools": a.tool_allowlist}
            for a in agents.list()
        ]
    }


@router.get("/intents")
async def list_intents_endpoint(_request: Request):
    """List every deterministic intent the router can classify. Useful for
    UI surfacing + debugging tool selection regressions."""
    from ...core.intent_router import list_intents
    return {"intents": list_intents()}


@router.get("/intents/classify")
async def classify_endpoint(text: str):
    """Dry-run intent classification on arbitrary text. The router does NOT
    execute any tool — it just reports which intent (if any) would fire.
    Lets you verify routing without spending an LLM call."""
    from ...core.intent_router import classify
    m = classify(text)
    if m is None:
        return {"matched": False, "intent": None}
    return {
        "matched": True,
        "intent": m.name,
        "tool": m.tool_call.name,
        "args": m.tool_call.args,
        "final_prefix": m.final_prefix,
        "raw_match": m.raw_match,
    }

class PersonaBody(BaseModel):
    persona: str

@router.get("/persona")
async def get_persona(request: Request):
    cfg, *_ = _services(request)
    return {"persona": cfg.A.persona, "name": cfg.A.name}


@router.post("/persona")
async def set_persona(request: Request, body: PersonaBody):
    cfg, *_ = _services(request)
    cfg.A.persona = body.persona
    return {"ok": True}

# iframe is then JARVIS's own origin.

_HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade",
    "x-frame-options", "content-security-policy", "content-security-policy-report-only",
    "permissions-policy", "cross-origin-opener-policy", "cross-origin-embedder-policy",
    "cross-origin-resource-policy",
}


@router.get("/proxy")
async def iframe_proxy(url: str = Query(..., min_length=8)):
    u = url.strip()
    if not u.startswith(("http://", "https://")):
        u = "https://" + u
    parsed = urlparse(u)
    if not parsed.netloc:
        return JSONResponse({"error": "bad url"}, status_code=400)

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    try:
        async with httpx.AsyncClient(timeout=25, follow_redirects=True, headers=headers) as c:
            r = await c.get(u)
    except Exception as e:  # noqa: BLE001
        return HTMLResponse(f"<pre>Proxy error: {e}</pre>", status_code=502)

    ctype = r.headers.get("content-type", "text/html")
    out_headers = {
        k: v for k, v in r.headers.items()
        if k.lower() not in _HOP_BY_HOP and not k.lower().startswith("set-cookie")
    }
    out_headers["X-JARVIS-Proxied"] = "1"

    if "html" in ctype.lower():
        text = r.text
        base = f"{parsed.scheme}://{parsed.netloc}"
        # Inject <base> so relative URLs resolve. Strip frame-busting scripts (best-effort).
        base_tag = f'<base href="{base}/">'
        if re.search(r"<head[^>]*>", text, re.IGNORECASE):
            text = re.sub(r"(<head[^>]*>)", r"\1" + base_tag, text, count=1, flags=re.IGNORECASE)
        else:
            text = base_tag + text
        # Remove the common "if (top !== self) top.location = …" bombs.
        text = re.sub(r"if\s*\(\s*(?:top|window\.top)\s*!?=+\s*(?:self|window)[\s\S]*?\)\s*[\s\S]*?;", "", text, count=4)
        return HTMLResponse(text, status_code=r.status_code, headers=out_headers)

    return Response(content=r.content, status_code=r.status_code, media_type=ctype, headers=out_headers)


# ============================ In-app reader =================================
# News URLs frequently can't be iframed (X-Frame-Options DENY, CSP, JS-based
# redirect wrappers like Google News). The reader endpoint server-side
# fetches the article, follows any redirect wrapper to the real publisher,
# strips out boilerplate via trafilatura, and returns a clean JSON payload
# that the frontend renders inside its own themed reader overlay.

_GNEWS_RE = re.compile(r"^https?://(?:www\.)?news\.google\.com/", re.IGNORECASE)
_GNEWS_LINK_RE = re.compile(
    r'<a[^>]+href="(https?://(?!(?:www\.)?(?:news\.)?google\.com)[^"#]+)"',
    re.IGNORECASE,
)


async def _resolve_news_url(url: str) -> str:
    """Resolve Google News wrapper URLs to the real publisher URL."""
    if not _GNEWS_RE.match(url):
        return url
    try:
        async with httpx.AsyncClient(
            timeout=15,
            follow_redirects=True,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                              "AppleWebKit/537.36 (KHTML, like Gecko) "
                              "Chrome/120.0 Safari/537.36",
            },
        ) as c:
            r = await c.get(url)
        final = str(r.url)
        if not _GNEWS_RE.match(final):
            return final
        m = _GNEWS_LINK_RE.search(r.text or "")
        if m:
            return m.group(1)
    except Exception:
        pass
    return url


@router.get("/reader")
async def reader(url: str = Query(..., min_length=8)):
    u = url.strip()
    if not u.startswith(("http://", "https://")):
        u = "https://" + u
    real = await _resolve_news_url(u)
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True, headers=headers) as c:
            r = await c.get(real)
        html = r.text or ""
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": f"fetch failed: {e}"}, status_code=502)

    try:
        import trafilatura
        content_html = trafilatura.extract(
            html,
            url=str(r.url),
            output_format="html",
            include_images=True,
            include_links=True,
            with_metadata=False,
            favor_recall=True,
        ) or ""
        meta_obj = trafilatura.extract_metadata(html, default_url=str(r.url))
        meta: dict = {}
        if meta_obj is not None:
            for k in ("title", "author", "date", "sitename", "image", "description"):
                v = getattr(meta_obj, k, None)
                if v:
                    meta[k] = v
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": f"extract failed: {e}"}, status_code=500)

    return {
        "ok": True,
        "url": str(r.url),
        "title": meta.get("title") or "",
        "author": meta.get("author") or "",
        "published": meta.get("date") or "",
        "site": meta.get("sitename") or _host(str(r.url)),
        "image": meta.get("image") or "",
        "description": meta.get("description") or "",
        "content_html": content_html,
    }


def _host(url: str) -> str:
    try:
        from urllib.parse import urlparse as _urlparse
        return _urlparse(url).hostname or url
    except Exception:
        return url

@router.post("/cleanslate")
async def clean_slate(request: Request):
    cfg, orch, registry, memory, agents = _services(request)
    orch.reset()
    return {"ok": True, "message": "Clean slate executed. Conversation history wiped. Memory preserved."}


@router.get("/mission")
async def mission(request: Request):
    cfg, *_ = _services(request)
    return {"enabled": cfg.mission.enabled, "project_path": cfg.mission.project_path}


class MissionBody(BaseModel):
    path: str


@router.post("/mission")
async def set_mission(request: Request, body: MissionBody):
    cfg, *_, memory, _ = _services(request)
    from pathlib import Path as _P
    p = _P(body.path).expanduser().resolve()
    if not p.exists():
        return JSONResponse({"ok": False, "error": f"path not found: {p}"}, status_code=400)
    cfg.mission.enabled = True
    cfg.mission.project_path = str(p)
    memory.set_path("mission", str(p), "project")
    return {"ok": True, "path": str(p)}


# ═══════════════════════════════════════════════════════════════════════════
#  IMAGE ANALYSIS / IMG2IMG / IMAGE→3D  endpoints
# ═══════════════════════════════════════════════════════════════════════════
