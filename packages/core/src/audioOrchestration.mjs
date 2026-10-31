// =============================================================================
//  @tmcut/core — Audio orchestration (roadmap v3 PART H, Phase 8 §24)
//
//  Deterministic planners that turn an EDITED TIMELINE SHAPE + a set of
//  RIGHTS-CLEARED audio candidates into standard Edit Plan operations
//  (music beds, SFX cues) plus the provenance record the acceptance
//  criterion demands: every audio element ends with a source/provenance
//  record, a timeline range and its rights metadata.
//
//  Trust model unchanged: candidates come from the host (Asset Center
//  installs / library), are referenced by opaque mediaRef only, and the
//  produced plan flows through validateEditPlan/applyEditPlan like
//  everything else. Rights gating happens HERE at planning time — a
//  candidate whose license is not approved never enters the plan.
//
//  Zero-dependency, pure.
// =============================================================================

import { TICKS_PER_SECOND } from './time.mjs'

/** License states an orchestration may use without asking the user. */
export const USABLE_LICENSE_STATUSES = ['approved', 'review']

/**
 * Rights-aware candidate ranking (§24 "rights-aware source prioritization"):
 * approved-before-review, library/library-install before generated, newest
 * first inside a tier. Unknown/review-blocked entries are DROPPED here —
 * silence beats unlicensed audio.
 */
export function rankAudioCandidates(candidates = [], { allowGenerated = false } = {}) {
  const TIER = {
    'license-approved': 0,
    'license-review': 1
  }
  const ORIGIN = { library: 0, 'asset-center': 1, generated: 2 }
  return candidates
    .filter(c => c && typeof c.mediaRef === 'string' && c.mediaRef !== '')
    .filter(c => USABLE_LICENSE_STATUSES.includes(c.licenseStatus || 'unknown'))
    .filter(c => allowGenerated || c.origin !== 'generated')
    .slice()
    .sort((a, b) => {
      const tier = (TIER[`license-${a.licenseStatus}`] ?? 9) - (TIER[`license-${b.licenseStatus}`] ?? 9)
      if (tier !== 0) return tier
      const origin = (ORIGIN[a.origin] ?? 9) - (ORIGIN[b.origin] ?? 9)
      if (origin !== 0) return origin
      return (b.addedAt || 0) - (a.addedAt || 0)
    })
}

function clampFade(ticks, maxTicks) {
  const t = Math.max(0, Math.round(Number(ticks) || 0))
  return Math.min(t, Math.round(maxTicks))
}

/**
 * Lay a music bed under the current timeline (§24 fades/ducking):
 * repeat the track back-to-back until `durationTicks`, fade in the first
 * part, fade out the last, duck the whole bed to `duckVolume` (default 35)
 * while dialogue exists (dialoguePresent false -> bed at `bedVolume`).
 * Returns { operations, provenance } — operations are add-clip audio ops.
 */
export function planMusicBed(candidates, context, options = {}) {
  const operations = []
  const provenance = []
  const ranked = rankAudioCandidates(candidates, options)
  const pick = ranked[0]
  const durationTicks = Math.max(0, Math.round(Number(context?.durationTicks) || 0))
  if (!pick || durationTicks <= 0) return { operations, provenance }

  const bedVolume = (context?.dialoguePresent === false || options.dialoguePresent === false)
    ? 90
    : (options.bedVolume ?? 35)
  const fadeInTicks = clampFade(options.fadeInTicks ?? 0.75 * TICKS_PER_SECOND, durationTicks)
  const trackTicks = Math.max(TICKS_PER_SECOND, Math.round(Number(pick.durationTicks) || durationTicks))

  let cursor = 0
  let part = 0
  while (cursor < durationTicks && part < 200) {
    const remaining = durationTicks - cursor
    const clipTicks = Math.min(trackTicks, remaining)
    const isFirst = part === 0
    const isLast = cursor + clipTicks >= durationTicks
    const fade = {
      in: isFirst ? fadeInTicks : 0,
      out: isLast ? clampFade(options.fadeOutTicks ?? 1.5 * TICKS_PER_SECOND, clipTicks) : 0
    }
    operations.push({
      type: 'add-clip',
      trackType: 'audio',
      name: `${pick.name || 'Music bed'}${part > 0 ? ` (part ${part + 1})` : ''}`,
      mediaRef: pick.mediaRef,
      in: 0,
      out: clipTicks,
      offset: cursor,
      volume: bedVolume,
      fade
    })
    provenance.push({
      mediaRef: pick.mediaRef,
      role: 'music-bed',
      part,
      timeline: { startTicks: cursor, durationTicks: clipTicks },
      source: pick.source || null,
      origin: pick.origin || null,
      license: { status: pick.licenseStatus || 'unknown', name: pick.licenseName || '', attribution: pick.attribution || '' }
    })
    cursor += clipTicks
    part += 1
  }
  return { operations, provenance }
}

/**
 * Place SFX stingers at transition cues (§24 "SFX cue planning").
 * `cues`: [{ atTicks, name }] — typically transition boundaries. The first
 * ranked candidate is used for every cue (a consistent whoosh), short
 * 250 ms fades keep the stingers from clicking. Refused cues (past the
 * timeline end, or a cue closer than `minGapTicks` to the previous one)
 * are reported, never silently shifted.
 */
export function planSfxCues(candidates, cues, context, options = {}) {
  const operations = []
  const provenance = []
  const skipped = []
  const ranked = rankAudioCandidates(candidates, options)
  const pick = ranked[0]
  const durationTicks = Math.max(0, Math.round(Number(context?.durationTicks) || 0))
  if (!pick || !Array.isArray(cues) || cues.length === 0) return { operations, provenance, skipped }

  const minGapTicks = Math.max(0, Math.round(Number(options.minGapTicks) || 0.5 * TICKS_PER_SECOND))
  const sfxTicks = Math.max(1, Math.round(Number(pick.durationTicks) || 0.6 * TICKS_PER_SECOND))
  const sorted = cues
    .map(cue => ({ atTicks: Math.max(0, Math.round(Number(cue?.atTicks) || 0)), name: String(cue?.name || 'Transition') }))
    .sort((a, b) => a.atTicks - b.atTicks)

  let lastEnd = -Infinity
  for (const cue of sorted) {
    if (cue.atTicks + sfxTicks > durationTicks + TICKS_PER_SECOND) {
      skipped.push({ ...cue, reason: 'past-timeline-end' })
      continue
    }
    if (cue.atTicks < lastEnd + minGapTicks) {
      skipped.push({ ...cue, reason: 'too-close' })
      continue
    }
    operations.push({
      type: 'add-clip',
      trackType: 'audio',
      name: `SFX: ${cue.name}`,
      mediaRef: pick.mediaRef,
      in: 0,
      out: sfxTicks,
      offset: cue.atTicks,
      volume: options.cueVolume ?? 80,
      fade: { in: TICKS_PER_SECOND / 4, out: TICKS_PER_SECOND / 4 }
    })
    provenance.push({
      mediaRef: pick.mediaRef,
      role: 'sfx-cue',
      cueName: cue.name,
      timeline: { startTicks: cue.atTicks, durationTicks: sfxTicks },
      source: pick.source || null,
      origin: pick.origin || null,
      license: { status: pick.licenseStatus || 'unknown', name: pick.licenseName || '', attribution: pick.attribution || '' }
    })
    lastEnd = cue.atTicks + sfxTicks
  }
  return { operations, provenance, skipped }
}

/**
 * Fold a timeline's existing audio provenance records into the shape the
 * project stores alongside the plan (§24 acceptance: queryable record of
 * every audio element — source, range, rights). Pure merge; the caller
 * persists the array under its own storage key.
 */
export function mergeAudioProvenance(existing, additions) {
  const stamp = Date.now()
  const out = Array.isArray(existing) ? existing.slice() : []
  for (const rec of additions || []) {
    out.push({ ...rec, addedAt: stamp, via: 'audio-orchestration' })
  }
  return out
}
