// tmcut-core — media info tests. Run: node --test test/
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCompatibility,
  buildFrameRate,
  buildMediaCapabilities,
  buildMediaInfo,
  classifyImportStatus,
  mediaInfoToMetadata,
  pickDuration
} from '../src/mediaInfo.mjs'

const MP4_VIDEO = {
  name: 'clip.mp4',
  size: 4096,
  container: 'mp4',
  mimeType: 'video/mp4',
  demuxable: true,
  seekable: true,
  duration: { container: 12.5 },
  videoTracks: [{ codec: 'avc1.640028', codedWidth: 1920, codedHeight: 1080, nominalFrameRate: 29.97, duration: 12.5 }],
  audioTracks: [{ codec: 'opus', sampleRate: 48000, channels: 2, duration: 12.5 }]
}

function codes(info) {
  return info.probeWarnings.map(entry => entry.code)
}

describe('pickDuration', () => {
  it('prefers the container, then the longest track, then an estimate', () => {
    assert.equal(pickDuration({ duration: { container: 10, track: 4 } }, [4, 6]).durationSource, 'container')
    assert.equal(pickDuration({ duration: {} }, [4, 9.25, 6]).duration, 9.25)
    assert.equal(pickDuration({ duration: { track: 9.25 } }, [9.25]).durationSource, 'track')
    assert.equal(pickDuration({ duration: { estimated: 7 } }, []).durationSource, 'estimated')
    assert.equal(pickDuration({}, []).durationSource, 'unknown')
  })

  it('rejects a zero or non-finite container duration instead of trusting it', () => {
    assert.equal(pickDuration({ duration: { container: 0 } }, [3.5]).durationSource, 'track')
    assert.equal(pickDuration({ duration: { container: Number.POSITIVE_INFINITY } }, []).durationSource, 'unknown')
  })

  it('reports a container/track disagreement beyond half a second', () => {
    assert.equal(pickDuration({ duration: { container: 10 } }, [9.8]).mismatchSec, 0)
    assert.equal(pickDuration({ duration: { container: 10 } }, [9]).mismatchSec, 1)
  })
})

describe('buildFrameRate', () => {
  it('leaves the rate undefined when the demuxer read nothing — never 30', () => {
    assert.equal(buildFrameRate({}), undefined)
    assert.equal(buildFrameRate({ nominalFrameRate: 0 }), undefined)
    assert.equal(buildFrameRate({ averageFrameRate: null }), undefined)
  })

  it('marks a measured average as measured and keeps 29.97 rational', () => {
    const info = buildFrameRate({ nominalFrameRate: 30, averageFrameRate: 29.97002997002997 })
    assert.equal(info.source, 'measured')
    assert.equal(info.rational.numerator, 30000)
    assert.equal(info.rational.denominator, 1001)
  })

  it('falls back to the nominal rate when no timestamps were read', () => {
    const info = buildFrameRate({ nominalFrameRate: 25 })
    assert.equal(info.source, 'nominal')
    assert.equal(info.average, undefined)
    assert.equal(info.isVariable, false)
  })
})

describe('buildMediaInfo', () => {
  it('normalizes a well-formed mp4 into a ready asset', () => {
    const info = buildMediaInfo(MP4_VIDEO)
    assert.equal(info.kind, 'video')
    assert.equal(info.duration, 12.5)
    assert.equal(info.durationSource, 'container')
    assert.equal(info.importStatus, 'ready')
    assert.equal(info.videoTracks[0].displayWidth, 1920)
    assert.equal(info.videoTracks[0].displayHeight, 1080)
    assert.equal(info.videoTracks[0].id, 'video-1')
    assert.deepEqual(codes(info), [])
  })

  it('keeps an unread frame rate as a warning, not a number', () => {
    const info = buildMediaInfo({ ...MP4_VIDEO, videoTracks: [{ codec: 'avc1', codedWidth: 640, codedHeight: 360 }] })
    assert.equal(info.videoTracks[0].frameRate, undefined)
    assert.ok(codes(info).includes('FPS_UNKNOWN'))
    assert.ok(info.compatibility.limitations.includes('frame-rate-unknown'))
    assert.equal(info.importStatus, 'ready')
  })

  it('names a variable frame rate instead of averaging it away', () => {
    const info = buildMediaInfo({
      ...MP4_VIDEO,
      videoTracks: [{ codec: 'avc1', codedWidth: 1280, codedHeight: 720, nominalFrameRate: 30, averageFrameRate: 27.4, isVariableFrameRate: true }]
    })
    assert.equal(info.videoTracks[0].frameRate.isVariable, true)
    assert.ok(codes(info).includes('FPS_VARIABLE'))
    assert.ok(info.compatibility.limitations.includes('variable-frame-rate'))
  })

  it('derives decode support from the capability list when the track is silent', () => {
    const info = buildMediaInfo({
      ...MP4_VIDEO,
      videoTracks: [{ codec: 'av01.0.19.08', codedWidth: 1920, codedHeight: 1080, nominalFrameRate: 24 }],
      capabilities: { decodableVideoCodecs: ['avc1.640028', 'vp09.00.10.08'], encodableVideoCodecs: ['avc1.640028'] }
    })
    assert.equal(info.videoTracks[0].canDecode, false)
    assert.equal(info.videoTracks[0].canEncode, false)
    assert.equal(info.compatibility.canPreview, false)
    assert.equal(info.compatibility.canExportSourceCodec, false)
    assert.equal(info.importStatus, 'partial')
    assert.ok(codes(info).includes('VIDEO_NOT_DECODABLE'))
  })

  it('trusts an explicit track answer over the capability list', () => {
    const info = buildMediaInfo({
      ...MP4_VIDEO,
      videoTracks: [{ codec: 'hevc', codedWidth: 1920, codedHeight: 1080, nominalFrameRate: 25, canDecode: true, canEncode: false }],
      capabilities: { decodableVideoCodecs: [] }
    })
    assert.equal(info.videoTracks[0].canDecode, true)
    assert.equal(info.compatibility.canDecodeVideo, true)
    assert.equal(info.compatibility.canExportSourceCodec, false)
  })

  it('flags an undemuxable container as unsupported', () => {
    const info = buildMediaInfo({ ...MP4_VIDEO, demuxable: false, container: 'rmvb' })
    assert.equal(info.compatibility.canDemux, false)
    assert.equal(info.importStatus, 'unsupported')
    assert.ok(codes(info).includes('CONTAINER_UNDEMODABLE'))
  })

  it('warns without blocking when container and track durations disagree', () => {
    const info = buildMediaInfo({
      ...MP4_VIDEO,
      duration: { container: 20 },
      videoTracks: [{ ...MP4_VIDEO.videoTracks[0], duration: 18 }]
    })
    assert.equal(info.duration, 20)
    assert.ok(codes(info).includes('DURATION_MISMATCH'))
    assert.equal(info.importStatus, 'ready')
  })

  it('reports a still image as an image, not as a broken video', () => {
    const info = buildMediaInfo({ name: 'poster.png', size: 20000, mimeType: 'image/png', demuxable: false, still: { width: 3000, height: 2000, decodable: true } })
    assert.equal(info.kind, 'image')
    assert.equal(info.compatibility.canPreview, true)
    assert.equal(info.importStatus, 'ready')
    assert.deepEqual(codes(info), [])
    assert.deepEqual(mediaInfoToMetadata(info), { durationSec: 0, width: 3000, height: 2000, fps: 0, hasAudio: false })
  })

  it('calls an undecodable still unsupported rather than partial', () => {
    const info = buildMediaInfo({ name: 'odd.tif', size: 10, demuxable: false, still: { decodable: false } })
    assert.equal(info.kind, 'image')
    assert.ok(codes(info).includes('IMAGE_NOT_DECODABLE'))
    assert.equal(info.importStatus, 'unsupported')
  })

  it('treats audio-only as previewable without a video track', () => {
    const info = buildMediaInfo({
      name: 'voice.mp3',
      size: 900,
      demuxable: true,
      duration: { container: 4 },
      audioTracks: [{ codec: 'mp3', sampleRate: 44100, channels: 1 }]
    })
    assert.equal(info.kind, 'audio')
    assert.equal(info.compatibility.canDecodeVideo, false)
    assert.equal(info.compatibility.canPreview, true)
    assert.equal(info.importStatus, 'ready')
    assert.equal(info.videoTracks.length, 0)
  })

  it('keeps subtitle tracks for the subtitle renderer decision', () => {
    const info = buildMediaInfo({ ...MP4_VIDEO, subtitleTracks: [{ codec: 'wvtt', language: 'vi', label: 'Vietnamese' }] })
    assert.equal(info.subtitleTracks[0].id, 'subtitle-1')
    assert.equal(info.subtitleTracks[0].language, 'vi')
  })

  it('carries rotation, pixel aspect and HDR into honest warnings', () => {
    const info = buildMediaInfo({
      ...MP4_VIDEO,
      videoTracks: [{ codec: 'avc1', codedWidth: 1920, codedHeight: 1080, nominalFrameRate: 30, rotation: 450, pixelAspectRatio: { numerator: 4, denominator: 3 }, hasHighDynamicRange: true }]
    })
    assert.equal(info.videoTracks[0].rotation, 90)
    assert.equal(info.videoTracks[0].pixelAspectRatio, 4 / 3)
    assert.ok(codes(info).includes('TRACK_ROTATED'))
    assert.ok(codes(info).includes('HIGH_DYNAMIC_RANGE'))
  })

  it('says error when nothing at all was learned', () => {
    const info = buildMediaInfo({ name: 'junk.bin', size: 0 })
    assert.equal(info.importStatus, 'error')
    assert.equal(info.kind, 'unknown')
    assert.ok(codes(info).includes('DURATION_UNKNOWN'))
    assert.equal(classifyImportStatus(null), 'error')
  })

  it('does not repeat the same warning twice', () => {
    const info = buildMediaInfo({ ...MP4_VIDEO, size: null })
    assert.equal(codes(info).filter(code => code === 'SIZE_UNKNOWN').length, 1)
  })
})

describe('buildCompatibility', () => {
  it('does not claim an export codec without evidence', () => {
    const compatibility = buildCompatibility({
      kind: 'video',
      demuxable: true,
      videoTracks: [{ id: 'video-1', codec: 'avc1' }],
      audioTracks: []
    })
    assert.equal(compatibility.canExportSourceCodec, false)
    assert.ok(compatibility.limitations.includes('source-codec-encode'))
    assert.equal(compatibility.canDecodeAudio, false)
  })

  it('requires an encoder for every kind the file carries', () => {
    const audioOnly = buildCompatibility({
      kind: 'audio',
      demuxable: true,
      videoTracks: [],
      audioTracks: [{ id: 'audio-1', codec: 'opus', canDecode: true }]
    })
    assert.equal(audioOnly.canPreview, true, 'a decodable audio file still plays')
    assert.equal(audioOnly.canExportSourceCodec, false, 'no encoder read means no lossless export claim')
    assert.ok(audioOnly.limitations.includes('source-audio-encode'))

    const bothProven = buildCompatibility({
      kind: 'video',
      demuxable: true,
      videoTracks: [{ id: 'video-1', codec: 'avc1', canDecode: true, canEncode: true }],
      audioTracks: [{ id: 'audio-1', codec: 'aac', canDecode: true, canEncode: true }]
    })
    assert.equal(bothProven.canExportSourceCodec, true)

    const videoEncodesAudioDoesNot = buildCompatibility({
      kind: 'video',
      demuxable: true,
      videoTracks: [{ id: 'video-1', codec: 'avc1', canDecode: true, canEncode: true }],
      audioTracks: [{ id: 'audio-1', codec: 'alac', canDecode: true, canEncode: false }]
    })
    assert.equal(videoEncodesAudioDoesNot.canExportSourceCodec, false, 'one unencodable track blocks the mux')
  })
})

describe('buildMediaCapabilities', () => {
  it('lowercases, dedupes and sorts the codec lists', () => {
    const capabilities = buildMediaCapabilities({
      hasWebCodecs: true,
      decodableVideoCodecs: ['VP9', 'avc1', 'vp9', '', null],
      encodableVideoCodecs: ['avc1'],
      decodableAudioCodecs: undefined
    })
    assert.equal(capabilities.hasWebCodecs, true)
    assert.equal(capabilities.hasAudioGraph, false)
    assert.deepEqual(capabilities.decodableVideoCodecs, ['avc1', 'vp9'])
    assert.deepEqual(capabilities.encodableVideoCodecs, ['avc1'])
    assert.deepEqual(capabilities.decodableAudioCodecs, [])
  })
})

describe('mediaInfoToMetadata', () => {
  it('prefers the measured rate and keeps the legacy five fields', () => {
    const info = buildMediaInfo({
      ...MP4_VIDEO,
      videoTracks: [{ codec: 'avc1', codedWidth: 1280, codedHeight: 720, nominalFrameRate: 30, averageFrameRate: 29.97 }]
    })
    const metadata = mediaInfoToMetadata(info)
    assert.equal(metadata.durationSec, 12.5)
    assert.equal(metadata.width, 1280)
    assert.equal(metadata.height, 720)
    assert.equal(metadata.fps, 29.97)
    assert.equal(metadata.hasAudio, true)
    assert.equal(mediaInfoToMetadata(null), null)
  })
})
