/**
 * GFM splits a table row on every unescaped `|` — including one sitting inside
 * a code span, which the renderer cannot protect. Two rows of the Phase-0 audit
 * shipped that way (`clip.fit || 'fit'` and a `ls … | grep` snippet), so the
 * rendered table showed three columns where the prose meant two, and the
 * overflow text silently spilled into a fourth. Nothing in the suite noticed:
 * the line-length guard counts lines, and the link guard only reads targets.
 *
 * This guard compares every row of a table block to that block's header, so a
 * stray pipe fails with the file and line instead of mangling the document.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function markdownFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) markdownFiles(rel, out)
    else if (entry.name.endsWith('.md')) out.push(rel)
  }
  return out
}

/** `\|` is the documented escape; every other `|` is a separator. */
function cells(line: string): number {
  return line.replace(/\\\|/g, '').split('|').length - 2
}

const isRow = (line: string) => /^\s*\|/.test(line)
const isSeparator = (line: string) => /^\s*\|[\s:|-]+\|\s*$/.test(line)

interface Block {
  file: string
  headerAt: number
  width: number
  rows: number
}

const blocks: Block[] = []
const mismatched: string[] = []

for (const file of markdownFiles('docs')) {
  const src = readFileSync(join(ROOT, file), 'utf8')
  let fenced = false
  let current: Block | null = null
  src.split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      current = null
      return
    }
    if (fenced || !isRow(line)) {
      current = null
      return
    }
    if (!current) {
      current = { file, headerAt: i + 1, width: cells(line), rows: 0 }
      blocks.push(current)
    } else if (!isSeparator(line) && cells(line) !== current.width) {
      mismatched.push(`${file}:${i + 1} has ${cells(line)} cells, header :${current.headerAt} has ${current.width}`)
    }
    current.rows++
  })
}

describe('doc table shape', () => {
  it('the corpus is real, not an empty scan', () => {
    assert.ok(blocks.length >= 15, `only ${blocks.length} markdown tables found under docs/`)
    assert.ok(blocks.some(b => b.rows >= 20), 'no table has 20+ rows, so a width comparison is meaningless here')
  })

  it('every row matches its header', () => {
    assert.deepEqual(mismatched, [], 'a `|` inside a cell splits it — escape it as `\\|` or restate the snippet without a pipe')
  })

  it('the escape is honoured, and the corpus uses it', () => {
    assert.equal(cells('| a \\| b | c |'), 2, '`\\|` was counted as a separator, so escaping cannot save a row')
    const escaped = blocks.filter(b => readFileSync(join(ROOT, b.file), 'utf8').includes('\\|'))
    assert.ok(escaped.length > 0, 'no document uses `\\|`, so this guard has never been exercised on a real cell')
  })
})
