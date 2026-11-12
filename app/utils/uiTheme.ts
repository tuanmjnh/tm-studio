import { readStored, writeStored } from './tmcut/localStore'

// The accent and neutral colours people pick in Appearance (and in the account
// menu). Nuxt UI reads them from `appConfig.ui.colors`, which lives in memory,
// so assigning to it recolours the page and then forgets on the next reload —
// measured on 2026-11-12 (`emerald` came back as `violet`). This module is the
// one place that keeps the choice, validates it, and hands it back to whoever
// applies it. Light/dark already persists through `nuxt-color-mode`; this is the
// same promise for the palette.

const STORAGE_KEY = 'tmstudio.ui.colors'

/** Accents the app config declares, so a stored value always resolves to a real class. */
export const UI_PRIMARY_COLORS = [
  'blue', 'indigo', 'violet', 'purple', 'emerald', 'teal', 'cyan',
  'rose', 'red', 'amber', 'orange', 'yellow', 'lime', 'green', 'sky',
  'fuchsia', 'pink'
] as const

/** Neutrals the app config declares. */
export const UI_NEUTRAL_COLORS = [
  'slate', 'gray', 'zinc', 'neutral', 'stone', 'taupe', 'mauve', 'mist', 'olive'
] as const

export type UiPrimaryColor = typeof UI_PRIMARY_COLORS[number]
export type UiNeutralColor = typeof UI_NEUTRAL_COLORS[number]

export interface UiColorPrefs {
  primary: UiPrimaryColor
  neutral: UiNeutralColor
}

/** Must match `ui.colors` in app/app.config.ts — the defaults both pickers start from. */
export const UI_COLOR_DEFAULTS: UiColorPrefs = { primary: 'violet', neutral: 'zinc' }

function isPrimary(value: unknown): value is UiPrimaryColor {
  return typeof value === 'string' && (UI_PRIMARY_COLORS as readonly string[]).includes(value)
}

function isNeutral(value: unknown): value is UiNeutralColor {
  return typeof value === 'string' && (UI_NEUTRAL_COLORS as readonly string[]).includes(value)
}

/**
 * The stored preference, field by field.
 *
 * A field is only taken when it names a colour the theme declares: a
 * hand-edited or half-migrated value falls back to that field's default rather
 * than writing an unknown class name into `appConfig`.
 */
export function readUiColorPrefs(): UiColorPrefs {
  const raw = readStored(STORAGE_KEY)
  if (!raw) return { ...UI_COLOR_DEFAULTS }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...UI_COLOR_DEFAULTS }
  }
  const record = (parsed ?? {}) as Record<string, unknown>
  return {
    primary: isPrimary(record.primary) ? record.primary : UI_COLOR_DEFAULTS.primary,
    neutral: isNeutral(record.neutral) ? record.neutral : UI_COLOR_DEFAULTS.neutral
  }
}

/** Persist the choice. Best-effort, like every other preference here. */
export function writeUiColorPrefs(prefs: UiColorPrefs): void {
  writeStored(STORAGE_KEY, JSON.stringify({
    primary: isPrimary(prefs.primary) ? prefs.primary : UI_COLOR_DEFAULTS.primary,
    neutral: isNeutral(prefs.neutral) ? prefs.neutral : UI_COLOR_DEFAULTS.neutral
  }))
}
