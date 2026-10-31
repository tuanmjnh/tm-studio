/**
 * AutoCut wizard preferences persistence (docs §200, R136).
 *
 * Before this, every reload silently reset profile / filter / triage /
 * weight / keywords to the hard defaults — the R135 slider in
 * particular: a user tuning the AI influence to 40% lost it on reload.
 *
 * Design rules (same doctrine as the rest of the media layer):
 * - Pure functions, no Vue, no window — unit-testable in plain Node.
 * - NEVER trust what comes back out of localStorage: garbage JSON,
 *   unknown profile ids, booleans-as-strings, an aiWeight of 99. Every
 *   field is sanitized independently; one corrupt field never discards
 *   the others, and nothing ever throws.
 * - aiWeight clamps to 0..0.5 — the SAME ceiling core enforces in
 *   scoreSegments, so the stored shape can never express a weight the
 *   engine refuses to honor (the spec pins the parity).
 */
import type { AutocutProfile } from '~/composables/useTmcutAutocut'

export const AUTOCUT_PREFS_KEY = 'tmcut_autocut_prefs_v1'

export interface AutocutPrefs {
  profile: AutocutProfile
  filterFillerWords: boolean
  aiAnalysis: boolean
  aiWeight: number
  keywordsText: string
}

// The closed set mirroring the AutocutProfile union (the spec pins
// parity against the page's profile grid — drift = red test).
export const AUTOCUT_PROFILES = ['viral-shorts', 'podcast-summary', 'cinematic-vlog'] as const

export const AUTOCUT_AI_WEIGHT_DEFAULT = 0.25
export const AUTOCUT_AI_WEIGHT_MAX = 0.5

export const AUTOCUT_PREFS_DEFAULT: AutocutPrefs = {
  profile: 'viral-shorts',
  filterFillerWords: true,
  aiAnalysis: false,
  aiWeight: AUTOCUT_AI_WEIGHT_DEFAULT,
  keywordsText: ''
}

function sanitizePrefs(raw: unknown): AutocutPrefs {
  const d = AUTOCUT_PREFS_DEFAULT
  if (typeof raw !== 'object' || raw === null) return { ...d }
  const p = raw as Record<string, unknown>
  const weight = Number(p.aiWeight)
  return {
    profile: (AUTOCUT_PROFILES as readonly unknown[]).includes(p.profile)
      ? (p.profile as AutocutProfile)
      : d.profile,
    // Strictly `=== false` for opt-outs: a truthy string like 'off' is
    // NOT a boolean false, and garbage never silently flips a switch.
    filterFillerWords: p.filterFillerWords === false ? false : p.filterFillerWords === true ? true : d.filterFillerWords,
    aiAnalysis: p.aiAnalysis === true ? true : p.aiAnalysis === false ? false : d.aiAnalysis,
    aiWeight: Number.isFinite(weight)
      ? Math.min(AUTOCUT_AI_WEIGHT_MAX, Math.max(0, weight))
      : d.aiWeight,
    keywordsText: typeof p.keywordsText === 'string' ? p.keywordsText.slice(0, 2000) : d.keywordsText
  }
}

/** Parse stored JSON into sanitized prefs. Any garbage → defaults. */
export function parseAutocutPrefs(raw: string | null | undefined): AutocutPrefs {
  if (!raw) return { ...AUTOCUT_PREFS_DEFAULT }
  try {
    return sanitizePrefs(JSON.parse(raw))
  } catch {
    return { ...AUTOCUT_PREFS_DEFAULT }
  }
}

/** Serialize prefs (always valid JSON, always within the contract). */
export function serializeAutocutPrefs(prefs: AutocutPrefs): string {
  return JSON.stringify(sanitizePrefs(prefs))
}

/**
 * Split the persisted comma-separated keyword string into display/edit
 * tokens (docs §201, R137): trimmed, empties dropped, case-insensitive
 * dedup keeping the FIRST spelling (the user typed it first; rewriting
 * their capitalization would be the UI showing off).
 */
export function splitKeywords(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of String(text ?? '').split(',')) {
    const word = part.trim()
    if (!word) continue
    const key = word.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(word)
  }
  return out
}

/** Inverse of splitKeywords — the canonical persisted shape. */
export function joinKeywords(words: readonly string[]): string {
  return splitKeywords(words.join(',')).join(', ')
}
