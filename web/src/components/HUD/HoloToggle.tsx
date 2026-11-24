/**
 * HOLO TOGGLE — header button for the ambient holo rings around the globe.
 *
 * The holo layer (HoloShapes: equatorial ring, inclined orbit ring, faint
 * wireframe shell) lives beside the Earth globe and is toggled by the
 * `jarvis:toggle-holo` window event, listened to in LivingEntityCore.
 * There is no state event broadcast back, so this button tracks its own
 * state locally — starting OFF, matching LivingEntityCore's
 * `useState(false)` default ("default OFF for clean, realistic Earth").
 *
 * Styled to match the other HUD header buttons in LivingEntityScreen.
 */
import { useState } from "react";

export default function HoloToggle() {
  const [holoOn, setHoloOn] = useState(false);

  const toggleHolo = () => {
    window.dispatchEvent(new CustomEvent("jarvis:toggle-holo"));
    setHoloOn((v) => !v);
  };

  return (
    <button
      onClick={toggleHolo}
      aria-pressed={holoOn}
      className={
        holoOn
          ? "px-2.5 py-1 rounded-full border border-cyan-500/60 bg-cyan-950/50 text-xs text-cyan-200 hover:text-cyan-100 hover:border-cyan-400 transition flex items-center gap-1.5 cursor-pointer shadow-[0_0_12px_rgba(34,211,238,0.4)]"
          : "px-2.5 py-1 rounded-full border border-slate-800 bg-slate-900/60 text-xs hover:text-cyan-300 hover:border-cyan-500/40 transition flex items-center gap-1.5 cursor-pointer shadow-sm"
      }
      title={holoOn ? "إخفاء الهولو (Hide Holo Rings)" : "إظهار الهولو (Show Holo Rings)"}
    >
      <span>✦</span>
      <span className="text-[10px] font-mono text-slate-400">هولو</span>
      <span
        className="w-1.5 h-1.5 rounded-full transition-all duration-300"
        style={{
          background: holoOn ? "#22d3ee" : "#475569",
          boxShadow: holoOn ? "0 0 8px #22d3ee" : "none",
        }}
      />
    </button>
  );
}
