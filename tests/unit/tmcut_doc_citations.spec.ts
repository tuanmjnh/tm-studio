/**
 * A `section` citation in source code names a section of a design document, and
 * every one of those documents lives outside this repo — the v1 planning set
 * archived in `tm-tools`, and the hub's own `ARCHITECTURE.md`. The docs-link
 * guard (`tmcut_docs_link_integrity.spec.ts`) cannot see any of them: it walks
 * `file:///…` links in `docs/`, and a `§N` in a comment is not a link. So a
 * citation can rot in silence: the document is retired, renamed, or renumbered
 * and every comment pointing into it starts telling a story nobody can check.
 *
 * That is what this guard fixes. Each label family is declared exactly once
 * below, with the one document it means, and every citation must land on a
 * numbered heading of that document. Measured when this file was written: 172
 * citations across 543 scanned source files, in seven families
 * (`docs`, `roadmap v1`, `roadmap v3`, `CapCut`, `ARCHITECTURE`,
 * `factory roadmap`, `connections roadmap`) plus a residue of two bare
 * `roadmap §N` that name no document at all.
 *
 * The bare shape is why the family list had to be written down. Before this
 * file, 34 citations said only `roadmap §N`, and the same two words covered
 * different documents: `§5` is the FX registry in `…storage-fx-preview-ffmpeg
 * -upgrade-roadmap-v1.md`, template versioning in `…video-factory-roadmap-v1.md`
 * and the Asset Center in the v3 roadmap. Thirty-two were resolved by evidence
 * that needs no interpretation — the section number exists in exactly one
 * registered document (`§65.2`, `§190`), the comment quotes the section's own
 * words (`roadmap §5: "only a small"` against v3 §5 "only a small starter
 * set"), or the comment already named the document in prose
 * (`roadmap §2 (provider-connections-upgrade-roadmap)`). The remaining two
 * (`TmcutAssetCenter.vue` `§14`) stay bare on purpose: no registered §14 is
 * about filesystem isolation or unvalidated edits, and guessing would put
 * invented provenance into the source. They are frozen as a ceiling instead
 * (test 4): a new bare citation fails, and resolving one lowers the number.
 *
 * The sibling checkouts are machine-local, so section resolution skips itself
 * when a root is absent — the declaration tests never do, and neither does
 * the ceiling count in test 4. Only the two *resolution* checks skip, because
 * "not on this machine" is a different finding from "not a heading of it".
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SELF = `tests${sep}unit${sep}tmcut_doc_citations.spec.ts`
const SOURCE_DIRS = ['app', 'server', 'shared', 'packages', 'electron', 'tests']
const SOURCE_EXT = new Set(['.ts', '.mts', '.mjs', '.js', '.cjs', '.vue'])
const SKIP_DIRS = new Set(['node_modules', 'dist', '.nuxt', '.output', 'coverage', 'release'])

/**
 * The two roots the citations reach into. Declared, not required: a machine
 * without these checkouts resolves nothing, and the guard says so out loud
 * rather than pretending the citations are fine.
 */
const ARCHIVE = 'D:/Applications/tm-tools/docs/archive/2026-10-31-v1-pre-tmcut-extraction'
const HUB_DOCS = 'D:/Applications/tm-hub/docs'
/** `join` on win32 rewrites separators, so comparisons use this. */
const slashes = (p: string) => p.split(sep).join('/')

/** The character these citations use; kept out of the literals below. */
const SECTION = '§'

/**
 * One family of labels, one document. `BARE` is the ambiguous shape — it names
 * no document, only a section number.
 *
 * The two `*-roadmap-v1` files at the bottom are the reason a label has to name
 * its document rather than its version: `…video-factory-roadmap-v1.md` and
 * `…storage-fx-preview-ffmpeg-upgrade-roadmap-v1.md` share the suffix and share
 * section numbers, and §5 of one is the FX registry while §5 of the other is
 * template versioning.
 */
const DOCUMENTS = [
  { family: 'docs', file: join(ARCHIVE, 'TMCut Architecture v3.md') },
  { family: 'roadmap v1', file: join(ARCHIVE, 'tmcut-web-electron-storage-fx-preview-ffmpeg-upgrade-roadmap-v1.md') },
  { family: 'roadmap v3', file: join(ARCHIVE, 'tmcut-v3-ai-asset-template-autocut-roadmap-v2.md') },
  { family: 'capcut', file: join(ARCHIVE, 'capcut_editor_ui_components_reference.md') },
  { family: 'architecture', file: join(HUB_DOCS, 'ARCHITECTURE.md') },
  { family: 'factory roadmap', file: join(ARCHIVE, 'tmcut-ai-editor-template-studio-video-factory-roadmap-v1.md') },
  { family: 'connections roadmap', file: join(HUB_DOCS, 'tm-hub-provider-connections-upgrade-roadmap-v1.md') }
] as const
const BARE = 'bare roadmap'
/** Measured on the day this guard was written. May only go down. */
const BARE_CEILING = 2

function sources(dir: string, out: string[] = []): string[] {
  const abs = join(ROOT, dir)
  if (!existsSync(abs)) return out
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) sources(rel, out)
    } else if (SOURCE_EXT.has(extname(entry.name)) && rel !== SELF) {
      out.push(rel)
    }
  }
  return out
}

const files = SOURCE_DIRS.flatMap(dir => sources(dir))
// The words a citation label is allowed to carry. Anything naming another kind
// of document (a spec, a guide, an audit) is a family nobody declared.
const DOC_NOUN = /(roadmap|docs|architecture|capcut|spec|guide|audit|chapter)/i
const CITATION = new RegExp(`\\b([a-z][a-z0-9 _-]{0,24}?)\\s*${SECTION}\\s*([0-9]+(?:\\.[0-9]+)?)`, 'gi')

interface Citation {
  at: string
  label: string
  section: string
  family: string
}

/**
 * The longest declared family inside the label wins, so `roadmap v3 phase 8`
 * is `roadmap v3` and `list mirrors roadmap` is the bare shape.
 */
function familyOf(label: string): string {
  const text = label.toLowerCase().replace(/\s+/g, ' ')
  for (const specific of ['roadmap v3', 'roadmap v1', 'factory roadmap', 'connections roadmap', 'architecture', 'capcut', 'docs']) {
    if (new RegExp(`(^|\\s)${specific}(\\s|$)`).test(text)) return specific
  }
  if (/(^|\s)(tmcut )?roadmap(\s|$)/.test(text)) return BARE
  return `undeclared(${text})`
}

const citations: Citation[] = []
for (const file of files) {
  readFileSync(join(ROOT, file), 'utf8').split(/\r?\n/).forEach((line, i) => {
    CITATION.lastIndex = 0
    let match
    while ((match = CITATION.exec(line))) {
      const label = match[1]!
      if (!DOC_NOUN.test(label)) continue
      citations.push({
        at: `${file.replace(/\\/g, ':')}:${i + 1}`,
        label,
        section: match[2]!,
        family: familyOf(label)
      })
    }
  })
}

const headingSets = new Map<string, Set<string> | null>()
function headingsOf(file: string): Set<string> | null {
  if (headingSets.has(file)) return headingSets.get(file)!
  if (!existsSync(file) || !statSync(file).isFile()) {
    headingSets.set(file, null)
    return null
  }
  const set = new Set<string>()
  readFileSync(file, 'utf8').split(/\r?\n/).forEach((line) => {
    // `## 6.4 Applying a template`, `# 190. R126 — …`, `### 5.4. Speed`
    const match = line.match(new RegExp(`^#{1,6}\\s*([0-9]+(?:\\.[0-9]+)?)\\.?\\s+\\S`))
    if (match) set.add(match[1]!)
  })
  headingSets.set(file, set)
  return set
}

const available = DOCUMENTS.filter(doc => headingsOf(doc.file) !== null)
const missing = DOCUMENTS.filter(doc => headingsOf(doc.file) === null)
const families = [...new Set(citations.map(c => c.family))]
const bare = citations.filter(c => c.family === BARE)

describe('source citations name a document that exists', () => {
  it('scans a real surface (the guard is not vacuous)', () => {
    assert.ok(files.length > 400, `expected hundreds of source files, found ${files.length}`)
    assert.ok(citations.length >= 150, `expected 150+ citations, found ${citations.length}`)
    assert.ok(families.length >= 7, `expected 7 citation families, found ${families.join(', ')}`)
  })

  it('every label family is one the registry declares', () => {
    const known = new Set([...DOCUMENTS.map(doc => doc.family), BARE])
    const undeclared = citations
      .filter(c => !known.has(c.family))
      .map(c => `${c.at} "${c.label.trim()} ${SECTION}${c.section}" — no document is registered for it`)
    assert.deepEqual(undeclared, [], `citations to an undeclared document:\n${undeclared.join('\n')}`)
  })

  it('every cited section is a real heading of the document its family names', (t) => {
    if (available.length === 0) {
      console.log(`[skip] no cited document is on this machine (${missing.map(d => d.family).join(', ')}); the citations themselves are still counted`)
      return
    }
    const dead: string[] = []
    const declared = new Set(DOCUMENTS.map(doc => doc.family))
    for (const citation of citations) {
      // Bare citations are test 4's, and an undeclared family is test 2's;
      // resolving either here would only add a second, vaguer failure.
      if (!declared.has(citation.family)) continue
      const doc = DOCUMENTS.find(d => d.family === citation.family)!
      const set = headingsOf(doc.file)
      if (set === null) continue
      if (!set.has(citation.section)) {
        dead.push(`${citation.at} ${citation.family} ${SECTION}${citation.section} — ${doc.file} has no such heading`)
      }
    }
    assert.deepEqual(dead, [], `citations pointing at a section that is not there:\n${dead.join('\n')}`)
    if (missing.length) t.diagnostic(`families not resolved this run: ${missing.map(d => d.family).join(', ')}`)
  })

  it('a bare roadmap citation stays inside the frozen ceiling', (t) => {
    // The ceiling is a count, not a resolution: it holds on a machine with no
    // registered document, so it is asserted before the skip below.
    assert.ok(
      bare.length <= BARE_CEILING,
      `${bare.length} bare \`roadmap ${SECTION}N\` citations, ceiling ${BARE_CEILING}. A citation must name its document: pick the family the section really belongs to and say so. Resolving one lowers BARE_CEILING.`
    )
    // "No registered document is on this machine" is not the same finding as
    // "that number is a heading of none of them" — resolving here without the
    // files would report every bare citation as unattributable, exactly as the
    // section-heading test above would. Skip with the same words, and say
    // which families went unresolved.
    if (available.length === 0) {
      console.log(`[skip] no cited document is on this machine (${missing.map(d => d.family).join(', ')}); the bare-citation count ${bare.length} is still checked against its ceiling`)
      return
    }
    const all = DOCUMENTS.map(doc => headingsOf(doc.file)).filter((set): set is Set<string> => set !== null)
    const nowhere = bare
      .filter(c => !all.some(set => set.has(c.section)))
      .map(c => `${c.at} "${c.label.trim()} ${SECTION}${c.section}" — that number is a heading of none of the registered documents`)
    assert.deepEqual(nowhere, [], `unattributable bare citations:\n${nowhere.join('\n')}`)
    if (missing.length) t.diagnostic(`families not resolved this run: ${missing.map(d => d.family).join(', ')}`)
  })

  it('the registry carries no dead entry and reaches only the declared roots', () => {
    // The other direction — a family cited but not registered — is test 2's,
    // with the file and line of each offending citation.
    const cited = new Set(citations.map(c => c.family))
    for (const doc of DOCUMENTS) {
      assert.ok(cited.has(doc.family), `${doc.family} is registered but no longer cited — the registry is carrying dead weight`)
      assert.ok(
        slashes(doc.file).startsWith(slashes(ARCHIVE)) || slashes(doc.file).startsWith(slashes(HUB_DOCS)),
        `${doc.family} points outside the two declared roots`
      )
    }
    assert.equal(new Set(DOCUMENTS.map(doc => doc.family)).size, DOCUMENTS.length, 'two families share a key — the registry would resolve one of them wrongly')
  })
})
