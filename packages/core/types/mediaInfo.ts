// MediaProbeService contract (zero-FFmpeg plan §4). Type-only.
//
// The host collects a descriptor from whatever demuxer it runs, and tmcut-core
// turns it into `TmcutMediaInfo`. Only fields the host actually read are
// populated: an absent field means "no evidence", never a guessed default.
import type { FrameRate } from './dsl.js'

export type TmcutDurationSource = 'container' | 'track' | 'estimated' | 'unknown'

export type TmcutImportStatus = 'queued' | 'probing' | 'ready' | 'partial' | 'unsupported' | 'error'

export interface TmcutMediaWarning {
  code: string
  message: string
  severity: 'info' | 'warning' | 'error'
}

export interface TmcutFrameRateInfo {
  /** Rate declared by the container/track metadata. */
  nominal?: number
  /** Rate measured from real packet timestamps. */
  average?: number
  /** Derivation: `nominal` from metadata, `measured` from timestamps. */
  source?: 'nominal' | 'measured'
  rational?: FrameRate
  isVariable?: boolean
}

export interface TmcutVideoTrackInfo {
  id: string
  codec?: string
  codedWidth?: number
  codedHeight?: number
  displayWidth?: number
  displayHeight?: number
  frameRate?: TmcutFrameRateInfo
  bitrate?: number
  rotation?: number
  pixelAspectRatio?: number
  colorSpace?: string
  hasHighDynamicRange?: boolean
  duration?: number
  canDecode?: boolean
  canEncode?: boolean
}

export interface TmcutAudioTrackInfo {
  id: string
  codec?: string
  sampleRate?: number
  channels?: number
  channelLayout?: string
  bitrate?: number
  duration?: number
  canDecode?: boolean
  canEncode?: boolean
}

export interface TmcutSubtitleTrackInfo {
  id: string
  codec?: string
  language?: string
  label?: string
  duration?: number
}

export interface TmcutMediaCompatibility {
  canDemux: boolean
  canDecodeVideo: boolean
  canDecodeAudio: boolean
  canPreview: boolean
  canExportSourceCodec: boolean
  limitations: string[]
}

/**
 * A still image is not a demuxable timeline, so it reports one raster instead
 * of a fabricated one-frame track.
 */
export interface TmcutStillInfo {
  width?: number
  height?: number
  decodable?: boolean
  codec?: string
}

export interface TmcutMediaInfo {
  id: string
  name: string
  size: number
  kind: 'video' | 'audio' | 'image' | 'unknown'
  mimeType?: string
  container?: string
  duration?: number
  durationSource: TmcutDurationSource
  isSeekable?: boolean
  videoTracks: TmcutVideoTrackInfo[]
  audioTracks: TmcutAudioTrackInfo[]
  subtitleTracks: TmcutSubtitleTrackInfo[]
  still?: TmcutStillInfo
  metadata?: Record<string, unknown>
  probeWarnings: TmcutMediaWarning[]
  compatibility: TmcutMediaCompatibility
  importStatus: TmcutImportStatus
}

export interface TmcutMediaCapabilities {
  hasWebCodecs: boolean
  hasAudioGraph: boolean
  decodableVideoCodecs: string[]
  decodableAudioCodecs: string[]
  encodableVideoCodecs: string[]
  encodableAudioCodecs: string[]
}

/** What a host reports about one video track, in plain data. */
export interface TmcutProbeVideoTrack {
  id?: string
  codec?: string | null
  codedWidth?: number | null
  codedHeight?: number | null
  displayWidth?: number | null
  displayHeight?: number | null
  /** Float rates; the host never invents them when the demuxer is silent. */
  nominalFrameRate?: number | null
  averageFrameRate?: number | null
  isVariableFrameRate?: boolean | null
  bitrate?: number | null
  rotation?: number | null
  /** Rational pixel aspect ratio, e.g. { numerator: 4, denominator: 3 }. */
  pixelAspectRatio?: FrameRate | null
  colorSpace?: string | null
  hasHighDynamicRange?: boolean | null
  duration?: number | null
  canDecode?: boolean | null
  canEncode?: boolean | null
}

export interface TmcutProbeAudioTrack {
  id?: string
  codec?: string | null
  sampleRate?: number | null
  channels?: number | null
  channelLayout?: string | null
  bitrate?: number | null
  duration?: number | null
  canDecode?: boolean | null
  canEncode?: boolean | null
}

export interface TmcutProbeSubtitleTrack {
  id?: string
  codec?: string | null
  language?: string | null
  label?: string | null
  duration?: number | null
}

export interface TmcutProbeDescriptor {
  id?: string
  name: string
  size?: number | null
  mimeType?: string | null
  container?: string | null
  /** False when the demuxer did not recognize the container at all. */
  demuxable?: boolean | null
  seekable?: boolean | null
  /** One entry per way of knowing the length; the core picks the first real one. */
  duration?: {
    container?: number | null
    track?: number | null
    estimated?: number | null
  }
  videoTracks?: TmcutProbeVideoTrack[]
  audioTracks?: TmcutProbeAudioTrack[]
  subtitleTracks?: TmcutProbeSubtitleTrack[]
  tags?: Record<string, unknown> | null
  capabilities?: Partial<TmcutMediaCapabilities> | null
  still?: TmcutStillInfo | null
}

/**
 * What the caller asks about, in plain data. Rule 13 keeps core free of the
 * DOM, so in-memory bytes are not named here: a host extends this interface with
 * its own `blob`/`File` field and hands the widened object to its service.
 * `size` and `mimeType` are the facts a host already holds from the filesystem
 * or the picked File, so a probe never needs an extra round-trip for them.
 */
export interface TmcutProbeSource {
  /** File name or stored path: it decides kind and container guesses. */
  name: string
  /** Playable location, as this host plays it. */
  url?: string
  size?: number
  mimeType?: string
  /** Skips the demuxer for stills, which have no container to read. */
  kind?: 'video' | 'audio' | 'image'
}

export interface TmcutProbeOptions {
  /** Frame-rate probing reads packets; false keeps the probe cheap. */
  measureFrameRate?: boolean
}

/**
 * The facts a caller already holds about a stored file, so one probe never asks
 * for them again: an asset record carries its byte size, and a picker or an
 * import directory carries the MIME type and the kind.
 */
export type TmcutProbeHints = Pick<TmcutProbeSource, 'size' | 'mimeType' | 'kind'>

/**
 * The service abstraction of plan §4 — what the UI is allowed to call. A
 * component asks this, never a demuxer (rule 12), so swapping the collector
 * under it cannot reach the editor.
 */
export interface TmcutMediaProbeService {
  probe(source: TmcutProbeSource, options?: TmcutProbeOptions): Promise<TmcutMediaInfo>
  getCapabilities(): Promise<TmcutMediaCapabilities>
}
