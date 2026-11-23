/** Backend connection settings — the ONE place host/port live (Phase 2).
 *
 * Values come from web/.env (see web/.env.example):
 *   VITE_JARVIS_HOST — backend host, default 127.0.0.1
 *   VITE_JARVIS_PORT — backend port, default 7341
 *
 * Vite inlines VITE_* vars at build time. electron/main.cjs reads the same
 * web/.env file, so the shell and the renderer always agree. `api.ts` and
 * `ws.ts` both derive their URLs from here — nothing else hardcodes the
 * backend address.
 */
export const JARVIS_HOST: string =
  import.meta.env.VITE_JARVIS_HOST || "127.0.0.1";

export const JARVIS_PORT: number =
  Number(import.meta.env.VITE_JARVIS_PORT) || 7341;

export const JARVIS_API_URL = `http://${JARVIS_HOST}:${JARVIS_PORT}`;
