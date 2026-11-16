/**
 * HUD THEME TABLE — Authoritative Theme Map per orbState
 *
 * ONE const map giving, per state (idle, listening, thinking, speaking, executing, error, offline):
 * - entityColors: { a: string, b: string } for volumetric particle shader
 * - ringSpeedMultiplier: rotation speed factor for HUD rings
 * - glowStrength: normalized 0.0 - 1.0 glow multiplier for gauges and backdrops
 * - scanSpeed: sweep rate for radar/grid scanlines
 * - accentColor: primary hex color for HUD indicators
 */

import type { OrbState } from "./store";

export type ExtendedOrbState = OrbState | "executing" | "error" | "offline";

export interface HudStateTheme {
  name: string;
  entityColors: { a: string; b: string };
  ringSpeedMultiplier: number;
  glowStrength: number;
  scanSpeed: number;
  accentColor: string;
}

export const HUD_THEMES: Record<ExtendedOrbState, HudStateTheme> = {
  idle: {
    name: "IDLE · SERENE",
    entityColors: { a: "#e8b86a", b: "#ffd580" }, // Calm Golden Living Entity
    ringSpeedMultiplier: 0.3,
    glowStrength: 0.35,
    scanSpeed: 0.3,
    accentColor: "#22d3ee",
  },
  listening: {
    name: "LISTENING · RECEPTIVE",
    entityColors: { a: "#22d3ee", b: "#67e8f9" }, // Receptive Electric Cyan
    ringSpeedMultiplier: 0.7,
    glowStrength: 0.75,
    scanSpeed: 0.8,
    accentColor: "#22d3ee",
  },
  thinking: {
    name: "THINKING · NEURAL COGNITION",
    entityColors: { a: "#fbbf24", b: "#f59e0b" }, // Warm Amber Cognition
    ringSpeedMultiplier: 1.5,
    glowStrength: 0.9,
    scanSpeed: 1.6,
    accentColor: "#fbbf24",
  },
  speaking: {
    name: "SPEAKING · AUDIO COMS",
    entityColors: { a: "#38bdf8", b: "#c084fc" }, // Vocal Resonance Sky & Violet
    ringSpeedMultiplier: 0.85,
    glowStrength: 0.8,
    scanSpeed: 1.0,
    accentColor: "#38bdf8",
  },
  executing: {
    name: "EXECUTING · DISPATCH",
    entityColors: { a: "#60a5fa", b: "#3b82f6" }, // Cobalt High-Velocity
    ringSpeedMultiplier: 1.25,
    glowStrength: 0.85,
    scanSpeed: 1.3,
    accentColor: "#60a5fa",
  },
  error: {
    name: "ANOMALY · ALERT",
    entityColors: { a: "#f87171", b: "#ef4444" }, // Warning Crimson
    ringSpeedMultiplier: 0.2,
    glowStrength: 0.95,
    scanSpeed: 0.2,
    accentColor: "#ef4444",
  },
  offline: {
    name: "OFFLINE · DORMANT",
    entityColors: { a: "#64748b", b: "#334155" }, // Muted Slate Gray
    ringSpeedMultiplier: 0.0,
    glowStrength: 0.1,
    scanSpeed: 0.0,
    accentColor: "#64748b",
  },
};

/**
 * Safe theme getter falling back to idle if state is unrecognized
 */
export function getHudTheme(state: string | undefined): HudStateTheme {
  if (state && state in HUD_THEMES) {
    return HUD_THEMES[state as ExtendedOrbState];
  }
  return HUD_THEMES.idle;
}
