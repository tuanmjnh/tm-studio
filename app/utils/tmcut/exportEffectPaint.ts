/**
 * The file's half of one effect's look (slice E1).
 *
 * `fxPreview.effectCssParts` is the monitor's face of an effect: the CSS
 * `filter`/`transform` a DOM element carries. Canvas 2D supports the same
 * `filter` grammar natively (`ctx.filter`), so for the effects whose whole look
 * IS that filter string, the exporter can emit the preview's exact words instead
 * of a second formula that would drift.
 *
 * That is the entire trick, and its limit: this module only claims effects whose
 * preview face is a filter and nothing else. An effect that needs an overlay
 * plate (vignette, letterbox, grain), a transform (mirror, rotate), a ghost
 * layer (chromatic, afterimage) or HTML-only tricks stays refused in core — a
 * missing look in a file is worse than an honest refusal, which is why
 * `EXPORT_EFFECT_TYPES` may only name effects `exportBakesEffectInstance` also
 * names for every instance of that type.
 *
 * `lut3d` is the exception that proves the rule: its bare type is not bakeable,
 * because the look lives in the preset, not the type. It is claimed per instance
 * through `exportBakesEffectInstance`, which answers for THIS preset's grade —
 * so a `cool` filter paints and a `film` filter (which needs a grain plate) is
 * refused by the same law before it ever reaches here.
 *
 * Pure and store-free: the export glue runs in a worker on some hosts, and a
 * spec has to hold this list against core's without a canvas.
 */
import { exportBakesEffectInstance } from 'tmcut-core'
import { effectCssParts } from './fxPreview'

/**
 * Effects this painter bakes by TYPE. Must equal core's `EXPORT_BAKED_EFFECTS`
 * — the spec `tmcut_export_effect_paint.spec.ts` holds the two together, because
 * a mismatch is either a silently missing look or a project refused for nothing.
 *
 * Only effects whose preview face is a bare CSS filter belong here. Adding one
 * whose preview also needs an overlay plate means this module owes that plate
 * too, and the canvas has no `linear-gradient` shorthand to borrow.
 *
 * `lut3d` is deliberately absent: it is baked per INSTANCE (an 18-of-20 preset
 * question), which no type-level list can answer. The spec checks that this list
 * plus the instance law covers exactly what core refuses.
 */
export const EXPORT_EFFECT_TYPES: readonly string[] = Object.freeze([
  'blur',
  'mono',
  'negate',
  'sepia',
  'sharpen',
  'vibrance',
  'vivid'
])

/**
 * The CSS `filter` string a frame carries after this effect chain, or `''`.
 *
 * The chain is the clip's authored order, and CSS applies filters left to right
 * — the same order the preview stacks them in, so a clip that negates then
 * sepia-tints exports the same picture the monitor showed. An effect outside
 * the baked set contributes nothing rather than a guess: core never lets such a
 * clip reach this function, and half-applying one would hide that.
 *
 * The decision is per INSTANCE, not per type — `exportBakesEffectInstance` is
 * core's single answer for this exact `{ type, params }`, so a `lut3d` clip is
 * baked when its preset's grade needs no plate and refused when it does.
 */
export function exportEffectFilter(
  effects: readonly { type?: unknown, params?: Record<string, unknown> }[] | null | undefined
): string {
  const parts: string[] = []
  for (const effect of effects ?? []) {
    if (!exportBakesEffectInstance(effect)) continue
    const type = typeof effect?.type === 'string' ? effect.type : ''
    const { filter } = effectCssParts(type, effect.params ?? {})
    if (filter) parts.push(filter)
  }
  return parts.join(' ')
}
