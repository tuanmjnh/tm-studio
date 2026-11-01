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
 *    session: the two live implementations sit in Electron main
 *    (`openCaptureSession`) and the Nitro server (`playwright-core`). `open()`
 *    therefore rejects and names where the session actually runs. Roadmap M4
 *    is what turns that into a real `open`.
 *  - `media.probe` is left out (optional in the contract): metadata today is
 *    written into the asset store by `analyzeAsset`, which owns its own IPC
 *    path. Exposing it as a pure `src -> metadata` call needs a decision about
 *    who owns that state, not a re-export.
 *
 * The adapter is safe to hold in a component: the desktop/web split cannot
 * change after load, because it is the presence of the preload bridge.
 */
import { createPlatformInfo, HTML_VIDEO_LIMITS, rationalToFloat } from '@tmcut-core'
import type {
  FrameRate,
  TmcutPlatformAdapter,
  TmcutPlatformInfo,
  TmcutRenderEngine,
  TmcutRenderJob
} from '@tmcut-core'
import { useTmcutMedia } from '~/composables/useTmcutMedia'
import { useTmcutExportQueue } from '~/composables/useTmcutExportQueue'
import type { TmcutExportJob } from '~/composables/useTmcutExportQueue'

type PlatformRequest = <T>(url: string, init?: Record<string, unknown>) => Promise<T>

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
 * Frame rates the Electron HTML-video path accepts: its own validator window
 * (15..60), narrower than the composition spec window (1..60) the Nitro server
 * enforces. That difference is gap G6 in numbers, and
 * tmcut_platform_adapter.spec.ts pins both against their host sources.
 */
const ELECTRON_CAPTURE_MIN_FPS = 15
const ELECTRON_CAPTURE_MAX_FPS = 60

/** Integer rate inside a host's inclusive window. */
function rateInRange(rate: FrameRate | number, min: number, max: number): boolean {
  const fps = typeof rate === 'number' ? rate : rationalToFloat(rate)
  return Number.isInteger(fps) && fps >= min && fps <= max
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

  const desktop = deps.isDesktop?.value ?? mediaOf().isDesktop.value
  const info = desktop ? desktopInfo() : webInfo()
  const resolveSrc = deps.resolveSrc ?? ((src?: string | null) => mediaOf().resolveMediaSrc(src))
  const request = deps.request ?? ($fetch as unknown as PlatformRequest)

  // Built on first use: a component that only asks about media or capabilities
  // must not pay for the export queue, which registers task-manager listeners
  // and a deep watcher over the persisted queue when it is created.
  let engine: HostRenderEngine | null = null
  const renderEngine = () => engine ?? (engine = desktop
    ? createQueueEncoder()
    : createServerRenderEncoder(request))

  const encoder: TmcutRenderEngine = {
    render: plan => renderEngine().render(plan),
    cancel: jobId => renderEngine().cancel(jobId),
    getProgress: jobId => renderEngine().getProgress(jobId),
    getJob: jobId => renderEngine().getJob?.(jobId) ?? null
  }

  return {
    info,
    media: { resolveSrc },
    capture: {
      supportsFps: rate => desktop
        ? rateInRange(rate, ELECTRON_CAPTURE_MIN_FPS, ELECTRON_CAPTURE_MAX_FPS)
        : rateInRange(rate, HTML_VIDEO_LIMITS.minFps, HTML_VIDEO_LIMITS.maxFps),
      open: async () => {
        throw new Error(
          desktop
            ? 'capture sessions run in the Electron main process (electron/tools/html-video-renderer.cjs); use the tmcut:renderHtmlVideo job'
            : 'capture sessions run in the Nitro server (server/utils/htmlVideoRender.ts); use POST /api/v1/media/html-video'
        )
      }
    },
    encoder,
    refreshJob: jobId => renderEngine().refresh(jobId)
  }
}
