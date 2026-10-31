/**
 * `animate-pulse` is reserved for live, in-flight state.
 *
 * The global reduced-motion rule in `app/assets/css/main.css` collapses every
 * animation to 0.01ms except spinners, so the preference is already honoured.
 * What it cannot decide is intent: a pulsing update badge, a hardware dot or a
 * hero ornament draws the eye forever even though nothing is happening. Nine
 * of those carried the class; the rest are progress bars, a network check and
 * playback indicators that genuinely change while they pulse.
 *
 * Every pulse must therefore be conditional — bound to a state expression or
 * sitting under a `v-if`/`v-else-if` branch — or live inside a `<template
 * v-if>` that guards it. A bare `animate-pulse` in a CSS class string is a
 * decoration and fails here.
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

interface Pulse { at: string, line: string, guarded: boolean }

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

/**
 * A pulse is live when the element it sits on is state-bound, or when an
 * enclosing `<template v-if>` only renders it in that state.
 */
function guardedBy(src: string, index: number): boolean {
  const before = src.slice(0, index)
  const openTemplates = (before.match(/<template\b[^>]*\bv-(?:else-)?if=/g) || []).length
  const closedTemplates = (before.match(/<\/template>/g) || []).length
  if (openTemplates > closedTemplates) return true

  const tagStart = before.lastIndexOf('<')
  if (tagStart === -1) return false
  const end = tagEnd(src, tagStart + 1)
  if (end === -1) return false
  const tag = src.slice(tagStart, end + 1)
  return /\bv-(?:else-)?if=/.test(tag) || /\?[^:]*animate-pulse/.test(tag)
}

function pulses(files: string[]): Pulse[] {
  const found: Pulse[] = []
  for (const file of files) {
    const src = readFileSync(join(ROOT, file), 'utf8')
    for (const match of src.matchAll(/animate-pulse/g)) {
      const lineStart = src.lastIndexOf('\n', match.index) + 1
      const lineEnd = src.indexOf('\n', match.index)
      const line = src.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim()
      const lineNo = src.slice(0, match.index).split('\n').length
      found.push({ at: `${file}:${lineNo}`, line, guarded: guardedBy(src, match.index) })
    }
  }
  return found
}

const files = walk('app')

describe('animate-pulse marks live state only', () => {
  const all = pulses(files)

  it('scans a meaningful surface (the guard is not vacuous)', () => {
    assert.ok(files.length > 100, `expected many components, found ${files.length}`)
    assert.ok(all.length > 0, 'expected at least one live pulse in the app')
  })

  it('every pulse is conditional on a live state', () => {
    const staticOnes = all
      .filter(pulse => !pulse.guarded)
      .map(pulse => `${pulse.at} ${pulse.line.slice(0, 110)}`)
    assert.deepEqual(staticOnes, [], `unconditional animate-pulse:\n${staticOnes.join('\n')}`)
  })

  it('the reduced-motion budget keeps spinners alive', () => {
    const css = readFileSync(join(ROOT, 'app/assets/css/main.css'), 'utf8')
    const block = /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\n}/.exec(css)?.[0] ?? ''
    assert.ok(block.includes('animation-duration: 0.01ms'), 'global motion collapse missing')
    assert.ok(/\.animate-spin\s*\{[\s\S]*?infinite/.test(block), 'spinner exemption missing')
  })
})
