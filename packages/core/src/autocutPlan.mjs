// =============================================================================
//  @tmcut/core — AutoCut plan bridge (roadmap v3 Phase 7, §14)
//
//  The deterministic AutoCut pipeline (scene/silence scoring -> EDL) stays
//  exactly as it is; this module converts its output into a standard AI
//  Edit Plan, so AutoCut and the AI Editor share ONE apply path:
//  validateEditPlan -> applyEditPlan (core commands, one undo entry).
//
//  Optional captions: transcript lines inside a KEPT span become text clips
//  at their relative timeline position. Dropped spans drop their captions —
//  captions can never leak cut-away content.
//
//  Zero-dependency, pure.
// =============================================================================

import { TICKS_PER_SECOND } from './time.mjs'
import { segmentsToClips } from './edl.mjs'

const MAX_CAPTION_CHARS = 120
const MIN_CAPTION_TICKS = Math.round(0.4 * TICKS_PER_SECOND)

function secToTicksLocal(sec) {
  return Math.max(0, Math.round(sec * TICKS_PER_SECOND))
}

function clampText(text) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  return clean.length > MAX_CAPTION_CHARS ? `${clean.slice(0, MAX_CAPTION_CHARS - 1)}…` : clean
}

/**
 * Convert an EDL (optionally filtered to the user-accepted `segments`) into
 * a validated Edit Plan for a fresh project. `options`:
 *  - `mediaRef`: the opaque ref the host resolves to the source file.
 *  - `name`: clip display name.
 *  - `captions`: transcript lines [{start,end,text}] in SECONDS (Whisper
 *    shape); when given, each line overlapping a kept span becomes a text
 *    clip. Lines in dropped spans are ignored by construction.
 * Returns { plan, warnings } — segmentsToClips already drops broken spans
 * (reported), empty input yields operations: [] (caller must not apply).
 */
export function editPlanFromEdl(edl, segments, options = {}) {
  const warnings = []
  const mediaRef = typeof options.mediaRef === 'string' ? options.mediaRef : ''
  const operations = []

  const clips = segmentsToClips(edl, Array.isArray(segments) && segments.length > 0 ? segments : edl?.segments)
  for (const clip of clips) {
    operations.push({
      type: 'add-clip',
      trackType: 'video',
      name: options.name || 'AutoCut segment',
      mediaRef,
      in: Math.round(clip.in ?? 0),
      out: Math.round(clip.out ?? 0),
      offset: Math.round(clip.offset ?? 0)
    })
  }

  if (Array.isArray(options.captions) && options.captions.length > 0) {
    // Timeline position of each kept source span (seconds), contiguous.
    const spans = clips.map(clip => ({
      srcStart: (clip.in ?? 0) / TICKS_PER_SECOND,
      srcEnd: (clip.out ?? 0) / TICKS_PER_SECOND,
      tlStart: (clip.offset ?? 0) / TICKS_PER_SECOND
    }))
    let added = 0
    for (const line of options.captions) {
      const start = Number(line?.start)
      const end = Number(line?.end)
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
      const text = clampText(line.text)
      if (!text) continue
      // Map the line onto the FIRST kept span it overlaps; trim to that
      // span's bounds so a caption never overhangs a cut.
      const span = spans.find(s => end > s.srcStart && start < s.srcEnd)
      if (!span) {
        warnings.push(`caption at ${start.toFixed(1)}s dropped (in a removed span)`)
        continue
      }
      const tlStart = span.tlStart + (Math.max(start, span.srcStart) - span.srcStart)
      const tlEnd = span.tlStart + (Math.min(end, span.srcEnd) - span.srcStart)
      const offsetTicks = secToTicksLocal(tlStart)
      const outTicks = offsetTicks + Math.max(MIN_CAPTION_TICKS, secToTicksLocal(tlEnd - tlStart))
      operations.push({
        type: 'add-clip',
        trackType: 'text',
        name: 'Caption',
        text,
        offset: offsetTicks,
        out: outTicks,
        fontSize: 32,
        color: '#ffffff'
      })
      added += 1
    }
    warnings.push(`${added} caption clip(s) from ${options.captions.length} transcript line(s)`)
  }

  const plan = {
    schemaVersion: 1,
    intentSummary: options.intentSummary || `AutoCut: ${edl?.profile || 'custom'} — ${clips.length} segment(s) kept`,
    assumptions: [
      'Deterministic pipeline output (scenes/silence/transcript analysis), not a language model.'
    ],
    operations
  }
  return { plan, warnings }
}
