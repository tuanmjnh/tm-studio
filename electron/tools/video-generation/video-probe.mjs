// =============================================================================
//  TM TOOLS - Shared video probing helper (main process only).
//
//  Reads width/height/duration/fps and the codec of a local media file with
//  mediabunny's demuxer, in-process. There is no external binary: ADR-028
//  retired ffprobe, and `FilePathSource` reads the same bytes a spawn would
//  have — without a process, without a shell, and without a path that has to
//  be escaped.
// =============================================================================

import { Input, ALL_FORMATS, FilePathSource } from 'mediabunny'

/**
 * Probe a local media file.
 *
 * `fps` is the underlying rate when the container states one, else the average
 * the demuxer measures; `0` means "the file does not say", never a made-up 30.
 * Callers that need a usable rate apply their own default.
 *
 * @param {string} filePath Absolute path to the media file
 * @returns {Promise<{ width: number, height: number, durationSec: number, fps: number, codec: string | null }>}
 */
export async function probeVideo(filePath) {
  const source = new FilePathSource(filePath)
  const input = new Input({ formats: ALL_FORMATS, source })

  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('probeVideo: no video stream found')

    const [width, height, durationSec, metrics, codec] = await Promise.all([
      track.getDisplayWidth(),
      track.getDisplayHeight(),
      input.computeDuration(),
      track.computeFrameRateMetrics().catch(() => null),
      track.getCodec().catch(() => null)
    ])

    return {
      width: Number(width) || 0,
      height: Number(height) || 0,
      durationSec: Number.isFinite(durationSec) ? durationSec : 0,
      fps: metrics?.underlyingFrameRate ?? metrics?.averageFrameRate ?? 0,
      codec: codec ?? null
    }
  } finally {
    await input.dispose?.()
  }
}

export default { probeVideo }
