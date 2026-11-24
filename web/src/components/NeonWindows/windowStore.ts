/**
 * NEON WINDOW STORE — Iron Man film-style floating window manager.
 *
 * A tiny zustand store holding every open neon window: its kind, geometry,
 * z-order and minimised state.
 *
 * Layout is PERSISTED to localStorage (debounced on every change) and
 * restored once on launch by NeonWindowHost — windows the user left open
 * come back; auto-opened content is still governed by the host's `seen`
 * set. Corrupt or old stored data is ignored, never thrown.
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
  | "street-map"  // Street map for a globe city (MapLibre + OpenFreeMap)
  | "webcam";     // Live local webcam feed

export interface NeonWindowPayload {
  /** Media card id (galaxy / model3d windows). */
  cardId?: string;
  /** Street-map window: city centre. Re-opening for another city updates it. */
  lat?: number;
  lon?: number;
  /** Street-map window: city display name. */
  name?: string;
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
  "street-map": { w: 760, h: 560 },
  webcam:     { w: 560, h: 420 },
};

const DEFAULT_TITLE: Record<NeonWindowKind, { title: string; titleAr: string }> = {
  "media-bay": { title: "MEDIA BAY",       titleAr: "مكتبة الوسائط" },
  galaxy:     { title: "MEMORY GALAXY",   titleAr: "مجرّة الذاكرة" },
  model3d:    { title: "3D MODEL",        titleAr: "مجسّم ثلاثي الأبعاد" },
  terminal:   { title: "TERMINAL",        titleAr: "الطرفية" },
  browser:    { title: "BROWSER",         titleAr: "المتصفح" },
  "street-map": { title: "STREET MAP",    titleAr: "خريطة الشوارع" },
  webcam:     { title: "WEBCAM",          titleAr: "كاميرا الويب" },
};

/** Singleton kinds: at most one window of this kind exists at a time. */
const SINGLETON_KINDS: ReadonlySet<NeonWindowKind> = new Set([
  "media-bay",
  "terminal",
  "browser",
  "street-map",
  "webcam",
]);

// ── Layout persistence (localStorage) ─────────────────────────────────────
// Saved on every change (debounced), restored once on launch by
// NeonWindowHost. Only windows the user left open are restored.
// Anything unreadable — bad JSON, wrong version, bad shape, off-viewport
// geometry — is dropped, never thrown, so a corrupt entry can never break
// the HUD.
const PERSIST_KEY = "jarvis.neon-windows.v1";
const PERSIST_VERSION = 1;
/** Max windows restored on launch; oldest minimised dropped first. */
const MAX_RESTORED_WINDOWS = 8;

const ALL_KINDS: ReadonlySet<string> = new Set([
  "media-bay",
  "galaxy",
  "model3d",
  "terminal",
  "browser",
  "street-map",
  "webcam",
]);

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function parsePersistedWindow(raw: unknown, vw: number, vh: number): NeonWindowState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.kind !== "string" || !ALL_KINDS.has(r.kind)) return null;
  if (typeof r.id !== "string" || r.id.length === 0) return null;
  if (typeof r.title !== "string" || r.title.length === 0) return null;
  if (
    !isFiniteNumber(r.x) || !isFiniteNumber(r.y) || !isFiniteNumber(r.w) ||
    !isFiniteNumber(r.h) || !isFiniteNumber(r.z)
  ) return null;

  // Clamp into the current viewport so a window saved on a bigger screen
  // never lands unreachable (same bounds as drag/resize in NeonWindow).
  const w = Math.max(320, Math.min(r.w, vw - 16));
  const h = Math.max(220, Math.min(r.h, vh - 16));
  const x = Math.max(-w + 120, Math.min(vw - 120, r.x));
  const y = Math.max(0, Math.min(vh - 48, r.y));

  let prevRect: NeonWindowState["prevRect"];
  if (r.prevRect && typeof r.prevRect === "object") {
    const p = r.prevRect as Record<string, unknown>;
    if (isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.w) && isFiniteNumber(p.h)) {
      prevRect = { x: p.x, y: p.y, w: p.w, h: p.h };
    }
  }

  let payload: NeonWindowPayload | undefined;
  if (r.payload && typeof r.payload === "object") {
    const p = r.payload as Record<string, unknown>;
    const next: NeonWindowPayload = {};
    if (typeof p.cardId === "string" && p.cardId.length > 0) next.cardId = p.cardId;
    // Street-map payload: only well-formed coordinates survive a restore.
    if (isFiniteNumber(p.lat) && p.lat >= -90 && p.lat <= 90) next.lat = p.lat;
    if (isFiniteNumber(p.lon) && p.lon >= -180 && p.lon <= 180) next.lon = p.lon;
    if (typeof p.name === "string" && p.name.length > 0) next.name = p.name;
    if (Object.keys(next).length > 0) payload = next;
  }

  return {
    id: r.id,
    kind: r.kind as NeonWindowKind,
    title: r.title,
    titleAr: typeof r.titleAr === "string" ? r.titleAr : undefined,
    x,
    y,
    w,
    h,
    z: r.z,
    minimized: r.minimized === true,
    maximized: r.maximized === true,
    prevRect,
    payload,
  };
}

function loadPersistedWindows(): NeonWindowState[] {
  try {
    if (typeof window === "undefined" || !window.localStorage) return [];
    const raw = window.localStorage.getItem(PERSIST_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    const p = parsed as Record<string, unknown>;
    if (p.version !== PERSIST_VERSION || !Array.isArray(p.windows)) return [];

    const vw = window.innerWidth || 1600;
    const vh = window.innerHeight || 900;
    const out: NeonWindowState[] = [];
    const seenKeys = new Set<string>();
    for (const item of p.windows) {
      const win = parsePersistedWindow(item, vw, vh);
      if (!win) continue;
      // De-duplicate: one window per singleton kind, one per card id.
      const key = win.payload?.cardId ? `${win.kind}:${win.payload.cardId}` : win.kind;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      out.push(win);
    }
    // Cap: drop oldest minimised first, then oldest by z-order.
    out.sort((a, b) => a.z - b.z);
    while (out.length > MAX_RESTORED_WINDOWS) {
      const minIdx = out.findIndex((w) => w.minimized);
      out.splice(minIdx >= 0 ? minIdx : 0, 1);
    }
    // Re-number z so stacking stays sane (61..).
    out.forEach((w, i) => {
      w.z = 61 + i;
    });
    return out;
  } catch {
    return [];
  }
}

function savePersistedWindows(windows: NeonWindowState[]): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    const payload = {
      version: PERSIST_VERSION,
      windows: windows.map((w) => ({
        id: w.id,
        kind: w.kind,
        title: w.title,
        titleAr: w.titleAr,
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        z: w.z,
        minimized: w.minimized,
        maximized: w.maximized,
        prevRect: w.prevRect,
        payload: w.payload,
      })),
    };
    window.localStorage.setItem(PERSIST_KEY, JSON.stringify(payload));
  } catch {
    // Storage unavailable / full / blocked — layout just won't persist.
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function schedulePersist(windows: NeonWindowState[]): void {
  if (typeof window === "undefined") return;
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    savePersistedWindows(windows);
  }, 200);
}

/** Write the current layout to storage right now (e.g. on beforeunload). */
export function flushNeonWindowPersistence(): void {
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  savePersistedWindows(useNeonWindowStore.getState().windows);
}

let restored = false;
/**
 * Restore windows the user left open. Safe to call repeatedly; only the
 * first call does anything. Returns true when windows were restored.
 */
export function restoreNeonWindows(): boolean {
  if (restored) return false;
  restored = true;
  const windows = loadPersistedWindows();
  if (windows.length === 0) return false;
  useNeonWindowStore.setState({ windows, zTop: 60 + windows.length });
  return true;
}

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
    // A re-open with a new title/payload re-targets it (street-map: another
    // city) instead of leaving the old city on screen.
    if (SINGLETON_KINDS.has(kind)) {
      const existing = st.windows.find((w) => w.kind === kind);
      if (existing) {
        const z = st.zTop + 1;
        set({
          zTop: z,
          windows: st.windows.map((w) =>
            w.id === existing.id
              ? {
                  ...w,
                  minimized: false,
                  z,
                  ...(opts?.title ? { title: opts.title } : {}),
                  ...(opts?.titleAr !== undefined
                    ? { titleAr: opts.titleAr }
                    : {}),
                  ...(opts?.payload ? { payload: opts.payload } : {}),
                }
              : w,
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

// Persist the layout on every change (debounced 200 ms so drags/resizes
// don't hammer localStorage).
useNeonWindowStore.subscribe((st) => schedulePersist(st.windows));

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
export function openStreetMapWindow(lat: number, lon: number, name: string): string {
  return useNeonWindowStore.getState().openWindow("street-map", {
    title: `STREET MAP — ${name.toUpperCase()}`,
    titleAr: "خريطة الشوارع",
    payload: { lat, lon, name },
  });
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
