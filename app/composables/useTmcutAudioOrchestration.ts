import { ref, computed } from 'vue'
import {
  TICKS_PER_SECOND,
  planMusicBed,
  planSfxCues,
  mergeAudioProvenance,
  validateEditPlan,
  applyEditPlan,
  ticksTracksToV3,
  syncTicksResult
} from '@tmcut-core'
import type { AiEditPlan } from '@tmcut-core'
import { useTmcutProject } from './useTmcutProject'
import { useTmcutMedia } from './useTmcutMedia'
import { useTmcutAssetCenter } from './useTmcutAssetCenter'

// =============================================================================
//  Audio orchestration driver (roadmap v3 Phase 8 §24).
//
//  Gathers the RIGHTS-CLEARED audio candidate pool (user library files =
//  user-owned; Asset Center installs = registry license metadata), asks the
//  core planners for a music bed + SFX cues, applies the result as ONE
//  Edit Plan through the shared validateEditPlan/applyEditPlan path (one
//  Ctrl+Z), and persists the provenance record the acceptance criterion
//  demands: every audio element ends with a source record, a timeline
//  range and its rights metadata.
// =============================================================================

export interface AudioCandidate {
  mediaRef: string
  name: string
  source: string
  origin: 'library' | 'asset-center'
  licenseStatus: 'approved' | 'review' | 'blocked' | 'unknown'
  licenseName: string
  attribution: string
  durationTicks?: number
  addedAt?: number
}

export interface AudioOrchestrationResult {
  plan: AiEditPlan
  applied: number
  skippedOps: number
  skippedCues: Array<{ atTicks: number, name: string, reason: string }>
  provenance: Array<Record<string, unknown>>
}

const AUDIO_EXTS = /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i

// Provenance registry: projectId -> records[]. Deliberately separate from
// the project file (§24 "queryable record", survives project saves).
const PROVENANCE_KEY = 'tmcut.audio.provenance.v1'

function readProvenanceRegistry(): Record<string, Array<Record<string, unknown>>> {
  try {
    const raw = localStorage.getItem(PROVENANCE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeProvenanceRegistry(registry: Record<string, Array<Record<string, unknown>>>) {
  try {
    localStorage.setItem(PROVENANCE_KEY, JSON.stringify(registry))
  } catch {
    // Storage full/denied: provenance stays in memory for the session.
  }
}

export function useTmcutAudioOrchestration() {
  const project = useTmcutProject()
  const media = useTmcutMedia()
  const assetCenter = useTmcutAssetCenter()

  const orchestrating = ref(false)
  const lastResult = ref<AudioOrchestrationResult | null>(null)
  const lastError = ref<string | null>(null)

  /**
   * Rights-cleared candidate pool. Library audio = the user's own files
   * (approved — the app does not second-guess the owner). Asset Center
   * installs carry their registry license status; `unknown`/`blocked`
   * entries are dropped by the core ranking, so nothing unlicensed can
   * reach a plan.
   */
  function candidatePool(): AudioCandidate[] {
    const pool: AudioCandidate[] = []
    for (const asset of media.assets.value) {
      if (asset.kind !== 'audio') continue
      if (asset.status === 'missing' || asset.status === 'error') continue
      if (!/^[\w.-]+$/.test(asset.id)) continue
      pool.push({
        mediaRef: asset.id,
        name: asset.name,
        source: asset.path,
        origin: 'library',
        licenseStatus: 'approved',
        licenseName: 'User-owned',
        attribution: '',
        durationTicks: Math.round((asset.meta?.durationSec || 0) * TICKS_PER_SECOND),
        addedAt: Date.parse(asset.addedAt || '') || 0
      })
    }
    for (const record of assetCenter.installed.value) {
      if (record.state !== 'installed') continue
      const entry = assetCenter.catalogEntries.value.find(e => e.id === record.entryId)
      if (!entry || entry.assetKind !== 'media') continue
      const path = assetCenter.installedFilePath(record.entryId)
      if (!path || !AUDIO_EXTS.test(path)) continue
      if (!/^[\w.-]+$/.test(`ac-${record.entryId}`)) continue
      pool.push({
        mediaRef: `ac-${record.entryId}`,
        name: entry.title || record.entryId,
        source: path,
        origin: 'asset-center',
        licenseStatus: (entry.license?.status as AudioCandidate['licenseStatus']) || 'unknown',
        licenseName: entry.license?.name || '',
        attribution: entry.license?.attribution || '',
        addedAt: Date.parse(record.installedAt || '') || 0
      })
    }
    return pool
  }

  /** Clip starts whose clip carries a transition-in (SFX cue points). */
  function transitionCues(): Array<{ atTicks: number, name: string }> {
    const cues: Array<{ atTicks: number, name: string }> = []
    const tracks = project.currentProject.value?.timeline?.tracks ?? []
    for (const track of tracks) {
      if (track.type !== 'video') continue
      for (const item of track.items) {
        if (!item.transitionIn?.type) continue
        const at = Math.round(Number(item.offset) || 0)
        if (at > 0) cues.push({ atTicks: at, name: item.transitionIn.type })
      }
    }
    return cues.sort((a, b) => a.atTicks - b.atTicks)
  }

  /** Provenance records stored for the current project. */
  const provenance = computed(() => {
    const id = project.currentProject.value?.id
    if (!id) return []
    return readProvenanceRegistry()[id] ?? []
  })

  /**
   * Plan and apply music (+ optional SFX cues) as ONE Edit Plan on the
   * current timeline. Returns null with `lastError` set on any rejection;
   * returns applied=0 when no rights-cleared candidate exists (silent
   * degradation is a valid outcome — the UI says why).
   */
  function orchestrate(options: {
    music?: boolean
    sfx?: boolean
    dialoguePresent?: boolean
    bedVolume?: number
  } = {}): AudioOrchestrationResult | null {
    lastError.value = null
    lastResult.value = null
    const tracks = project.currentProject.value?.timeline?.tracks
    if (!tracks) {
      lastError.value = 'no-active-project'
      return null
    }
    const durationTicks = Math.round((project.totalDuration.value || 0) * TICKS_PER_SECOND)
    if (durationTicks <= 0) {
      lastError.value = 'empty-timeline'
      return null
    }
    orchestrating.value = true
    try {
      const pool = candidatePool()
      const resolution: Record<string, { src: string, name?: string }> = {}
      for (const c of pool) resolution[c.mediaRef] = { src: c.source, name: c.name }

      const operations = []
      let provenanceRecords: Array<Record<string, unknown>> = []
      let skippedCues: AudioOrchestrationResult['skippedCues'] = []

      if (options.music !== false) {
        const bed = planMusicBed(pool, { durationTicks, dialoguePresent: options.dialoguePresent }, { bedVolume: options.bedVolume })
        operations.push(...bed.operations)
        provenanceRecords = provenanceRecords.concat(bed.provenance)
      }
      if (options.sfx) {
        const cues = transitionCues()
        const sfx = planSfxCues(pool.filter(c => /sfx|whoosh|impact|stinger/i.test(`${c.name} ${c.licenseName}`) || c.origin === 'asset-center'), cues, { durationTicks })
        operations.push(...sfx.operations)
        provenanceRecords = provenanceRecords.concat(sfx.provenance)
        skippedCues = sfx.skipped
      }

      if (operations.length === 0) {
        lastResult.value = {
          plan: { schemaVersion: 1, intentSummary: 'no audio candidate', assumptions: [], operations: [] },
          applied: 0,
          skippedOps: 0,
          skippedCues,
          provenance: []
        }
        return lastResult.value
      }

      const plan: AiEditPlan = {
        schemaVersion: 1,
        intentSummary: `Audio orchestration: ${options.music !== false ? 'music bed' : ''}${options.sfx ? (options.music !== false ? ' + ' : '') + 'SFX cues' : ''}`,
        assumptions: ['deterministic rights-aware planner, not a language model'],
        operations
      }
      const check = validateEditPlan(plan, { mediaRefs: pool.map(c => c.mediaRef) })
      if (!check.valid) {
        lastError.value = check.errors.join('; ')
        return null
      }

      project.pushHistory()
      // Mutatron pattern (same as the AI Editor): the store keeps flat
      // tick tracks, so the shared plan is applied to a v3 VIEW and merged
      // back — Core commands add the clips, the store's history/persistence
      // stay the single source of truth.
      const v3 = ticksTracksToV3(tracks)
      const trace = applyEditPlan(v3, plan, { mediaResolution: resolution })
      syncTicksResult(tracks, v3)
      project.saveProject()

      const id = project.currentProject.value?.id
      if (id && provenanceRecords.length > 0) {
        const registry = readProvenanceRegistry()
        registry[id] = mergeAudioProvenance(registry[id], provenanceRecords)
        writeProvenanceRegistry(registry)
      }
      const skippedOps = trace.applied.filter(s => !s.ok).length + trace.skipped.length
      lastResult.value = {
        plan,
        applied: trace.applied.filter(s => s.ok).length,
        skippedOps,
        skippedCues,
        provenance: provenanceRecords
      }
      return lastResult.value
    } catch (err) {
      lastError.value = (err as Error)?.message || 'audio-orchestration-failed'
      return null
    } finally {
      orchestrating.value = false
    }
  }

  return {
    orchestrating,
    lastResult,
    lastError,
    provenance,
    candidatePool,
    transitionCues,
    orchestrate
  }
}
