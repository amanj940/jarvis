/**
 * NEON WINDOW HOST — mounts every open neon window + the launcher dock.
 *
 * Mounted once in App.tsx, above the living screen (fixed overlay, windows
 * at z 60+ so they float over the HUD but under nothing else modal).
 *
 * Wiring (no edits to the wrapped panels themselves):
 *   • Layout persistence: windows left open are saved to localStorage and
 *     restored on launch (windowStore.restoreNeonWindows); the `seen` set
 *     below still stops old cards auto-popping on reload.
 *   • Media Bay / image & video & page results → media-bay window.
 *   • Memory galaxy card arrival → its own galaxy window.
 *   • Generated 3D model card arrival → its own model3d window.
 *   • store.reader set → browser window (ArticleReader).
 *   • Launcher dock (bottom-right, clear of the bottom-left dialogue and
 *     the top-right telemetry) opens Terminal / Webcam / Media Bay /
 *     Browser on demand; Galaxy asks JARVIS for the map when none exists.
 */
import { useEffect, useRef } from "react";
import { useStore } from "../../lib/store";
import { wsClient } from "../../lib/ws";
import MediaBay from "../Media/MediaBay";
import NeuralGalaxy from "../Media/NeuralGalaxy";
import Model3DViewer from "../Media/Model3DViewer";
import WebcamFeed from "../Media/WebcamFeed";
import ArticleReader from "../Media/ArticleReader";
import TerminalPanel from "../HUD/TerminalPanel";
import StreetMapWindow from "./StreetMapWindow";
import NeonWindow from "./NeonWindow";
import {
  flushNeonWindowPersistence,
  openBrowser,
  openGalaxyWindow,
  openMediaBay,
  openModel3DWindow,
  openTerminal,
  openWebcam,
  restoreNeonWindows,
  useNeonWindowStore,
  type NeonWindowPayload,
} from "./windowStore";

function WindowContent({ winId, kind, cardId, payload }: { winId: string; kind: string; cardId?: string; payload?: NeonWindowPayload }) {
  const media = useStore((s) => s.media);
  const reader = useStore((s) => s.reader);

  if (kind === "media-bay") {
    if (media.length === 0) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-cyan-300/80">
            Media Bay empty
          </span>
          <span dir="auto" className="text-xs leading-relaxed text-slate-400">
            لا توجد وسائط بعد — اطلب من جارفيس البحث عن صور أو فيديو أو توليد صورة.
          </span>
        </div>
      );
    }
    return <MediaBay />;
  }

  if (kind === "galaxy") {
    const card = media.find((m) => m.id === cardId);
    if (!card?.galaxy) {
      return (
        <div className="flex h-full items-center justify-center p-6 text-center font-mono text-[11px] tracking-[0.2em] text-slate-400">
          Galaxy card closed.
        </div>
      );
    }
    return <NeuralGalaxy card={card} large />;
  }

  if (kind === "model3d") {
    const card = media.find((m) => m.id === cardId);
    const item = card?.items?.[0];
    if (!item) {
      return (
        <div className="flex h-full items-center justify-center p-6 text-center font-mono text-[11px] tracking-[0.2em] text-slate-400">
          3D model card closed.
        </div>
      );
    }
    return <Model3DViewer item={item} large />;
  }

  if (kind === "terminal") return <TerminalPanel />;

  if (kind === "browser") {
    if (!reader) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-cyan-300/80">
            No article open
          </span>
          <span dir="auto" className="text-xs leading-relaxed text-slate-400">
            افتح صفحة من مكتبة الوسائط وستظهر هنا في نافذة المتصفح.
          </span>
        </div>
      );
    }
    // ArticleReader renders its own header + close (clears store.reader);
    // closing the window itself is the NeonWindow chrome's job.
    void winId;
    return <ArticleReader />;
  }

  if (kind === "street-map") {
    const lat = payload?.lat;
    const lon = payload?.lon;
    if (lat === undefined || lon === undefined) {
      return (
        <div className="flex h-full items-center justify-center p-6 text-center font-mono text-[11px] tracking-[0.2em] text-slate-400">
          No city selected.
        </div>
      );
    }
    return <StreetMapWindow lat={lat} lon={lon} name={payload?.name ?? "City"} />;
  }

  if (kind === "webcam") {
    return <WebcamFeed item={{ url: "webcam://local", title: "WEBCAM FEED" }} />;
  }

  return null;
}

const LAUNCHERS: {
  key: string;
  icon: string;
  label: string;
  labelAr: string;
  action: () => void;
}[] = [
  { key: "media-bay", icon: "▦", label: "MEDIA", labelAr: "وسائط", action: openMediaBay },
  {
    key: "galaxy",
    icon: "⌬",
    label: "GALAXY",
    labelAr: "المجرّة",
    action: () => {
      const card = useStore.getState().media.find((m) => m.kind === "galaxy");
      if (card) openGalaxyWindow(card.id, card.summary || undefined);
      else wsClient.chat("show my memory galaxy");
    },
  },
  { key: "terminal", icon: "›_", label: "TERM", labelAr: "طرفية", action: openTerminal },
  { key: "browser", icon: "◈", label: "BROWSER", labelAr: "متصفح", action: openBrowser },
  { key: "webcam", icon: "◉", label: "WEBCAM", labelAr: "كاميرا", action: openWebcam },
];

export default function NeonWindowHost() {
  const windows = useNeonWindowStore((s) => s.windows);
  const focusWindow = useNeonWindowStore((s) => s.focusWindow);
  const closeWindow = useNeonWindowStore((s) => s.closeWindow);
  const minimized = windows.filter((w) => w.minimized);

  // ── Restore windows the user left open ─────────────────────────────────
  // Declared FIRST so it runs before the auto-open effects below: restored
  // windows are already present (and their cards already seeded into
  // `seen`) when fresh arrivals are checked, so a reload never duplicates
  // them and never pops windows for old cards.
  useEffect(() => {
    restoreNeonWindows();
    const flush = () => flushNeonWindowPersistence();
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, []);

  // ── Auto-open results as windows ──────────────────────────────────────
  // `seen` is seeded from whatever media already exists at mount, so a
  // reload never pops windows for old cards — only fresh arrivals open.
  const seenRef = useRef<Set<string> | null>(null);
  const media = useStore((s) => s.media);
  useEffect(() => {
    if (seenRef.current === null) {
      seenRef.current = new Set(media.map((m) => m.id));
      return;
    }
    for (const card of media) {
      if (seenRef.current.has(card.id)) continue;
      seenRef.current.add(card.id);
      if (card.kind === "galaxy") {
        openGalaxyWindow(card.id, card.summary || undefined);
      } else if (card.kind === "model3d") {
        openModel3DWindow(card.id, card.summary || undefined);
      } else if (["image", "images", "video", "videos", "page", "pdf"].includes(card.kind)) {
        // Image / video / page results surface in the Media Bay window.
        openMediaBay();
      }
      // webcam cards are opened on demand from the launcher / Media Bay.
    }
  }, [media]);

  // ── Article reader → browser window ───────────────────────────────────
  const reader = useStore((s) => s.reader);
  const readerSeenRef = useRef<string | null>(null);
  useEffect(() => {
    if (reader && reader !== readerSeenRef.current) {
      readerSeenRef.current = reader;
      openBrowser();
    } else if (!reader) {
      readerSeenRef.current = null;
    }
  }, [reader]);

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]" aria-hidden={false}>
      {windows.map((win) => (
        <NeonWindow key={win.id} win={win}>
          <WindowContent winId={win.id} kind={win.kind} cardId={win.payload?.cardId} payload={win.payload} />
        </NeonWindow>
      ))}

      {/* ── Launcher + minimised dock (bottom-right) ────────────────────
          Bottom-left holds the dialogue ribbon, top-right the telemetry —
          bottom-right is the free corner. */}
      <div className="pointer-events-auto absolute bottom-3 right-3 z-[61] flex flex-col items-end gap-2">
        {minimized.length > 0 && (
          <div className="flex max-w-[70vw] flex-wrap justify-end gap-1.5">
            {minimized.map((win) => (
              <button
                key={win.id}
                onClick={() => focusWindow(win.id)}
                className="flex items-center gap-1.5 rounded-full border border-cyan-500/40 bg-slate-950/85 px-2.5 py-1 font-mono text-[10px] tracking-widest text-cyan-200 backdrop-blur-md transition hover:border-cyan-300 hover:text-white"
                style={{ boxShadow: "0 0 12px rgba(34,211,238,0.25)" }}
              >
                <span dir="auto">{win.title}</span>
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    closeWindow(win.id);
                  }}
                  className="text-rose-300/80 hover:text-rose-200"
                  title="Close"
                >
                  ✕
                </span>
              </button>
            ))}
          </div>
        )}
        <div
          className="flex items-center gap-1 rounded-full border border-cyan-500/30 bg-slate-950/80 px-1.5 py-1.5 backdrop-blur-md"
          style={{ boxShadow: "0 0 18px rgba(34,211,238,0.22)" }}
        >
          {LAUNCHERS.map((l) => (
            <button
              key={l.key}
              onClick={l.action}
              title={`${l.label} · ${l.labelAr}`}
              className="flex flex-col items-center gap-0.5 rounded-full px-2.5 py-1 text-cyan-200/90 transition hover:bg-cyan-500/15 hover:text-white"
            >
              <span className="text-[13px] leading-none">{l.icon}</span>
              <span className="font-mono text-[8px] tracking-[0.18em]">{l.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
