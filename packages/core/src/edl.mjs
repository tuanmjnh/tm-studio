// =============================================================================
//  @tmcut/core — edl
//  Edit Decision List validation (docs sections 38-40, 66). The EDL is the
//  contract between media analysis / AI and the timeline: validate before
//  any apply step, never trust model output shape.
// =============================================================================

import { secToTicks } from './time.mjs'

const PROFILES = ['viral-shorts', 'podcast-summary', 'cinematic-vlog']

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Validate an EDL object. Returns an array of human-readable errors
 * (empty = valid).
 */
export function validateEdl(edl) {
  const errors = []
  if (!edl || typeof edl !== 'object') return ['edl must be an object']
  if (edl.version !== 1) errors.push(`unsupported edl version: ${edl.version}`)
  if (typeof edl.assetId !== 'string' || edl.assetId.length === 0) {
    errors.push('edl.assetId must be a non-empty string')
  }
  if (!PROFILES.includes(edl.profile)) {
    errors.push(`unknown edl profile: ${edl.profile}`)
  }
  if (!Array.isArray(edl.segments)) return [...errors, 'edl.segments must be an array']
  edl.segments.forEach((segment, index) => {
    const at = `segment ${index}`
    if (!segment || typeof segment !== 'object') {
      errors.push(`${at} must be an object`)
      return
    }
    if (!isFiniteNumber(segment.start) || segment.start < 0) {
      errors.push(`${at} has invalid start`)
    }
    if (!isFiniteNumber(segment.end) || !(segment.end > segment.start)) {
      errors.push(`${at} has invalid end`)
    }
    if (!isFiniteNumber(segment.score) || segment.score < 0 || segment.score > 1) {
      errors.push(`${at} score must be within 0..1`)
    }
    if (typeof segment.reason !== 'string' || segment.reason.length === 0) {
      errors.push(`${at} needs a reason`)
    }
    if (segment.thumb !== undefined && (!isFiniteNumber(segment.thumb) || segment.thumb < segment.start || segment.thumb > segment.end)) {
      errors.push(`${at} thumb must fall inside [start, end]`)
    }
  })
  return errors
}

/** Keep segments at/above a score threshold, sorted by start time. */
export function selectSegments(edl, minScore = 0.5) {
  if (!edl || !Array.isArray(edl.segments)) return []
  return edl.segments
    .filter(segment => isFiniteNumber(segment.score) && segment.score >= minScore)
    .slice()
    .sort((a, b) => a.start - b.start)
}

/**
 * Convert EDL segments (media time, seconds) into core clip inputs — the
 * glue between AutoCut analysis and the timeline (Roadmap C10).
 *
 * - An INVALID EDL converts to nothing (never trust model output).
 * - Segments without a positive span are dropped, the rest sorted by start.
 * - Kept segments CONCATENATE on the timeline by default (the autocut
 *   draft flow removes source dead air). Pass `minGapTicks` to PRESERVE
 *   source pauses at or above that threshold — smaller gaps still close,
 *   so every gap in the output is >= minGapTicks.
 * - `trackType` guards intent for future audio EDLs; the clip shape is
 *   currently identical for video and audio, and 'text' is refused.
 * - Output uses v3 ticks (`in`/`out`/`offset`); the legacy v1 seconds
 *   editor converts at the boundary (ticksToSec) like every core bridge.
 */
export function segmentsToClips(edl, segments, options = {}) {
  if (!edl || validateEdl(edl).length > 0) return []
  const { minGapTicks = null, trackType = 'video' } = options
  if (!['video', 'audio'].includes(trackType)) return []
  if (!Array.isArray(segments)) return []
  const clean = segments
    .filter(segment => segment
      && typeof segment === 'object'
      && isFiniteNumber(segment.start)
      && isFiniteNumber(segment.end)
      && segment.start >= 0
      && segment.end > segment.start)
    .slice()
    .sort((a, b) => a.start - b.start)
  const clips = []
  let cursor = 0
  let previousEndTicks = null
  for (const segment of clean) {
    const start = secToTicks(segment.start)
    const end = secToTicks(segment.end)
    if (previousEndTicks !== null && isFiniteNumber(minGapTicks)) {
      const gap = start - previousEndTicks
      // Real pauses survive; micro gaps close into the concatenation.
      if (gap >= minGapTicks) cursor += gap
    }
    clips.push({ in: start, out: end, offset: cursor })
    cursor += end - start
    previousEndTicks = end
  }
  return clips
}
