import type { Health, SystemStats } from "./store";
import { JARVIS_API_URL } from "./config";

// In Tauri release mode the webview loads local files (tauri://localhost/)
// so relative URLs like /api/health resolve to tauri://localhost/api/... and
// never reach the Python backend (see JARVIS_API_URL in ./config).
// window.__TAURI__ is injected by Tauri when withGlobalTauri=true.
export const API_BASE =
  typeof window !== "undefined" && (window as any).__TAURI__
    ? JARVIS_API_URL
    : "";

export async function getHealth(): Promise<Health> {
  const r = await fetch(`${API_BASE}/api/health`);
  if (!r.ok) throw new Error(`Health request failed: ${r.status}`);
  return r.json();
}

export async function getStats(): Promise<SystemStats> {
  const r = await fetch(`${API_BASE}/api/stats`);
  return r.json();
}

export async function getProcesses(limit = 12) {
  const r = await fetch(`${API_BASE}/api/processes?limit=${limit}`);
  return r.json();
}

export async function searchMemory(q: string) {
  const r = await fetch(`${API_BASE}/api/memory/search?q=${encodeURIComponent(q)}`);
  return r.json();
}

export async function getAgents() {
  const r = await fetch(`${API_BASE}/api/agents`);
  return r.json();
}

export async function getTools() {
  const r = await fetch(`${API_BASE}/api/tools`);
  return r.json();
}

export async function getPlugins() {
  const r = await fetch(`${API_BASE}/api/plugins`);
  return r.json();
}

export async function togglePlugin(name: string, enabled: boolean) {
  const r = await fetch(`${API_BASE}/api/plugins/${name}/toggle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  return r.json();
}

export async function getMcpServers() {
  const r = await fetch(`${API_BASE}/api/mcp/servers`);
  return r.json();
}

export async function addMcpServer(data: {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  description?: string;
}) {
  const r = await fetch(`${API_BASE}/api/mcp/servers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return r.json();
}

export async function toggleMcpServer(name: string, enabled: boolean) {
  const r = await fetch(`${API_BASE}/api/mcp/servers/${name}/toggle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  return r.json();
}

export async function deleteMcpServer(name: string) {
  const r = await fetch(`${API_BASE}/api/mcp/servers/${name}`, {
    method: "DELETE",
  });
  return r.json();
}

export async function cleanSlate() {
  const r = await fetch(`${API_BASE}/api/cleanslate`, { method: "POST" });
  return r.json();
}

export interface ImageModelInfo {
  key: string;
  label: string;
  family: string;
  description: string;
  repo: string;
  file: string;
  base_repo: string;
  local_path: string;
  downloaded: boolean;
  loaded: boolean;
  default_steps: number;
  default_guidance: number;
}

export async function getImageModels(): Promise<{ selected: string; models: ImageModelInfo[] }> {
  const r = await fetch(`${API_BASE}/api/image-models`);
  return r.json();
}

export async function selectImageModel(model: string): Promise<{ ok: boolean; selected?: string; error?: string }> {
  const r = await fetch(`${API_BASE}/api/image-models/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  return r.json();
}

// ── Image analysis / img2img / image→3D ─────────────────────────────────

/**
 * Upload an image file to the server.
 * Returns { ok, name, url, data_url, size, mime }.
 */
export async function uploadImage(file: File): Promise<{
  ok: boolean;
  name: string;
  url: string;
  data_url?: string;
  size: number;
  mime: string;
}> {
  const form = new FormData();
  form.append("file", file);
  const r = await fetch(`${API_BASE}/api/upload`, { method: "POST", body: form });
  return r.json();
}

/**
 * Send an image to the LLM for vision analysis.
 * Returns { ok, analysis }.
 */
export async function analyzeImage(
  file: File,
  prompt?: string
): Promise<{ ok: boolean; analysis?: string; error?: string }> {
  const form = new FormData();
  form.append("file", file);
  if (prompt) form.append("prompt", prompt);
  const r = await fetch(`${API_BASE}/api/analyze-image`, { method: "POST", body: form });
  return r.json();
}

/**
 * Convert an image to a 3D model via SF3D / TripoSR.
 * Returns { ok, result }.
 */
export async function imageTo3D(
  file: File
): Promise<{ ok: boolean; result?: string; error?: string }> {
  const form = new FormData();
  form.append("file", file);
  const r = await fetch(`${API_BASE}/api/image-to-3d`, { method: "POST", body: form });
  return r.json();
}

/**
 * Image-to-image generation: upload an init image + prompt, returns a new
 * image generated using FLUX img2img mode.
 * Returns { ok, result }.
 */
export async function img2img(
  file: File,
  prompt: string,
  strength = 0.65,
  steps = 4,
  guidance = 4.0
): Promise<{ ok: boolean; result?: string; error?: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("prompt", prompt);
  form.append("strength", String(strength));
  form.append("steps", String(steps));
  form.append("guidance_scale", String(guidance));
  const r = await fetch(`${API_BASE}/api/img2img`, { method: "POST", body: form });
  return r.json();
}

// ── Settings gap fix (FG-004 / FG-005 / FG-006 / FG-010 / FG-014) ──────────
// Wrappers for the model-cascade / key-pool / verification endpoints that
// Settings.tsx used to call inline. NOTE: on the ui-hud-upgrade backend
// these endpoints do not exist yet (they live only on the audit/fixes
// branch's routes.py); callers must treat a failed/non-OK response as
// "endpoint unavailable on this backend build" and degrade gracefully.

export interface CascadeTier {
  name: string;
  provider: string;
  model: string;
  endpoint?: string;
  is_local: boolean;
  timeout: number;
  ttft_timeout: number;
}

export interface CascadeInfo {
  ok: boolean;
  online: boolean;
  tiers: CascadeTier[];
  error?: string;
}

/** FG-004 — live multi-tier adaptive cascade config (GET /api/models/cascade). */
export async function getCascadeStatus(): Promise<CascadeInfo> {
  const r = await fetch(`${API_BASE}/api/models/cascade`);
  return r.json();
}

export interface KeyPoolItem {
  masked: string;
  key_preview?: string;
  status: string;
  cooldown_remaining?: number;
  failures?: number;
  successes?: number;
  last_error?: string | null;
}

export interface KeysStatus {
  ok?: boolean;
  keys: Record<string, KeyPoolItem[]>;
  api_keys: Record<string, boolean>;
}

/** FG-005 — masked key pools + per-provider key presence (GET /api/keys). */
export async function getKeysStatus(): Promise<KeysStatus> {
  const r = await fetch(`${API_BASE}/api/keys`);
  return r.json();
}

export interface VerifiedModel {
  provider?: string;
  model_name: string;
  status: string; // "verified" | "failed" | "untested"
  latency_ms: number | null;
  last_tested: string;
}

/** FG-006 — verified-working models from the backend verifier (GET /api/models/verified). */
export async function getVerifiedModels(
  provider = ""
): Promise<{ ok: boolean; count?: number; models?: VerifiedModel[]; error?: string }> {
  const q = provider ? `?provider=${encodeURIComponent(provider)}` : "";
  const r = await fetch(`${API_BASE}/api/models/verified${q}`);
  return r.json();
}

/** FG-010 — probe one MCP server (POST /api/mcp/servers/{name}/test). */
export async function testMcpServer(name: string) {
  const r = await fetch(`${API_BASE}/api/mcp/servers/${encodeURIComponent(name)}/test`, {
    method: "POST",
  });
  return r.json();
}

/** FG-010 — fetch one MCP server's logs (GET /api/mcp/servers/{name}/logs). */
export async function getMcpServerLogs(name: string) {
  const r = await fetch(`${API_BASE}/api/mcp/servers/${encodeURIComponent(name)}/logs`);
  return r.json();
}

/** FG-014 / FG-016 — test one integration (POST /api/integrations/test/{type}). */
export async function testIntegration(
  type: "email" | "telegram" | "home_assistant" | "calendar",
  data?: Record<string, any>
) {
  const r = await fetch(`${API_BASE}/api/integrations/test/${type}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data || {}),
  });
  return r.json();
}
