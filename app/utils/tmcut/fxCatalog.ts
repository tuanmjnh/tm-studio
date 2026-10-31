/**
 * Render-side transition catalog (roadmap R128 / core C5).
 *
 * Single source of truth for how a TMCut transition key renders in FFmpeg
 * (`xfade=transition=<name>`) and how it is labelled/grouped in the UI. Pure
 * data + tiny helpers — no component, store or core import — so the render
 * graph (app/utils/tmcut/render/video.ts) and the FX library panel consume
 * the exact same table.
 *
 * Keys mirror core KNOWN_TRANSITIONS: the 6 legacy TMCut keys first, then the
 * 39 literal FFmpeg xfade names (alphabetical). tests/unit/
 * tmcut_fx_catalog.spec.ts pins the order against the core export, so the two
 * sides cannot drift.
 */

export type TmcutTransitionCategory
  = | 'basic' | 'slide' | 'wipe' | 'shape' | 'smooth' | 'zoom' | 'slice' | 'diagonal'

export interface TmcutTransitionEntry {
  /** TMCut transition key (what a clip stores in `transitionIn.type`). */
  key: string
  /** FFmpeg xfade transition name. */
  xfade: string
  category: TmcutTransitionCategory
  /** Readable English label for the UI. */
  label: string
}

/** Every category, in UI display order. */
export const TRANSITION_CATEGORIES: readonly TmcutTransitionCategory[] = [
  'basic',
  'slide',
  'wipe',
  'shape',
  'smooth',
  'zoom',
  'slice',
  'diagonal'
]

/**
 * Transition names accepted by FFmpeg's xfade filter — the documented
 * `ffmpeg -h filter=xfade` set (transitions 0..57 plus `custom`).
 *
 * `custom` is part of the documented set but is NOT fallback-safe: it
 * requires a user-supplied `expr`, so emitting it as a bare name produces a
 * broken filter graph. `xfadeNameFor()` therefore only passes back the names
 * in this list other than `custom`.
 */
export const FFMPEG_XFADE_NAMES: readonly string[] = [
  'circleclose',
  'circlecrop',
  'circleopen',
  'coverdown',
  'coverleft',
  'coverright',
  'coverup',
  'custom',
  'diagbl',
  'diagbr',
  'diagtl',
  'diagtr',
  'distance',
  'dissolve',
  'fade',
  'fadeblack',
  'fadefast',
  'fadegrays',
  'fadeslow',
  'fadewhite',
  'hblur',
  'hlslice',
  'hlwind',
  'horzclose',
  'horzopen',
  'hrslice',
  'hrwind',
  'pixelize',
  'radial',
  'rectcrop',
  'revealdown',
  'revealleft',
  'revealright',
  'revealup',
  'slideleft',
  'slideright',
  'slidedown',
  'slideup',
  'smoothdown',
  'smoothleft',
  'smoothright',
  'smoothup',
  'squeezeh',
  'squeezev',
  'vertclose',
  'vertopen',
  'vdslice',
  'vdwind',
  'vuslice',
  'vuwind',
  'wipebl',
  'wipebr',
  'wipedown',
  'wipeleft',
  'wiperight',
  'wipetl',
  'wipetr',
  'wipeup',
  'zoomin'
]

/** xfade names that are safe to emit without extra options. */
const SAFE_XFADE_NAMES = FFMPEG_XFADE_NAMES.filter(name => name !== 'custom')

/** Last-resort transition: always valid, always renders. */
const DEFAULT_XFADE = 'fade'

/**
 * The 45 transitions a project may store, in frozen core order.
 * Legacy TMCut keys keep their aliases (wipe-left -> wipeleft, ...), the
 * remaining keys are already literal xfade names.
 */
export const TRANSITION_CATALOG: TmcutTransitionEntry[] = [
  { key: 'fade', xfade: 'fade', category: 'basic', label: 'Fade' },
  { key: 'dissolve', xfade: 'dissolve', category: 'basic', label: 'Dissolve' },
  { key: 'wipe-left', xfade: 'wipeleft', category: 'wipe', label: 'Wipe Left' },
  { key: 'wipe-right', xfade: 'wiperight', category: 'wipe', label: 'Wipe Right' },
  { key: 'slide-left', xfade: 'slideleft', category: 'slide', label: 'Slide Left' },
  { key: 'zoom-in', xfade: 'zoomin', category: 'zoom', label: 'Zoom In' },
  { key: 'circleclose', xfade: 'circleclose', category: 'shape', label: 'Circle Close' },
  { key: 'circlecrop', xfade: 'circlecrop', category: 'shape', label: 'Circle Crop' },
  { key: 'circleopen', xfade: 'circleopen', category: 'shape', label: 'Circle Open' },
  { key: 'diagbl', xfade: 'diagbl', category: 'diagonal', label: 'Diagonal Bottom Left' },
  { key: 'diagbr', xfade: 'diagbr', category: 'diagonal', label: 'Diagonal Bottom Right' },
  { key: 'diagtl', xfade: 'diagtl', category: 'diagonal', label: 'Diagonal Top Left' },
  { key: 'diagtr', xfade: 'diagtr', category: 'diagonal', label: 'Diagonal Top Right' },
  { key: 'distance', xfade: 'distance', category: 'basic', label: 'Distance' },
  { key: 'fadeblack', xfade: 'fadeblack', category: 'basic', label: 'Fade to Black' },
  { key: 'fadegrays', xfade: 'fadegrays', category: 'basic', label: 'Fade to Gray' },
  { key: 'fadewhite', xfade: 'fadewhite', category: 'basic', label: 'Fade to White' },
  { key: 'hblur', xfade: 'hblur', category: 'slice', label: 'Horizontal Blur' },
  { key: 'hlslice', xfade: 'hlslice', category: 'slice', label: 'Horizontal Left Slice' },
  { key: 'hrslice', xfade: 'hrslice', category: 'slice', label: 'Horizontal Right Slice' },
  { key: 'horzclose', xfade: 'horzclose', category: 'shape', label: 'Horizontal Close' },
  { key: 'horzopen', xfade: 'horzopen', category: 'shape', label: 'Horizontal Open' },
  { key: 'pixelize', xfade: 'pixelize', category: 'basic', label: 'Pixelize' },
  { key: 'radial', xfade: 'radial', category: 'basic', label: 'Radial' },
  { key: 'rectcrop', xfade: 'rectcrop', category: 'shape', label: 'Rectangle Crop' },
  { key: 'slidedown', xfade: 'slidedown', category: 'slide', label: 'Slide Down' },
  { key: 'slideright', xfade: 'slideright', category: 'slide', label: 'Slide Right' },
  { key: 'slideup', xfade: 'slideup', category: 'slide', label: 'Slide Up' },
  { key: 'smoothdown', xfade: 'smoothdown', category: 'smooth', label: 'Smooth Down' },
  { key: 'smoothleft', xfade: 'smoothleft', category: 'smooth', label: 'Smooth Left' },
  { key: 'smoothright', xfade: 'smoothright', category: 'smooth', label: 'Smooth Right' },
  { key: 'smoothup', xfade: 'smoothup', category: 'smooth', label: 'Smooth Up' },
  { key: 'squeezeh', xfade: 'squeezeh', category: 'shape', label: 'Squeeze Horizontal' },
  { key: 'squeezev', xfade: 'squeezev', category: 'shape', label: 'Squeeze Vertical' },
  { key: 'vertclose', xfade: 'vertclose', category: 'shape', label: 'Vertical Close' },
  { key: 'vertopen', xfade: 'vertopen', category: 'shape', label: 'Vertical Open' },
  { key: 'vdslice', xfade: 'vdslice', category: 'slice', label: 'Vertical Down Slice' },
  { key: 'vuslice', xfade: 'vuslice', category: 'slice', label: 'Vertical Up Slice' },
  { key: 'wipebl', xfade: 'wipebl', category: 'wipe', label: 'Wipe Bottom Left' },
  { key: 'wipebr', xfade: 'wipebr', category: 'wipe', label: 'Wipe Bottom Right' },
  { key: 'wipedown', xfade: 'wipedown', category: 'wipe', label: 'Wipe Down' },
  { key: 'wipetl', xfade: 'wipetl', category: 'wipe', label: 'Wipe Top Left' },
  { key: 'wipetr', xfade: 'wipetr', category: 'wipe', label: 'Wipe Top Right' },
  { key: 'wipeup', xfade: 'wipeup', category: 'wipe', label: 'Wipe Up' },
  { key: 'zoomin', xfade: 'zoomin', category: 'zoom', label: 'Zoom In' }
]

function catalogEntry(key: string | undefined | null): TmcutTransitionEntry | undefined {
  if (typeof key !== 'string') return undefined
  return TRANSITION_CATALOG.find(entry => entry.key === key)
}

/**
 * Resolves a stored transition key to the FFmpeg xfade name that must be
 * emitted. Never returns something that would break the filter graph:
 *  - a catalog key resolves through its alias (wipe-left -> wipeleft);
 *  - an unknown key that is already a documented xfade name passes through;
 *  - anything else (garbage, missing, `custom`) falls back to `fade`.
 */
export function xfadeNameFor(key: string | undefined | null): string {
  const entry = catalogEntry(key)
  if (entry) return entry.xfade
  if (typeof key === 'string' && SAFE_XFADE_NAMES.includes(key)) return key
  return DEFAULT_XFADE
}

/** Readable English label for a transition key; unknown keys are humanised. */
export function transitionLabel(key: string | undefined | null): string {
  const entry = catalogEntry(key)
  if (entry) return entry.label
  if (typeof key !== 'string' || key.length === 0) return 'Fade'
  return key
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/**
 * Catalog entries grouped by category. Every catalog entry appears in exactly
 * one bucket; every category is present (empty when unused) so the UI can
 * iterate the record without a presence check.
 */
export function transitionsByCategory(): Record<TmcutTransitionCategory, TmcutTransitionEntry[]> {
  const grouped = {} as Record<TmcutTransitionCategory, TmcutTransitionEntry[]>
  for (const category of TRANSITION_CATEGORIES) {
    grouped[category] = []
  }
  for (const entry of TRANSITION_CATALOG) {
    grouped[entry.category].push(entry)
  }
  return grouped
}
