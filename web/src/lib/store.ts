/** Backwards-compatible re-export (Phase 2 split).
 *
 * The store now lives in ./store/ (types.ts, session.ts, index.ts).
 * Existing imports (`./lib/store`, `../lib/store`) keep working unchanged.
 */
export * from "./store/index";
