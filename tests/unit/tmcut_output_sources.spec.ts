/**
 * Output source classification (P6 assembly follow-up).
 *
 * Assembly may only point a clip at something the editor can actually play, so
 * a provider/job output id has to be classified before any project is written.
 * Getting this wrong is silent: the dry-run marker must never become a file
 * reference, and a Windows path must not be read as an opaque id.
 */
import { classifyOutputSource, outputLocation, planOutputIngest } from '../../app/utils/tmcut/outputSources'
import type { GenerationJob } from '../../app/types/videoFactory'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`[ok] ${name}`)
}

function job(jobId: string, outputAssetId?: string): GenerationJob {
  return {
    jobId,
    batchId: 'batch_test',
    type: 'video',
    connectionId: 'dry-run',
    model: 'dry-run',
    normalizedRequest: {},
    status: 'approved',
    attempts: 0,
    maxAttempts: 3,
    priority: 0,
    createdAt: '2026-10-24T10:00:00.000Z',
    estimatedCostUsd: 0,
    outputAssetId
  }
}

function main() {
  check('classifies every shape an output id can take', () => {
    const cases: Array<[string | undefined, string]> = [
      [undefined, 'unknown'],
      ['', 'unknown'],
      ['   ', 'unknown'],
      ['dryrun:batch:r0:s0', 'simulated'],
      ['https://cdn.example.com/clip.mp4', 'remote-url'],
      ['HTTP://CDN.EXAMPLE.COM/clip.mp4', 'remote-url'],
      ['data:video/mp4;base64,AAAA', 'remote-url'],
      ['blob:http://localhost:4002/abc', 'remote-url'],
      ['file:///C:/Users/me/Videos/out.mp4', 'local-path'],
      ['C:\\Users\\me\\Videos\\out.mp4', 'local-path'],
      ['/home/me/out.mp4', 'local-path'],
      ['asset_9f2c1b', 'unknown'],
      ['tmhub:asset:123', 'unknown']
    ]
    for (const [value, expected] of cases) {
      const actual = classifyOutputSource(value)
      if (actual !== expected) throw new Error(`${value} → ${actual}, expected ${expected}`)
    }
  })

  check('a file URL becomes a plain path the importer can open', () => {
    if (outputLocation('file:///C:/Users/me/My%20Video.mp4') !== 'C:/Users/me/My Video.mp4') {
      throw new Error(`windows path: ${outputLocation('file:///C:/Users/me/My%20Video.mp4')}`)
    }
    if (outputLocation('file:///home/me/a%23b.mp4') !== '/home/me/a#b.mp4') {
      throw new Error(`posix path: ${outputLocation('file:///home/me/a%23b.mp4')}`)
    }
    if (outputLocation('C:\\clips\\a.mp4') !== 'C:\\clips\\a.mp4') {
      throw new Error('a plain windows path must be returned untouched')
    }
    if (outputLocation('https://x.test/a.mp4?token=1') !== 'https://x.test/a.mp4?token=1') {
      throw new Error('a URL keeps its query string')
    }
    if (outputLocation('dryrun:x') !== undefined) throw new Error('simulated outputs have no location')
    if (outputLocation('asset_1') !== undefined) throw new Error('opaque ids have no location')
  })

  check('the ingest plan dedupes by location and counts what it cannot use', () => {
    const plan = planOutputIngest([
      job('j1', 'https://cdn.test/a.mp4'),
      job('j2', 'https://cdn.test/a.mp4'),
      job('j3', 'C:\\clips\\b.mp4'),
      job('j4', 'dryrun:j4'),
      job('j5', undefined),
      job('j6', 'asset_opaque')
    ])
    if (plan.sources.length !== 2) throw new Error(`sources: ${plan.sources.length}`)
    const url = plan.sources.find(source => source.kind === 'remote-url')!
    if (!url) throw new Error('the URL source is missing')
    if (url.jobIds.join(',') !== 'j1,j2') throw new Error(`url jobs: ${url.jobIds.join(',')}`)
    if (plan.sources[1]!.location !== 'C:\\clips\\b.mp4') throw new Error('plan order is not first-seen')
    if (plan.ingestable !== 3) throw new Error(`ingestable: ${plan.ingestable}`)
    if (plan.simulated !== 1) throw new Error(`simulated: ${plan.simulated}`)
    if (plan.unknown !== 2) throw new Error(`unknown: ${plan.unknown}`)
  })

  check('an empty job list produces an empty plan', () => {
    const plan = planOutputIngest([])
    if (plan.sources.length !== 0 || plan.ingestable !== 0 || plan.simulated !== 0 || plan.unknown !== 0) {
      throw new Error('empty plan is not empty')
    }
  })

  console.log(`\n=== All ${passed} output-source checks passed ===`)
}

main()
