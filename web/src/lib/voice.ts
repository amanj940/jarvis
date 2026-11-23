/** Backwards-compatible re-export (Phase 2 split).
 *
 * Voice now lives in ./voice/ (tts.ts, mic.ts, index.ts). Existing imports
 * (`./lib/voice`, `../lib/voice`) keep working unchanged.
 */
export * from "./voice/index";
