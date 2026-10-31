import type { TmcutProject } from '~/composables/useTmcutProject'
import type {
  TmcutCompileMode,
  TmcutCompileRange,
  CompileOptions,
  CompileResult
} from './types'
import { RenderGraph, ffmpegColor, lutFileFilter } from './graph'
import { canvasFpsValue } from '../canvas'
import { applyTextOverlays } from './text'
import { compileAudioOnly, compileBackgroundAudio } from './audio'
import { compileVideoPipeline } from './video'
import { buildVideoCodecArgs, buildAudioCodecArgs, buildGifPipeline } from './encoder'
import { renderVideoClips, renderAudioClips, renderTextClips, renderClipDuration } from './clip'
import { buildBackgroundSource } from '@tmcut-core'

// Re-export all sub-modules for clean consuming
export * from './types'
export * from './graph'
export * from './clip'
export * from './text'
export * from './audio'
export * from './video'
export * from './encoder'

/**
 * Compiles a TMCut project timeline into an FFmpeg command argument array.
 * Defaults (video mode, full range, native scale/fps) reproduce the original
 * single-mode compiler output exactly.
 */
export function compileTimelineToFfmpeg(
  project: TmcutProject,
  outputPath: string,
  options: CompileOptions = {}
): CompileResult {
  const canvasW = project.canvas?.width || 1920
  const canvasH = project.canvas?.height || 1080
  const fps = canvasFpsValue(project.canvas)
  const mode: TmcutCompileMode = options.mode || 'video'

  const videoTrack = project.timeline.tracks.find(t => t.type === 'video')
  const textTrack = project.timeline.tracks.find(t => t.type === 'text')
  // R124 A1: EVERY audio track (not just the first one) — a CapCut-style
  // project layers music, voiceover and SFX on separate rows and they all
  // mix into the output bus. `renderAudioClips` now takes the whole array.
  const audioTracks = project.timeline.tracks.filter(t => t.type === 'audio')

  // C16-R2: single mapping boundary app-model → render canonical view (@see clip.ts).
  const videoClips = renderVideoClips(videoTrack)
  const textClips = renderTextClips(textTrack)
  const audioClips = renderAudioClips(audioTracks)

  // Calculate total duration in seconds
  let totalDuration = 0
  for (const clip of videoClips) {
    totalDuration = Math.max(totalDuration, clip.offsetSec + renderClipDuration(clip))
  }
  for (const clip of audioClips) {
    totalDuration = Math.max(totalDuration, clip.offsetSec + renderClipDuration(clip))
  }
  totalDuration = Math.max(1, totalDuration)

  // Clamp the In/Out render zone to the timeline (design #3 range selector)
  let range: TmcutCompileRange | null = null
  if (options.range) {
    const s = Math.max(0, Math.min(totalDuration, options.range.start))
    const e = Math.max(0, Math.min(totalDuration, options.range.end))
    if (e - s >= 0.05) range = { start: s, end: e }
  }
  const outputDuration = range ? range.end - range.start : totalDuration

  const outScale = options.outScale && options.outScale > 0 ? options.outScale : 1
  const outFps = options.outFps && options.outFps > 0 ? options.outFps : fps

  if (mode === 'audio') {
    return compileAudioOnly(outputPath, videoClips, audioClips, options, outputDuration, range)
  }

  const graph = new RenderGraph()
  const bgDesc = buildBackgroundSource({
    canvasW,
    canvasH,
    fps,
    duration: totalDuration,
    background: project.canvas?.background || { type: 'color', value: '#000000' }
  })
  const canvasBgType = project.canvas?.background?.type || 'color'
  const backgroundIsTransparent = canvasBgType === 'transparent'

  // Alpha-capable output required for transparent canvas backgrounds (R76).
  const compileOptsWithTransparent = { ...options, transparent: backgroundIsTransparent }

  // For legacy compilation path (color source) retain bgColor for per-clip pads.
  const bgColor = canvasBgType === 'color'
    ? ffmpegColor(project.canvas?.background?.value)
    : '0x00000000'

  const isColorSource = videoClips.length === 0
  // GIF output carries no audio: skip every audio chain so no filter output
  // is left unconnected when nothing maps it.
  const hasAudio = mode !== 'gif'
  let currentVideoStream: string
  let currentAudioStream: string | null = null
  // `undefined` (not null) so it feeds the optional `bgBase` ctx directly.
  let backgroundStreamLabel: string | undefined

  // Register image background as a looping INPUT (Phase 4). The descriptor
  // tells the pipeline whether the canvas base is a filter source (color/
  // transparent) or an FFmpeg INPUT. The infinite `-loop 1` stream is
  // trimmed to the timeline + 2s (the same headroom buildFfmpegTransform
  // gives its inline color base) so both the plain base and per-clip
  // overlay windows are always covered, and the encoder has a defined end.
  if (bgDesc.kind === 'input') {
    const idx = graph.addInput(bgDesc.file, bgDesc.inputFlags)
    graph.addFilterChain(
      `[${idx}:v]${bgDesc.tail},trim=end=${(totalDuration + 2).toFixed(3)},setpts=PTS-STARTPTS[v_bg]`
    )
    backgroundStreamLabel = '[v_bg]'
  }

  // Case 1: No video clips provided - generate a canvas base video
  if (isColorSource) {
    if (bgDesc.kind === 'source') {
      graph.addFilterChain(`${bgDesc.chain}[v_base]`)
      currentVideoStream = '[v_base]'
    } else {
      // Image background: the looped input is the base.
      currentVideoStream = backgroundStreamLabel || '[v_bg]'
    }
    if (hasAudio) {
      graph.addFilterChain(`anullsrc=r=44100:cl=stereo,atrim=end=${totalDuration}[a_base]`)
      currentAudioStream = '[a_base]'
    }

    // Apply text overlays if any
    currentVideoStream = applyTextOverlays(graph, currentVideoStream, textClips, { canvasW, canvasH, fps })
  } else {
    // Case 2: Normal project with video clips — process pipeline
    const videoPipeline = compileVideoPipeline(graph, videoClips, {
      canvasW,
      canvasH,
      fps,
      bgColor,
      hasAudio,
      bgBase: backgroundStreamLabel
    })
    currentVideoStream = videoPipeline.videoStream
    currentAudioStream = videoPipeline.audioStream

    // Color LUT (roadmap E-4): grade the FOOTAGE before drawtext so
    // titles/graphics keep their authored colors (grading graphics is a
    // classic "why is my white title yellow" bug). Also before outScale,
    // so the LUT samples the full-resolution signal.
    if (options.lut3dPath) {
      graph.addFilterChain(`${currentVideoStream}${lutFileFilter(options.lut3dPath)}[v_graded]`)
      currentVideoStream = '[v_graded]'
    }

    // Apply text overlays if any
    currentVideoStream = applyTextOverlays(graph, currentVideoStream, textClips, { canvasW, canvasH, fps })

    // Apply background audio clips if any
    if (hasAudio && audioClips.length > 0) {
      currentAudioStream = compileBackgroundAudio(graph, currentAudioStream!, audioClips)
    }
  }

  // Noise reduction (roadmap D-3): one global afftdn on the final audio
  // bus — after concat/mix and BEFORE the range trim below, so a ranged
  // export still feeds the noise profile warmed-up audio. GIF never
  // builds an audio stream (null), so this doubles as the mode gate.
  if (currentAudioStream && options.denoise) {
    graph.addFilterChain(`${currentAudioStream}afftdn=nr=12[a_denoised]`)
    currentAudioStream = '[a_denoised]'
  }

  // Output resolution multiplier (design #3 resolution picker), applied after
  // drawtext so text positions stay in canvas coordinates.
  if (outScale !== 1) {
    graph.addFilterChain(
      `${currentVideoStream}scale=trunc(iw*${outScale}/2)*2:trunc(ih*${outScale}/2)*2[v_out_scaled]`
    )
    currentVideoStream = '[v_out_scaled]'
  }

  // In/Out render zone: trim is the LAST step so drawtext enable windows
  // keep using absolute timeline seconds.
  if (range) {
    graph.addFilterChain(
      `${currentVideoStream}trim=start=${range.start}:end=${range.end},setpts=PTS-STARTPTS[v_ranged]`
    )
    currentVideoStream = '[v_ranged]'
    if (currentAudioStream) {
      graph.addFilterChain(
        `${currentAudioStream}atrim=start=${range.start}:end=${range.end},asetpts=PTS-STARTPTS[a_ranged]`
      )
      currentAudioStream = '[a_ranged]'
    }
  }

  // GIF terminal: 15 fps, max 1280 px wide, optimized palette (single pass)
  if (mode === 'gif') {
    const gifPipeline = buildGifPipeline(currentVideoStream, canvasW, outScale)
    for (const chain of gifPipeline.chains) {
      graph.addFilterChain(chain)
    }

    const args = [
      ...graph.buildInputArgs(),
      '-filter_complex', graph.buildFilterComplex(),
      '-map', gifPipeline.outStream,
      '-loop', '0',
      '-y',
      outputPath
    ]
    return {
      args,
      duration: outputDuration,
      summary: `Render GIF ${gifPipeline.gifW}px (${outputDuration.toFixed(1)}s, 15fps)`
    }
  }

  const filterComplex = graph.buildFilterComplex()
  const videoCodecArgs = buildVideoCodecArgs(compileOptsWithTransparent)
  const audioCodecArgs = buildAudioCodecArgs(outputPath)

  const args = [
    ...graph.buildInputArgs(),
    '-filter_complex', filterComplex,
    '-map', currentVideoStream,
    '-map', currentAudioStream!,
    ...videoCodecArgs,
    '-r', String(outFps),
    ...audioCodecArgs,
    '-y',
    outputPath
  ]

  return {
    args,
    duration: outputDuration,
    summary: `Render ${videoClips.length} clips to ${canvasW}x${canvasH} (${outputDuration.toFixed(1)}s)`
  }
}
