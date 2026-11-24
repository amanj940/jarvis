"""System routes: health, stats, logs, files, processes, plugins/tools,
agents, intents, proxy/reader, cleanslate, mission, persona.

Split out of jarvis/server/routes.py (Phase 2). No model loading here —
only telemetry (NVML / nvidia-smi) and app-state reads.
"""
from __future__ import annotations

import asyncio
import base64
import collections
import ipaddress
import json
import logging
import os
import platform
import re
import shutil
import socket
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx
import psutil
from fastapi import APIRouter, File, Query, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, StrictBool

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

async def _probe_model_endpoint(cfg) -> dict:
    """Phase 4: actually ask the model endpoint if it answers.

    GET {endpoint}/models with a 2 s timeout. Never raises and never
    blocks health for long — an unreachable model is reported, not fatal.
    """
    url = cfg.model.endpoint.rstrip("/") + "/models"
    headers = {}
    if cfg.model.api_key:
        headers["Authorization"] = f"Bearer {cfg.model.api_key}"
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(url, headers=headers)
        return {"reachable": resp.status_code < 500, "status_code": resp.status_code}
    except Exception as e:  # noqa: BLE001
        return {"reachable": False, "error": f"{type(e).__name__}: {e}"}


@router.get("/health")
async def health(request: Request):
    cfg, orch, registry, memory, agents = _services(request)
    model_probe = await _probe_model_endpoint(cfg)
    # Voice availability is probed WITHOUT loading any model (import +
    # file checks only) — health must stay cheap.
    try:
        from ...models.tts import _edge_tts_available, _piper_available
        whisper_available = True
        try:
            import faster_whisper  # noqa: F401
        except Exception:  # noqa: BLE001
            whisper_available = False
        voice_avail = {
            "whisper_available": whisper_available,
            "piper_available": _piper_available(cfg),
            "edge_tts_available": _edge_tts_available(),
        }
    except Exception as e:  # noqa: BLE001
        voice_avail = {"error": str(e)}
    vs = getattr(orch, "voice_state", None)
    task_store = getattr(request.app.state, "task_store", None)
    return {
        "status": "online",
        "name": cfg.A.name,
        "model": {
            "provider": cfg.model.provider,
            "model": cfg.model.model,
            "endpoint": cfg.model.endpoint,
            "configured": bool(cfg.model.api_key),
            **model_probe,
        },
        "image_model": getattr(getattr(cfg, "image_model", None), "selected", "flux2-klein"),
        "plugins": [p.name for p in registry.plugins()],
        "tools": len(registry.all_tools()),
        "agents": agents.names(),
        "permission_mode": cfg.permissions.mode,
        "voice": {"wake_word": cfg.voice.wake_word,
                  "stt_language": getattr(cfg.voice, "stt_language", "ar"),
                  "state": vs.value if vs is not None else "idle",
                  **voice_avail},
        "tasks": {"pending": len(task_store.list_tasks(status="pending")) if task_store else None},
    }


# --- Action log (Phase 4): failures visible via API, not just a file -----
@router.get("/actions")
async def get_actions(request: Request, n: int = 100, only_failed: bool = False):
    """Last `n` action-log entries (newest first).

    ``?only_failed=true`` returns only failed/denied tool invocations —
    the auditable surface for "what went wrong".
    """
    cfg, *_ = _services(request)
    from ...core.logger import ActionLog

    log = ActionLog(cfg)
    return {"actions": log.recent(n=n, only_failed=only_failed)}


# --- Persistent tasks (Phase 4) -------------------------------------------
def _task_store(request: Request):
    return getattr(request.app.state, "task_store", None)


def _task_scheduler(request: Request):
    return getattr(request.app.state, "task_scheduler", None)


class TaskBody(BaseModel):
    title: str
    kind: str = "reminder"
    payload: dict = {}
    schedule: str | None = None
    run_at: str | float | None = None


class TaskUpdateBody(BaseModel):
    title: str | None = None
    kind: str | None = None
    payload: dict | None = None
    schedule: str | None = None
    status: str | None = None
    run_at: str | float | None = None


@router.get("/tasks")
async def list_tasks(request: Request, status: str | None = None, kind: str | None = None):
    store = _task_store(request)
    if store is None:
        return JSONResponse({"error": "task system not initialised"}, status_code=503)
    return {"tasks": store.list_tasks(status=status, kind=kind)}


@router.post("/tasks")
async def create_task(request: Request, body: TaskBody):
    store = _task_store(request)
    if store is None:
        return JSONResponse({"error": "task system not initialised"}, status_code=503)
    try:
        task = store.create(title=body.title, kind=body.kind, payload=body.payload,
                            schedule=body.schedule, run_at=body.run_at)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    sched = _task_scheduler(request)
    if sched is not None:
        sched.schedule_task(task)
    return task


@router.get("/tasks/{task_id}")
async def get_task(request: Request, task_id: int):
    store = _task_store(request)
    if store is None:
        return JSONResponse({"error": "task system not initialised"}, status_code=503)
    task = store.get(task_id)
    if task is None:
        return JSONResponse({"error": f"no task {task_id}"}, status_code=404)
    return task


@router.patch("/tasks/{task_id}")
async def update_task(request: Request, task_id: int, body: TaskUpdateBody):
    store = _task_store(request)
    if store is None:
        return JSONResponse({"error": "task system not initialised"}, status_code=503)
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "run_at" in fields:
        fields["next_run"] = fields.pop("run_at")
    try:
        task = store.update(task_id, **fields)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    if task is None:
        return JSONResponse({"error": f"no task {task_id}"}, status_code=404)
    sched = _task_scheduler(request)
    if sched is not None:
        sched.unschedule_task(task_id)
        sched.schedule_task(task)
    return task


@router.post("/tasks/{task_id}/cancel")
async def cancel_task(request: Request, task_id: int):
    store = _task_store(request)
    if store is None:
        return JSONResponse({"error": "task system not initialised"}, status_code=503)
    task = store.cancel(task_id)
    if task is None:
        return JSONResponse({"error": f"no task {task_id}"}, status_code=404)
    sched = _task_scheduler(request)
    if sched is not None:
        sched.unschedule_task(task_id)
    return task


@router.post("/tasks/{task_id}/run")
async def run_task_now(request: Request, task_id: int):
    """Run a task immediately (also the manual trigger for a pending task)."""
    sched = _task_scheduler(request)
    store = _task_store(request)
    if store is None or sched is None:
        return JSONResponse({"error": "task system not initialised"}, status_code=503)
    try:
        return await sched.run_task(task_id)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=404)

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

# --- Persona / mission persistence (worker L hardening) -------------------
# Previously POST /persona and POST /mission only mutated the in-memory
# Config object, so a restart silently reverted them to config.yaml /
# persona/jarvis-ar.md. They now persist to a JSON state file under
# data/ (data/system_state.json, written atomically via temp file +
# os.replace) and every GET reads that file first, falling back to the
# in-memory config value when no persisted value exists. The persona
# file (cfg.A.persona_file) is deliberately NOT rewritten here: the
# state file is the override layer, so a short persona set via the API
# can never clobber the full persona document on disk.
_SYSTEM_STATE_FILE = "system_state.json"


def _system_state_path(cfg) -> Path:
    try:
        return cfg.abs_path("data") / _SYSTEM_STATE_FILE
    except Exception:  # noqa: BLE001 - fake/minimal cfg objects in tests
        return Path("data") / _SYSTEM_STATE_FILE


def _read_system_state(cfg) -> dict:
    """Best-effort read of data/system_state.json; {} when absent/corrupt."""
    try:
        raw = _system_state_path(cfg).read_text(encoding="utf-8")
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:  # noqa: BLE001 - missing/corrupt file = no overrides
        return {}


def _write_system_state(cfg, updates: dict) -> dict:
    """Atomically merge `updates` into data/system_state.json.

    Raises OSError on failure; callers must not claim success then.
    """
    path = _system_state_path(cfg)
    path.parent.mkdir(parents=True, exist_ok=True)
    state = _read_system_state(cfg)
    for key, value in updates.items():
        if isinstance(value, dict) and isinstance(state.get(key), dict):
            state[key] = {**state[key], **value}
        else:
            state[key] = value
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)
    return state


class PersonaBody(BaseModel):
    persona: str

@router.get("/persona")
async def get_persona(request: Request):
    cfg, *_ = _services(request)
    persisted = _read_system_state(cfg).get("persona")
    persona = persisted if isinstance(persisted, str) and persisted else cfg.A.persona
    return {"persona": persona, "name": cfg.A.name}


@router.post("/persona")
async def set_persona(request: Request, body: PersonaBody):
    cfg, *_ = _services(request)
    persona = (body.persona or "").strip()
    if not persona:
        return JSONResponse({"ok": False, "error": "persona must not be empty",
                             "code": "bad_persona"}, status_code=400)
    try:
        _write_system_state(cfg, {"persona": persona})
    except OSError as e:
        return JSONResponse({"ok": False, "error": f"could not persist persona: {e}",
                             "code": "persist_failed"}, status_code=500)
    cfg.A.persona = persona
    return {"ok": True}

# iframe is then JARVIS's own origin.

_HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade",
    "x-frame-options", "content-security-policy", "content-security-policy-report-only",
    "permissions-policy", "cross-origin-opener-policy", "cross-origin-embedder-policy",
    "cross-origin-resource-policy",
}


# ============================ SSRF mitigation (worker L) ==================
# /proxy and /reader used to fetch ANY caller-supplied URL with
# follow_redirects=True and no size limit — a classic SSRF: the server
# could be made to hit localhost, RFC-1918 hosts, or cloud metadata
# endpoints (169.254.169.254) and return the response. Every outbound
# fetch from these routes now goes through validate_public_url() +
# _fetch_public() below.
#
# RESIDUAL LIMITATION (honest): validation resolves DNS and checks the
# resolved address, but httpx re-resolves the hostname when it connects,
# so a DNS-rebinding attacker (a hostname whose DNS flips from a public
# IP at validation time to a private IP at connect time, inside the
# request's TTL window) could still slip through. Closing that gap
# needs an IP-pinned transport (connect to the validated IP with the
# original Host header / TLS SNI) — out of scope for this change.
# Redirects are followed manually (max 5), re-validating EVERY hop, so
# a public URL that 302s to http://127.0.0.1/ is blocked, not followed.
_FETCH_TIMEOUT = 15.0
_FETCH_MAX_BYTES = 5_000_000  # 5 MB cap on any proxied / reader response
_MAX_REDIRECTS = 5
_BLOCKED_HOSTNAMES = {"localhost", "metadata", "metadata.google.internal"}
_CLOUD_METADATA_IPS = {
    "169.254.169.254",   # AWS / GCP / Azure IMDS
    "169.254.170.2",     # ECS task metadata
    "100.100.100.200",   # Alibaba Cloud metadata
    "fd00:ec2::254",     # AWS IPv6 IMDS
}


class _UnsafeURL(ValueError):
    """A fetch URL that failed SSRF validation (structured error)."""

    def __init__(self, message: str, *, code: str = "ssrf_blocked", status_code: int = 403):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


class _ResponseTooLarge(ValueError):
    """A fetch response that exceeded _FETCH_MAX_BYTES."""

    def __init__(self, message: str):
        super().__init__(message)
        self.code = "response_too_large"
        self.status_code = 413


def _unsafe_url_response(exc: ValueError) -> JSONResponse:
    code = getattr(exc, "code", "ssrf_blocked")
    status = getattr(exc, "status_code", 403)
    return JSONResponse({"ok": False, "error": str(exc), "code": code}, status_code=status)


def _resolve_host(hostname: str, port: int) -> list[str]:
    """Resolve a hostname to its IP addresses (sync; call via to_thread)."""
    try:
        infos = socket.getaddrinfo(hostname, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as e:
        raise _UnsafeURL(f"cannot resolve host '{hostname}': {e}",
                         code="dns_failed", status_code=502) from e
    ips = sorted({info[4][0] for info in infos if info[4]})
    if not ips:
        raise _UnsafeURL(f"cannot resolve host '{hostname}'",
                         code="dns_failed", status_code=502)
    return ips


def _check_ip_allowed(ip_str: str) -> None:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError as e:
        raise _UnsafeURL(f"unparsable address '{ip_str}'", code="bad_url",
                         status_code=400) from e
    if ip_str in _CLOUD_METADATA_IPS:
        raise _UnsafeURL(f"destination is a cloud metadata endpoint: {ip_str}")
    if (ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_multicast
            or ip.is_reserved or ip.is_unspecified
            or ip in ipaddress.ip_network("100.64.0.0/10")):  # CGNAT, not public
        raise _UnsafeURL(f"destination resolves to a non-public address: {ip_str}")


def validate_public_url(url: str, *, _resolve=None) -> str:
    """Validate a caller-supplied fetch URL; return the normalised URL.

    Rules: http/https only, no embedded credentials, hostname must not
    be localhost/metadata-ish, and EVERY resolved address must be a
    public IP. Raises _UnsafeURL (a ValueError) on any failure.
    `_resolve` is an injectable resolver for tests (defaults to the
    module-level _resolve_host, looked up at call time so monkeypatching
    works); pass None to use the real DNS resolver.
    """
    if not isinstance(url, str) or not url.strip():
        raise _UnsafeURL("empty url", code="bad_url", status_code=400)
    u = url.strip()
    lowered = u.lower()
    if lowered.startswith(("http://", "https://")):
        pass
    elif "://" in u:
        # e.g. ftp://, file://, gopher:// — never silently rewrite these
        # into an https:// URL (that would hide the scheme from the check).
        raise _UnsafeURL(f"unsupported scheme in URL: {u.split('://', 1)[0]!r}",
                         code="bad_url", status_code=400)
    else:
        u = "https://" + u
    parsed = urlparse(u)
    if parsed.scheme not in ("http", "https"):
        raise _UnsafeURL(f"unsupported scheme: {parsed.scheme!r}",
                         code="bad_url", status_code=400)
    if parsed.username or parsed.password:
        raise _UnsafeURL("credentials in URL are not allowed")
    host = (parsed.hostname or "").lower().rstrip(".")
    if not host:
        raise _UnsafeURL("missing host", code="bad_url", status_code=400)
    if host in _BLOCKED_HOSTNAMES or host.endswith((".localhost", ".local", ".internal")):
        raise _UnsafeURL(f"destination host is blocked: {host}")
    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError as e:
        raise _UnsafeURL(f"invalid port: {e}", code="bad_url", status_code=400) from e
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None
    if ip is not None:
        _check_ip_allowed(str(ip))
    else:
        resolver = _resolve or _resolve_host
        for ip_str in resolver(host, port):
            _check_ip_allowed(ip_str)
    return u


class _FetchResult:
    """Outcome of _fetch_public: final URL, status, headers, bounded body."""

    def __init__(self, final_url: str, status_code: int, headers: dict, body: bytes):
        self.final_url = final_url
        self.status_code = status_code
        self.headers = headers
        self.body = body

    @property
    def text(self) -> str:
        return self.body.decode("utf-8", "replace")


async def _fetch_public(url: str, *, headers: dict | None = None,
                        timeout: float = _FETCH_TIMEOUT,
                        max_bytes: int = _FETCH_MAX_BYTES) -> _FetchResult:
    """Fetch a validated public URL with manual redirect + size limits.

    Validates the initial URL and every redirect target; streams the
    body and aborts (raising _ResponseTooLarge) past `max_bytes`.
    Raises _UnsafeURL for blocked destinations, httpx errors propagate
    to the caller (mapped to 502 there).
    """
    current = await asyncio.to_thread(validate_public_url, url)
    for _hop in range(_MAX_REDIRECTS + 1):
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False,
                                     headers=headers) as client:
            async with client.stream("GET", current) as r:
                if r.status_code in (301, 302, 303, 307, 308):
                    location = r.headers.get("location")
                    if not location:
                        return _FetchResult(current, r.status_code, dict(r.headers), b"")
                    current = await asyncio.to_thread(
                        validate_public_url, urljoin(current, location))
                    continue
                body = bytearray()
                async for chunk in r.aiter_bytes(65536):
                    body.extend(chunk)
                    if len(body) > max_bytes:
                        raise _ResponseTooLarge(
                            f"response exceeds {_FETCH_MAX_BYTES} byte limit")
                return _FetchResult(current, r.status_code, dict(r.headers), bytes(body))
    raise _UnsafeURL("too many redirects", code="too_many_redirects", status_code=502)


def _normalise_fetch_url(raw: str) -> str:
    """Add the default https:// scheme to a bare hostname only.

    A URL that already carries a non-http(s) scheme is returned as-is
    so validate_public_url() rejects it instead of it being rewritten.
    """
    u = raw.strip()
    lowered = u.lower()
    if lowered.startswith(("http://", "https://")) or "://" in u:
        return u
    return "https://" + u


@router.get("/proxy")
async def iframe_proxy(url: str = Query(..., min_length=8)):
    # Validate BEFORE any fetch (defence in depth: _fetch_public also
    # validates, but a blocked URL must never reach the fetch layer).
    try:
        await asyncio.to_thread(validate_public_url, _normalise_fetch_url(url))
    except _UnsafeURL as e:
        return _unsafe_url_response(e)
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    try:
        r = await _fetch_public(_normalise_fetch_url(url), headers=headers)
    except (_UnsafeURL, _ResponseTooLarge) as e:
        return _unsafe_url_response(e)
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": f"Proxy error: {e}",
                             "code": "fetch_failed"}, status_code=502)

    ctype = r.headers.get("content-type", "text/html")
    out_headers = {
        k: v for k, v in r.headers.items()
        if k.lower() not in _HOP_BY_HOP and not k.lower().startswith("set-cookie")
    }
    out_headers["X-JARVIS-Proxied"] = "1"

    if "html" in ctype.lower():
        text = r.text
        parsed = urlparse(r.final_url)
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

    return Response(content=r.body, status_code=r.status_code, media_type=ctype, headers=out_headers)


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
    """Resolve Google News wrapper URLs to the real publisher URL.

    Fetches through _fetch_public, so the wrapper URL and every
    redirect hop are SSRF-validated; a wrapper that redirects to a
    private/metadata destination falls back to the original URL.
    """
    if not _GNEWS_RE.match(url):
        return url
    try:
        r = await _fetch_public(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                          "AppleWebKit/537.36 (KHTML, like Gecko) "
                          "Chrome/120.0 Safari/537.36",
        })
        final = r.final_url
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
    u = _normalise_fetch_url(url)
    try:
        await asyncio.to_thread(validate_public_url, u)
    except _UnsafeURL as e:
        return _unsafe_url_response(e)
    real = await _resolve_news_url(u)
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    try:
        r = await _fetch_public(real, headers=headers)
        html = r.text or ""
    except (_UnsafeURL, _ResponseTooLarge) as e:
        return _unsafe_url_response(e)
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": f"fetch failed: {e}",
                             "code": "fetch_failed"}, status_code=502)

    try:
        import trafilatura
        content_html = trafilatura.extract(
            html,
            url=r.final_url,
            output_format="html",
            include_images=True,
            include_links=True,
            with_metadata=False,
            favor_recall=True,
        ) or ""
        meta_obj = trafilatura.extract_metadata(html, default_url=r.final_url)
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
        "url": r.final_url,
        "title": meta.get("title") or "",
        "author": meta.get("author") or "",
        "published": meta.get("date") or "",
        "site": meta.get("sitename") or _host(r.final_url),
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

# Exact typed confirmation string required by POST /cleanslate,
# in addition to {"confirm": true}. Any caller (e.g. the HUD button)
# must send BOTH fields; a missing/empty body is rejected (FastAPI
# returns 422 for a missing body, 400 below for a wrong one).
CLEANSLATE_CONFIRMATION = "CLEAN SLATE"


class CleanSlateBody(BaseModel):
    # StrictBool: only a real JSON true counts. Plain `bool` would let
    # Pydantic coerce "yes" / 1 / "true" into True, weakening the confirm.
    confirm: StrictBool = False
    confirmation: str = ""


@router.post("/cleanslate")
async def clean_slate(request: Request, body: CleanSlateBody):
    """Wipe conversation history (memory preserved).

    Contract: POST {"confirm": true, "confirmation": "CLEAN SLATE"}.
    Anything else is rejected with 400 and nothing is wiped — this
    endpoint must never fire from an accidental click or a bare POST.
    """
    if body.confirm is not True or (body.confirmation or "").strip() != CLEANSLATE_CONFIRMATION:
        return JSONResponse(
            {"ok": False,
             "error": 'cleanslate requires {"confirm": true, "confirmation": "CLEAN SLATE"}',
             "code": "confirmation_required"},
            status_code=400)
    cfg, orch, registry, memory, agents = _services(request)
    orch.reset()
    return {"ok": True, "message": "Clean slate executed. Conversation history wiped. Memory preserved."}


@router.get("/mission")
async def mission(request: Request):
    cfg, *_ = _services(request)
    persisted = _read_system_state(cfg).get("mission")
    if isinstance(persisted, dict):
        return {"enabled": persisted.get("enabled", cfg.mission.enabled),
                "project_path": persisted.get("project_path", cfg.mission.project_path)}
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
    try:
        _write_system_state(cfg, {"mission": {"enabled": True, "project_path": str(p)}})
    except OSError as e:
        return JSONResponse({"ok": False, "error": f"could not persist mission: {e}",
                             "code": "persist_failed"}, status_code=500)
    cfg.mission.enabled = True
    cfg.mission.project_path = str(p)
    memory.set_path("mission", str(p), "project")
    return {"ok": True, "path": str(p)}


# ═══════════════════════════════════════════════════════════════════════════
#  IMAGE ANALYSIS / IMG2IMG / IMAGE→3D  endpoints
# ═══════════════════════════════════════════════════════════════════════════
