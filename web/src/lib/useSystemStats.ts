/**
 * useSystemStats — Single Source of Truth for Live System Telemetry
 *
 * Polls GET /api/stats every 2.5 seconds and writes to store.stats.
 * Automatically pauses during tab inactivity (visibilitychange) to conserve CPU.
 */

import { useEffect, useRef } from "react";
import { getStats } from "./api";
import { useStore } from "./store";

export function useSystemStats(intervalMs = 2500) {
  const setStats = useStore((s) => s.setStats);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchStats() {
      try {
        const data = await getStats();
        if (mounted && data) {
          setStats(data);
        }
      } catch {
        /* Network error or backend restart, ignore gracefully */
      }
    }

    // Initial fetch immediately
    fetchStats();

    function startPolling() {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(fetchStats, intervalMs);
    }

    function stopPolling() {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    // Start polling
    startPolling();

    // Pause on tab hidden, resume on tab visible
    function handleVisibility() {
      if (document.hidden) {
        stopPolling();
      } else {
        fetchStats();
        startPolling();
      }
    }

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      mounted = false;
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [setStats, intervalMs]);
}
