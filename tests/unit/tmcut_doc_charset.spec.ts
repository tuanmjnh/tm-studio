/**
 * Vietnamese prose is written in the Latin alphabet; a CJK codepoint in a
 * sentence here is never a translation choice, it is a token that leaked out of
 * generation.
 *
 * Three of them were committed in this document set before anything noticed:
 * `下游` for "downstream", `缺口` for "gap", `闪光` for "flash" — each sitting
 * mid-sentence in otherwise fluent Vietnamese, in a section the doc guards
 * inspect every run. They survived because the guards count characters per line,
 * table shapes and links; none of them reads *which* alphabet a line uses, so a
 * foreign script is invisible to the whole gate. The fix has to be the gate.
 *
 * Scope is the corpus this project authors prose in: `docs/**` markdown, the
 * tmcut core sources, the preview composables, the unit specs and helpers, and
 * both i18n locales. Measured the day this guard was written: 0 hits outside the
 * one line that quoted the leaked characters, which is why the same change that
 * added this guard removed that quote.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Han, Hiragana, Katakana, Hangul and the CJK punctuation/quote blocks. Vietnamese needs
 * none of them — its diacritics live in Latin Extended, which is deliberately not here.
 */
const CJK = /[\u2e80-\u2eff\u3000-\u303f\u3040-\u30ff\u31f0-\u31ff\u3200-\u32ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/

/** Extensions that hold prose a model writes; binaries and lockfiles are not text. */
const TEXT_SUFFIXES = ['.md', '.ts', '.mts', '.mjs', '.json']

/** This spec quotes the leaked ranges, so it is the one file the scan may not read. */
const SELF = 'tests/unit/tmcut_doc_charset.spec.ts'

function textFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      textFiles(rel, out)
    } else if (TEXT_SUFFIXES.some(suffix => entry.name.endsWith(suffix)) && rel !== SELF) {
      out.push(rel)
    }
  }
  return out
}

const SCOPES = ['docs', 'packages/core', 'app/composables', 'app/utils/tmcut', 'tests/unit', 'i18n/locales']
const files = SCOPES.flatMap(scope => textFiles(scope))

function foreignLines(file: string): string[] {
  const src = readFileSync(join(ROOT, file), 'utf8')
  return src
    .split('\n')
    .map((text, i) => ({ text, at: `${file}:${i + 1}` }))
    .filter(line => CJK.test(line.text))
    .map(line => `${line.at} ${line.text.trim().slice(0, 80)}`)
}

const scanned = files.map(foreignLines)
const found = scanned.flat()

describe('doc charset — no foreign script in Vietnamese prose', () => {
  it('the scan covers a real corpus', () => {
    const markdown = files.filter(file => file.endsWith('.md'))
    assert.ok(files.length >= 200, `only ${files.length} text files scanned — the scope list rotted`)
    assert.ok(markdown.length >= 10, `only ${markdown.length} markdown files under docs/`)
    assert.ok(
      files.some(file => file.startsWith('docs/audit/zero-ffmpeg-audit.md')),
      'the audit document is not in scope, so the guard cannot see the section it was written for'
    )
  })

  it('a sentence in this project is Latin script, full stop', () => {
    assert.deepEqual(
      found,
      [],
      `${found.length} line(s) carry a CJK/Hangul codepoint — write the Vietnamese word, do not escape it`
    )
  })

  it('the three leaked words stay out of the corpus, and are named so', () => {
    // The regressions this guard was written for, spelled the way a reader must
    // see them: quoting the leaked glyphs in a doc is still putting them in the doc.
    for (const phrase of ['downstream', 'khoảng trống', 'chớp sáng']) {
      assert.ok(
        readFileSync(join(ROOT, 'docs/audit/zero-ffmpeg-audit.md'), 'utf8').includes(phrase),
        `"${phrase}" is gone — the correction was reverted, or the three leaks are back`
      )
    }
  })
})
