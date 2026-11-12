import { readUiColorPrefs, writeUiColorPrefs, UI_PRIMARY_COLORS, UI_NEUTRAL_COLORS } from '~/utils/uiTheme'
import type { UiNeutralColor, UiPrimaryColor } from '~/utils/uiTheme'

// The settings page offers a curated subset so it stays scannable; the account
// menu has always offered the full accent set, and shrinking it would make a
// saved choice unreachable. Both lists only name colours utils/uiTheme accepts —
// a colour offered here but discarded on reload is worse than not offering it.
const PRIMARY_COLORS: UiPrimaryColor[] = ['blue', 'indigo', 'violet', 'purple', 'emerald', 'teal', 'cyan', 'rose', 'red', 'amber']
const MENU_PRIMARY_COLORS: UiPrimaryColor[] = ['red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose']
const NEUTRAL_COLORS: UiNeutralColor[] = ['slate', 'gray', 'zinc', 'neutral', 'stone', 'taupe', 'mauve', 'mist', 'olive']

for (const color of [...PRIMARY_COLORS, ...MENU_PRIMARY_COLORS]) {
  if (!(UI_PRIMARY_COLORS as readonly string[]).includes(color)) {
    throw new Error(`useUiTheme offers accent "${color}", which utils/uiTheme would discard`)
  }
}
for (const color of NEUTRAL_COLORS) {
  if (!(UI_NEUTRAL_COLORS as readonly string[]).includes(color)) {
    throw new Error(`useUiTheme offers neutral "${color}", which utils/uiTheme would discard`)
  }
}

/**
 * One writer for both pickers: apply to the theme, then remember it.
 *
 * Accent + neutral are a preference, not per-session state. Before this,
 * assigning to `appConfig.ui.colors` recoloured the page and the next reload
 * put the default back (measured 2026-11-12: `emerald` came back as `violet`).
 * The stored choice is re-applied on first use, which is why the read lives
 * here rather than in a page — the account menu needs it too.
 */
export function useUiTheme() {
  const appConfig = useAppConfig()

  if (import.meta.client) {
    const stored = readUiColorPrefs()
    appConfig.ui.colors.primary = stored.primary
    appConfig.ui.colors.neutral = stored.neutral
  }

  function setPrimary(color: UiPrimaryColor): void {
    appConfig.ui.colors.primary = color
    writeUiColorPrefs({ primary: color, neutral: appConfig.ui.colors.neutral as UiNeutralColor })
  }

  function setNeutral(color: UiNeutralColor): void {
    appConfig.ui.colors.neutral = color
    writeUiColorPrefs({ primary: appConfig.ui.colors.primary as UiPrimaryColor, neutral: color })
  }

  return {
    primaryColors: PRIMARY_COLORS,
    menuPrimaryColors: MENU_PRIMARY_COLORS,
    neutralColors: NEUTRAL_COLORS,
    setPrimary,
    setNeutral
  }
}
