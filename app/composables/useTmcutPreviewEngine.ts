/**
 * Preview engine boundary (roadmap Phase 5, R90).
 *
 * Playback is HTMLVideoElement + blobs on both runtimes. What DOES differ per
 * environment is how a stored clip `src` becomes a playable URL:
 *
 *  - `electron`: absolute paths served through the privileged `media://local`
 *    protocol.
 *  - `web`: sessions only reference blob:/data:/https: URLs created by
 *    `importWebFiles`.
 *
 * Zero-FFmpeg slice I removed the two pipelines that used to sit behind a
 * capability flag here: the 540p proxy re-encode (desktop channel + Nitro
 * route) and the vidstab render. They are not "off on one host" any more —
 * they do not exist on either, so advertising the flag would be the same lie
 * the deleted buttons told.
 *
 * Everything the player needs to know about the runtime goes through this
 * small interface so a future engine implements one contract instead of being
 * special-cased across player code.
 */
import { useTmcutPlatform } from '~/composables/useTmcutPlatform'

export type TmcutPreviewEngineKind = 'electron' | 'web'

export interface TmcutPreviewEngine {
  kind: TmcutPreviewEngineKind
  /** Map a stored clip src (absolute path or blob:/data:/https:) to a playable URL. */
  resolveSrc(src?: string | null): string
}

/**
 * Picks the engine once per session. `useTmcutPlatform` reads the same
 * preload-bridge presence the adapter negotiates from, so the preview's media
 * resolution comes from one host answer (ADR-014) rather than a second
 * `isDesktop` branch that can drift from it.
 * The returned object may be treated as stable inside a component.
 */
export function useTmcutPreviewEngine(): TmcutPreviewEngine {
  const platform = useTmcutPlatform()
  const desktop = platform.info.name === 'electron'

  return {
    kind: desktop ? 'electron' : 'web',
    // The playable URL the host's media group produces (`media://local/…` on
    // desktop, `/uploads/…`, blob:, data: or https: on web).
    resolveSrc: src => platform.media.resolveSrc(src)
  }
}
