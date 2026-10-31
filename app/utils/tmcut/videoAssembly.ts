/**
 * Project assembly — approved generation outputs → editable timeline
 * (Roadmap v1 §7 / P6).
 *
 * The whole translation is pure: given a batch, its items/jobs and the pinned
 * template version, it returns one plan per row containing a REAL
 * `TmcutTimelineItem[]` per track, already in TICKS. The caller (the factory
 * store) only has to hand that timeline to the project store, so the assembled
 * project opens in Editor Studio like any other project and every generated
 * clip stays individually editable.
 *
 * Rules encoded here:
 *  - assembly starts from APPROVED scene jobs only — an unreviewed output is
 *    never silently baked into a timeline;
 *  - an item is assembled only when ALL of its scenes are approved AND have a
 *    resolvable source; a partially approved row is refused as a whole (a
 *    timeline with holes is worse than no timeline);
 *  - an already assembled job blocks re-assembly, so pressing the button twice
 *    cannot produce two projects from the same batch row;
 *  - scene order and durations come from the queued snapshot
 *    (`normalizedRequest`), not from the template as it is NOW: a template
 *    edited after queueing must not reshuffle an existing batch;
 *  - captions use the template's `assemblyProfile.captionStyle`; the first
 *    clip never gets an intro transition.
 *
 * Deliberately out of scope until later phases: music (P7 marketplace) and
 * synthesised narration (P4/P7). Narration lines are COUNTED, not faked into an
 * audio track that would render silence.
 */
import { TICKS_PER_SECOND, getAssemblyReadyAssets } from '@tmcut-core'
import type { TmcutTimelineItem, TmcutTrack } from '~/composables/useTmcutProject'
import type { GenerationJob, VideoBatch, VideoBatchItem } from '~/types/videoFactory'
import type { AssemblyProfile, VideoTemplate } from '~/types/videoTemplate'
import type { AssetCenterCatalogEntry } from '@tmcut-core'
import { labelFor } from '~/utils/tmcut/videoFactory'

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type AssemblyIssueCode = 'not-approved' | 'job-failed' | 'job-canceled' | 'missing-output' | 'no-jobs' | 'already-assembled'

export interface AssemblyIssue {
  code: AssemblyIssueCode
  message: string
  sceneIndex?: number
}

export interface AssemblySource {
  /** Playable path/URL. Absent for a simulated (dry run) output. */
  src?: string
  /** True when the id came from the offline dry run — nothing to play. */
  simulated?: boolean
}

export interface AssembledScene {
  sceneIndex: number
  jobId: string
  clipId: string
  role: string
  startSec: number
  durationSec: number
  simulated: boolean
}

export interface AssemblyTimeline {
  tracks: TmcutTrack[]
  durationMs: number
  clipCount: number
  captionCount: number
}

export interface AssemblyItemPlan {
  itemId: string
  rowIndex: number
  label: string
  /** True when this row can be written as a project. */
  ok: boolean
  issues: AssemblyIssue[]
  projectId: string
  projectName: string
  canvas: { width: number, height: number }
  fps: { numerator: number, denominator: number }
  scenes: AssembledScene[]
  simulated: boolean
  /** Narration lines in this row with no synthesised voice yet. */
  narrationUnvoiced?: number
  timeline?: AssemblyTimeline
}

export interface AssemblyPlan {
  batchId: string
  templateId: string
  templateVersion: string
  items: AssemblyItemPlan[]
  readyCount: number
  blockedCount: number
  clipCount: number
  simulatedCount: number
  /** Scene narrations with no synthesised voice yet (P4/P7 add TTS). */
  narrationUnvoiced: number
}

export interface AssemblyInput {
  batch: VideoBatch
  items: VideoBatchItem[]
  jobs: GenerationJob[]
  template: VideoTemplate
  /** Asset Center catalog for music/SFX (P7 marketplace) */
  assetCatalog?: AssetCenterCatalogEntry[]
  /** Resolve a job to a playable source. Defaults to `job.outputAssetId`. */
  resolveSource?: (job: GenerationJob) => AssemblySource | undefined
  /** Deterministic project id (tests, or a caller with its own id scheme). */
  projectIdFor?: (item: VideoBatchItem) => string
}

export interface AssemblyBuildResult {
  ok: boolean
  error?: { code: string, message: string }
  plan?: AssemblyPlan
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const DEFAULT_CAPTION_STYLE: AssemblyProfile['captionStyle'] = {
  fontFamily: 'Inter',
  fontSize: 48,
  color: '#ffffff',
  position: 'bottom',
  maxCharsPerLine: 32,
  animation: 'none'
}

function ticksFromSec(seconds: number): number {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  return Math.max(1, Math.round(safe * TICKS_PER_SECOND))
}

function canvasFor(template: VideoTemplate): { width: number, height: number, fps: number } {
  const profile = template.assemblyProfile?.outputProfile
  const resolution = profile?.resolution
  // Templates are validated before they can be published, so these are always
  // present — the fallbacks only protect an archived/hand-edited document.
  return {
    width: Number(resolution?.width) || 1080,
    height: Number(resolution?.height) || 1920,
    fps: Number(profile?.frameRate) || 30
  }
}

function sceneOrder(job: GenerationJob, fallback: number): number {
  const value = job.normalizedRequest?.sceneOrder
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Jobs of one item in scene order, using the batch's queued snapshot. */
function jobsForItem(item: VideoBatchItem, jobs: GenerationJob[]): GenerationJob[] {
  const byId = new Map(jobs.filter(job => job.itemId === item.itemId).map(job => [job.jobId, job]))
  const ordered: GenerationJob[] = []
  const seen = new Set<string>()
  // `generationJobIds` was written in storyboard order at queue time; the
  // sceneOrder fallback covers jobs appended later (a manual retry).
  item.generationJobIds.forEach((jobId) => {
    const job = byId.get(jobId)
    if (!job || seen.has(job.jobId)) return
    seen.add(job.jobId)
    ordered.push(job)
  })
  byId.forEach((job) => {
    if (!seen.has(job.jobId)) ordered.push(job)
  })
  return ordered
    .map((job, index) => ({ job, order: sceneOrder(job, index) }))
    .sort((a, b) => a.order - b.order)
    .map(entry => entry.job)
}

function resolveSource(job: GenerationJob, resolver?: AssemblyInput['resolveSource']): AssemblySource | undefined {
  if (resolver) return resolver(job)
  const asset = job.outputAssetId
  if (!asset) return undefined
  if (asset.startsWith('dryrun:')) return { simulated: true }
  return { src: asset }
}

function captionY(position: string, height: number): number {
  // Clip x/y are canvas-space pixels (the preview scales them by its own
  // zoom), so the default caption band follows the output resolution.
  if (position === 'top') return -Math.round(height * 0.35)
  if (position === 'center') return 0
  return Math.round(height * 0.35)
}

// -----------------------------------------------------------------------------
// Plan builder
// -----------------------------------------------------------------------------

/**
 * Turn a batch row into a timeline blueprint. Never mutates its inputs: the
 * plan is data the store writes to a NEW project.
 */
export function buildAssemblyPlan(input: AssemblyInput): AssemblyBuildResult {
  const { batch, template } = input
  if (!template) {
    return { ok: false, error: { code: 'template-not-found', message: 'The batch template version is not available' } }
  }

  const canvas = canvasFor(template)
  const profile = template.assemblyProfile
  const captionStyle = { ...DEFAULT_CAPTION_STYLE, ...(profile?.captionStyle || {}) }
  const transition = profile?.transitionProfile
  const batchItems = input.items
    .filter(item => item.batchId === batch.batchId)
    .sort((a, b) => a.rowIndex - b.rowIndex)

  const items: AssemblyItemPlan[] = batchItems.map((item) => {
    const label = labelFor(template, item.inputRecord, item.rowIndex)
    const projectId = input.projectIdFor
      ? input.projectIdFor(item)
      : `asm_${batch.batchId}_r${item.rowIndex}`
    const issues: AssemblyIssue[] = []
    const itemJobs = jobsForItem(item, input.jobs)

    if (itemJobs.length === 0) {
      issues.push({
        code: 'no-jobs',
        message: 'This row never produced generation jobs (it failed validation)'
      })
    }

    let unvoiced = 0
    const sources = new Map<string, AssemblySource>()

    itemJobs.forEach((job, index) => {
      if (job.status === 'assembled') {
        issues.push({
          code: 'already-assembled',
          message: 'This row was already assembled into a project',
          sceneIndex: index
        })
        return
      }
      if (job.status === 'failed') {
        issues.push({ code: 'job-failed', message: job.errorMessage || 'Scene generation failed', sceneIndex: index })
        return
      }
      if (job.status === 'canceled') {
        issues.push({ code: 'job-canceled', message: 'Scene generation was canceled', sceneIndex: index })
        return
      }
      if (job.status !== 'approved') {
        issues.push({
          code: 'not-approved',
          message: `Scene ${index + 1} is ${job.status}, not approved`,
          sceneIndex: index
        })
        return
      }
      const source = resolveSource(job, input.resolveSource)
      if (!source) {
        issues.push({ code: 'missing-output', message: 'Approved output has no asset id', sceneIndex: index })
        return
      }
      sources.set(job.jobId, source)
      if (String(job.normalizedRequest?.narration || '').trim()) unvoiced += 1
    })

    const blocked = issues.length > 0
    const plan: AssemblyItemPlan = {
      itemId: item.itemId,
      rowIndex: item.rowIndex,
      label,
      ok: !blocked,
      issues,
      projectId,
      projectName: `${label}`,
      canvas: { width: canvas.width, height: canvas.height },
      fps: { numerator: canvas.fps, denominator: 1 },
      scenes: [],
      simulated: false
    }
    plan.narrationUnvoiced = unvoiced

    if (blocked) return plan

    const videoItems: TmcutTimelineItem[] = []
    const textItems: TmcutTimelineItem[] = []
    let cursor = 0
    let simulated = false

    itemJobs.forEach((job, index) => {
      const source = sources.get(job.jobId)!
      const durationSec = Number(job.normalizedRequest?.durationSec) || 0
      const durationTicks = ticksFromSec(durationSec)
      const offset = cursor
      cursor += durationTicks
      const sceneRole = String(job.normalizedRequest?.sceneRole || 'scene')
      const clipId = `clip_${job.jobId}`
      if (source.simulated) simulated = true

      const onScreenText = String(job.normalizedRequest?.onScreenText || '').trim()
      const override = transition?.perSceneOverrides?.[String(job.sceneId || '')]
      const transitionType = override?.type || transition?.defaultType || 'none'
      const transitionSec = override?.durationSec ?? transition?.defaultDurationSec ?? 0

      videoItems.push({
        id: clipId,
        name: `${label} #${index + 1}`,
        src: source.src,
        in: 0,
        // Intent is the scene's planned length: a shorter asset holds its last
        // frame, a longer one is trimmed. Both remain editable in the inspector.
        out: durationTicks,
        offset,
        speed: 1,
        opacity: 100,
        scale: 100,
        x: 0,
        y: 0,
        rotation: 0,
        volume: 100,
        effects: [],
        keyframes: [],
        // No intro transition on the very first clip.
        transitionIn: index > 0 && transitionType !== 'none' && transitionSec > 0
          ? { type: transitionType, duration: ticksFromSec(transitionSec) }
          : undefined
      })

      if (onScreenText) {
        textItems.push({
          id: `clip_${job.jobId}:t`,
          name: 'Caption',
          text: onScreenText,
          color: captionStyle.color,
          fontSize: captionStyle.fontSize,
          in: 0,
          out: durationTicks,
          offset,
          speed: 1,
          opacity: 100,
          scale: 100,
          x: 0,
          y: captionY(captionStyle.position, canvas.height),
          rotation: 0,
          effects: [],
          keyframes: [],
          animIn: captionStyle.animation === 'fade' ? 'fade' : 'none',
          animInDuration: Math.min(0.5, Math.max(0.1, durationSec / 2))
        })
      }

      plan.scenes.push({
        sceneIndex: index,
        jobId: job.jobId,
        clipId,
        role: sceneRole,
        startSec: offset / TICKS_PER_SECOND,
        durationSec,
        simulated: !!source.simulated
      })
    })

    plan.simulated = simulated
    plan.timeline = {
      // Track order mirrors a default project (text, video, audio) so the
      // timeline UI and the exporter see the same structure as a hand-made one.
      tracks: [
        { id: 't-text-1', type: 'text', name: 'Text', items: textItems },
        { id: 't-video-1', type: 'video', name: 'Video 1', items: videoItems },
        { id: 't-audio-1', type: 'audio', name: 'Audio 1', items: [] }
      ],
      durationMs: Math.round((cursor / TICKS_PER_SECOND) * 1000),
      clipCount: videoItems.length,
      captionCount: textItems.length
    }

    // P7: add music/SFX from Asset Center catalog when the profile allows it
    const audioTrack = plan.timeline.tracks[2]!
    if (audioTrack && profile?.musicPolicy && profile.musicPolicy.source !== 'none' && input.assetCatalog?.length) {
      const readyAssets = getAssemblyReadyAssets(input.assetCatalog)
      const musicAssets = readyAssets.filter(e => e.category === 'music')
      const sfxAssets = readyAssets.filter(e => e.category === 'sound-effects')
      const policy = profile.musicPolicy

      if (musicAssets.length > 0) {
        const asset = musicAssets[0]!
        const src = asset.source?.type === 'remote' ? asset.source.url : (asset as { sourceUrl?: string }).sourceUrl
        if (src) {
          audioTrack.items.push({
            id: `music-${asset.id}`,
            name: `Music: ${asset.title}`,
            src,
            in: 0,
            out: cursor,
            offset: 0,
            speed: 1,
            opacity: 100,
            scale: 100,
            x: 0,
            y: 0,
            rotation: 0,
            volume: policy.volumeLevel ?? 30,
            effects: [],
            keyframes: []
          })
        }
      }

      if (sfxAssets.length > 0) {
        const asset = sfxAssets[0]!
        const src = asset.source?.type === 'remote' ? asset.source.url : (asset as { sourceUrl?: string }).sourceUrl
        if (src) {
          const sfxDuration = Math.min(ticksFromSec(5), cursor)
          audioTrack.items.push({
            id: `sfx-${asset.id}`,
            name: `SFX: ${asset.title}`,
            src,
            in: 0,
            out: sfxDuration,
            offset: 0,
            speed: 1,
            opacity: 100,
            scale: 100,
            x: 0,
            y: 0,
            rotation: 0,
            volume: 80,
            effects: [],
            keyframes: []
          })
        }
      }

      if (audioTrack.items.length > 0) {
        plan.timeline.clipCount += audioTrack.items.length
      }
    }

    return plan
  })

  const ready = items.filter(item => item.ok)
  return {
    ok: items.length > 0,
    error: items.length === 0
      ? { code: 'no-items', message: 'The batch has no rows to assemble' }
      : undefined,
    plan: {
      batchId: batch.batchId,
      templateId: template.templateId,
      templateVersion: template.version,
      items,
      readyCount: ready.length,
      blockedCount: items.length - ready.length,
      clipCount: ready.reduce((sum, item) => sum + (item.timeline?.clipCount || 0), 0),
      simulatedCount: ready.filter(item => item.simulated).length,
      narrationUnvoiced: items.reduce((sum, item) => sum + (item.narrationUnvoiced || 0), 0)
    }
  }
}
