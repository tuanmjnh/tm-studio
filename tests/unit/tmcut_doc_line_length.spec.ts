/**
 * A doc line is the unit a reviewer reads and a diff reports.
 *
 * The Phase-1 status block in the V4 roadmap grew by accretion: each slice
 * appended a sentence to the *same* blockquote line, until one line held
 * 19,037 characters. Two things broke before anyone noticed. A diff of that
 * line is `-1/+1` no matter how much prose moved, so a reviewer cannot see what
 * a slice claimed; and the line had no structure left to cite — "the sentence
 * about ADR-022" was somewhere inside a 19k blob. Splitting it into one bullet
 * per step (this slice's other half) is only durable if a new runaway cannot be
 * appended again, which is what the ceiling below enforces.
 *
 * Table rows are exempt for a mechanical reason, not a convenient one: GFM has
 * no way to break a cell, so the audit's ADR rows are single lines of up to
 * 5,898 characters by construction. The exemption is tested rather than
 * asserted — if tables never breached the ceiling, exempting them would be
 * hiding something.
 *
 * Measured across `docs/**` the day this guard was written: 10 markdown files,
 * 2,070 prose lines outside tables and fences, the longest of them 1,356
 * characters (`extraction-plan.md:772`) — and 451 table rows, 21 of which are
 * longer than that ceiling.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Frozen ceiling — the measured maximum, not a round number. It may only go
 * down: wrapping an existing long line means lowering this constant in the same
 * change, so the corpus cannot drift back upward one slice at a time.
 */
const CEILING = 1356

interface Line {
  at: string
  length: number
  text: string
  table: boolean
  code: boolean
}

function markdownFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) markdownFiles(rel, out)
    else if (entry.name.endsWith('.md')) out.push(rel)
  }
  return out
}

/** Fenced code is verbatim source (commands, logs) and is not prose to wrap. */
function linesOf(file: string): Line[] {
  const src = readFileSync(join(ROOT, file), 'utf8')
  let fenced = false
  return src.split('\n').map((text, i) => {
    const fence = /^\s*```/.test(text)
    if (fence) fenced = !fenced
    const code = fence || fenced
    const table = !code && /^\s*\|/.test(text)
    return { at: `${file}:${i + 1}`, length: text.length, text, table, code }
  })
}

const files = markdownFiles('docs')
const lines = files.flatMap(linesOf)
const prose = lines.filter(line => !line.table && !line.code && line.length > 0)
const over = prose.filter(line => line.length > CEILING)

describe('doc line length', () => {
  it('the corpus is real, not an empty scan', () => {
    assert.ok(files.length >= 8, `only ${files.length} markdown files under docs/`)
    assert.ok(prose.length >= 1500, `only ${prose.length} prose lines measured`)
    const longest = prose.reduce((a, b) => (b.length > a.length ? b : a))
    assert.ok(longest.length >= 800, `longest prose line is ${longest.length}: the ceiling binds nothing here`)
  })

  it('no prose line outruns the reviewer', () => {
    assert.deepEqual(
      over.map(line => `${line.at} ${line.length}`),
      [],
      `lines above ${CEILING} characters — wrap them into bullets, do not raise the ceiling`
    )
  })

  it('the table exemption is load-bearing, not a loophole', () => {
    const tablesOver = lines.filter(line => line.table && line.length > CEILING)
    assert.ok(tablesOver.length > 0, 'no table row exceeds the ceiling, so exempting tables proves nothing')
    assert.ok(
      tablesOver.every(line => line.at.startsWith('docs/v4-phase-0-audit.md')),
      `only the ADR/gap tables are long; found ${[...new Set(tablesOver.map(l => l.at.split(':')[0]))].join(', ')}`
    )
  })

  it('the Phase-1 status marker stays a marker, with the log under it', () => {
    // The exact shape that rotted: one blockquote line holding the marker *and*
    // every step ever appended to it.
    const roadmap = 'docs/tmcut-v4-universal-rendering-multiplatform-roadmap.md'
    const src = readFileSync(join(ROOT, roadmap), 'utf8').split('\n')
    const marker = src.findIndex(text => /^> \*\*Trạng thái: IN PROGRESS\.\*\*/.test(text))
    assert.ok(marker > -1, 'the Phase-1 status marker is gone or no longer leads its line')
    assert.equal(src[marker], '> **Trạng thái: IN PROGRESS.**', `${roadmap}:${marker + 1} writes prose after the status marker`)
    const after = src.slice(marker + 1, marker + 12).filter(text => text.trim() !== '').slice(0, 3)
    assert.ok(after.every(text => !/^> /.test(text)), 'no second blockquote may be hung under the status marker')
    assert.ok(after.some(text => /^- /.test(text)), 'the step log must be a bullet list, not a paragraph')
  })
})
