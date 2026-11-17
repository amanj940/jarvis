import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

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

interface StoreState {
  // connection
  connected: boolean;
  setConnected: (v: boolean) => void;
  // boot
  booted: boolean;
  setBooted: (v: boolean) => void;
  // orb
  orbState: OrbState;
  setOrb: (s: OrbState) => void;
  audioLevel: number; // Microphone input amplitude (0..1)
  setAudioLevel: (v: number) => void;
  speakerAudioLevel: number; // Assistant output playback amplitude (0..1)
  setSpeakerAudioLevel: (v: number) => void;
  // skin
  skin: SkinName;
  setSkin: (s: SkinName) => void;
  // chat
  chat: ChatEntry[];
  pushChat: (e: ChatEntry) => void;
  clearChat: () => void;
  appendChatText: (id: string, piece: string) => void;
  finalizeChat: (id: string, text?: string) => void;
  updateChat: (id: string, text: string) => void;
  // pending attachments (drag-dropped, waiting to send with next message)
  pendingAttachments: ChatAttachment[];
  addAttachment: (a: ChatAttachment) => void;
  removeAttachment: (idx: number) => void;
  clearAttachments: () => void;
  // tools
  tools: ToolCall[];
  pushTool: (t: ToolCall) => void;
  updateTool: (id: string, patch: Partial<ToolCall>) => void;
  clearTools: () => void;
  // confirm
  confirmQueue: ConfirmRequest[];
  pushConfirm: (c: ConfirmRequest) => void;
  popConfirm: (id: string) => void;
  // stats
  stats: SystemStats | null;
  setStats: (s: SystemStats) => void;
  // health
  health: Health | null;
  setHealth: (h: Health) => void;
  // voice
  voiceEnabled: boolean;
  setVoiceEnabled: (v: boolean) => void;
  // Full-duplex barge-in: let the user cut JARVIS off mid-sentence by talking.
  bargeIn: boolean;
  setBargeIn: (v: boolean) => void;
  voiceProfile: VoiceProfile | null;
  setVoiceProfile: (v: VoiceProfile | null) => void;
  micEnabled: boolean;
  setMicEnabled: (v: boolean) => void;
  micStatus: string;
  setMicStatus: (v: string) => void;
  // "dormant" : require wake word
  // "armed"   : follow-up window — anything you say submits
  // "speaking": JARVIS is talking, mic paused
  // "live"    : continuous live voice assistant (Gemini Live style)
  micMode: "dormant" | "armed" | "speaking" | "live";
  setMicMode: (v: StoreState["micMode"]) => void;
  liveVoice: boolean;
  setLiveVoice: (v: boolean) => void;
  wakeEnabled: boolean;
  setWakeEnabled: (v: boolean) => void;
  // Media Bay
  media: MediaCard[];
  pushMedia: (c: MediaCard) => void;
  removeMedia: (id: string) => void;
  pinMedia: (id: string, pinned: boolean) => void;
  expandMedia: (id: string, idx: number | null) => void;
  clearMedia: () => void;
  // Active fullscreen viewer item (image / video lightbox)
  lightbox: { kind: MediaKind; item: MediaItem } | null;
  setLightbox: (v: StoreState["lightbox"]) => void;
  // URL currently displayed in the themed in-app article reader.
  reader: string | null;
  setReader: (url: string | null) => void;
  // When true, the reader renders inside a draggable Floating panel
  // instead of the modal overlay. Toggled from the reader header.
  readerPinned: boolean;
  setReaderPinned: (v: boolean) => void;
  // Active multi-agent swarm runs (parallel_tasks fan-out).
  swarms: SwarmRun[];
  startSwarm: (run: SwarmRun) => void;
  updateSwarmTask: (runId: string, taskId: string, patch: Partial<SwarmSubtask>) => void;
  finishSwarm: (runId: string) => void;
  dismissSwarm: (runId: string) => void;
  // Autonomous plan for the current complex task (renders as a live checklist).
  plan: PlanState | null;
  setPlan: (p: { text: string; steps: string[] }) => void;
  advancePlan: () => void;
  completePlan: () => void;
  clearPlan: () => void;
  // Proactive next-step suggestions (clickable chips after a turn).
  suggestions: string[];
  setSuggestions: (items: string[]) => void;
  clearSuggestions: () => void;
  terminalOpen: boolean;
  setTerminalOpen: (v: boolean) => void;
  // Shell mode: "living" minimal AI entity, "full" full HUD, "widget" compact side-panel, "holo" holographic studio
  shellMode: "living" | "full" | "widget" | "holo";
  setShellMode: (m: StoreState["shellMode"]) => void;
  // Previous session: on a cold launch (reboot / app relaunch) the prior
  // chat/media/tools/swarms are stashed instead of auto-reopening. Restore is
  // on-demand only. Backend/semantic memory is unaffected.
  prevSessionAvailable: boolean;
  restoreLastSession: () => void;
  dismissLastSession: () => void;
  // Settings modal navigation
  settingsOpen: boolean;
  settingsTab: string;
  openSettings: (tab?: string) => void;
  closeSettings: () => void;
  // Projects workspace modal
  projectsOpen: boolean;
  openProjects: () => void;
  closeProjects: () => void;
  // Autonomous Holographic Stage
  holoState: HoloSceneState;
  openHolo: (opts?: Partial<HoloSceneState>) => void;
  dismissHolo: (reason?: string) => void;
  setHoloExplode: (level: number) => void;
  setHoloTargetExplode: (level: number) => void;
  isolateHoloLayer: (layerId: string | null) => void;
  setHoloRotation: (r: { x: number; y: number }) => void;
  setHoloAutoRotate: (v: boolean) => void;
  setHoloWireframe: (v: boolean) => void;
  setHoloEduStep: (step: number) => void;
  setHoloEduPlaying: (v: boolean) => void;
  setHoloModel: (modelId: string) => void;
  setHoloMode: (mode: "anatomy3d" | "blueprint" | "edu") => void;
  setHoloBlueprintNode: (nodeId: string | null) => void;
  // Holo-Engineering Monitor (backward-compatible aliases)
  monitorOpen: boolean;
  monitorMode: "anatomy3d" | "blueprint" | "edu";
  selectedAnatomyModel: string;
  selectedEduLesson: string;
  openMonitor: (mode?: "anatomy3d" | "blueprint" | "edu", modelOrLesson?: string) => void;
  closeMonitor: () => void;
  setMonitorMode: (mode: "anatomy3d" | "blueprint" | "edu") => void;
  setSelectedAnatomyModel: (model: string) => void;
  setSelectedEduLesson: (lesson: string) => void;
}

let _id = 0;
export const nextId = () => `${Date.now().toString(36)}-${(_id++).toString(36)}`;

const BOOT_GREETING_RE =
  /^Good (morning|afternoon|evening), sir\. All systems are online and at your service\.$/;

function isBootGreeting(entry: ChatEntry) {
  return entry.role === "assistant" && BOOT_GREETING_RE.test(entry.text.trim());
}

function cleanupChatHistory(chat: ChatEntry[]) {
  let seenBoot = false;
  let lastOnlineIdx = -1;
  for (let i = chat.length - 1; i >= 0; i--) {
    if (chat[i].role === "info" && chat[i].text.includes("online —")) {
      lastOnlineIdx = i;
      break;
    }
  }
  return chat.filter((entry, idx) => {
    if (isBootGreeting(entry)) {
      if (seenBoot) return false;
      seenBoot = true;
      return true;
    }
    if (entry.role === "info" && entry.text.includes("online —")) {
      return idx === lastOnlineIdx;
    }
    return true;
  });
}

// Session archive. On a cold launch — reboot or app relaunch — the previous
// session is stashed under PREV_SESSION_KEY instead of auto-reopening. We tell
// a cold launch from an in-app reload via SESSION_ALIVE_KEY: sessionStorage is
// wiped when the renderer process dies (quit / reboot) but survives a reload.
const PREV_SESSION_KEY = "jarvis.session.prev.v1";
const SESSION_ALIVE_KEY = "jarvis.session.alive";

export const useStore = create<StoreState>()(persist((set) => ({
  connected: false,
  setConnected: (v) => set({ connected: v }),
  booted: false,
  setBooted: (v) => set({ booted: v }),
  orbState: "idle",
  setOrb: (s) => set({ orbState: s }),
  audioLevel: 0,
  setAudioLevel: (v) => set({ audioLevel: v }),
  speakerAudioLevel: 0,
  setSpeakerAudioLevel: (v) => set({ speakerAudioLevel: v }),
  skin: "reactor",
  setSkin: (s) => set({ skin: s }),
  chat: [],
  pushChat: (e) =>
    set((st) => {
      if (isBootGreeting(e) && st.chat.some(isBootGreeting)) return {};
      // Deduplicate "online —" status banners: replace previous online banner with latest
      if (e.role === "info" && e.text.includes("online —")) {
        const filtered = st.chat.filter((c) => !(c.role === "info" && c.text.includes("online —")));
        return { chat: [...filtered, e].slice(-400) };
      }
      // Deduplicate consecutive identical info or error messages
      const last = st.chat[st.chat.length - 1];
      if (last && last.role === e.role && last.text === e.text && (e.role === "info" || e.role === "error")) {
        return {};
      }
      return { chat: [...st.chat, e].slice(-400) };
    }),
  clearChat: () => set({ chat: [] }),
  appendChatText: (id, piece) =>
    set((st) => ({
      chat: st.chat.map((c) => (c.id === id ? { ...c, text: c.text + piece } : c)),
    })),
  finalizeChat: (id, text) =>
    set((st) => ({
      chat: st.chat.map((c) =>
        c.id === id ? { ...c, streaming: false, text: text ?? c.text } : c,
      ),
    })),
  updateChat: (id, text) =>
    set((st) => ({
      chat: st.chat.map((c) => (c.id === id ? { ...c, text } : c)),
    })),
  pendingAttachments: [],
  addAttachment: (a) => set((st) => ({ pendingAttachments: [...st.pendingAttachments, a] })),
  removeAttachment: (idx) =>
    set((st) => ({ pendingAttachments: st.pendingAttachments.filter((_, i) => i !== idx) })),
  clearAttachments: () => set({ pendingAttachments: [] }),
  tools: [],
  pushTool: (t) => set((st) => ({ tools: [...st.tools, t].slice(-60) })),
  updateTool: (id, patch) =>
    set((st) => ({ tools: st.tools.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  clearTools: () => set({ tools: [] }),
  confirmQueue: [],
  pushConfirm: (c) => set((st) => ({ confirmQueue: [...st.confirmQueue, c] })),
  popConfirm: (id) => set((st) => ({ confirmQueue: st.confirmQueue.filter((x) => x.id !== id) })),
  stats: null,
  setStats: (s) => set({ stats: s }),
  health: null,
  setHealth: (h) => set({ health: h }),
  voiceEnabled: true,
  setVoiceEnabled: (v) => set({ voiceEnabled: v }),
  bargeIn: true,
  setBargeIn: (v) => set({ bargeIn: v }),
  voiceProfile: null,
  setVoiceProfile: (v) => set({ voiceProfile: v }),
  micEnabled: false,
  setMicEnabled: (v) => set({ micEnabled: v }),
  micStatus: "",
  setMicStatus: (v) => set({ micStatus: v }),
  micMode: "dormant",
  setMicMode: (v) => set({ micMode: v }),
  liveVoice: false,
  setLiveVoice: (v) => set({ liveVoice: v }),
  wakeEnabled: false,
  setWakeEnabled: (v) => set({ wakeEnabled: v }),
  media: [],
  pushMedia: (c) =>
    set((st) => {
      // Check if a card of the same kind (e.g., "image") already exists and is not pinned.
      // If so, we append the items to that existing card instead of creating a new one.
      const existingIdx = st.media.findIndex(m => m.kind === c.kind && !m.pinned);
      
      if (existingIdx !== -1) {
        const next = [...st.media];
        const existingCard = next[existingIdx];
        next[existingIdx] = {
          ...existingCard,
          items: [...existingCard.items, ...c.items],
          ts: Date.now(), // Update timestamp to bring it to top
          summary: c.summary // Update summary to the latest request
        };
        
        // Limit to 30 cards
        if (next.length > 30) {
          const trimmed: MediaCard[] = [];
          let removed = 0;
          for (const m of next) {
            if (!m.pinned && removed < next.length - 30) { removed++; continue; }
            trimmed.push(m);
          }
          return { media: trimmed };
        }
        return { media: next };
      }

      // Standard push if no matching unpinned card found
      const next = [...st.media, c];
      if (next.length > 30) {
        const cutoff = next.length - 30;
        const trimmed: MediaCard[] = [];
        let removed = 0;
        for (const m of next) {
          if (!m.pinned && removed < cutoff) { removed++; continue; }
          trimmed.push(m);
        }
        return { media: trimmed };
      }
      return { media: next };
    }),
  removeMedia: (id) => set((st) => ({ media: st.media.filter((m) => m.id !== id) })),
  pinMedia: (id, pinned) =>
    set((st) => ({ media: st.media.map((m) => (m.id === id ? { ...m, pinned } : m)) })),
  expandMedia: (id, idx) =>
    set((st) => ({ media: st.media.map((m) => (m.id === id ? { ...m, expanded: idx } : m)) })),
  clearMedia: () => set({ media: [] }),
  shellMode: "living",
  setShellMode: () => {
    try { localStorage.setItem("jarvis.shellMode", "living"); } catch { /* noop */ }
    set({ shellMode: "living" });
  },
  lightbox: null,
  setLightbox: (v) => set({ lightbox: v }),
  reader: null,
  setReader: (url) => set({ reader: url }),
  readerPinned: false,
  setReaderPinned: (v) => set({ readerPinned: v }),
  swarms: [],
  startSwarm: (run) => set((st) => ({ swarms: [...st.swarms, run].slice(-6) })),
  updateSwarmTask: (runId, taskId, patch) =>
    set((st) => ({
      swarms: st.swarms.map((r) =>
        r.id !== runId
          ? r
          : { ...r, tasks: r.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) },
      ),
    })),
  finishSwarm: (runId) =>
    set((st) => ({
      swarms: st.swarms.map((r) => (r.id === runId ? { ...r, active: false } : r)),
    })),
  dismissSwarm: (runId) =>
    set((st) => ({ swarms: st.swarms.filter((r) => r.id !== runId) })),
  plan: null,
  setPlan: ({ text, steps }) =>
    set({ plan: { text, steps, done: 0, complete: false, ts: Date.now() } }),
  advancePlan: () =>
    set((st) =>
      st.plan && !st.plan.complete
        ? { plan: { ...st.plan, done: Math.min(st.plan.done + 1, st.plan.steps.length) } }
        : {},
    ),
  completePlan: () =>
    set((st) =>
      st.plan
        ? { plan: { ...st.plan, complete: true, done: st.plan.steps.length } }
        : {},
    ),
  clearPlan: () => set({ plan: null }),
  suggestions: [],
  setSuggestions: (items) => set({ suggestions: items.slice(0, 3) }),
  clearSuggestions: () => set({ suggestions: [] }),
  terminalOpen: false,
  setTerminalOpen: (v) => set({ terminalOpen: v }),
  prevSessionAvailable: false,
  restoreLastSession: () => {
    try {
      const raw = localStorage.getItem(PREV_SESSION_KEY);
      if (!raw) { set({ prevSessionAvailable: false }); return; }
      const prev = JSON.parse(raw);
      set({
        chat:   cleanupChatHistory((prev.chat || []).map((c: ChatEntry) => ({ ...c, streaming: false }))),
        media:  prev.media  || [],
        tools:  prev.tools  || [],
        swarms: (prev.swarms || []).map((s: SwarmRun) => ({ ...s, active: false })),
        prevSessionAvailable: false,
      });
      localStorage.removeItem(PREV_SESSION_KEY);
    } catch { set({ prevSessionAvailable: false }); }
  },
  dismissLastSession: () => {
    try { localStorage.removeItem(PREV_SESSION_KEY); } catch { /* noop */ }
    set({ prevSessionAvailable: false });
  },
  settingsOpen: false,
  settingsTab: "ai",
  openSettings: (tab = "ai") => set({ settingsOpen: true, settingsTab: tab }),
  closeSettings: () => set({ settingsOpen: false }),
  projectsOpen: false,
  openProjects: () => set({ projectsOpen: true }),
  closeProjects: () => set({ projectsOpen: false }),
  holoState: {
    active: false,
    mode: "anatomy3d",
    modelId: "cpu",
    explodeLevel: 45,
    targetExplodeLevel: 45,
    selectedLayerId: null,
    isolated: false,
    wireframe: false,
    autoRotate: true,
    rotation: { x: 22, y: -35 },
    eduLessonId: "cpu_pipeline",
    eduStepIdx: 0,
    eduIsPlaying: false,
    activeNodeId: "input",
    holographicReason: null,
  },
  openHolo: (opts) => set((s) => {
    const nextMode = opts?.mode || s.holoState.mode;
    const nextModel = opts?.modelId || s.holoState.modelId;
    const nextLesson = opts?.eduLessonId || s.holoState.eduLessonId;
    const nextExplode = opts?.explodeLevel ?? s.holoState.explodeLevel;
    return {
      holoState: {
        ...s.holoState,
        ...opts,
        active: true,
        mode: nextMode,
        modelId: nextModel,
        eduLessonId: nextLesson,
        explodeLevel: nextExplode,
        targetExplodeLevel: nextExplode,
      },
      monitorOpen: false,
      monitorMode: nextMode,
      selectedAnatomyModel: nextModel,
      selectedEduLesson: nextLesson,
    };
  }),
  dismissHolo: (reason) => set((s) => ({
    holoState: { ...s.holoState, active: false, holographicReason: reason || null, isolated: false },
    monitorOpen: false,
  })),
  setHoloExplode: (level) => set((s) => ({
    holoState: { ...s.holoState, explodeLevel: Math.max(0, Math.min(100, level)), targetExplodeLevel: Math.max(0, Math.min(100, level)) },
  })),
  setHoloTargetExplode: (level) => set((s) => ({
    holoState: { ...s.holoState, targetExplodeLevel: Math.max(0, Math.min(100, level)) },
  })),
  isolateHoloLayer: (layerId) => set((s) => ({
    holoState: { ...s.holoState, selectedLayerId: layerId, isolated: !!layerId },
  })),
  setHoloRotation: (r) => set((s) => ({
    holoState: { ...s.holoState, rotation: r },
  })),
  setHoloAutoRotate: (v) => set((s) => ({
    holoState: { ...s.holoState, autoRotate: v },
  })),
  setHoloWireframe: (v) => set((s) => ({
    holoState: { ...s.holoState, wireframe: v },
  })),
  setHoloEduStep: (idx) => set((s) => ({
    holoState: { ...s.holoState, eduStepIdx: idx },
  })),
  setHoloEduPlaying: (v) => set((s) => ({
    holoState: { ...s.holoState, eduIsPlaying: v },
  })),
  setHoloModel: (modelId) => set((s) => ({
    holoState: { ...s.holoState, modelId, selectedLayerId: null, isolated: false },
    selectedAnatomyModel: modelId,
  })),
  setHoloMode: (mode) => set((s) => ({
    holoState: { ...s.holoState, mode },
    monitorMode: mode,
  })),
  setHoloBlueprintNode: (nodeId) => set((s) => ({
    holoState: { ...s.holoState, activeNodeId: nodeId },
  })),
  monitorOpen: false,
  monitorMode: "anatomy3d",
  selectedAnatomyModel: "cpu",
  selectedEduLesson: "cpu_pipeline",
  openMonitor: (mode = "anatomy3d", modelOrLesson?: string) => set((s) => ({
    monitorOpen: true,
    monitorMode: mode,
    selectedAnatomyModel: mode === "anatomy3d" && modelOrLesson ? modelOrLesson : s.selectedAnatomyModel,
    selectedEduLesson: mode === "edu" && modelOrLesson ? modelOrLesson : s.selectedEduLesson,
    holoState: {
      ...s.holoState,
      active: true,
      mode,
      modelId: mode === "anatomy3d" && modelOrLesson ? modelOrLesson : s.holoState.modelId,
      eduLessonId: mode === "edu" && modelOrLesson ? modelOrLesson : s.holoState.eduLessonId,
    },
  })),
  closeMonitor: () => set((s) => ({
    monitorOpen: false,
    holoState: { ...s.holoState, active: false, isolated: false },
  })),
  setMonitorMode: (mode) => set((s) => ({
    monitorMode: mode,
    holoState: { ...s.holoState, mode },
  })),
  setSelectedAnatomyModel: (m) => set((s) => ({
    selectedAnatomyModel: m,
    holoState: { ...s.holoState, modelId: m },
  })),
  setSelectedEduLesson: (l) => set((s) => ({
    selectedEduLesson: l,
    holoState: { ...s.holoState, eduLessonId: l },
  })),
}), {
  // Persist only durable, user-meaningful slices. Ephemeral runtime state
  // (orb, audio levels, mic flags, transient overlays, attachments) lives
  // in memory only so refresh starts clean.
  name: "jarvis.store.v1",
  version: 1,
  storage: createJSONStorage(() => localStorage),
  partialize: (state) => ({
    chat:         state.chat,
    media:        state.media,
    tools:        state.tools,
    swarms:       state.swarms,
    voiceEnabled: state.voiceEnabled,
    bargeIn:      state.bargeIn,
    wakeEnabled:  state.wakeEnabled,
    shellMode:    state.shellMode,
  }),
  // After rehydrate, mark streaming chats as finalised (their stream never
  // resumes across a reload) and strip the lightbox/reader overlays.
  onRehydrateStorage: () => (state) => {
    if (!state) return;
    if (state.chat?.length) {
      state.chat = cleanupChatHistory(state.chat.map((c) => ({ ...c, streaming: false })));
    }
    // Cold launch (reboot / app relaunch) vs in-app reload. No alive marker ⇒
    // fresh process ⇒ don't auto-reopen the prior session; stash it for an
    // on-demand restore and start clean. A reload keeps the marker and the
    // session is left in place as before. Settings/prefs always persist.
    try {
      const alive = sessionStorage.getItem(SESSION_ALIVE_KEY);
      sessionStorage.setItem(SESSION_ALIVE_KEY, "1");
      if (!alive) {
        const hasSession =
          (state.chat?.length || 0) > 0 ||
          (state.media?.length || 0) > 0 ||
          (state.tools?.length || 0) > 0 ||
          (state.swarms?.length || 0) > 0;
        if (hasSession) {
          localStorage.setItem(PREV_SESSION_KEY, JSON.stringify({
            chat:   state.chat   || [],
            media:  state.media  || [],
            tools:  state.tools  || [],
            swarms: state.swarms || [],
          }));
          state.prevSessionAvailable = true;
        }
        state.chat = [];
        state.media = [];
        state.tools = [];
        state.swarms = [];
      }
    } catch { /* noop */ }
  },
}));
