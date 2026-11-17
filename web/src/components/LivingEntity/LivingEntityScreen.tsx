/**
 * JARVIS — MINIMAL LIVING INTELLIGENCE SCREEN
 *
 * An ultra-clean, cinematic, elegant AI entity interface.
 *
 * Characteristics:
 *   - Deep obsidian black background with subtle midnight depth.
 *   - Interactive central LivingEntityCore particle cluster.
 *   - Minimal, non-intrusive top header with few essential controls.
 *   - Contextual dialogue overlay: appears during speech/conversation and
 *     fades away during prolonged idle to keep the screen serene and clean.
 *   - Contextual tool execution pills that glow only during real task dispatch.
 *   - Floating minimal command capsule at bottom.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore, nextId, type MediaCard } from "../../lib/store";
import { wsClient } from "../../lib/ws";
import { mic } from "../../lib/voice";
import LivingEntityCore from "./LivingEntityCore";
import Settings from "../HUD/Settings";
import ConfirmModal from "../Tools/ConfirmModal";
import WorkspacesModal from "../HUD/WorkspacesModal";
import BootSequence from "../Boot/BootSequence";
import Model3DViewer from "../Media/Model3DViewer";
import NeuralGalaxy from "../Media/NeuralGalaxy";
import { holoOrchestrator } from "../../lib/holoOrchestrator";
import ChatSidebar from "./ChatSidebar";
import HudBackdrop from "./HudBackdrop";


export default function LivingEntityScreen() {
  const orbState = useStore((s) => s.orbState);
  const pushChat = useStore((s) => s.pushChat);
  const connected = useStore((s) => s.connected);
  const voiceEnabled = useStore((s) => s.voiceEnabled);
  const setVoiceEnabled = useStore((s) => s.setVoiceEnabled);
  const micEnabled = useStore((s) => s.micEnabled);
  const setWakeEnabled = useStore((s) => s.setWakeEnabled);
  const tools = useStore((s) => s.tools);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const openSettings = useStore((s) => s.openSettings);
  const closeSettings = useStore((s) => s.closeSettings);
  const settingsTab = useStore((s) => s.settingsTab);
  const projectsOpen = useStore((s) => s.projectsOpen);
  const openProjects = useStore((s) => s.openProjects);
  const closeProjects = useStore((s) => s.closeProjects);
  const health = useStore((s) => s.health);
  const liveVoice = useStore((s) => s.liveVoice);
  const swarms = useStore((s) => s.swarms);
  const activeSwarmCount = swarms.filter((s) => s.active).length;
  const media = useStore((s) => s.media);

  // Input & layout state
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [viewingMediaCard, setViewingMediaCard] = useState<MediaCard | null>(null);

  const threeDMedia = useMemo(() => {
    return media.filter((m) => m.kind === "model3d" || m.kind === "galaxy");
  }, [media]);

  // Global ESC key to close any active modal
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (viewingMediaCard) setViewingMediaCard(null);
        else if (settingsOpen) closeSettings();
        else if (projectsOpen) closeProjects();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [viewingMediaCard, settingsOpen, projectsOpen, closeSettings, closeProjects]);

  // Active running tool (if any)
  const activeTool = tools.slice().reverse().find((t) => t.status === "running" || t.status === "proposed");

  // Send message handler
  const send = useCallback(() => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");
    const id = nextId();
    pushChat({ id, role: "user", text, ts: Date.now() });

    holoOrchestrator.processUtterance(text, "user");

    try {
      wsClient.chat(text);
    } catch {
      pushChat({ id: nextId(), role: "error", text: "⚠️ Connection error", ts: Date.now() });
    }
    setSending(false);
  }, [input, sending, pushChat]);

  // Mic toggle — switches live voice conversation mode
  const toggleMic = async () => {
    if (micEnabled) {
      mic.stop();
      useStore.getState().setLiveVoice(false);
      setWakeEnabled(false);
    } else {
      setWakeEnabled(true);
      useStore.getState().setLiveVoice(true);
      await mic.start(
        (text, isFinal) => {
          if (isFinal && text.trim()) {
            const trimmed = text.trim();
            pushChat({ id: nextId(), role: "user", text: trimmed, ts: Date.now() });
            holoOrchestrator.processUtterance(trimmed, "user");
            wsClient.chat(trimmed);
            setInput("");
          } else {
            setInput(text);
          }
        },
        () => {
          // wake word detected
        }
      );
    }
  };

  // Listen for global space shortcut or 3D entity click to toggle mic
  useEffect(() => {
    const handler = () => {
      toggleMic();
    };
    window.addEventListener("jarvis:toggle-mic", handler);
    return () => window.removeEventListener("jarvis:toggle-mic", handler);
  }, [toggleMic]);

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };



  return (
    <div
      className="relative w-screen h-screen overflow-hidden flex flex-col select-none"
      style={{
        background: "radial-gradient(ellipse at 50% 50%, #060e1e 0%, #020409 100%)",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* ── 0. TACTICAL HUD INSTRUMENT GRID ────────────────────────────────── */}
      <HudBackdrop />

      {/* ── 1. MINIMAL HEADER ──────────────────────────────────────────────── */}
      <header className="relative z-30 flex items-center justify-between px-6 py-3.5 pointer-events-auto border-b border-cyan-500/10 bg-slate-950/40 backdrop-blur-md">
        {/* Left: Brand Identity + Live State */}
        <div className="flex items-center gap-3">
          <span
            className="text-xs font-mono font-semibold tracking-[0.35em] uppercase text-cyan-300 transition-all duration-300"
            style={{ textShadow: "0 0 12px rgba(34, 211, 238, 0.45)" }}
          >
            ◈ J.A.R.V.I.S
          </span>
          <span
            className="w-1.5 h-1.5 rounded-full transition-all duration-500"
            style={{
              background: connected ? "#22d3ee" : "#ef4444",
              boxShadow: connected ? "0 0 8px #22d3ee" : "0 0 6px #ef4444",
            }}
            title={connected ? "Connected to Core" : "Core Offline"}
          />
          {orbState !== "idle" && (
            <span className="text-[10px] font-mono text-cyan-400/80 uppercase tracking-widest animate-pulse">
              {orbState}
            </span>
          )}
        </div>

        {/* Center: AI Provider Status Pill / Live Mode Indicator */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 px-3.5 py-1 rounded-full border border-cyan-500/20 bg-slate-900/60 backdrop-blur-md text-[10px] font-mono">
          {liveVoice ? (
            <div className="flex items-center gap-2 text-emerald-300 font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span>🎙️ LIVE VOICE · محادثة حية نشطة</span>
              <span className="text-cyan-500/60">|</span>
              <span className="text-slate-400 font-normal">قل "jarvis stop" للإنهاء</span>
            </div>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-slate-300">
                {health?.model?.provider?.toUpperCase() || "AI"} · {health?.model?.model || ""}
              </span>
              <span className="text-cyan-500/60">|</span>
              <span className="text-slate-400">🔊 {voiceEnabled ? "Hamed Neural" : "صامت"}</span>
            </>
          )}
        </div>

        {/* Right: High-Tech Controls */}
        <div className="flex items-center gap-2 text-slate-300">


          {/* 3D Media / Galaxy indicator if available */}
          {threeDMedia.length > 0 && (
            <button
              onClick={() => setViewingMediaCard(threeDMedia[0])}
              className="px-2.5 py-1 rounded-full border border-purple-500/40 bg-purple-950/40 text-xs hover:text-purple-200 hover:border-purple-400 transition flex items-center gap-1.5 cursor-pointer shadow-[0_0_10px_rgba(168,85,247,0.25)]"
              title="عناصر مجسمات 3D وذاكرة سحابية متاحة"
            >
              <span>🌌</span>
              <span className="text-[10px] font-mono text-purple-300">مجسمات ({threeDMedia.length})</span>
            </button>
          )}

          {/* Audio toggle */}
          <button
            onClick={() => setVoiceEnabled(!voiceEnabled)}
            className="px-2.5 py-1 rounded-full border border-slate-800 bg-slate-900/60 text-xs hover:text-cyan-300 hover:border-cyan-500/40 transition flex items-center gap-1.5 cursor-pointer shadow-sm"
            title={voiceEnabled ? "كتم الصوت (Mute Voice)" : "تفعيل الصوت (Enable Voice)"}
          >
            <span>{voiceEnabled ? "🔊" : "🔇"}</span>
            <span className="text-[10px] font-mono text-slate-400">{voiceEnabled ? "صوت" : "صامت"}</span>
          </button>

          {/* Projects workspace browser */}
          <button
            onClick={openProjects}
            className="px-2.5 py-1 rounded-full border border-slate-800 bg-slate-900/60 text-xs hover:text-cyan-300 hover:border-cyan-500/40 transition flex items-center gap-1.5 cursor-pointer shadow-sm"
            title="مستعرض المشاريع (27 مشروعاً)"
          >
            <span>📁</span>
            <span className="text-[10px] font-mono text-slate-400">مشاريع (27)</span>
          </button>

          {/* AI Council quick launch */}
          <button
            onClick={() => openSettings("ai")}
            className="px-2.5 py-1 rounded-full border border-purple-700/50 bg-purple-950/40 text-xs hover:text-purple-200 hover:border-purple-500/70 transition flex items-center gap-1.5 cursor-pointer shadow-sm"
            title="مجلس النماذج — AI Council"
          >
            <span>🏛️</span>
            <span className="text-[10px] font-mono text-purple-300">المجلس</span>
          </button>

          {/* Active Swarm live badge — only visible when agents are running */}
          {activeSwarmCount > 0 && (
            <button
              onClick={() => openSettings("ai")}
              className="px-2.5 py-1 rounded-full border border-cyan-500/60 bg-cyan-950/50 text-xs text-cyan-200 flex items-center gap-1.5 cursor-pointer shadow-[0_0_12px_rgba(34,211,238,0.4)] animate-pulse"
              title={`سرب نشط: ${activeSwarmCount} وكيل`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 inline-block" />
              <span className="text-[10px] font-mono">🐝 سرب ({activeSwarmCount})</span>
            </button>
          )}

          {/* Settings */}
          <button
            onClick={() => openSettings("ai")}
            className="px-2.5 py-1 rounded-full border border-slate-800 bg-slate-900/60 text-xs hover:text-cyan-300 hover:border-cyan-500/40 transition flex items-center gap-1.5 cursor-pointer shadow-sm"
            title="الإعدادات والذكاء الاصطناعي"
          >
            <span>⚙</span>
            <span className="text-[10px] font-mono text-slate-400">إعدادات</span>
          </button>


          {/* Fullscreen toggle */}
          <button
            onClick={toggleFullscreen}
            className="w-8 h-7 rounded-full border border-slate-800 bg-slate-900/60 text-xs hover:text-cyan-300 hover:border-cyan-500/40 transition flex items-center justify-center cursor-pointer shadow-sm"
            title={isFullscreen ? "تصغير الشاشة" : "ملء الشاشة"}
          >
            {isFullscreen ? "↙" : "⛶"}
          </button>
        </div>
      </header>

      {/* ── 2. UNIFIED MAIN STAGE — Left Sidebar + Center Stage ─────────────── */}
      <main className="relative flex-1 w-full min-h-0 flex flex-row overflow-hidden">
        {/* Left: Dedicated Communications Link Sidebar (z-dialogue: 25) */}
        <ChatSidebar
          input={input}
          setInput={setInput}
          sending={sending}
          onSend={send}
          micEnabled={micEnabled}
          liveVoice={liveVoice}
          toggleMic={toggleMic}
          collapsed={chatCollapsed}
          onToggleCollapse={() => setChatCollapsed(!chatCollapsed)}
        />

        {/* Center: Living Entity Canvas + HUD Rings + Right Telemetry Dock */}
        <div className="flex-1 h-full relative overflow-hidden flex items-center justify-center">
          <LivingEntityCore />

          {/* Active Tool Execution Pill */}
          {activeTool && (
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-28 z-dialogue pointer-events-none flex items-center gap-2 px-3 py-1 rounded-full border border-cyan-400/30 text-[11px] font-mono text-cyan-200 animate-pulse"
              style={{
                background: "rgba(6, 20, 45, 0.75)",
                backdropFilter: "blur(8px)",
                boxShadow: "0 0 16px rgba(34, 211, 238, 0.25)",
              }}
            >
              <span className="text-cyan-400">⚡</span>
              <span>{activeTool.preview || activeTool.tool}</span>
            </div>
          )}
        </div>
      </main>

      {/* ── 3. PRESERVED OVERLAY MODALS (z-modal: 50) ────────────────────────── */}
      {viewingMediaCard && (
        <div className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-xl animate-fadeIn">
          <div className="relative w-full max-w-4xl h-[80vh] flex flex-col rounded-3xl border border-cyan-500/40 bg-slate-950/95 shadow-[0_0_40px_rgba(34,211,238,0.3)] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-cyan-500/20 bg-slate-900/80">
              <div className="flex items-center gap-2 text-sm font-semibold text-cyan-200">
                <span>{viewingMediaCard.kind === "galaxy" ? "🌌" : "🧊"}</span>
                <span>{viewingMediaCard.summary || (viewingMediaCard.kind === "galaxy" ? "خريطة الذاكرة العصبية ثلاثية الأبعاد" : "مجسم 3D GLB")}</span>
              </div>
              <button
                onClick={() => setViewingMediaCard(null)}
                className="w-7 h-7 rounded-lg bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 relative min-h-0">
              {viewingMediaCard.kind === "galaxy" ? (
                <NeuralGalaxy card={viewingMediaCard} large />
              ) : (
                <Model3DViewer item={viewingMediaCard.items[0]} large />
              )}
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="fixed inset-0 z-modal">
          <Settings onClose={closeSettings} initialTab={settingsTab} />
        </div>
      )}
      {projectsOpen && <WorkspacesModal onClose={closeProjects} />}
      <ConfirmModal />
      <BootSequence />
    </div>
  );
}
