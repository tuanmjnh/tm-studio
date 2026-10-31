/**
 * Every modal must give the dialog an accessible name.
 *
 * Nuxt UI renders a visually hidden `DialogTitle` whenever a `#content` slot is
 * used, but that title is empty unless a `title` (or `#title`) prop is passed.
 * Ten tmcut dialogs drew their own heading inside `#content`, which looks right
 * and reads as nothing: focus lands in a dialog announced without a name.
 *
 * Passing `title` costs nothing visually — `#content` replaces the visible
 * header — so the rule is simply: a `<UModal>` needs `title`, `#title` or an
 * explicit `aria-labelledby`.
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

interface Modal { at: string, tag: string, named: boolean }

function modals(files: string[]): Modal[] {
  const found: Modal[] = []
  for (const file of files) {
    const src = readFileSync(join(ROOT, file), 'utf8')
    for (const match of src.matchAll(/<UModal\b/g)) {
      const end = tagEnd(src, match.index + match[0].length)
      if (end === -1) continue
      const tag = src.slice(match.index, end + 1)
      const line = src.slice(0, match.index).split('\n').length
      const named = /\s:?title=|\s:?aria-label=|\s:?aria-labelledby=/.test(tag)
      found.push({ at: `${file}:${line}`, tag, named })
    }
  }
  return found
}

const files = walk('app')

describe('modals expose an accessible name', () => {
  const all = modals(files)

  it('scans a meaningful surface (the guard is not vacuous)', () => {
    assert.ok(all.length > 20, `expected many UModal tags, found ${all.length}`)
    assert.ok(all.filter(modal => modal.named).length > 15, 'expected most modals to be named')
  })

  it('every UModal has a title or aria label', () => {
    const missing = all
      .filter(modal => !modal.named)
      .map(modal => `${modal.at} ${modal.tag.replace(/\s+/g, ' ').slice(0, 110)}`)
    assert.deepEqual(missing, [], `modals without an accessible name:\n${missing.join('\n')}`)
  })
})
