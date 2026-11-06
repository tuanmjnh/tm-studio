/**
 * Encode capability (zero-FFmpeg slice H2, ADR-029 and ADR-030) — the one place
 * the app asks a runtime what it can encode, and writes down what it was told.
 *
 * Core owns both decisions this seam used to make in an IO layer: which configs
 * are worth asking (`planEncodePresets`) and what an answer means
 * (`planEncodeConfig`). What is left here is the browser call itself, plus the
 * four things a browser forces that a pure law cannot express: a runtime with no
 * WebCodecs at all, a probe that has a shape the API rejects, an answer that
 * names a different codec than the one asked, and the cost of asking twice.
 *
 * The answers are remembered per request — not per codec, because the level and
 * the frame rate are part of the question: a runtime that accepts a picture at
 * 30 fps does not thereby accept it at 60.
 *
 * `mediabunny` is deliberately absent: a muxer belongs to the encode session, and
 * three specs freeze which files may import it.
 */
import { rationalToFloat, planEncodeConfig, planEncodePresets } from 'tmcut-core'
import type { CoreEncodePreset, CoreEncodeRequest, CoreEncodeSupportAnswer, CoreEncodeVerdict } from 'tmcut-core'

type SupportAnswer = { supported?: boolean, config?: { codec?: string } }

export interface TmcutEncodeProbes {
  probeVideo?: (config: VideoEncoderConfig) => Promise<SupportAnswer>
  probeAudio?: (config: AudioEncoderConfig) => Promise<SupportAnswer>
}

export interface TmcutEncodeDecision {
  kind: 'ready' | 'refused'
  /** The config to encode with, or null when nothing was accepted. */
  config: { id: string, video: CoreEncodePreset['video'], audio: { codec: string, sampleRate: number, channelCount: number } | null } | null
  /** The whole capability matrix: one verdict per config asked about. */
  checked: CoreEncodeVerdict[]
  /** Why there is no config, in the words a UI can show. */
  errors: string[]
  container: 'mp4' | 'webm' | null
  presets: CoreEncodePreset[]
}

export interface TmcutEncodeCapability {
  decide: (request: CoreEncodeRequest) => Promise<TmcutEncodeDecision>
}

function webVideoEncoder(): TmcutEncodeProbes['probeVideo'] {
  if (typeof globalThis.VideoEncoder === 'undefined') return undefined
  return config => globalThis.VideoEncoder.isConfigSupported(config)
}

function webAudioEncoder(): TmcutEncodeProbes['probeAudio'] {
  if (typeof globalThis.AudioEncoder === 'undefined') return undefined
  return config => globalThis.AudioEncoder.isConfigSupported(config)
}

/**
 * The config as the API must see it. `framerate` is a float and a codec option
 * object is only legal for the codec it names, so both live here rather than in
 * core — `isConfigSupported` throws on an `avc` block beside a VP9 string, and a
 * thrown probe is a missing answer, not a refusal.
 */
function videoProbeConfig(preset: CoreEncodePreset): VideoEncoderConfig {
  const config: VideoEncoderConfig = {
    codec: preset.video.codec,
    width: preset.video.width,
    height: preset.video.height,
    framerate: rationalToFloat(preset.video.fps)
  }
  if (preset.video.bitrate) config.bitrate = preset.video.bitrate
  if (preset.video.codec.startsWith('avc1.')) config.avc = { format: 'avc' }
  return config
}

function audioProbeConfig(audio: NonNullable<CoreEncodePreset['audio']>): AudioEncoderConfig {
  return { codec: audio.codec, sampleRate: audio.sampleRate, numberOfChannels: audio.channelCount }
}

async function probe<Config>(
  probeFn: ((config: Config) => Promise<SupportAnswer>) | undefined,
  config: Config
): Promise<SupportAnswer | null> {
  if (!probeFn) return null
  try {
    return await probeFn(config)
  } catch {
    // An API that rejects the shape told us nothing; `unmeasured` says so, while
    // a refusal would be a claim about the codec we never got an answer to.
    return null
  }
}

function refusalMessages(reason: string, presets: CoreEncodePreset[], checked: CoreEncodeVerdict[]): string[] {
  if (reason === 'no-presets') return ['the export request itself was refused; nothing was asked of the runtime']
  const reasons = checked.flatMap(row => row.reasons.map(entry => `${row.id}: ${entry}`))
  if (reason === 'nothing-measured') {
    return ['this runtime answers nothing about encode support (no VideoEncoder.isConfigSupported), so no codec can be promised', ...reasons]
  }
  return [`no encode config this runtime accepts for ${presets[0]?.video.width ?? '?'}x${presets[0]?.video.height ?? '?'}`, ...reasons]
}

/**
 * A capability for one browser session: it asks each config once and remembers
 * the verdicts.
 */
export function createEncodeCapability(probes: TmcutEncodeProbes = {}): TmcutEncodeCapability {
  const probeVideo = probes.probeVideo ?? webVideoEncoder()
  const probeAudio = probes.probeAudio ?? webAudioEncoder()
  const memory = new Map<string, Promise<TmcutEncodeDecision>>()

  async function ask(request: CoreEncodeRequest): Promise<TmcutEncodeDecision> {
    const { presets, errors } = planEncodePresets(request)
    if (presets.length === 0) {
      return { kind: 'refused', config: null, checked: [], errors, container: null, presets }
    }

    const answers: Record<string, CoreEncodeSupportAnswer> = {}
    for (const preset of presets) {
      const video = await probe(probeVideo, videoProbeConfig(preset))
      const audio = preset.audio ? await probe(probeAudio, audioProbeConfig(preset.audio)) : undefined
      if (video || audio) answers[preset.id] = { video: video ?? undefined, audio: audio ?? undefined }
    }

    const plan = planEncodeConfig({ presets, answers })
    if (plan.kind === 'ready') {
      const container = (plan.preset.container as 'mp4' | 'webm' | undefined) ?? null
      return { kind: 'ready', config: plan.config, checked: plan.checked, errors: [], container, presets }
    }
    return {
      kind: 'refused',
      config: null,
      checked: plan.checked,
      errors: refusalMessages(plan.reason, presets, plan.checked),
      container: null,
      presets
    }
  }

  return {
    decide(request: CoreEncodeRequest): Promise<TmcutEncodeDecision> {
      const key = JSON.stringify(request ?? {})
      const remembered = memory.get(key)
      if (remembered) return remembered
      const pending = ask(request)
      memory.set(key, pending)
      return pending
    }
  }
}
