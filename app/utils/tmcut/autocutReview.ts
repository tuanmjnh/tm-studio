/**
 * AutoCut step-3 review keyboard navigation (docs §202, R138).
 *
 * The segment list was click-only: reviewing a 60-segment EDL meant 60
 * mouse hits. Arrows navigate, Space toggles include, Enter plays —
 * this module owns the ONE decision the flow needs: which row is
 * active next. Pure, unit-tested; the page only wires keydown → action.
 *
 * Semantics (deliberate, pinned by spec):
 * - NO wrapping: the ends are hard stops. Wrapping on a long list
 *   silently teleports the reviewer across the timeline.
 * - Nothing active yet: ArrowDown picks the FIRST row, ArrowUp the
 *   LAST (same muscle memory as file lists everywhere).
 * - Empty list / null count: null in, null out — never throws.
 */

/**
 * Next active index for a directional step, or null when there is
 * nothing to activate. `current` may be null (nothing selected).
 */
export function nextActiveIndex(current: number | null, count: number, delta: number): number | null {
  if (!Number.isInteger(count) || count <= 0 || delta === 0) return current ?? null
  if (current === null || current < 0 || current >= count) {
    // Stale/absent selection (e.g. segments re-scored mid-review):
    // clamp into range from the direction of travel.
    return delta > 0 ? 0 : count - 1
  }
  return Math.min(count - 1, Math.max(0, current + delta))
}
