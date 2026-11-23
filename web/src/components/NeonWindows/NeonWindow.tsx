/**
 * NEON WINDOW — one draggable / resizable / minimisable film-style window.
 *
 * Iron Man HUD chrome: glass panel, neon cyan glow border, corner ticks,
 * compact header with drag handle and minimise / maximise / close.
 * Drag is pointer-capture based on the header; resize from the SE corner.
 * Geometry lives in the window store; this component only renders it.
 */
import { useCallback, useEffect, useRef } from "react";
import { useNeonWindowStore, type NeonWindowState } from "./windowStore";

const MIN_W = 320;
const MIN_H = 220;

export default function NeonWindow({
  win,
  children,
}: {
  win: NeonWindowState;
  children: React.ReactNode;
}) {
  const focusWindow = useNeonWindowStore((s) => s.focusWindow);
  const closeWindow = useNeonWindowStore((s) => s.closeWindow);
  const minimizeWindow = useNeonWindowStore((s) => s.minimizeWindow);
  const toggleMaximize = useNeonWindowStore((s) => s.toggleMaximize);
  const updateWindow = useNeonWindowStore((s) => s.updateWindow);

  const dragRef = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const resizeRef = useRef<{ px: number; py: number; w: number; h: number } | null>(null);

  // Global pointer tracking so drags/resizes survive leaving the handle.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (dragRef.current) {
        const d = dragRef.current;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        updateWindow(win.id, {
          x: Math.max(-win.w + 120, Math.min(vw - 120, d.x + (e.clientX - d.px))),
          y: Math.max(0, Math.min(vh - 48, d.y + (e.clientY - d.py))),
        });
      } else if (resizeRef.current) {
        const r = resizeRef.current;
        updateWindow(win.id, {
          w: Math.max(MIN_W, Math.min(window.innerWidth - win.x - 8, r.w + (e.clientX - r.px))),
          h: Math.max(MIN_H, Math.min(window.innerHeight - win.y - 8, r.h + (e.clientY - r.py))),
        });
      }
    };
    const onUp = () => {
      dragRef.current = null;
      resizeRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [win.id, win.w, win.x, win.y, updateWindow]);

  const onHeaderPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (win.maximized) return;
      if ((e.target as HTMLElement).closest("button")) return;
      focusWindow(win.id);
      dragRef.current = { px: e.clientX, py: e.clientY, x: win.x, y: win.y };
    },
    [win.id, win.x, win.y, win.maximized, focusWindow],
  );

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      focusWindow(win.id);
      resizeRef.current = { px: e.clientX, py: e.clientY, w: win.w, h: win.h };
    },
    [win.id, win.w, win.h, focusWindow],
  );

  if (win.minimized) return null;

  const rect = win.maximized
    ? { left: 8, top: 8, width: "calc(100vw - 16px)", height: "calc(100vh - 16px)" }
    : { left: win.x, top: win.y, width: win.w, height: win.h };

  return (
    <section
      role="dialog"
      aria-label={win.title}
      onPointerDown={() => focusWindow(win.id)}
      className="fixed pointer-events-auto flex flex-col overflow-hidden rounded-xl animate-boot_in"
      style={{
        ...rect,
        zIndex: win.z,
        background: "rgba(4, 12, 24, 0.86)",
        backdropFilter: "blur(18px) saturate(140%)",
        border: "1px solid rgba(34, 211, 238, 0.45)",
        boxShadow:
          "0 0 0 1px rgba(34,211,238,0.12), 0 0 24px rgba(34,211,238,0.28), 0 18px 50px rgba(0,0,0,0.55)",
      }}
    >
      {/* Corner ticks */}
      <span aria-hidden className="pointer-events-none absolute left-0 top-0 h-3 w-3 border-l-2 border-t-2 border-cyan-300/90" />
      <span aria-hidden className="pointer-events-none absolute right-0 top-0 h-3 w-3 border-r-2 border-t-2 border-cyan-300/90" />
      <span aria-hidden className="pointer-events-none absolute bottom-0 left-0 h-3 w-3 border-b-2 border-l-2 border-cyan-300/90" />
      <span aria-hidden className="pointer-events-none absolute bottom-0 right-0 h-3 w-3 border-b-2 border-r-2 border-cyan-300/90" />

      {/* Header — drag handle */}
      <header
        onPointerDown={onHeaderPointerDown}
        onDoubleClick={() => toggleMaximize(win.id)}
        className="flex h-10 shrink-0 cursor-grab touch-none select-none items-center justify-between gap-2 border-b border-cyan-500/20 bg-cyan-950/30 px-3 active:cursor-grabbing"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee]" />
          <span dir="auto" className="truncate font-mono text-[11px] font-bold tracking-[0.25em] text-cyan-200">
            {win.title}
          </span>
          {win.titleAr && (
            <span dir="auto" className="truncate text-[11px] text-cyan-400/70">
              {win.titleAr}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => minimizeWindow(win.id)}
            title="Minimise — تصغير"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-cyan-500/25 text-[11px] text-cyan-300/80 transition hover:border-cyan-400/60 hover:text-cyan-100"
          >
            –
          </button>
          <button
            onClick={() => toggleMaximize(win.id)}
            title={win.maximized ? "Restore — استعادة" : "Maximise — تكبير"}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-cyan-500/25 text-[11px] text-cyan-300/80 transition hover:border-cyan-400/60 hover:text-cyan-100"
          >
            {win.maximized ? "⧉" : "▢"}
          </button>
          <button
            onClick={() => closeWindow(win.id)}
            title="Close — إغلاق"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-rose-500/40 text-[11px] text-rose-300/90 transition hover:border-rose-400 hover:bg-rose-500/20 hover:text-rose-100"
          >
            ✕
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>

      {/* Resize handle */}
      {!win.maximized && (
        <div
          onPointerDown={onResizePointerDown}
          title="resize"
          className="absolute bottom-0 right-0 z-10 h-5 w-5 cursor-nwse-resize touch-none"
        >
          <svg width="12" height="12" viewBox="0 0 10 10" fill="none" className="absolute bottom-1 right-1 opacity-70">
            <path d="M9 1 L1 9 M9 5 L5 9" stroke="rgba(165,243,252,0.9)" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </section>
  );
}
