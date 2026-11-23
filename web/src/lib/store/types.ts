/** Shared state types for the zustand store (Phase 2 split of lib/store.ts). */
export type OrbState = "idle" | "listening" | "thinking" | "speaking";

export type ChatRole = "user" | "assistant" | "info" | "error";

export interface ChatAttachment {
  type: "image" | "file";
  name: string;
  data_url?: string;  // for images, inline base64
  url?: string;       // for files, server URL
  size?: number;
  mime?: string;
}

export interface ChatEntry {
  id: string;
  role: ChatRole;
  text: string;
  ts: number;
  streaming?: boolean;    // true while tokens still arriving
  attachments?: ChatAttachment[];
}

export interface ToolCall {
  id: string;
  tool: string;
  permission: "safe" | "caution" | "dangerous";
  preview: string;
  args: Record<string, unknown>;
  status: "proposed" | "running" | "ok" | "fail" | "denied";
  result?: string;
  duration_s?: number;
  ts: number;
}

export interface ConfirmRequest {
  id: string;
  tool: string;
  permission: "safe" | "caution" | "dangerous";
  preview: string;
  args: Record<string, unknown>;
}

export interface SystemStats {
  cpu: number;
  cpu_count: number;
  ram: { percent: number; used_gb: number; total_gb: number };
  disk: { percent: number; used_gb: number; total_gb: number };
  net: { sent_mb: number; recv_mb: number };
  os: { system: string; release: string; node: string };
  gpu?: {
    available: boolean;
    name?: string;
    load_percent?: number;
    mem_percent?: number;
    mem_used_gb?: number;
    mem_total_gb?: number;
    temp_c?: number | null;
  };
  battery?: { percent: number; plugged: boolean };
}

export interface Health {
  status: string;
  name: string;
  model: { provider: string; model: string; endpoint: string; configured: boolean };
  image_model?: string;
  plugins: string[];
  tools: number;
  agents: string[];
  permission_mode: string;
  voice?: { wake_word: string };
}

export interface VoiceProfile {
  name: string;
  lang: string;
  tier: "cinematic" | "british" | "fallback" | "offline";
}

export type MediaKind = "search" | "news" | "image" | "images" | "video" | "videos" | "page" | "pdf" | "webcam" | "galaxy" | "model3d";

export interface SwarmSubtask {
  id: string;
  label: string;
  tool?: string;
  status: "pending" | "running" | "ok" | "fail";
  preview?: string;
  result?: string;
  startedAt: number;
  endedAt?: number;
}

export interface SwarmRun {
  id: string;
  tasks: SwarmSubtask[];
  ts: number;
  active: boolean;
}

export interface PlanState {
  text: string;
  steps: string[];
  done: number;       // steps visually checked off so far
  complete: boolean;  // turn finished — all steps resolved
  ts: number;
}

export interface MediaItem {
  url: string;
  title?: string;
  snippet?: string;
  thumbnail?: string;
  source?: string;
  // Video-specific
  embed_url?: string;
  video_id?: string;
  channel?: string;
  duration?: string;
  published?: string;
  views?: string;
  // Image-specific
  width?: number;
  height?: number;
  host?: string;
}

export interface GalaxyNode {
  id: string;
  category: string;
  color: string;
  title: string;
  body: string;
  ts?: number;
  anchor: [number, number, number];
}

export interface GalaxyCluster {
  name: string;
  color: string;
  count: number;
  anchor: [number, number, number];
}

export interface MediaCard {
  id: string;
  kind: MediaKind;
  items: MediaItem[];
  summary: string;
  tool?: string;
  query?: string;
  ts: number;
  pinned?: boolean;
  // For "page" kind a single expanded item is rendered as iframe
  expanded?: number | null;
  // Galaxy-specific payload (only present when kind === "galaxy")
  galaxy?: { nodes: GalaxyNode[]; clusters: GalaxyCluster[] };
}

export interface HoloSceneState {
  active: boolean;
  mode: "anatomy3d" | "blueprint" | "edu";
  modelId: string; // "cpu" | "neural" | "reactor"
  explodeLevel: number; // 0 to 100
  targetExplodeLevel: number;
  selectedLayerId: string | null;
  isolated: boolean;
  wireframe: boolean;
  autoRotate: boolean;
  rotation: { x: number; y: number };
  eduLessonId: string;
  eduStepIdx: number;
  eduIsPlaying: boolean;
  activeNodeId: string | null;
  holographicReason: string | null;
}

export type SkinName = "reactor" | "neural" | "plasma" | "wave" | "holo";

export interface Skin {
  name: string;
  ar: string;
  accent: string;
  accent2: string;
  core: string;
  radius: string;
  brk: number;
}

export const SKINS: Record<SkinName, Skin> = {
  reactor: { name: "Reactor", ar: "المفاعل", accent: "#22D3EE", accent2: "#FBBF24", core: "rings", radius: "6px", brk: 1 },
  neural:  { name: "Neural",  ar: "عصبي",   accent: "#A78BFA", accent2: "#F0ABFC", core: "galaxy", radius: "18px", brk: 0 },
  plasma:  { name: "Plasma",  ar: "بلازما", accent: "#FB923C", accent2: "#F472B6", core: "blob", radius: "26px", brk: 0 },
  wave:    { name: "Wave",    ar: "موجة",   accent: "#34D399", accent2: "#67E8F9", core: "ribbon", radius: "10px", brk: 0 },
  holo:    { name: "Holo",    ar: "هولو",   accent: "#BAE6FD", accent2: "#60A5FA", core: "globe", radius: "0px", brk: 1 },
};
