/** The zustand store (Phase 2 split of lib/store.ts).
 *
 * Types live in ./types.ts, session helpers in ./session.ts. Import the
 * store itself from here — or from the ../store.ts shim, which re-exports
 * this module so existing imports keep working unchanged.
 *
 * Merge-v2 (2026-11-24, single-branch consolidation): ui base + every
 * audit/fixes-only field/setter/default/persist entry (auth, themeMode,
 * language, speechLanguage, STT engine/model/endpoint/key, statsLoading,
 * clearConfirmQueue, clearStats, projectsCount). Shared fields keep the ui
 * implementation and defaults — see merged/REPORT-store.md for the
 * field-by-field table and the deliberate divergences.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { isEmptyAssistantText } from "../speechText";

import type {
  ChatAttachment,
  ChatEntry,
  ConfirmRequest,
  GalaxyCluster,
  GalaxyNode,
  Health,
  HoloSceneState,
  MediaCard,
  MediaItem,
  MediaKind,
  OrbState,
  PlanState,
  SkinName,
  SwarmRun,
  SwarmSubtask,
  SystemStats,
  ToolCall,
  VoiceProfile,
} from "./types";
import {
  PREV_SESSION_KEY,
  SESSION_ALIVE_KEY,
  cleanupChatHistory,
  isBootGreeting,
} from "./session";

export * from "./types";
export * from "./session";

interface StoreState {
  // connection
  connected: boolean;
  setConnected: (v: boolean) => void;
  // auth
  authToken: string | null;
  setAuthToken: (v: string | null) => void;
  authConfigured: boolean;
  setAuthConfigured: (v: boolean) => void;
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
  // theme mode (dark/light)
  themeMode: "dark" | "light";
  setThemeMode: (m: "dark" | "light") => void;
  // language (en/ar) - interface language, manual via Display settings
  language: "en" | "ar";
  setLanguage: (l: "en" | "ar") => void;
  // speech language (en/ar) - manual via Voice settings, independent of UI language
  speechLanguage: "en" | "ar";
  setSpeechLanguage: (l: "en" | "ar") => void;
  // STT Engine & custom model configuration
  sttEngine: "web_speech" | "backend_whisper" | "custom_stt";
  setSttEngine: (engine: "web_speech" | "backend_whisper" | "custom_stt") => void;
  sttModel: string;
  setSttModel: (model: string) => void;
  sttCustomEndpoint: string;
  setSttCustomEndpoint: (endpoint: string) => void;
  sttCustomApiKey: string;
  setSttCustomApiKey: (key: string) => void;
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
  clearConfirmQueue: () => void;
  // stats
  stats: SystemStats | null;
  statsLoading: boolean;         // true until the first successful response arrives
  setStats: (s: SystemStats) => void;
  clearStats: () => void;        // called after 3 consecutive failures — resets to null
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
  projectsCount: number | null;   // null = not yet loaded; set after /api/projects
  setProjectsCount: (n: number) => void;
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

export const useStore = create<StoreState>()(persist((set) => ({
  connected: false,
  setConnected: (v) => set({ connected: v }),
  booted: false,
  setBooted: (v) => set({ booted: v }),
  // auth
  authToken: typeof localStorage !== "undefined" ? localStorage.getItem("jarvis_auth_token") : null,
  setAuthToken: (v: string | null) => {
    if (typeof localStorage !== "undefined") {
      if (v) {
        try { localStorage.setItem("jarvis_auth_token", v); } catch {}
      } else {
        try { localStorage.removeItem("jarvis_auth_token"); } catch {}
      }
    }
    set({ authToken: v });
  },
  authConfigured: false,
  setAuthConfigured: (v: boolean) => set({ authConfigured: v }),
  orbState: "idle",
  setOrb: (s) => set({ orbState: s }),
  audioLevel: 0,
  setAudioLevel: (v) => set({ audioLevel: v }),
  speakerAudioLevel: 0,
  setSpeakerAudioLevel: (v) => set({ speakerAudioLevel: v }),
  skin: "reactor",
  setSkin: (s) => set({ skin: s }),
  themeMode: "dark",
  setThemeMode: (m) => set({ themeMode: m }),
  language: "en",
  setLanguage: (l) => {
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("jarvis_lang", l);
      }
    } catch { /* ignore */ }
    set({ language: l });
  },
  speechLanguage: "ar",
  setSpeechLanguage: (l) => set({ speechLanguage: l }),
  sttEngine: "web_speech",
  setSttEngine: (engine) => set({ sttEngine: engine }),
  sttModel: "whisper-large-v3-turbo",
  setSttModel: (model) => set({ sttModel: model }),
  sttCustomEndpoint: "",
  setSttCustomEndpoint: (endpoint) => set({ sttCustomEndpoint: endpoint }),
  sttCustomApiKey: "",
  setSttCustomApiKey: (key) => set({ sttCustomApiKey: key }),
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
    set((st) => {
      // If the final text is empty (tool-only hop produced no visible tokens),
      // remove the placeholder entirely instead of leaving a blank bubble.
      // (audit/fixes finalizeChat, ported verbatim — see REPORT-store.md §3.)
      const finalText = text ?? st.chat.find((c) => c.id === id)?.text ?? "";
      const entry = st.chat.find((c) => c.id === id);
      const empty =
        finalText.trim() === "" ||
        (entry?.role === "assistant" && isEmptyAssistantText(finalText));
      if (empty) {
        return { chat: st.chat.filter((c) => c.id !== id) };
      }
      return {
        chat: st.chat.map((c) =>
          c.id === id ? { ...c, streaming: false, text: finalText } : c,
        ),
      };
    }),
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
  clearConfirmQueue: () => set({ confirmQueue: [] }),
  stats: null,
  statsLoading: true,
  setStats: (s) => set({ stats: s, statsLoading: false }),
  clearStats: () => set({ stats: null }),
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
  projectsCount: null,
  setProjectsCount: (n) => set({ projectsCount: n }),
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
    language:     state.language,
    speechLanguage: state.speechLanguage,
    sttEngine:    state.sttEngine,
    sttModel:     state.sttModel,
    sttCustomEndpoint: state.sttCustomEndpoint,
    sttCustomApiKey: state.sttCustomApiKey,
  }),
  // After rehydrate, mark streaming chats as finalised (their stream never
  // resumes across a reload) and strip the lightbox/reader overlays.
  onRehydrateStorage: () => (state) => {
    if (!state) return;
    if (!state.language) {
      state.language = "ar";
    }
    if (!state.speechLanguage) {
      state.speechLanguage = "ar";
    }
    if (!state.sttEngine) {
      state.sttEngine = "web_speech";
    }
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
        // MERGE-V2 FIX: af set state.language = "ar" here unconditionally,
        // which would override a persisted "en" choice on every cold launch.
        // The conditional default above (if (!state.language)) already covers
        // the missing-value case, so the override is dropped, not kept.
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
