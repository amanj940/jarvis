// MERGED (2026-11-24, merge-v2): audit/fixes api.ts is the base (superset,
// ~70 exports, authFetch with token + 401 handling, self-contained API_BASE).
// Added the two ui-only wrappers below (getVerifiedModels, getMcpServerLogs),
// adapted to authFetch. ui's API_BASE (JARVIS_API_URL from ./config) was NOT
// kept: ./config does not exist in this tree and af's hardcoded
// 127.0.0.1:7341 base is the Tauri-safe one. See REPORT-settings-api.md.
import type { Health, SystemStats } from "./store";

// In Tauri release mode the webview loads local files (tauri://localhost/)
// so relative URLs like /api/health resolve to tauri://localhost/api/... and
// never reach the Python backend at 127.0.0.1:7341.
// window.__TAURI__ is injected by Tauri when withGlobalTauri=true.
// In browser dev mode, we also need to point to the backend explicitly.
export const API_BASE =
  typeof window !== "undefined" && (window as any).__TAURI__
    ? "http://127.0.0.1:7341"
    : "http://127.0.0.1:7341";

export function getStoredAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem("jarvis_auth_token");
  } catch {
    return null;
  }
}

/** Auth endpoints legitimately return 401 (wrong password); they must not
 *  be treated as "session expired" or they would wipe a valid session. */
function isAuthEndpoint(input: RequestInfo | URL): boolean {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return url.includes("/api/auth/") || url.includes("/auth/");
}

export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = getStoredAuthToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401 && !isAuthEndpoint(input) && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("jarvis:unauthorized"));
  }
  return res;
}


export async function getHealth(): Promise<Health> {
  const r = await authFetch(`${API_BASE}/api/health`);
  if (!r.ok) throw new Error(`Health request failed: ${r.status}`);
  return r.json();
}

export async function getStats(): Promise<SystemStats> {
  const r = await authFetch(`${API_BASE}/api/stats`);
  return r.json();
}

export async function getProcesses(limit = 12) {
  const r = await authFetch(`${API_BASE}/api/processes?limit=${limit}`);
  return r.json();
}

export async function searchMemory(q: string) {
  const r = await authFetch(`${API_BASE}/api/memory/search?q=${encodeURIComponent(q)}`);
  return r.json();
}

export async function getAgents() {
  const r = await authFetch(`${API_BASE}/api/agents`);
  return r.json();
}

export async function getTools() {
  const r = await authFetch(`${API_BASE}/api/tools`);
  return r.json();
}

export async function getPlugins() {
  const r = await authFetch(`${API_BASE}/api/plugins`);
  return r.json();
}

export async function togglePlugin(name: string, enabled: boolean) {
  const r = await authFetch(`${API_BASE}/api/plugins/${name}/toggle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  return r.json();
}

export async function getMcpServers() {
  const r = await authFetch(`${API_BASE}/api/mcp/servers`);
  return r.json();
}

export async function getMcpPresets() {
  const r = await authFetch(`${API_BASE}/api/mcp/presets`);
  return r.json();
}

export async function connectMcpPreset(presetId: string, overrides?: Record<string, any>) {
  const r = await authFetch(`${API_BASE}/api/mcp/presets/${presetId}/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(overrides || {}),
  });
  return r.json();
}

export async function testMcpServer(name: string) {
  const r = await authFetch(`${API_BASE}/api/mcp/servers/${name}/test`, {
    method: "POST",
  });
  return r.json();
}

export async function testIntegration(type: "email" | "telegram" | "home_assistant" | "calendar", data?: Record<string, any>) {
  const r = await authFetch(`${API_BASE}/api/integrations/test/${type}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data || {}),
  });
  return r.json();
}

export async function getGithubPlatformDetails() {
  const r = await authFetch(`${API_BASE}/api/mcp/github/details`);
  return r.json();
}

export async function getSqlitePlatformDetails() {
  const r = await authFetch(`${API_BASE}/api/mcp/sqlite/details`);
  return r.json();
}

export async function executeSqliteQuery(db_name: string, query: string) {
  const r = await authFetch(`${API_BASE}/api/mcp/sqlite/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ db_name, query }),
  });
  return r.json();
}

export async function getFilesystemPlatformDetails() {
  const r = await authFetch(`${API_BASE}/api/mcp/filesystem/details`);
  return r.json();
}

export async function sendTestTelegramMessage(chat_id: string, text: string, bot_token?: string) {
  const r = await authFetch(`${API_BASE}/api/integrations/telegram/send_test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, text, bot_token }),
  });
  return r.json();
}

export async function sendTestEmail(params: {
  smtp_host?: string;
  smtp_port?: number;
  username?: string;
  password?: string;
  to_email?: string;
  subject?: string;
  body?: string;
}) {
  const r = await authFetch(`${API_BASE}/api/integrations/email/send_test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return r.json();
}

export async function getCalendarUpcomingEvents(ical_url?: string) {
  const q = ical_url ? `?ical_url=${encodeURIComponent(ical_url)}` : "";
  const r = await authFetch(`${API_BASE}/api/integrations/calendar/events${q}`);
  return r.json();
}

export async function getTelegramPlatformDetails() {
  const r = await authFetch(`${API_BASE}/api/integrations/telegram/details`);
  return r.json();
}

export async function getEmailPlatformDetails() {
  const r = await authFetch(`${API_BASE}/api/integrations/email/details`);
  return r.json();
}

export async function getYoutubePlatformDetails() {
  const r = await authFetch(`${API_BASE}/api/integrations/youtube/details`);
  return r.json();
}

export async function getFacebookPlatformDetails() {
  const r = await authFetch(`${API_BASE}/api/integrations/facebook/details`);
  return r.json();
}

export async function getInstagramPlatformDetails() {
  const r = await authFetch(`${API_BASE}/api/integrations/instagram/details`);
  return r.json();
}

export async function getTikTokPlatformDetails() {
  const r = await authFetch(`${API_BASE}/api/integrations/tiktok/details`);
  return r.json();
}

export async function saveInstagramConfig(data: { access_token?: string; user_id?: string; enabled?: boolean }) {
  const r = await authFetch(`${API_BASE}/api/integrations/instagram`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return r.json();
}

export async function saveYoutubeConfig(data: { channel_id?: string; client_id?: string; client_secret?: string; refresh_token?: string; api_key?: string; enabled?: boolean }) {
  const r = await authFetch(`${API_BASE}/api/integrations/youtube`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return r.json();
}

export async function saveFacebookConfig(data: { page_id?: string; page_access_token?: string; enabled?: boolean }) {
  const r = await authFetch(`${API_BASE}/api/integrations/facebook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return r.json();
}

export async function saveTikTokConfig(data: { client_key?: string; client_secret?: string; access_token?: string; open_id?: string; enabled?: boolean }) {
  const r = await authFetch(`${API_BASE}/api/integrations/tiktok`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return r.json();
}

export async function getAllIntegrationCredentials() {
  const r = await authFetch(`${API_BASE}/api/integrations/credentials`);
  return r.json();
}

export async function autoDetectYoutubeChannel() {
  const r = await authFetch(`${API_BASE}/api/integrations/youtube/auto-detect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  return r.json();
}

// ─── Authentication ───
export interface AuthStatus {
  auth_configured: boolean;
  authenticated: boolean;
  session_info?: {
    created_at: number;
    last_seen: number;
  };
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const r = await authFetch(`${API_BASE}/api/auth/status`);
  return r.json();
}

export interface LoginResponse {
  ok: boolean;
  token?: string;
  expires_in?: number;
  error?: string;
  attempts_remaining?: number;
}

export async function authLogin(password: string): Promise<LoginResponse> {
  const r = await authFetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  return r.json();
}

export async function authLogout(token: string): Promise<{ ok: boolean }> {
  const r = await authFetch(`${API_BASE}/api/auth/logout`, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
  });
  return r.json();
}

export async function authRevokeAll(token: string): Promise<{ ok: boolean; revoked_sessions: number }> {
  const r = await authFetch(`${API_BASE}/api/auth/revoke-all`, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
  });
  return r.json();
}

export async function authSetPassword(password: string, confirm: string): Promise<{ ok: boolean; message?: string; error?: string; token?: string }> {
  const r = await authFetch(`${API_BASE}/api/auth/set-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, confirm }),
  });
  return r.json();
}

export async function getYoutubeSchedulerStatus() {
  const r = await authFetch(`${API_BASE}/api/github_deepdive/scheduler`);
  return r.json();
}

export async function toggleYoutubeScheduler(enabled: boolean, auto_upload: boolean = true) {
  const r = await authFetch(`${API_BASE}/api/github_deepdive/scheduler/toggle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled, auto_upload }),
  });
  return r.json();
}

export async function getYoutubeStrategy() {
  const r = await authFetch(`${API_BASE}/api/integrations/youtube/strategy`);
  return r.json();
}

export async function produceYoutubeVideo(repo_name: string = "vllm-project/vllm", auto_upload: boolean = true) {
  const r = await authFetch(`${API_BASE}/api/integrations/youtube/produce`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo_name, auto_upload }),
  });
  return r.json();
}

export async function getYoutubeGrowthStatus() {
  const r = await authFetch(`${API_BASE}/api/youtube/growth/status`);
  return r.json();
}

export async function toggleYoutubeGrowth(enabled: boolean) {
  const r = await authFetch(`${API_BASE}/api/youtube/growth/toggle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  return r.json();
}

export async function setYoutubeGrowthAutoProduce(auto_produce: boolean) {
  const r = await authFetch(`${API_BASE}/api/youtube/growth/autoproduce`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ auto_produce }),
  });
  return r.json();
}

export async function triggerYoutubeGrowth(force_produce: boolean = false) {
  const r = await authFetch(`${API_BASE}/api/youtube/growth/trigger`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force_produce }),
  });
  return r.json();
}

export async function getYoutubeGrowthDecisions() {
  const r = await authFetch(`${API_BASE}/api/youtube/growth/decisions`);
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
  const r = await authFetch(`${API_BASE}/api/mcp/servers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return r.json();
}

export async function toggleMcpServer(name: string, enabled: boolean) {
  const r = await authFetch(`${API_BASE}/api/mcp/servers/${name}/toggle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  return r.json();
}

export async function deleteMcpServer(name: string) {
  const r = await authFetch(`${API_BASE}/api/mcp/servers/${name}`, {
    method: "DELETE",
  });
  return r.json();
}

export async function cleanSlate() {
  const r = await authFetch(`${API_BASE}/api/cleanslate`, { method: "POST" });
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
  const r = await authFetch(`${API_BASE}/api/image-models`);
  return r.json();
}

export async function selectImageModel(model: string): Promise<{ ok: boolean; selected?: string; error?: string }> {
  const r = await authFetch(`${API_BASE}/api/image-models/select`, {
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
  const r = await authFetch(`${API_BASE}/api/upload`, { method: "POST", body: form });
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
  const r = await authFetch(`${API_BASE}/api/analyze-image`, { method: "POST", body: form });
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
  const r = await authFetch(`${API_BASE}/api/image-to-3d`, { method: "POST", body: form });
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
  const r = await authFetch(`${API_BASE}/api/img2img`, { method: "POST", body: form });
  return r.json();
}

export interface CyberLabStatus {
  services?: Record<string, { healthy?: boolean; message?: string }>;
  monitoring_active?: boolean;
  last_health_check?: string | null;
  operations?: {
    available?: boolean;
    ops_by_status?: Record<string, number>;
    ops_total?: number;
    recent_ops?: { id: string; kind: string; status: string; triggered_by: string; created_at: string }[];
    findings_total?: number;
    findings_24h?: number;
    stale_queued?: number;
    latest_finding_at?: string | null;
    recent_findings?: { id: string; severity: string; title: string; status: string; target_url: string }[];
  };
}

export async function getCyberLabStatus(): Promise<CyberLabStatus | null> {
  try {
    const r = await authFetch(`${API_BASE}/api/cyberlab/status`);
    if (!r.ok) return null;
    return (await r.json()) as CyberLabStatus;
  } catch {
    return null;
  }
}

// ─── Dependency Graph ───
export interface GraphNode {
  id: string;
  type: "agent" | "tool" | "plugin" | "mcp_server";
  label: string;
  description?: string;
  [key: string]: any;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
}

export interface GraphResponse {
  ok: boolean;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    agents: number;
    tools: number;
    plugins: number;
    mcp_servers: number;
    total_edges: number;
  };
}

export async function getDependencyGraph(): Promise<GraphResponse> {
  const r = await authFetch(`${API_BASE}/api/graph`);
  return r.json();
}

// ─── Project File API (editor) ───
// Every route is confined server-side to cfg.project_root; relative paths are
// resolved against it, so the client always speaks in project-relative paths.

export interface ProjectEntry {
  path: string;
  name: string;
  size: number;
  mtime: number;
  type: "file" | "dir";
}

export interface ProjectListing {
  ok: boolean;
  path: string;
  entries: ProjectEntry[];
}

export interface ProjectFileMeta {
  ok: boolean;
  path: string;
  name: string;
  size: number;
  mtime: number;
}

export interface ProjectFile extends ProjectFileMeta {
  content: string;
}

/** Raise a readable Error from a non-2xx JSON response. */
async function readApiError(r: Response): Promise<never> {
  let message = `HTTP ${r.status}`;
  try {
    const body = await r.json();
    if (body && typeof body.error === "string") message = body.error;
  } catch {
    /* non-JSON error body — keep the status code */
  }
  throw new Error(message);
}

export async function listProjectFiles(path = "."): Promise<ProjectListing> {
  const r = await authFetch(
    `${API_BASE}/api/files/list?path=${encodeURIComponent(path)}`
  );
  if (!r.ok) await readApiError(r);
  return r.json();
}

export async function readProjectFile(path: string): Promise<ProjectFile> {
  const r = await authFetch(
    `${API_BASE}/api/files/read?path=${encodeURIComponent(path)}`
  );
  if (!r.ok) await readApiError(r);
  return r.json();
}

export async function writeProjectFile(
  path: string,
  content: string,
  createBackup = true
): Promise<ProjectFileMeta & { bytes_written: number; backup: string | null }> {
  const r = await authFetch(`${API_BASE}/api/files/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content, create_backup: createBackup }),
  });
  if (!r.ok) await readApiError(r);
  return r.json();
}

export async function createProjectEntry(
  path: string,
  directory = false,
  content = ""
): Promise<ProjectFileMeta & { type: "file" | "dir" }> {
  const r = await authFetch(`${API_BASE}/api/files/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, directory, content }),
  });
  if (!r.ok) await readApiError(r);
  return r.json();
}

export async function deleteProjectEntry(
  path: string
): Promise<{ ok: boolean; path: string; backup: string | null }> {
  const r = await authFetch(
    `${API_BASE}/api/files/delete?path=${encodeURIComponent(path)}`,
  );
  if (!r.ok) await readApiError(r);
  return r.json();
}

// ─── Model Cascade & Key Management ───
export interface CascadeInfo {
  ok: boolean;
  online: boolean;
  tiers: { name: string; provider: string; model: string; is_local: boolean; timeout: number; ttft_timeout: number }[];
}

export async function getCascadeStatus(): Promise<CascadeInfo> {
  const r = await authFetch(`${API_BASE}/api/models/cascade`);
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
  ok: boolean;
  keys: Record<string, KeyPoolItem[]>;
  api_keys: Record<string, boolean>;
}

export async function getKeysStatus(): Promise<KeysStatus> {
  const r = await authFetch(`${API_BASE}/api/keys`);
  return r.json();
}

// ─── Model verification + MCP logs (FG-006 / FG-010, ported from ui) ────────
// These are the only two wrappers the ui-hud-upgrade api.ts had that
// audit/fixes lacked. Ported with authFetch (not ui's plain fetch) so the
// calls carry the auth token like every other wrapper in this file.
// Endpoint check: GET /api/models/verified is confirmed by the backend-port
// tests (work/tests/test_admin_endpoints.py: test_models_verified_* —
// /api/models/verified, /api/models/cascade, /api/keys, /api/config,
// /api/council/*, /api/swarm/* all exist on the merged backend).
// GET /api/mcp/servers/{name}/logs has NO backend route on any branch yet
// (settings-gap-fix.md); callers must treat failure as "not available".

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
  const r = await authFetch(`${API_BASE}/api/models/verified${q}`);
  return r.json();
}

/** FG-010 — fetch one MCP server's logs (GET /api/mcp/servers/{name}/logs). */
export async function getMcpServerLogs(name: string) {
  const r = await authFetch(`${API_BASE}/api/mcp/servers/${encodeURIComponent(name)}/logs`);
  return r.json();
}

// ─── Vault API (OS Keyring + Credentials) ───

export interface VaultStatus {
  ok: boolean;
  keyring_available: boolean;
  keyring_status: string;
  storage_mode: "keyring" | "encrypted_file";
  stored_keys_count: number;
}

export interface VaultCredentialItem {
  service: string;
  key: string;
  masked: string;
  length: number;
}

export async function getVaultStatus(): Promise<VaultStatus> {
  const r = await authFetch(`${API_BASE}/api/vault/status`);
  if (!r.ok) await readApiError(r);
  return r.json();
}

export async function getVaultCredentials(service = ""): Promise<{ ok: boolean; credentials: VaultCredentialItem[] }> {
  const url = service
    ? `${API_BASE}/api/vault/credentials?service=${encodeURIComponent(service)}`
    : `${API_BASE}/api/vault/credentials`;
  const r = await authFetch(url);
  if (!r.ok) await readApiError(r);
  return r.json();
}

export async function setVaultCredential(
  service: string,
  key: string,
  value: string
): Promise<{ ok: boolean; service: string; key: string }> {
  const r = await authFetch(`${API_BASE}/api/vault/set`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ service, key, value }),
  });
  if (!r.ok) await readApiError(r);
  return r.json();
}

export async function deleteVaultCredential(
  service: string,
  key: string
): Promise<{ ok: boolean; service: string; key: string }> {
  const r = await authFetch(
    `${API_BASE}/api/vault/delete?service=${encodeURIComponent(service)}&key=${encodeURIComponent(key)}`,
    { method: "DELETE" }
  );
  if (!r.ok) await readApiError(r);
  return r.json();
}

export async function migrateVault(): Promise<{ ok: boolean; migrated_count: number }> {
  const r = await authFetch(`${API_BASE}/api/vault/migrate`, { method: "POST" });
  if (!r.ok) await readApiError(r);
  return r.json();
}
