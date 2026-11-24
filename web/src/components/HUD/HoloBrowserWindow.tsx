/**
 * HoloBrowserWindow — Cinema-grade Holographic Web Browser
 *
 * Self-contained floating holographic web browser:
 * - Direct draggable header and resizable bottom-right handle.
 * - Spawns on the left side of the screen.
 * - Cybernetic omnibar with back/forward/refresh buttons and SSL indicator.
 * - Quick research bookmarks (Google, GitHub, ArXiv, Wikipedia, HackerNews).
 * - Reports live coordinates for holographic laser projection beam tracking.
 */
import React, { useState, useEffect, useMemo } from "react";
import { useStore } from "../../lib/store";

interface HoloBrowserWindowProps {
  initialUrl?: string;
  onClose: () => void;
  onPositionChange?: (pos: { id: string; x: number; y: number } | null) => void;
}

const BOOKMARKS = [
  { label: "Google", url: "https://www.google.com/search?igu=1" },
  { label: "Wikipedia", url: "https://en.m.wikipedia.org" },
  { label: "GitHub", url: "https://github.com" },
  { label: "Hacker News", url: "https://news.ycombinator.com" },
  { label: "ArXiv", url: "https://arxiv.org" },
];

export default function HoloBrowserWindow({
  initialUrl = "https://www.google.com/search?igu=1",
  onClose,
  onPositionChange,
}: HoloBrowserWindowProps) {
  // Window geometry: spawn on left side of viewport
  const [position, setPosition] = useState(() => ({
    x: 48,
    y: 76,
    width: 640,
    height: 480,
  }));

  const [address, setAddress] = useState(initialUrl);
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [history, setHistory] = useState<string[]>([initialUrl]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [preMaximize, setPreMaximize] = useState(position);

  // Dragging & resizing
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const themeMode = useStore((s) => s.themeMode);
  const isDark = themeMode === "dark";

  // Report position for laser beam tracking
  useEffect(() => {
    if (isMinimized) {
      onPositionChange?.(null);
    } else {
      onPositionChange?.({ id: "holo-browser", x: position.x, y: position.y });
    }
    return () => {
      onPositionChange?.(null);
    };
  }, [position.x, position.y, isMinimized, onPositionChange]);

  useEffect(() => {
    if (initialUrl && initialUrl !== currentUrl) {
      setAddress(initialUrl);
      setCurrentUrl(initialUrl);
    }
  }, [initialUrl]);

  const navigateTo = (raw: string) => {
    let url = raw.trim();
    if (!url) return;
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = `https://www.google.com/search?igu=1&q=${encodeURIComponent(url)}`;
    }
    setAddress(url);
    setCurrentUrl(url);
    setIsLoading(true);
    setHistory((prev) => [...prev.slice(0, historyIndex + 1), url]);
    setHistoryIndex((prev) => prev + 1);
  };

  const handleBack = () => {
    if (historyIndex > 0) {
      const prevUrl = history[historyIndex - 1];
      setHistoryIndex((idx) => idx - 1);
      setAddress(prevUrl);
      setCurrentUrl(prevUrl);
    }
  };

  const handleForward = () => {
    if (historyIndex < history.length - 1) {
      const nextUrl = history[historyIndex + 1];
      setHistoryIndex((idx) => idx + 1);
      setAddress(nextUrl);
      setCurrentUrl(nextUrl);
    }
  };

  const handleRefresh = () => {
    setIsLoading(true);
    const temp = currentUrl;
    setCurrentUrl("");
    setTimeout(() => setCurrentUrl(temp), 60);
  };

  // Drag handlers
  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if (isMaximized) return;
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  };

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      const nextX = Math.max(10, Math.min(window.innerWidth - position.width - 10, e.clientX - dragOffset.x));
      const nextY = Math.max(50, Math.min(window.innerHeight - 80, e.clientY - dragOffset.y));
      setPosition((prev) => ({ ...prev, x: nextX, y: nextY }));
    };
    const handleMouseUp = () => setIsDragging(false);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragOffset, position.width]);

  // Resize handlers
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isMaximized) return;
    setIsResizing(true);
  };

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const nextW = Math.max(360, Math.min(window.innerWidth - position.x - 20, e.clientX - position.x));
      const nextH = Math.max(280, Math.min(window.innerHeight - position.y - 20, e.clientY - position.y));
      setPosition((prev) => ({ ...prev, width: nextW, height: nextH }));
    };
    const handleMouseUp = () => setIsResizing(false);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, position.x, position.y]);

  const toggleMaximize = () => {
    if (!isMaximized) {
      setPreMaximize(position);
      setPosition({
        x: 20,
        y: 60,
        width: window.innerWidth - 40,
        height: window.innerHeight - 100,
      });
      setIsMaximized(true);
    } else {
      setPosition(preMaximize);
      setIsMaximized(false);
    }
  };

  if (isMinimized) {
    return (
      <div
        className="fixed bottom-12 left-6 z-25 flex items-center gap-2 px-3 py-1.5 rounded-full border border-cyan-400/50 bg-slate-950/90 backdrop-blur-xl shadow-[0_0_15px_rgba(34,211,238,0.3)] cursor-pointer select-none"
        onClick={() => setIsMinimized(false)}
      >
        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
        <span className="text-xs font-mono text-cyan-200">🌐 HOLO BROWSER</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="text-slate-400 hover:text-red-400 ml-1 text-xs"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed z-25 select-none font-sans rounded-xl overflow-hidden flex flex-col border border-cyan-400/50 shadow-[0_0_35px_rgba(34,211,238,0.25)] backdrop-blur-2xl"
      style={{
        left: position.x,
        top: position.y,
        width: position.width,
        height: position.height,
        background: isDark ? "rgba(2, 8, 26, 0.88)" : "rgba(248, 250, 252, 0.92)",
      }}
    >
      {/* ── 1. HEADER ──────────────────────────────────────────────────────── */}
      <div
        onMouseDown={handleHeaderMouseDown}
        className="h-10 px-3 flex items-center justify-between border-b border-cyan-500/30 bg-cyan-950/40 cursor-grab active:cursor-grabbing shrink-0"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_#22d3ee]" />
          <span className="text-xs font-mono font-bold tracking-wider text-cyan-200 uppercase truncate">
            ◈ J.A.R.V.I.S // CYBER-NET
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setIsMinimized(true)}
            className="w-6 h-6 rounded flex items-center justify-center text-xs text-cyan-300 hover:bg-cyan-500/20 transition cursor-pointer"
            title="Minimize"
          >
            −
          </button>
          <button
            onClick={toggleMaximize}
            className="w-6 h-6 rounded flex items-center justify-center text-xs text-cyan-300 hover:bg-cyan-500/20 transition cursor-pointer"
            title={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? "⧉" : "□"}
          </button>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded flex items-center justify-center text-xs text-red-400 hover:bg-red-500/20 hover:text-red-300 transition cursor-pointer font-bold"
            title="Close"
          >
            ×
          </button>
        </div>
      </div>

      {/* ── 2. OMNIBAR & BOOKMARKS ─────────────────────────────────────────── */}
      <div className="p-2.5 pb-1 flex flex-col gap-1.5 shrink-0">
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleBack}
            disabled={historyIndex <= 0}
            className="w-7 h-7 rounded border border-cyan-500/30 text-cyan-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-cyan-500/20 text-xs flex items-center justify-center transition cursor-pointer"
            title="رجوع"
          >
            ◀
          </button>
          <button
            onClick={handleForward}
            disabled={historyIndex >= history.length - 1}
            className="w-7 h-7 rounded border border-cyan-500/30 text-cyan-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-cyan-500/20 text-xs flex items-center justify-center transition cursor-pointer"
            title="تقدم"
          >
            ▶
          </button>
          <button
            onClick={handleRefresh}
            className="w-7 h-7 rounded border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20 text-xs flex items-center justify-center transition cursor-pointer"
            title="تحديث"
          >
            ⟳
          </button>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              navigateTo(address);
            }}
            className="flex-1 flex items-center gap-1.5 px-3 py-1 rounded border text-xs"
            style={{
              background: isDark ? "rgba(2, 6, 23, 0.75)" : "rgba(255, 255, 255, 0.75)",
              borderColor: "rgba(56, 189, 248, 0.35)",
            }}
          >
            <span className="text-emerald-400 text-[11px]" title="SSL Secure Connection">
              🔒
            </span>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Enter URL or search query..."
              className="flex-1 bg-transparent text-[11px] text-cyan-200 outline-none font-mono placeholder:text-slate-500"
            />
            {isLoading && (
              <span className="w-2.5 h-2.5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin shrink-0" />
            )}
          </form>

          <button
            onClick={() => navigateTo(address)}
            className="px-2.5 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/40 text-cyan-200 border border-cyan-400/40 text-[11px] font-mono transition cursor-pointer shrink-0"
          >
            GO ↵
          </button>
        </div>

        {/* Bookmarks */}
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none py-0.5">
          <span className="text-[9px] font-mono uppercase text-slate-500 tracking-wider mr-1">
            Research:
          </span>
          {BOOKMARKS.map((b) => (
            <button
              key={b.label}
              onClick={() => navigateTo(b.url)}
              className="px-2 py-0.5 rounded text-[9.5px] font-mono bg-cyan-950/40 hover:bg-cyan-800/50 text-cyan-300 border border-cyan-500/25 transition cursor-pointer whitespace-nowrap"
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── 3. BROWSER FRAME ──────────────────────────────────────────────── */}
      <div className="relative flex-1 min-h-0 mx-2.5 my-1 bg-slate-950 rounded-lg overflow-hidden border border-cyan-500/25">
        <div className="absolute top-1.5 left-1.5 w-3 h-3 border-t-2 border-l-2 border-cyan-400 pointer-events-none z-10" />
        <div className="absolute top-1.5 right-1.5 w-3 h-3 border-t-2 border-r-2 border-cyan-400 pointer-events-none z-10" />
        <div className="absolute bottom-1.5 left-1.5 w-3 h-3 border-b-2 border-l-2 border-cyan-400 pointer-events-none z-10" />
        <div className="absolute bottom-1.5 right-1.5 w-3 h-3 border-b-2 border-r-2 border-cyan-400 pointer-events-none z-10" />

        {currentUrl && (
          <iframe
            src={currentUrl}
            title="JARVIS Cybernetic Browser Frame"
            onLoad={() => setIsLoading(false)}
            className="w-full h-full border-0 bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        )}
      </div>

      {/* ── 4. STATUS FOOTER ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between text-[9px] font-mono text-slate-500 px-3 pb-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span className="text-cyan-400">PROXY ACTIVE</span>
        </div>
        <span>HTTP/2 ENCRYPTED</span>
      </div>

      {/* Resize Handle (Bottom-Right) */}
      {!isMaximized && (
        <div
          onMouseDown={handleResizeMouseDown}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-20 flex items-end justify-end p-0.5"
        >
          <div className="w-2 h-2 border-r-2 border-b-2 border-cyan-400/70" />
        </div>
      )}
    </div>
  );
}
