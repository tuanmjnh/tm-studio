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
import { useTmcutMedia } from '~/composables/useTmcutMedia'

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
 * Picks the engine once per session. `isDesktop` reflects the presence
 * of the `tmcutIpc()` preload bridge, which cannot change after load,
 * so the returned object may be treated as stable inside a component.
 */
export function useTmcutPreviewEngine(): TmcutPreviewEngine {
  const { isDesktop, resolveMediaSrc } = useTmcutMedia()

  if (isDesktop.value) {
    return {
      kind: 'electron',
      capabilities: { proxyPreview: true, stabilize: true },
      // Proxy-aware: serves the ready proxy when the toggle is on,
      // otherwise the media:// URL of the original file.
      resolveSrc: src => resolveMediaSrc(src)
    }
  }

  return {
    kind: 'web',
    // Web-parity (web-parity step 2): the proxy pass is server-side now —
    // POST /api/v1/media/proxy scales uploaded sources through the local
    // Nitro ffmpeg, so proxy preview is available on the web runtime too.
    // Stabilization remains desktop-only (it is still a full render job).
    capabilities: { proxyPreview: true, stabilize: false },
    // resolveMediaSrc serves the ready proxy when the toggle is on,
    // otherwise the /uploads/ URL of the original file (mediaUrl is
    // toURL, so /uploads/…, blob:/data:/https: pass through unchanged).
    resolveSrc: src => resolveMediaSrc(src)
  }
}
