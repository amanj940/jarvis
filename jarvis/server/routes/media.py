"""Media routes: image-model selection, vision analysis, image->3D,
img2img. Split out of jarvis/server/routes.py (Phase 2).

Heavy lifting lives in jarvis/plugins/media/; these endpoints only
validate uploads and invoke the registered tools.
"""
from __future__ import annotations

import base64
import logging
import re

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .common import _services

router = APIRouter()
_img_log = logging.getLogger("jarvis.image_api")

class ImageModelSelectBody(BaseModel):
    model: str


@router.get("/image-models")
async def image_models(request: Request):
    cfg = request.app.state.cfg
    from ...plugins.media import list_image_models
    return list_image_models(cfg)


@router.post("/image-models/select")
async def select_image_model_endpoint(request: Request, body: ImageModelSelectBody):
    cfg = request.app.state.cfg
    from ...plugins.media import select_image_model
    try:
        return {"ok": True, **select_image_model(cfg, body.model)}
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)

_img_log = logging.getLogger("jarvis.image_api")


@router.post("/analyze-image")
async def analyze_image(
    request: Request,
    file: UploadFile = File(...),
    prompt: str = Form("Describe this image in detail. What do you see?"),
):
    """Send an uploaded image to the LLM for vision analysis.

    The image is base64-encoded and attached as a multimodal content part
    in the OpenAI vision format.  The orchestrator is bypassed — we talk
    directly to the LLMBrain so the response is synchronous JSON.
    """
    data = await file.read()
    if not data:
        return JSONResponse({"error": "empty file"}, status_code=400)
    if not (file.content_type or "").startswith("image/"):
        return JSONResponse({"error": "not an image"}, status_code=400)

    # Cap at 20 MB to avoid absurd payloads.
    if len(data) > 20 * 1024 * 1024:
        return JSONResponse({"error": "image too large (max 20 MB)"}, status_code=400)

    b64 = base64.b64encode(data).decode("ascii")
    mime = file.content_type or "image/png"
    data_url = f"data:{mime};base64,{b64}"

    brain = request.app.state.orchestrator.brain
    cfg = request.app.state.cfg

    messages = [
        {"role": "system", "content": cfg.A.persona.strip()},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": data_url}},
            ],
        },
    ]

    _img_log.info("analyze-image: %d bytes, prompt=%s", len(data), prompt[:80])
    try:
        reply = await brain.chat(messages)
        return {"ok": True, "analysis": reply.text}
    except Exception as e:
        _img_log.exception("analyze-image failed")
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/image-to-3d")
async def image_to_3d_endpoint(
    request: Request,
    file: UploadFile = File(...),
):
    """Upload an image and convert it to a 3D GLB model.

    Uses the media plugin's image_to_3d tool internally.
    Returns the URL to the generated .glb file.
    """
    data = await file.read()
    if not data:
        return JSONResponse({"error": "empty file"}, status_code=400)
    if not (file.content_type or "").startswith("image/"):
        return JSONResponse({"error": "not an image"}, status_code=400)

    cfg = request.app.state.cfg
    registry = request.app.state.registry

    # Save the uploaded image to a temp location.
    up_dir = cfg.abs_path("data/uploads")
    up_dir.mkdir(parents=True, exist_ok=True)
    import uuid as _uuid
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", file.filename or "img.png")
    uid = _uuid.uuid4().hex[:8]
    img_path = up_dir / f"{uid}-{safe}"
    img_path.write_bytes(data)

    _img_log.info("image-to-3d: saved %s (%d bytes)", img_path.name, len(data))

    # Invoke the tool directly.
    tool = registry.get("image_to_3d")
    if tool is None:
        return JSONResponse({"error": "image_to_3d tool not available"}, status_code=503)

    try:
        result = await tool.invoke({"image_path": str(img_path)})
        return {"ok": True, "result": result}
    except Exception as e:
        _img_log.exception("image-to-3d failed")
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/img2img")
async def img2img_endpoint(
    request: Request,
    file: UploadFile = File(...),
    prompt: str = Form(""),
    strength: float = Form(0.65),
    steps: int = Form(4),
    guidance_scale: float = Form(4.0),
):
    """Upload an init image + prompt, generate a new image guided by both.

    Uses the media plugin's image_generate tool with init_image.
    Returns the URL to the generated image.
    """
    data = await file.read()
    if not data:
        return JSONResponse({"error": "empty file"}, status_code=400)
    if not (file.content_type or "").startswith("image/"):
        return JSONResponse({"error": "not an image"}, status_code=400)

    cfg = request.app.state.cfg
    registry = request.app.state.registry

    # Save the uploaded image.
    up_dir = cfg.abs_path("data/uploads")
    up_dir.mkdir(parents=True, exist_ok=True)
    import uuid as _uuid
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", file.filename or "img.png")
    uid = _uuid.uuid4().hex[:8]
    img_path = up_dir / f"{uid}-{safe}"
    img_path.write_bytes(data)

    _img_log.info("img2img: saved %s (%d bytes), prompt=%s", img_path.name, len(data), prompt[:80])

    tool = registry.get("image_generate")
    if tool is None:
        return JSONResponse({"error": "image_generate tool not available"}, status_code=503)

    args = {
        "prompt": prompt or "transform this image",
        "init_image": str(img_path),
        "strength": strength,
        "steps": steps,
        "guidance_scale": guidance_scale,
    }
    try:
        result = await tool.invoke(args)
        return {"ok": True, "result": result}
    except Exception as e:
        _img_log.exception("img2img failed")
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)
