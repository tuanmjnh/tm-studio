/**
 * The mint AI accent must stay legible on the surface it is painted on.
 *
 * `--color-studio-mint` (#2DD4A8) is the AI brand tint and only works on the
 * dark studio chrome: 9.98:1 on --color-studio-panel and 10.35:1 on
 * --color-studio-canvas. On white it is 1.89:1, yet the model picker also
 * renders inside light-mode modals and on /tmcut/process, where it uses the
 * tint for a 10px status line and the sparkles icon.
 *
 * `--studio-mint-accent` therefore resolves to a darker mint in light mode and
 * back to the brand tint under `.dark`. Templates reference that variable;
 * a raw `text-studio-mint` skips the override and fails here.
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

const css = readFileSync(join(ROOT, 'app/assets/css/main.css'), 'utf8')

function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)
  assert.ok(match, `missing ${selector} block in app/assets/css/main.css`)
  return match![1]!
}

function token(source: string, name: string): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(source)
  assert.ok(match, `missing --${name} in app/assets/css/main.css`)
  return match![1]!.trim()
}

/** Follow one level of `var(--x)` so the accent can reuse the brand tint. */
function resolve(value: string): string {
  const ref = /^var\(--([a-z-]+)\)$/.exec(value)
  return ref ? token(css, ref[1]!) : value
}

function rgb(hex: string): number[] {
  assert.match(hex, /^#[0-9a-f]{6}$/i, `expected a 6-digit hex colour, got "${hex}"`)
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const lightAccent = resolve(token(block(':root'), 'studio-mint-accent'))
const darkAccent = resolve(token(block('.dark'), 'studio-mint-accent'))
const brandTint = token(css, 'color-studio-mint')

describe('mint AI accent', () => {
  it('light mode accent carries text and icons on the lightest surfaces', () => {
    const onWhite = contrast(lightAccent, '#FFFFFF')
    const onMuted = contrast(lightAccent, '#FAFAFA')
    assert.ok(onWhite >= 4.5, `accent ${lightAccent} is ${onWhite.toFixed(2)}:1 on white, need 4.5:1`)
    assert.ok(onMuted >= 4.5, `accent ${lightAccent} is ${onMuted.toFixed(2)}:1 on bg-muted, need 4.5:1`)
  })

  it('dark mode accent carries text and icons on the studio chrome', () => {
    for (const surface of ['#0B0B14', '#111019', '#181624']) {
      const ratio = contrast(darkAccent, surface)
      assert.ok(ratio >= 4.5, `accent ${darkAccent} is ${ratio.toFixed(2)}:1 on ${surface}, need 4.5:1`)
    }
  })

  it('the brand tint stays documented as unusable on white', () => {
    assert.equal(darkAccent.toLowerCase(), brandTint.toLowerCase(), 'dark mode should use the brand tint')
    assert.ok(
      contrast(brandTint, '#FFFFFF') < 3,
      `${brandTint} unexpectedly clears 3:1 on white — revisit the light-mode override`
    )
  })

  it('templates reference the theme-aware accent, never the raw tint', () => {
    const files = walk('app')
    const raw = /(?:text|bg|border|ring|fill|stroke|from|to|via)-studio-mint(?!-accent)\b/g
    const usages: string[] = []
    const offenders: string[] = []
    for (const file of files) {
      const source = readFileSync(join(ROOT, file), 'utf8')
      for (const match of source.matchAll(raw)) {
        const line = source.slice(0, match.index).split('\n').length
        offenders.push(`${file}:${line} ${match[0]}`)
      }
      for (const match of source.matchAll(/(?:text|bg)-\(--studio-mint-accent\)/g)) {
        const line = source.slice(0, match.index).split('\n').length
        usages.push(`${file}:${line} ${match[0]}`)
      }
    }
    assert.ok(files.length > 100, `expected many components, found ${files.length}`)
    assert.ok(usages.length > 0, 'expected at least one theme-aware accent usage')
    assert.deepEqual(offenders, [], `raw mint token bypasses the light-mode override:\n${offenders.join('\n')}`)
  })
})
