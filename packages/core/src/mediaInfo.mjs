// =============================================================================
//  tmcut-core — media info
//  Normalizes whatever the host's demuxer read into the MediaInfo schema of
//  the zero-FFmpeg plan (§4.1). Pure: it never touches a demuxer, DOM or Node,
//  so the same rules decide import status on Web and Electron.
//
//  Law: a field with no evidence stays undefined. The old browser probe
//  reported `fps: 0` and the old ffprobe path fell back to 30; both are
//  guesses, and §4.3 forbids them.
// =============================================================================

import { classifyAssetKind } from './media.mjs'
import { fpsToRational } from './time.mjs'

export const MEDIA_WARNING_SEVERITY = {
  CONTAINER_UNDEMODABLE: 'error',
  VIDEO_NOT_DECODABLE: 'error',
  AUDIO_NOT_DECODABLE: 'warning',
  IMAGE_NOT_DECODABLE: 'error',
  DURATION_UNKNOWN: 'warning',
  DURATION_ESTIMATED: 'info',
  DURATION_MISMATCH: 'warning',
  FPS_UNKNOWN: 'warning',
  FPS_VARIABLE: 'info',
  DIMENSIONS_UNKNOWN: 'warning',
  HIGH_DYNAMIC_RANGE: 'info',
  TRACK_ROTATED: 'info',
  SIZE_UNKNOWN: 'info'
}

const DURATION_MISMATCH_SEC = 0.5

function positiveNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function nonNegativeNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function knownRate(value) {
  return positiveNumber(value)
}

/** Container first, then the longest track, then an estimate, then nothing. */
export function pickDuration(descriptor, trackDurations) {
  const longest = trackDurations.reduce((max, value) => Math.max(max, Number(value) || 0), 0)
  const container = positiveNumber(descriptor?.duration?.container)
  if (container !== null) {
    const spread = longest > 0 ? Math.abs(longest - container) : 0
    return { duration: container, durationSource: 'container', mismatchSec: spread > DURATION_MISMATCH_SEC ? spread : 0 }
  }
  const track = trackDurations.filter(value => value > 0).sort((a, b) => b - a)[0]
  if (track) return { duration: track, durationSource: 'track', mismatchSec: 0 }
  const estimated = positiveNumber(descriptor?.duration?.estimated)
  if (estimated !== null) return { duration: estimated, durationSource: 'estimated', mismatchSec: 0 }
  return { duration: undefined, durationSource: 'unknown', mismatchSec: 0 }
}

export function buildFrameRate(track) {
  const nominal = knownRate(track?.nominalFrameRate)
  const average = knownRate(track?.averageFrameRate)
  if (nominal === null && average === null) return undefined
  const rate = average ?? nominal
  const isVariable = track?.isVariableFrameRate === true
  const info = {
    nominal: nominal ?? undefined,
    average: average ?? undefined,
    source: average !== null ? 'measured' : 'nominal',
    isVariable
  }
  info.rational = fpsToRational(rate)
  return info
}

function codecInList(codec, list) {
  if (typeof codec !== 'string' || !codec) return null
  const needle = codec.toLowerCase()
  if (!Array.isArray(list) || list.length === 0) return null
  return list.some(entry => typeof entry === 'string' && entry.toLowerCase() === needle)
}

function normalizeVideoTrack(track, index, capabilities) {
  const codedWidth = positiveNumber(track?.codedWidth)
  const codedHeight = positiveNumber(track?.codedHeight)
  const displayWidth = positiveNumber(track?.displayWidth) ?? codedWidth
  const displayHeight = positiveNumber(track?.displayHeight) ?? codedHeight
  const rotation = nonNegativeNumber(track?.rotation)
  const out = {
    id: typeof track?.id === 'string' && track.id ? track.id : `video-${index + 1}`,
    codec: typeof track?.codec === 'string' && track.codec ? track.codec : undefined,
    codedWidth: codedWidth ?? undefined,
    codedHeight: codedHeight ?? undefined,
    displayWidth: displayWidth ?? undefined,
    displayHeight: displayHeight ?? undefined,
    frameRate: buildFrameRate(track),
    bitrate: positiveNumber(track?.bitrate) ?? undefined,
    rotation: rotation === null ? undefined : rotation % 360,
    pixelAspectRatio: rationalToFloatSafe(track?.pixelAspectRatio) ?? undefined,
    colorSpace: typeof track?.colorSpace === 'string' && track.colorSpace ? track.colorSpace : undefined,
    hasHighDynamicRange: track?.hasHighDynamicRange === true ? true : undefined,
    duration: positiveNumber(track?.duration) ?? undefined
  }
  if (typeof track?.canDecode === 'boolean') out.canDecode = track.canDecode
  else if (out.codec) {
    const listed = codecInList(out.codec, capabilities?.decodableVideoCodecs)
    if (listed !== null) out.canDecode = listed
  }
  if (typeof track?.canEncode === 'boolean') out.canEncode = track.canEncode
  else if (out.codec) {
    const listed = codecInList(out.codec, capabilities?.encodableVideoCodecs)
    if (listed !== null) out.canEncode = listed
  }
  return out
}

function rationalToFloatSafe(rational) {
  const numerator = positiveNumber(rational?.numerator)
  const denominator = positiveNumber(rational?.denominator)
  if (numerator === null) return null
  if (denominator === null) return null
  return numerator / denominator
}

function normalizeAudioTrack(track, index, capabilities) {
  const channels = positiveNumber(track?.channels)
  const out = {
    id: typeof track?.id === 'string' && track.id ? track.id : `audio-${index + 1}`,
    codec: typeof track?.codec === 'string' && track.codec ? track.codec : undefined,
    sampleRate: positiveNumber(track?.sampleRate) ?? undefined,
    channels: channels ?? undefined,
    channelLayout: typeof track?.channelLayout === 'string' && track.channelLayout ? track.channelLayout : undefined,
    bitrate: positiveNumber(track?.bitrate) ?? undefined,
    duration: positiveNumber(track?.duration) ?? undefined
  }
  if (typeof track?.canDecode === 'boolean') out.canDecode = track.canDecode
  else if (out.codec) {
    const listed = codecInList(out.codec, capabilities?.decodableAudioCodecs)
    if (listed !== null) out.canDecode = listed
  }
  return out
}

function normalizeSubtitleTrack(track, index) {
  return {
    id: typeof track?.id === 'string' && track.id ? track.id : `subtitle-${index + 1}`,
    codec: typeof track?.codec === 'string' && track.codec ? track.codec : undefined,
    language: typeof track?.language === 'string' && track.language ? track.language : undefined,
    label: typeof track?.label === 'string' && track.label ? track.label : undefined,
    duration: positiveNumber(track?.duration) ?? undefined
  }
}

function pushWarning(warnings, code, message) {
  const severity = MEDIA_WARNING_SEVERITY[code]
  if (!severity) return
  if (warnings.some(entry => entry.code === code && entry.message === message)) return
  warnings.push({ code, message, severity })
}

/**
 * The track shapes decide the kind before the name does: a demuxer that found a
 * video track has answered more reliably than an extension could.
 */
function inferKind(descriptor, videoTracks, audioTracks, still) {
  if (still) return 'image'
  if (videoTracks.length > 0) return 'video'
  if (audioTracks.length > 0) return 'audio'
  const byName = classifyAssetKind(descriptor?.name)
  if (byName === 'image') return 'image'
  if (byName === 'audio') return 'audio'
  return 'unknown'
}

function normalizeStill(still) {
  if (!still || typeof still !== 'object') return undefined
  const width = positiveNumber(still.width)
  const height = positiveNumber(still.height)
  const normalized = {}
  if (width !== null) normalized.width = width
  if (height !== null) normalized.height = height
  if (typeof still.decodable === 'boolean') normalized.decodable = still.decodable
  if (typeof still.codec === 'string' && still.codec) normalized.codec = still.codec
  if (normalized.width === undefined && normalized.height === undefined
    && normalized.decodable === undefined && normalized.codec === undefined) return undefined
  return normalized
}

export function buildCompatibility({ kind, demuxable, videoTracks, audioTracks, seekable, still }) {
  const limitations = []
  const canDemux = kind === 'image' ? demuxable !== false || !!still : demuxable !== false
  const primaryVideo = videoTracks[0]
  const primaryAudio = audioTracks[0]
  const videoDecodable = videoTracks.length === 0 || primaryVideo.canDecode !== false
  const audioDecodable = audioTracks.length === 0 ? true : primaryAudio.canDecode !== false
  // Re-muxing the source codec needs an encoder for EVERY kind the file has: a
  // clip whose video is encodable but whose audio is not cannot be exported
  // losslessly, and promising it would be a lie the export discovers late.
  const videoEncodable = videoTracks.length === 0 || primaryVideo.canEncode === true
  const audioEncodable = audioTracks.length === 0 || primaryAudio.canEncode === true
  const stillDecodable = !!still && still.decodable !== false
  let canPreview
  if (kind === 'image') canPreview = stillDecodable || hasDimensions(videoTracks)
  else canPreview = canDemux && videoDecodable && audioDecodable
  if (!canDemux) limitations.push('demux')
  if (kind === 'image' && !stillDecodable) limitations.push('image-decode')
  if (videoTracks.length > 0 && !videoDecodable) limitations.push('video-decode')
  if (audioTracks.length > 0 && !audioDecodable) limitations.push('audio-decode')
  if (videoTracks.length > 0 && primaryVideo?.frameRate === undefined) limitations.push('frame-rate-unknown')
  if (primaryVideo?.frameRate?.isVariable) limitations.push('variable-frame-rate')
  if (!videoEncodable) limitations.push('source-codec-encode')
  if (!audioEncodable) limitations.push('source-audio-encode')
  if (seekable === false) limitations.push('seek')
  return {
    canDemux,
    canDecodeVideo: videoTracks.length > 0 ? videoDecodable : kind === 'image' && stillDecodable,
    canDecodeAudio: audioTracks.length > 0 ? audioDecodable : false,
    canPreview,
    canExportSourceCodec: kind === 'image' ? canDemux : canDemux && videoEncodable && audioEncodable,
    limitations
  }
}

function hasDimensions(videoTracks) {
  const primary = videoTracks[0]
  return !!primary && Number.isFinite(primary.displayWidth) && Number.isFinite(primary.displayHeight)
}

export function buildMediaInfo(descriptor) {
  const source = descriptor && typeof descriptor === 'object' ? descriptor : {}
  const capabilities = source.capabilities || null
  const videoTracks = (Array.isArray(source.videoTracks) ? source.videoTracks : [])
    .map((track, index) => normalizeVideoTrack(track, index, capabilities))
  const audioTracks = (Array.isArray(source.audioTracks) ? source.audioTracks : [])
    .map((track, index) => normalizeAudioTrack(track, index, capabilities))
  const subtitleTracks = (Array.isArray(source.subtitleTracks) ? source.subtitleTracks : [])
    .map((track, index) => normalizeSubtitleTrack(track, index))
  const still = normalizeStill(source.still)

  const kind = inferKind(source, videoTracks, audioTracks, still)
  const demuxable = source.demuxable !== false
  const { duration, durationSource, mismatchSec } = pickDuration(source, [...videoTracks, ...audioTracks].map(track => track.duration || 0))
  const compatibility = buildCompatibility({
    kind,
    demuxable,
    videoTracks,
    audioTracks,
    seekable: typeof source.seekable === 'boolean' ? source.seekable : undefined,
    still
  })

  const probeWarnings = []
  if (!demuxable && kind !== 'image') pushWarning(probeWarnings, 'CONTAINER_UNDEMODABLE', `TMCut cannot read container ${source.container || source.name}`)
  if (kind === 'image' && !compatibility.canPreview) pushWarning(probeWarnings, 'IMAGE_NOT_DECODABLE', `This runtime cannot decode the still image ${source.name || 'untitled'}`)
  if (videoTracks.length > 0 && videoTracks[0].canDecode === false) pushWarning(probeWarnings, 'VIDEO_NOT_DECODABLE', `This runtime cannot decode video codec ${videoTracks[0].codec || 'unknown'}`)
  if (audioTracks.length > 0 && audioTracks[0].canDecode === false) pushWarning(probeWarnings, 'AUDIO_NOT_DECODABLE', `This runtime cannot decode audio codec ${audioTracks[0].codec || 'unknown'}`)
  if (mismatchSec > 0) pushWarning(probeWarnings, 'DURATION_MISMATCH', `Container and track durations differ by ${mismatchSec.toFixed(2)}s`)
  if (durationSource === 'estimated') pushWarning(probeWarnings, 'DURATION_ESTIMATED', 'Duration was estimated from packet timestamps, not stored metadata')
  // A still genuinely has no length, so 'unknown' is the right answer there and
  // not a reason to tell the user their import is broken.
  if (durationSource === 'unknown' && kind !== 'image') pushWarning(probeWarnings, 'DURATION_UNKNOWN', 'No duration reported by the container or any track')
  if (videoTracks.length > 0 && videoTracks[0].frameRate === undefined) pushWarning(probeWarnings, 'FPS_UNKNOWN', 'Frame rate could not be read; the timeline rate drives sampling')
  if (videoTracks[0]?.frameRate?.isVariable) pushWarning(probeWarnings, 'FPS_VARIABLE', 'Variable frame rate: frames are sampled by timeline time, not source rate')
  if (kind === 'video' && !hasDimensions(videoTracks)) pushWarning(probeWarnings, 'DIMENSIONS_UNKNOWN', 'The primary video track reports no display size')
  if (videoTracks[0]?.hasHighDynamicRange) pushWarning(probeWarnings, 'HIGH_DYNAMIC_RANGE', 'HDR source; preview and export are tone-mapped to the working color space')
  if (Number.isFinite(videoTracks[0]?.rotation) && videoTracks[0].rotation % 360 !== 0) pushWarning(probeWarnings, 'TRACK_ROTATED', `Primary video track carries a ${videoTracks[0].rotation} degree rotation`)
  if (!Number.isFinite(Number(source.size)) || Number(source.size) <= 0) pushWarning(probeWarnings, 'SIZE_UNKNOWN', 'File size was not reported by the host')

  const info = {
    id: typeof source.id === 'string' && source.id ? source.id : `${kind}:${source.name || 'untitled'}`,
    name: typeof source.name === 'string' ? source.name : '',
    size: positiveNumber(source.size) ?? 0,
    kind,
    mimeType: typeof source.mimeType === 'string' && source.mimeType ? source.mimeType : undefined,
    container: typeof source.container === 'string' && source.container ? source.container : undefined,
    duration,
    durationSource,
    isSeekable: typeof source.seekable === 'boolean' ? source.seekable : undefined,
    videoTracks,
    audioTracks,
    subtitleTracks,
    still,
    metadata: source.tags && typeof source.tags === 'object' ? { ...source.tags } : undefined,
    probeWarnings,
    compatibility,
    importStatus: 'ready'
  }
  info.importStatus = classifyImportStatus(info)
  return info
}

export function classifyImportStatus(info) {
  if (!info) return 'error'
  const warnings = Array.isArray(info.probeWarnings) ? info.probeWarnings : []
  const learnedAnything = info.duration !== undefined
    || info.videoTracks.length > 0
    || info.audioTracks.length > 0
    || !!info.still
  if (!learnedAnything) return 'error'
  if (info.kind === 'image' && !info.compatibility.canPreview) return 'unsupported'
  if (info.kind !== 'image' && !info.compatibility.canDemux) return 'unsupported'
  if (warnings.some(entry => entry.severity === 'error')) return 'partial'
  if (!info.compatibility.canPreview) return 'partial'
  return 'ready'
}

/** The legacy five-field shape, for callers not yet migrated to MediaInfo. */
export function mediaInfoToMetadata(info) {
  if (!info) return null
  const primary = info.videoTracks[0]
  const frameRate = primary?.frameRate
  const fps = frameRate ? (frameRate.average ?? frameRate.nominal ?? 0) : 0
  const width = primary?.displayWidth ?? info.still?.width ?? 0
  const height = primary?.displayHeight ?? info.still?.height ?? 0
  return {
    durationSec: info.duration ?? 0,
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) ? height : 0,
    fps: Number.isFinite(fps) ? fps : 0,
    hasAudio: info.audioTracks.length > 0
  }
}

function uniqueSortedCodecs(list) {
  if (!Array.isArray(list)) return []
  return [...new Set(list.filter(entry => typeof entry === 'string' && entry).map(entry => entry.toLowerCase()))].sort()
}

export function buildMediaCapabilities(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  return {
    hasWebCodecs: source.hasWebCodecs === true,
    hasAudioGraph: source.hasAudioGraph === true,
    decodableVideoCodecs: uniqueSortedCodecs(source.decodableVideoCodecs),
    decodableAudioCodecs: uniqueSortedCodecs(source.decodableAudioCodecs),
    encodableVideoCodecs: uniqueSortedCodecs(source.encodableVideoCodecs),
    encodableAudioCodecs: uniqueSortedCodecs(source.encodableAudioCodecs)
  }
}
