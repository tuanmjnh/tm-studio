<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVideoFactory, type BatchPreview } from '~/composables/useVideoFactory'
import { useVideoTemplates } from '~/composables/useVideoTemplates'
import { useTmcutAi } from '~/composables/useTmcutAi'
import { sampleRecordFor } from '~/utils/tmcut/videoTemplates'
import { classifyOutputSource, planOutputIngest } from '~/utils/tmcut/outputSources'
import {
  DEFAULT_BUDGET_GUARD,
  parseCsvRecords,
  parseJsonRecords,
  type BatchInputRecord
} from '~/utils/tmcut/videoFactory'
import type { VideoBatch, VideoBatchItem } from '~/types/videoFactory'

// Video Factory (Roadmap v1 §6 + §8, P5): template → input records → estimate
// → explicit confirmation → bounded queue → review board.
//
// Everything that matters (validation, pricing, retry rules, concurrency) lives
// in `~/utils/tmcut/videoFactory`; this component is the wizard around it. The
// only runner wired today is the deterministic dry run — a live provider
// connection is P4 and plugs into the same `FactoryRunner` interface.
const { t } = useI18n()
const toast = useToast()
const router = useRouter()
const catalog = useVideoTemplates()
const factory = useVideoFactory()
const projectStore = useTmcutProject()
const media = useTmcutMedia()
const ai = useTmcutAi()

// Run mode (Roadmap v1 P4): dry-run by default; switches to a live provider
// runner when the user explicitly opts in and a provider/key is available.
// 'auto' = capability-driven per-scene routing (P7).
type RunMode = 'dry-run' | 'live' | 'auto'
const runMode = ref<RunMode>('dry-run')
const selectedProvider = ref('')
const isElectron = typeof window !== 'undefined' && !!(window as unknown as Record<string, unknown>).electronAPI
const availableProviders = ref<Array<{ id: string, label: string }>>([])
const providerManifests = ref<Array<Record<string, unknown>>>([])
const providersLoading = ref(false)

// Prompt-to-Batch mode (Roadmap v1 §6): natural language → AI generates input records
type InputMode = 'manual' | 'prompt'
const inputMode = ref<InputMode>('manual')
const generationPrompt = ref('')
const promptVariants = ref(3)
const promptGenerating = ref(false)

// Fetch available video generation providers (desktop only).
async function loadProviders() {
  if (!isElectron || providersLoading.value) return
  providersLoading.value = true
  try {
    const api = (window as unknown as Record<string, unknown>).electronAPI as { tools?: { videoGeneration?: { providers(): Promise<{ ok: boolean, data?: Array<{ id: string, label: string, manifest?: Record<string, unknown> }> }> } } } | undefined
    const res = await api?.tools?.videoGeneration?.providers()
    if (res?.ok && Array.isArray(res.data)) {
      availableProviders.value = res.data.map(p => ({ id: p.id, label: p.label || p.id }))
      providerManifests.value = res.data.map(p => p.manifest).filter(Boolean) as Array<Record<string, unknown>>
      if (availableProviders.value.length > 0 && !selectedProvider.value) {
        selectedProvider.value = availableProviders.value[0]!.id
      }
    }
  } catch {
    // Non-Electron or IPC not ready — stay on dry run.
  } finally {
    providersLoading.value = false
  }
}

const canGoLive = computed(() => isElectron && availableProviders.value.length > 0 && !!selectedProvider.value)

function getIpcBridge(): import('~/utils/tmcut/videoFactoryRunner').VideoGenerationIpc | null {
  if (!isElectron) return null
  const api = (window as unknown as Record<string, unknown>).electronAPI as {
    tools?: {
      videoGeneration?: {
        submit(args: { providerId: string, input: Record<string, unknown>, idempotencyKey?: string }): Promise<{ ok: boolean, data?: { jobId: string, providerTaskId: string, status: string, estimatedCompletionSec: number } }>
        poll(args: { jobId: string }): Promise<{ ok: boolean, data?: { jobId: string, status: string, progress: number, costSoFar: number, results: Array<Record<string, unknown>>, error: string | null, etaSec?: number } }>
        cancel(args: { jobId: string }): Promise<{ ok: boolean }>
        download(args: { jobId: string, destDir?: string }): Promise<{ ok: boolean, data?: { localPath: string, checksum: string, fileSizeBytes: number, mimeType: string, width: number, height: number, durationSec: number } }>
      }
    }
  } | undefined
  const vg = api?.tools?.videoGeneration
  if (!vg) throw new Error('videoGeneration IPC bridge not available')
  return {
    submit: args => vg.submit(args),
    poll: args => vg.poll(args),
    cancel: args => vg.cancel(args),
    download: args => vg.download(args)
  }
}

const selectedTemplate = ref('')
const inputFormat = ref<'csv' | 'json'>('csv')
const rawInput = ref('')
const parsed = ref<BatchInputRecord[] | null>(null)
const parseError = ref<string | null>(null)
const previewed = ref<BatchPreview | null>(null)
const confirmed = ref(false)
const selectedBatchId = ref<string | null>(null)
const busy = ref(false)

const templateOptions = computed(() => catalog.families.value
  .filter(family => family.publishedVersion)
  .map(family => ({
    label: `${family.name} · v${family.publishedVersion}`,
    value: `${family.templateId}@${family.publishedVersion}`
  })))

// AI availability gate. Web: probed on mount against the relay catalogue —
// previously gated on isDesktop, which kept generation buttons dead even
// though ai.complete runs over the relay.
const aiReady = ref(false)
onMounted(() => {
  loadProviders()
  void ai.probeAiReady().then(ok => (aiReady.value = ok))
})

const currentTemplate = computed(() => {
  const [templateId, version] = selectedTemplate.value.split('@')
  if (!templateId || !version) return undefined
  return catalog.getVersion(templateId, version)
})

const canCheck = computed(() => !!currentTemplate.value && rawInput.value.trim().length > 0)

const plan = computed(() => previewed.value?.plan)
const estimate = computed(() => previewed.value?.estimate)
const guard = computed(() => previewed.value?.budget)

/** A batch may only be queued when nothing blocks it. */
const canQueue = computed(() => {
  if (!previewed.value?.ok || !plan.value || !guard.value || !estimate.value) return false
  if (plan.value.validCount === 0) return false
  if (!guard.value.allowed) return false
  if (guard.value.requiresConfirmation && !confirmed.value) return false
  return true
})

const queue = computed(() => factory.activeBatches.value)
const historyBatches = computed(() => factory.history.value)
const selectedBatch = computed(() => (selectedBatchId.value ? factory.batch(selectedBatchId.value) : undefined))
const selectedItems = computed(() => (selectedBatchId.value ? factory.itemsOf(selectedBatchId.value) : []))
const selectedJobs = computed(() => (selectedBatchId.value ? factory.jobsOf(selectedBatchId.value) : []))

function tr(key: string, fallback: string, params?: Record<string, unknown>): string {
  const value = params ? t(key, params) : t(key)
  return value && value !== key ? value : fallback
}

/** Row label for the review board (items only store the raw record). */
function itemLabel(item: VideoBatchItem): string {
  const batch = selectedBatch.value
  const template = batch ? catalog.getVersion(batch.templateId, batch.templateVersion) : undefined
  const field = template?.inputSchema.find(entry => entry.required && (entry.type === 'text' || entry.type === 'textarea'))
  const value = field ? item.inputRecord[field.id] : undefined
  if (typeof value === 'string' && value.trim()) return value.trim()
  return `#${item.rowIndex + 1}`
}

function batchTemplateName(batch: VideoBatch): string {
  const template = catalog.getVersion(batch.templateId, batch.templateVersion)
  return template ? `${template.name} · v${batch.templateVersion}` : `${batch.templateId}@${batch.templateVersion}`
}

function statusLabel(status: string): string {
  return tr(`tmcut.factory.status.${status}`, status)
}

function statusColor(status: string): 'neutral' | 'primary' | 'success' | 'warning' | 'error' {
  if (['completed', 'approved', 'assembled'].includes(status)) return 'success'
  if (['processing', 'submitting', 'generating'].includes(status)) return 'primary'
  if (['paused', 'queued', 'needs_review', 'pending'].includes(status)) return 'warning'
  if (['failed', 'canceled', 'rejected'].includes(status)) return 'error'
  return 'neutral'
}

function batchProgress(batch: VideoBatch): number {
  const jobs = factory.jobsOf(batch.batchId)
  if (jobs.length === 0) return 0
  const settled = jobs.filter(job => ['completed', 'failed', 'canceled', 'needs_review', 'approved', 'assembled'].includes(job.status)).length
  return Math.round((settled / jobs.length) * 100)
}

function csvCell(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Seed the textarea with two rows built from the template's own defaults. */
function fillSample() {
  const template = currentTemplate.value
  if (!template) return
  const key = template.inputSchema.find(field => field.required && (field.type === 'text' || field.type === 'textarea'))?.id
  const base = sampleRecordFor(template)
  const rows = [1, 2].map((index) => {
    const record = { ...base }
    if (key) record[key] = `${String(base[key] ?? 'Sample')} ${index}`
    return record
  })
  if (inputFormat.value === 'json') {
    rawInput.value = JSON.stringify(rows, null, 2)
    return
  }
  const headers = template.inputSchema.map(field => field.id)
  const lines = [headers.join(','), ...rows.map(row => headers.map(id => csvCell(row[id])).join(','))]
  rawInput.value = lines.join('\n')
}

/** Parse the textarea into records — the estimates below depend on it. */
function parseInput(): BatchInputRecord[] | null {
  parseError.value = null
  try {
    if (inputFormat.value === 'json') {
      parsed.value = parseJsonRecords(rawInput.value)
    } else {
      const table = parseCsvRecords(rawInput.value)
      if (table.rows.length === 0) throw new Error(tr('tmcut.factory.noRows', 'No data rows found'))
      parsed.value = table.rows.map((record, index) => ({
        rowIndex: index,
        label: String(record.name ?? record.title ?? `Row ${index + 1}`),
        record
      }))
    }
    return parsed.value
  } catch (error) {
    parseError.value = error instanceof Error ? error.message : String(error)
    parsed.value = null
    previewed.value = null
    return null
  }
}

async function generateFromPrompt() {
  if (!generationPrompt.value.trim() || !currentTemplate.value || !aiReady.value) return
  promptGenerating.value = true
  try {
    const template = currentTemplate.value
    // Build a prompt for the AI to generate input records
    const fieldNames = template.inputSchema.map(f => f.id)
    const requiredFields = template.inputSchema.filter(f => f.required).map(f => f.id)
    const prompt = `Generate ${promptVariants.value} input records for a video template "${template.name}" (${template.topic}).
  Each record must have these fields: ${fieldNames.join(', ')}
  Required fields: ${requiredFields.join(', ')}
  User brief: ${generationPrompt.value.trim()}

  Return ONLY valid JSON array of objects, one per record. No markdown, no explanation.
  Example format: [{"field1": "value1", "field2": "value2"}, {"field1": "value3", "field2": "value4"}]`

    const res = await ai.complete({
      task: 'plan',
      jsonMode: true,
      messages: [
        { role: 'system', content: 'You generate structured input data for video templates. Output only valid JSON arrays.' },
        { role: 'user', content: prompt }
      ],
      maxTokens: 2048,
      temperature: 0.5
    })

    let records: BatchInputRecord[] | null = null
    try {
      const parsed = JSON.parse(res.content)
      if (Array.isArray(parsed)) {
        records = parsed.map((r, i) => ({
          rowIndex: i,
          label: String(r.name ?? r.title ?? `Variant ${i + 1}`),
          record: r
        }))
      }
    } catch {
      toast.add({ title: t('tmcut.factory.aiParseFailed'), description: t('tmcut.factory.aiParseFailedDesc'), color: 'error' })
      return
    }

    if (!records || records.length === 0) {
      toast.add({ title: t('tmcut.factory.aiEmpty'), description: t('tmcut.factory.aiEmptyDesc'), color: 'warning' })
      return
    }

    // Switch to manual mode and populate the textarea with generated JSON
    inputMode.value = 'manual'
    inputFormat.value = 'json'
    rawInput.value = JSON.stringify(records.map(r => r.record), null, 2)
    previewed.value = null
    parseError.value = null
    toast.add({ title: t('tmcut.factory.aiGenerated'), description: t('tmcut.factory.aiGeneratedDesc', { count: records.length }), color: 'success' })
  } catch (error) {
    toast.add({ title: t('tmcut.factory.aiError'), description: (error as Error)?.message || String(error), color: 'error' })
  } finally {
    promptGenerating.value = false
  }
}

function checkBatch() {
  const records = parseInput()
  if (!records) return
  const [templateId, version] = selectedTemplate.value.split('@')
  const result = factory.preview(templateId!, version!, records)
  previewed.value = result
  confirmed.value = false
  if (!result.ok) {
    toast.add({ title: tr('tmcut.factory.checkFailed', 'That batch could not be planned'), description: result.error?.message, color: 'error' })
  }
}

async function queueBatch() {
  const records = parsed.value
  if (!records || !canQueue.value) return
  const [templateId, version] = selectedTemplate.value.split('@')
  const committed = factory.commit(templateId!, version!, records, {
    confirmed: confirmed.value,
    inputSource: inputFormat.value,
    budget: DEFAULT_BUDGET_GUARD
  })
  if (!committed.ok || !committed.batchId) {
    toast.add({ title: tr('tmcut.factory.queueFailed', 'Queueing failed'), description: committed.error?.message, color: 'error' })
    return
  }
  selectedBatchId.value = committed.batchId
  previewed.value = null
  confirmed.value = false
  toast.add({ title: tr('tmcut.factory.queued', 'Batch queued'), color: 'success' })
  await runBatch(committed.batchId)
}

async function runBatch(batchId: string) {
  if (factory.isRunning(batchId)) return
  busy.value = true
  try {
    // Build the right runner for the current mode.
    let runner: import('~/utils/tmcut/videoFactoryRunner').FactoryRunner | undefined
    if (runMode.value === 'live') {
      try {
        const ipc = getIpcBridge()
        if (!ipc) throw new Error('No IPC bridge')
        const { createProviderRunner } = await import('~/utils/tmcut/videoFactoryRunner')
        runner = createProviderRunner({ ipc, providerId: selectedProvider.value })
      } catch (runnerErr) {
        toast.add({ title: t('tmcut.factory.liveRunnerFailed', 'Live runner unavailable'), description: String(runnerErr), color: 'error' })
        return
      }
    } else if (runMode.value === 'auto') {
      try {
        const ipc = getIpcBridge()
        if (!ipc) throw new Error('No IPC bridge')
        const { createAutoRunner } = await import('~/utils/tmcut/videoFactoryRunner')
        runner = createAutoRunner({ ipc })
      } catch (runnerErr) {
        toast.add({ title: t('tmcut.factory.autoRunnerFailed', 'Auto runner unavailable'), description: String(runnerErr), color: 'error' })
        return
      }
    }
    // Build per-provider concurrency map from capability manifests (rateLimitRpm).
    const providerConcurrency: Record<string, number> = {}
    for (const m of providerManifests.value) {
      const rpm = Number(m.rateLimitRpm)
      if (Number.isFinite(rpm) && rpm > 0 && m.providerId) {
        providerConcurrency[String(m.providerId)] = Math.max(1, Math.floor(rpm / 60)) // convert rpm to concurrent slots (rough)
      }
    }
    const result = await factory.run(batchId, { runner, providerConcurrency })
    if (result.ok) {
      const batch = factory.batch(batchId)
      toast.add({
        title: runMode.value === 'live'
          ? tr('tmcut.factory.finishedLive', 'Batch finished (live)')
          : tr('tmcut.factory.finished', 'Batch finished'),
        description: batch ? `${batch.completedItems}/${batch.totalItems}` : undefined,
        color: (batch?.failedItems ?? 0) > 0 ? 'warning' : 'success'
      })
    } else {
      toast.add({ title: tr('tmcut.factory.runFailed', 'Batch run failed'), description: result.error, color: 'error' })
    }
  } finally {
    busy.value = false
  }
}

function pauseBatch(batchId: string) {
  const result = factory.pause(batchId)
  toast.add({
    title: result.ok ? tr('tmcut.factory.paused', 'Batch paused') : tr('tmcut.factory.actionFailed', 'That action failed'),
    color: result.ok ? 'neutral' : 'error'
  })
}

function resumeBatch(batchId: string) {
  const result = factory.resume(batchId)
  if (!result.ok) {
    toast.add({ title: tr('tmcut.factory.actionFailed', 'That action failed'), description: result.error?.message, color: 'error' })
    return
  }
  void runBatch(batchId)
}

function cancelBatch(batchId: string) {
  const result = factory.cancel(batchId)
  toast.add({
    title: result.ok ? tr('tmcut.factory.canceledToast', 'Batch canceled') : tr('tmcut.factory.actionFailed', 'That action failed'),
    description: result.ok && result.providerCancelPending
      ? tr('tmcut.factory.providerCancelNote', 'Jobs already sent to a provider may still be billed — provider-side cancellation is not available yet.')
      : undefined,
    color: result.ok ? 'neutral' : 'error'
  })
}

function retryJob(jobId: string) {
  const result = factory.retryJob(jobId)
  if (!result.ok) {
    toast.add({ title: tr('tmcut.factory.actionFailed', 'That action failed'), description: result.error, color: 'error' })
    return
  }
  if (selectedBatchId.value) void runBatch(selectedBatchId.value)
}

function approveJob(jobId: string) {
  const result = factory.approveOutput(jobId)
  toast.add({
    title: result.ok ? tr('tmcut.factory.approved', 'Output approved') : tr('tmcut.factory.actionFailed', 'That action failed'),
    description: result.error,
    color: result.ok ? 'success' : 'error'
  })
}

/**
 * P6 readiness: recomputed from the store's refs, so approving a scene or a
 * retry immediately changes what the assemble button will do.
 */
const assembly = computed(() => (selectedBatchId.value ? factory.assemblyPlan(selectedBatchId.value) : null))
const assemblyReady = computed(() => assembly.value?.plan?.readyCount ?? 0)
const assemblyTotal = computed(() => assembly.value?.plan?.items.length ?? 0)
const assemblyBlocked = computed(() => assembly.value?.plan?.blockedCount ?? 0)
const assemblyNarration = computed(() => assembly.value?.plan?.narrationUnvoiced ?? 0)

/** Byte progress of the download currently feeding the assembly step. */
const ingestProgress = ref<{ id: string, loaded: number, total: number } | null>(null)
let ingestCanceled = false

/** 0–100 for the bar; a server without content-length stays at 0 (indeterminate). */
const ingestPercent = computed(() => {
  const progress = ingestProgress.value
  if (!progress || progress.total <= 0) return 0
  return Math.min(100, Math.round((progress.loaded / progress.total) * 100))
})

function firstBlockedReason(): string {
  const blocked = assembly.value?.plan?.items.find(item => !item.ok)
  return blocked?.issues[0]?.message || ''
}

const MIME_EXTENSION: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav'
}

/** Filename for an imported output; the media library classifies by extension. */
function fileNameForLocation(location: string, mime: string): string {
  const bare = location.split(/[?#]/)[0] || ''
  const last = bare.split(/[\\/]/).pop() || ''
  if (/\.[a-z0-9]{2,5}$/i.test(last)) return last
  const extension = MIME_EXTENSION[mime] || 'mp4'
  return `generated-${Date.now().toString(36)}.${extension}`
}

/**
 * Bring every playable job output into the media library and map job → src.
 * Outputs that cannot be ingested are counted, never silently dropped into a
 * clip that points at nothing. Opaque control-plane ids stay untouched here and
 * keep their previous behaviour in the resolver below.
 */
async function ingestOutputSources(batchId: string): Promise<{
  byJob: Map<string, string>
  imported: number
  failed: number
  simulated: number
  unknown: number
  canceled: boolean
}> {
  const plan = planOutputIngest(factory.jobsOf(batchId))
  const byJob = new Map<string, string>()
  let imported = 0
  let failed = 0
  ingestCanceled = false
  if (plan.ingestable > 0) {
    // The media registry is persisted as a whole; importing before the existing
    // library is loaded would rewrite it with only the new files.
    await media.loadLibrary()
  }

  const paths = plan.sources
    .filter(source => source.kind === 'local-path' && !!source.location)
  if (paths.length > 0) {
    if (!media.isDesktop.value) {
      // A desktop path cannot be read by a browser tab; say so instead of
      // importing a broken reference.
      failed += paths.reduce((sum, source) => sum + source.jobIds.length, 0)
    } else {
      const result = await media.importFiles(paths.map(source => source.location!))
      imported += result.added
      failed += result.failed
      for (const source of paths) {
        for (const jobId of source.jobIds) byJob.set(jobId, source.location!)
      }
    }
  }

  for (const source of plan.sources) {
    if (source.kind !== 'remote-url' || !source.location) continue
    if (ingestCanceled) {
      failed += source.jobIds.length
      continue
    }
    if (media.isDesktop.value) {
      // Desktop must not import a blob (it would be persisted with a URL that
      // dies on restart): main downloads the bytes into the media folder first.
      const downloadId = `asm_${batchId}_${source.jobIds[0]}`
      ingestProgress.value = { id: downloadId, loaded: 0, total: 0 }
      try {
        const downloaded = await media.downloadRemoteMedia(source.location, {
          filename: fileNameForLocation(source.location, ''),
          id: downloadId
        })
        if (!downloaded.ok || !downloaded.path) throw new Error(downloaded.error || 'download failed')
        for (const jobId of source.jobIds) byJob.set(jobId, downloaded.path)
        imported += 1
      } catch (error) {
        failed += source.jobIds.length
        console.warn('[TmcutVideoFactory] Could not download output', source.location, error)
      } finally {
        ingestProgress.value = null
      }
      continue
    }
    try {
      const response = await fetch(source.location)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const blob = await response.blob()
      const file = new File([blob], fileNameForLocation(source.location, blob.type), {
        type: blob.type || 'video/mp4'
      })
      const created = await media.importWebFiles([file])
      const asset = created[0]
      if (!asset) throw new Error('unsupported media type')
      for (const jobId of source.jobIds) byJob.set(jobId, asset.path)
      imported += 1
    } catch (error) {
      failed += source.jobIds.length
      console.warn('[TmcutVideoFactory] Could not import output', source.location, error)
    }
  }

  return { byJob, imported, failed, simulated: plan.simulated, unknown: plan.unknown, canceled: ingestCanceled }
}

/** Stop the rest of the ingest queue and abort the download in flight. */
function cancelIngest() {
  ingestCanceled = true
  if (ingestProgress.value) void media.cancelMediaDownload(ingestProgress.value.id)
}

/**
 * Writes one assembled row as a real editor project: same creation path as
 * every other "new project", then the generated timeline replaces the empty
 * one and is saved. Returns the created id so the batch can reference it.
 */
async function assembleBatch(batchId: string) {
  if (busy.value) return
  busy.value = true
  const unsubscribe = media.onMediaDownloadProgress((payload) => {
    if (!ingestProgress.value || payload.id !== ingestProgress.value.id) return
    ingestProgress.value = { id: payload.id, loaded: payload.loaded, total: payload.total }
  })
  try {
    // Import first so the clips point at library assets instead of raw
    // provider ids, and the project's media panel shows them.
    const ingest = await ingestOutputSources(batchId)
    if (ingest.canceled) {
      toast.add({
        title: tr('tmcut.factory.assembleCanceled', 'Download canceled'),
        description: tr('tmcut.factory.assembleCanceledDesc', 'No project was created; the batch rows are untouched.'),
        color: 'neutral'
      })
      return
    }
    const result = await factory.assemble(batchId, {
      resolveSource: (job) => {
        const src = ingest.byJob.get(job.jobId)
        if (src) return { src }
        // Dry run: keep the honest "no media" marker.
        if (classifyOutputSource(job.outputAssetId) === 'simulated') return { simulated: true }
        // Opaque id: unchanged behaviour — the clip references the id, which the
        // editor shows as offline media rather than pretending it is a file.
        return job.outputAssetId ? { src: job.outputAssetId } : undefined
      },
      writeProject: (target) => {
        const project = projectStore.createProject(target.name, {
          width: target.canvas.width,
          height: target.canvas.height,
          fps: target.canvas.fps
        })
        const live = projectStore.currentProject.value
        if (!live) throw new Error('Project could not be created')
        // Write through the reactive ref: raw writes would leave the duration
        // computed stale and persist a wrong durationMs (same rule as R91).
        live.timeline = {
          version: 1,
          tracks: target.timeline.tracks,
          durationMs: target.timeline.durationMs,
          markers: []
        }
        live.durationMs = target.timeline.durationMs
        projectStore.saveProject()
        // The media library only lists assets linked to this project; import
        // happened before the project existed, so link them now.
        for (const track of target.timeline.tracks) {
          for (const clip of track.items) {
            const asset = media.findAssetBySrc(clip.src)
            if (asset) media.linkAssetToProject(asset.id, project.id)
          }
        }
        return project.id
      }
    })

    if (result.failed.length > 0) {
      toast.add({
        title: tr('tmcut.factory.assemblePartial', 'Some rows could not be assembled'),
        description: result.failed.map(entry => entry.message).join('; '),
        color: 'error'
      })
    }
    if (result.assembled.length === 0) {
      if (result.failed.length === 0) {
        toast.add({
          title: tr('tmcut.factory.assembleBlocked', 'Nothing to assemble yet'),
          description: result.error?.message,
          color: 'warning'
        })
      }
      return
    }

    const simulated = result.assembled.some(entry => entry.simulated)
    const notes: string[] = []
    if (ingest.imported > 0) {
      notes.push(tr('tmcut.factory.assembleImported', '{count} generated media file(s) added to the library.', { count: ingest.imported }))
    }
    if (ingest.failed > 0) {
      notes.push(tr('tmcut.factory.assembleImportFailed', '{count} output(s) had no importable media.', { count: ingest.failed }))
    }
    if (simulated) notes.push(tr('tmcut.factory.assembleDryNote', 'Dry-run outputs have no media file: the clips are placeholders until a real provider runs (P4).'))
    toast.add({
      title: tr('tmcut.factory.assembleDone', 'Projects created'),
      description: notes.length > 0 ? notes.join(' ') : undefined,
      color: ingest.failed > 0 || simulated ? 'warning' : 'success'
    })
    // Land in the editor on the first assembled project; the rest are saved and
    // listed in the project library like any other project.
    await router.push(`/tmcut/editor?project=${result.assembled[0]!.projectId}`)
  } finally {
    unsubscribe()
    ingestProgress.value = null
    busy.value = false
  }
}

function removeBatch(batchId: string) {
  factory.removeBatch(batchId)
  if (selectedBatchId.value === batchId) selectedBatchId.value = null
}
</script>

<template>
  <div class="grid grid-cols-1 xl:grid-cols-12 gap-6">
    <!-- ================================================================== -->
    <!-- Batch builder -->
    <!-- ================================================================== -->
    <div class="xl:col-span-5 flex flex-col gap-4">
      <div class="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4 flex flex-col gap-4">
        <div>
          <h3 class="text-sm font-semibold text-neutral-900 dark:text-white">
            {{ t('tmcut.factory.newBatch') }}
          </h3>
          <!-- No card description: the page header already shows the same
               tmcut.factory.newBatchDesc sentence one screen above. -->
        </div>

        <div>
          <!-- The accessible name goes on the control itself (aria-label): a
               <label> without a for/wrapped control names nothing, and these
               fields showed up in the browser as unlabelled form controls. -->
          <p class="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
            {{ t('tmcut.factory.templateLabel') }}
          </p>
          <USelect
            v-model="selectedTemplate"
            :items="templateOptions"
            :aria-label="t('tmcut.factory.templateLabel')"
            :placeholder="t('tmcut.factory.templatePlaceholder')"
            class="w-full"
            @update:model-value="previewed = null"
          />
          <p v-if="templateOptions.length === 0" class="text-xs text-neutral-400 mt-1.5">
            {{ t('tmcut.factory.noPublished') }}
          </p>
        </div>

        <div>
          <!-- Input mode selector: Manual CSV/JSON vs Prompt-to-Batch -->
          <div class="mb-2">
            <p class="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
              {{ t('tmcut.factory.inputModeLabel') }}
            </p>
            <div class="flex items-center gap-1" role="group" :aria-label="t('tmcut.factory.inputModeLabel')">
              <UButton
                size="xs"
                :color="inputMode === 'manual' ? 'primary' : 'neutral'"
                :variant="inputMode === 'manual' ? 'soft' : 'ghost'"
                @click="inputMode = 'manual'; previewed = null"
              >
                {{ t('tmcut.factory.manualMode') }}
              </UButton>
              <UButton
                size="xs"
                :color="inputMode === 'prompt' ? 'primary' : 'neutral'"
                :variant="inputMode === 'prompt' ? 'soft' : 'ghost'"
                :disabled="!aiReady"
                @click="inputMode = 'prompt'; previewed = null"
              >
                {{ t('tmcut.factory.promptMode') }}
              </UButton>
            </div>
          </div>

          <div v-if="inputMode === 'prompt'" class="mb-3">
            <p class="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
              {{ t('tmcut.factory.promptLabel') }}
            </p>
            <UTextarea
              v-model="generationPrompt"
              name="factory-prompt"
              :rows="4"
              :aria-label="t('tmcut.factory.promptLabel')"
              :placeholder="t('tmcut.factory.promptPlaceholder')"
              class="w-full text-sm"
            />
            <div class="flex items-center gap-2 mt-2">
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                :disabled="promptVariants <= 1"
                :aria-label="t('tmcut.factory.fewerVariants')"
                @click="promptVariants--"
              >
                <UIcon name="i-lucide-minus" class="size-3" />
              </UButton>
              <span class="text-sm font-mono w-8 text-center">{{ promptVariants }}</span>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                :disabled="promptVariants >= 20"
                :aria-label="t('tmcut.factory.moreVariants')"
                @click="promptVariants++"
              >
                <UIcon name="i-lucide-plus" class="size-3" />
              </UButton>
              <span class="text-xs text-neutral-500 ml-2">{{ t('tmcut.factory.variants') }}</span>
            </div>
            <UButton
              color="primary"
              variant="soft"
              icon="i-lucide-sparkles"
              block
              :disabled="!generationPrompt.trim() || !currentTemplate || !aiReady || promptGenerating"
              :loading="promptGenerating"
              @click="generateFromPrompt"
            >
              {{ t('tmcut.factory.generateFromPrompt') }}
            </UButton>
          </div>

          <div v-else class="flex items-center justify-between mb-1.5">
            <p class="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
              {{ t('tmcut.factory.inputLabel') }}
            </p>
            <div class="flex items-center gap-1">
              <UButton
                size="xs"
                :color="inputFormat === 'csv' ? 'primary' : 'neutral'"
                :variant="inputFormat === 'csv' ? 'soft' : 'ghost'"
                @click="inputFormat = 'csv'; previewed = null"
              >
                CSV
              </UButton>
              <UButton
                size="xs"
                :color="inputFormat === 'json' ? 'primary' : 'neutral'"
                :variant="inputFormat === 'json' ? 'soft' : 'ghost'"
                @click="inputFormat = 'json'; previewed = null"
              >
                JSON
              </UButton>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-wand-2"
                :disabled="!currentTemplate"
                @click="fillSample"
              >
                {{ t('tmcut.factory.fillSample') }}
              </UButton>
            </div>
          </div>
          <UTextarea
            v-model="rawInput"
            name="factory-input"
            :rows="8"
            :aria-label="t('tmcut.factory.inputLabel')"
            :placeholder="inputFormat === 'json' ? t('tmcut.factory.jsonPlaceholder') : t('tmcut.factory.csvPlaceholder')"
            class="w-full font-mono text-xs"
            @update:model-value="previewed = null; parseError = null"
          />
          <p class="text-xs text-neutral-400 mt-1.5">
            {{ t('tmcut.factory.inputHint') }}
          </p>
          <p v-if="parseError" class="text-xs text-error mt-1.5">
            {{ parseError }}
          </p>
        </div>

        <!-- Run mode: dry run (offline, safe) vs live provider (real cost) -->
        <div>
          <p class="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
            {{ t('tmcut.factory.runModeLabel', 'Run mode') }}
          </p>
          <div class="flex items-center gap-1.5 mb-2" role="group" :aria-label="t('tmcut.factory.runModeLabel', 'Run mode')">
            <UButton
              size="xs"
              :color="runMode === 'dry-run' ? 'primary' : 'neutral'"
              :variant="runMode === 'dry-run' ? 'soft' : 'ghost'"
              icon="i-lucide-flask-conical"
              @click="runMode = 'dry-run'"
            >
              {{ t('tmcut.factory.dryRunMode', 'Dry run') }}
            </UButton>
            <UButton
              size="xs"
              :color="runMode === 'live' ? 'primary' : 'neutral'"
              :variant="runMode === 'live' ? 'soft' : 'ghost'"
              icon="i-lucide-cloud"
              :disabled="!canGoLive"
              :title="canGoLive ? '' : t('tmcut.factory.liveNeedsProvider', 'Needs the desktop app and a configured provider')"
              @click="canGoLive && (runMode = 'live')"
            >
              {{ t('tmcut.factory.liveMode', 'Live provider') }}
            </UButton>
          </div>
          <div v-if="runMode === 'live'" class="space-y-1.5">
            <USelect
              v-model="selectedProvider"
              :items="availableProviders"
              value-key="id"
              label-key="label"
              :aria-label="t('tmcut.factory.providerPlaceholder', 'Pick a provider')"
              :placeholder="t('tmcut.factory.providerPlaceholder', 'Pick a provider')"
              :loading="providersLoading"
              class="w-full"
            />
            <p class="text-[11px] text-warning">
              {{ t('tmcut.factory.liveWarning', 'Live mode submits real generation jobs and spends real money via your configured provider keys.') }}
            </p>
          </div>
        </div>

        <UButton
          color="primary"
          variant="soft"
          icon="i-lucide-calculator"
          block
          :disabled="!canCheck"
          @click="checkBatch"
        >
          {{ t('tmcut.factory.estimate') }}
        </UButton>
      </div>

      <!-- Plan + estimate -->
      <div
        v-if="previewed && plan && estimate && guard"
        class="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4 flex flex-col gap-3"
      >
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-semibold text-neutral-900 dark:text-white">
            {{ t('tmcut.factory.planTitle') }}
          </h3>
          <UBadge :color="guard.allowed && plan.validCount > 0 ? 'success' : 'error'" variant="subtle" size="xs">
            {{ guard.allowed ? t('tmcut.factory.withinBudget') : t('tmcut.factory.overBudget') }}
          </UBadge>
        </div>

        <div class="grid grid-cols-3 gap-2 text-center">
          <div class="bg-neutral-50 dark:bg-neutral-950 rounded-lg p-2">
            <p class="text-lg font-semibold text-neutral-900 dark:text-white">
              {{ plan.validCount }}
            </p>
            <p class="text-[11px] text-neutral-500">
              {{ t('tmcut.factory.validRows') }}
            </p>
          </div>
          <div class="bg-neutral-50 dark:bg-neutral-950 rounded-lg p-2">
            <p class="text-lg font-semibold text-neutral-900 dark:text-white">
              {{ plan.sceneCount }}
            </p>
            <p class="text-[11px] text-neutral-500">
              {{ t('tmcut.factory.scenes') }}
            </p>
          </div>
          <div class="bg-neutral-50 dark:bg-neutral-950 rounded-lg p-2">
            <p class="text-lg font-semibold text-neutral-900 dark:text-white">
              {{ Math.round(plan.durationSec) }}s
            </p>
            <p class="text-[11px] text-neutral-500">
              {{ t('tmcut.factory.totalDuration') }}
            </p>
          </div>
        </div>

        <div class="flex items-baseline justify-between border-t border-neutral-200 dark:border-neutral-800 pt-3">
          <span class="text-xs text-neutral-500">{{ t('tmcut.factory.estimatedCost') }}</span>
          <span class="text-sm font-semibold text-neutral-900 dark:text-white">
            {{ estimate.lowEstimateUsd }}–{{ estimate.highEstimateUsd }} {{ estimate.currency }}
          </span>
        </div>
        <p class="text-[11px] text-neutral-400">
          {{ t('tmcut.factory.estimateNote') }}
        </p>

        <div v-if="plan.invalidCount > 0" class="rounded-lg bg-warning/10 border border-warning/30 p-2">
          <p class="text-xs font-medium text-warning mb-1">
            {{ t('tmcut.factory.invalidRows', { count: plan.invalidCount }) }}
          </p>
          <ul class="space-y-1">
            <li
              v-for="item in plan.items.filter(entry => !entry.ok)"
              :key="item.rowIndex"
              class="text-[11px] text-neutral-500 dark:text-neutral-400"
            >
              <span class="font-medium">{{ item.label }}:</span>
              {{ item.errors.map(error => error.message).join('; ') }}
            </li>
          </ul>
        </div>

        <div v-if="guard.blockedBy" class="rounded-lg bg-error/10 border border-error/30 p-2 text-xs text-error">
          {{ guard.blockedBy === 'daily-cap'
            ? t('tmcut.factory.blockedDaily', { remaining: guard.remainingDailyUsd })
            : t('tmcut.factory.blockedBatch', { remaining: guard.remainingBatchUsd }) }}
        </div>

        <div v-if="guard.requiresConfirmation && !guard.blockedBy" class="flex items-start gap-2">
          <USwitch v-model="confirmed" size="sm" :aria-label="t('tmcut.factory.confirmLabel')" />
          <div>
            <p class="text-xs font-medium text-neutral-700 dark:text-neutral-300">
              {{ t('tmcut.factory.confirmLabel') }}
            </p>
            <p class="text-[11px] text-neutral-400">
              {{ t('tmcut.factory.confirmHint') }}
            </p>
          </div>
        </div>

        <UButton
          color="primary"
          variant="soft"
          icon="i-lucide-play"
          block
          :disabled="!canQueue || busy"
          :loading="busy"
          @click="queueBatch"
        >
          {{ t('tmcut.factory.runBatch') }}
        </UButton>
        <p class="text-[11px] text-neutral-400">
          {{ t('tmcut.factory.dryRunNote') }}
        </p>
      </div>
    </div>

    <!-- ================================================================== -->
    <!-- Queue + results -->
    <!-- ================================================================== -->
    <div class="xl:col-span-7 flex flex-col gap-4">
      <div class="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl">
        <div class="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
          <h3 class="text-sm font-semibold text-neutral-900 dark:text-white">
            {{ t('tmcut.factory.queueTitle') }}
          </h3>
          <UBadge color="neutral" variant="subtle" size="xs">
            {{ queue.length }}
          </UBadge>
        </div>
        <!-- `queue` is the ACTIVE queue, so a finished batch leaves it while
             its detail card stays open just below. Rendering "No batch is
             queued." in that state contradicted the card underneath it. -->
        <div v-if="queue.length === 0 && !selectedBatch" class="px-4 py-8 text-center">
          <UIcon name="i-lucide-inbox" class="size-7 mx-auto text-neutral-400 mb-2" />
          <p class="text-xs text-neutral-500">
            {{ t('tmcut.factory.emptyQueue') }}
          </p>
        </div>
        <p v-else-if="queue.length === 0" class="px-4 py-3 text-[11px] text-neutral-500">
          {{ t('tmcut.factory.queueIdle') }}
        </p>
        <ul v-else class="divide-y divide-neutral-200 dark:divide-neutral-800">
          <li
            v-for="batch in queue"
            :key="batch.batchId"
            class="px-4 py-3 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-950/50"
            :class="{ 'bg-neutral-50 dark:bg-neutral-950/50': selectedBatchId === batch.batchId }"
            @click="selectedBatchId = batch.batchId"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0">
                <p class="text-xs font-medium text-neutral-900 dark:text-white truncate">
                  {{ batchTemplateName(batch) }}
                </p>
                <p class="text-[11px] text-neutral-500">
                  {{ t('tmcut.factory.itemCount', { done: batch.completedItems, total: batch.totalItems }) }}
                  · {{ batch.estimatedCostUsd }} {{ 'USD' }}
                </p>
              </div>
              <UBadge :color="statusColor(batch.status)" variant="subtle" size="xs">
                {{ statusLabel(batch.status) }}
              </UBadge>
            </div>
            <div class="mt-2 h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
              <div
                class="h-full bg-primary-500 transition-all"
                :style="{ width: `${batchProgress(batch)}%` }"
              />
            </div>
            <div class="mt-2 flex items-center gap-1.5" @click.stop>
              <UButton
                v-if="batch.status === 'paused'"
                size="xs"
                color="primary"
                variant="soft"
                icon="i-lucide-play"
                @click="resumeBatch(batch.batchId)"
              >
                {{ t('tmcut.factory.resume') }}
              </UButton>
              <UButton
                v-else-if="!factory.isRunning(batch.batchId)"
                size="xs"
                color="primary"
                variant="soft"
                icon="i-lucide-play"
                :disabled="busy"
                @click="runBatch(batch.batchId)"
              >
                {{ t('tmcut.factory.resume') }}
              </UButton>
              <UButton
                v-if="batch.status !== 'paused' && !factory.isRunning(batch.batchId)"
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-pause"
                @click="pauseBatch(batch.batchId)"
              >
                {{ t('tmcut.factory.pause') }}
              </UButton>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-x"
                @click="cancelBatch(batch.batchId)"
              >
                {{ t('tmcut.factory.cancel') }}
              </UButton>
            </div>
          </li>
        </ul>
      </div>

      <!-- Selected batch detail -->
      <div v-if="selectedBatch" class="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl">
        <div class="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-2">
          <div class="min-w-0">
            <p class="text-sm font-semibold text-neutral-900 dark:text-white truncate">
              {{ batchTemplateName(selectedBatch) }}
            </p>
            <p class="text-[11px] text-neutral-500">
              {{ t('tmcut.factory.jobCount', { count: selectedJobs.length }) }}
              · {{ t('tmcut.factory.actualCost', { cost: selectedBatch.actualCostUsd }) }}
            </p>
          </div>
          <UBadge :color="statusColor(selectedBatch.status)" variant="subtle" size="xs">
            {{ statusLabel(selectedBatch.status) }}
          </UBadge>
        </div>
        <ul class="divide-y divide-neutral-200 dark:divide-neutral-800 max-h-[420px] overflow-y-auto">
          <li v-for="item in selectedItems" :key="item.itemId" class="px-4 py-2.5">
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0">
                <p class="text-xs font-medium text-neutral-900 dark:text-white truncate">
                  {{ itemLabel(item) }}
                </p>
                <p v-if="item.error" class="text-[11px] text-error truncate">
                  {{ item.error }}
                </p>
              </div>
              <UBadge :color="statusColor(item.status)" variant="subtle" size="xs">
                {{ statusLabel(item.status) }}
              </UBadge>
            </div>
            <div v-if="item.generationJobIds.length > 0" class="mt-1.5 flex flex-wrap gap-1">
              <button
                v-for="jobId in item.generationJobIds"
                :key="jobId"
                type="button"
                class="text-[10px] px-1.5 py-0.5 rounded border transition-colors cursor-pointer"
                :class="{
                  'border-success/40 text-success': selectedJobs.find(job => job.jobId === jobId)?.status === 'completed',
                  'border-error/40 text-error': selectedJobs.find(job => job.jobId === jobId)?.status === 'failed',
                  'border-primary/40 text-primary': ['processing', 'submitting'].includes(selectedJobs.find(job => job.jobId === jobId)?.status ?? ''),
                  'border-neutral-300 dark:border-neutral-700 text-neutral-500': !['completed', 'failed', 'processing', 'submitting'].includes(selectedJobs.find(job => job.jobId === jobId)?.status ?? '')
                }"
                @click="selectedBatchId = item.batchId"
              >
                {{ jobId.split(':').pop() }}
              </button>
            </div>
            <div class="mt-1.5 flex items-center gap-1.5">
              <UButton
                v-for="job in selectedJobs.filter(entry => entry.itemId === item.itemId && entry.status === 'failed')"
                :key="`retry-${job.jobId}`"
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-rotate-ccw"
                @click="retryJob(job.jobId)"
              >
                {{ t('tmcut.factory.retry') }}
              </UButton>
              <UButton
                v-for="job in selectedJobs.filter(entry => entry.itemId === item.itemId && entry.status === 'completed')"
                :key="`approve-${job.jobId}`"
                size="xs"
                color="success"
                variant="ghost"
                icon="i-lucide-check"
                @click="approveJob(job.jobId)"
              >
                {{ t('tmcut.factory.approve') }}
              </UButton>
            </div>
          </li>
        </ul>

        <!-- P6: approved outputs → editable project timeline -->
        <div
          v-if="assembly?.plan"
          class="px-4 py-3 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-2"
        >
          <div class="min-w-0">
            <p class="text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
              {{ t('tmcut.factory.assemblyTitle') }}
            </p>
            <p class="text-[11px] text-neutral-500">
              {{ t('tmcut.factory.assemblyReady', { ready: assemblyReady, total: assemblyTotal }) }}
            </p>
            <p v-if="assemblyBlocked > 0" class="text-[11px] text-warning truncate">
              {{ firstBlockedReason() }}
            </p>
            <p v-if="assemblyNarration > 0" class="text-[11px] text-neutral-400">
              {{ t('tmcut.factory.assemblyNarrationNote', { count: assemblyNarration }) }}
            </p>
            <div v-if="ingestProgress" class="mt-1.5">
              <div class="h-1 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                <div class="h-full bg-primary-500 transition-all" :style="{ width: `${ingestPercent}%` }" />
              </div>
              <p class="text-[10px] text-neutral-400 mt-1">
                {{ t('tmcut.factory.assemblyDownloading', { percent: ingestPercent }) }}
              </p>
            </div>
          </div>
          <UButton
            v-if="ingestProgress"
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            @click="cancelIngest()"
          >
            {{ t('tmcut.factory.assemblyCancelDownload') }}
          </UButton>
          <UButton
            v-else
            size="xs"
            color="primary"
            variant="soft"
            icon="i-lucide-clapperboard"
            :disabled="assemblyReady === 0 || busy"
            @click="assembleBatch(selectedBatch.batchId)"
          >
            {{ t('tmcut.factory.assemble') }}
          </UButton>
        </div>
      </div>

      <!-- History -->
      <div v-if="historyBatches.length > 0" class="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl">
        <div class="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
          <h3 class="text-sm font-semibold text-neutral-900 dark:text-white">
            {{ t('tmcut.factory.historyTitle') }}
          </h3>
        </div>
        <ul class="divide-y divide-neutral-200 dark:divide-neutral-800 max-h-[260px] overflow-y-auto">
          <li
            v-for="batch in historyBatches"
            :key="batch.batchId"
            class="px-4 py-2.5 flex items-center justify-between gap-2 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-950/50"
            @click="selectedBatchId = batch.batchId"
          >
            <div class="min-w-0">
              <p class="text-xs font-medium text-neutral-900 dark:text-white truncate">
                {{ batchTemplateName(batch) }}
              </p>
              <p class="text-[11px] text-neutral-500">
                {{ new Date(batch.createdAt).toLocaleString() }}
                · {{ t('tmcut.factory.itemCount', { done: batch.completedItems, total: batch.totalItems }) }}
              </p>
            </div>
            <div class="flex items-center gap-1.5">
              <UBadge :color="statusColor(batch.status)" variant="subtle" size="xs">
                {{ statusLabel(batch.status) }}
              </UBadge>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-trash-2"
                :aria-label="t('tmcut.factory.deleteBatch')"
                @click.stop="removeBatch(batch.batchId)"
              />
            </div>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
