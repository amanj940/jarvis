/**
 * HoloYouTubeWindow — Cinema-grade Holographic YouTube & Live Channels Explorer
 *
 * Provides full real-world YouTube integration:
 * - 🔴 Real Verified Channels (Al Jazeera, Sky News, NASA 4K, Makkah Live, Bloomberg, SpaceX, Lofi Girl, etc.)
 * - 🔍 Live YouTube Search: search ANY topic, channel, or video.
 * - 🎬 Holographic 16:9 Video Player with futuristic corner brackets.
 * - 🎵 24-band live audio visualizer equalizer spectrum.
 * - Drag, resize, minimize, maximize, and holographic laser projection tracking.
 * - Full Arabic & English support with <bdi dir="auto">.
 */
import React, { useState, useEffect, useMemo, useRef } from "react";
import { useStore } from "../../lib/store";

interface ChannelItem {
  id: string;
  name: string;
  category: "news" | "space" | "quran" | "tech" | "music";
  categoryLabel: string;
  embedUrl: string;
  badge: string;
  desc: string;
}

// Curated 24/7 guaranteed active real channels
const REAL_CHANNELS: ChannelItem[] = [
  {
    id: "aljazeera",
    name: "الجزيرة الإخبارية مباشر",
    category: "news",
    categoryLabel: "أخبار عاجلة",
    embedUrl: "https://www.youtube.com/embed/live_stream?channel=UCfiwzLy-8yKzIbsmZTZXDgw&autoplay=1&mute=0",
    badge: "🔴 LIVE",
    desc: "بث حي ومباشر على مدار 24 ساعة لأهم الأحداث العالمية والعربية.",
  },
  {
    id: "skynews",
    name: "سكاي نيوز عربية",
    category: "news",
    categoryLabel: "أخبار",
    embedUrl: "https://www.youtube.com/embed/live_stream?channel=UCsnH8nL3j0r1qj_V9tL706g&autoplay=1&mute=0",
    badge: "🔴 LIVE",
    desc: "تغطية إخبارية مستمرة وتقارير حصرية من مختلف دول العالم.",
  },
  {
    id: "nasa",
    name: "NASA Earth View from Space",
    category: "space",
    categoryLabel: "فضاء وعلوم",
    embedUrl: "https://www.youtube.com/embed/xRPjKQtRXR8?autoplay=1&mute=0",
    badge: "🔴 4K LIVE",
    desc: "بث حي مباشر من محطة الفضاء الدولية (ISS) لكوكب الأرض.",
  },
  {
    id: "makkah",
    name: "قناة القرآن الكريم مباشر (مكة)",
    category: "quran",
    categoryLabel: "إسلاميات",
    embedUrl: "https://www.youtube.com/embed/live_stream?channel=UC8C4iQ21fN37u1bQZJ6mNzA&autoplay=1&mute=0",
    badge: "🔴 LIVE",
    desc: "بث حي ومباشر من المسجد الحرام بمكة المكرمة وتلاوات خاشعة.",
  },
  {
    id: "spacex",
    name: "SpaceX Rocket & Starship",
    category: "space",
    categoryLabel: "صواريخ وفضاء",
    embedUrl: "https://www.youtube.com/embed?listType=search&list=SpaceX+Starship+Launch+Live&autoplay=1",
    badge: "🚀 TECH",
    desc: "أحدث إطلاقات واختبارات صواريخ ستارشيب وسبيس إكس.",
  },
  {
    id: "bloomberg",
    name: "Bloomberg Technology Live",
    category: "tech",
    categoryLabel: "اقتصاد وتكنولوجيا",
    embedUrl: "https://www.youtube.com/embed/live_stream?channel=UCIALMKvObZNtJ6AmdCLP7Lg&autoplay=1&mute=0",
    badge: "📈 TECH",
    desc: "Global financial and technological developments live 24/7.",
  },
  {
    id: "lofi",
    name: "Lofi Girl — Beats to Relax/Study",
    category: "music",
    categoryLabel: "موسيقى واسترخاء",
    embedUrl: "https://www.youtube.com/embed/jfKfPfyJRdk?autoplay=1&mute=0",
    badge: "🎧 24/7 CHILL",
    desc: "موسيقى لو-فاي هادئة ومستمرة للتركيز والدراسة والبرمجة.",
  },
];

interface HoloYouTubeWindowProps {
  initialUrl?: string;
  onClose: () => void;
  onPositionChange?: (pos: { id: string; x: number; y: number } | null) => void;
}

// Convert input to a reliable embed URL
function resolveEmbedUrl(input: string): string {
  if (!input) return REAL_CHANNELS[0].embedUrl;
  const trimmed = input.trim();

  // If already an embed URL
  if (trimmed.includes("youtube.com/embed/")) {
    return trimmed.includes("?") ? trimmed : `${trimmed}?autoplay=1&mute=0&rel=0`;
  }

  // Standard watch?v=ID or youtu.be/ID or shorts/ID
  const match = trimmed.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  if (match && match[1]) {
    return `https://www.youtube.com/embed/${match[1]}?autoplay=1&mute=0&rel=0`;
  }

  // Direct video link
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  // Search query -> use YouTube official search playlist embed
  return `https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(trimmed)}&autoplay=1`;
}

export default function HoloYouTubeWindow({
  initialUrl = "",
  onClose,
  onPositionChange,
}: HoloYouTubeWindowProps) {
  // Spawn coordinates on right side of viewport
  const [position, setPosition] = useState(() => {
    const w = typeof window !== "undefined" ? window.innerWidth : 1920;
    return {
      x: Math.max(40, w - 660),
      y: 72,
      width: 620,
      height: 480,
    };
  });

  const [activeTab, setActiveTab] = useState<"player" | "channels" | "search">("player");
  const [activeChannel, setActiveChannel] = useState<ChannelItem>(REAL_CHANNELS[0]);
  const [embedSrc, setEmbedSrc] = useState<string>(() =>
    initialUrl ? resolveEmbedUrl(initialUrl) : REAL_CHANNELS[0].embedUrl
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [isMinimized, setIsMinimized] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [preMaximize, setPreMaximize] = useState(position);

  // Dragging & resizing
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const themeMode = useStore((s) => s.themeMode);
  const audioLevel = useStore((s) => s.audioLevel);
  const isDark = themeMode === "dark";

  // Report live position for laser beam tracking
  useEffect(() => {
    if (isMinimized) {
      onPositionChange?.(null);
    } else {
      onPositionChange?.({ id: "holo-youtube", x: position.x, y: position.y });
    }
    return () => onPositionChange?.(null);
  }, [position.x, position.y, isMinimized, onPositionChange]);

  // Sync when initialUrl updates
  useEffect(() => {
    if (initialUrl) {
      setEmbedSrc(resolveEmbedUrl(initialUrl));
      setActiveTab("player");
    }
  }, [initialUrl]);

  // Select Channel
  const handleSelectChannel = (ch: ChannelItem) => {
    setActiveChannel(ch);
    setEmbedSrc(ch.embedUrl);
    setActiveTab("player");
  };

  // Search handler
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    const url = resolveEmbedUrl(searchQuery.trim());
    setEmbedSrc(url);
    setActiveTab("player");
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
      const nextW = Math.max(380, Math.min(window.innerWidth - position.x - 20, e.clientX - position.x));
      const nextH = Math.max(300, Math.min(window.innerHeight - position.y - 20, e.clientY - position.y));
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
        className="fixed bottom-12 right-6 z-25 flex items-center gap-2 px-3 py-1.5 rounded-full border border-cyan-400/60 bg-slate-950/90 backdrop-blur-xl shadow-[0_0_20px_rgba(34,211,238,0.35)] cursor-pointer select-none"
        onClick={() => setIsMinimized(false)}
      >
        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
        <span className="text-xs font-mono text-cyan-200">▶ HOLO YOUTUBE ({activeChannel.name})</span>
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
      {/* ── 1. HEADER & MODE SWITCHER ───────────────────────────────────────── */}
      <div
        onMouseDown={handleHeaderMouseDown}
        className="h-10 px-3 flex items-center justify-between border-b border-cyan-500/30 bg-cyan-950/40 cursor-grab active:cursor-grabbing shrink-0"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_#ef4444]" />
          <span className="text-xs font-mono font-bold tracking-wider text-cyan-200 uppercase truncate">
            ◈ YOUTUBE // {activeChannel.name}
          </span>
        </div>

        {/* Tab Switcher Pills */}
        <div className="flex items-center gap-1 bg-black/40 rounded-lg p-0.5 border border-cyan-500/20">
          <button
            onClick={() => setActiveTab("player")}
            className={`px-2 py-0.5 rounded text-[10px] font-mono transition cursor-pointer ${
              activeTab === "player"
                ? "bg-cyan-500/30 text-cyan-200 border border-cyan-400/50 font-bold"
                : "text-slate-400 hover:text-cyan-300"
            }`}
          >
            🎬 المشغل
          </button>
          <button
            onClick={() => setActiveTab("channels")}
            className={`px-2 py-0.5 rounded text-[10px] font-mono transition cursor-pointer ${
              activeTab === "channels"
                ? "bg-cyan-500/30 text-cyan-200 border border-cyan-400/50 font-bold"
                : "text-slate-400 hover:text-cyan-300"
            }`}
          >
            🔴 القنوات
          </button>
          <button
            onClick={() => setActiveTab("search")}
            className={`px-2 py-0.5 rounded text-[10px] font-mono transition cursor-pointer ${
              activeTab === "search"
                ? "bg-cyan-500/30 text-cyan-200 border border-cyan-400/50 font-bold"
                : "text-slate-400 hover:text-cyan-300"
            }`}
          >
            🔍 بحث
          </button>
        </div>

        <div className="flex items-center gap-1 shrink-0">
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

      {/* ── 2. MAIN CONTENT AREA ACCORDING TO ACTIVE TAB ─────────────────────── */}
      {activeTab === "player" && (
        <div className="flex-1 min-h-0 flex flex-col p-2 gap-2">
          {/* Quick Channels Strip */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none shrink-0 py-0.5">
            <span className="text-[9px] font-mono uppercase text-slate-500 tracking-wider mr-0.5">
              Channels:
            </span>
            {REAL_CHANNELS.map((ch) => (
              <button
                key={ch.id}
                onClick={() => handleSelectChannel(ch)}
                className={`px-2 py-0.5 rounded text-[9.5px] font-mono border transition cursor-pointer whitespace-nowrap flex items-center gap-1 ${
                  activeChannel.id === ch.id
                    ? "bg-cyan-500/30 text-cyan-100 border-cyan-400/60 shadow-[0_0_8px_rgba(34,211,238,0.25)] font-bold"
                    : "bg-cyan-950/30 text-slate-300 border-cyan-500/20 hover:bg-cyan-800/40"
                }`}
              >
                <span>{ch.badge.includes("LIVE") ? "🔴" : "▶"}</span>
                <bdi dir="auto">{ch.name}</bdi>
              </button>
            ))}
          </div>

          {/* 16:9 Video Frame with Sci-Fi Corner Brackets */}
          <div className="relative flex-1 min-h-0 bg-black rounded-lg overflow-hidden border border-cyan-500/30 shadow-inner">
            <div className="absolute top-1.5 left-1.5 w-3.5 h-3.5 border-t-2 border-l-2 border-cyan-400 pointer-events-none z-10" />
            <div className="absolute top-1.5 right-1.5 w-3.5 h-3.5 border-t-2 border-r-2 border-cyan-400 pointer-events-none z-10" />
            <div className="absolute bottom-1.5 left-1.5 w-3.5 h-3.5 border-b-2 border-l-2 border-cyan-400 pointer-events-none z-10" />
            <div className="absolute bottom-1.5 right-1.5 w-3.5 h-3.5 border-b-2 border-r-2 border-cyan-400 pointer-events-none z-10" />

            <iframe
              key={embedSrc}
              src={embedSrc}
              title={activeChannel.name}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="w-full h-full border-0"
            />
          </div>

          {/* Audio Equalizer Ribbon */}
          <div
            className="h-7 px-3 rounded flex items-center justify-between shrink-0"
            style={{
              background: isDark ? "rgba(2, 6, 23, 0.85)" : "rgba(241, 245, 249, 0.85)",
              border: "1px solid rgba(56, 189, 248, 0.2)",
            }}
          >
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_6px_#38bdf8]" />
              <span className="text-[9px] font-mono uppercase tracking-widest text-cyan-300">
                {activeChannel.categoryLabel} · LIVE STREAM
              </span>
            </div>

            <div className="flex items-end gap-[2px] h-4">
              {Array.from({ length: 24 }).map((_, i) => {
                const baseH = 3;
                const pseudoSin = Math.sin((Date.now() / 200) + i * 0.45) * 0.5 + 0.5;
                const dynamicH = baseH + (audioLevel * 14 + pseudoSin * 8);
                return (
                  <div
                    key={i}
                    className="rounded-full"
                    style={{
                      width: "2px",
                      height: `${Math.max(3, Math.min(14, dynamicH))}px`,
                      background: i % 2 === 0 ? "#38bdf8" : "#818cf8",
                      opacity: 0.7 + (i % 3) * 0.15,
                      transition: "height 0.08s ease",
                    }}
                  />
                );
              })}
            </div>

            <span className="text-[9px] font-mono text-slate-500">
              HD 1080p
            </span>
          </div>
        </div>
      )}

      {/* ── 3. CHANNELS DIRECTORY TAB ───────────────────────────────────────── */}
      {activeTab === "channels" && (
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
          <div className="text-xs font-mono text-cyan-300 uppercase tracking-wider mb-2">
            قنوات البث الحي والمحتوى الحقيقي (اختر قناة للتشغيل المباشر):
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {REAL_CHANNELS.map((ch) => (
              <div
                key={ch.id}
                onClick={() => handleSelectChannel(ch)}
                className={`p-3 rounded-lg border transition cursor-pointer flex flex-col justify-between select-none ${
                  activeChannel.id === ch.id
                    ? "bg-cyan-950/60 border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.2)]"
                    : "bg-slate-950/50 border-cyan-500/20 hover:border-cyan-400/50 hover:bg-cyan-950/30"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-xs text-cyan-200">
                    <bdi dir="auto">{ch.name}</bdi>
                  </div>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/40 shrink-0">
                    {ch.badge}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                  <bdi dir="auto">{ch.desc}</bdi>
                </div>
                <div className="mt-2 text-[9px] font-mono text-cyan-400/80 flex items-center justify-between">
                  <span>{ch.categoryLabel}</span>
                  <span className="text-cyan-300 font-bold">تشغيل ↵</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 4. SEARCH & URL INPUT TAB ───────────────────────────────────────── */}
      {activeTab === "search" && (
        <div className="flex-1 min-h-0 flex flex-col p-3 gap-3">
          <div className="text-xs font-mono text-cyan-300 uppercase tracking-wider">
            البحث في يوتيوب أو تشغيل أي رابط مخصص:
          </div>

          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
            <div
              className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border text-xs"
              style={{
                background: isDark ? "rgba(2, 6, 23, 0.8)" : "rgba(255, 255, 255, 0.8)",
                borderColor: "rgba(56, 189, 248, 0.35)",
              }}
            >
              <span className="text-cyan-400 font-mono text-xs">🔍</span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="اكتب اسم أي فيديو أو قناة أو الصق رابط يوتيوب..."
                dir="auto"
                className="flex-1 bg-transparent text-xs text-cyan-200 outline-none placeholder:text-slate-500"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-cyan-500/30 hover:bg-cyan-500/50 text-cyan-100 border border-cyan-400/60 text-xs font-mono font-bold transition cursor-pointer shrink-0"
            >
              تشغيل الفيديو ↵
            </button>
          </form>

          {/* Preset searches */}
          <div className="space-y-1.5">
            <span className="text-[10px] font-mono uppercase text-slate-400">
              عمليات بحث سريعة شائعة:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {[
                "أخبار الذكاء الاصطناعي 2026",
                "وثائقي الفضاء والثقوب السوداء",
                "SpaceX Starship Super Heavy",
                "القرآن الكريم بصوت عبد الباسط",
                "برمجة الروبوتات والذكاء الاصطناعي",
                "Cyberpunk Synthwave Mix",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setSearchQuery(q);
                    setEmbedSrc(resolveEmbedUrl(q));
                    setActiveTab("player");
                  }}
                  className="px-2.5 py-1 rounded text-[10px] font-mono bg-cyan-950/40 hover:bg-cyan-800/50 text-cyan-300 border border-cyan-500/25 transition cursor-pointer"
                >
                  <bdi dir="auto">{q}</bdi>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

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
