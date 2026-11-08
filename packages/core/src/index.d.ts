// tmcut-core — public API declarations.
// Types come from ../types/ (single source of truth); this file only binds
// them to the runtime engine's function signatures. Checked by
// tsconfig.check.json (pnpm typecheck:core), not by ESLint.
import type {
  FrameRate,
  TmcutTrackType,
  TmcutTimelineClip,
  TmcutClipEffect,
  TmcutTrack,
  TmcutMarker,
  TmcutTimeline,
  TmcutProject,
  TmcutCanvas,
  TmcutFitMode,
  TmcutOrientation,
  TmcutCropRect,
  TmcutStabilizeLevel,
  MediaTime
} from '../types/dsl.js'
import type { TmcutAssetKind, TmcutMediaMetadata } from '../types/media.js'
import type {
  TmcutAudioTrackInfo,
  TmcutDurationSource,
  TmcutFrameRateInfo,
  TmcutImportStatus,
  TmcutMediaCapabilities,
  TmcutMediaCompatibility,
  TmcutMediaInfo,
  TmcutProbeDescriptor,
  TmcutProbeVideoTrack,
  TmcutStillInfo,
  TmcutVideoTrackInfo
} from '../types/mediaInfo.js'
import type { TmcutEdl, TmcutEdlSegment } from '../types/edl.js'
import type { TranscriptCue } from '../types/caption.js'
import type { TmcutCapabilities, TmcutRuntimeInfo } from '../types/runtime.js'
import type { TmcutClock } from '../types/platform.js'
import type { TmcutFrameCompareOptions, TmcutFrameCompareResult } from '../types/pixels.js'

// Re-exported domain types for consumers (single import site).
export type {
  FrameRate,
  TmcutTrackType,
  TmcutTimelineClip,
  TmcutClipEffect,
  TmcutTrack,
  TmcutMarker,
  TmcutTimeline,
  TmcutProject,
  TmcutCanvas,
  TmcutFitMode,
  TmcutOrientation,
  TmcutCropRect,
  TmcutTextAnimationType,
  TmcutStabilizeLevel,
  TmcutStabilizeStatus,
  MediaTime
} from '../types/dsl.js'
export type { TmcutAssetKind, TmcutMediaMetadata } from '../types/media.js'
export type {
  TmcutAudioTrackInfo,
  TmcutDurationSource,
  TmcutFrameRateInfo,
  TmcutImportStatus,
  TmcutMediaCapabilities,
  TmcutMediaCompatibility,
  TmcutMediaInfo,
  TmcutMediaProbeService,
  TmcutMediaWarning,
  TmcutProbeAudioTrack,
  TmcutProbeDescriptor,
  TmcutProbeHints,
  TmcutProbeOptions,
  TmcutProbeSource,
  TmcutProbeSubtitleTrack,
  TmcutProbeVideoTrack,
  TmcutStillInfo,
  TmcutSubtitleTrackInfo,
  TmcutVideoTrackInfo
} from '../types/mediaInfo.js'
export type { TmcutEdl, TmcutEdlSegment } from '../types/edl.js'

export type CoreTrackType = 'video' | 'text' | 'audio'
export type CoreAssetKind = 'video' | 'audio' | 'image'

export interface CoreClipInput extends Partial<TmcutTimelineClip> {
  src?: string
  in?: number
  out?: number
  offset?: number
  scale?: number
  opacity?: number
  x?: number
  y?: number
  rotation?: number
}

export interface CoreHistoryCommand {
  name?: string
  label?: string
  before: TmcutTimeline
  after: TmcutTimeline
}

export interface CoreHistory {
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly depth: number
  commit(command: CoreHistoryCommand): void
  undo(): TmcutTimeline | null
  redo(): TmcutTimeline | null
  clear(): void
  /** Internal: the top entry (or null) — used by coalesce (docs C15). */
  _top(): { name: string, label: string, createdAt: string } | null
  /** Internal: replace the top entry's after-state and clear redo. */
  _replaceAfter(after: TmcutTimeline): void
}

export interface CoreClipboard {
  version: 1
  baseStart: number
  clips: Array<{ trackType: CoreTrackType, clip: TmcutTimelineClip }>
}

export type CoreRecoveryDecision = 'none' | 'suggest' | 'force'

export interface CoreRecoveryInput {
  hasRecovery: boolean
  recoveryUpdatedAtMs: number | null
  hasProject: boolean
  projectMtimeMs: number
}

export interface CoreAssetRecord {
  id: string
  kind: CoreAssetKind
  name: string
  status: string
  sourceType: string
  locator: { runtime: string, path?: string, url?: string }
  durationSec: number
  width: number
  height: number
  fps: number
  fileSize: number
  hash: string | null
  [key: string]: unknown
}

export interface CoreV1TrackItem {
  id: string
  [key: string]: unknown
}

export interface CoreV1Track {
  id: string
  type: CoreTrackType
  name?: string
  items: CoreV1TrackItem[]
}

export interface CoreV3SyncStats {
  added: number
  updated: number
  removed: number
}

export interface CoreSceneSegment {
  start: number
  end: number
}

export interface CoreSilenceRange {
  start: number
  end: number
}

export interface CoreSpeechRange {
  start: number
  end: number
}

export const TICKS_PER_SECOND: number
export function secToTicks(seconds: number): number
export function ticksToSec(ticks: number): number
export const KNOWN_FRAME_RATES: FrameRate[]
export function fpsToRational(fps: number): FrameRate
export function rationalToFloat(rate: FrameRate): number
export function ticksPerFrame(rate: FrameRate): number
export function snapToFrame(ticks: number, rate: FrameRate): number
export function ticksToFrames(ticks: number, rate: FrameRate): number
export function formatTimecode(ticks: number, rate: FrameRate): string

export function clipDurationTicks(clip: TmcutTimelineClip): number
export function clipEndTicks(clip: TmcutTimelineClip): number
export interface CoreClipSpan {
  start: number
  duration: number
  end: number
}
/**
 * Absolute tick span for BOTH stored shapes: DSL v3 (`timeline.start` +
 * `timeline.duration`) and the app store's flat model (`offset` + derived
 * `in`/`out`/`speed`). Unknown shapes are empty (`duration: 0`).
 */
export function clipSpan(
  clip: TmcutTimelineClip | { offset?: number, in?: number, out?: number, speed?: number } | null | undefined
): CoreClipSpan
/**
 * The media range a clip reads, in source ticks: DSL v3 `source.{in,out}` or the
 * app store's flat `in`/`out`. Null for a clip that carries no media (text).
 */
export function clipSourceRange(
  clip: TmcutTimelineClip | { in?: number, out?: number, source?: { in?: number, out?: number } } | null | undefined
): { in: number, out: number } | null

/**
 * The rows of a project (`project.timeline.tracks`), a bare timeline, or a flat
 * `{ tracks }` object. Always a list, so a caller's `for` loop needs no guard.
 *
 * Generic because it is a pure pass-through: core never looks inside a row here,
 * and the store's rows are not core's `TmcutTrack` (they carry `src`, `in` and
 * `offset`). A caller holding its own row type gets that type back.
 */
export function projectTracks<T = TmcutTrack>(
  input: { timeline?: { tracks?: readonly T[] } | TmcutTimeline, tracks?: readonly T[] }
    | TmcutProject | TmcutTimeline | null | undefined
): T[]
export function totalDurationTicks(timeline: TmcutTimeline): number
export function findClip(timeline: TmcutTimeline, clipId: string): { track: TmcutTrack, index: number, clip: TmcutTimelineClip } | null
export function findTrack(timeline: TmcutTimeline, trackId: string): TmcutTrack | null
export function ensureTrack(timeline: TmcutTimeline, trackType: CoreTrackType, name?: string): TmcutTrack
export function nextTrackName(timeline: TmcutTimeline, trackType: CoreTrackType): string
export function addTrack(timeline: TmcutTimeline, trackType: CoreTrackType, name?: string): TmcutTrack
export function removeTrack(timeline: TmcutTimeline, trackId: string, options?: { keepClips?: boolean }): boolean
export function addClip(timeline: TmcutTimeline, trackType: CoreTrackType, partial?: CoreClipInput): TmcutTimelineClip | null
export function removeClip(timeline: TmcutTimeline, clipId: string): boolean
export function splitClip(timeline: TmcutTimeline, clipId: string, splitTimeTicks: number): TmcutTimelineClip | null
export function moveClip(timeline: TmcutTimeline, clipId: string, startTicks: number): boolean
export function trimClip(timeline: TmcutTimeline, clipId: string, edge: 'in' | 'out', sourceTicks: number): boolean
export function validateTimeline(timeline: unknown): string[]

export function createHistory(limit?: number): CoreHistory
export function pushBatch(history: CoreHistory, entries: CoreHistoryCommand[], label?: string): void
export function coalesce(history: CoreHistory, entry: CoreHistoryCommand, windowMs?: number): boolean

export function assetIdForPath(path: unknown): string
export function defaultCanvas(width?: number, height?: number, fps?: number): TmcutCanvas
export function defaultTimeline(): TmcutTimeline
export function createProject(name?: string, canvas?: TmcutCanvas): TmcutProject
export function migrateV1ToV3(v1: unknown): TmcutProject

export function normalizeMediaPath(input: unknown): string
export function mediaFileKey(input: unknown): string
export function mediaFileName(input: unknown): string
export function extensionOf(input: unknown): string
export function classifyAssetKind(input: unknown): TmcutAssetKind | null
/** True when the path is a still drawn from geometry (SVG), not pixels. */
export function isVectorStillImage(input: unknown): boolean
export function formatDurationSec(sec: unknown): string
export function formatFileSize(bytes: unknown): string

export function decideRecovery(input: CoreRecoveryInput): CoreRecoveryDecision

export function int16ToPeaks(samples: ArrayLike<number> | null | undefined, buckets?: number): number[]
export function clampWaveformPoints(points: unknown): number[]
/** What the bars in a stored waveform mean; a reader that does not recognise it re-decodes. */
export const TMCUT_WAVEFORM_ALGORITHM: string
/** How many decimals the stored bars keep. */
export const TMCUT_WAVEFORM_PEAK_PRECISION: number
/**
 * Full-scale (0..1) peak buckets from PCM on the Float32 −1..1 scale `decodePcm`
 * returns. Channels fold by the loudest one; an undelivered channel is skipped.
 */
export function floatPeakBuckets(channels: ArrayLike<ArrayLike<number> | null | undefined> | null | undefined, buckets?: number): number[]
/** The compact record a waveform is cached as. */
export interface TmcutWaveformPayload {
  algorithm: string
  durationSec: number
  sampleRate: number
  channelCount: number
  bucketCount: number
  peaks: number[]
}
/** Stamp a waveform, or null when the input is not one — a failed decode stores nothing. */
export function buildWaveformPayload(input: unknown): TmcutWaveformPayload | null
/** Read a cached waveform back, or null when it is not one this version can draw. */
export function readWaveformPayload(value: unknown): TmcutWaveformPayload | null
/** The artifact kind a stored waveform names itself by in the byte cache. */
export const TMCUT_WAVEFORM_CACHE_KIND: string
/** Bump when the reducer or the envelope changes shape, not when the app restarts. */
export const TMCUT_WAVEFORM_CACHE_VERSION: number
/** The byte-cache key of one revision's waveform, or null when it has no revision. */
export function waveformCacheKey(fingerprint: unknown): string | null

export function fnv1aHex(text: string): string
export function cacheKeyForPath(path: string, revision?: { mtimeMs?: number, size?: number }): string
export function cachePathFor(cacheDir: string, kind: string, key: string, extension: string): string


export function validateEdl(edl: unknown): string[]
export function selectSegments(edl: TmcutEdl, minScore?: number): TmcutEdlSegment[]
/** EDL segments (seconds) -> tick clip inputs; an invalid EDL yields []. */
export function segmentsToClips(
  edl: TmcutEdl,
  segments: TmcutEdlSegment[],
  options?: {
    /** Preserve source pauses >= this many ticks; smaller gaps close. */
    minGapTicks?: number
    /** Guards intent for future audio EDLs; clip shape is identical today. */
    trackType?: 'video' | 'audio'
  }
): Array<CoreClipInput & { in: number, out: number, offset: number }>

// --- Caption / SRT (Roadmap C11) ---
// Cue times are SECONDS (Whisper/SRT native); clip times are v3 ticks.
export type { TranscriptCue } from '../types/caption.js'
export function splitLongCue(cue: TranscriptCue, maxChars: number): TranscriptCue[]
export function cuesToCaptionClips(
  cues: TranscriptCue[],
  options?: {
    /** Word-split budget per caption line (default 42). */
    maxChars?: number
    /** On-screen budget in ticks; longer cues time-slice evenly (default 7s). */
    maxDurTicks?: number
    /** Anchor added to every caption offset (e.g. clip timeline position). */
    fromTicks?: number
    /** Source window in ticks: outside cues drop, straddling cues trim. */
    rangeTicks?: { start: number, end: number }
  }
): Array<CoreClipInput & { text: string, in: number, out: number, offset: number }>
export function parseSrt(text: string): TranscriptCue[]
export function serializeSrt(cues: TranscriptCue[]): string

// --- Audio fades + gain math (Roadmap C12) ---
// Clips accept three shapes (same dual-shape contract as evalKeyframe):
//  - a full v3 timeline clip;
//  - a SHAPE-SHORTCUT `{ timeline: { duration } }` — enough for the fade
//    math (C16-R3: the ticks store hands duration explicitly so the
//    legacy flat branch never sees tick values);
//  - the legacy v1 flat item (in/out SECONDS) — file-migration hosts only.
export type TmcutClipFadeEdge = 'in' | 'out'
export type CoreFadeClip = TmcutTimelineClip | {
  timeline: { start?: number, duration: number }
  speed?: number
  volume?: number
  fade?: { in: number, out: number }
} | {
  /** Legacy v1 flat item: source range in SECONDS. */
  in: number
  out: number
  speed?: number
  volume?: number
  fade?: { in: number, out: number }
} | null | undefined
export function fadeDuration(clip: CoreFadeClip, edge: TmcutClipFadeEdge): number
export function gainAt(clip: CoreFadeClip, atTicks: number): number
// --- R124 A1: track-level audio (CapCut §5.3) ---
// Slice J retired `volumeExpr` (FFmpeg fade expression) and `panFilter`
// (`stereotools` argv). `gainAt` is the live gain law; pan is a documented
// mixer gap in the slice J section of docs/audit/zero-ffmpeg-audit.md.
export function isTrackMuted(track: { muted?: boolean } | null | undefined): boolean

// --- Zero-FFmpeg G3/G4: which layers make sound at one tick, and their time ---
export interface CoreAudioMixSource {
  role: 'footage' | 'audio'
  clipId: string
  trackId: string | null
  trackIndex: number
  /** Linear gain 0..1 — core's layer volume, with the track's mute folded in. */
  gain: number
  /** Position inside the clip's own file, in ticks — the evaluator's `sourceTicks`. */
  mediaTicks: number | null
  /** The rate its media element must run at, already inside the element's window. */
  rate: number
  /** False when no media element can play this source at all. */
  plays: boolean
  /** Why `plays` is false, so a silent skip on screen is a named refusal. */
  refusal: 'reverse' | null
}
export function audioMixAt(
  evaluation: CoreTimelineEvaluation | null | undefined,
  options?: { shuttle?: number }
): {
  at: number
  sources: CoreAudioMixSource[]
}

// --- Frame plan: filmstrip / thumbnail timestamps (Roadmap C14) ---
// Core maths tick lists; since slice D it also owns the identity of one frame
// request, so no host can name a frame its own way.
export function filmstripTimes(startTicks: number, durationTicks: number, count: number): number[]
export function frameTimesForSegments(
  segments: Array<TmcutTimelineClip | {
    /** Legacy v1 flat item: offset/in/out in SECONDS. */
    id: string | number
    offset: number
    in: number
    out: number
    speed?: number
  }>,
  perSegment: number
): Array<{ id: string | number, times: number[] }>
export function clampFrameTime(atTicks: number, startTicks: number, durationTicks: number): number

// --- Frame requests: one instant, one revision, one decoder ask (slice D) ---
/** Ceiling for an ask when the duration is not known: a day, not forever. */
export const TMCUT_FRAME_MAX_TIME_SEC: number
/** How many decoded frames the app may hold before the oldest is released. */
export const TMCUT_FRAME_CACHE_MAX_ENTRIES: number
/** How many frames one host may decode at a time — the same bound on both. */
export const TMCUT_FRAME_MAX_CONCURRENT: number
/** One decoded frame the app is holding: which request it answers, when it was last shown. */
export interface TmcutFrameCacheEntry {
  key: string
  accessedAt: number
}
/** The answer to "what may the frame cache keep". */
export interface TmcutFrameCachePlan {
  /** Keys to release, invalid entries first, then least recently used. */
  drop: string[]
  /** Entries that fit, oldest first. */
  keep: TmcutFrameCacheEntry[]
  /** How many entries `keep` holds. */
  kept: number
  /** Keys that cannot name a frame; reported so the caller can clean them. */
  invalid: string[]
}
/** One slot's right to paint: the token this ask got and the one it retired. */
export interface TmcutFrameSlotLedger {
  begin(slot: string, key: string): { token: number, superseded: number | null }
  isCurrent(slot: string, token: number): boolean
  forget(slot: string): boolean
  /** Hand back a slot only if this token is still the one recorded for it. */
  release(slot: string, token: number): boolean
  /** Hand every slot back: the session that owned them all is over. */
  clear(): number
  size(): number
}
/** The millisecond a request is made at; a negative or unusable ask is a refusal. */
export function frameRequestMillis(atSec: number): number | null
/** The pixel width asked for, clamped to what a decoder is worth bothering. */
export function frameRequestWidth(width?: number): number
/** A cached frame is named by exactly one request — nothing else may be shown. */
export function isFrameCacheKey(key: unknown): boolean
/** The one name both hosts give the same frame: revision, instant, size. */
export function frameRequestKey(
  fingerprint: string | null | undefined,
  atSec: number,
  width?: number
): string | null
/** Where to actually ask the decoder, inside the media it has. */
export function frameTimeWithinMedia(
  atSec: number,
  durationSec: number | null | undefined,
  maxSec?: number
): number | null
/** Who is still allowed to paint, per slot: only the newest request. */
export function createFrameSlotLedger(): TmcutFrameSlotLedger
/** Which cached frames to release so at most `maxEntries` remain. */
export function planFrameCacheEviction(entries: TmcutFrameCacheEntry[], maxEntries: number): TmcutFrameCachePlan

// --- Detection: what decoded samples mean (slice E) ---
// AutoCut's two questions — where does the camera cut, where is the track
// quiet — used to be answered only by FFmpeg's stderr. The laws below own the
// numbers, so a frame scan and a PCM scan cannot decide separately what a cut or
// silence is. Times are SECONDS, like the EDL; ticks are the app's boundary.
/** The cut score, calibrated on measured content — see detection.mjs. */
export const TMCUT_SCENE_THRESHOLD: number
/** Looks per second a shot can be found at. */
export const TMCUT_SCENE_SAMPLE_HZ: number
/** Quiet, in dBFS. */
export const TMCUT_SILENCE_NOISE_DB: number
/** How long quiet must last to count. */
export const TMCUT_SILENCE_MIN_DURATION_SEC: number
/** How wide one level window is — 20 ms, measured on real voice. */
export const TMCUT_SILENCE_WINDOW_SEC: number
/** The level digital silence gets, because a logarithm has no value for it. */
export const TMCUT_SILENCE_FLOOR_DBFS: number
/** The instants a scene scan looks at, planned by the C14 strip law. */
export function sceneSampleTimes(startTicks: number, durationTicks: number, sampleHz?: number): number[]
/** Cells per side of the luma grid a shot score compares. */
export const TMCUT_SCENE_GRID_CELLS: number
/** One pixel to BT.601 luma, 0..255, or NaN when a channel is not a number. */
export function lumaOf(red: number, green: number, blue: number): number
/** RGBA bytes of one frame, block-averaged to `cells` per side; [] when they are not all there. */
export function lumaCells(
  rgba: ArrayLike<number> | null | undefined,
  width: number,
  height: number,
  cells?: number
): number[]
/** Mean luma change of two grids, 0..1; null when they are not comparable. */
export function sceneScore(previous: ArrayLike<number> | null | undefined, next: ArrayLike<number> | null | undefined): number | null
/** The instants of the adjacent pairs a scan scores as a cut; [] when a sample is missing. */
export function sceneCuts(
  times: ArrayLike<number> | null | undefined,
  grids: Array<ArrayLike<number> | null | undefined> | null | undefined,
  options?: { threshold?: number }
): number[]
/** Cut instants to shots, ending at `durationSec` (or the last cut if unknown). */
export function cutsToShots(
  cutSeconds: ArrayLike<number>,
  durationSec: number,
  options?: { minGapSec?: number, minShotSec?: number }
): CoreSceneSegment[]
/** The magnitude of one window of PCM — peak or RMS — as dBFS. */
export function dbfsOf(magnitude: number): number
/** One dBFS level per window of PCM: its loudest single sample, short tail included. */
export function peakLevelSeries(samples: ArrayLike<number>, sampleRate: number, windowSec?: number): number[]
/** One peak dBFS level per window, taken from the loudest channel of PCM. */
export function loudestPeakSeries(
  channels: ArrayLike<ArrayLike<number> | null | undefined> | null | undefined,
  sampleRate: number,
  windowSec?: number
): number[]
/** Leading samples of a decoded PCM run that fall before the asked start; 0 when unusable. */
export function pcmHeadTrim(askedSec: number, deliveredSec: number, sampleRate: number): number
/** Quiet runs from a level series, reported in source seconds from `offsetSec`. */
export function silenceSpans(
  levels: ArrayLike<number>,
  options?: { windowSec?: number, noiseDb?: number, minDurationSec?: number, durationSec?: number, offsetSec?: number }
): CoreSilenceRange[]

export function createSelection(ids?: Array<string | unknown>): string[]
export function toggleSelected(selection: string[], id: string): string[]
export function selectAllClips(timeline: TmcutTimeline): string[]
export function selectTrackClips(timeline: TmcutTimeline, trackId: string): string[]
export function expandRelated(timeline: TmcutTimeline, ids: string[]): string[]
export function groupClips(timeline: TmcutTimeline, ids: string[]): string | null
export function ungroupClips(timeline: TmcutTimeline, ids: string[]): number
export function resolveClips(timeline: TmcutTimeline, ids: string[]): Array<{ track: TmcutTrack, index: number, clip: TmcutTimelineClip }>

export function addMarker(timeline: TmcutTimeline, atTicks: number, options?: { id?: string, label?: string, color?: string }): TmcutMarker
export function removeMarker(timeline: TmcutTimeline, markerId: string): boolean
export function moveMarker(timeline: TmcutTimeline, markerId: string, atTicks: number): boolean
export function markersInRange(timeline: TmcutTimeline, fromTicks: number, toTicks: number): TmcutMarker[]

export function moveClips(timeline: TmcutTimeline, ids: string[], deltaTicks: number): { moved: number, skippedLocked: number }
export function duplicateClips(timeline: TmcutTimeline, ids: string[], atTicks?: number): TmcutTimelineClip[]
export function copyClips(timeline: TmcutTimeline, ids: string[]): CoreClipboard | null
export function pasteClips(timeline: TmcutTimeline, clipboard: CoreClipboard, atTicks: number): string[]
export function rippleDelete(timeline: TmcutTimeline, clipId: string, options?: { acrossTracks?: boolean }): number | null
export function insertClipRipple(timeline: TmcutTimeline, trackType: TmcutTrackType, partial: Partial<TmcutTimelineClip>, atTicks: number, options?: { acrossTracks?: boolean }): { clip: TmcutTimelineClip, shifted: number } | null
export function closeGaps(timeline: TmcutTimeline, options?: { acrossTracks?: boolean, trackType?: TmcutTrackType }): number
export function snapTime(timeline: TmcutTimeline, targetTicks: number, options?: { thresholdTicks?: number, playheadTicks?: number, ignoreIds?: string[] }): number
export function snapTimeDetailed(timeline: TmcutTimeline, targetTicks: number, options?: { thresholdTicks?: number, playheadTicks?: number, ignoreIds?: string[] }): {
  ticks: number
  snapped: { ticks: number, kind: 'zero' | 'playhead' | 'clip-start' | 'clip-end' | 'marker', fromId?: string } | null
}

export function registerAsset(registry: CoreAssetRecord[], input?: Partial<CoreAssetRecord> & { path?: string }): CoreAssetRecord
export function getAsset(registry: CoreAssetRecord[], id: string): CoreAssetRecord | null
export function findAssetByPath(registry: CoreAssetRecord[], path: unknown): CoreAssetRecord | null
export function attachMetadata(registry: CoreAssetRecord[], id: string, metadata?: Partial<CoreAssetRecord>): boolean
export function relinkAsset(registry: CoreAssetRecord[], id: string, locator: CoreAssetRecord['locator']): CoreAssetRecord | null
export function removeAsset(registry: CoreAssetRecord[], id: string): boolean
export function listAssets(registry: CoreAssetRecord[], kind?: CoreAssetKind): CoreAssetRecord[]

export const MEDIA_WARNING_SEVERITY: Record<string, 'info' | 'warning' | 'error'>

export function pickDuration(
  descriptor: TmcutProbeDescriptor,
  trackDurations: number[]
): { duration?: number, durationSource: TmcutDurationSource, mismatchSec: number }
export function buildFrameRate(track?: TmcutProbeVideoTrack | null): TmcutFrameRateInfo | undefined
export function buildCompatibility(input: {
  kind: TmcutMediaInfo['kind']
  demuxable: boolean
  videoTracks: TmcutVideoTrackInfo[]
  audioTracks: TmcutAudioTrackInfo[]
  seekable?: boolean
  still?: TmcutStillInfo
}): TmcutMediaCompatibility
export function buildMediaInfo(descriptor: TmcutProbeDescriptor): TmcutMediaInfo
export function classifyImportStatus(info?: TmcutMediaInfo | null): TmcutImportStatus
export function mediaInfoToMetadata(info?: TmcutMediaInfo | null): TmcutMediaMetadata | null
export function buildMediaCapabilities(raw?: Partial<TmcutMediaCapabilities> | null): TmcutMediaCapabilities

export function v1ClipToV3(item: CoreV1TrackItem, trackType: CoreTrackType): TmcutTimelineClip
export function v1TracksToV3(tracks: CoreV1Track[]): TmcutTimeline
export function v3ClipToV1(clip: TmcutTimelineClip): CoreV1TrackItem
export function v1MatchesV3(item: CoreV1TrackItem, clip: TmcutTimelineClip): boolean
export function syncV3Result(v1Tracks: CoreV1Track[], afterV3: TmcutTimeline): CoreV3SyncStats

/**
 * C16-R3 ticks-native bridge (the live-store path). Same structural rules
 * as the seconds bridge above, but the flat item's `in`/`out`/`offset`
 * are integer TICKS — so the per-edit conversion is a lossless identity
 * on time fields. The seconds versions remain for FILE MIGRATION only.
 */
export function ticksClipToV3(item: CoreV1TrackItem, trackType: CoreTrackType): TmcutTimelineClip
export function ticksTracksToV3(tracks: CoreV1Track[]): TmcutTimeline
export function v3ClipToTicks(clip: TmcutTimelineClip): CoreV1TrackItem
export function ticksMatchesV3(item: CoreV1TrackItem, clip: TmcutTimelineClip): boolean
export function syncTicksResult(v1Tracks: CoreV1Track[], afterV3: TmcutTimeline): CoreV3SyncStats

// Slice J retired the ffprobe-JSON normalizer and the FFmpeg stderr readers.
// Probed media flows through mediaInfo.mjs (buildMediaInfo); cut instants come
// from detection.mjs (`sceneCuts` + `cutsToShots`).
export function overlapDuration(start: number, end: number, ranges?: Array<{ start: number, end: number }>): number
export interface CoreTranscriptItem {
  start: number
  end: number
  text?: string
}

export const DEFAULT_FILLER_WORDS: string[]

export function detectFillerWords(text: unknown, options?: { customWords?: string[] }): {
  count: number
  words: string[]
  fillerRatio: number
}

export function analyzeTranscriptSegment(text: unknown, options?: {
  filterFillerWords?: boolean
  keywords?: string[]
  customFillerWords?: string[]
}): {
  isFiller: boolean
  isHighlight: boolean
  scoreModifier: number
  matchedKeywords: string[]
  detectedFillers: string[]
}

export function scoreSegments(input: {
  scenes?: CoreSceneSegment[]
  silences?: CoreSilenceRange[]
  speech?: CoreSpeechRange[]
  transcript?: CoreTranscriptItem[]
  profile?: string
  assetId?: string
  analyzerVersion?: string
  filterFillerWords?: boolean
  keywords?: string[]
  customFillerWords?: string[]
  /** AI content-triage opinions (docs §194); blended conservatively with aiWeight. */
  aiScores?: Array<{ start: number, end: number, interest: number }>
  aiWeight?: number
}): TmcutEdl

/** Beat-weighted average AI interest over a span; null when no overlap. */
export function blendSceneInterest(
  scene: { start: number, end: number },
  aiScores: Array<{ start: number, end: number, interest: number }>
): number | null

export interface TmcutCanvasPresetDef {
  id: string
  width: number
  height: number
  orientation: TmcutOrientation
  icon: string
}

export interface TmcutSocialPresetDef {
  id: string
  presetId: string
  icon: string
}

export const TMUTCANVAS_PRESETS: TmcutCanvasPresetDef[]
export const TMUTCUT_SOCIAL_PRESETS: TmcutSocialPresetDef[]
export const TMUTCUT_FIT_MODES: TmcutFitMode[]

export function aspectValue(width: number, height: number): number
export function orientationOf(width: number, height: number): TmcutOrientation
export function findCanvasPreset(id: string): TmcutCanvasPresetDef | null
export function findCanvasPresetByDimensions(width: number, height: number): TmcutCanvasPresetDef | null
export function ratioIdOf(width: number, height: number): string
export function ratioLabel(width: number, height: number): string
export function normalizeCanvas(canvas: unknown): TmcutCanvas
export function computeFitObjectStyle(mode: string, focusX?: number, focusY?: number, cropRect?: { x: number, y: number, w: number, h: number } | null): { objectFit: 'contain' | 'cover' | 'fill', objectPosition: string }

/**
 * Media placement resolved from a stored clip (V4 M3): the defaults the
 * preview fit adapter already assumes, so the evaluator's layer and the
 * render plate cannot disagree on fit, focus or crop. `cropRect` comes back
 * as stored.
 */
export function resolveClipLayout(clip: { fit?: string | null, focusX?: number, focusY?: number, cropRect?: TmcutCropRect | null } | null | undefined): CoreEvaluatedLayout

export function reframeTransform(x: number, y: number, fromW: number, fromH: number, toW: number, toH: number): { x: number, y: number }
export function previewScale(containerWidth: number, canvasWidth: number): number

// --- Safe areas + frame guides (Roadmap C13) ---
export interface TmcutSafeRect {
  /** centered fractions of the frame (0..1) */
  x: number
  y: number
  w: number
  h: number
}
export function safeAreaRects(canvas: { width?: number, height?: number } | null | undefined): {
  actionSafe: TmcutSafeRect
  titleSafe: TmcutSafeRect
}
export const SAFE_AREA_PRESETS: Array<{ id: string, label: string, ratio: number }>

// --- Canvas Crop & Mask (Roadmap F-3) ---
export interface TmcutCropRatioPreset {
  id: string
  label: string
  ratio: number | null
}
export const CROP_RATIO_PRESETS: TmcutCropRatioPreset[]
export function clampCropRect(rect: unknown, minSize?: number): TmcutCropRect
export function applyCropRatio(rect: unknown, ratio: number | null | undefined, sourceW?: number, sourceH?: number): TmcutCropRect

// --- Canvas Background (Phase 4) ---
//
// Slice J retired the FFmpeg background descriptor and still-input argv
// emitters. What remains is the semantic answer a painter needs:
// `encodeCanvasFill` (exportContent.mjs) names the fill colour one painted
// frame starts from, or `null` when no colour paints the background
// correctly (transparent, or a real image).

// --- Keyframes (Roadmap C3) ---
export type TmcutKeyframeEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'step'

/** All supported keyframe easings (Roadmap C3). */
export const KEYFRAME_EASINGS: TmcutKeyframeEasing[]

export interface TmcutKeyframe {
  /** Timeline ticks (TICKS_PER_SECOND =120000). */
  t: number
  /** Animated property name (e.g. 'scale', 'x', 'y', 'opacity', 'volume'). */
  prop: string
  value: number
  /** Segment FROM this keyframe to the next one. Default 'linear'. */
  easing?: TmcutKeyframeEasing
}

export function evalKeyframe(clip: { keyframes?: TmcutKeyframe[] } | null | undefined, prop: string, atTicks: number): number | undefined
export function keyframeAt(clip: { keyframes?: TmcutKeyframe[] } | null | undefined, prop: string, atTicks: number, toleranceTicks?: number): TmcutKeyframe | null
export function setKeyframe(clip: { keyframes?: TmcutKeyframe[] } | null | undefined, prop: string, atTicks: number, value: number, easing?: TmcutKeyframeEasing): TmcutKeyframe | null
export function removeKeyframe(clip: { keyframes?: TmcutKeyframe[] } | null | undefined, prop: string, atTicks: number, toleranceTicks?: number): boolean
export function propsWithKeyframes(clip: { keyframes?: TmcutKeyframe[] } | null | undefined): string[]
export function keyframeTimes(clip: { keyframes?: TmcutKeyframe[] } | null | undefined, prop: string): number[]

// --- Masks (R124 A3, CapCut 5.7) ---
export type TmcutMaskShape = 'rectangle' | 'circle' | 'linear'
export type TmcutMaskAxis = 'x' | 'y'

export const TMUTCUT_MASK_SHAPES: TmcutMaskShape[]

/** Full normalized mask geometry. `x/y/w/h` are 0..1 of the clip frame. */
export interface TmcutMask {
  shape: TmcutMaskShape
  x: number
  y: number
  w: number
  h: number
  /** Soft-edge width 0..100 (0 = hard border). */
  feather: number
  /** Degrees around the box center, -180..180. */
  rotation: number
  /** Show OUTSIDE the shape instead of inside. */
  invert: boolean
  /** 'linear' only: axis the gradient runs along. */
  axis: TmcutMaskAxis
}

/** Partial mask as stored on a clip; null shape or absent mask = no mask. */
export type TmcutMaskInput = Partial<TmcutMask> & { shape: TmcutMaskShape }

/** Sanitized geometry or null when the mask is absent/unknown shape. */
export function normalizeMask(mask: (Partial<TmcutMask> & { shape?: string | null }) | null | undefined): TmcutMask | null

/**
 * CSS `mask-image` SVG data-URI for the browser preview (authored in the
 * given pixel aspect so rotation is not distorted). Null without a mask.
 */
export function maskCssMaskImage(mask: (Partial<TmcutMask> & { shape?: string | null }) | null | undefined, wPx?: number, hPx?: number): string | null

// --- Text style law (V4 Phase 2, closes the last app-side copy) ---
// One set of pixel numbers the preview's CSS overlay reads. The exporter
// refuses text clips by name (slice J), so no second syntax exists.

/** Font size used when a text clip carries none. */
export const DEFAULT_TEXT_FONT_SIZE: number

/** Glyph colour used when a text clip carries none. */
export const DEFAULT_TEXT_COLOR: string

/** Stroke width in px — the CSS text stroke. */
export function textStrokeWidth(fontSize: number): number

/** Shadow offset in px — the CSS text-shadow. */
export function textShadowOffset(fontSize: number): number

/** Plate padding in px — the CSS plate padding. */
export function textBoxPadding(fontSize: number): number

// --- Sticker catalog (R124 A6, CapCut §3.4) ---
// Curated emoji groups rendered as text-track graphic layers.
export interface TmcutStickerGroup { id: string, emojis: string[] }
export const STICKER_GROUPS: TmcutStickerGroup[]
export function allStickers(): string[]
export function stickerMatches(query: string | null | undefined, emoji: string): boolean

// --- Transitions: overlap model (Roadmap C5) ---
// `transitionIn.duration` is TIMELINE TICKS (120000/s); applying shifts the
// clip left by that amount so its head overlaps the neighbor's tail.
export type TmcutTransitionReason = 'no-neighbor' | 'gap' | 'too-long' | 'unknown-type' | 'locked'

export interface TmcutTransitionCheck {
  ok: boolean
  reason?: TmcutTransitionReason
  /** Echoes the requested duration when ok. */
  overlapTicks?: number
}

export interface TmcutTransitionWindow {
  fromId: string
  toId: string
  startTicks: number
  endTicks: number
}

export const KNOWN_TRANSITIONS: string[]
export function canApplyTransition(timeline: TmcutTimeline, clipId: string, type: string, durationTicks: number): TmcutTransitionCheck
export function applyTransition(timeline: TmcutTimeline, clipId: string, type: string, durationTicks: number): boolean
export function clearTransition(timeline: TmcutTimeline, clipId: string): boolean
/**
 * Overlap windows of one track. Spans go through `clipSpan`, so the app store's
 * flat clips (no `timeline`/`source`, just `offset` + `in`/`out`/`speed`)
 * resolve exactly like DSL v3 ones — which is why `items` stays opaque here.
 * The export compiler and the evaluator must read adjacency through this one
 * call: the rule (a 1 ms tolerance over the 1e-4 s position grid) lives only in
 * `transitions.mjs`.
 */
export function transitionWindows(
  track: TmcutTrack | { items?: readonly unknown[] } | null | undefined
): TmcutTransitionWindow[]

// --- Transitions: preview geometry (V4 G16) ---
// The numbers below are MEASURED against the bundled FFmpeg (solid-plate
// renders of every xfade key), not chosen. The preview player applies the CSS
// this section returns and makes no geometry decision of its own. `comb` is the
// striped family: the four `*slice` keys cut the plate into ten teeth whose fills
// are set by one travelling band, so their rows are not wipes.
export type TmcutXfadeShape
  = 'crossfade' | 'wipe' | 'softwipe' | 'slide' | 'squeeze' | 'diag' | 'band' | 'comb'
    | 'corner' | 'iris' | 'hole' | 'rect' | 'pie'
export type TmcutXfadeFidelity = 'exact' | 'shape' | 'approximate'

/** How far a shape has travelled at progress p (0 = outgoing whole, 1 = incoming). */
export const XFADE_POSITION_LAWS: Record<string, (p: number) => number>
/** Tooth period of the slice family, as a fraction of the axis (ten teeth). */
export const XFADE_COMB_PERIOD: number
/** Shape + law + fidelity per xfade key; every `KNOWN_TRANSITIONS` member has one. */
export const XFADE_PREVIEW: Record<string, {
  shape: TmcutXfadeShape
  law: string
  fidelity: TmcutXfadeFidelity
  note?: string
  from?: string
  travel?: string
  mode?: string
  tint?: string
  /** Two-phase window over the black canvas: the outgoing shrinks, then the incoming grows. */
  crop?: boolean
}>

export interface TmcutPreviewLayerStyle {
  opacity: number
  clipPath?: string
  transform?: string
  maskImage?: string
  webkitMaskImage?: string
  maskSize?: string
  webkitMaskSize?: string
  maskRepeat?: string
  webkitMaskRepeat?: string
}

export interface TmcutPreviewRamp {
  shape: TmcutXfadeShape
  law: string
  fidelity: TmcutXfadeFidelity
  note: string | null
  /** What the law produced for this progress. */
  travel: number
  /**
   * Covered fraction of the box, i.e. the area the CSS shape really keeps
   * (`travel` squared for `diag` and `rect`); null when it depends on the
   * canvas aspect.
   */
  coverage: number | null
  progress: number
  incoming: TmcutPreviewLayerStyle
  outgoing: TmcutPreviewLayerStyle
}

/**
 * The preview face of one xfade key at `p`. The incoming layer carries the
 * reveal (the player paints it OVER the outgoing one, so clipping the outgoing
 * would only uncover the canvas behind it); `slide` moves both layers.
 */
export function previewTransitionRamp(type: string, p: number): TmcutPreviewRamp

// --- Retime: speed/reverse time map (Roadmap C4) ---
// All clip fields and arguments are in TIMELINE TICKS (120000/s).
export function validateSpeed(speed?: number): number
export function isRetimed(clip: { speed?: number, reverse?: boolean } | null | undefined): boolean
export function timelineToSource(clip: { in?: number, out?: number, speed?: number, reverse?: boolean } | null | undefined, atTicks: number): number
export function sourceToTimeline(clip: { in?: number, out?: number, speed?: number, reverse?: boolean } | null | undefined, sourceTicks: number): number
export function withSpeed<T extends { in?: number, out?: number, speed?: number }>(clip: T | null | undefined, speed: number): T & { speed: number, out: number }
// Speed ramping (R124 A4): clip-local TICKS control points; speedPoints
// turns `speed` into a piecewise-linear curve. Times are timeline ticks.
export interface TmcutSpeedPoint { t: number, speed: number }
export function isRamped(clip: { speedPoints?: TmcutSpeedPoint[] | null } | null | undefined): boolean
export function speedAt(clip: { speed?: number, speedPoints?: TmcutSpeedPoint[] | null } | null | undefined, atTicks: number): number
// Zero-FFmpeg G4: the rate a media element runs at. One law for both legs, so
// the sound cannot be retimed apart from the picture at the same tick.
export const ELEMENT_RATE_MIN: number
export const ELEMENT_RATE_MAX: number
export function clampedElementRate(rate: number, shuttle?: number): number
export function elementRate(clip: { speed?: number, speedPoints?: TmcutSpeedPoint[] | null } | null | undefined, atTicks: number, shuttle?: number): number
export function rampIntegral(clip: { speed?: number, speedPoints?: TmcutSpeedPoint[] | null } | null | undefined, toTicks: number): number
export function rampTimelineToSource(clip: { in?: number, out?: number, speed?: number, reverse?: boolean, speedPoints?: TmcutSpeedPoint[] | null } | null | undefined, atTicks: number): number
export const SPEED_RAMP_PRESETS: string[]
export function buildRampPreset(kind: string, durationTicks: number, baseSpeed?: number): TmcutSpeedPoint[]
// V4 G5 follow-up: a split inherits the time map. `in`/`out` of each half are
// SOURCE ticks; `speed` is that half's own mean, which is what keeps its
// derived length (span/speed) on the cut the user asked for.
export interface TmcutSplitHalf { in: number, out: number, speed: number, speedPoints: TmcutSpeedPoint[] | null }
export function splitSpeedPoints(points: TmcutSpeedPoint[] | null | undefined, cutTicks: number): { head: TmcutSpeedPoint[], tail: TmcutSpeedPoint[] }
export function splitRamp(clip: { in?: number, out?: number, speed?: number, reverse?: boolean, speedPoints?: TmcutSpeedPoint[] | null } | null | undefined, elapsedTicks: number): { boundary: number, consumed: number, head: TmcutSplitHalf, tail: TmcutSplitHalf }
// V4 ADR-027: trim = a split whose discarded half is thrown away.
// `rampElapsedForConsumed` inverts `rampIntegral` (source ticks -> timeline
// ticks). `trimRamp.shiftTicks` is how far the CLIP must move: nonzero only
// when the removed content plays first.
export function rampElapsedForConsumed(clip: { speed?: number, speedPoints?: TmcutSpeedPoint[] | null } | null | undefined, consumedTicks: number): number
export function trimRamp(clip: { in?: number, out?: number, speed?: number, reverse?: boolean, speedPoints?: TmcutSpeedPoint[] | null } | null | undefined, edge: 'in' | 'out', targetTicks: number): TmcutSplitHalf & { shiftTicks: number }

// --- Effects registry + normalize (Roadmap C6) ---
// First wave: blur, sharpen, vignette, grain, chromakey, lut3d, stabilize,
// eq-grade. `renderReady` stays false until the export compiler maps the
// effect (R4) — consumers show a truthful "not exported yet" badge.
export type TmcutEffectParamKind = 'number' | 'color' | 'enum' | 'bool'

export interface TmcutEffectParam {
  name: string
  kind: TmcutEffectParamKind
  /** number params: inclusive range. */
  min?: number
  max?: number
  /** Applied by normalizeEffects for missing/invalid values. */
  default?: number | string | boolean
  /** enum params: allowed values. */
  options?: string[]
}

/** Declared preview behaviour of a definition (Roadmap v1 §5.1 / §5.6). */
export interface TmcutEffectPreview {
  /** How the UI renders the preview. `css` is a browser approximation. */
  strategy: 'css'
  /**
   * `exact` — the preview performs the same pixel operation as the export.
   * `approximate` — same visual intent, different maths.
   * `illustrative` — hints at the effect only; it is NOT what the export does.
   */
  fidelity: 'exact' | 'approximate' | 'illustrative'
  /**
   * True when this effect's CSS overlay IS what the export bakes into the
   * layer, so a live preview may paint it on its own row. Absent means the
   * overlay only hints (a tile device) or the effect has no overlay at all.
   */
  layerOverlay?: boolean
}

export interface TmcutEffectDescriptor {
  type: string
  /** English constant label; UIs translate by `type` instead. */
  label: string
  params: TmcutEffectParam[]
  /** Definition completeness: the registry ships a full semantic face (params + preview + grade ops). Not a promise the file export bakes it — `planEncodeContent` decides that separately. */
  renderReady: boolean
  /** Registry bucket used by the library panels; missing means `other`. */
  category?: string
  /** Preview contract — the UI must read fidelity from here, not its own table. */
  preview: TmcutEffectPreview
}

export const EFFECT_REGISTRY: Record<string, TmcutEffectDescriptor>
export function validateEffect(effect: unknown): string[]
export function normalizeEffects(list: unknown): TmcutClipEffect[]
/** Capability matrix for one effect; null for an unregistered type. */
export function fxCapabilities(type: string): {
  fidelity: TmcutEffectPreview['fidelity']
  strategy: TmcutEffectPreview['strategy']
  /** Whether this effect's overlay face may plate a live layer (never undefined). */
  layerOverlay: boolean
  exportSupported: boolean
  label: string
  category: string
} | null
/** Coerce one raw param value into registry bounds; undefined when unknown. */
export function clampEffectParam(type: string, name: string, raw: unknown): unknown

/** One semantic grade instruction (slice J): a typed op a renderer consumes directly, never FFmpeg text. */
export type TmcutGradeOp =
  | { op: 'balance', rs?: number, gs?: number, bs?: number, rm?: number, gm?: number, bm?: number, rh?: number, gh?: number, bh?: number }
  | { op: 'eq', brightness?: number, contrast?: number, saturation?: number }
  | { op: 'curves', preset: 'lighter' | 'medium_contrast' | 'strong_contrast' | 'cross_process' }
  | { op: 'desaturate' }
  | { op: 'sepia' }
  | { op: 'grain', amount: number }
/** Ordered semantic grade of one lut3d preset; null for an unknown id or the `neutral` no-op. */
export function lutGrade(preset: string): TmcutGradeOp[] | null

// Slice J retired the vidstab argv planners with the FFmpeg engine; the
// `stabilize` clip flags survive as stored data, and the exporter refuses such
// clips by name (planEncodeContent -> 'stabilize').

export interface TmcutMediaFolder {
  id: string
  name: string
  color?: string
  projectId?: string | null
  createdAt?: number | string
}

export interface TmcutFolderCounts {
  total: number
  unassigned: number
  [key: string]: number
}

export const FOLDER_TAG_COLORS: string[]
export function createFolder(folders: TmcutMediaFolder[], input?: Partial<TmcutMediaFolder>): TmcutMediaFolder
export function renameFolder(folders: TmcutMediaFolder[], folderId: string, newName: string): boolean
export function updateFolderColor(folders: TmcutMediaFolder[], folderId: string, color: string): boolean
export function removeFolder(folders: TmcutMediaFolder[], folderId: string): boolean
export function getFolder(folders: TmcutMediaFolder[], folderId: string): TmcutMediaFolder | null
export function setAssetFolder<T extends object>(asset: T, folderId: string | null, projectId?: string): boolean
export function getAssetFolder<T extends object>(asset: T, projectId?: string): string | null
export function filterAssetsByFolder<T extends object>(assets: T[], folderId?: string | null, projectId?: string): T[]
export function getFolderCounts<T extends object>(folders: TmcutMediaFolder[], assets: T[], projectId?: string): TmcutFolderCounts

// --- On-demand Asset Center (Roadmap v3 PART A) ---
// Pure data model + queue state machine. Runtime adapters (Electron IPC)
// do the downloading and file I/O; this module owns the state machine so
// it can be unit-tested in plain Node. No Electron, no Node fs, no fetch.
export const ASSET_CENTER_SCHEMA_VERSION: number

export type AssetCenterInstallState = 'catalog' | 'downloading' | 'verifying' | 'installed' | 'error'
export type AssetCenterDownloadState = 'queued' | 'active' | 'retrying' | 'done' | 'failed' | 'cancelled'
export type AssetCenterLicenseStatus = 'approved' | 'review' | 'unknown'

export interface AssetCenterLicenseReviewRecord {
  decision: 'approved' | 'rejected'
  by: string
  at: string | null
  note: string
}

export interface AssetCenterLicense {
  status: AssetCenterLicenseStatus
  name: string
  url: string
  attribution: string
  commercialUse: boolean
  redistrbutable: boolean
  territories: string[]
  expiresAt: string | null
  proof: string
  reviewer: string | null
  reviewedAt: string | null
  review: AssetCenterLicenseReviewRecord | null
}

export type AssetCenterSource
  = | { type: 'remote', url: string }
    | { type: 'sample', sampleId: string }
    | { type: 'embedded', payload: Record<string, unknown> | null }

export type AssetCenterAssetKind = 'media' | 'effect-preset' | 'title-preset'

export interface AssetCenterCatalogEntry {
  schemaVersion: number
  id: string
  title: string
  description: string
  category: string
  assetKind: AssetCenterAssetKind
  tags: string[]
  version: string
  sizeBytes: number
  sha256: string
  sourceUrl: string
  source: AssetCenterSource
  previewRef: string | null
  creator: string
  priceUsd: number
  salesChannel: string
  license: AssetCenterLicense
}

export interface AssetCenterInstalledAsset {
  entryId: string
  version: string
  state: AssetCenterInstallState
  installedAt: string | null
  dir: string
  files: string[]
  sizeBytes: number
  verified: boolean
  sha256?: string
  reason?: string | null
}

export interface AssetCenterInstallGate {
  allowed: boolean
  reason: string | null
}

export interface AssetCenterJob {
  id: string
  entryId: string
  version: string
  url: string
  sha256: string
  sizeBytes: number
  state: AssetCenterDownloadState
  progress: { loaded: number, total: number, percent: number }
  attempts: number
  maxRetries: number
  delayMs: number
  reason: string | null
}

export interface AssetCenterQueueSnapshot {
  enqueue: (entry: AssetCenterCatalogEntry) => AssetCenterJob
  startNext: () => AssetCenterJob | null
  armRetry: (jobId: string) => AssetCenterJob | null
  reportProgress: (jobId: string, loaded: number, total?: number) => AssetCenterJob | null
  reportResult: (jobId: string, args: { ok: boolean, error?: string | null, verified: boolean }) => AssetCenterJob | null
  cancel: (jobId: string) => AssetCenterJob | null
  snapshot: () => AssetCenterJob[]
  pendingCount: () => number
  readonly concurrency: number
}

export interface AssetCenterStorageReport {
  totalBytes: number
  usableBytes: number
  orphanBytes: number
  reclaimableBytes: number
  reclaimableIds: string[]
  quotaBytes: number
  quotaPct: number
}

export function createCatalogEntry(input?: Partial<AssetCenterCatalogEntry>): AssetCenterCatalogEntry
export function canInstall(entry: AssetCenterCatalogEntry | null | undefined, options?: { now?: number, entitlements?: unknown[] | null }): AssetCenterInstallGate
export interface AssetEntitlement {
  entryId: string
  version: string
  grantedAt: string | null
  expiresAt: string | null
  signature: string
}
export const ENTITLEMENT_SCHEMA_VERSION: number
export function parseEntitlements(raw: unknown): AssetEntitlement[]
export function hasLiveEntitlement(entryId: string, version: string | '', entitlements: unknown, now?: number): boolean
export function normalizeLicense(license?: Partial<AssetCenterLicense> | null): AssetCenterLicense
export function createInstalledAsset(input?: Partial<AssetCenterInstalledAsset>): AssetCenterInstalledAsset
export function transitionInstall(record: AssetCenterInstalledAsset, state: AssetCenterInstallState, extra?: Record<string, unknown>): AssetCenterInstalledAsset
export function recoverInstallStates(installed: AssetCenterInstalledAsset[]): AssetCenterInstalledAsset[]
export function createDownloadQueue(options?: {
  concurrency?: number
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  entitlements?: AssetEntitlement[] | null | (() => AssetEntitlement[] | null)
}): AssetCenterQueueSnapshot
export function storageReport(installed: AssetCenterInstalledAsset[], options?: { usedProjectIds?: string[], quotaBytes?: number }): AssetCenterStorageReport

// --- AI Edit Plan (Roadmap v3 PART C) ---
// Closed-vocabulary edit operations. The validator is the security gate
// (no paths, no unknown verbs, media by opaque ref only); the applier runs
// exclusively through core timeline commands.
export const AI_EDIT_PLAN_SCHEMA_VERSION: number
export const EDIT_OPERATION_TYPES: string[]

export interface AiEditOperation {
  type: string
  [key: string]: unknown
}

export interface AiEditPlan {
  schemaVersion?: number
  intentSummary?: string
  assumptions?: string[]
  target?: { durationTicks?: number }
  operations: AiEditOperation[]
}

export interface AiEditPlanCheck {
  valid: boolean
  errors: string[]
}

export function validateEditPlan(plan: unknown, options?: {
  timeline?: unknown
  mediaRefs?: Iterable<string>
}): AiEditPlanCheck

export interface AiEditPlanTraceStep {
  index: number
  type: string
  ok: boolean
  reason: string | null
}

export interface AiEditPlanTrace {
  applied: AiEditPlanTraceStep[]
  skipped: AiEditPlanTraceStep[]
  warnings: string[]
}

export function applyEditPlan(timeline: unknown, plan: AiEditPlan, options?: {
  mediaResolution?: Record<string, { src: string, name?: string }>
  canvas?: { width: number, height: number, fps: number } | null
}): AiEditPlanTrace

export function parseEditPlanReply(text: string, options?: {
  timeline?: unknown
  mediaRefs?: Iterable<string>
}): { ok: boolean, plan?: AiEditPlan, errors?: string[] }

export function summarizeEditPlan(plan: AiEditPlan | null | undefined, labels?: Record<string, string>): string[]

/** Shared fenced/balanced JSON extractor used by both plan parsers. */
export function extractJsonObject(text: string): Record<string, unknown> | null

// --- AI Template Plan (Roadmap v3 §6.5) ---
// add-clip-only plan vocabulary that BUILDS a real template through core
// commands. Output flows through the normal template pipeline.
export const TEMPLATE_PLAN_SCHEMA_VERSION: number

export interface AiTemplatePlanOp {
  type: 'add-clip'
  trackType: 'video' | 'audio' | 'text'
  name?: string
  text?: string
  mediaRef?: string
  in?: number
  out?: number
  offset?: number
  color?: string
  fontSize?: number
  effects?: unknown[]
  [key: string]: unknown
}

export interface AiTemplatePlan {
  schemaVersion?: number
  intentSummary?: string
  template: {
    name: string
    description?: string
    category?: string
    aspectRatio?: string
    width?: number
    height?: number
    fps?: number
  }
  operations: AiTemplatePlanOp[]
}

export function validateTemplatePlan(plan: unknown, options?: {
  mediaRefs?: Iterable<string>
}): { valid: boolean, errors: string[] }

export function parseTemplatePlanReply(text: string, options?: {
  mediaRefs?: Iterable<string>
}): { ok: boolean, plan?: AiTemplatePlan, errors?: string[] }

export function buildTemplateFromPlan(plan: AiTemplatePlan, options?: {
  mediaResolution?: Record<string, { src: string, name?: string }>
  provider?: string | null
  model?: string | null
}): { template: TmcutTemplate, warnings: string[] }

export function summarizeTemplatePlan(plan: AiTemplatePlan | null | undefined): string[]

// --- AutoCut plan bridge (Roadmap v3 Phase 7) ---
// Converts the deterministic AutoCut EDL output into a standard Edit Plan
// so AutoCut and the AI Editor share ONE validated apply path.
export interface AutocutCaptionLine {
  start: number
  end: number
  text?: string
}

export function editPlanFromEdl(
  edl: TmcutEdl,
  segments: TmcutEdlSegment[] | null | undefined,
  options?: {
    mediaRef?: string
    name?: string
    intentSummary?: string
    captions?: AutocutCaptionLine[]
  }
): { plan: AiEditPlan, warnings: string[] }

// --- Audio orchestration (Roadmap v3 Phase 8) ---
// Deterministic planners that turn a timeline shape + rights-cleared audio
// candidates into standard Edit Plan operations (music beds, SFX cues)
// plus the provenance record every audio element must carry.
export interface AudioCandidate {
  mediaRef: string
  name?: string
  source?: string | null
  origin?: 'library' | 'asset-center' | 'generated' | null
  licenseStatus?: 'approved' | 'review' | 'blocked' | 'unknown'
  licenseName?: string
  attribution?: string
  durationTicks?: number
  addedAt?: number
}

export function rankAudioCandidates(
  candidates?: AudioCandidate[],
  options?: { allowGenerated?: boolean }
): AudioCandidate[]

export function planMusicBed(
  candidates: AudioCandidate[],
  context: { durationTicks: number, dialoguePresent?: boolean },
  options?: {
    bedVolume?: number
    fadeInTicks?: number
    fadeOutTicks?: number
  }
): { operations: AiEditOperation[], provenance: Array<Record<string, unknown>> }

export function planSfxCues(
  candidates: AudioCandidate[],
  cues: Array<{ atTicks: number, name?: string }>,
  context: { durationTicks: number },
  options?: { minGapTicks?: number, cueVolume?: number }
): {
  operations: AiEditOperation[]
  provenance: Array<Record<string, unknown>>
  skipped: Array<{ atTicks: number, name: string, reason: string }>
}

export function mergeAudioProvenance(
  existing: Array<Record<string, unknown>> | null | undefined,
  additions: Array<Record<string, unknown>>
): Array<Record<string, unknown>>

// --- Asset takedown & license audit (Roadmap v3 §26, local scope) ---
// Catalog-delivered takedown notices: block installs, audit installed
// copies, never delete user data silently. Registry is plain JSON.
export interface TakedownNotice {
  entryId: string
  reason: 'license-revoked' | 'rights-claim' | 'policy-violation' | 'recall'
  ref: string
  issuedAt: number
  effectiveFrom: number
}

export interface TakedownRegistry {
  schemaVersion: number
  notices: TakedownNotice[]
}

export function normalizeTakedownNotice(input: unknown): TakedownNotice | null
export function parseTakedownRegistry(raw: unknown): TakedownRegistry
export function mergeTakedownRegistry(registry: unknown, incoming: unknown): TakedownRegistry
export function findActiveTakedown(registry: unknown, entryId: string, now?: number): TakedownNotice | null
export function canServeAfterTakedown(
  registry: unknown,
  entryId: string,
  options?: { now?: number }
): { allowed: boolean, reason: string | null, notice: TakedownNotice | null }
export function takedownAudit(
  installed: Array<{ entryId?: string, state?: string }> | null | undefined,
  registry: unknown,
  options?: { now?: number }
): Array<{ entryId: string, state: string, notice: TakedownNotice }>

// --- Catalog admin publishing workflow (Roadmap v3 §26) ---
// Pre-publish validation the app runs on catalog documents, plus the
// human license-review stamp that forms the audit trail.
export const CATALOG_PUBLISH_SCHEMA_VERSION: number
export function validateCatalogEntry(entry: unknown): string[]
export function validateCatalogDocument(doc: unknown): {
  ok: boolean
  errors: string[]
  stats: { entries: number, publishable: number }
}
export function stampLicenseReview(
  entry: AssetCenterCatalogEntry | Record<string, unknown>,
  options: { reviewer: string, reviewedAt?: string, approve: boolean, note?: string, proof?: string }
): AssetCenterCatalogEntry

// --- Generation adapter interface (Roadmap v3 §25 Phase 9) ---
// Contract for image/video generation providers. No provider is implemented
// until its official API is verified (roadmap rule 12).
export interface GenerationCapabilityManifest {
  schemaVersion: number
  providerId: string
  displayName: string
  modalities: ('image' | 'video')[]
  outputFormats: { image: string[], video: string[] }
  maxResolution: { image: { width: number, height: number }, video: { width: number, height: number } }
  maxDurationSec: number
  supportsAsync: boolean
  supportsCancel: boolean
  supportsProgress: boolean
  costModel: 'per-second' | 'per-image' | 'per-credit' | 'subscription'
  estimatedCostPerUnit: number
  costUnit: 'second' | 'image' | 'credit'
  rights: { commercialUse: boolean, attributionRequired: boolean, license: string, redistributable: boolean }
  privacy: { trainsOnUserData: boolean, dataRetentionDays: number, loggingLevel: 'none' | 'metadata' | 'full' }
  rateLimitRpm: number
  verified: boolean
}

export interface GenerationJobInput {
  taskType: 'text-to-image' | 'image-to-image' | 'text-to-video' | 'image-to-video'
  prompt: string
  inputMediaRef: string | null
  params: Record<string, unknown>
  negativePrompt: string
  seed: number | null
}

export interface GenerationJobStatus {
  jobId: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  progress: number
  results: GenerationResult[]
  error: string | null
  etaSec: number | null
  costSoFar: number
}

export interface GenerationResult {
  resultId: string
  type: 'image' | 'video'
  downloadUrl: string
  mimeType: string
  width: number
  height: number
  durationSec: number
  cost: number
  metadata: Record<string, unknown>
}

export interface GenerationCostEstimate {
  estimatedCostUsd: number
  costBreakdown: Record<string, unknown>
  budgetWarning: boolean
}

export interface GenerationAdapter {
  manifest(): GenerationCapabilityManifest
  submitJob(input: GenerationJobInput): Promise<string> // returns jobId
  pollJob(jobId: string): Promise<GenerationJobStatus>
  cancelJob(jobId: string): Promise<boolean>
  downloadResult(jobId: string, destDir: string): Promise<{ files: string[], metadata: GenerationResult[] }>
  estimateCost(input: GenerationJobInput): Promise<GenerationCostEstimate>
}

export function createCapabilityManifest(input?: Record<string, unknown>): GenerationCapabilityManifest
export function validateCapabilityManifest(manifest: unknown): { valid: boolean, errors: string[] }
export function createGenerationJobInput(input?: Record<string, unknown>): GenerationJobInput
export function createJobStatusResponse(input?: Record<string, unknown>): GenerationJobStatus
export function createGenerationResult(input?: Record<string, unknown>): GenerationResult
export function createCostEstimate(input?: Record<string, unknown>): GenerationCostEstimate
export function registerGenerationAdapter(providerId: string, adapter: GenerationAdapter): void
export function getGenerationAdapter(providerId: string): GenerationAdapter | null
export function listGenerationAdapters(): Array<{ providerId: string, manifest: GenerationCapabilityManifest }>
export function isProviderVerified(providerId: string): boolean

export const GENERATION_JOB_STATUS: { pending: 'pending', processing: 'processing', completed: 'completed', failed: 'failed', cancelled: 'cancelled' }

// --- Usage & cost limits tracker (Roadmap v3 §26 Phase 10) ---
export function recordAiUsage(tokens: number, options?: { provider?: string, model?: string, projectId?: string | null }): void
export function recordGenerationCost(costUsd: number, options?: { provider?: string, projectId?: string | null }): void
export function recordAssetDownload(bytes: number): void
export function recordExport(options?: { durationSec?: number, projectId?: string | null }): void
export function getUsageSummary(limits?: Record<string, number>): {
  month: string
  aiTokens: number
  aiTokensLimit: number
  aiTokensPct: number
  generationCostUsd: number
  generationCostLimitUsd: number
  generationCostPct: number
  assetDownloadGb: number
  assetDownloadLimitGb: number
  assetDownloadPct: number
  exports: number
  byProvider: Record<string, { tokens: number, costUsd: number, calls: number }>
}
export function checkLimit(action: 'ai-tokens' | 'generation-cost' | 'asset-download', limits?: Record<string, number>): { allowed: boolean, reason: string | null, current: number, limit: number }
export function resetUsageStore(): void
export function exportUsageData(): Record<string, unknown>

// --- Telemetry with privacy controls (Roadmap v3 §26 Phase 10) ---
export function isTelemetryEnabled(): boolean
export function setTelemetryEnabled(enabled: boolean): void
export function recordTelemetryEvent(category: string, action: string, metadata?: Record<string, unknown>): void
export function getTelemetryEvents(): Array<Record<string, unknown>>
export function clearTelemetryEvents(): void
export function generateTelemetryReport(appVersion?: string): {
  schemaVersion: number
  generatedAt: number
  appVersion: string
  eventCount: number
  events: Array<Record<string, unknown>>
  summary: Record<string, number>
}
export const TELEMETRY_CATEGORIES: Record<string, string>
export const TELEMETRY_ACTIONS: Record<string, string[]>

// --- Crash recovery & support diagnostics (Roadmap v3 §26 Phase 10) ---
export function checkpointRecovery(state: Record<string, unknown>): void
export function getLastCheckpoint(): { timestamp: number, version: string, projectId: string | null, projectName: string | null, canvas: { width: number, height: number, fps: number } | null, timelineDurationMs: number, trackCount: number, clipCount: number, unsavedChanges: boolean, lastAction: string | null, activeTab: string, playheadPosition: number } | null
export function clearRecoveryCheckpoint(): void
export function recordCrash(error: Error, context?: Record<string, unknown>): void
export function getCrashLog(): Array<{ timestamp: number, version: string, message: string, stack: string | null, context: Record<string, unknown> }>
export function clearCrashLog(): void
export async function runHealthChecks(): Promise<{ checks: Array<{ name: string, status: 'ok' | 'warn' | 'fail', detail: string }>, summary: { ok: number, warn: number, fail: number, overall: 'ok' | 'warn' | 'fail' } }>
export function generateSupportBundle(appVersion?: string): Record<string, unknown>
export function getRecoveryManifest(): { hasCheckpoint: boolean, canRecover: boolean, projectName: string | null, projectId: string | null, canvas: { width: number, height: number, fps: number } | null, timelineDurationMs: number, clipCount: number, unsavedChanges: boolean, lastAction: string | null, ageMinutes: number }

export type TmcutTemplateCategory
  = | 'intro'
    | 'outro'
    | 'split-screen'
    | 'social'
    | 'promo'
    | 'minimal'
    | 'custom'

export type TmcutTemplateIndustry
  = | 'general'
    | 'fnb'
    | 'beauty'
    | 'fashion'
    | 'health'
    | 'realestate'
    | 'education'
    | 'travel'
    | 'tech'
    | 'finance'
    | 'automotive'
    | 'medical'
    | 'services'
    | 'events'
    | 'ecommerce'
    | 'pets'
    | 'creator'

export interface TmcutTemplateIndustryMeta {
  id: TmcutTemplateIndustry
  label: string
  icon: string
}

export interface TmcutTemplatePlaceholder {
  id: string
  type: 'video' | 'image' | 'audio' | 'text'
  label: string
  clipId: string
  trackId?: string
  defaultContent?: string
  required?: boolean
}

/**
 * Track shape stored inside a template payload. Templates round-trip
 * whatever timeline items the HOST app holds (v1 second-based clips in
 * tm-tools, v3 clips elsewhere) — the engine only touches id/type/items
 * structurally, so the clip shape stays intentionally loose here.
 * `validateTemplate` is the runtime gate, not the type system.
 */
export interface TmcutTemplateTrack {
  id?: string
  type: 'video' | 'text' | 'audio'
  name?: string
  items: unknown[]
}

export interface TmcutTemplate {
  id: string
  name: string
  description?: string
  category: TmcutTemplateCategory
  /** Business field the card is written for (see INDUSTRY_CATALOG). */
  industry?: TmcutTemplateIndustry
  /** Free-form search keywords (Vietnamese + English) matched by filterTemplates. */
  tags?: string[]
  aspectRatio: '9:16' | '16:9' | '1:1'
  canvas: {
    width: number
    height: number
    fps: number
  }
  durationTicks: MediaTime
  tracks: TmcutTemplateTrack[]
  markers?: TmcutMarker[]
  placeholders: TmcutTemplatePlaceholder[]
  /** Template schema version (absent = v1; migrateTemplate stamps it). */
  schemaVersion?: number
  /** Content revision of THIS template (bump when the user edits it). */
  version?: number
  /** Asset references derived from clip refs (roadmap v3 §6.4 step 2). */
  requiredAssets?: TemplateRequiredAssetRef[]
  thumbnail?: string
  author?: string
  createdAt?: number
  isBuiltin?: boolean
  /** §6.5 provenance label — AI-built templates only; display metadata. */
  generatedBy?: { tool: string, provider?: string | null, model?: string | null, at?: number } | null
}

export interface FilterTemplatesOptions {
  category?: string
  aspectRatio?: string
  search?: string
  industry?: string
}

export interface InstantiateTemplateResult {
  canvas: { width: number, height: number, fps: number }
  timeline: {
    version: number
    tracks: TmcutTemplateTrack[]
    durationMs: number
    markers?: TmcutMarker[]
  }
  durationMs: number
}

/** Anything track-shaped `createTemplateFromTimeline` can snapshot. */
export type TmcutTemplateSourceTimeline = {
  tracks?: TmcutTemplateTrack[]
  markers?: TmcutMarker[]
}

export const BUILTIN_TEMPLATES: TmcutTemplate[]
export const INDUSTRY_CATALOG: TmcutTemplateIndustryMeta[]
export const TEMPLATE_SCHEMA_VERSION: number
export const TEMPLATE_MIN_SUPPORTED_VERSION: number
export function getBuiltinTemplates(): TmcutTemplate[]
export function getTemplateById(templates: TmcutTemplate[] | null | undefined, id: string): TmcutTemplate | null
export function validateTemplate(template: unknown): { valid: boolean, errors: string[] }
export interface TemplateMigrationResult {
  migrated: Record<string, unknown> | null
  errors: string[]
}
export function migrateTemplate(raw: unknown): TemplateMigrationResult
export interface TemplateRequiredAssetRef {
  assetId: string
  required: boolean
  fallback: string
  sourceHint?: string
}
export function checkRequiredAssets(template: unknown, view?: { installedIds?: string[] }): {
  satisfied: TemplateRequiredAssetRef[]
  missingAssets: TemplateRequiredAssetRef[]
  localNeeds: TemplateRequiredAssetRef[]
}
export function filterTemplates(templates?: TmcutTemplate[] | null, options?: FilterTemplatesOptions): TmcutTemplate[]
export function createTemplateFromTimeline(timeline: TmcutTemplateSourceTimeline, meta?: Partial<TmcutTemplate>): TmcutTemplate
export function instantiateTemplate(template: TmcutTemplate, options?: { replacements?: Record<string, { src?: string, text?: string, name?: string }> }): InstantiateTemplateResult
export function replacePlaceholder(timeline: TmcutTimeline, clipId: string, replacement?: { src?: string, text?: string, name?: string, thumbPath?: string }): boolean

// --- Marketplace starter catalog (src/marketplaceCatalog.mjs) --------------
// Bundled, license-reviewed rows shown in the in-app marketplace. They are
// `sample` sourced (no download) and free, so a row can never arrive with an
// unverified license or a price; see test/marketplace-catalog.test.mjs.
export const STARTER_MUSIC_CATALOG: AssetCenterCatalogEntry[]
export const STARTER_SFX_CATALOG: AssetCenterCatalogEntry[]
export const STARTER_FONT_CATALOG: AssetCenterCatalogEntry[]
export const STARTER_MARKETPLACE_CATALOG: AssetCenterCatalogEntry[]
export function getMarketplaceByCategory(category?: string): AssetCenterCatalogEntry[]
export function getMarketplaceMusic(): AssetCenterCatalogEntry[]
export function getMarketplaceSfx(): AssetCenterCatalogEntry[]
export function getMarketplaceFonts(): AssetCenterCatalogEntry[]
export function getMarketplaceEntryById(id?: string): AssetCenterCatalogEntry | undefined

// --- Generation to Asset Center bridge (src/generationToAssetCenter.mjs) -------
export function getAssemblyReadyAssets(entries: AssetCenterCatalogEntry[]): AssetCenterCatalogEntry[]

// --- Provider routing (src/providerRouting.mjs) -----------------------------
// Capability matrix + per-scene provider fallback for the Video Factory
// (Roadmap v1 §7, P7). Pure JSON in / JSON out; see test/provider-routing.test.mjs.
export interface ProviderRouteRequest {
  sceneId?: string
  capabilities?: string[]
  durationSec?: number
}
export interface ProviderRouteSkip {
  providerId: string
  reason: string
}
export interface ProviderRouteResult {
  ok: boolean
  providerId?: string
  reason?: string
  skipped: ProviderRouteSkip[]
}
export interface ProviderPolicyInput {
  allowedProviders?: string[]
  fallbackOrder?: string[]
  minimumCapabilities?: string[]
}
export function isProviderHealthy(manifest: Record<string, unknown> | null | undefined, unhealthy?: string[]): boolean
export function canServe(manifest: Record<string, unknown> | null | undefined, request?: ProviderRouteRequest): { ok: boolean, reason?: string }
export function routeScene(options?: { request?: ProviderRouteRequest, manifests?: Record<string, unknown>[], policy?: ProviderPolicyInput, unhealthy?: string[], requireVerified?: boolean }): ProviderRouteResult
export function routeStoryboard(options?: { scenes?: ProviderRouteRequest[], manifests?: Record<string, unknown>[], policy?: ProviderPolicyInput, unhealthy?: string[], requireVerified?: boolean }): { routed: Array<{ sceneId: string | null, providerId: string | null, skipped: ProviderRouteSkip[], reason?: string }>, unrouted: number, allRouted: boolean }
export interface ProviderCapabilityRow {
  providerId: string
  displayName: string
  verified: boolean
  modalities: string[]
  maxDurationSec: number
  costModel: string
  estimatedCostPerUnit: number
  canServe: boolean
  reason: string | null
}
export function buildCapabilityMatrix(manifests?: Record<string, unknown>[], request?: ProviderRouteRequest): ProviderCapabilityRow[]

// --- HTML/CSS video (src/htmlVideo.mjs) -------------------------------------
// Authoring model follows the HyperFrames seek contract: an HTML composition
// with a data-composition-id root and a time-pure __hf.seek(t). Pure spec math
// and lint only — capture and encoding live in the host app.
export const HTML_VIDEO_SPEC_VERSION: number
export const HTML_VIDEO_LIMITS: {
  readonly minWidth: number
  readonly maxWidth: number
  readonly minHeight: number
  readonly maxHeight: number
  readonly minFps: number
  readonly maxFps: number
  readonly minDurationSec: number
  readonly maxDurationSec: number
  readonly maxFrames: number
  readonly maxHtmlBytes: number
}
export interface HtmlVideoPreset { id: string, width: number, height: number }
export const HTML_VIDEO_PRESETS: readonly HtmlVideoPreset[]
export function htmlVideoPreset(id: string): HtmlVideoPreset | null
export function frameCountFor(durationSec: number, fps: number): number
export function frameTimeSec(frame: number, fps: number): number
export function frameTimes(durationSec: number, fps: number): number[]
export function collectHtmlTokens(html: string): string[]
export function htmlVideoEscape(value: unknown): string
export function replaceHtmlTokens(html: string, values?: Record<string, string | number | boolean | null>): string
export function unresolvedHtmlTokens(html: string, values?: Record<string, unknown>): string[]
export interface HtmlVideoLintIssue { code: string, level: 'error' | 'warn', message: string }
export function lintHtmlVideo(html: string): HtmlVideoLintIssue[]
export type HtmlVideoSeekContract = 'script' | 'declarative'
export function htmlVideoSeekContract(html: string): HtmlVideoSeekContract
export interface HtmlVideoSpecInput {
  html?: string
  width?: number
  height?: number
  fps?: number
  durationSec?: number
  variables?: Record<string, unknown>
}
export interface HtmlVideoSpecResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  frames: number
  durationSec: number
}
export function validateHtmlVideoSpec(spec?: HtmlVideoSpecInput): HtmlVideoSpecResult
export function isBlockedRenderHost(hostname: string): boolean
export function isAllowedRenderUrl(rawUrl: string, allowRemote?: boolean): boolean

// --- Timeline evaluation (V4 Phase 1 / M1) ---
export type { TmcutClock, TmcutPlatformAdapter, TmcutPlatformCapture, TmcutCaptureRequest, TmcutCaptureSession, TmcutPlatformInfo, TmcutPlatformMedia, TmcutPlatformName } from '../types/platform.js'
export type { TmcutCapabilities, TmcutRuntimeInfo } from '../types/runtime.js'

export interface CoreEvaluatedTransform {
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number
}

export interface CoreEvaluatedTransition {
  type: string | null
  duration: number
  role: 'incoming' | 'outgoing'
  progress: number
}

export interface CoreTextAnimation {
  /** 0..1 — multiply with the clip's own opacity. */
  opacity: number
  /** Canvas px, multiply by the preview scale. */
  deltaX: number
  deltaY: number
  scale: number
}

export function textAnimationAt(
  clip: { animIn?: string, animInDuration?: number, animOut?: string, animOutDuration?: number } | null | undefined,
  localTicks: number,
  durationTicks: number
): CoreTextAnimation

export interface CoreEvaluatedText {
  content: string
  color: string | null
  fontSize: number | null
  fontFamily: string | null
  fontFile: string | null
  bold: boolean
  italic: boolean
  align: string
  shadow: boolean
  stroke: boolean
  /** Optional effect colours, null when unauthored — the DOM keeps its legacy default. */
  shadowColor: string | null
  strokeColor: string | null
  bgColor: string | null
  animIn: string
  animInDuration: number
  animOut: string
  animOutDuration: number
  animation: CoreTextAnimation
}

/**
 * Media placement resolved from the stored clip, with the defaults the
 * renderers already assume. `cropRect` passes through as stored: core clamps
 * it inside `computeFitObjectStyle` (preview) and `planEncodePlate` (export),
 * so the model carries one rect rather than three clamping rules.
 */
export interface CoreEvaluatedLayout {
  fit: string
  /** 0..1 point the source is anchored on inside the box. */
  focusX: number
  focusY: number
  cropRect: TmcutCropRect | null
}

/**
 * How a clip composites over the footage beneath it. The names are spelled
 * identically by CSS `mix-blend-mode` and FFmpeg `blend=all_mode=`, so one
 * value serves monitor and file (Zero-FFmpeg slice F6d).
 */
export type CoreBlendMode = 'normal' | 'screen' | 'overlay' | 'multiply'

/** The blend modes both counterparts implement — the exporter's allowlist. */
export const BLEND_MODES: CoreBlendMode[]

/** The clip's blend mode, normalized: absent or unknown composites as `normal`. */
export function blendModeOf(clip: { blend?: unknown } | null | undefined): CoreBlendMode

/** One clip resolved at an absolute tick — renderer-agnostic, JSON-safe. */
export interface CoreEvaluatedLayer {
  clipId: string
  trackId: string | null
  trackType: string
  kind: string
  startTicks: number
  endTicks: number
  localTicks: number
  sourceTicks: number | null
  /**
   * The authored media-clock rate at this tick: the speed curve's value when a
   * ramp runs, the clip's constant otherwise. An element that seeks by
   * `sourceTicks` must run at THIS number or it is retimed apart from the
   * picture that came from the same tick.
   */
  sourceRate: number
  reverse: boolean
  visible: boolean
  /** 0..1 */
  opacity: number
  /** Linear gain 0..1 (clip x track x fade). */
  volume: number
  audible: boolean
  transform: CoreEvaluatedTransform
  effects: TmcutClipEffect[]
  /** Normalized mask geometry, null when absent or an unknown shape. */
  mask: TmcutMask | null
  layout: CoreEvaluatedLayout
  /** Normalized by core so neither surface repaints or re-validates it. */
  blend: CoreBlendMode
  transition: CoreEvaluatedTransition | null
  text: CoreEvaluatedText | null
  /** True when `sourceTicks` came from a speed curve (>= 2 valid points). */
  ramped: boolean
  groupId: string | null
  linkId: string | null
}

export interface CoreEvaluatedTrack {
  id: string | null
  type: string | null
  muted: boolean
  hidden: boolean
  locked: boolean
  layers: CoreEvaluatedLayer[]
}

export interface CoreTimelineEvaluation {
  at: number
  /** Draw order: track order, then clip start time. */
  layers: CoreEvaluatedLayer[]
  tracks: CoreEvaluatedTrack[]
}

/**
 * Read-only shapes `evaluateTimeline` accepts in addition to the DSL:
 * the app store's flat tracks/clips (`offset` + `in`/`out`/`speed`).
 * `items` stays opaque because the evaluator tolerates both clip shapes.
 */
export interface CoreEvaluatorTrackLike {
  id?: string
  type?: string
  muted?: boolean
  hidden?: boolean
  locked?: boolean
  volume?: number
  items?: readonly unknown[]
}

export interface CoreEvaluatorTimelineLike {
  tracks?: readonly CoreEvaluatorTrackLike[]
}

export function evaluateTimeline(
  input: TmcutProject | TmcutTimeline | CoreEvaluatorTimelineLike | { timeline?: CoreEvaluatorTimelineLike } | null | undefined,
  atTicks: number
): CoreTimelineEvaluation

// --- Paint stack: which footage row owns the canvas (V4 Phase 2, G18) ---
/** One footage row eligible to paint. */
export interface CorePaintRow {
  trackId: string | null
  /** Index into `CoreTimelineEvaluation.tracks`, aligned with the input tracks. */
  trackIndex: number
  layers: CoreEvaluatedLayer[]
}

export interface CorePaintStack {
  at: number
  /** Paint order, track order: `rows[0]` is the BOTTOM of the stack. */
  rows: CorePaintRow[]
  base: CorePaintRow | null
}

/** Selection over one `evaluateTimeline` result — no second evaluation. */
export function selectPaintRows(
  evaluation: CoreTimelineEvaluation | null | undefined
): CorePaintStack

/** `evaluateTimeline` + `selectPaintRows` for callers without the evaluation. */
export function paintStackAt(
  input: TmcutProject | TmcutTimeline | CoreEvaluatorTimelineLike | { timeline?: CoreEvaluatorTimelineLike } | null | undefined,
  atTicks: number
): CorePaintStack

// --- File-wide row law: which rows the whole render contains (F3) ---
/** One row of the file — identity only, so the host joins back by index. */
export interface CoreFileRow {
  trackId: string | null
  /** Index into the input `tracks`, aligned with `evaluateTimeline`'s own list. */
  trackIndex: number
}

export interface CoreFileRows {
  /** Footage rows, paint order, bottom first. `rows === [base, ...stacked]`. */
  rows: CoreFileRow[]
  base: CoreFileRow | null
  /** The footage rows painted ABOVE the base — `rows.slice(1)`, for hosts that must not do the arithmetic. */
  stacked: CoreFileRow[]
  /** Text rows, in track order, painted above every footage row. */
  overlays: CoreFileRow[]
  /** Every audio row, hidden or not: `muted` is the sound control, `hidden` is not. */
  audio: CoreFileRow[]
}

/**
 * The union of `selectPaintRows` over every tick: the rows a host that builds
 * one graph for the whole file paints, lane by lane. Reads the timeline, not an
 * evaluation, so it never samples ticks.
 */
export function selectFileRows(
  input: TmcutProject | TmcutTimeline | CoreEvaluatorTimelineLike | { timeline?: CoreEvaluatorTimelineLike } | null | undefined
): CoreFileRows

// --- Composite plan: what to paint, in order (V4 Phase 2, F1) ---
/** One surface a host must render, carrying the evaluator's layer by reference. */
export interface CoreCompositeSlot {
  /** `footage` = a video row's picture; `overlay` = live text painted on top. */
  kind: 'footage' | 'overlay'
  /** `paint` = the layer shown; `outgoing` = a transition's partner beneath it. */
  role: 'paint' | 'outgoing'
  clipId: string
  trackId: string | null
  /** Index into `CoreTimelineEvaluation.tracks`, aligned with the input tracks. */
  trackIndex: number
  layer: CoreEvaluatedLayer
}

export interface CoreCompositePlan {
  at: number
  /** Bottom of the stack first: footage rows in track order, then overlays. */
  slots: CoreCompositeSlot[]
}

/**
 * The set and order of surfaces for one `evaluateTimeline` result. Reads
 * `selectPaintRows` for the row law, so the two cannot drift, and never
 * evaluates the timeline a second time.
 */
export function compositePlan(
  evaluation: CoreTimelineEvaluation | null | undefined
): CoreCompositePlan

// --- Clock + host capability contract (V4 Phase 1 / M1) ---
export function createClock(rate: FrameRate): TmcutClock

// --- Live-preview pace (V4 Phase 2, slice F req 6) ---
/** Where a preview stands: the frame it is on and that frame's start tick. */
export interface CoreFramePacePosition {
  readonly frame: number
  readonly startTicks: number
}

/** One preview's pace, measured on one clock. Stateful only in its anchor. */
export interface CoreFramePace {
  /**
   * The position at a host timestamp (ms, e.g. a rAF callback argument).
   * `rate` is a signed shuttle factor (0 holds, negative rewinds); `currentFrame`
   * is where the host says the playhead is — a frame the pace did not deliver
   * re-arms the anchor instead of carrying the old interval along.
   */
  at(timestampMs: number, rate: number, currentFrame: number): CoreFramePacePosition
  /** Forget the anchor; the next call starts a fresh segment at the frame given. */
  reset(): void
}

export function createFramePace(clock: TmcutClock): CoreFramePace

// --- Frame-index scheduler (V4 Phase 2, item 3) ---
/** One renderable frame: its ordinal, its tick position, its content. */
export interface CoreFrame {
  readonly index: number
  readonly startTicks: number
  /** The frame's own width — the LAST frame can overrun the content span. */
  readonly endTicks: number
  readonly evaluation: CoreTimelineEvaluation
}

/** A render plan keyed by frame index; every answer is a pure function of it. */
export interface CoreFrameScheduler {
  readonly clock: TmcutClock
  readonly fps: number
  readonly ticksPerFrame: number
  /** End of the content span in ticks (0 for an empty project). */
  readonly endTicks: number
  readonly frameCount: number
  /** The frame containing an absolute tick, clamped into the sequence. */
  indexOf(ticks: number): number
  /** Null when the index is outside the sequence. */
  frameAt(index: number): CoreFrame | null
  /** Half-open [fromIndex, toIndex); the whole sequence when both are omitted. */
  frames(fromIndex?: number, toIndex?: number): CoreFrame[]
}

export function createFrameScheduler(
  input: TmcutProject | TmcutTimeline | CoreEvaluatorTimelineLike | { timeline?: CoreEvaluatorTimelineLike } | null | undefined,
  options?: { rate?: FrameRate }
): CoreFrameScheduler

// --- Render-at-timestamp contract (V4 Phase 2, item 1) ---
/** Where one timestamp actually renders, with the frame it falls in. */
export interface CoreRenderPosition {
  /** The request as core honoured it: finite, rounded to a tick, never negative. */
  readonly requestedTicks: number
  /** The position `evaluation` was taken at. */
  readonly at: number
  readonly evaluation: CoreTimelineEvaluation
  /** Null for an empty project — no frame exists to name. */
  readonly index: number | null
  readonly frame: CoreFrame | null
  /** False when `snapToFrame: false` kept the requested position. */
  readonly snapped: boolean
  /** True when the request is at or past the end of the content. */
  readonly beyond: boolean
  readonly fps: number
  readonly ticksPerFrame: number
  readonly endTicks: number
  readonly frameCount: number
}

/**
 * The public "paint this timestamp" contract. Frame mode (default) collapses
 * every timestamp inside a frame to that frame's start, so a render is
 * replayable; `snapToFrame: false` keeps the position for scrubbing and only
 * pulls it back at the end of the content (ADR-018).
 */
export function renderAt(
  input: TmcutProject | TmcutTimeline | CoreEvaluatorTimelineLike | { timeline?: CoreEvaluatorTimelineLike } | null | undefined,
  atTicks: number,
  options?: { rate?: FrameRate, snapToFrame?: boolean }
): CoreRenderPosition
export const PLATFORM_NAMES: readonly TmcutRuntimeInfo['name'][]
export const PLATFORM_CAPABILITIES: readonly (keyof TmcutCapabilities)[]
export function createPlatformInfo(
  name: TmcutRuntimeInfo['name'],
  capabilities?: Partial<TmcutCapabilities>
): TmcutRuntimeInfo
export function platformSupports(info: TmcutRuntimeInfo | null | undefined, capability: keyof TmcutCapabilities): boolean

// --- Golden-frame comparison (V4 M2 prep, ADR-016) ---
export type {
  TmcutFrameCompareOptions,
  TmcutFrameCompareResult
} from '../types/pixels.js'
export const DEFAULT_FRAME_COMPARE: Readonly<Required<Omit<TmcutFrameCompareOptions, 'mask'>>>
export function compareFrames(
  expected: Uint8Array | Uint8ClampedArray,
  actual: Uint8Array | Uint8ClampedArray,
  options?: TmcutFrameCompareOptions
): TmcutFrameCompareResult

export interface CoreClipVisual {
  /** 0..1 */
  opacity: number
  /** 0..100; fade envelope is NOT applied here. */
  volume: number
  transform: CoreEvaluatedTransform
}

/** One clip's visual/audio state at clip-local ticks (no timeline needed). */
export function evaluateClip(
  clip: {
    keyframes?: TmcutKeyframe[]
    scale?: number
    opacity?: number
    volume?: number
    x?: number
    y?: number
    rotation?: number
    transform?: {
      x?: number
      y?: number
      scaleX?: number
      scaleY?: number
      rotation?: number
      opacity?: number
    }
  } | null | undefined,
  localTicks: number
): CoreClipVisual

// --- Client byte cache (zero-FFmpeg slice C2b, ADR-033) ---
/** Hard ceiling: a big disk never buys an unbounded cache. */
export const TMCUT_BYTE_CACHE_MAX_BYTES: number
/** Share of the device quota the cache may claim. */
export const TMCUT_BYTE_CACHE_QUOTA_SHARE: number
/** One thing the browser holds: its key (a revision or an artifact of one), its size, the last time it was read. */
export interface TmcutByteCacheEntry {
  key: string
  bytes: number
  accessedAt: number
}
/** The answer to "what may the cache keep". */
export interface TmcutByteCachePlan {
  /** Keys to delete, in the order the law decided them. */
  drop: string[]
  /** Entries that fit, oldest first. */
  keep: TmcutByteCacheEntry[]
  /** Bytes `keep` totals — always within the budget when a budget exists. */
  keptBytes: number
  /** Index keys that cannot name a file; reported so the caller can clean them. */
  invalid: string[]
}
/** Bytes the cache may hold; an unusable quota still gets the ceiling, never infinity. */
export function byteCacheBudgetBytes(quotaBytes: number): number
/** A cache key is exactly one revision fingerprint — nothing else may name a file. */
export function isByteCacheKey(key: unknown): boolean
/** One artifact cut from a revision: the source, what kind of answer, which version measured it. */
export interface TmcutDerivedCacheKey {
  fingerprint: string
  kind: string
  version: number
}
/** The key for one derived artifact of one revision, or null when no part of it is nameable. */
export function derivedByteCacheKey(fingerprint: unknown, kind: unknown, version: unknown): string | null
/** The parts of a derived key, or null when the key names no artifact. */
export function parseDerivedByteCacheKey(key: unknown): TmcutDerivedCacheKey | null
/** Whether this key names an artifact computed FROM a revision, not the revision. */
export function isDerivedByteCacheKey(key: unknown): boolean
/** Whether this key may name a file in the store at all: a source revision or an artifact. */
export function isStoredByteCacheKey(key: unknown): boolean
/** The revision an entry came from — itself for a source row, the embedded fingerprint for an artifact. */
export function byteCacheFingerprint(key: unknown): string | null
/** Whether one file can live in the cache at all, before eviction is asked. */
export function byteCacheFits(sizeBytes: number, budgetBytes: number): boolean
/** Which cached revisions to delete so the store fits `budgetBytes`. */
export function planByteCacheEviction(
  entries: TmcutByteCacheEntry[],
  budgetBytes: number,
  liveKeys?: Iterable<string>
): TmcutByteCachePlan
/** Where one clip's playback bytes come from: the cached revision, the stream, or neither. */
export type TmcutPlaybackByteSource
  = | { kind: 'cache', key: string }
    | { kind: 'stream', url: string, reason: string }
    | { kind: 'unresolved', reason: string }
export function planPlaybackByteSource(revision: {
  fingerprint?: string | null
  cached?: boolean
  streamUrl?: string | null
} | null): TmcutPlaybackByteSource
/** One revision's blob URL, as the host holds it. */
export interface TmcutBlobUrlRow {
  key: string
  url: string
}
/** What the host creates, keeps and revokes when the live set of revisions changes. */
export interface TmcutBlobUrlLifecycle {
  keep: TmcutBlobUrlRow[]
  create: string[]
  revoke: TmcutBlobUrlRow[]
}
export function planBlobUrlLifecycle(
  held: Record<string, string | null>,
  wanted: Iterable<string>
): TmcutBlobUrlLifecycle

// --- Export encode laws (zero-FFmpeg slice H1, ladder in H2) ---
/** The parenthetical both encode paths use when an edge has no chroma block. */
export const ENCODER_EVEN_DIMENSION_REASON: string
/** Frames allowed inside the encoder at once when the caller names no limit. */
export const DEFAULT_ENCODE_IN_FLIGHT: number

/** One encode preset, in the order the caller prefers it. */
export interface CoreEncodePreset {
  id: string
  /** The container the codec pair can actually live in; set by the ladder. */
  container?: string
  video: {
    codec: string
    width: number
    height: number
    fps: FrameRate
    bitrate?: number
  }
  audio?: { codec: string, sampleRate: number, channelCount: number } | null
}

/** What the host recorded from isConfigSupported for one preset. */
export interface CoreEncodeSupportAnswer {
  video?: { supported?: boolean, config?: { codec?: string } }
  audio?: { supported?: boolean, config?: { codec?: string } }
}

/** One preset's place in the capability matrix. */
export interface CoreEncodeVerdict {
  id?: string
  verdict: 'supported' | 'unsupported' | 'substituted' | 'unmeasured' | 'invalid'
  reasons: string[]
  preset: CoreEncodePreset | null
  config: {
    id: string
    video: CoreEncodePreset['video']
    audio: { codec: string, sampleRate: number, channelCount: number } | null
  } | null
}

/** The output the user asked for, as the ladder receives it. */
export interface CoreEncodeRequest {
  width?: number
  height?: number
  fps?: FrameRate
  audio?: { sampleRate: number, channelCount: number } | null
}

/**
 * The configs worth asking a runtime about — never a claim that any of them
 * works. An unusable request yields no presets and the reasons in `errors`.
 */
export function planEncodePresets(input: CoreEncodeRequest): {
  presets: CoreEncodePreset[]
  errors: string[]
}

export function planEncodeConfig(input: {
  presets?: CoreEncodePreset[]
  answers?: Record<string, CoreEncodeSupportAnswer | undefined>
}): { kind: 'ready', preset: CoreEncodePreset, config: NonNullable<CoreEncodeVerdict['config']>, checked: CoreEncodeVerdict[] }
  | { kind: 'refused', reason: 'no-presets' | 'nothing-measured' | 'nothing-supported', checked: CoreEncodeVerdict[] }

/** One muxed sample: integers in `timescale` units, or null outside the content. */
export function planEncodeSample(input: {
  index?: number
  rate?: FrameRate
  contentEndTicks?: number
  timescale?: number
}): { timestamp: number, duration: number, isLast: boolean } | null

/**
 * Samples one audio packet must carry, keyed by the codec spelling the ladder
 * asks with. A codec missing from the table has not been told: there is no
 * default, because a packet of the wrong length is a different codec.
 */
export const AUDIO_PACKET_FRAMES: Record<string, number>

/** Where a project's audio ends, in whole samples, or null for no such clock. */
export function encodeAudioSampleCount(input: {
  contentEndTicks?: number
  sampleRate?: number
}): number | null

/** One muxed audio packet, on the same clock as {@link planEncodeSample}. */
export function planEncodeAudioSample(input: {
  index?: number
  sampleRate?: number
  framesPerPacket?: number
  contentEndTicks?: number
  timescale?: number
}): { startSample: number, frames: number, timestamp: number, duration: number, isLast: boolean } | null

/** How many audio packets the schedule must produce, or null for no such clock. */
export function encodeAudioPacketCount(input: {
  contentEndTicks?: number
  sampleRate?: number
  framesPerPacket?: number
}): number | null

/** How many packets one encoder must be handed to flush, keyed by codec spelling. */
export const AUDIO_MIN_HAND_PACKETS: Record<string, number>

/** Hands to make: what the file promises, floored by what the encoder needs. */
export function encodeAudioHandCount(input: {
  codec?: string
  contentEndTicks?: number
  sampleRate?: number
  framesPerPacket?: number
}): number | null

/**
 * The hand past the schedule: one whole frame on the same grid, for a codec
 * measured to need more hands than the file has packets. Null for every position
 * the schedule owns (§52).
 */
export function planEncodeAudioPadding(input: {
  index?: number
  codec?: string
  contentEndTicks?: number
  sampleRate?: number
  framesPerPacket?: number
}): { startSample: number, frames: number, timestamp: number, duration: number } | null

/**
 * Which sample one arriving packet releases, and whether the file may have it.
 * Video is named by its timestamp; audio by the order it was handed in (§52).
 */
export function planEncodeChunk(input: {
  kind?: 'video' | 'audio'
  openSamples?: number
  packetsAdmitted?: number
  packetTotal?: number
}): { identity: 'timestamp' | 'ordinal', action: 'write' | 'drop-tail' | 'fail', reason: string } | null

/** The order the exporter must close a file in, from the counters of one run. */
export function planEncodeFinish(input: {
  totalFrames?: number
  framesQueued?: number
  videoPackets?: number
  audioPackets?: number
  totalAudioPackets?: number
  audioPacketsQueued?: number
  /** The hands the encoder is owed, which an encoder may need more of than the file. */
  totalAudioHands?: number
  videoInFlight?: number
  audioInFlight?: number
  videoParked?: number
  audioParked?: number
  videoFlushed?: boolean
  audioFlushed?: boolean
  outputState?: string
  hasVideo?: boolean
  hasAudio?: boolean
}): { action: 'start' | 'paint' | 'pump' | 'flush-video' | 'flush-audio' | 'wait' | 'stalled' | 'finalize' | 'stop' | 'done', ready: boolean, blocking: readonly string[] } | null

/** Whether the encoder's decoder description travels with this packet. */
export function planEncodePacketMeta(input: {
  packetsAdded?: number
  hasMeta?: boolean
}): { action: 'with-meta' | 'hold' | 'plain', reason?: string } | null

/** How far the export has come: the slower leg, capped until the file is closed. */
export function planEncodeProgress(input: {
  totalFrames?: number
  framesDone?: number
  totalAudioPackets?: number
  audioPacketsDone?: number
  outputState?: string
}): number | null

/** The highest progress may read while the muxer still holds the file open. */
export const ENCODE_PROGRESS_UNTIL_CLOSED: number

export function planEncodeQueue(input: {
  inFlight?: number
  limit?: number
}): { action: 'push' | 'wait', outstanding: number, limit: number, room: number }

// --- Export content laws (zero-FFmpeg slice H3d) ---
/**
 * The audio config the exporter asks a runtime about when the file has sound:
 * 48 kHz stereo, measured as the one AAC answers `supported` to (§49.4, §52.1).
 */
export const ENCODE_AUDIO_REQUEST: { sampleRate: number, channelCount: number }

/** Every reason `planEncodeContent` can name, in its reported (sorted) order. */
export const ENCODE_REFUSAL_REASONS: readonly string[]

/** One project, judged for the WebCodecs exporter. */
export interface CoreEncodeContentVerdict {
  kind: 'eligible' | 'refused'
  /** Sorted and complete: every unpaintable feature in the project, named once. */
  reasons: readonly string[]
  /** Hand this to `planEncodePresets`. Null whenever anything is refused. */
  request: CoreEncodeRequest | null
  /** The validated canvas the painter sizes itself to. Null on a refusal. */
  canvas: { width: number, height: number, fps: FrameRate } | null
  totalFrames: number
  contentEndTicks: number
  durationSec: number
}

/**
 * What one project means for the exporter: the frame grid the session is owed,
 * and the named reasons a canvas painter cannot reproduce the monitor yet.
 */
export function planEncodeContent(
  input: TmcutProject | TmcutTimeline | { canvas?: TmcutCanvas, tracks?: TmcutTrack[] } | null | undefined
): CoreEncodeContentVerdict

/** Where one layer lands, in canvas pixels — the two rects of one `drawImage`. */
export interface CoreEncodePlateRect {
  source: { sx: number, sy: number, sw: number, sh: number }
  /** May extend past the canvas, with a negative origin: the frame edge crops. */
  dest: { dx: number, dy: number, dw: number, dh: number }
  alpha: number
}

/**
 * The plate rect for one layer, mirroring the preview's `object-fit` CSS and the
 * file's `scale`/`pad`/`crop`/`overlay` chain. Null for an unusable media or
 * canvas size, and for a fit mode with no measured canvas twin (`smart`).
 */
export function planEncodePlate(input: {
  media?: { width?: number, height?: number } | null
  canvas?: { width?: number, height?: number } | null
  layout?: CoreEvaluatedLayout | null
  transform?: Pick<CoreEvaluatedTransform, 'x' | 'y' | 'scaleX' | 'scaleY'> | null
  opacity?: number
}): CoreEncodePlateRect | null

/**
 * The colour one painted export frame starts from — the canvas background in the
 * one spelling a canvas `fillStyle` accepts. Null for the two shapes
 * `planEncodeContent` refuses as `background-*`, where no colour tells the truth.
 */
export function encodeCanvasFill(canvas: {
  background?: { type?: string, value?: unknown } | null
} | null | undefined): string | null

// --- Export packet mix (zero-FFmpeg slice H3d-2a) ---
/** Every reason `planExportMixPacket` can leave a source out, in list order. */
export const EXPORT_MIX_REFUSALS: readonly string[]

/** One `audioMixAt` source with the decoded run the caller read for it. */
export interface CoreExportMixSource {
  clipId?: string | number | null
  trackId?: string | null
  gain?: number
  mediaTicks?: number | null
  rate?: number
  plays?: boolean
  refusal?: string | null
  /** One flat run per source channel, at the native rate the decoder returned. */
  channels?: ArrayLike<number>[] | null
  sampleRate?: number
}

/** What one source became in the packet, or nothing at all when it was refused. */
export interface CoreExportMixEntry {
  clipId: string | number | null
  trackId: string | null
  gain: number
  rate: number
  mediaStartSec: number
  sampleRate: number
  /** Channel samples of the running sum outside full scale once this source was added. */
  overRange: number
}

/**
 * The samples one export packet holds: position from `mediaTicks` phase-locked to
 * the tick that produced it, media advanced by `rate`, resampled linearly from the
 * decoder's native rate to the file's, scaled by gain and summed without
 * normalisation — the same arithmetic the preview's Web Audio graph runs.
 */
export function planExportMixPacket(input: {
  at?: number
  startSample?: number
  frames?: number
  target?: { sampleRate?: number, channelCount?: number }
  sources?: CoreExportMixSource[]
}): {
  at: number
  startSample: number
  frames: number
  target: { sampleRate: number, channelCount: number }
  channels: Float32Array[]
  mixed: readonly CoreExportMixEntry[]
  refused: ReadonlyArray<{ clipId: string | number | null, reason: string }>
} | null
