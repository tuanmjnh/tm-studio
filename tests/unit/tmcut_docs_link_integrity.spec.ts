/**
 * Every `file:///…` link in `docs/` must point at a file that is really there.
 *
 * Docs are the hand-off surface for this repo: an ADR row that cites
 * `electron/tools/html-video-renderer.cjs:135` reads as a live pointer, and a
 * reader who follows it after that file is retired (ADR-023 deleted it) loses
 * the argument, not just the link. Measured when this guard was written: 21 of
 * 364 doc links resolved to nothing — all citations of the deleted desktop
 * HTML-video engine, left behind by a slice that fixed the code but not the
 * prose describing it. A `#L123` anchor on a file that still exists but has 90
 * lines is the same failure in a quieter form, so anchors are checked against
 * the target's real line count (162 of the 349 links today carry one).
 *
 * A machine-local artifact (a git-ignored binary such as `resources/ffmpeg.exe`)
 * is named as code, never linked: a link promises the reader the file is in the
 * checkout.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ROOT_URL = `${ROOT.split(sep).join('/')}/`
const LINK = /\]\(file:\/\/\/([^)#\s]+)(#L(\d+))?\)/g

/**
 * Docs cite two sibling projects by absolute path — the hub that signs the
 * studio in, and the read-only repo this code was lifted from. Those links are
 * deliberate, so they are declared here instead of required to resolve: a guard
 * that needs a second checkout to exist fails on every machine without it.
 */
const DECLARED_SIBLINGS = ['D:/Applications/tm-hub/', 'D:/Applications/tm-tools/']

function markdownFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) markdownFiles(rel, out)
    else if (entry.name.endsWith('.md')) out.push(rel)
  }
  return out
}

interface DocLink {
  at: string
  /** repo-relative when in this repo, absolute URL-path when not */
  target: string
  local: boolean
  line: number | null
}

function collect(file: string, src: string): DocLink[] {
  const found: DocLink[] = []
  for (const match of src.matchAll(LINK)) {
    const absolute = decodeURIComponent(match[1]!).replace(/\/+$/, '')
    const local = absolute.startsWith(ROOT_URL)
    found.push({
      at: `${file}:${src.slice(0, match.index).split('\n').length}`,
      target: local ? absolute.slice(ROOT_URL.length) : absolute,
      local,
      line: match[3] ? Number(match[3]) : null
    })
  }
  return found
}

const files = markdownFiles('docs')
const links = files.flatMap(file => collect(file, readFileSync(join(ROOT, file), 'utf8')))
const localLinks = links.filter(link => link.local)

function existsAsFile(path: string): boolean {
  try {
    return statSync(join(ROOT, path)).isFile()
  } catch {
    return false
  }
}

describe('docs links point at files that exist', () => {
  it('scans a meaningful surface (the guard is not vacuous)', () => {
    assert.ok(files.length >= 6, `expected the docs tree, found ${files.length} files`)
    assert.ok(links.length > 250, `expected hundreds of doc links, found ${links.length}`)
    assert.ok(localLinks.length > 200, `expected most links to be local, found ${localLinks.length}`)
  })

  it('every link stays in this repo or a sibling declared above', () => {
    const undeclared = links
      .filter(link => !link.local && !DECLARED_SIBLINGS.some(sibling => link.target.startsWith(sibling)))
      .map(link => `${link.at} -> ${link.target}`)
    assert.deepEqual(undeclared, [], `links to a root nobody declared:\n${undeclared.join('\n')}`)
  })

  it('every local link target exists as a file, not a directory', () => {
    const dead = localLinks
      .filter(link => !existsAsFile(link.target))
      .map(link => `${link.at} -> ${link.target}`)
    assert.deepEqual(dead, [], `doc links with no file behind them:\n${dead.join('\n')}`)
  })

  it('every #L anchor is a real line of its target', () => {
    const lineCounts = new Map<string, number>()
    const off = localLinks
      .filter((link) => {
        if (link.line === null || !existsAsFile(link.target)) return false
        if (!lineCounts.has(link.target)) {
          lineCounts.set(link.target, readFileSync(join(ROOT, link.target), 'utf8').split('\n').length)
        }
        return link.line > lineCounts.get(link.target)!
      })
      .map(link => `${link.at} -> ${link.target}#L${link.line} (file has ${lineCounts.get(link.target)} lines)`)
    assert.deepEqual(off, [], `doc links pointing past the end of their file:\n${off.join('\n')}`)
  })
})
