/**
 * Preview engine boundary (roadmap Phase 5, R90).
 *
 * The preview never calls FFmpeg — playback is HTMLVideoElement + blobs
 * on both runtimes. What DOES differ per environment is how a stored
 * clip `src` becomes a playable URL and which media pipeline exists:
 *
 *  - `electron` engine: absolute paths served through the privileged
 *    `media://local` protocol, 540p proxy swap-in + stabilized renders
 *    from the local FFmpeg jobs (roadmap F-4/E-5) are real files.
 *  - `web` engine: sessions only reference blob:/data:/https: URLs
 *    created by `importWebFiles`; there is no local media pipeline, so
 *    proxy/stabilize features are off (their UI hides, their clip
 *    fields simply never appear).
 *
 * Everything the player needs to know about the runtime goes through
 * this small interface so a future engine (e.g. a WebCodecs canvas
 * compositor — the doc-era Phase 5 option, deliberately still a
 * follow-up) implements one contract instead of being special-cased
 * across player code.
 */
import { useTmcutPlatform } from '~/composables/useTmcutPlatform'

export type TmcutPreviewEngineKind = 'electron' | 'web'

export interface TmcutPreviewEngineCapabilities {
  /** 540p proxy media can be generated and swapped in (desktop pipeline). */
  proxyPreview: boolean
  /** Stabilized render outputs exist as real files (desktop FFmpeg job). */
  stabilize: boolean
}

export interface TmcutPreviewEngine {
  kind: TmcutPreviewEngineKind
  capabilities: TmcutPreviewEngineCapabilities
  /** Map a stored clip src (absolute path or blob:/data:/https:) to a playable URL. */
  resolveSrc(src?: string | null): string
}

/**
 * Picks the engine once per session. `useTmcutPlatform` reads the same
 * preload-bridge presence the adapter negotiates from, so the preview's
 * capabilities and its media resolution both come from one host answer
 * (ADR-014) rather than a second `isDesktop` branch that can drift from it.
 * The returned object may be treated as stable inside a component.
 */
export function useTmcutPreviewEngine(): TmcutPreviewEngine {
  const platform = useTmcutPlatform()
  const desktop = platform.info.name === 'electron'

  return {
    kind: desktop ? 'electron' : 'web',
    capabilities: {
      // Proxy preview runs on both runtimes: the desktop pipeline writes a
      // 540p file next to the source, the web pipeline asks the local Nitro
      // server (POST /api/v1/media/proxy). Stabilization stays desktop-only —
      // it is still a full render job.
      proxyPreview: true,
      stabilize: desktop
    },
    // Proxy-aware on both hosts: serves the ready proxy when the toggle is on,
    // otherwise the playable URL the host's media group produces
    // (`media://local/…` on desktop, `/uploads/…`, blob:, data: or https: on
    // web).
    resolveSrc: src => platform.media.resolveSrc(src)
  }
}
