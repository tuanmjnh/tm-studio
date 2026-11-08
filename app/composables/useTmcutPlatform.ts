/**
 * Platform adapter factory (V4 Phase 1 / ADR-014, first half of gap G3).
 *
 * `TmcutPlatformAdapter` existed since M1 as a type, and Electron main grew a
 * capture host in M1c, but nothing inside the app read the contract — feature
 * code kept sniffing `window.electronAPI` instead. This module is the single
 * place that answers "what can THIS host do, and who does the work", so
 * consumers ask one object rather than re-deriving the runtime.
 *
 * Scope, stated honestly:
 *  - `media` is wired here and has real consumers (`useTmcutPreviewEngine`).
 *  - `capture` reports bounds only. No host drives a per-frame capture
 *    session any more: the one engine that ran them was the Nitro server's
 *    playwright-core renderer, and zero-FFmpeg slice I deleted it with the
 *    binary it fed (ADR-023 had already retired the desktop's second engine).
 *    `open()` therefore rejects on both hosts and names why. Roadmap M4 is
 *    what turns that into a real in-process `open`.
 *  - `media.probeInfo` answers "what is this file" and writes nothing; it is
 *    the only probe left, because the ffprobe leg went with the binary. The
 *    asset pipeline demuxes through the same collector on both hosts and keeps
 *    owning persisted metadata; on desktop the host's `statFiles` supplies the
 *    byte count and revision stamp a demuxer cannot know. The cover, filmstrip
 *    and waveform are decoder answers now, not by-products of one IPC call.
 *    What changed is that a component no longer needs an asset record to ask
 *    the question.
 *
 * There is no `encoder` any more (zero-FFmpeg slice I): encoding is the
 * in-process WebCodecs session the export modal drives on both hosts, so the
 * host has no render job to queue and no path to poll.
 *
 * The adapter is safe to hold in a component: the desktop/web split cannot
 * change after load, because it is the presence of the preload bridge.
 */
import { createPlatformInfo, HTML_VIDEO_LIMITS, classifyAssetKind, mediaFileName, rationalToFloat } from 'tmcut-core'
import type {
  FrameRate,
  TmcutMediaInfo,
  TmcutPlatformAdapter,
  TmcutPlatformInfo,
  TmcutProbeHints,
  TmcutProbeSource
} from 'tmcut-core'
import { useTmcutMedia } from '~/composables/useTmcutMedia'
import { tmcutHostIpc } from '~/utils/tmcut/hostBridge'

/**
 * ADR-023: one engine ran a capture session — the Nitro server's — and the
 * desktop reached it through the same server that serves the app. Zero-FFmpeg
 * slice I deleted that engine with the only ffmpeg it fed, so no host holds a
 * session now and the refusal is the same on both.
 */
const CAPTURE_SESSION_HOST = 'capture sessions have no engine: the server-side HTML-video render was retired with ffmpeg (zero-FFmpeg slice I)'

export interface TmcutPlatformDeps {
  /** True when the Electron preload bridge is present; injectable for tests. */
  isDesktop?: { value: boolean }
  /** Stored locator -> playable URL, injected for tests. */
  resolveSrc?: (src?: string | null) => string
  /**
   * Stored locator -> the URL of the **stored file**, proxy ignored, injected
   * for tests. MediaInfo describes what a clip is, so it must not read the
   * playback preview of it.
   */
  resolveSource?: (src: string) => string
  /** The demuxing probe service, injected for tests; lazy by default. */
  probeInfo?: (source: TmcutProbeSource) => Promise<TmcutMediaInfo>
}

/**
 * A rate inside the one composition window.
 *
 * ADR-019: both hosts answer with `HTML_VIDEO_LIMITS`, because the Electron
 * validator now reads that same object instead of keeping its own 15..60 copy —
 * so a rate the studio can author is renderable on whichever host takes the
 * job. Fractional rates (29.97 = 30000/1001) are legal on both hosts as well,
 * which is what the spec validator has always accepted.
 */
function rateInRange(rate: FrameRate | number, min: number, max: number): boolean {
  const fps = typeof rate === 'number' ? rate : rationalToFloat(rate)
  return Number.isFinite(fps) && fps >= min && fps <= max
}

function desktopInfo(): TmcutPlatformInfo {
  return createPlatformInfo('electron', {
    filesystem: true,
    // WebCodecs is the only encoder either host has (zero-FFmpeg slice H), and
    // the in-process export session drives it on both.
    webCodecs: true,
    // No render queue and no ffmpeg argument chooser: the runtime picks the
    // encoder backend itself and the app cannot offer a choice any more.
    hardwareEncoding: false,
    backgroundRender: false,
    largeFileAccess: true,
    cloudRender: false,
    webGPU: false
  })
}

function webInfo(): TmcutPlatformInfo {
  return createPlatformInfo('web', {
    // The tab resizes, paints and encodes locally; nothing is dispatched to the
    // Nitro server for the timeline export any more.
    cloudRender: false,
    filesystem: false,
    webCodecs: true,
    hardwareEncoding: false,
    backgroundRender: false,
    largeFileAccess: false,
    webGPU: false
  })
}

/**
 * Build the adapter for the current host. `deps` exists so the pure parts
 * (capability negotiation, capture bounds) are testable in plain Node without a
 * preload bridge or a server.
 */
export function useTmcutPlatform(deps: TmcutPlatformDeps = {}): TmcutPlatformAdapter {
  // The media composable is resolved lazily: a caller that injects its host
  // answer (tests, or a component that only needs capabilities) never pays for
  // it, and never runs its side effects outside a Nuxt context.
  let mediaHost: ReturnType<typeof useTmcutMedia> | null = null
  const mediaOf = () => mediaHost ?? (mediaHost = useTmcutMedia())

  // The host split reads the bridge accessor directly: capability negotiation
  // must not instantiate the media composable (and with it the project store),
  // because a component may only ask "what can this host do".
  const desktop = deps.isDesktop?.value ?? tmcutHostIpc() !== undefined
  const info = desktop ? desktopInfo() : webInfo()
  const resolveSrc = deps.resolveSrc ?? ((src?: string | null) => mediaOf().resolveMediaSrc(src))

  /**
   * The §4.1 answer, from one service on both hosts (zero-FFmpeg plan §4).
   *
   * Two rules shape it. It probes the **stored file**, never the playback
   * proxy: `resolveSrc` may hand back a 960px copy when proxy preview is on, and
   * reporting that as the clip's codec and size would tell the export it can
   * losslessly mux a 4K HEVC source. And the demuxer is imported on first use,
   * so a component that only asks about capabilities or durations never pays for
   * Mediabunny in its chunk.
   */
  const probeInfo = async (src: string, hints: TmcutProbeHints = {}): Promise<TmcutMediaInfo> => {
    const askInfo = deps.probeInfo ?? (await import('~/utils/tmcut/mediaProbe')).probeMedia
    const askSource = deps.resolveSource ?? ((path: string) => mediaOf().mediaUrl(path))
    return askInfo({
      name: mediaFileName(src),
      url: askSource(src),
      size: hints.size,
      mimeType: hints.mimeType,
      kind: hints.kind ?? classifyAssetKind(src) ?? undefined
    })
  }

  return {
    info,
    media: { resolveSrc, probeInfo },
    capture: {
      supportsFps: rate => rateInRange(rate, HTML_VIDEO_LIMITS.minFps, HTML_VIDEO_LIMITS.maxFps),
      open: async () => {
        throw new Error(CAPTURE_SESSION_HOST)
      }
    }
  }
}
