/**
 * Accent and neutral colours are a preference, not a per-session mood.
 *
 * Measured on 2026-11-12: picking `emerald` in /system/settings/appearance
 * rewrote `--ui-primary` on the spot, then a reload put `violet` back. The
 * picker assigned straight to `appConfig.ui.colors.primary`, which is app
 * config state held in memory, while the light/dark choice next to it
 * persisted through `nuxt-color-mode`. The user sees the whole page recolour
 * instantly, so the loss is invisible until the next reload.
 *
 * Two things are pinned here, because both are ways this regresses:
 *  - the stored shape survives a round trip, and an unknown value falls back
 *    to the default instead of writing an arbitrary class name into the theme;
 *  - both pickers offer only colours the validator accepts, so a colour the
 *    menu can write is never a colour the reader throws away.
 */
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  UI_PRIMARY_COLORS,
  UI_NEUTRAL_COLORS,
  UI_COLOR_DEFAULTS,
  readUiColorPrefs,
  writeUiColorPrefs
} from '../../app/utils/uiTheme'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

function memoryStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    storage: {
      getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
      setItem: (key: string, value: string) => { map.set(key, value) },
      removeItem: (key: string) => { map.delete(key) }
    } as unknown as Storage
  }
}

function withStore(getter: () => unknown) {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: getter })
}

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original)
  else delete (globalThis as Record<string, unknown>).localStorage
})

describe('UI colour preference — persists, validates, never throws', () => {
  it('round-trips the chosen accent and neutral', () => {
    const { storage } = memoryStore()
    withStore(() => storage)
    writeUiColorPrefs({ primary: 'emerald', neutral: 'stone' })
    assert.deepEqual(readUiColorPrefs(), { primary: 'emerald', neutral: 'stone' })
  })

  it('returns the defaults when nothing has been stored', () => {
    withStore(() => memoryStore().storage)
    assert.deepEqual(readUiColorPrefs(), UI_COLOR_DEFAULTS)
  })

  it('falls back per field when a stored colour is not one we theme', () => {
    const { storage } = memoryStore({
      'tmstudio.ui.colors': JSON.stringify({ primary: 'chartreuse', neutral: 'stone' })
    })
    withStore(() => storage)
    assert.deepEqual(readUiColorPrefs(), { primary: UI_COLOR_DEFAULTS.primary, neutral: 'stone' })
  })

  it('survives malformed JSON rather than taking the settings page down', () => {
    withStore(() => memoryStore({ 'tmstudio.ui.colors': '{not json' }).storage)
    assert.deepEqual(readUiColorPrefs(), UI_COLOR_DEFAULTS)
  })

  it('survives a store that throws on read and on write', () => {
    withStore(() => {
      throw new Error('SecurityError: storage is disabled')
    })
    assert.deepEqual(readUiColorPrefs(), UI_COLOR_DEFAULTS)
    writeUiColorPrefs({ primary: 'teal', neutral: 'zinc' })
  })

  it('every colour the pickers render is one the reader accepts', () => {
    // Both pickers now render `useUiTheme()`'s lists, so the check reads the
    // composable — the page and the account menu cannot offer their own set.
    // Three lists: the settings page's curated accents, the menu's full accents,
    // and the shared neutrals.
    const source = readFileSync(join(ROOT, 'app/composables/useUiTheme.ts'), 'utf8')
    const lists = [
      ...source.matchAll(/(?:PRIMARY_COLORS|MENU_PRIMARY_COLORS|NEUTRAL_COLORS):\s*Ui\w+Color\[\]\s*=\s*\[([^\]]*)\]/g)
    ]
    assert.equal(lists.length, 3, 'expected the settings list, the menu list and the neutral list in useUiTheme')
    const offered = lists.flatMap(([, body]) => [...body.matchAll(/'([a-z-]+)'/g)].map(match => match[1]!))
    assert.ok(offered.length >= 10, `expected a usable set of colours, found ${offered.length}`)
    for (const value of offered) {
      const known = (UI_PRIMARY_COLORS as readonly string[]).includes(value)
        || (UI_NEUTRAL_COLORS as readonly string[]).includes(value)
      assert.ok(known, `useUiTheme offers "${value}", which readUiColorPrefs would discard`)
    }
  })

  it('both pickers write through the shared preference, not straight to app config', () => {
    for (const file of ['app/pages/system/settings/appearance.vue', 'app/components/dashboard/UserMenu.vue']) {
      const source = readFileSync(join(ROOT, file), 'utf8')
      assert.ok(!/appConfig\.ui\.colors\.\w+\s*=\s*color/.test(source),
        `${file} still assigns the colour directly, so the choice dies on reload`)
    }
  })

  it('the account menu still offers every accent it offered before the change', () => {
    // The menu used to render 17 accents; the settings page renders a curated
    // 10. Routing both through one composable must not quietly drop the 7 the
    // menu had, or an existing choice becomes unselectable.
    const menu = readFileSync(join(ROOT, 'app/components/dashboard/UserMenu.vue'), 'utf8')
    const source = readFileSync(join(ROOT, 'app/composables/useUiTheme.ts'), 'utf8')
    assert.match(menu, /menuPrimaryColors:\s*colors/, 'the menu renders the full accent list the composable exposes')
    const full = source.match(/MENU_PRIMARY_COLORS:[^=]*=\s*\[([^\]]*)\]/)
    assert.ok(full, 'useUiTheme must expose the full accent list the menu renders')
    const offered = [...full[1]!.matchAll(/'([a-z-]+)'/g)].map(match => match[1]!)
    assert.equal(offered.length, 17, `the menu offered 17 accents before, now ${offered.length}`)
    for (const value of offered) {
      assert.ok((UI_PRIMARY_COLORS as readonly string[]).includes(value),
        `the menu offers "${value}", which readUiColorPrefs would discard`)
    }
  })
})
