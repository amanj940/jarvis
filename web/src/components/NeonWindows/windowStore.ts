/**
 * NEON WINDOW STORE — Iron Man film-style floating window manager.
 *
 * A tiny zustand store (in-memory only, never persisted) holding every open
 * neon window: its kind, geometry, z-order and minimised state.
 *
 * Kinds are singletons except galaxy / model3d, which are one window per
 * media card id. Opening an already-open singleton focuses + restores it
 * instead of spawning a duplicate.
 */
import { create } from "zustand";

export type NeonWindowKind =
  | "media-bay"   // Media Bay gallery (images / videos / pages / webcam cards)
  | "galaxy"      // Memory galaxy (one window per galaxy card)
  | "model3d"     // Generated 3D model (one window per model3d card)
  | "terminal"    // Live backend log stream
  | "browser"     // In-app article reader (store.reader URL)
  | "webcam";     // Live local webcam feed

export interface NeonWindowPayload {
  /** Media card id (galaxy / model3d windows). */
  cardId?: string;
}

export interface NeonWindowState {
  id: string;
  kind: NeonWindowKind;
  title: string;
  titleAr?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  minimized: boolean;
  maximized: boolean;
  /** Geometry to restore after un-maximising. */
  prevRect?: { x: number; y: number; w: number; h: number };
  payload?: NeonWindowPayload;
}

interface NeonWindowStore {
  windows: NeonWindowState[];
  zTop: number;
  openWindow: (
    kind: NeonWindowKind,
    opts?: { title?: string; titleAr?: string; payload?: NeonWindowPayload },
  ) => string;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  toggleMaximize: (id: string) => void;
  updateWindow: (id: string, patch: Partial<NeonWindowState>) => void;
  /** Close the topmost visible window. Returns false when none is open. */
  closeTopmost: () => boolean;
  closeAll: () => void;
}

const DEFAULT_SIZE: Record<NeonWindowKind, { w: number; h: number }> = {
  "media-bay": { w: 720, h: 520 },
  galaxy:     { w: 760, h: 560 },
  model3d:    { w: 680, h: 520 },
  terminal:   { w: 640, h: 420 },
  browser:    { w: 720, h: 560 },
  webcam:     { w: 560, h: 420 },
};

const DEFAULT_TITLE: Record<NeonWindowKind, { title: string; titleAr: string }> = {
  "media-bay": { title: "MEDIA BAY",       titleAr: "مكتبة الوسائط" },
  galaxy:     { title: "MEMORY GALAXY",   titleAr: "مجرّة الذاكرة" },
  model3d:    { title: "3D MODEL",        titleAr: "مجسّم ثلاثي الأبعاد" },
  terminal:   { title: "TERMINAL",        titleAr: "الطرفية" },
  browser:    { title: "BROWSER",         titleAr: "المتصفح" },
  webcam:     { title: "WEBCAM",          titleAr: "كاميرا الويب" },
};

/** Singleton kinds: at most one window of this kind exists at a time. */
const SINGLETON_KINDS: ReadonlySet<NeonWindowKind> = new Set([
  "media-bay",
  "terminal",
  "browser",
  "webcam",
]);

let idCounter = 0;
function nextWindowId(kind: NeonWindowKind): string {
  idCounter += 1;
  return `neon-${kind}-${Date.now().toString(36)}-${idCounter}`;
}

/** Cascade new windows so they never land exactly on top of each other. */
function cascadeRect(kind: NeonWindowKind, count: number): { x: number; y: number; w: number; h: number } {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1600;
  const vh = typeof window !== "undefined" ? window.innerHeight : 900;
  const { w, h } = DEFAULT_SIZE[kind];
  const step = 36;
  const offset = (count % 6) * step;
  // Centre-ish, nudged down so the header stays clear; clamp into viewport.
  const x = Math.max(8, Math.min(vw - w - 8, (vw - w) / 2 + offset - 120));
  const y = Math.max(8, Math.min(vh - h - 8, 72 + offset));
  return { x, y, w: Math.min(w, vw - 16), h: Math.min(h, vh - 16) };
}

export const useNeonWindowStore = create<NeonWindowStore>()((set, get) => ({
  windows: [],
  zTop: 60,

  openWindow: (kind, opts) => {
    const st = get();
    const defaults = DEFAULT_TITLE[kind];
    // Singleton: focus + restore the existing window instead of duplicating.
    if (SINGLETON_KINDS.has(kind)) {
      const existing = st.windows.find((w) => w.kind === kind);
      if (existing) {
        const z = st.zTop + 1;
        set({
          zTop: z,
          windows: st.windows.map((w) =>
            w.id === existing.id ? { ...w, minimized: false, z } : w,
          ),
        });
        return existing.id;
      }
    }
    // Per-card kinds: one window per card id.
    if (opts?.payload?.cardId) {
      const existing = st.windows.find(
        (w) => w.kind === kind && w.payload?.cardId === opts.payload?.cardId,
      );
      if (existing) {
        const z = st.zTop + 1;
        set({
          zTop: z,
          windows: st.windows.map((w) =>
            w.id === existing.id ? { ...w, minimized: false, z } : w,
          ),
        });
        return existing.id;
      }
    }
    const rect = cascadeRect(kind, st.windows.length);
    const z = st.zTop + 1;
    const win: NeonWindowState = {
      id: nextWindowId(kind),
      kind,
      title: opts?.title ?? defaults.title,
      titleAr: opts?.titleAr ?? defaults.titleAr,
      ...rect,
      z,
      minimized: false,
      maximized: false,
      payload: opts?.payload,
    };
    set({ zTop: z, windows: [...st.windows, win] });
    return win.id;
  },

  closeWindow: (id) =>
    set((st) => ({ windows: st.windows.filter((w) => w.id !== id) })),

  focusWindow: (id) => {
    const st = get();
    const win = st.windows.find((w) => w.id === id);
    if (!win) return;
    if (win.z === st.zTop && !win.minimized) return;
    const z = st.zTop + 1;
    set({
      zTop: z,
      windows: st.windows.map((w) => (w.id === id ? { ...w, z, minimized: false } : w)),
    });
  },

  minimizeWindow: (id) =>
    set((st) => ({
      windows: st.windows.map((w) => (w.id === id ? { ...w, minimized: true } : w)),
    })),

  restoreWindow: (id) => get().focusWindow(id),

  toggleMaximize: (id) =>
    set((st) => ({
      windows: st.windows.map((w) => {
        if (w.id !== id) return w;
        if (w.maximized) {
          const prev = w.prevRect ?? { x: w.x, y: w.y, w: w.w, h: w.h };
          return { ...w, maximized: false, ...prev, prevRect: undefined };
        }
        return {
          ...w,
          maximized: true,
          prevRect: { x: w.x, y: w.y, w: w.w, h: w.h },
        };
      }),
    })),

  updateWindow: (id, patch) =>
    set((st) => ({
      windows: st.windows.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    })),

  closeTopmost: () => {
    const st = get();
    const visible = st.windows.filter((w) => !w.minimized);
    if (visible.length === 0) return false;
    const top = visible.reduce((a, b) => (b.z > a.z ? b : a));
    set({ windows: st.windows.filter((w) => w.id !== top.id) });
    return true;
  },

  closeAll: () => set({ windows: [] }),
}));

/** Convenience openers used by the launcher dock and auto-open wiring. */
export function openMediaBay(): string {
  return useNeonWindowStore.getState().openWindow("media-bay");
}
export function openTerminal(): string {
  return useNeonWindowStore.getState().openWindow("terminal");
}
export function openBrowser(): string {
  return useNeonWindowStore.getState().openWindow("browser");
}
export function openWebcam(): string {
  return useNeonWindowStore.getState().openWindow("webcam");
}
export function openGalaxyWindow(cardId: string, title?: string): string {
  return useNeonWindowStore.getState().openWindow("galaxy", {
    title: title || "MEMORY GALAXY",
    payload: { cardId },
  });
}
export function openModel3DWindow(cardId: string, title?: string): string {
  return useNeonWindowStore.getState().openWindow("model3d", {
    title: title || "3D MODEL",
    payload: { cardId },
  });
}
