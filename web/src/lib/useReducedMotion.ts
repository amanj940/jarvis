/**
 * USE REDUCED MOTION HOOK
 *
 * Reactive accessibility hook that detects whether the user has enabled
 * the 'prefers-reduced-motion: reduce' system preference.
 *
 * Used by:
 * - LivingEntityCore (R3F frameloop "demand", accelerated morph)
 * - HudRings (freezes 2D tactical HUD ring rotation)
 * - HudConnectorLines (freezes ray dash travel animation)
 */

import { useEffect, useState } from "react";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const handleChange = (e: MediaQueryListEvent) => {
      setReduced(e.matches);
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
    } else {
      mediaQuery.addListener(handleChange);
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", handleChange);
      } else {
        mediaQuery.removeListener(handleChange);
      }
    };
  }, []);

  return reduced;
}
