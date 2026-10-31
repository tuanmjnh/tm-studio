// =============================================================================
//  @tmcut/core — analysis
//  Pure media-analysis helpers for AutoCut (docs sections 39-40, Phase 16).
//  The Electron runtime executes ffmpeg and returns RAW stderr text; this
//  module parses it and scores segments per AutoCut profile. No process,
//  no filesystem, no network — fully unit-tested.
// =============================================================================

/**
 * Parse `select='gt(scene,N)',showinfo` stderr into shot segments.
 * showinfo prints `pts_time:<sec>` per scene cut; shots span consecutive
 * cuts, the tail ending at durationSec.
 */
export function parseSceneOutput(stderrText, durationSec) {
  const text = String(stderrText ?? '')
  const duration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0
  const cuts = [0]
  const pattern = /pts_time:(\d+(?:\.\d+)?)/g
  let match = pattern.exec(text)
  while (match) {
    const time = Number(match[1])
    if (Number.isFinite(time) && time > 0.04 && time > cuts[cuts.length - 1] + 0.04) {
      cuts.push(time)
    }
    match = pattern.exec(text)
  }
  const end = duration > 0 ? duration : cuts[cuts.length - 1]
  const segments = []
  for (let i = 0; i < cuts.length; i += 1) {
    const start = cuts[i]
    const stop = i + 1 < cuts.length ? cuts[i + 1] : end
    if (stop - start >= 0.2) segments.push({ start: round3(start), end: round3(stop) })
  }
  return segments
}

/**
 * Parse `silencedetect` stderr into silence ranges [{ start, end }].
 * Dangling silence_start (no end before EOF) closes at durationSec.
 */
export function parseSilenceOutput(stderrText, durationSec) {
  const text = String(stderrText ?? '')
  const duration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0
  const ranges = []
  const pattern = /silence_(start|end):\s*(-?[\d.]+)/g
  let match = pattern.exec(text)
  let open = null
  while (match) {
    const time = Number(match[2])
    if (match[1] === 'start') {
      if (open === null && Number.isFinite(time)) open = Math.max(0, time)
    } else if (open !== null && Number.isFinite(time) && time > open) {
      ranges.push({ start: round3(open), end: round3(time) })
      open = null
    }
    match = pattern.exec(text)
  }
  if (open !== null && duration > open) {
    ranges.push({ start: round3(open), end: round3(duration) })
  }
  return ranges
}

function round3(value) {
  return Math.round(value * 1000) / 1000
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** Total overlap (seconds) between [start, end] and a range list. */
export function overlapDuration(start, end, ranges) {
  let total = 0
  for (const range of ranges ?? []) {
    const overlap = Math.min(end, range.end) - Math.max(start, range.start)
    if (overlap > 0) total += overlap
  }
  return total
}

function triangularPeak(duration, low, peak, high) {
  if (duration <= low || duration >= high) return 0
  if (duration <= peak) return (duration - low) / (peak - low)
  return 1 - (duration - peak) / (high - peak)
}

const PROFILES = ['viral-shorts', 'podcast-summary', 'cinematic-vlog']

function scoreForProfile(scene, silenceRatio, speechRatio, profile) {
  const duration = scene.end - scene.start
  if (profile === 'podcast-summary') {
    // Keep speech, cut silence: score follows the speech ratio.
    if (silenceRatio >= 0.9) return { score: 0.05, reason: 'silence' }
    return { score: clamp01(0.15 + speechRatio * 0.85), reason: speechRatio > 0.5 ? 'speech' : 'filler' }
  }
  if (profile === 'cinematic-vlog') {
    // Prefer stable 4-20s shots; mild silence penalty.
    const stability = triangularPeak(duration, 2, 8, 25)
    const score = clamp01(0.2 + stability * 0.7) * (1 - silenceRatio * 0.5)
    if (silenceRatio >= 0.9) return { score: 0.05, reason: 'silence' }
    return { score, reason: stability > 0.5 ? 'stable-shot' : 'cutaway' }
  }
  // viral-shorts default: punchy 3-10s shots with speech.
  const punch = triangularPeak(duration, 1.5, 5, 12)
  const score = clamp01(0.1 + punch * 0.75 + speechRatio * 0.15) * (1 - silenceRatio * 0.8)
  if (silenceRatio >= 0.9) return { score: 0.05, reason: 'silence' }
  if (duration > 20) return { score: clamp01(score * 0.5), reason: 'too-long' }
  return { score, reason: speechRatio > 0.4 ? 'speech' : punch > 0.5 ? 'action' : 'filler' }
}

export const DEFAULT_FILLER_WORDS = [
  // Vietnamese filler words & hesitation markers
  'ừm', 'ừ', 'à', 'ờ', 'ơ', 'hả', 'thì', 'là', 'kiểu', 'kiểu như',
  'nhỉ', 'nhé', 'này nọ', 'nói chung là', 'đại loại là', 'xong rồi',
  // English filler words
  'um', 'uh', 'ah', 'er', 'like', 'you know', 'basically', 'literally',
  'sort of', 'kind of', 'actually', 'i mean', 'right'
]

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Detect filler words and hesitation phrases in transcript text.
 * Pure function: string -> { count, words, fillerRatio }.
 */
export function detectFillerWords(text, options) {
  const rawText = String(text ?? '').trim()
  if (!rawText) return { count: 0, words: [], fillerRatio: 0 }

  const customWords = Array.isArray(options?.customWords) ? options.customWords : []
  const dictionary = [...DEFAULT_FILLER_WORDS, ...customWords].map(w => String(w).trim().toLowerCase()).filter(Boolean)

  const normalized = rawText.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()?]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!normalized) return { count: 0, words: [], fillerRatio: 0 }

  const words = normalized.split(' ').filter(Boolean)
  const totalWords = words.length
  if (totalWords === 0) return { count: 0, words: [], fillerRatio: 0 }

  const matched = []
  let detectedCount = 0

  // Check multi-word phrases first
  const multiWordFillers = dictionary.filter(w => w.includes(' '))
  let workingText = normalized

  for (const phrase of multiWordFillers) {
    const regex = new RegExp(`(^|\\s)${escapeRegex(phrase)}(?=\\s|$)`, 'gi')
    const matches = workingText.match(regex)
    if (matches) {
      const phraseWordCount = phrase.split(' ').length
      const count = matches.length
      detectedCount += count * phraseWordCount
      if (!matched.includes(phrase)) matched.push(phrase)
      workingText = workingText.replace(regex, ' ')
    }
  }

  // Check single words in remainder
  const singleWordFillers = new Set(dictionary.filter(w => !w.includes(' ')))
  const remainingWords = workingText.split(' ').filter(Boolean)
  for (const word of remainingWords) {
    if (singleWordFillers.has(word)) {
      detectedCount += 1
      if (!matched.includes(word)) matched.push(word)
    }
  }

  const fillerRatio = Math.min(1, Math.round((detectedCount / totalWords) * 100) / 100)
  return {
    count: detectedCount,
    words: matched,
    fillerRatio
  }
}

/**
 * Analyze transcript segment for filler words and highlight keywords.
 */
export function analyzeTranscriptSegment(text, options) {
  const rawText = String(text ?? '').trim()
  if (!rawText) {
    return {
      isFiller: false,
      isHighlight: false,
      scoreModifier: 0,
      matchedKeywords: [],
      detectedFillers: []
    }
  }

  const filterFillers = options?.filterFillerWords !== false
  const keywords = Array.isArray(options?.keywords)
    ? options.keywords.map(k => String(k).trim().toLowerCase()).filter(Boolean)
    : []

  const fillerResult = filterFillers
    ? detectFillerWords(rawText, { customWords: options?.customFillerWords })
    : { count: 0, words: [], fillerRatio: 0 }

  // A segment is classified as a filler segment if >= 25% of words are fillers, or >= 2 filler words
  const isFiller = filterFillers && (fillerResult.fillerRatio >= 0.25 || (fillerResult.count >= 2 && fillerResult.fillerRatio >= 0.15))

  // Check priority keywords
  const matchedKeywords = []
  const normalized = rawText.toLowerCase()
  for (const kw of keywords) {
    if (normalized.includes(kw) && !matchedKeywords.includes(kw)) {
      matchedKeywords.push(kw)
    }
  }
  const isHighlight = matchedKeywords.length > 0

  let scoreModifier = 0
  if (isFiller) {
    scoreModifier = -0.35 // Penalty for hesitation/filler
  } else if (isHighlight) {
    scoreModifier = 0.25 // Boost for keyword presence
  }

  return {
    isFiller,
    isHighlight,
    scoreModifier,
    matchedKeywords,
    detectedFillers: fillerResult.words
  }
}

/**
 * Blend AI content-triage interest scores into a scene (docs §194).
 * `aiScores`: [{ start, end, interest }] — interest already clamped 0..1.
 * Interest over a beat-weighted overlap average, so a triage item covering
 * only a corner of a shot only moves that corner's share of the score.
 * Returns null when the scene has NO overlap with any item (no AI data,
 * leave the local score untouched — never invent a value).
 */
export function blendSceneInterest(scene, aiScores) {
  const items = Array.isArray(aiScores) ? aiScores : []
  let beats = 0
  let weighted = 0
  for (const item of items) {
    const start = Number(item?.start)
    const end = Number(item?.end)
    const interest = Number(item?.interest)
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(interest)) continue
    const overlap = overlapDuration(scene.start, scene.end, [{ start, end }])
    if (overlap <= 0) continue
    beats += overlap
    weighted += overlap * Math.min(1, Math.max(0, interest))
  }
  if (beats <= 0) return null
  return weighted / beats
}

/**
 * Score scenes into an Edit Decision List (docs section 38).
 * speech / transcript: optional [{ start, end, text? }] ranges; the
 * scorer degrades gracefully without it.
 * aiScores: optional [{ start, end, interest }] from an AI content-triage
 * pass (docs §194); blended conservatively into the local score with
 * aiWeight (default 0.25, clamped 0..0.5 — AI is an opinion, not truth).
 */
export function scoreSegments(input) {
  const scenes = Array.isArray(input?.scenes) ? input.scenes : []
  const silences = Array.isArray(input?.silences) ? input.silences : []
  const rawSpeech = Array.isArray(input?.speech) ? input.speech : []
  const rawTranscript = Array.isArray(input?.transcript) ? input.transcript : []
  const speech = rawSpeech.length > 0 ? rawSpeech : rawTranscript
  const transcript = rawTranscript.length > 0 ? rawTranscript : rawSpeech
  const profile = PROFILES.includes(input?.profile) ? input.profile : 'viral-shorts'
  const assetId = typeof input?.assetId === 'string' ? input.assetId : ''
  const filterFillerWords = input?.filterFillerWords !== false
  const keywords = Array.isArray(input?.keywords) ? input.keywords : []
  const customFillerWords = Array.isArray(input?.customFillerWords) ? input.customFillerWords : []
  const rawAiScores = Array.isArray(input?.aiScores) ? input.aiScores : []
  const aiWeight = Math.min(0.5, Math.max(0, Number(input?.aiWeight ?? 0.25) || 0))
  const aiUsed = rawAiScores.length > 0 && aiWeight > 0

  const segments = scenes.map((scene) => {
    const duration = Math.max(0, scene.end - scene.start)
    const silenceRatio = duration > 0 ? clamp01(overlapDuration(scene.start, scene.end, silences) / duration) : 1
    const speechRatio = duration > 0 ? clamp01(overlapDuration(scene.start, scene.end, speech) / duration) : 0
    let { score, reason } = scoreForProfile(scene, silenceRatio, speechRatio, profile)

    // Transcript text analysis per scene
    const overlappingTexts = transcript
      .filter(item => item?.text && item.start < scene.end && item.end > scene.start)
      .map(item => String(item.text).trim())
      .filter(Boolean)
    const fullTranscriptText = overlappingTexts.join(' ')

    let hasFillerWords = false
    let detectedFillers = undefined
    let isHighlight = false
    let matchedKeywords = undefined

    if (fullTranscriptText.length > 0) {
      const analysis = analyzeTranscriptSegment(fullTranscriptText, {
        filterFillerWords,
        keywords,
        customFillerWords
      })
      if (analysis.isFiller) {
        hasFillerWords = true
        detectedFillers = analysis.detectedFillers
        score = Math.max(0.05, clamp01(score * 0.4))
        reason = 'filler-word'
      } else if (analysis.isHighlight) {
        isHighlight = true
        matchedKeywords = analysis.matchedKeywords
        score = clamp01(score + analysis.scoreModifier)
        reason = 'highlight'
      }
    }

    // AI interest blend (docs §194): move the local score toward the
    // triaged interest by aiWeight. Conservative on purpose — a 0.25
    // weight shifts a 0.5 local score at most to 0.625.
    let aiInterest
    if (aiUsed) {
      const interest = blendSceneInterest(scene, rawAiScores)
      if (interest !== null) {
        aiInterest = Math.round(interest * 1000) / 1000
        const blended = score + (interest - score) * aiWeight
        // A filler penalty may only be pushed FURTHER down by a low AI
        // interest — never softened back up (the local transcript evidence
        // is fact, the AI opinion is not).
        score = reason === 'filler-word' ? Math.min(score, blended) : clamp01(blended)
        score = Math.max(0.05, Math.round(score * 1000) / 1000)
      }
    }

    const seg = {
      start: round3(scene.start),
      end: round3(scene.end),
      score: Math.round(score * 1000) / 1000,
      reason,
      thumb: round3(scene.start + duration / 2)
    }
    if (aiInterest !== undefined) seg.aiInterest = aiInterest
    if (fullTranscriptText.length > 0) seg.transcriptText = fullTranscriptText
    if (hasFillerWords) {
      seg.hasFillerWords = true
      seg.detectedFillers = detectedFillers
    }
    if (isHighlight) {
      seg.isHighlight = true
      seg.matchedKeywords = matchedKeywords
    }
    return seg
  }).filter(segment => segment.end > segment.start)

  return {
    version: 1,
    assetId,
    profile,
    segments,
    createdAt: new Date().toISOString(),
    analyzerVersion: input?.analyzerVersion || 'transcript-v2'
  }
}
