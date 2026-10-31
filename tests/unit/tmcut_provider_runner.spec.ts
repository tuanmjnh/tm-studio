/**
 * Video Factory Provider Runner (Roadmap v1 §7, P4).
 *
 * Verifies that createProviderRunner wires IPC submission, status polling,
 * cancellation, and asset download properly into the FactoryRunner contract.
 */
import { createProviderRunner, type VideoGenerationIpc } from '../../app/utils/tmcut/videoFactoryRunner'
import type { GenerationJob } from '../../app/types/videoFactory'

let passed = 0
async function checkAsync(name: string, fn: () => Promise<void>) {
  await fn()
  passed++
  console.log(`[ok] ${name}`)
}

function mockJob(id = 'job_123'): GenerationJob {
  return {
    jobId: id,
    batchId: 'batch_abc',
    sceneId: 'scene_0',
    type: 'video',
    connectionId: 'mock-connection',
    model: 'mock-model',
    normalizedRequest: {
      taskType: 'text-to-video',
      prompt: 'A cinematic coffee commercial'
    },
    status: 'queued',
    attempts: 0,
    maxAttempts: 3,
    priority: 0,
    createdAt: new Date().toISOString(),
    estimatedCostUsd: 0
  }
}

async function main() {
  await checkAsync('submits job and polls through to completed download', async () => {
    let pollCount = 0
    let downloaded = false

    const mockIpc: VideoGenerationIpc = {
      async submit(args) {
        if (args.providerId !== 'runway') throw new Error('Wrong provider')
        return {
          ok: true,
          data: {
            jobId: 'local_runway_1',
            providerTaskId: 'runway_task_99',
            status: 'queued',
            estimatedCompletionSec: 10
          }
        }
      },
      async poll({ jobId }) {
        if (jobId !== 'local_runway_1') throw new Error('Wrong local job ID')
        pollCount++
        if (pollCount === 1) {
          return {
            ok: true,
            data: {
              jobId,
              status: 'processing',
              progress: 50,
              costSoFar: 0.15,
              results: [],
              error: null
            }
          }
        }
        return {
          ok: true,
          data: {
            jobId,
            status: 'completed',
            progress: 100,
            costSoFar: 0.30,
            results: [{ type: 'video', downloadUrl: 'https://cdn.runway.com/video.mp4' }],
            error: null
          }
        }
      },
      async cancel() {
        return { ok: true }
      },
      async download({ jobId }) {
        if (jobId !== 'local_runway_1') throw new Error('Wrong job ID for download')
        downloaded = true
        return {
          ok: true,
          data: {
            localPath: 'C:\\Users\\generated\\runway-output.mp4',
            checksum: 'abc123hash',
            fileSizeBytes: 1024000,
            mimeType: 'video/mp4',
            width: 1280,
            height: 720,
            durationSec: 10
          }
        }
      }
    }

    const runner = createProviderRunner({
      ipc: mockIpc,
      providerId: 'runway',
      pollIntervalMs: 10 // Fast poll for test
    })

    const job = mockJob()
    const result = await runner.run(job)

    if (result.status !== 'completed') throw new Error(`Expected completed, got ${result.status}`)
    if (result.outputAssetId !== 'C:\\Users\\generated\\runway-output.mp4') throw new Error(`Wrong asset id: ${result.outputAssetId}`)
    if (result.actualCostUsd !== 0.30) throw new Error(`Wrong cost: ${result.actualCostUsd}`)
    if (result.providerTaskId !== 'runway_task_99') throw new Error(`Wrong task ID: ${result.providerTaskId}`)
    if (!downloaded) throw new Error('Result was not downloaded')
  })

  await checkAsync('handles provider failure gracefully without retrying permanent errors', async () => {
    const mockIpc: VideoGenerationIpc = {
      async submit() {
        return {
          ok: true,
          data: {
            jobId: 'local_runway_fail',
            providerTaskId: 'task_fail',
            status: 'queued',
            estimatedCompletionSec: 5
          }
        }
      },
      async poll() {
        return {
          ok: true,
          data: {
            jobId: 'local_runway_fail',
            status: 'failed',
            progress: 0,
            costSoFar: 0,
            results: [],
            error: 'Content policy violation'
          }
        }
      },
      async cancel() { return { ok: true } },
      async download() { throw new Error('Should not download on failure') }
    }

    const runner = createProviderRunner({
      ipc: mockIpc,
      providerId: 'runway',
      pollIntervalMs: 10
    })

    const result = await runner.run(mockJob('job_fail'))
    if (result.status !== 'failed') throw new Error(`Expected failed, got ${result.status}`)
    if (result.error?.category !== 'provider-error') throw new Error(`Wrong category: ${result.error?.category}`)
  })

  await checkAsync('calls cancel on the IPC bridge', async () => {
    let canceledJobId = ''
    const mockIpc: VideoGenerationIpc = {
      async submit() { return { ok: true, data: { jobId: 'x', providerTaskId: 'task_x', status: 'queued', estimatedCompletionSec: 5 } } },
      async poll() { return { ok: true, data: { jobId: 'x', status: 'processing', progress: 50, costSoFar: 0, results: [], error: null } } },
      async cancel({ jobId }) {
        canceledJobId = jobId
        return { ok: true }
      },
      async download() { return { ok: true } }
    }

    const runner = createProviderRunner({ ipc: mockIpc, providerId: 'runway' })
    const job = mockJob('job_to_cancel')
    job.providerTaskId = 'runway_remote_task'

    if (runner.cancel) {
      await runner.cancel(job)
      if (canceledJobId !== 'runway_remote_task') throw new Error(`Wrong canceled ID: ${canceledJobId}`)
    } else {
      throw new Error('Cancel method missing on runner')
    }
  })

  console.log(`\n=== All ${passed} provider-runner checks passed ===\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
