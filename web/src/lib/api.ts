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
