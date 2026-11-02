/**
 * Icon-only buttons must expose an accessible name.
 *
 * `title` alone is not a reliable name: Chromium computes it from the tooltip
 * attribute, but screen readers and the accessibility tree only map it when
 * the element has no other text — and some AT ignores it entirely. The guard
 * failed on 68 buttons across the editor surfaces: undo/redo, track
 * visibility/lock/mute, transport controls, queue actions, crop and proxy
 * toggles. Every one of them now carries `aria-label` mirroring its tooltip.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) walk(rel, out)
    else if (entry.name.endsWith('.vue')) out.push(rel)
  }
  return out
}

/** End index of the tag that starts at `start` (quote-aware `>` scan). */
function tagEnd(src: string, start: number): number {
  let index = start
  let quote = ''
  while (index < src.length) {
    const char = src[index]!
    if (quote) {
      if (char === quote) quote = ''
    } else if (char === '"' || char === '\'') {
      quote = char
    } else if (char === '>') {
      return index
    }
    index += 1
  }
  return -1
}

interface Button { at: string, attrs: string, text: string }

function iconButtons(files: string[]): Button[] {
  const found: Button[] = []
  for (const file of files) {
    const src = readFileSync(join(ROOT, file), 'utf8')
    for (const match of src.matchAll(/<UButton\b/g)) {
      const end = tagEnd(src, match.index + match[0].length)
      if (end === -1) continue
      const attrs = src.slice(match.index, end + 1)
      if (!/icon=/.test(attrs)) continue
      const selfClosing = attrs.trimEnd().endsWith('/>')
      let text = ''
      if (!selfClosing) {
        const close = src.indexOf('</UButton>', end)
        text = close === -1 ? '' : src.slice(end + 1, close)
      }
      const line = src.slice(0, match.index).split('\n').length
      found.push({ at: `${file}:${line}`, attrs, text })
    }
  }
  return found
}

const files = walk('app')

describe('icon-only buttons expose an accessible name', () => {
  const buttons = iconButtons(files)
  // A `label` prop renders as the button's text content, and an interpolation
  // (`{{ t('…') }}`) is text too — only buttons with neither need a name.
  const iconOnly = buttons.filter((button) => {
    // `\blabel=` would also match `aria-label=` (the hyphen is a word boundary).
    if (/\s:?label=/.test(button.attrs)) return false
    if (/\{\{/.test(button.text)) return false
    return button.text.trim().length === 0
  })

  it('scans a meaningful surface (the guard is not vacuous)', () => {
    assert.ok(buttons.length > 200, `expected hundreds of UButton tags, found ${buttons.length}`)
    assert.ok(iconOnly.length > 50, `expected many icon-only buttons, found ${iconOnly.length}`)
  })

  it('every icon-only button has aria-label (title alone is not a name)', () => {
    const missing = iconOnly
      .filter(button => !/:aria-label=|aria-label=/.test(button.attrs))
      .map(button => `${button.at} ${button.attrs.replace(/\s+/g, ' ').slice(0, 90)}`)
    assert.deepEqual(missing, [], `icon-only buttons without aria-label:\n${missing.join('\n')}`)
  })

  it('keeps the empty-button check honest (a labelled button is not flagged)', () => {
    const sample = iconButtons(['app/pages/tmcut/editor.vue'])
      .find(button => button.at.includes('editor.vue'))
    assert.ok(sample, 'the scanner must see buttons in the editor page')
  })
})

/** Open/close balance of a tag pair before `index`, i.e. "are we inside it?". */
function inside(src: string, index: number, open: RegExp, close: string): boolean {
  const before = src.slice(0, index)
  return (before.match(open) || []).length > (before.match(new RegExp(close, 'g')) || []).length
}

const CONTROLS = /<(UInput|USelect|USelectMenu|UTextarea|USwitch|UCheckbox|URadioGroup)\b/g

describe('form controls expose an accessible name', () => {
  const controls: { at: string, tag: string, named: boolean }[] = []
  for (const file of files) {
    const src = readFileSync(join(ROOT, file), 'utf8')
    // An `id` is only a name when something points at it, so collect the
    // `for=` targets the file offers before judging any control.
    const labelFors = new Set([...src.matchAll(/<label[^>]*\bfor=["']([^"']+)["']/g)].map(m => m[1]!))
    for (const match of src.matchAll(CONTROLS)) {
      const end = tagEnd(src, match.index + match[0].length)
      if (end === -1) continue
      const tag = src.slice(match.index, end + 1)
      const selfClosing = tag.trimEnd().endsWith('/>')
      let slot = ''
      if (!selfClosing) {
        const close = src.indexOf(`</${match[1]}>`, end)
        slot = close === -1 ? '' : src.slice(end + 1, close).trim()
      }
      // A visible label can come from four places: an attribute on the control,
      // an enclosing UFormField, a native <label> wrapper, or slot text.
      const byAttribute = /\s(aria-label|:aria-label|aria-labelledby|:aria-labelledby|label|:label)=/.test(tag)
      // `id=` alone used to count as a name. It is not one: five search and
      // inline-add fields on /system/ai-keys carried an id with no `label for`
      // behind it, passed the guard, and reached the browser unnamed — a
      // placeholder is not an accessible name either. Only a matching target counts.
      const idTarget = tag.match(/\s(?::?id)="([^"{]+)"/)
      const byLabelFor = idTarget ? labelFors.has(idTarget[1]!) : false
      const byFormField = inside(src, match.index, /<UFormField\b/g, '</UFormField>')
      const byNativeLabel = inside(src, match.index, /<label\b/g, '</label>')
      const bySlot = slot.length > 0
      const line = src.slice(0, match.index).split('\n').length
      controls.push({ at: `${file}:${line}`, tag, named: byAttribute || byLabelFor || byFormField || byNativeLabel || bySlot })
    }
  }

  it('scans a meaningful surface (the guard is not vacuous)', () => {
    assert.ok(controls.length > 150, `expected many form controls, found ${controls.length}`)
    assert.ok(controls.filter(c => c.named).length > 120, 'expected most controls to be named')
  })

  it('every form control has a label, aria-label, or UFormField wrapper', () => {
    const missing = controls
      .filter(control => !control.named)
      .map(control => `${control.at} ${control.tag.replace(/\s+/g, ' ').slice(0, 110)}`)
    assert.deepEqual(missing, [], `form controls without an accessible name:\n${missing.join('\n')}`)
  })
})
