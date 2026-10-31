import type { CompileOptions } from './types'

/**
 * Returns the pixel format that preserves alpha for the given encoder.
 * Transparent canvas exports need an alpha-capable pix_fmt, otherwise
 * the composited alpha is silently dropped (verified: libx264 with
 * yuv420p discards the alpha channel of a `color=c=0x00000000` base).
 */
function alphaPixFmt(encoder: string): string {
  switch (encoder) {
    case 'libx264':
      return 'yuva420p'
    case 'libx265':
      return 'yuva420p'
    case 'libvpx-vp9':
      return 'yuva420p'
    case 'prores_ks':
      return 'yuva444p10le'
    default:
      // Hardware encoders (NVENC/QSV/AMF) have unreliable alpha support;
      // keep their native format and let the caller fall back to software.
      return ''
  }
}

/**
 * Builds video encoding CLI flags based on chosen encoder, CRF, and bitrate.
 * Supports hardware acceleration (NVENC, QSV, AMF) and intermediate/web formats (ProRes, VP9, x264/x265).
 *
 * When `options.transparent` is set the canvas base is alpha-carrying
 * (Phase 4), so the encoder picks an alpha-capable pix_fmt instead of the
 * lossy yuv420p/nv12.
 */
export function buildVideoCodecArgs(options: CompileOptions = {}): string[] {
  const enc = options.encoder || 'libx264'
  const videoCodecArgs: string[] = ['-c:v', enc]

  // Bitrate vs CRF rate control (roadmap R6)
  const hasBitrate = typeof options.bitrate === 'number' && options.bitrate > 0
  const bitrateStr = hasBitrate
    ? (options.bitrate! >= 1000 ? `${options.bitrate}k` : `${options.bitrate}M`)
    : ''

  // Transparent canvas: alpha-capable pix_fmt (Phase 4 / R76).
  const transparent = Boolean(options.transparent)
  const alphaFmt = transparent ? alphaPixFmt(enc) : ''

  if (enc === 'h264_nvenc' || enc === 'hevc_nvenc') {
    videoCodecArgs.push('-preset', 'p4', '-pix_fmt', alphaFmt || 'yuv420p')
    if (hasBitrate) {
      videoCodecArgs.push('-b:v', bitrateStr)
    } else {
      videoCodecArgs.push('-cq', String(options.crf || 22))
    }
  } else if (enc === 'h264_qsv' || enc === 'hevc_qsv') {
    videoCodecArgs.push('-pix_fmt', alphaFmt || 'nv12')
    if (hasBitrate) {
      videoCodecArgs.push('-b:v', bitrateStr)
    } else {
      videoCodecArgs.push('-global_quality', String(options.crf || 22))
    }
  } else if (enc === 'h264_amf' || enc === 'hevc_amf') {
    videoCodecArgs.push('-pix_fmt', alphaFmt || 'yuv420p')
    if (hasBitrate) {
      videoCodecArgs.push('-b:v', bitrateStr)
    } else {
      videoCodecArgs.push('-rc', 'cqp', '-qp_i', String(options.crf || 22), '-qp_p', String(options.crf || 22))
    }
  } else if (enc === 'prores_ks') {
    videoCodecArgs.push('-profile:v', '3', '-pix_fmt', alphaFmt || 'yuv422p10le')
  } else if (enc === 'libvpx-vp9') {
    videoCodecArgs.push('-pix_fmt', alphaFmt || 'yuv420p')
    if (hasBitrate) {
      videoCodecArgs.push('-b:v', bitrateStr)
    } else {
      videoCodecArgs.push('-crf', String(options.crf || 22), '-b:v', '0')
    }
  } else {
    // Standard software libx264 / libx265
    videoCodecArgs.push('-preset', 'fast', '-pix_fmt', alphaFmt || 'yuv420p')
    if (hasBitrate) {
      videoCodecArgs.push('-b:v', bitrateStr)
    } else {
      videoCodecArgs.push('-crf', String(options.crf || 22))
    }
  }

  return videoCodecArgs
}

/**
 * Builds audio encoding CLI flags based on output container format.
 * Defaults to AAC 192k for MP4/MKV and Opus 128k for WebM.
 */
export function buildAudioCodecArgs(outputPath: string): string[] {
  const isWebm = outputPath.toLowerCase().endsWith('.webm')
  return isWebm
    ? ['-c:a', 'libopus', '-b:a', '128k']
    : ['-c:a', 'aac', '-b:a', '192k']
}

/**
 * Builds filtergraph chains for GIF generation with two-pass palettegen/paletteuse.
 */
export function buildGifPipeline(
  inStream: string,
  canvasW: number,
  outScale: number
): { chains: string[], outStream: string, gifW: number } {
  const gifW = Math.min(1280, Math.max(160, Math.floor((canvasW * outScale) / 2) * 2))
  const chains: string[] = [
    `${inStream}fps=15,scale=${gifW}:-2[gif_in]`,
    '[gif_in]split[gif_pre_a][gif_pre_b]',
    '[gif_pre_a]palettegen=stats_mode=diff[gif_pal]',
    '[gif_pre_b][gif_pal]paletteuse=dither=bayer:bayer_scale=4[gif_out]'
  ]
  return {
    chains,
    outStream: '[gif_out]',
    gifW
  }
}
