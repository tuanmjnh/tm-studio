/**
 * Class joiner for the tmcut primitives that accept a computed class string.
 * Design tokens live in app.config.ts (semantic colors) and
 * app/assets/css/main.css (surfaces, radii, glass). This file used to carry a
 * second, contradictory palette in raw hex; it is gone so there is one source.
 */
export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ')
}
