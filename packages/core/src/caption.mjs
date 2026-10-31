// =============================================================================
//  @tmcut/core — caption
//  Subtitle helpers (Roadmap C11): word-safe cue splitting, SRT
//  parse/serialize and the glue from Whisper transcripts to caption TEXT
//  clips. Cue times are SECONDS (Whisper/SRT native); clip times are v3
//  ticks — secToTicks converts at the boundary.
// =============================================================================

import { secToTicks, TICKS_PER_SECOND } from './time.mjs'

/** Standard subtitle line budget; over it, cues split on word bounds. */
const DEFAULT_MAX_CHARS = 42
/** Caption on-screen budget; over it, cues time-slice evenly. */
const DEFAULT_MAX_DURATION_TICKS = 7 * TICKS_PER_SECOND

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function validCue(cue) {
  return Boolean(cue
    && typeof cue === 'object'
    && typeof cue.text === 'string'
    && isFiniteNumber(cue.start)
    && isFiniteNumber(cue.end)
    && cue.end > cue.start)
}

function wordsOf(text) {
  return text.trim().split(/\s+/).filter(Boolean)
}

/**
 * Split a cue that is too long into word-safe chunks: words are never cut
 * mid-token (a single word longer than `maxChars` stays intact on its own),
 * chunks cover the original span exactly, and timing is redistributed
 * proportionally to the chunk text length. Invalid cues yield [].
 */
export function splitLongCue(cue, maxChars) {
  if (!validCue(cue)) return []
  if (!isFiniteNumber(maxChars) || maxChars < 1) return [cue]
  const words = wordsOf(cue.text)
  if (words.length <= 1 || cue.text.length <= maxChars) return [cue]
  const chunks = []
  let current = []
  let currentLen = 0
  for (const word of words) {
    const nextLen = current.length > 0 ? currentLen + 1 + word.length : word.length
    if (current.length > 0 && nextLen > maxChars) {
      chunks.push(current.join(' '))
      current = []
    }
    if (current.length === 0) {
      current = [word]
      currentLen = word.length
    } else {
      current.push(word)
      currentLen = nextLen
    }
  }
  if (current.length > 0) chunks.push(current.join(' '))
  if (chunks.length <= 1) return [cue]
  const totalLen = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const duration = cue.end - cue.start
  let position = cue.start
  return chunks.map((text, index) => {
    // The last chunk pins the original end — no drift at the boundary.
    const chunkDuration = index === chunks.length - 1
      ? cue.end - position
      : duration * (text.length / totalLen)
    const chunk = { text, start: position, end: position + chunkDuration }
    position = chunk.end
    return chunk
  })
}

/** Time-slice a cue whose on-screen time exceeds the tick budget. */
function splitByDuration(cue, maxDurationTicks) {
  const durationTicks = secToTicks(cue.end - cue.start)
  if (!isFiniteNumber(maxDurationTicks) || maxDurationTicks < 1 || durationTicks <= maxDurationTicks) {
    return [cue]
  }
  const words = wordsOf(cue.text)
  if (words.length <= 1) return [cue]
  const slicesCount = Math.ceil(durationTicks / maxDurationTicks)
  const wordsPerSlice = Math.ceil(words.length / slicesCount)
  const slices = []
  for (let index = 0; index < words.length; index += wordsPerSlice) {
    slices.push(words.slice(index, index + wordsPerSlice).join(' '))
  }
  // Even time slices keep every caption strictly inside the budget.
  const sliceDuration = (cue.end - cue.start) / slices.length
  return slices.map((text, index) => ({
    text,
    start: cue.start + index * sliceDuration,
    end: index === slices.length - 1 ? cue.end : cue.start + (index + 1) * sliceDuration
  }))
}

/**
 * Convert transcript cues (seconds) into caption TEXT clip inputs (ticks):
 * `{ text, in: 0, out, offset }`.
 *
 * - Every cue splits to respect `maxChars` (default 42) and `maxDurTicks`
 *   (default 7s) — a long line becomes several clips.
 * - `fromTicks` anchors the captions (e.g. the timeline position of the
 *   captioned clip): offset = fromTicks + cue start.
 * - `rangeTicks { start, end }` clamps to a source window in ticks: cues
 *   fully outside are dropped, straddling cues are trimmed to the range
 *   edges.
 */
export function cuesToCaptionClips(cues, options = {}) {
  if (!Array.isArray(cues)) return []
  const {
    maxChars = DEFAULT_MAX_CHARS,
    maxDurTicks = DEFAULT_MAX_DURATION_TICKS,
    fromTicks = 0,
    rangeTicks = null
  } = options
  const rangeStart = rangeTicks && isFiniteNumber(rangeTicks.start) ? rangeTicks.start : null
  const rangeEnd = rangeTicks && isFiniteNumber(rangeTicks.end) ? rangeTicks.end : null
  const clips = []
  for (const cue of cues) {
    if (!validCue(cue)) continue
    for (const piece of splitLongCue(cue, maxChars)) {
      for (const slice of splitByDuration(piece, maxDurTicks)) {
        let startTicks = secToTicks(slice.start)
        let endTicks = secToTicks(slice.end)
        if (rangeStart !== null && endTicks <= rangeStart) continue
        if (rangeEnd !== null && startTicks >= rangeEnd) continue
        if (rangeStart !== null) startTicks = Math.max(startTicks, rangeStart)
        if (rangeEnd !== null) endTicks = Math.min(endTicks, rangeEnd)
        if (endTicks <= startTicks) continue
        clips.push({
          text: slice.text,
          in: 0,
          out: endTicks - startTicks,
          offset: fromTicks + startTicks
        })
      }
    }
  }
  return clips
}

// --- SRT --------------------------------------------------------------------

const SRT_TIME = /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/

function pad(value, size) {
  return String(value).padStart(size, '0')
}

function formatSrtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  const secs = Math.floor((ms % 60_000) / 1000)
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)},${pad(ms % 1000, 3)}`
}

function srtTimeToSeconds(hours, minutes, secs, millis) {
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(secs) + Number(millis.padEnd(3, '0')) / 1000
}

/**
 * Parse SRT text into cues (seconds). Tolerant by design: optional index
 * lines, CRLF, dot decimals and trailing position parameters after the end
 * timestamp are accepted; malformed blocks are skipped, never thrown.
 */
export function parseSrt(text) {
  if (typeof text !== 'string' || text.length === 0) return []
  const cues = []
  for (const block of text.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r\n|\n/)
    const timingIndex = lines.findIndex(line => SRT_TIME.test(line.trim()))
    if (timingIndex === -1) continue
    const match = SRT_TIME.exec(lines[timingIndex].trim())
    const start = srtTimeToSeconds(match[1], match[2], match[3], match[4])
    const end = srtTimeToSeconds(match[5], match[6], match[7], match[8])
    const textLines = lines.slice(timingIndex + 1)
    while (textLines.length > 0 && textLines[textLines.length - 1].trim() === '') {
      textLines.pop()
    }
    if (textLines.length === 0 || !(end > start)) continue
    cues.push({ text: textLines.join('\n'), start, end })
  }
  return cues
}

/**
 * Serialize cues to standard SRT (`HH:MM:SS,mmm`, numbered entries, blank
 * line between cues, trailing newline). Invalid or empty-text cues are
 * skipped so parse(serialize(cues)) round-trips cleanly.
 */
export function serializeSrt(cues) {
  if (!Array.isArray(cues)) return ''
  const valid = cues.filter(cue => validCue(cue) && cue.text.trim().length > 0)
  if (valid.length === 0) return ''
  const blocks = valid.map((cue, index) => (
    `${index + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${cue.text}`
  ))
  return `${blocks.join('\n\n')}\n`
}
