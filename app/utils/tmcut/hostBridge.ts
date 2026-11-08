/**
 * The single renderer-side reader of the Electron preload bridge.
 *
 * Every feature module used to reach for `window.electronAPI` itself — some
 * re-declaring a local `tmcutIpc()` helper, some repeating the
 * `typeof window !== 'undefined'` SSR guard inline. That made "which runtime
 * am I in" a question 30+ files each answered on their own, and it kept
 * growing. Here the read happens once, is SSR-safe, and the type comes from
 * the `Window` augmentation in `shared/types/electron.ts`, so a missing
 * preload method is still a compile error rather than a runtime `undefined`.
 *
 * What lives here and what does not:
 *  - This module is the **host bridge** — raw IPC reachability. Asking it is
 *    how code that genuinely calls a preload method (`tmcut.statFiles`,
 *    `tools.videoGeneration.submit`) gets its handle.
 *  - It is NOT the feature gate. "Can this host do X" belongs to
 *    `useTmcutPlatform()` (ADR-014), which negotiates capabilities once at
 *    startup; UI branches read `platform.info`, not the bridge.
 *  - `tmcutHostBridge()` returning undefined is normal on the web runtime, so
 *    callers must keep their own optional handling; nothing here throws.
 */

/** The preload API, or undefined on the web runtime and during SSR. */
export function tmcutHostBridge() {
  return typeof window === 'undefined' ? undefined : window.electronAPI
}

/** The `tmcut` IPC slice, or undefined when there is no desktop bridge. */
export function tmcutHostIpc() {
  return tmcutHostBridge()?.tmcut
}
