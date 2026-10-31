import type { TmcutCanvas, TmcutCropRect, TmcutFitMode, FrameRate } from '~/types/tmcut'
import { findCanvasPreset, normalizeCanvas, reframeTransform, canvasFpsValue } from '~/utils/tmcut/canvas'
import { clipDurationSec, clipStartSec, clipEndSec, clipStartTicks, clipEndTicks } from '~/utils/tmcut/clipTime'
import { decideRecovery } from '~/utils/tmcut/recovery'
import { readStored, removeStored } from '~/utils/tmcut/localStore'
import {
  checkpointRecovery,
  addTrack,
  removeTrack,
  copyClips,
  pasteClips,
  duplicateClips,
  rippleDelete,
  snapTime,
  secToTicks,
  ticksToSec,
  ticksTracksToV3,
  syncTicksResult,
  ticksClipToV3,
  expandRelated,
  addMarker,
  removeMarker,
  trimClip,
  groupClips,
  ungroupClips,
  insertClipRipple,
  closeGaps,
  TICKS_PER_SECOND,
  canApplyTransition,
  applyTransition,
  clearTransition
} from '@tmcut-core'
import type { CoreClipboard, TmcutTimeline, TmcutTextAnimationType, TmcutStabilizeLevel, TmcutStabilizeStatus } from '@tmcut-core'

// Type definitions for TMCut project
/** R116: FFmpeg `blend` mode for compositing a clip over the track
 *  below it (normal = the classic overlay, no blend filter). */
export type TmcutBlendMode = 'normal' | 'screen' | 'overlay' | 'multiply'

export interface TmcutTimelineItem {
  id: string
  name?: string
  src?: string
  text?: string
  color?: string
  fontSize?: number
  /** Font family (roadmap C-1): CSS name rendered by the preview overlay;
      fontFile is the SAME face's file so drawtext fontfile= exports it. */
  fontFamily?: string
  fontFile?: string
  /** Text style (roadmap C-2): bold/italic pick the matching face file
      (export draws the real glyphs — drawtext has no faux bold); align
      anchors the block (default = centered, legacy export behavior). */
  bold?: boolean
  italic?: boolean
  align?: 'left' | 'center' | 'right'
  shadow?: boolean
  stroke?: boolean
  /** Text effect colours + background plate (roadmap đợt 2). Undefined keeps
      the legacy black shadow/outline and no plate, so an untouched project
      exports the byte-identical drawtext filter. */
  shadowColor?: string
  strokeColor?: string
  bgColor?: string
  /** Text animation in (intro) and out (outro) (Roadmap C-5). */
  animIn?: TmcutTextAnimationType
  animInDuration?: number
  animOut?: TmcutTextAnimationType
  animOutDuration?: number
  /** Video stabilization (roadmap E-5). */
  stabilize?: boolean
  stabilizeLevel?: TmcutStabilizeLevel
  stabilizedPath?: string | null
  stabilizeStatus?: TmcutStabilizeStatus
  /** C16-R3: source in/out and timeline offset are INTEGER TICKS
   *  (TICKS_PER_SECOND = 120000, @tmcut-core time.mjs). Read them through
   *  ~/utils/tmcut/clipTime accessors — never assume the unit elsewhere.
   *  speed stays a multiplier; fade/keyframes/transitionIn were already
   *  ticks. */
  in: number
  out: number
  offset: number
  speed: number
  reverse?: boolean
  /** Speed ramp (R124 A4, CapCut §5.4): piecewise-linear speed curve —
   *  { t: clip-local TICKS, speed: multiplier }. Core retime.mjs owns the
   *  math (integral + setpts expr); presets keep the curve's MEAN equal to
   *  `speed` so the timeline length survives. Absent/<2 points = constant. */
  speedPoints?: Array<{ t: number, speed: number }> | null
  /** Group editing: clips sharing a groupId move/select together (core Phase 2). */
  groupId?: string | null
  /** Linked pair (e.g. video + its audio): select/move together. */
  linkId?: string | null
  opacity: number
  scale: number
  x: number
  y: number
  rotation: number
  /** R116: composite blend mode for video clips (FFmpeg `blend`
      filter on the overlay chain). 'normal' (default) = no filter. */
  blend?: TmcutBlendMode
  volume?: number
  fit?: TmcutFitMode
  focusX?: number
  focusY?: number
  cropRect?: TmcutCropRect
  effects?: Array<{ type: string, params: Record<string, unknown> }>
  /** Keyframes: animated prop values (t in ticks; easing drives the
      segment to the NEXT keyframe). Export renders them: the render
      builders feed keyframeExpr() into scale/x/y/opacity/volume
      (video.ts, text.ts, audio.ts) on the desktop FFmpeg path. */
  keyframes?: Array<{ t: number, prop: string, value: number, easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'step' }>
  /** Clip mask (R124 A3, CapCut §5.7): shape + normalized box + feather/
   *  rotation/invert. Geometry math (and the FFmpeg/CSS builders) live in
   *  @tmcut-core mask.mjs — this only stores the parameters. Absent = no
   *  mask, byte-identical export and preview. */
  mask?: {
    shape: 'rectangle' | 'circle' | 'linear'
    x: number
    y: number
    w: number
    h: number
    feather: number
    rotation: number
    invert: boolean
    axis: 'x' | 'y'
  } | null
  transitionIn?: { type: string, duration: number }
  /** Fade in/out audio envelope (t in TICKS; core C12). */
  fade?: { in: number, out: number }
}

export interface TmcutTrack {
  id: string
  type: 'video' | 'text' | 'audio'
  name?: string
  muted?: boolean
  locked?: boolean
  hidden?: boolean
  /** R124 A1: track-level audio (CapCut §5.3). `volume` 0..100 is a global
   *  gain on the row (100 = no change); `pan` -100..100 shifts the stereo
   *  field (0 = dead centre). Both default to neutral when absent. */
  volume?: number
  pan?: number
  items: TmcutTimelineItem[]
}

/** Ruler marker (roadmap B5) — structurally identical to the core type. */
export interface TmcutMarker {
  id: string
  /** Timeline position in ticks (TICKS_PER_SECOND). */
  at: number
  label?: string
  color?: string
}

export interface TmcutProjectTimeline {
  version: number
  tracks: TmcutTrack[]
  durationMs: number
  /** Ruler markers — read/written in place by the core marker ops. */
  markers?: TmcutMarker[]
}

/**
 * Project-file schema version (C16). Files written before C16-R1 stored
 * fps as a bare number; from C16-R1 on, fps is the DSL v3 rational
 * FrameRate. C16-R3 (schema 3) flips clip time geometry (in/out/offset)
 * from float SECONDS to integer TICKS — `applyProjectMigration` scales
 * such a file's items exactly once at open (never a magnitude guess: the
 * version stamp is the only unit oracle, R82 lesson), then stamps it —
 * so the migration is one-time per file, matching Roadmap C16 ("v1compat
 * chỉ còn cho file project cũ — migrate 1 lần khi mở").
 */
export const TMCUT_PROJECT_SCHEMA_VERSION = 3

export interface TmcutProject {
  id: string
  name: string
  cover: string
  durationMs: number
  canvas: TmcutCanvas
  timeline: TmcutProjectTimeline
  settings: {
    resolution: string
    fps: FrameRate
    format: string
    bitrate: number
  }
  source: 'manual' | 'autocut' | 'template'
  created_at: string
  updated_at: string
  /** Last time the project was opened (roadmap J-2): drives the
   *  "Recently opened" sort. Never bumped by saveProject, so it stays
   *  independent from updated_at ("Recently edited"). */
  lastOpenedAt?: string
  /** Pinned to the top of the home grid (roadmap J-2) — stored in the
   *  project file itself, no separate index. */
  pinned?: boolean
  /** Project-file schema version (see TM CUT_PROJECT_SCHEMA_VERSION). */
  schemaVersion?: number
  /**
   * R132 — monotonic mutation counter (docs §196). Every save bumps it by
   * one; loadProject reports the on-disk value. It is the ONLY honest
   * answer to "was this project edited while I had it open" — the
   * alternative (comparing updated_at strings, or diffing the whole
   * object) is either ambiguous or O(n). Future automation/MCP writers
   * will read it before persisting, so a stale write can refuse instead
   * of silently overwriting another writer's edit. It is NOT a lock: the
   * app is still the single writer, and the counter is advisory.
   */
  revision?: number
}

// Global project state
const currentProject = ref<TmcutProject | null>(null)
const projects = ref<TmcutProject[]>([])
const isLoading = ref(false)
const selectedClipId = ref<string | null>(null)
const isCropEditing = ref(false)
const saveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const lastSavedAt = ref<string | null>(null)
const pendingRecovery = ref<{ id: string, updatedAt: string } | null>(null)
/**
 * R132 — the project revision captured by the LAST loadProject for the
 * currently open project. Exposed read-only: the editor (and future
 * automation writers) can compare it against currentProject.revision to
 * detect "this file was written outside this session while I held it".
 * null until the first load completes.
 */
const revisionAtLoad = ref<number | null>(null)
const snapshots = ref<Array<{ ts: number, name: string, updatedAt: string }>>([])

function toggleCropEditing(active?: boolean) {
  isCropEditing.value = typeof active === 'boolean' ? active : !isCropEditing.value
}

function tmcutIpc() {
  return typeof window !== 'undefined' ? window.electronAPI?.tmcut : undefined
}

function normalizePath(input: string): string {
  return String(input || '').trim().replace(/\\/g, '/')
}

// Compute selected clip with track reference
const selectedClip = computed(() => {
  if (!selectedClipId.value || !currentProject.value?.timeline?.tracks) return null
  for (const track of currentProject.value.timeline.tracks) {
    const item = track.items?.find(i => i.id === selectedClipId.value)
    if (item) {
      return { track: track.type, item }
    }
  }
  return null
})

// End of the actual content in seconds — what the project really is. This is
// what plays, saves as the project duration and exports; the ruler below it
// may be longer, but nothing else should treat the padding as media.
const contentDuration = computed(() => {
  if (!currentProject.value?.timeline?.tracks) return 0
  let maxSec = 0
  for (const track of currentProject.value.timeline.tracks) {
    for (const item of track.items || []) {
      const endSec = clipStartSec(item) + Math.max(0, clipDurationSec(item))
      if (endSec > maxSec) {
        maxSec = endSec
      }
    }
  }
  return maxSec
})

// Timeline extent in seconds, used for ruler drawing and playhead parking.
// Keeps a 5-second floor so a short project still fills the ruler.
const totalDuration = computed(() => {
  if (!currentProject.value?.timeline?.tracks) return 0
  return Math.max(contentDuration.value, 5)
})

// True when at least one clip exists on any timeline track.
// Used to disable preview transport controls when the timeline is empty
// (playhead animation and seeking are meaningless without media).
const hasTimelineClips = computed(() => {
  if (!currentProject.value?.timeline?.tracks) return false
  return currentProject.value.timeline.tracks.some(t => (t.items?.length || 0) > 0)
})

function buildDefaultProject(projectId: string, name = 'Untitled Project'): TmcutProject {
  return {
    id: projectId,
    name,
    cover: '',
    durationMs: 0,
    canvas: normalizeCanvas({ width: 1920, height: 1080, fps: { numerator: 30, denominator: 1 } }),
    timeline: {
      version: 1,
      tracks: [
        { id: 't-text-1', type: 'text', name: 'Text', items: [] },
        { id: 't-video-1', type: 'video', name: 'Video 1', items: [] },
        { id: 't-audio-1', type: 'audio', name: 'Audio 1', items: [] }
      ],
      durationMs: 0,
      markers: []
    },
    settings: {
      resolution: '1920x1080',
      fps: { numerator: 30, denominator: 1 },
      format: 'mp4',
      bitrate: 5000
    },
    source: 'manual',
    schemaVersion: TMCUT_PROJECT_SCHEMA_VERSION,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
}

// Backward-compat migration for pre-v2 projects (legacy canvas + missing
// tracks). C16: schemaVersion marks files that have passed through this
// gate once at open — the ONLY place legacy v1-shaped data (bare-number
// fps) is still accepted, matching Roadmap C16 ("v1compat chỉ còn cho
// file project cũ — migrate 1 lần khi mở"). Coercion itself runs
// whenever the stored shape is legacy so the FrameRate type invariant
// (canvas.fps / settings.fps are always rational) holds on every path.
function applyProjectMigration(project: TmcutProject) {
  const isLegacy = (project.schemaVersion ?? 1) < TMCUT_PROJECT_SCHEMA_VERSION
  project.canvas = normalizeCanvas(project.canvas)
  if (!project.settings?.fps || typeof project.settings.fps !== 'object') {
    const legacyFps = typeof project.settings?.fps === 'number' && project.settings.fps > 0
      ? project.settings.fps
      : canvasFpsValue(project.canvas)
    project.settings = {
      resolution: project.settings?.resolution || '1920x1080',
      fps: { numerator: legacyFps, denominator: 1 },
      format: project.settings?.format || 'mp4',
      bitrate: project.settings?.bitrate ?? 5000
    }
  }
  ensureDefaultTracks(project)
  // Pre-B5 projects were saved without a markers array (core addMarker
  // throws on a missing array), so backfill it during migration.
  if (!Array.isArray(project.timeline.markers)) {
    project.timeline.markers = []
  }
  // C16-R3: files stamped before schema 3 stored in/out/offset as float
  // SECONDS. Scale them to ticks ONCE, driven purely by the version stamp
  // (the R82 lesson: never a magnitude heuristic — an old file with a
  // 0.4s fade still reads as seconds here because the STAMP says so).
  if (isLegacy) {
    for (const track of project.timeline.tracks || []) {
      for (const item of track.items || []) {
        item.in = Math.round(secToTicks(Number(item.in) || 0))
        item.out = Math.round(secToTicks(Number(item.out) || 0))
        item.offset = Math.round(secToTicks(Number(item.offset) || 0))
      }
    }
    project.schemaVersion = TMCUT_PROJECT_SCHEMA_VERSION
  }
}

function ensureDefaultTracks(project: TmcutProject) {
  if (!project.timeline) {
    project.timeline = { version: 1, tracks: [], durationMs: 0, markers: [] }
  }
  if (!project.timeline.tracks) {
    project.timeline.tracks = []
  }
  if (!Array.isArray(project.timeline.markers)) {
    project.timeline.markers = []
  }
  const hasText = project.timeline.tracks.some(t => t.type === 'text')
  const hasVideo = project.timeline.tracks.some(t => t.type === 'video')
  const hasAudio = project.timeline.tracks.some(t => t.type === 'audio')

  if (!hasText) {
    project.timeline.tracks.unshift({ id: 't-text-1', type: 'text', name: 'Text', items: [] })
  }
  if (!hasVideo) {
    project.timeline.tracks.push({ id: 't-video-1', type: 'video', name: 'Video 1', items: [] })
  }
  if (!hasAudio) {
    project.timeline.tracks.push({ id: 't-audio-1', type: 'audio', name: 'Audio 1', items: [] })
  }
}

async function persistProjectToDisk() {
  const project = currentProject.value
  const ipc = tmcutIpc()
  if (!project || !ipc || import.meta.server) return
  saveStatus.value = 'saving'
  try {
    // Convert Vue reactive project to plain object for IPC serialization
    // JSON.parse/stringify handles the reactive proxies properly
    const plainProject = JSON.parse(JSON.stringify(project)) as TmcutProject
    plainProject.updated_at = new Date().toISOString()
    await ipc.writeProject({ id: plainProject.id, data: plainProject })
    await ipc.writeRecovery({ id: plainProject.id, data: plainProject })
    saveStatus.value = 'saved'
    lastSavedAt.value = plainProject.updated_at
  } catch (error) {
    console.error('Failed to persist project to disk:', error)
    saveStatus.value = 'error'
  }
}

// Helper: convert Vue reactive project to plain object for IPC serialization
// (removed - using inline JSON.parse/stringify instead)

let diskSaveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleDiskSave(delayMs = 2000) {
  if (diskSaveTimer) clearTimeout(diskSaveTimer)
  diskSaveTimer = setTimeout(() => {
    diskSaveTimer = null
    void persistProjectToDisk()
  }, delayMs)
}

function flushDiskSave() {
  if (diskSaveTimer) {
    clearTimeout(diskSaveTimer)
    diskSaveTimer = null
  }
  void persistProjectToDisk()
}

// Load project by ID
async function loadProject(projectId: string) {
  // Persist any pending edit of the OUTGOING project first: dropping the
  // timer silently would lose it, and a late fire would write the NEW
  // project's state into the OLD files — R95.
  flushDiskSave()
  isLoading.value = true
  selectedClipId.value = null
  pendingRecovery.value = null
  // New project, fresh history (R94): the stacks belong to the project
  // they were built on.
  resetHistory()

  // R132: remember the revision the file was at when we opened it. The
  // editor never bumps it (saveProject does), so anything larger than
  // this means another process wrote to the file while we had it open —
  // the honest signal for a "your edits may be stale" prompt.
  revisionAtLoad.value = null

  const ipc = tmcutIpc()
  if (ipc && !import.meta.server) {
    try {
      const disk = (await ipc.readProject(projectId)) as TmcutProject | null
      if (disk && disk.id && Array.isArray(disk.timeline?.tracks)) {
        currentProject.value = disk
        revisionAtLoad.value = typeof disk.revision === 'number' ? disk.revision : 0
        applyProjectMigration(disk)
        syncProjectIndex(disk)
        await detectRecovery(projectId)
        // Open-time is metadata: recorded AFTER recovery detection so a
        // fresh project write can never mask a pending recovery file
        // (roadmap J-2).
        await persistProjectMetadata(disk.id, { lastOpenedAt: new Date().toISOString() })
        isLoading.value = false
        return
      }
    } catch (error) {
      console.error('Failed to read project from disk:', error)
    }
  }

  if (!import.meta.server) {
    const stored = readStored(`tmcut_project_${projectId}`)
    if (stored) {
      try {
        const local = JSON.parse(stored) as TmcutProject
        currentProject.value = local
        revisionAtLoad.value = typeof local.revision === 'number' ? local.revision : 0
        applyProjectMigration(local)
        syncProjectIndex(local)
        // R105: the disk file can be missing while a recovery file is not
        // (crash before the first save). Without this call the 'force'
        // verdict never ran and the orphaned recovery stayed invisible.
        await detectRecovery(local.id)
        await persistProjectMetadata(local.id, { lastOpenedAt: new Date().toISOString() })
        isLoading.value = false
        return
      } catch (error) {
        console.error('Failed to parse project from localStorage:', error)
      }
    }
  }

  const newProj = buildDefaultProject(projectId)
  currentProject.value = newProj
  revisionAtLoad.value = 0
  await detectRecovery(projectId) // R105: same orphan case
  isLoading.value = false
}

function syncProjectIndex(project: TmcutProject) {
  const idx = projects.value.findIndex(p => p.id === project.id)
  if (idx !== -1) {
    projects.value[idx] = { ...project }
  } else {
    projects.value.unshift(project)
  }
}

async function detectRecovery(projectId: string) {
  const ipc = tmcutIpc()
  if (!ipc || !currentProject.value) return
  try {
    const meta = await ipc.readProjectMeta(projectId)
    const decision = decideRecovery({
      hasRecovery: meta.hasRecovery,
      recoveryUpdatedAtMs: meta.recoveryUpdatedAtMs,
      hasProject: meta.hasProject,
      projectMtimeMs: meta.projectMtimeMs
    })
    if (decision === 'none') return
    const recovery = (await ipc.readRecovery(projectId)) as TmcutProject | null
    if (!recovery?.id) return
    const updatedAt = recovery.updated_at || new Date(meta.recoveryUpdatedAtMs ?? Date.now()).toISOString()
    if (decision === 'force') {
      currentProject.value = recovery
      applyProjectMigration(recovery)
      syncProjectIndex(recovery)
      scheduleDiskSave(0)
    }
    pendingRecovery.value = { id: projectId, updatedAt }
  } catch (error) {
    console.error('Recovery detection failed:', error)
  }
}

async function applyRecovery() {
  const info = pendingRecovery.value
  const ipc = tmcutIpc()
  if (!info || !ipc) return
  try {
    const recovery = (await ipc.readRecovery(info.id)) as TmcutProject | null
    if (!recovery?.id) {
      pendingRecovery.value = null
      return
    }
    currentProject.value = recovery
    applyProjectMigration(recovery)
    syncProjectIndex(recovery)
    pendingRecovery.value = null
    flushDiskSave()
  } catch (error) {
    console.error('Failed to apply recovery:', error)
  }
}

async function dismissRecovery() {
  const info = pendingRecovery.value
  const ipc = tmcutIpc()
  if (info && ipc) {
    try {
      await ipc.deleteRecovery(info.id)
    } catch (error) {
      console.error('Failed to delete recovery file:', error)
    }
  }
  pendingRecovery.value = null
}

async function refreshProjects() {
  const ipc = tmcutIpc()
  if (!ipc || import.meta.server) return
  try {
    const files = await ipc.listProjectFiles()
    for (const file of files) {
      const existing = projects.value.find(p => p.id === file.id)
      if (existing && currentProject.value?.id === file.id) continue
      if (existing) {
        if (file.updatedAt && file.updatedAt > existing.updated_at && currentProject.value?.id !== file.id) {
          const data = (await ipc.readProject(file.id)) as TmcutProject | null
          if (data?.id) {
            projects.value[projects.value.indexOf(existing)] = data
          }
        }
        continue
      }
      const data = (await ipc.readProject(file.id)) as TmcutProject | null
      if (data?.id) {
        projects.value.unshift(data)
      }
    }
  } catch (error) {
    console.error('Failed to refresh project index from disk:', error)
  }
}

// Save project (localStorage mirror + scheduled disk write)
function saveProject(options?: { revision?: number }) {
  if (!currentProject.value || import.meta.server) return

  currentProject.value.updated_at = new Date().toISOString()
  currentProject.value.durationMs = Math.round(contentDuration.value * 1000)
  // R132: the mutation counter is the single source of truth for "did
  // anything change since I opened this". Bumped on every save, never on
  // open (lastOpenedAt is independent of it, see the field comment).
  const nextRevision = options?.revision ?? (currentProject.value.revision ?? 0)
  currentProject.value.revision = (typeof nextRevision === 'number' ? Math.max(0, nextRevision) : 0) + 1
  // When creating a fresh project we already set revision to 0; we must not
  // bump it on the first save — the first save is the creation baseline.
  if (options?.revision === 0) currentProject.value.revision = 0

  const idx = projects.value.findIndex(p => p.id === currentProject.value!.id)
  if (idx !== -1) {
    projects.value[idx] = { ...currentProject.value }
  }

  try {
    localStorage.setItem(`tmcut_project_${currentProject.value.id}`, JSON.stringify(currentProject.value))
  } catch (e) {
    console.error('Failed to save project:', e)
  }

  // Phase 10 crash recovery: refresh the checkpoint AFTER a successful
  // persist. The recovery UI only offers "recover" when the checkpoint
  // says unsavedChanges, so a clean save must clear that flag.
  try {
    checkpointRecovery({
      projectId: currentProject.value.id,
      projectName: currentProject.value.name,
      canvas: {
        width: currentProject.value.canvas?.width || 0,
        height: currentProject.value.canvas?.height || 0,
        fps: canvasFpsValue(currentProject.value.canvas)
      },
      timelineDurationMs: currentProject.value.durationMs || 0,
      trackCount: currentProject.value.timeline?.tracks?.length || 0,
      clipCount: currentProject.value.timeline?.tracks?.reduce((n: number, tr: { items?: unknown[] }) => n + (tr.items?.length || 0), 0) || 0,
      unsavedChanges: false
    })
  } catch {
    // diagnostics must never break a save
  }

  scheduleDiskSave()
}

// Create new project
function createProject(
  name: string = 'Untitled Project',
  canvas?: { width?: number, height?: number, fps?: FrameRate }
): TmcutProject {
  const newProject = buildDefaultProject(Math.random().toString(36).slice(2, 10), name)
  // Optional canvas at creation, BEFORE the first save: callers that
  // create-then-navigate (quick presets) used to patch the raw object
  // afterwards, which the editor's loadProject() raced against the
  // storage mirror and lost (default canvas everywhere).
  if (canvas) {
    newProject.canvas = normalizeCanvas({ ...newProject.canvas, ...canvas })
  }

  flushDiskSave() // outgoing project keeps its pending edit (R95)
  currentProject.value = newProject
  // Fresh project starts at revision 0 (the initial save) so the counter
  // is the honest answer to "has this project been changed since I opened
  // it". The very first save must not record as a "mutation" yet.
  newProject.revision = 0
  resetHistory() // openProject paths reset the stacks — see R94
  // The same rule covers the other per-project module state (R106): a
  // selection or a recovery prompt from the OUTGOING project must not
  // leak into the freshly created one.
  selectedClipId.value = null
  pendingRecovery.value = null
  revisionAtLoad.value = 0
  projects.value.unshift(newProject)
  currentProject.value.revision = 0
  saveProject({ revision: 0 })

  return newProject
}

// Rename a project from the dashboard. The project does not need to be
// the open one. Non-current renames mirror to localStorage (the web-survival
// rule of persistProjectMetadata, R102) and write straight to disk when
// IPC is available — before the fix a dashboard rename of a closed project
// vanished on reload in the web session.
async function renameProject(projectId: string, name: string) {
  const project = projects.value.find(p => p.id === projectId)
  const clean = String(name || '').trim()
  if (!project || !clean) return
  project.name = clean
  project.updated_at = new Date().toISOString()

  if (currentProject.value?.id === projectId) {
    currentProject.value.name = clean
    saveProject()
    return
  }

  try {
    localStorage.setItem(`tmcut_project_${projectId}`, JSON.stringify(project))
  } catch (error) {
    console.error('Failed to mirror renamed project:', error)
  }

  const ipc = tmcutIpc()
  if (ipc) {
    try {
      await ipc.writeProject({ id: projectId, data: JSON.parse(JSON.stringify(project)) })
    } catch (error) {
      console.error('Failed to rename project on disk:', error)
    }
  }
}

// Metadata-only project write (roadmap J-2): the pin flag and the open
// time must persist WITHOUT bumping updated_at — otherwise the honest
// "Recently edited" sort would silently absorb them. Mirrors to
// localStorage too so the web session (no IPC) survives a reload.
async function persistProjectMetadata(projectId: string, patch: Partial<TmcutProject>) {
  const project = projects.value.find(p => p.id === projectId)
  if (!project) return
  Object.assign(project, patch)
  let data = project
  if (currentProject.value?.id === projectId) {
    Object.assign(currentProject.value, patch)
    data = currentProject.value
  }
  try {
    localStorage.setItem(`tmcut_project_${projectId}`, JSON.stringify(data))
  } catch (error) {
    console.error('Failed to mirror project metadata:', error)
  }
  const ipc = tmcutIpc()
  if (ipc && !import.meta.server) {
    try {
      await ipc.writeProject({ id: projectId, data: JSON.parse(JSON.stringify(data)) })
    } catch (error) {
      console.error('Failed to persist project metadata:', error)
    }
  }
}

// Pin / unpin from the dashboard card menu (roadmap J-2): the flag lives
// in the project file itself. Returns the new state for honest feedback.
async function togglePinProject(projectId: string): Promise<boolean | null> {
  const project = projects.value.find(p => p.id === projectId)
  if (!project) return null
  const pinned = !project.pinned
  await persistProjectMetadata(projectId, { pinned })
  return pinned
}

// Duplicate a project from the dashboard (full deep copy with a new id).
// The copy suffix is passed in by the caller — module-scope composable
// code has no vue-i18n instance (useI18n only works inside setup).
function duplicateProject(projectId: string, copySuffix = 'copy'): TmcutProject | null {
  const source = projects.value.find(p => p.id === projectId)
  if (!source) return null
  const clone: TmcutProject = JSON.parse(JSON.stringify(source))
  clone.id = Math.random().toString(36).slice(2, 10)
  clone.name = `${source.name} (${copySuffix})`
  clone.created_at = new Date().toISOString()
  clone.updated_at = clone.created_at
  projects.value.unshift(clone)

  // Mirror the clone too (R102): without this the duplicate existed only
  // in memory + disk, so a web reload dropped it from the dashboard.
  try {
    localStorage.setItem(`tmcut_project_${clone.id}`, JSON.stringify(clone))
  } catch (error) {
    console.error('Failed to mirror duplicated project:', error)
  }

  const ipc = tmcutIpc()
  if (ipc) {
    try {
      void ipc.writeProject({ id: clone.id, data: JSON.parse(JSON.stringify(clone)) })
    } catch (error) {
      console.error('Failed to persist duplicated project:', error)
    }
  }
  return clone
}

// Delete project
async function deleteProject(projectId: string) {
  if (!import.meta.server) {
    removeStored(`tmcut_project_${projectId}`)
  }

  projects.value = projects.value.filter(p => p.id !== projectId)

  if (currentProject.value?.id === projectId) {
    // Neutralize any pending autosave for THIS id before deleting: a late
    // timer fire would resurrect the project files (R95). Pointing the
    // timer at the (null) current project makes it a no-op, and the
    // mirror is already gone.
    if (diskSaveTimer) {
      clearTimeout(diskSaveTimer)
      diskSaveTimer = null
    }
    currentProject.value = null
    selectedClipId.value = null
    pendingRecovery.value = null
    saveStatus.value = 'idle'
  }

  const ipc = tmcutIpc()
  if (ipc) {
    try {
      await ipc.deleteProject(projectId)
    } catch (error) {
      console.error('Failed to delete project files:', error)
    }
  }
}

function selectClip(clipId: string | null) {
  if (selectedClipId.value !== clipId) {
    isCropEditing.value = false
  }
  selectedClipId.value = clipId
}

// Add a clip to a track
function addClipToTrack(trackType: 'video' | 'text' | 'audio', partialItem: Partial<TmcutTimelineItem>, trackId?: string) {
  if (!currentProject.value) return null
  ensureDefaultTracks(currentProject.value)
  pushHistory()
  // Optional explicit target (timeline drop, Roadmap A4): only honored
  // when the id belongs to the matching track type, otherwise fall back
  // to the first track of the desired type (or create one below).
  let track = trackId
    ? currentProject.value.timeline.tracks.find(t => t.id === trackId && t.type === trackType)
    : undefined
  if (!track) {
    track = currentProject.value.timeline.tracks.find(t => t.type === trackType)
  }
  if (!track) {
    track = { id: `t-${trackType}-${Date.now()}`, type: trackType, name: trackType, items: [] }
    currentProject.value.timeline.tracks.push(track)
  }

  // C16-R3: partialItem geometry arrives in TICKS (callers convert at
  // their own boundary). Defaults: whole seconds expressed as ticks —
  // 5s media placeholder, 4s text block.
  const speed = partialItem.speed ?? 1
  const inPoint = partialItem.in ?? 0
  const outPoint = partialItem.out ?? (trackType === 'text' ? 4 : 5) * TICKS_PER_SECOND

  // Determine offset if not specified
  let offset = partialItem.offset
  if (offset === undefined) {
    offset = track.items.reduce((max, i) => Math.max(max, clipEndTicks(i)), 0)
  }

  const newItem: TmcutTimelineItem = {
    id: partialItem.id || `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: partialItem.name || 'Clip',
    src: partialItem.src,
    text: partialItem.text,
    color: partialItem.color || '#ffffff',
    fontSize: partialItem.fontSize || 36,
    in: inPoint,
    out: outPoint,
    offset,
    speed,
    reverse: partialItem.reverse ?? false,
    opacity: partialItem.opacity ?? 100,
    scale: partialItem.scale ?? 100,
    x: partialItem.x ?? 0,
    y: partialItem.y ?? 0,
    rotation: partialItem.rotation ?? 0,
    volume: partialItem.volume ?? 100,
    fit: partialItem.fit,
    focusX: partialItem.focusX,
    focusY: partialItem.focusY,
    cropRect: partialItem.cropRect,
    effects: partialItem.effects || [],
    keyframes: partialItem.keyframes || [],
    transitionIn: partialItem.transitionIn
  }

  // Ripple insert (roadmap B9, core C2): with ripple mode ON, dropping
  // a clip ON TOP of existing content becomes an INSERT edit — the new
  // clip lands at the target and every later clip on the track shifts
  // right by its duration. Drops into empty gaps keep the plain
  // overlay behaviour, like CapCut's insert mode. History was already
  // pushed above, so the bridge runs with skipHistory.
  const durationTicks = Math.max(1, Math.round((outPoint - inPoint) / speed))
  const collides = track.items.some((i) => {
    const start = clipStartTicks(i)
    const end = clipEndTicks(i)
    return start < offset + durationTicks && end > offset
  })
  if (rippleMode.value && collides) {
    const rippleId = `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const v3Partial = ticksClipToV3({ ...newItem, id: rippleId }, trackType)
    const result = applyV3Edit(v3 => insertClipRipple(v3, trackType, v3Partial, Math.max(0, Math.round(offset))), { skipHistory: true })
    if (result) {
      selectedClipId.value = result.clip.id
      return currentProject.value.timeline.tracks
        .flatMap(t => t.items || [])
        .find(i => i.id === result.clip.id) ?? null
    }
    // A locked target track refuses the bridge insert; fall through to
    // the plain overlay path so the drop never silently vanishes.
  }

  track.items.push(newItem)
  selectedClipId.value = newItem.id
  saveProject()
  return newItem
}

// Close gaps (roadmap B9 — core C2): pull every unlocked track
// together. A cheap pre-scan avoids pushing a no-op history entry when
// there is nothing to close; returns the TICKS closed (core reports
// seconds — converted at this boundary).
function closeProjectGaps(): number {
  const tracks = currentProject.value?.timeline?.tracks
  if (!tracks) return 0
  let hasGap = false
  for (const track of tracks) {
    if (track.locked) continue
    const sorted = [...(track.items || [])].sort((a, b) => clipStartTicks(a) - clipStartTicks(b))
    let cursor = 0
    for (const item of sorted) {
      const start = clipStartTicks(item)
      if (start > cursor) {
        hasGap = true
        break
      }
      cursor = Math.max(cursor, clipEndTicks(item))
    }
    if (hasGap) break
  }
  if (!hasGap) return 0
  return Math.round((applyV3Edit(v3 => closeGaps(v3)) ?? 0) * TICKS_PER_SECOND)
}

// Gesture preview (roadmap R124): live drag/trim geometry lives HERE,
// outside the project store, while a pointer gesture runs. Writing the
// store on every pointermove re-rendered every timeline layer AND fired
// the deep timeline watchers (preview sync, minimap, ...) every frame —
// that is what "dragging feels laggy, works sometimes" meant. Handlers
// now paint into this map on move and commit the final values into the
// store ONCE on pointerup, right before the single saveProject().
const gesturePreview = ref<Record<string, Partial<TmcutTimelineItem>>>({})

function setGesturePreview(entries: Record<string, Partial<TmcutTimelineItem>>) {
  gesturePreview.value = { ...gesturePreview.value, ...entries }
}

function clearGesturePreview() {
  if (Object.keys(gesturePreview.value).length > 0) gesturePreview.value = {}
}

// Update clip. `persist` is false during live drag/trim handlers:
// writing localStorage on every mousemove frame is what made dragging
// feel laggy (R122). The handlers mutate the reactive store for instant
// visual feedback and persist once on mouseup.
function updateClip(clipId: string, patch: Partial<TmcutTimelineItem>, persist = true) {
  if (!currentProject.value?.timeline?.tracks) return
  for (const track of currentProject.value.timeline.tracks) {
    const idx = track.items?.findIndex(i => i.id === clipId)
    if (idx !== undefined && idx !== -1) {
      track.items[idx] = { ...track.items[idx]!, ...patch }
      if (persist) saveProject()
      return
    }
  }
}

// Shared default fade envelope (roadmap D-1 / C12): 0.5s in + out —
// consumed by the Inspector fade buttons and the Shift+D quick toggle
// (K8) so the two can never drift apart.
export const TMCUT_DEFAULT_FADE_SEC = 0.5

// Quick fade toggle for the selected clip (roadmap K8 / D-1): flips BOTH
// edges at once — the default envelope when none is active, cleared when
// either edge has one. Text tracks carry no audio, so they are never a
// fade target; the length clamp mirrors the Inspector slider (half the
// clip). One undo entry, like the Inspector's discrete toggle (B8).
function toggleFadeSelection(): 'applied' | 'cleared' | null {
  if (!selectedClipId.value || !currentProject.value?.timeline?.tracks) return null
  for (const track of currentProject.value.timeline.tracks) {
    if (track.type === 'text') continue
    const idx = track.items?.findIndex(i => i.id === selectedClipId.value)
    if (idx !== undefined && idx !== -1) {
      const clip = track.items[idx]!
      const active = (clip.fade?.in || 0) > 0 || (clip.fade?.out || 0) > 0
      if (active) {
        pushHistory()
        track.items[idx] = { ...clip, fade: { in: 0, out: 0 } }
        saveProject()
        return 'cleared'
      }
      const clipSec = clipDurationSec(clip)
      const ticks = secToTicks(Math.min(TMCUT_DEFAULT_FADE_SEC, clipSec / 2))
      if (ticks <= 0) return null // sub-frame clip: no room for an envelope
      pushHistory()
      track.items[idx] = { ...clip, fade: { in: ticks, out: ticks } }
      saveProject()
      return 'applied'
    }
  }
  return null
}

// Remove clip
function removeClip(clipId: string) {
  if (!currentProject.value?.timeline?.tracks) return
  for (const track of currentProject.value.timeline.tracks) {
    const idx = track.items?.findIndex(i => i.id === clipId)
    if (idx !== undefined && idx !== -1) {
      pushHistory()
      track.items.splice(idx, 1)
      if (selectedClipId.value === clipId) {
        selectedClipId.value = null
      }
      saveProject()
      return
    }
  }
}

// ===== Core-backed editing (roadmap Phase 2 wiring) =====
// C16-R3: the store holds ticks, so the bridge is the TICKS flavor of
// @tmcut/core v1compat — an identity on time fields, no float
// round-trips. Results merge back by clip id, and the app JSON history
// wraps every op so undo keeps working.

const clipboard = ref<CoreClipboard | null>(null)
const rippleMode = ref(false)

function expandedSelectionIds(): string[] {
  if (!selectedClipId.value || !currentProject.value) return []
  return expandRelated(ticksTracksToV3(currentProject.value.timeline.tracks), [selectedClipId.value])
}

/** Run a core op on a converted v3 copy, then merge results back by id. */
function applyV3Edit<T>(operate: (v3: TmcutTimeline) => T, options?: { skipHistory?: boolean }): T | null {
  const tracks = currentProject.value?.timeline?.tracks
  if (!tracks) return null
  const v3 = ticksTracksToV3(tracks)
  // Callers that already pushed history (multi-step gestures) pass
  // skipHistory so one user action stays ONE undo entry.
  if (!options?.skipHistory) pushHistory()
  const result = operate(v3)
  syncTicksResult(tracks, v3)
  saveProject()
  return result
}

function copySelectedClips(): boolean {
  const tracks = currentProject.value?.timeline?.tracks
  const ids = expandedSelectionIds()
  if (!tracks || ids.length === 0) return false
  const data = copyClips(ticksTracksToV3(tracks), ids)
  clipboard.value = data
  return !!data
}

function pasteClipboardAt(timeSec: number): string[] {
  const data = clipboard.value
  const tracks = currentProject.value?.timeline?.tracks
  if (!data || !tracks) return []
  const target = Math.max(0, Math.round(secToTicks(timeSec)))
  // Refused ops must not touch history (house rule, cf. closeProjectGaps
  // R99 / removeTrack R103): run the op on the throwaway v3 copy FIRST
  // and only open an undo entry if something actually lands (locked
  // target tracks make pasteClips skip everything).
  const v3 = ticksTracksToV3(tracks)
  const result = pasteClips(v3, data, target)
  if (!result || result.length === 0) return []
  pushHistory() // still snapshots the pre-paste state (sync runs after)
  syncTicksResult(tracks, v3)
  saveProject()
  selectedClipId.value = result[result.length - 1] ?? null
  return result
}

function duplicateSelectedClips(atSec?: number): string[] {
  const tracks = currentProject.value?.timeline?.tracks
  const ids = expandedSelectionIds()
  if (!tracks || ids.length === 0) return []
  const target = atSec === undefined ? undefined : Math.max(0, Math.round(secToTicks(atSec)))
  // Same refusal rule as pasteClipboardAt: a fully locked selection
  // duplicates nothing and must not push an undo entry or save.
  const v3 = ticksTracksToV3(tracks)
  const result = duplicateClips(v3, ids, target)
  if (!result || result.length === 0) return []
  pushHistory()
  syncTicksResult(tracks, v3)
  saveProject()
  const newIds = result.map(copy => copy.id)
  selectedClipId.value = newIds[0] ?? null
  return newIds
}

function rippleDeleteSelected(acrossTracks = false): boolean {
  const id = selectedClipId.value
  if (!id || !currentProject.value) return false
  for (const track of currentProject.value.timeline.tracks) {
    const item = track.items?.find(i => i.id === id)
    if (item) {
      if (track.locked) return false
      break
    }
  }
  const shifted = applyV3Edit(v3 => rippleDelete(v3, id, { acrossTracks }))
  if (shifted === null || shifted === undefined) return false
  selectedClipId.value = null
  return true
}

function snapTimeSec(
  targetSec: number,
  playheadSec: number,
  options?: { ignoreIds?: string[], thresholdSec?: number }
): number {
  const tracks = currentProject.value?.timeline?.tracks
  if (!tracks) return targetSec
  const v3 = ticksTracksToV3(tracks)
  // Roadmap B5: real markers join the snap candidates — core snapTime
  // reads timeline.markers, but the bridge always starts it empty.
  v3.markers = ensureMarkers()
  return ticksToSec(snapTime(v3, Math.round(secToTicks(targetSec)), {
    playheadTicks: Math.round(secToTicks(playheadSec)),
    ignoreIds: options?.ignoreIds,
    thresholdTicks: options?.thresholdSec !== undefined
      ? Math.round(secToTicks(options.thresholdSec))
      : undefined
  }))
}

// ---- Ruler markers (roadmap B5) ----
// Core marker ops mutate a timeline's `markers` array in place. The app
// wraps them with pushHistory + saveProject itself (applyV3Edit only
// bridges TRACKS between the v1 project model and the v3 DSL) and hands
// core a minimal { markers } shim — the array reference is shared with
// project state, so changes show up in the UI immediately.
function ensureMarkers(): TmcutMarker[] {
  const timeline = currentProject.value?.timeline
  if (!timeline) return []
  if (!Array.isArray(timeline.markers)) timeline.markers = []
  return timeline.markers
}

function markerShim(): TmcutTimeline {
  return { version: 3, tracks: [], markers: ensureMarkers() }
}

/** Reactive view of the project's ruler markers (empty array when none. */
const timelineMarkers = computed<TmcutMarker[]>(() => ensureMarkers())

/** Drop a marker at the given timeline position (seconds). */
function addMarkerAt(timeSec: number): boolean {
  if (!currentProject.value) return false
  ensureMarkers()
  pushHistory()
  addMarker(markerShim(), Math.max(0, Math.round(secToTicks(timeSec))))
  saveProject()
  return true
}

/** Rename / recolor a marker. Returns false when the id is unknown. */
function updateMarker(markerId: string, patch: { label?: string, color?: string }): boolean {
  const marker = ensureMarkers().find(m => m.id === markerId)
  if (!marker) return false
  pushHistory()
  if (patch.label !== undefined) marker.label = patch.label
  if (patch.color !== undefined) marker.color = patch.color
  saveProject()
  return true
}

/** Delete a marker by id. Returns false when the id is unknown. */
function removeMarkerById(markerId: string): boolean {
  if (!ensureMarkers().some(m => m.id === markerId)) return false
  pushHistory()
  const removed = removeMarker(markerShim(), markerId)
  saveProject()
  return removed
}

// ===== Transitions (roadmap B3 / core C5) =====
// `transitionIn.duration` is stored in TICKS inside the v1 seconds model —
// the v1compat bridge passes the field through untouched (like keyframes).
// Applying shifts the clip left so its head overlaps the neighbor's tail;
// clearing restores the original cut. Validation always runs BEFORE the
// history push so a refused request leaves no stray undo entry.

/** Read-only transition validation for the clip context menu. */
function checkClipTransition(clipId: string, type: string, durationSec: number): { ok: boolean, reason?: string } {
  const tracks = currentProject.value?.timeline?.tracks
  if (!tracks) return { ok: false, reason: 'no-neighbor' }
  const check = canApplyTransition(ticksTracksToV3(tracks), clipId, type, Math.round(secToTicks(durationSec)))
  return check.ok ? { ok: true } : { ok: false, reason: check.reason ?? 'no-neighbor' }
}

/** Apply a transition (core C5) — one undo entry per successful call. */
function applyClipTransition(clipId: string, type: string, durationSec: number): { ok: boolean, reason?: string } {
  const check = checkClipTransition(clipId, type, durationSec)
  if (!check.ok) return check
  const ticks = Math.round(secToTicks(durationSec))
  const applied = applyV3Edit(v3 => applyTransition(v3, clipId, type, ticks))
  return applied === true ? { ok: true } : { ok: false, reason: 'no-neighbor' }
}

/** Remove a transition and restore the original cut position. */
function clearClipTransition(clipId: string): boolean {
  const tracks = currentProject.value?.timeline?.tracks
  if (!tracks) return false
  // Probe on a throwaway conversion first — a refusal pushes no history.
  if (!clearTransition(ticksTracksToV3(tracks), clipId)) return false
  return applyV3Edit(v3 => clearTransition(v3, clipId)) === true
}

/** Clips carrying a transition — drives the export honesty badge. */
const timelineTransitionCount = computed(() => {
  const tracks = currentProject.value?.timeline?.tracks
  if (!tracks) return 0
  let count = 0
  for (const track of tracks) {
    for (const item of track.items || []) {
      if ((item.transitionIn?.duration ?? 0) > 0) count++
    }
  }
  return count
})

// Re-point all clips that reference an old media path (media relink)
function updateClipsSrc(oldSrc: string, newSrc: string): number {
  if (!currentProject.value?.timeline?.tracks) return 0
  const oldKey = normalizePath(oldSrc)
  let count = 0
  for (const track of currentProject.value.timeline.tracks) {
    for (const item of track.items || []) {
      if (item.src && normalizePath(item.src) === oldKey) {
        item.src = newSrc
        count++
      }
    }
  }
  if (count > 0) {
    saveProject()
  }
  return count
}

// Split clip at timeline splitTime (SECONDS — the UI contract; converted
// to ticks here, all math runs in the store unit).
function splitClip(clipId: string, splitTime: number): boolean {
  if (!currentProject.value?.timeline?.tracks) return false
  const splitTicks = Math.round(secToTicks(splitTime))

  for (const track of currentProject.value.timeline.tracks) {
    const idx = track.items?.findIndex(i => i.id === clipId)
    if (idx === undefined || idx === -1) continue

    const clip = track.items[idx]!
    const speed = clip.speed || 1
    const clipStart = clipStartTicks(clip)
    const clipEnd = clipEndTicks(clip)
    // 0.1s margin, expressed in ticks (roadmap B2: no degenerate slivers)
    const margin = Math.round(0.1 * TICKS_PER_SECOND)

    // Ensure split time is within clip boundaries (leave at least 0.1s margin)
    if (splitTicks <= clipStart + margin || splitTicks >= clipEnd - margin) {
      return false
    }

    const elapsedOnTimeline = splitTicks - clipStart
    const splitSourceTime = Math.round(clip.in + elapsedOnTimeline * speed)

    pushHistory()
    // First piece: keep original in, adjust out
    const originalOut = clip.out
    clip.out = splitSourceTime

    // Second piece: starts at splitSourceTime, ends at originalOut, offset at splitTime
    const secondClip: TmcutTimelineItem = {
      ...JSON.parse(JSON.stringify(clip)),
      id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      in: splitSourceTime,
      out: originalOut,
      offset: splitTicks
    }
    // The tail's incoming neighbor changed (roadmap B3): the inherited
    // transition only ever described the ORIGINAL pair (the first half
    // keeps it — its start still touches the previous clip).
    delete secondClip.transitionIn

    track.items.splice(idx + 1, 0, secondClip)
    selectedClipId.value = secondClip.id
    saveProject()
    return true
  }

  return false
}

// Keyboard trim (roadmap B7): cut the selected clip's in/out edge to a
// timeline position (SECONDS — the UI contract, converted here) via the
// core trimClip through the ticks bridge. The playhead must sit INSIDE
// the clip with the same 0.1s margin splitClip uses, so the core never
// has to clamp the source boundary and no over-extension past the source
// can happen.
function trimSelectedEdgeAt(edge: 'in' | 'out', timeSec: number): boolean {
  const id = selectedClipId.value
  const tracks = currentProject.value?.timeline?.tracks
  if (!id || !tracks) return false
  const timeTicks = Math.round(secToTicks(timeSec))
  const margin = Math.round(0.1 * TICKS_PER_SECOND)
  for (const track of tracks) {
    const clip = track.items?.find(i => i.id === id)
    if (!clip) continue
    if (track.locked) return false
    const speed = clip.speed || 1
    const start = clipStartTicks(clip)
    const end = clipEndTicks(clip)
    if (timeTicks <= start + margin || timeTicks >= end - margin) return false
    const sourceTicks = Math.round(clip.in + (timeTicks - start) * speed)
    return applyV3Edit(v3 => trimClip(v3, id, edge, sourceTicks)) === true
  }
  return false
}

// ---- Groups & linked pairs (roadmap B4, core C9) ----
// The app selection is single-clip, so both operations work on the
// EXPANDED selection (the clip plus its group/link relatives).

/** Unlocked members of the expanded selection (core also skips locks). */
function expandedUnlockedIds(): string[] {
  const wanted = new Set(expandedSelectionIds())
  const ids: string[] = []
  for (const track of currentProject.value?.timeline?.tracks || []) {
    if (track.locked) continue
    for (const item of track.items || []) {
      if (wanted.has(item.id)) ids.push(item.id)
    }
  }
  return ids
}

/** Group the expanded selection (Ctrl+G). False when it cannot reach 2. */
function groupSelection(): boolean {
  const ids = expandedUnlockedIds()
  if (ids.length < 2) return false
  return typeof applyV3Edit(v3 => groupClips(v3, ids)) === 'string'
}

/** Dissolve the group of the expanded selection (Ctrl+Shift+G). */
function ungroupSelection(): boolean {
  const tracks = currentProject.value?.timeline?.tracks
  const ids = expandedUnlockedIds()
  if (!tracks || ids.length === 0) return false
  const hasGroup = tracks.some(track => !track.locked
    && (track.items || []).some(item => ids.includes(item.id) && item.groupId))
  if (!hasGroup) return false
  return (applyV3Edit(v3 => ungroupClips(v3, ids)) ?? 0) > 0
}

/**
 * Link / unlink the selected clip to every clip overlapping it in time
 * on other tracks (Ctrl+L toggles). Returns 'linked' | 'unlinked' |
 * 'none' (nothing overlapping or selection locked) for honest toasts.
 */
function toggleLinkSelection(): 'linked' | 'unlinked' | 'none' {
  const tracks = currentProject.value?.timeline?.tracks
  const id = selectedClipId.value
  if (!tracks || !id) return 'none'
  let clip: TmcutTimelineItem | undefined
  let locked = false
  for (const track of tracks) {
    const item = track.items?.find(i => i.id === id)
    if (item) {
      clip = item
      locked = !!track.locked
      break
    }
  }
  if (!clip || locked) return 'none'
  const start = clipStartSec(clip)
  const end = clipEndSec(clip)
  const overlaps: TmcutTimelineItem[] = []
  for (const track of tracks) {
    if (track.locked) continue
    for (const item of track.items || []) {
      if (item.id === id) continue
      const itemStart = clipStartSec(item)
      const itemEnd = clipEndSec(item)
      if (itemStart < end && itemEnd > start) overlaps.push(item)
    }
  }
  if (overlaps.length === 0) return 'none'
  // Toggle: when the clip and every overlap already share one linkId,
  // Ctrl+L breaks the pair instead of minting a new link.
  const current = clip.linkId
  if (current && overlaps.every(o => o.linkId === current)) {
    pushHistory()
    clip.linkId = null
    for (const overlap of overlaps) overlap.linkId = null
    saveProject()
    return 'unlinked'
  }
  pushHistory()
  const linkId = `link_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  clip.linkId = linkId
  for (const overlap of overlaps) overlap.linkId = linkId
  saveProject()
  return 'linked'
}

/**
 * Relative offsets (id → offset, in STORE TICKS) of the expanded
 * selection WITHOUT the given clip — the drag handler carries them along
 * so grouped/linked clips travel together (roadmap B4). Locked tracks
 * are excluded.
 */
function relatedOffsetsFor(clipId: string): Record<string, number> {
  const wanted = new Set(expandedSelectionIds())
  wanted.delete(clipId)
  const out: Record<string, number> = {}
  for (const track of currentProject.value?.timeline?.tracks || []) {
    if (track.locked) continue
    for (const item of track.items || []) {
      if (wanted.has(item.id)) out[item.id] = clipStartTicks(item)
    }
  }
  return out
}

// ===== Canvas Engine (Phase 2) =====

// Switch canvas ratio: keeps timeline intact, re-frames manual offsets proportionally
function switchCanvas(width: number, height: number) {
  const project = currentProject.value
  if (!project || !width || !height) return
  const fromW = project.canvas?.width || 1920
  const fromH = project.canvas?.height || 1080
  project.canvas = normalizeCanvas({
    width,
    height,
    fps: canvasFpsValue(project.canvas),
    background: project.canvas?.background
  })
  for (const track of project.timeline?.tracks || []) {
    for (const item of track.items || []) {
      const rt = reframeTransform(item.x, item.y, fromW, fromH, width, height)
      item.x = rt.x
      item.y = rt.y
    }
  }
  saveProject()
}

function setCanvasBackground(type: 'color' | 'image' | 'transparent', value?: string) {
  const project = currentProject.value
  if (!project) return
  project.canvas = normalizeCanvas({ ...project.canvas, background: { type, value } })
  saveProject()
}

// Duplicate the current project as another canvas ratio (reframe)
function duplicateAsProject(presetId: string): TmcutProject | null {
  const project = currentProject.value
  const preset = findCanvasPreset(presetId)
  if (!project || !preset) return null

  const clone: TmcutProject = JSON.parse(JSON.stringify(project))
  clone.id = Math.random().toString(36).slice(2, 10)
  clone.name = `${project.name} (${preset.id})`
  clone.created_at = new Date().toISOString()
  clone.updated_at = new Date().toISOString()

  const fromW = project.canvas?.width || 1920
  const fromH = project.canvas?.height || 1080
  clone.canvas = normalizeCanvas({
    width: preset.width,
    height: preset.height,
    fps: canvasFpsValue(project.canvas),
    background: project.canvas?.background
  })
  for (const track of clone.timeline?.tracks || []) {
    for (const item of track.items || []) {
      const rt = reframeTransform(item.x, item.y, fromW, fromH, preset.width, preset.height)
      item.x = rt.x
      item.y = rt.y
    }
  }

  flushDiskSave() // source project keeps its pending edit (R95)
  currentProject.value = clone
  resetHistory() // the clone is a new project — its history starts empty
  projects.value.unshift(clone)
  saveProject()
  return clone
}

// ===== Undo / Redo history (timeline + canvas snapshots) =====

const undoStack = ref<string[]>([])
const redoStack = ref<string[]>([])
const HISTORY_LIMIT = 50

function historySnapshot(): string {
  return JSON.stringify({
    timeline: currentProject.value?.timeline,
    canvas: currentProject.value?.canvas
  })
}

// Multi-command transaction (orchestration: AI/voice/MCP proposals).
// Every op inside the group is folded into ONE undo entry whose snapshot is
// taken when the group opens; a refused/partial group can still be undone in
// a single step. Nesting is counted so inner helpers stay callable.
let historyGroupDepth = 0

function beginHistoryGroup() {
  if (!currentProject.value) return
  if (historyGroupDepth === 0) pushHistory()
  historyGroupDepth++
}

function endHistoryGroup() {
  historyGroupDepth = Math.max(0, historyGroupDepth - 1)
  lastCoalesce = null
}

// Capture state BEFORE a mutation so it can be restored with undo().
// Call at drag/trim gesture start and inside discrete ops (add/remove/split).
function pushHistory() {
  if (!currentProject.value) return
  // Inside a transaction the opening snapshot already covers this change.
  if (historyGroupDepth > 0) return
  undoStack.value.push(historySnapshot())
  if (undoStack.value.length > HISTORY_LIMIT) undoStack.value.shift()
  redoStack.value = []
}

// Undo coalescing (roadmap B8 — the snapshot-stack twin of core C15):
// consecutive edits of the SAME target inside a short burst become ONE
// undo entry, so typing a text or dragging a slider undoes as a whole.
// Snapshots hold full state, so merging only means "do not push again" —
// the top entry already captures the state from before the burst.
const HISTORY_COALESCE_MS = 800
let lastCoalesce: { key: string, at: number } | null = null

function pushHistoryCoalesced(key: string) {
  const now = Date.now()
  if (lastCoalesce && lastCoalesce.key === key && now - lastCoalesce.at < HISTORY_COALESCE_MS) {
    lastCoalesce.at = now
    redoStack.value = [] // a fresh edit invalidates redo, like pushHistory
    return
  }
  pushHistory()
  lastCoalesce = { key, at: now }
}

// The stacks are module-level and snapshots never carry a project id, so
// any stack left over from another project transplants the CLOSED one's
// timeline/canvas into whatever is open when the user hits Ctrl+Z (R94).
// Every project switch must reset.
function resetHistory() {
  undoStack.value = []
  redoStack.value = []
  lastCoalesce = null
}

const canUndo = computed(() => undoStack.value.length > 0)
const canRedo = computed(() => redoStack.value.length > 0)

function restoreHistorySnapshot(raw: string) {
  if (!currentProject.value) return
  // Restoring breaks any edit burst — the next edit starts fresh.
  lastCoalesce = null
  try {
    const parsed = JSON.parse(raw) as { timeline?: TmcutProjectTimeline, canvas?: TmcutCanvas }
    if (parsed.timeline) currentProject.value.timeline = parsed.timeline
    if (parsed.canvas) currentProject.value.canvas = parsed.canvas
    selectedClipId.value = null
    saveProject()
  } catch (error) {
    console.error('Failed to restore history snapshot:', error)
  }
}

function undo() {
  if (!currentProject.value || undoStack.value.length === 0) return
  redoStack.value.push(historySnapshot())
  const prev = undoStack.value.pop()!
  restoreHistorySnapshot(prev)
}

function redo() {
  if (!currentProject.value || redoStack.value.length === 0) return
  undoStack.value.push(historySnapshot())
  const next = redoStack.value.pop()!
  restoreHistorySnapshot(next)
}

// Track-level flags (CapCut-style eye / lock / mute per track)
function updateTrack(trackId: string, patch: Partial<TmcutTrack>) {
  if (!currentProject.value?.timeline?.tracks) return
  const track = currentProject.value.timeline.tracks.find(t => t.id === trackId)
  if (!track) return
  Object.assign(track, patch)
  saveProject()
}

function toggleTrackMute(trackId: string) {
  const track = currentProject.value?.timeline?.tracks.find(t => t.id === trackId)
  if (!track) return
  updateTrack(trackId, { muted: !track.muted })
}

function toggleTrackLock(trackId: string) {
  const track = currentProject.value?.timeline?.tracks.find(t => t.id === trackId)
  if (!track) return
  updateTrack(trackId, { locked: !track.locked })
}

function toggleTrackHidden(trackId: string) {
  const track = currentProject.value?.timeline?.tracks.find(t => t.id === trackId)
  if (!track) return
  updateTrack(trackId, { hidden: !track.hidden })
}

// R124 A1: track-level audio (CapCut §5.3). Volume 0..100 (100 = no
// change) and pan -100..100 (0 = centre). Both default to neutral when
// absent — a plain track keeps the old byte-identical export.
function updateTrackVolume(trackId: string, volume: number) {
  const track = currentProject.value?.timeline?.tracks.find(t => t.id === trackId)
  if (!track) return
  const v = Math.max(0, Math.min(100, Number(volume) || 0))
  updateTrack(trackId, { volume: v === 100 ? undefined : v })
}

function updateTrackPan(trackId: string, pan: number) {
  const track = currentProject.value?.timeline?.tracks.find(t => t.id === trackId)
  if (!track) return
  const p = Math.max(-100, Math.min(100, Number(pan) || 0))
  updateTrack(trackId, { pan: p === 0 ? undefined : p })
}

// Track z-order (layering groundwork, R122): the store array IS the
// stacking order — index 0 is the top row AND the topmost rendered layer
// (the preview takes the first matching video track, text overlays draw
// over video). "Up" therefore means a smaller index. Done on the store
// array directly (core ops key by id and never reorder); history
// snapshots the whole project, so undo restores the previous stacking.
function moveTrackInProject(trackId: string, direction: 'up' | 'down'): boolean {
  const tracks = currentProject.value?.timeline?.tracks
  if (!tracks) return false
  const from = tracks.findIndex(t => t.id === trackId)
  if (from === -1) return false
  const to = direction === 'up' ? from - 1 : from + 1
  if (to < 0 || to >= tracks.length) return false
  pushHistory()
  const [track] = tracks.splice(from, 1)
  tracks.splice(to, 0, track!)
  saveProject()
  return true
}

// Track add/remove (Roadmap A5): routed through applyV3Edit so history,
// undo and autosave see the change; syncTicksResult keeps the store track
// list in step (creates on add, prunes on remove).
function addTrackToProject(trackType: 'video' | 'text' | 'audio'): boolean {
  return applyV3Edit(v3 => addTrack(v3, trackType)) !== null
}

function removeTrackFromProject(trackId: string): boolean {
  const track = currentProject.value?.timeline?.tracks.find(t => t.id === trackId)
  // Locked tracks refuse removal (core does the same; checked here too so
  // no history entry or save is pushed for a refused operation).
  if (!track || track.locked) return false
  const removedIds = new Set((track.items || []).map(item => item.id))
  const ok = applyV3Edit(v3 => removeTrack(v3, trackId)) === true
  if (ok && selectedClipId.value && removedIds.has(selectedClipId.value)) {
    selectedClipId.value = null
  }
  return ok
}

// Autosave IS scheduleDiskSave, called from saveProject (R95): one
// debounce timer per store, flushed on every project swap. The old
// setupAutosave() (R108 removed) was an exported second, independent
// 3-second timer that nothing ever called — dead code with its own
// module-level timer, the exact state class the R94-R106 chain keeps
// finding leaks in.

// ===== Snapshots =====

async function loadSnapshots() {
  const ipc = tmcutIpc()
  const project = currentProject.value
  if (!ipc || !project || import.meta.server) {
    snapshots.value = []
    return
  }
  try {
    snapshots.value = await ipc.listSnapshots(project.id)
  } catch (error) {
    console.error('Failed to list snapshots:', error)
    snapshots.value = []
  }
}

async function createSnapshot(name?: string) {
  const ipc = tmcutIpc()
  const project = currentProject.value
  if (!ipc || !project || import.meta.server) return
  saveProject()
  try {
    // Plain copy for IPC structured clone (reactive proxies fail)
    const plain = JSON.parse(JSON.stringify(project)) as TmcutProject
    await ipc.saveSnapshot({ id: project.id, data: plain, name })
    await loadSnapshots()
  } catch (error) {
    console.error('Failed to save snapshot:', error)
  }
}

async function restoreSnapshot(ts: number) {
  const ipc = tmcutIpc()
  const project = currentProject.value
  if (!ipc || !project || import.meta.server) return
  try {
    const data = (await ipc.readSnapshot({ id: project.id, ts })) as TmcutProject | null
    if (!data?.id) return
    currentProject.value = data
    applyProjectMigration(data)
    syncProjectIndex(data)
    saveProject()
  } catch (error) {
    console.error('Failed to restore snapshot:', error)
  }
}

async function deleteSnapshot(ts: number) {
  const ipc = tmcutIpc()
  const project = currentProject.value
  if (!ipc || !project || import.meta.server) return
  try {
    await ipc.deleteSnapshot({ id: project.id, ts })
    await loadSnapshots()
  } catch (error) {
    console.error('Failed to delete snapshot:', error)
  }
}

// Initialize from localStorage on module load
function init() {
  if (import.meta.server) return
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && (key.startsWith('tmcut_project_') || key.startsWith('vc_project_'))) {
        try {
          const project = JSON.parse(localStorage.getItem(key) || '{}')
          if (project.id && !projects.value.some(p => p.id === project.id)) {
            projects.value.unshift(project)
          }
        } catch (e) {
          console.error(`Failed to parse project ${key}:`, e)
        }
      }
    }
  } catch (e) {
    console.error('LocalStorage not available:', e)
  }
}

// Dev/QA hook (R124): lets an automated harness read live store state
// (and pre-seed localStorage + reload) instead of clicking through the
// UI. Tree-shaken out of production builds by import.meta.dev. Lives at
// module bottom on purpose: module-scope code here would hit the TDZ of
// refs declared below. Merged (not assigned) so sibling modules can add
// their own state to the same object regardless of load order.
if (import.meta.client && import.meta.dev && typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>
  const qaStore = (w.tmcutQaStore || (w.tmcutQaStore = {})) as Record<string, unknown>
  qaStore.projects = projects
  qaStore.currentProject = currentProject
  qaStore.gesturePreview = gesturePreview
}

// Export composable
export function useTmcutProject() {
  init()
  return {
    currentProject,
    projects,
    isLoading,
    selectedClipId,
    selectedClip,
    isCropEditing,
    toggleCropEditing,
    totalDuration,
    contentDuration,
    hasTimelineClips,
    saveStatus,
    lastSavedAt,
    pendingRecovery,
    snapshots,
    loadProject,
    saveProject,
    createProject,
    deleteProject,
    renameProject,
    duplicateProject,
    togglePinProject,
    selectClip,
    addClipToTrack,
    updateClip,
    gesturePreview,
    setGesturePreview,
    clearGesturePreview,
    removeClip,
    splitClip,
    closeProjectGaps,
    pushHistory,
    pushHistoryCoalesced,
    beginHistoryGroup,
    endHistoryGroup,
    undo,
    redo,
    canUndo,
    canRedo,
    clipboard,
    rippleMode,
    copySelectedClips,
    pasteClipboardAt,
    duplicateSelectedClips,
    rippleDeleteSelected,
    snapTimeSec,
    timelineMarkers,
    addMarkerAt,
    updateMarker,
    removeMarkerById,
    checkClipTransition,
    applyClipTransition,
    clearClipTransition,
    timelineTransitionCount,
    flushDiskSave,
    updateTrack,
    toggleTrackMute,
    toggleTrackLock,
    toggleTrackHidden,
    updateTrackVolume,
    updateTrackPan,
    addTrackToProject,
    moveTrackInProject,
    removeTrackFromProject,
    updateClipsSrc,
    trimSelectedEdgeAt,
    toggleFadeSelection,
    groupSelection,
    ungroupSelection,
    toggleLinkSelection,
    relatedOffsetsFor,
    switchCanvas,
    setCanvasBackground,
    duplicateAsProject,
    // R132 — monotonic mutation counter + the revision at open time.
    // Exposed so the editor (and future automation writers) can detect a
    // file that was written outside this session while it was held open.
    revisionAtLoad,
    currentRevision: () => currentProject.value?.revision ?? 0,
    persistProjectToDisk,
    refreshProjects,
    applyRecovery,
    dismissRecovery,
    loadSnapshots,
    createSnapshot,
    restoreSnapshot,
    deleteSnapshot
  }
}
