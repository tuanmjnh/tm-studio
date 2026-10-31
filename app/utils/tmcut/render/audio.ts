import type { RenderClip } from './clip'
import type { CompileOptions, CompileResult, TmcutCompileRange } from './types'
import { volumeExpr, keyframeExpr, panFilter } from '@tmcut-core'

/**
 * Fade envelope for one clip's audio chain (roadmap R5, core C12).
 * C16-R3: the store's flat in/out are TICKS now, so the clip is handed
 * to core in the v3 shape (`timeline.duration` ticks from the canonical
 * view) — core's legacy flat branch (in/out as SECONDS, kept for file
 * migration) must never see a flipped-store item.
 */
export function fadeFilter(clip: RenderClip): string {
  const expr = volumeExpr({
    fade: clip.raw.fade,
    volume: clip.raw.volume,
    timeline: { duration: clip.durationTicks }
  })
  return expr === '1' ? '' : `,volume='${expr}':eval=frame`
}

/**
 * R124 A1: the per-clip audio chain builder. Both the audio-only compile
 * path and the background-audio mixer call this — one place, one filter
 * string, so a track-level flag (mute/pan/volume) can never be honored
 * in one path and silently dropped in the other.
 *
 * Track-level audio (CapCut §5.3):
 *  - `trackMuted` → the whole track is silent. Returning null lets the
 *    caller skip the clip's bus slot entirely — byte-identical to never
 *    having had the clip, and cheaper than emitting a silent stream.
 *  - `trackVolume` (0..100) multiplies the clip volume BEFORE the clip's
 *    own volume, so a track dimmer is a global gain on that row.
 *  - `trackPan` (-100..100) shifts the stereo field via core `panFilter`
 *    (stereotools). Applied after the volume so the pan math sees the
 *    final amplitude.
 *
 * @param {RenderClip} clip
 * @param {number} inputIdx the FFmpeg input index for this clip's file
 * @param {string} outLabel the bus stream label to emit (e.g. `[a_bus_3]`)
 * @returns {string | null} the filter chain string, or null when muted.
 */
export function buildClipAudioChain(clip: RenderClip, inputIdx: number, outLabel: string): string | null {
  if (clip.trackMuted) return null
  const delayMs = Math.round(clip.offsetSec * 1000)
  const kfVol = keyframeExpr(clip.raw, 'volume', 't')
  const clipVol = clip.volumePct
  const trackVol = clip.trackVolume
  // Track volume multiplies the clip volume (both are 0..100 percent).
  const combined = (clipVol * trackVol) / 10000
  const volFilter = kfVol
    ? `volume='(${kfVol})*${trackVol}/100':eval=frame`
    : `volume=${Number(combined.toFixed(4))}`
  const aSpeed = clip.speed
  const aSetpts = aSpeed !== 1 ? `asetpts=(PTS-STARTPTS)/${aSpeed}` : 'asetpts=PTS-STARTPTS'
  const aReverse = clip.raw.reverse ? 'areverse,' : ''
  const pan = panFilter(clip.trackPan)
  const panStep = pan ? `,${pan}` : ''
  return `[${inputIdx}:a]atrim=start=${clip.inSec}:end=${clip.outSec},${aReverse}${aSetpts},${volFilter}${fadeFilter(clip)}${panStep},aresample=48000,adelay=${delayMs}|${delayMs}${outLabel}`
}

/**
 * Audio-only compile path (design #3 "Audio only" mode): renders the audio
 * of every video clip plus background audio clips at a uniform 48 kHz,
 * honoring the In/Out range. Output codec follows the file extension
 * (.wav → PCM, anything else → MP3). C16-R2: RenderClip views.
 *
 * R124 A1: every clip — video-track audio and background audio — flows
 * through `buildClipAudioChain`, so track mute/pan/volume is honored
 * identically in both paths (the old inline loops could drift).
 */
export function compileAudioOnly(
  outputPath: string,
  videoClips: RenderClip[],
  audioClips: RenderClip[],
  options: CompileOptions,
  outputDuration: number,
  range: TmcutCompileRange | null
): CompileResult {
  if (videoClips.length === 0 && audioClips.length === 0) {
    throw new Error('Timeline has no audio to export')
  }

  const args: string[] = []
  const chains: string[] = []
  let inputIdx = 0
  const busStreams: string[] = []
  let busIdx = 0

  // Video track audio clips. R124 A1: a muted track contributes NOTHING
  // — not even its input — so the input index and args stay in sync.
  for (const clip of videoClips) {
    if (clip.trackMuted) continue
    args.push('-i', clip.footagePath!)
    const idx = inputIdx++
    const out = `[a_bus_${busIdx++}]`
    const chain = buildClipAudioChain(clip, idx, out)
    if (chain) {
      chains.push(chain)
      busStreams.push(out)
    }
  }

  // Audio track background clips
  for (const clip of audioClips) {
    if (clip.trackMuted) continue
    args.push('-i', clip.footagePath!)
    const idx = inputIdx++
    const out = `[a_bus_${busIdx++}]`
    const chain = buildClipAudioChain(clip, idx, out)
    if (chain) {
      chains.push(chain)
      busStreams.push(out)
    }
  }

  if (busStreams.length === 0) {
    throw new Error('Timeline audio is fully muted — nothing to render')
  }
  let current = busStreams[0]!
  if (busStreams.length > 1) {
    chains.push(
      `${busStreams.join('')}amix=inputs=${busStreams.length}:duration=longest:dropout_transition=2[a_mixed]`
    )
    current = '[a_mixed]'
  }

  if (options.denoise) {
    chains.push(`${current}afftdn=nr=12[a_denoised]`)
    current = '[a_denoised]'
  }

  if (range) {
    chains.push(
      `${current}atrim=start=${range.start}:end=${range.end},asetpts=PTS-STARTPTS[a_ranged]`
    )
    current = '[a_ranged]'
  }

  const isWav = outputPath.toLowerCase().endsWith('.wav')
  args.push('-filter_complex', chains.join('; '), '-map', current)
  if (isWav) {
    args.push('-c:a', 'pcm_s16le')
  } else {
    args.push('-c:a', 'libmp3lame', '-b:a', `${options.audioBitrate || 320}k`)
  }
  args.push('-y', outputPath)

  return {
    args,
    duration: outputDuration,
    summary: `Render audio only (${outputDuration.toFixed(1)}s, ${isWav ? 'WAV' : 'MP3'})`
  }
}

/**
 * Mixes timeline background audio clips with the current video audio bus.
 * R124 A1: every background clip flows through `buildClipAudioChain`, so
 * track mute/pan/volume is honored here too (the old inline loop could
 * drift from the audio-only path).
 */
export function compileBackgroundAudio(
  graph: import('./graph').RenderGraph,
  currentAudioStream: string,
  audioClips: RenderClip[]
): string {
  if (audioClips.length === 0) return currentAudioStream

  const audioMixStreams = [currentAudioStream]
  for (let i = 0; i < audioClips.length; i++) {
    const aClip = audioClips[i]!
    // R124 A1: a muted track contributes nothing — skip the INPUT too,
    // so a fully-muted row never leaves an orphan -i in the args.
    if (aClip.trackMuted) continue
    const aInputIdx = graph.addInput(aClip.footagePath!)
    const aProcessed = `[bgm_${i}]`
    const chain = buildClipAudioChain(aClip, aInputIdx, aProcessed)
    if (!chain) continue
    graph.addFilterChain(chain)
    audioMixStreams.push(aProcessed)
  }

  if (audioMixStreams.length === 1) return currentAudioStream
  const mixInputs = audioMixStreams.join('')
  graph.addFilterChain(`${mixInputs}amix=inputs=${audioMixStreams.length}:duration=longest:dropout_transition=2[a_mixed]`)
  return '[a_mixed]'
}
