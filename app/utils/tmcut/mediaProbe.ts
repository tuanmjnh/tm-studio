/**
 * MediaProbeService (zero-FFmpeg plan §4) — the only place the app talks to a
 * demuxer.
 *
 * One implementation answers both hosts: the desktop file scheme answers
 * `Accept-Ranges: bytes` with real 206 responses (electron/media-protocol.cjs),
 * so Mediabunny's range-requesting UrlSource reads `media://local/...` exactly
 * like an http URL. That is what makes this a shared service rather than a
 * browser-only fallback next to ffprobe.
 *
 * It collects facts and nothing more: normalization, duration precedence,
 * warnings and the compatibility report all live in tmcut-core, so Web and
 * Electron cannot disagree about what the same file is.
 */
import {
  ALL_FORMATS,
  BlobSource,
  Input,
  UrlSource,
  getDecodableAudioCodecs,
  getDecodableVideoCodecs,
  getEncodableAudioCodecs,
  getEncodableVideoCodecs
} from 'mediabunny'
import type { InputAudioTrack, InputVideoTrack } from 'mediabunny'
import { buildMediaCapabilities, buildMediaInfo, classifyAssetKind, mediaInfoToMetadata } from 'tmcut-core'
import type {
  TmcutMediaCapabilities,
  TmcutMediaInfo,
  TmcutMediaMetadata,
  TmcutProbeAudioTrack,
  TmcutProbeDescriptor,
  TmcutProbeOptions,
  TmcutProbeSource,
  TmcutProbeVideoTrack
} from 'tmcut-core'

/**
 * The core source widened with the one thing core may not name (rule 13: no
 * DOM): bytes already in hand from an import dialog. They win over `url`,
 * because a picked File has no playable location until it is stored.
 */
export interface TmcutHostProbeSource extends TmcutProbeSource {
  blob?: Blob
}

/** Core options widened with the caller's cancellation handle. */
export interface TmcutHostProbeOptions extends TmcutProbeOptions {
  signal?: AbortSignal
}

let capabilitiesPromise: Promise<TmcutMediaCapabilities> | null = null

function hasWebCodecs(): boolean {
  return typeof globalThis.VideoDecoder !== 'undefined' && typeof globalThis.VideoEncoder !== 'undefined'
}

function hasAudioGraph(): boolean {
  return typeof globalThis.AudioContext !== 'undefined' || typeof globalThis.OfflineAudioContext !== 'undefined'
}

/**
 * Capability answers are a property of the runtime, so they are asked once.
 * Without WebCodecs there is no codec table to read, and an empty list means
 * "nothing is known" — core then leaves `canDecode` undefined instead of
 * guessing true.
 */
export function getMediaCapabilities(): Promise<TmcutMediaCapabilities> {
  capabilitiesPromise ??= (async () => {
    if (!hasWebCodecs()) return buildMediaCapabilities({ hasWebCodecs: false, hasAudioGraph: hasAudioGraph() })
    const [decodableVideoCodecs, decodableAudioCodecs, encodableVideoCodecs, encodableAudioCodecs] = await Promise.all([
      getDecodableVideoCodecs().catch(() => []),
      getDecodableAudioCodecs().catch(() => []),
      getEncodableVideoCodecs().catch(() => []),
      getEncodableAudioCodecs().catch(() => [])
    ])
    return buildMediaCapabilities({
      hasWebCodecs: true,
      hasAudioGraph: hasAudioGraph(),
      decodableVideoCodecs,
      decodableAudioCodecs,
      encodableVideoCodecs,
      encodableAudioCodecs
    })
  })()
  return capabilitiesPromise
}

function requireReadable(source: TmcutHostProbeSource): void {
  if (!source.blob && !source.url) throw new Error(`probe ${source.name || 'untitled'}: no bytes and no location to read`)
}

function makeInput(source: TmcutHostProbeSource): Input {
  requireReadable(source)
  const ref = source.blob ? new BlobSource(source.blob) : new UrlSource(String(source.url))
  return new Input({ formats: ALL_FORMATS, source: ref })
}

function aborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true
}

/**
 * A cancelled probe throws. Returning a descriptor instead would make the
 * caller read a half-read file as an unsupported one, which is the opposite of
 * what happened; §4.3 asks for cancellation, not for a false verdict.
 */
function throwIfCancelled(signal: AbortSignal | undefined, name: string): void {
  if (aborted(signal)) throw new Error(`probe cancelled: ${name}`)
}

/** `VideoColorSpaceInit` has no single name, so the report keeps the triple. */
function colorSpaceName(space: Awaited<ReturnType<InputVideoTrack['getColorSpace']>> | null): string | undefined {
  if (!space) return undefined
  const parts = [space.primaries, space.transfer, space.matrix].filter(part => typeof part === 'string')
  return parts.length > 0 ? parts.join('/') : undefined
}

async function readVideoTrack(track: InputVideoTrack, capabilities: TmcutMediaCapabilities, options: TmcutProbeOptions): Promise<TmcutProbeVideoTrack> {
  const codec = await track.getCodec().catch(() => null)
  const pixelAspectRatio = await track.getPixelAspectRatio()
  const metrics = options.measureFrameRate === false ? null : await track.computeFrameRateMetrics().catch(() => null)
  const colorSpace = await track.getColorSpace().catch(() => null)
  const highDynamicRange = await track.hasHighDynamicRange().catch(() => false)
  return {
    codec,
    codedWidth: await track.getCodedWidth().catch(() => null),
    codedHeight: await track.getCodedHeight().catch(() => null),
    displayWidth: await track.getDisplayWidth().catch(() => null),
    displayHeight: await track.getDisplayHeight().catch(() => null),
    rotation: await track.getRotation().catch(() => null),
    pixelAspectRatio: pixelAspectRatio ? { numerator: pixelAspectRatio.num, denominator: pixelAspectRatio.den } : null,
    nominalFrameRate: metrics?.underlyingFrameRate ?? null,
    averageFrameRate: metrics?.averageFrameRate ?? null,
    isVariableFrameRate: metrics ? !metrics.frameRateIsConstant : null,
    bitrate: await track.getBitrate().catch(() => null),
    duration: await track.getDurationFromMetadata().catch(() => null),
    colorSpace: colorSpaceName(colorSpace),
    hasHighDynamicRange: highDynamicRange === true,
    canDecode: await track.canDecode().catch(() => false),
    canEncode: codec ? capabilities.encodableVideoCodecs.includes(String(codec)) : undefined
  }
}

async function readAudioTrack(track: InputAudioTrack, capabilities: TmcutMediaCapabilities): Promise<TmcutProbeAudioTrack> {
  const codec = await track.getCodec().catch(() => null)
  return {
    codec,
    sampleRate: await track.getSampleRate().catch(() => null),
    channels: await track.getNumberOfChannels().catch(() => null),
    bitrate: await track.getBitrate().catch(() => null),
    duration: await track.getDurationFromMetadata().catch(() => null),
    canDecode: await track.canDecode().catch(() => false),
    canEncode: codec ? capabilities.encodableAudioCodecs.includes(String(codec)) : undefined
  }
}

/**
 * Still images have no timeline and no container to demux, so the honest probe
 * is "can this runtime raster it at all".
 */
async function readStill(source: TmcutHostProbeSource, signal?: AbortSignal): Promise<TmcutProbeDescriptor['still']> {
  try {
    const blob = source.blob ?? await (await fetch(String(source.url), { signal })).blob()
    const bitmap = await createImageBitmap(blob)
    const still = { width: bitmap.width, height: bitmap.height, decodable: true }
    bitmap.close?.()
    return still
  } catch (error) {
    if (aborted(signal)) throw error
    return { decodable: false }
  }
}

async function collect(source: TmcutHostProbeSource, options: TmcutHostProbeOptions): Promise<TmcutProbeDescriptor> {
  // Outside the try below: a source with nothing to read is a caller bug, and a
  // descriptor would report it to the import list as a file this runtime rejects.
  requireReadable(source)
  const capabilities = await getMediaCapabilities()
  const base: TmcutProbeDescriptor = {
    name: source.name,
    size: source.size,
    mimeType: source.mimeType,
    capabilities,
    videoTracks: [],
    audioTracks: [],
    subtitleTracks: []
  }
  if (source.kind === 'image') {
    return { ...base, demuxable: false, still: await readStill(source, options.signal) }
  }

  let input: Input | null = null
  const onAbort = () => input?.dispose()
  try {
    input = makeInput(source)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (!(await input.canRead()) || aborted(options.signal)) {
      throwIfCancelled(options.signal, source.name)
      // Not a container the demuxer knows: a still is still usable, anything
      // else is reported undemuxable so core can call it unsupported.
      if (classifyAssetKind(source.name) === 'image') {
        return { ...base, demuxable: false, still: await readStill(source, options.signal) }
      }
      return { ...base, demuxable: false }
    }
    const format = await input.getFormat()
    const videoTracks = await input.getVideoTracks()
    const audioTracks = await input.getAudioTracks()
    const containerDuration = await input.getDurationFromMetadata()
    const needsPacketScan = containerDuration === null && (videoTracks.length > 0 || audioTracks.length > 0)
    const scannedDuration = needsPacketScan ? await input.computeDuration() : null
    throwIfCancelled(options.signal, source.name)
    const tags = await input.getMetadataTags().catch(() => ({}))
    return {
      ...base,
      container: format?.name ?? null,
      mimeType: source.mimeType ?? format?.mimeType ?? null,
      demuxable: true,
      seekable: true,
      duration: { container: containerDuration, estimated: Number.isFinite(scannedDuration) ? scannedDuration : null },
      videoTracks: await Promise.all(videoTracks.map(track => readVideoTrack(track, capabilities, options))),
      audioTracks: await Promise.all(audioTracks.map(track => readAudioTrack(track, capabilities))),
      tags: tags as Record<string, unknown>
    }
  } catch (error) {
    if (aborted(options.signal)) throw error
    if (classifyAssetKind(source.name) === 'image') {
      return { ...base, demuxable: false, still: await readStill(source, options.signal) }
    }
    return { ...base, demuxable: false }
  } finally {
    options.signal?.removeEventListener('abort', onAbort)
    input?.dispose()
  }
}

export async function probeMedia(source: TmcutHostProbeSource, options: TmcutHostProbeOptions = {}): Promise<TmcutMediaInfo> {
  return buildMediaInfo(await collect(source, options))
}

/** The five-field answer, for callers that have not moved to MediaInfo yet. */
export async function probeMediaMetadata(source: TmcutHostProbeSource, options: TmcutHostProbeOptions = {}): Promise<TmcutMediaMetadata | null> {
  const info = await probeMedia(source, options)
  return mediaInfoToMetadata(info)
}
