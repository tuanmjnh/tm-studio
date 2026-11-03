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
 *  - `media` and `encoder` are wired here and have real consumers
 *    (`useTmcutPreviewEngine`, the export modal).
 *  - `capture` reports bounds only. No renderer can drive a per-frame capture
 *    session: one engine runs them, the Nitro server's playwright-core one, and
 *    both hosts reach it through `POST /api/v1/media/html-video` — the desktop
 *    app is served by that same server (ADR-023 retired the second engine this
 *    process used to hold). `open()` therefore rejects and names where the
 *    session actually runs. Roadmap M4 is what turns that into a real `open`.
 *  - `media.probe` answers "what is this file" (ADR-020) and writes nothing.
 *    The asset pipeline keeps owning persisted metadata: on desktop
 *    `analyzeAsset` still does its single round-trip that also produces the
 *    thumbnail, filmstrip and waveform. What changed is that a component no
 *    longer needs an asset record to ask the question.
 *
 * The adapter is safe to hold in a component: the desktop/web split cannot
 * change after load, because it is the presence of the preload bridge.
 */
import { createPlatformInfo, HTML_VIDEO_LIMITS, classifyAssetKind, mediaFileName, normalizeProbe, rationalToFloat } from 'tmcut-core'
import type {
  FrameRate,
  TmcutMediaInfo,
  TmcutMediaMetadata,
  TmcutPlatformAdapter,
  TmcutPlatformInfo,
  TmcutProbeHints,
  TmcutProbeSource,
  TmcutRenderEngine,
  TmcutRenderJob
} from 'tmcut-core'
import { useTmcutMedia } from '~/composables/useTmcutMedia'
import { tmcutHostIpc } from '~/utils/tmcut/hostBridge'
import { probeWebMetadata } from '~/utils/tmcut/webProbe'
import { useTmcutExportQueue } from '~/composables/useTmcutExportQueue'
import type { TmcutExportJob } from '~/composables/useTmcutExportQueue'

type PlatformRequest = <T>(url: string, init?: Record<string, unknown>) => Promise<T>

/**
 * ADR-023: one engine runs a capture session — the Nitro server's — and the
 * desktop reaches it through the same server that serves the app, so the
 * answer is the same on both hosts.
 */
const CAPTURE_SESSION_HOST = 'capture sessions run in the Nitro server (server/utils/htmlVideoRender.ts); use POST /api/v1/media/html-video'

/** What the desktop encoder forwards to the export queue. */
type ExportQueuePlan = Parameters<ReturnType<typeof useTmcutExportQueue>['enqueueJob']>[0]

/**
 * The contract's sync `getJob` reads a snapshot; a host that renders
 * asynchronously also needs one call that refreshes it. `refresh` stays a host
 * method rather than a contract method, so a pure-FFmpeg host can ignore it.
 */
type HostRenderEngine = TmcutRenderEngine & {
  refresh(jobId: string): Promise<TmcutRenderJob | null>
}

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
  /** Browser metadata-element probe, injected for tests (ADR-020). */
  probeWeb?: (url: string) => Promise<TmcutMediaMetadata | null>
  /** The demuxing probe service, injected for tests; lazy by default. */
  probeInfo?: (source: TmcutProbeSource) => Promise<TmcutMediaInfo>
  /** Transport for the server-side encoder, injected for tests. */
  request?: PlatformRequest
}

/**
 * The adapter plus the host helpers the contract does not carry yet.
 */
export type TmcutHostPlatform = TmcutPlatformAdapter & {
  refreshJob: (jobId: string) => Promise<TmcutRenderJob | null>
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

const QUEUE_STATUS_BY_JOB: Record<TmcutExportJob['status'], TmcutRenderJob['status']> = {
  waiting: 'queued',
  running: 'running',
  done: 'done',
  failed: 'failed',
  cancelled: 'cancelled'
}

function toRenderJob(job: TmcutExportJob): TmcutRenderJob {
  return {
    id: job.id,
    status: QUEUE_STATUS_BY_JOB[job.status],
    progress: job.progress,
    // The desktop queue renders straight into the path the user picked, so the
    // output is known before the job starts and carries no URL.
    output: { path: job.outputPath },
    error: job.error
  }
}

/** The export queue, seen through the encoder contract. */
function createQueueEncoder(): HostRenderEngine {
  const { queue, enqueueJob, cancelJob } = useTmcutExportQueue()
  const find = (jobId: string) => queue.value.find(job => job.id === jobId)
  return {
    async render(plan) {
      return toRenderJob(enqueueJob(plan as ExportQueuePlan, true))
    },
    async cancel(jobId) {
      await cancelJob(jobId)
    },
    getProgress(jobId) {
      return find(jobId)?.progress ?? 0
    },
    getJob(jobId) {
      const job = find(jobId)
      return job ? toRenderJob(job) : null
    },
    // The queue is already live in memory — watching it is how the modal gets
    // progress today — so a refresh is just a read.
    async refresh(jobId) {
      return find(jobId) ? toRenderJob(find(jobId)!) : null
    }
  }
}

interface ServerRenderPlan {
  args: string[]
  outputName: string
  duration: number
}

interface ServerJobReply {
  status: string
  progress: number
  url: string | null
  error: string | null
}

/**
 * Web encoder: the Nitro server runs ffmpeg and the browser polls.
 *
 * `render` only starts the job (the POST answers with a jobId immediately);
 * `refresh` performs one poll and folds the reply into the tracked snapshot —
 * a pull model, because only the export UI knows how often to look. `cancel`
 * stops that polling: the server has no cancel route, so the render continues
 * and callers must not present the job as an aborted one.
 */
function createServerRenderEncoder(request: PlatformRequest): HostRenderEngine {
  const tracked = new Map<string, TmcutRenderJob>()
  async function refresh(jobId: string): Promise<TmcutRenderJob | null> {
    const local = tracked.get(jobId) ?? null
    if (!local || local.status === 'cancelled') return local
    const reply = await request<ServerJobReply>(`/api/v1/media/render/${jobId}`)
    const next: TmcutRenderJob = {
      id: jobId,
      status: reply.status === 'done' ? 'done' : reply.status === 'failed' ? 'failed' : 'running',
      progress: reply.progress || 0,
      output: reply.url ? { url: reply.url } : undefined,
      error: reply.error || undefined
    }
    tracked.set(jobId, next)
    return next
  }
  return {
    async render(plan) {
      const body = plan as ServerRenderPlan
      const started = await request<{ ok: boolean, jobId: string }>('/api/v1/media/render', {
        method: 'POST',
        body: { args: body.args, outputName: body.outputName, duration: body.duration }
      })
      const job: TmcutRenderJob = { id: started.jobId, status: 'running', progress: 0 }
      tracked.set(job.id, job)
      return job
    },
    async cancel(jobId) {
      const job = tracked.get(jobId)
      if (!job || job.status === 'done' || job.status === 'failed') return
      tracked.set(jobId, { ...job, status: 'cancelled' })
    },
    getProgress(jobId) {
      return tracked.get(jobId)?.progress ?? 0
    },
    getJob(jobId) {
      return tracked.get(jobId) ?? null
    },
    refresh
  }
}

function desktopInfo(): TmcutPlatformInfo {
  return createPlatformInfo('electron', {
    filesystem: true,
    nativeFFmpeg: true,
    hardwareEncoding: true,
    backgroundRender: true,
    largeFileAccess: true,
    cloudRender: false,
    webCodecs: false,
    webGPU: false
  })
}

function webInfo(): TmcutPlatformInfo {
  return createPlatformInfo('web', {
    // The browser holds no files and runs no ffmpeg: renders are dispatched to
    // the Nitro server, which is what `cloudRender` names in this contract.
    // WebCodecs stays off until roadmap M5 actually ships an encoder.
    cloudRender: true,
    filesystem: false,
    nativeFFmpeg: false,
    hardwareEncoding: false,
    backgroundRender: false,
    largeFileAccess: false,
    webCodecs: false,
    webGPU: false
  })
}

/**
 * Build the adapter for the current host. `deps` exists so the pure parts
 * (capability negotiation, encoder job mapping, capture bounds) are testable in
 * plain Node without a preload bridge or a server.
 */
export function useTmcutPlatform(deps: TmcutPlatformDeps = {}): TmcutHostPlatform {
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
   * ADR-020: the same question answered twice a different way, which is why it
   * belongs on the contract instead of in each component. Desktop runs ffprobe
   * over the stored **path** (a `media://` URL would not open) and normalizes
   * the raw JSON with core, so the numbers are the ones `analyzeAsset` writes;
   * the browser has no pipeline, only a metadata element over the **playable
   * URL**, and reports duration and size but not frame rate. Both return null
   * rather than a zero-filled guess, so a caller can keep its own fallback.
   */
  const probe = async (src: string): Promise<TmcutMediaMetadata | null> => {
    if (desktop) {
      const ipc = tmcutHostIpc()
      if (!ipc?.probeMedia) return null
      const result = await ipc.probeMedia({ filePath: src })
      return result?.ok ? normalizeProbe(result.probe) : null
    }
    const askWeb = deps.probeWeb ?? probeWebMetadata
    return askWeb(resolveSrc(src))
  }
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

  // Built on first use: a component that only asks about media or capabilities
  // must not pay for the export queue, which registers task-manager listeners
  // and a deep watcher over the persisted queue when it is created. The server
  // transport is read here for the same reason: `$fetch` is a Nuxt global, and a
  // media-only caller on a host without it must still get a working adapter.
  let engine: HostRenderEngine | null = null
  const renderEngine = () => engine ?? (engine = desktop
    ? createQueueEncoder()
    : createServerRenderEncoder(deps.request ?? ($fetch as unknown as PlatformRequest)))

  const encoder: TmcutRenderEngine = {
    render: plan => renderEngine().render(plan),
    cancel: jobId => renderEngine().cancel(jobId),
    getProgress: jobId => renderEngine().getProgress(jobId),
    getJob: jobId => renderEngine().getJob?.(jobId) ?? null
  }

  return {
    info,
    media: { resolveSrc, probe, probeInfo },
    capture: {
      supportsFps: rate => rateInRange(rate, HTML_VIDEO_LIMITS.minFps, HTML_VIDEO_LIMITS.maxFps),
      open: async () => {
        throw new Error(CAPTURE_SESSION_HOST)
      }
    },
    encoder,
    refreshJob: jobId => renderEngine().refresh(jobId)
  }
}
