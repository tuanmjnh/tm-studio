/**
 * Caption cues for the HTML/CSS video studio.
 *
 * The studio's subtitle composition reads a `cues` variable — a JSON array of
 * `{ start, end, text }` in seconds. AutoCaptions writes one text clip per
 * recognized segment onto the timeline, so the project already owns that data;
 * this module turns those clips into the shape the composition parses, without
 * running a second transcription.
 *
 * Time stays in seconds: callers convert from the store's integer ticks with
 * the clipTime accessors, keeping the tick/seconds rule in one place.
 */

export interface CaptionSource {
  text?: string | null
  startSec: number
  endSec: number
}

export interface CaptionCue {
  start: number
  end: number
  text: string
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * Normalises timeline text clips into cues: trims text, drops empty or
 * non-positive spans, clamps the start to zero and sorts by start time.
 */
export function toCaptionCues(sources: readonly CaptionSource[]): CaptionCue[] {
  const cues: CaptionCue[] = []
  for (const source of sources) {
    const text = String(source?.text ?? '').trim()
    if (!text) continue
    const start = Math.max(0, round3(Number(source.startSec) || 0))
    const end = round3(Number(source.endSec) || 0)
    if (!(end > start)) continue
    cues.push({ start, end, text })
  }
  cues.sort((left, right) => left.start - right.start || left.end - right.end)
  return cues
}

/** The exact string the `cues` variable expects. */
export function serializeCaptionCues(cues: readonly CaptionCue[]): string {
  return JSON.stringify(cues)
}

/** Parses a cues variable back, for editing round-trips and tests. */
export function parseCaptionCues(value: unknown): CaptionCue[] {
  let raw: unknown = value
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value)
    } catch {
      return []
    }
  }
  if (!Array.isArray(raw)) return []
  return toCaptionCues(raw.map(item => ({
    text: item?.text,
    startSec: Number(item?.start),
    endSec: Number(item?.end)
  })))
}
