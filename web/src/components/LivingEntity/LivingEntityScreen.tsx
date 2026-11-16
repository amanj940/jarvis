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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore, nextId, type ChatEntry, type MediaCard } from "../../lib/store";
import { wsClient } from "../../lib/ws";
import { mic } from "../../lib/voice";
import LivingEntityCore from "./LivingEntityCore";
import Settings from "../HUD/Settings";
import ConfirmModal from "../Tools/ConfirmModal";
import WorkspacesModal from "../HUD/WorkspacesModal";
import BootSequence from "../Boot/BootSequence";
import EngineeringMonitor from "../HUD/EngineeringMonitor";
import Model3DViewer from "../Media/Model3DViewer";
import NeuralGalaxy from "../Media/NeuralGalaxy";
import { holoOrchestrator } from "../../lib/holoOrchestrator";
import ChatDialogue from "./ChatDialogue";
import HudBackdrop from "./HudBackdrop";
import HudConnectorLines from "./HudConnectorLines";
import { useReducedMotion } from "../../lib/useReducedMotion";


// ── Topic-Driven 3D Holographic Detection Engine ───────────────────────────
interface TopicMatch {
  key: string;
  icon: string;
  title: string;
  mode: "anatomy3d" | "blueprint" | "edu";
  target?: string;
  reason: string;
}

function detectTopicInText(text: string): TopicMatch | null {
  if (!text) return null;
  const t = text.toLowerCase();

  // 1. CPU / Hardware Die Anatomy / Pipeline
  if (/معالج|بروسيسور|cpu|intel|core i3|عتاد|كاش|cache|سليكون|أنوية|تردد|نواة|ihs|المعمارية/i.test(t)) {
    if (/كيف يعمل|دورة تنفيذ|pipeline|instruction|شرح خطوات/i.test(t)) {
      return {
        key: "cpu_edu",
        icon: "🎬",
        title: "درس تفاعلي: دورة تنفيذ الأوامر داخل المعالج",
        mode: "edu",
        target: "cpu_pipeline",
        reason: "شرح مسار الأوامر خطوة بخطوة",
      };
    }
    return {
      key: "cpu",
      icon: "🖥️",
      title: "تشريح معالج Intel Core i3 والأنوية",
      mode: "anatomy3d",
      target: "cpu",
      reason: "تفكيك طبقات المعالج وكاش L3 وأنوية السيليكون",
    };
  }

  // 2. Neural Transformer / AI Core / LLM Thinking
  if (/محولات|transformer|عصبي|انتباه|attention|ذكاء اصطناعي|شبكة عصبية|أوزان|weights|llm|تضمين|embedding|softmax/i.test(t)) {
    if (/كيف يفكر|تفكير الذكاء|توليد الكلمات|thinking/i.test(t)) {
      return {
        key: "neural_edu",
        icon: "🎓",
        title: "درس تفاعلي: كيف يفكر الذكاء الاصطناعي",
        mode: "edu",
        target: "ai_thinking",
        reason: "تفكيك مراحل التفكير في النماذج اللغوية",
      };
    }
    return {
      key: "neural",
      icon: "🧠",
      title: "تشريح مصفوفة المحولات العصبية (Transformer)",
      mode: "anatomy3d",
      target: "neural",
      reason: "تفكيك رؤوس الانتباه وطبقات التغذية الأمامية",
    };
  }

  // 3. Arc Reactor / Fusion Energy
  if (/مفاعل|reactor|arc reactor|اندماج|fusion|بلازما|plasma|طاقة هولوغرافية|حلقة التفاعل/i.test(t)) {
    return {
      key: "reactor",
      icon: "⚡",
      title: "تشريح مفاعل الطاقة الهولوغرافي Arc Reactor",
      mode: "anatomy3d",
      target: "reactor",
      reason: "تفكيك ملفات الاحتواء المغناطيسي وحلقة البلازما",
    };
  }

  // 4. Linux OS / Kernel Architecture
  if (/لينكس|linux|نواة لينكس|kernel|نظام التشغيل|fedora|systemd/i.test(t)) {
    return {
      key: "os",
      icon: "🐧",
      title: "تشريح معماري لنواة لينكس وإدارة الخدمات",
      mode: "edu",
      target: "os_architecture",
      reason: "تفكيك طبقات Ring 0 و Systemd ومساحة المستخدم",
    };
  }

  // 5. Schematics / Blueprints
  if (/مخطط|مخططات|blueprint|blueprints|دوائر|هندسة النظام|schematic/i.test(t)) {
    return {
      key: "blueprint",
      icon: "📐",
      title: "المخطط الهيكلي والدوائر الهندسية",
      mode: "blueprint",
      reason: "عرض تدفق البيانات وتوزيع الأنظمة",
    };
  }

  // 6. Generic 3D / Anatomy request
  if (/3d|ثلاثي الأبعاد|تشريح|مجسم|مجسمات|هولوغرام|holo|anatomy/i.test(t)) {
    return {
      key: "cpu_default",
      icon: "🔬",
      title: "المعرض التشريحي ثلاثي الأبعاد",
      mode: "anatomy3d",
      target: "cpu",
      reason: "استعراض المجسمات الهندسية التفاعلية",
    };
  }

  return null;
}

export default function LivingEntityScreen() {
  const orbState = useStore((s) => s.orbState);
  const chat = useStore((s) => s.chat);
  const pushChat = useStore((s) => s.pushChat);
  const connected = useStore((s) => s.connected);
  const voiceEnabled = useStore((s) => s.voiceEnabled);
  const setVoiceEnabled = useStore((s) => s.setVoiceEnabled);
  const micEnabled = useStore((s) => s.micEnabled);
  const setWakeEnabled = useStore((s) => s.setWakeEnabled);
  const micStatus = useStore((s) => s.micStatus);
  const tools = useStore((s) => s.tools);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const openSettings = useStore((s) => s.openSettings);
  const closeSettings = useStore((s) => s.closeSettings);
  const settingsTab = useStore((s) => s.settingsTab);
  const projectsOpen = useStore((s) => s.projectsOpen);
  const openProjects = useStore((s) => s.openProjects);
  const closeProjects = useStore((s) => s.closeProjects);
  const setShellMode = useStore((s) => s.setShellMode);
  const health = useStore((s) => s.health);
  const liveVoice = useStore((s) => s.liveVoice);
  const micMode = useStore((s) => s.micMode);
  const swarms = useStore((s) => s.swarms);
  const activeSwarmCount = swarms.filter((s) => s.active).length;

  // Holo-Engineering Monitor & Media
  const monitorOpen = useStore((s) => s.monitorOpen);
  const openMonitor = useStore((s) => s.openMonitor);
  const closeMonitor = useStore((s) => s.closeMonitor);
  const holoState = useStore((s) => s.holoState);
  const media = useStore((s) => s.media);
  const reducedMotion = useReducedMotion();

  // Input state
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);


  // Topic tracking & 3D media preview
  const [dismissedTopicKey, setDismissedTopicKey] = useState<string | null>(null);
  const [viewingMediaCard, setViewingMediaCard] = useState<MediaCard | null>(null);

  const threeDMedia = useMemo(() => {
    return media.filter((m) => m.kind === "model3d" || m.kind === "galaxy");
  }, [media]);

  // Contextual dialogue visibility timer
  const [dialogueVisible, setDialogueVisible] = useState(false);
  const fadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);


  // Analyze latest message for topic-based holographic projection
  const latestMessage = chat.length > 0 ? chat[chat.length - 1] : null;
  const topicSuggestion = useMemo(() => {
    if (!latestMessage) return null;
    return detectTopicInText(latestMessage.text);
  }, [latestMessage]);

  // Direct 3D launcher on explicit command
  const checkAndLaunchDirect3d = useCallback(
    (text: string): boolean => {
      const match = detectTopicInText(text);
      if (!match) return false;
      if (/افتح|اعرض|شغل|وريني|عرض|show|open|launch|display|3d|تشريح|مجسم|هولوغرام|مونيتر/i.test(text)) {
        openMonitor(match.mode, match.target);
        return true;
      }
      return false;
    },
    [openMonitor]
  );

  // Global ESC key to close any active 3D monitor or modal
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (viewingMediaCard) setViewingMediaCard(null);
        else if (monitorOpen) closeMonitor();
        else if (settingsOpen) closeSettings();
        else if (projectsOpen) closeProjects();
        else if (dialogueVisible) setDialogueVisible(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [viewingMediaCard, monitorOpen, settingsOpen, projectsOpen, dialogueVisible, closeMonitor, closeSettings, closeProjects]);

  // When new messages arrive or when state changes to speaking/thinking, make dialogue visible
  useEffect(() => {
    if (chat.length > 0) {
      setDialogueVisible(true);
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);

      // Auto-fade dialogue after 35 seconds of idle silence

      if (orbState === "idle") {
        fadeTimeoutRef.current = setTimeout(() => {
          setDialogueVisible(false);
        }, 35000);
      }
    }
  }, [chat, orbState]);

  // Active running tool (if any)
  const activeTool = tools.slice().reverse().find((t) => t.status === "running" || t.status === "proposed");

  // Send message handler
  const send = useCallback(() => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");
    setDialogueVisible(true);
    const id = nextId();
    pushChat({ id, role: "user", text, ts: Date.now() });

    // Autonomous holographic orchestrator — processes utterance for context-aware 3D projection
    holoOrchestrator.processUtterance(text, "user");

    try {
      wsClient.chat(text);
    } catch {
      pushChat({ id: nextId(), role: "error", text: "⚠️ Connection error", ts: Date.now() });
    }
    setSending(false);
  }, [input, sending, pushChat]);

  // Key press
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      send();
    }
  };

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
            setDialogueVisible(true);
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

        {/* Right: Refined High-Tech Controls */}
        <div className="flex items-center gap-2 text-slate-300">
          {/* 3D Holo Anatomy Inspector */}
          <button
            onClick={() => (monitorOpen ? closeMonitor() : openMonitor("anatomy3d", "cpu"))}
            className={`px-2.5 py-1 rounded-full border text-xs transition flex items-center gap-1.5 cursor-pointer ${
              monitorOpen
                ? "bg-cyan-500/30 border-cyan-400 text-cyan-100 shadow-[0_0_15px_rgba(34,211,238,0.5)]"
                : "border-cyan-500/40 bg-cyan-950/40 text-cyan-300 hover:text-cyan-200 hover:border-cyan-400 hover:bg-cyan-900/50"
            }`}
            title={monitorOpen ? "إغلاق العرض الهولوغرافي" : "فتح العرض الهولوغرافي ثلاثي الأبعاد"}
          >
            <span className="text-cyan-400 animate-pulse text-xs">🔬</span>
            <span className="text-[10px] font-mono font-semibold">3D تشريح</span>
          </button>


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

      {/* ── 2. UNIFIED MAIN STAGE — Sphere + Holo Panel on ONE screen ─────── */}
      <main className="relative flex-1 w-full min-h-0 flex flex-row overflow-hidden">
        {/* Tactical HUD Ray Connector Lines (Panels to Entity Center) */}
        <HudConnectorLines reducedMotion={reducedMotion} />

        {/* ── LEFT: Living Entity Particle Sphere (always visible) ─────────── */}
        <div
          id="living-entity-stage"
          className="relative flex items-center justify-center transition-all duration-700 ease-in-out min-h-0 min-w-0"
          style={{
            flex: monitorOpen ? "0 0 36%" : "1 1 100%",
            width: monitorOpen ? "36%" : "100%",
            maxWidth: monitorOpen ? "36%" : "100%",
          }}
        >
          <LivingEntityCore />

          {/* Active Tool Execution Pill */}
          {activeTool && (
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-28 z-20 pointer-events-none flex items-center gap-2 px-3 py-1 rounded-full border border-cyan-400/30 text-[11px] font-mono text-cyan-200 animate-pulse"
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

        {/* ── RIGHT: Holographic Engineering Panel (slides in on same screen) ─ */}
        {monitorOpen && (
          <div
            className="relative flex-1 min-h-0 border-l border-cyan-500/20 overflow-hidden transition-all duration-700 ease-in-out"
            style={{
              background: "rgba(2, 8, 20, 0.88)",
              backdropFilter: "blur(12px)",
            }}
          >
            <EngineeringMonitor onClose={closeMonitor} embedded={true} />
          </div>
        )}

        {/* ── Contextual Dialogue & Message Bubbles (Fixed Left Dock above Input) ── */}
        <ChatDialogue
          dialogueVisible={dialogueVisible && !holoState.active}
          onDismiss={() => setDialogueVisible(false)}
        />
      </main>

      <footer className="relative z-30 pb-4 pt-1 flex flex-col items-start gap-2 pointer-events-auto pl-4 md:pl-6">


        {/* Command Input Capsule — left side, below bubbles */}
        <div
          className="w-full max-w-[380px] lg:max-w-[440px] flex items-center gap-2.5 px-4 py-2.5 rounded-full border border-cyan-500/25 transition-all duration-300 focus-within:border-cyan-400/60 focus-within:shadow-[0_0_20px_rgba(34,211,238,0.2)] shadow-xl"
          style={{
            background: "rgba(4, 12, 28, 0.75)",
            backdropFilter: "blur(20px)",
          }}
        >
          {/* Microphone Voice Trigger / Live Voice Mode Button */}
          <button
            onClick={toggleMic}
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm transition cursor-pointer flex-shrink-0 ${
              liveVoice
                ? "bg-emerald-500/30 text-emerald-200 border border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.7)] animate-pulse"
                : micEnabled
                ? "bg-cyan-500/30 text-cyan-200 border border-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.6)] animate-pulse"
                : "text-slate-400 hover:text-cyan-300 hover:bg-cyan-500/10"
            }`}
            title={liveVoice ? "المحادثة الحية نشطة · اضغط للإيقاف" : micEnabled ? "المايكروفون يستمع · اضغط للإيقاف" : "بدء المحادثة الحية (أو قل jarvis start)"}
          >
            {liveVoice ? "🟢" : "🎙️"}
          </button>

          {/* Text Input */}
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              liveVoice
                ? "المحادثة الحية نشطة... تحدث بحرية أو قل 'jarvis stop'..."
                : orbState === "listening"
                ? "أنا أسمعك الآن، تفضل بالتحدث..."
                : orbState === "thinking"
                ? "جارٍ التفكير وتحليل الطلب..."
                : "اسأل جارفيس أي شيء، أو قل 'jarvis start'..."
            }
            dir="auto"
            className="flex-1 bg-transparent text-xs text-slate-100 placeholder-slate-500 outline-none font-sans"
            style={{ caretColor: "#22d3ee" }}
          />

          {/* Send Arrow */}
          <button
            onClick={send}
            disabled={!input.trim() || sending}
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm transition cursor-pointer flex-shrink-0 ${
              input.trim() && !sending
                ? "bg-cyan-500/25 text-cyan-200 hover:bg-cyan-500/40 border border-cyan-400/50 shadow-[0_0_10px_rgba(34,211,238,0.4)]"
                : "text-slate-600 cursor-not-allowed"
            }`}
            title="إرسال"
          >
            ⟶
          </button>
        </div>
      </footer>

      {/* ── 5. PRESERVED OVERLAY MODALS ────────────────────────────────────── */}
      {/* Floating 3D Media Viewer (GLB model / Neural Galaxy) */}

      {viewingMediaCard && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-xl animate-fadeIn">
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
        <div className="fixed inset-0 z-[100]">
          <Settings onClose={closeSettings} initialTab={settingsTab} />
        </div>
      )}
      {projectsOpen && <WorkspacesModal onClose={closeProjects} />}
      <ConfirmModal />
      <BootSequence />
    </div>
  );
}
