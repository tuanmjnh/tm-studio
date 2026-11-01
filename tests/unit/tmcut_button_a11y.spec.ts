import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function vueFiles(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) vueFiles(path, out)
    else if (name.endsWith('.vue')) out.push(path)
  }
  return out
}

const BUTTON = /<(UButton|button)\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/>|>([\s\S]*?)<\/\1>)/g

// TmcutButton is a pass-through wrapper: its root UButton takes every name
// from the caller's aria-label prop, which the static scan cannot see. The
// call sites are checked by the dedicated test below instead.
const WRAPPERS = new Set(['app/components/tmcut/TmcutButton.vue'])

interface ButtonSite {
  file: string
  line: number
  iconOnly: boolean
  named: boolean
}

function scanButtons() {
  const sites: ButtonSite[] = []
  for (const path of vueFiles(join(ROOT, 'app'))) {
    const rel = relative(ROOT, path).replace(/\\/g, '/')
    if (WRAPPERS.has(rel)) continue
    const src = readFileSync(path, 'utf8')
    for (const match of src.matchAll(BUTTON)) {
      const attrs = match[2] ?? ''
      const inner = (match[4] ?? '')
        .replace(/<!--[\s\S]*?-->/g, '')
        // Icon and image elements render pixels, not an accessible name; a
        // dynamic text node ({{ x }}) does, so keep its placeholder.
        .replace(/<UIcon\b[^>]*\/?>/g, '')
        .replace(/<img\b[^>]*\/?>/g, '')
        .replace(/\{\{[\s\S]*?\}\}/g, 'X')
        .replace(/<[^>]+>/g, '')
      const iconOnly = !/[A-Za-z0-9]/.test(inner)
      const named = /aria-label=|:aria-label=|\btitle=|:title=|\blabel=|:label=/.test(attrs)
      sites.push({
        file: rel,
        line: src.slice(0, match.index).split('\n').length,
        iconOnly,
        named
      })
    }
  }
  return sites
}

describe('icon-only buttons carry an accessible name', () => {
  // WCAG 4.1.2: a button whose content is only an icon exposes no name unless
  // it has aria-label/title or a label prop. The editor was audited in the
  // a11y slices; this covers every other surface in app/ so a new icon button
  // cannot ship nameless.
  const sites = scanButtons()

  it('the scan reaches the whole app', () => {
    assert.ok(sites.length > 200, `expected the app's button set, found ${sites.length}`)
    assert.ok(sites.some(s => s.iconOnly), 'the scan must distinguish icon-only buttons')
  })

  it('every icon-only button has a name', () => {
    const unnamed = sites
      .filter(s => s.iconOnly && !s.named)
      .map(s => `${s.file}:${s.line}`)
    assert.deepEqual(unnamed, [], `icon-only buttons without aria-label/title/label:\n${unnamed.join('\n')}`)
  })

  it('stateful icon toggles expose their state', () => {
    // Star and folder-colour controls change appearance only; aria-pressed is
    // what tells assistive tech which option is active.
    for (const file of ['app/components/inbox/InboxList.vue', 'app/components/tmcut/TmcutMediaPanel.vue']) {
      const src = readFileSync(join(ROOT, file), 'utf8')
      assert.match(src, /:aria-pressed=/, `${file} toggles must report aria-pressed`)
    }
  })

  it('icon-only TmcutButton call sites are named', () => {
    const unnamed: string[] = []
    let iconOnly = 0
    for (const path of vueFiles(join(ROOT, 'app'))) {
      if (WRAPPERS.has(relative(ROOT, path).replace(/\\/g, '/'))) continue
      const src = readFileSync(path, 'utf8')
      const re = /<TmcutButton\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/>|>([\s\S]*?)<\/TmcutButton>)/g
      for (const match of src.matchAll(re)) {
        const attrs = match[1] ?? ''
        const inner = (match[3] ?? '').replace(/<!--[\s\S]*?-->/g, '').trim()
        if (!/\bicon=/.test(attrs) || /[A-Za-z0-9]/.test(inner)) continue
        iconOnly++
        if (!/aria-label=|:aria-label=|title=|:title=/.test(attrs)) {
          unnamed.push(`${relative(ROOT, path).replace(/\\/g, '/')}:${src.slice(0, match.index).split('\n').length}`)
        }
      }
    }
    assert.ok(iconOnly > 0, 'the wrapper must still be used for icon-only call sites')
    assert.deepEqual(unnamed, [], `icon-only TmcutButton sites without a name:\n${unnamed.join('\n')}`)
  })
})
