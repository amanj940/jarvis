/**
 * J.A.R.V.I.S — UNIFIED SINGLE LIVING INTELLIGENCE APPLICATION
 *
 * One unified, clean screen:
 *   - Background: WebSocket connection, live system stats polling, voice profile, streaming TTS listeners.
 *   - Global keyboard shortcuts (Space for mic, Esc for close, F for fullscreen, 1-3 for views).
 *   - Foreground: LivingEntityScreen (pure black cinematic environment, interactive living particle core,
 *     minimal header, contextual dialogue, floating command capsule, and overlay modals).
 *
 * No floating panels, no multi-screen conflicts, zero clutter.
 */
import { useEffect, useRef } from "react";
import LivingEntityScreen from "./components/LivingEntity/LivingEntityScreen";
import { getHealth } from "./lib/api";
import { useStore, nextId } from "./lib/store";
import { refreshVoiceProfile, streamSpeak, mic } from "./lib/voice";
import { wsClient } from "./lib/ws";
import { holoOrchestrator } from "./lib/holoOrchestrator";
import { useSystemStats } from "./lib/useSystemStats";

const GREETING_SESSION_KEY = "jarvis.greeting.sent.v1";

export default function App() {
  // ── 1. Single Source of Truth for Live System Telemetry ──────────────────
  useSystemStats(2500);

  // ── 2. Connect WebSocket & synchronize health / voice profile on launch ──
  useEffect(() => {
    wsClient.connect();
    getHealth()
      .then((h) => useStore.getState().setHealth(h))
      .catch(() => {});
    refreshVoiceProfile();
  }, []);

  // ── 3. Global Keyboard Shortcuts ─────────────────────────────────────────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;

      // 1. Escape: Dismiss topmost layer in priority order (always active even if typing)
      if (e.code === "Escape") {
        const st = useStore.getState();
        if (st.confirmQueue.length > 0) {
          st.popConfirm(st.confirmQueue[0].id);
          return;
        }
        if (st.settingsOpen) {
          st.closeSettings();
          return;
        }
        if (st.projectsOpen) {
          st.closeProjects();
          return;
        }
        if (st.monitorOpen) {
          st.closeMonitor();
          return;
        }
        if (st.holoState.active) {
          st.dismissHolo("esc_key");
          return;
        }
        return;
      }

      // 2. Typing Guard: ignore shortcuts while typing in inputs, textareas, selects, or modal dialogs
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable ||
          Boolean(target.closest('[role="dialog"]')))
      ) {
        return;
      }

      // 3. Modal Guard: ignore Space, F, 1-3 when Settings, Projects, or ConfirmModal are active
      const st = useStore.getState();
      const anyModalOpen =
        st.settingsOpen ||
        st.projectsOpen ||
        st.confirmQueue.length > 0 ||
        Boolean(document.querySelector('[role="dialog"]'));

      if (anyModalOpen) {
        return;
      }

      // 4. Clickable Elements Guard: Space must activate buttons/links/summaries without toggling mic
      const isClickable = Boolean(
        target &&
          (target.tagName === "BUTTON" ||
            target.tagName === "A" ||
            target.tagName === "SUMMARY" ||
            target.getAttribute("role") === "button" ||
            target.closest('button, a, summary, [role="button"]'))
      );

      // Space: Toggle microphone (when not typing or activating buttons)
      if (e.code === "Space" && !e.repeat) {
        if (isClickable) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("jarvis:toggle-mic"));
        return;
      }

      // F: Toggle Fullscreen
      if (e.code === "KeyF" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
        return;
      }

      // Number keys 1-3: Quick display mode toggle
      if (e.code === "Digit1") {
        if (st.holoState.active) st.dismissHolo("key_1");
        if (st.monitorOpen) st.closeMonitor();
      } else if (e.code === "Digit2") {
        st.openHolo({ active: true, modelId: "cpu", mode: "anatomy3d" });
      } else if (e.code === "Digit3") {
        if (st.monitorOpen) {
          st.closeMonitor();
        } else {
          st.openMonitor("anatomy3d", "cpu");
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // ── 4. Streaming assistant speech listener ───────────────────────────────
  useEffect(() => {
    let lastId = "";
    let lastLen = 0;
    let lastSpokenFinal = false;

    return useStore.subscribe((state) => {
      const last = state.chat[state.chat.length - 1];
      if (!last || last.role !== "assistant") return;
      if (last.id !== lastId) {
        lastId = last.id;
        lastLen = 0;
        lastSpokenFinal = false;
      }
      if (lastSpokenFinal) return;
      const grew = last.text.length !== lastLen;
      lastLen = last.text.length;
      const isFinal = !last.streaming;
      if (grew || isFinal) {
        if (isFinal) {
          lastSpokenFinal = true;
          holoOrchestrator.processUtterance(last.text, "assistant");
        } else if (grew && last.text.length > 20) {
          holoOrchestrator.processUtterance(last.text, "assistant");
        }
        streamSpeak(last.id, last.text, isFinal);
      }
    });
  }, []);

  // ── 5. One-shot, time-aware greeting once boot sequence completes ────────
  const pushChat = useStore((s) => s.pushChat);
  const booted = useStore((s) => s.booted);
  const greetedRef = useRef(false);

  useEffect(() => {
    if (!booted || greetedRef.current) return;
    greetedRef.current = true;
    const h = new Date().getHours();
    const part = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
    const text = `Good ${part}, sir. All systems are online and at your service.`;
    try {
      if (sessionStorage.getItem(GREETING_SESSION_KEY) === "1") return;
      sessionStorage.setItem(GREETING_SESSION_KEY, "1");
    } catch {
      /* noop */
    }

    const t = setTimeout(() => {
      pushChat({ id: nextId(), role: "assistant", text, ts: Date.now() });
    }, 600);
    return () => clearTimeout(t);
  }, [booted, pushChat]);

  // ── 6. Unified Single Screen: Minimal Living Intelligence Interface ──────
  return <LivingEntityScreen />;
}
