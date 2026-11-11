// =============================================================================
//  The export modal must refuse in the same place it explains.
//
//  The reported bug: a project whose only effect was the Filter preset "Cool"
//  was refused by core, yet Start Export stayed enabled and the user learned
//  about it only from a toast AFTER the click. A control that can only be
//  refused is worse than no control — plus the message lived in the wrong place.
//
//  The verdict is core's (`planEncodeContent`); this spec holds the modal to it:
//   - the Start button is disabled while the verdict names a blocker;
//   - `startExport` refuses in the same function, so the toast is not the path;
//   - a refused preset is named by instance (`lut3d:film` → "Film"), not type.
//
//  The behaviour lives in a Vue component the node runner cannot mount, and the
//  failure mode (a button that lies) is visible in the template, so these are
//  source contracts on purpose — the same shape as tmcut_capability_honesty.
// =============================================================================
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
const modal = read('app/components/tmcut/TmcutExportModal.vue')

/** The `<UButton …>` block that renders Start Export. */
function startButton(): string {
  const at = modal.indexOf('tmcut.export.startExport')
  assert.ok(at > 0, 'the Start Export button is gone — update this spec with the new label')
  const open = modal.lastIndexOf('<UButton', at)
  return modal.slice(open, at)
}

describe('Start Export is disabled while core names a blocker', () => {
  it('the button carries a :disabled bound to the verdict', () => {
    const button = startButton()
    assert.match(button, /:disabled="exportBlocked"/,
      'the button is offered even though the banner above it says the file cannot be written')
  })

  it('the disabled button says why, next to itself', () => {
    const button = startButton()
    assert.match(button, /blockedButtonHint/,
      'a disabled button with no reason is a dead end — the hint names the banner')
  })

  it('`startExport` refuses in the same place, so the toast is not how the user learns', () => {
    const body = modal.match(/async function startExport\(\)[\s\S]*?\n\}/)?.[0] ?? ''
    assert.ok(body, 'startExport is gone')
    assert.match(body, /if \(exportBlocked\.value\) return/,
      'a click can still start a render the banner already refused')
    // The guard must come before the render starts, not after.
    assert.ok(body.indexOf('exportBlocked') < body.indexOf('runWebExport'),
      'the guard must precede the render call')
  })
})

describe('a refused effect is named by instance, readable to a person', () => {
  it('the modal splits `type:preset` instead of printing the raw id', () => {
    assert.match(modal, /name\.split\(':'\)/, 'a refused preset must be named, not printed as `lut3d:film`')
    assert.match(modal, /tmcut\.fxLib\.lut\.\$\{preset\}/, 'the preset name comes from the library keys')
  })

  it('a bare type still resolves through the inspector keys', () => {
    assert.match(modal, /t\(`tmcut\.effects\.\$\{key\}`\)/)
  })

  it('every preset a person can pick has a library name in both locales', () => {
    const en = JSON.parse(read('i18n/locales/en.json'))
    const vi = JSON.parse(read('i18n/locales/vi.json'))
    for (const preset of ['cool', 'film']) {
      for (const [locale, json] of [['en', en], ['vi', vi]] as const) {
        const name = json?.tmcut?.fxLib?.lut?.[preset]
        assert.equal(typeof name, 'string', `${locale} has no name for the ${preset} preset`)
        assert.ok(name.length > 0, `${locale} ships an empty name for ${preset}`)
      }
    }
  })

  it('the blocked-button hint exists in both locales', () => {
    for (const locale of ['en', 'vi']) {
      const json = JSON.parse(read(`i18n/locales/${locale}.json`))
      const hint = json?.tmcut?.export?.blockedButtonHint
      assert.equal(typeof hint, 'string', `${locale} is missing tmcut.export.blockedButtonHint`)
      assert.ok(hint.length > 0, `${locale} ships an empty hint`)
    }
  })
})
