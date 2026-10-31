import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const readJson = (rel: string) => JSON.parse(readFileSync(join(root, rel), 'utf8'))
const locales = { en: readJson('i18n/locales/en.json'), vi: readJson('i18n/locales/vi.json') }

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) walk(rel, out)
    else if (/\.(vue|ts)$/.test(entry.name)) out.push(rel)
  }
  return out
}

const tmcutFiles = [...walk('app/pages/tmcut'), ...walk('app/components/tmcut')]
// `t('ns.key' + dynamic)` and `t('ns.prefix.' + key, fallback)` are composed at
// call time, so a literal ending with '.' carries no single key to check.
const keyRe = /(?:^|[^\w$.])\$?t\(\s*'([a-zA-Z][\w.]*)'/g

function usedKeys(): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const file of tmcutFiles) {
    const source = readFileSync(join(root, file), 'utf8')
    for (const match of source.matchAll(keyRe)) {
      const key = match[1]!
      if (key.endsWith('.')) continue
      const sites = map.get(key) || []
      if (!sites.includes(file)) sites.push(file)
      map.set(key, sites)
    }
  }
  return map
}

function lookup(bundle: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) =>
    node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined, bundle)
}

const used = usedKeys()

describe('tmcut localization keys', () => {
  it('scans a meaningful surface of tmcut sources', () => {
    assert.ok(tmcutFiles.length >= 40, `expected dozens of tmcut files, found ${tmcutFiles.length}`)
    assert.ok(used.size >= 400, `expected hundreds of literal keys, found ${used.size}`)
  })

  for (const [locale, bundle] of Object.entries(locales)) {
    it(`every key used by tmcut exists in ${locale}.json`, () => {
      const missing = [...used].filter(([key]) => lookup(bundle, key) === undefined)
        .map(([key, sites]) => `${key} <- ${sites.join(', ')}`)
      assert.deepEqual(missing, [], `missing ${locale} keys:\n${missing.join('\n')}`)
    })
  }

  it('keeps the en and vi bundles in lockstep', () => {
    const flatten = (node: Record<string, unknown>, prefix = ''): string[] =>
      Object.entries(node).flatMap(([key, value]) => {
        const path = prefix ? `${prefix}.${key}` : key
        return value && typeof value === 'object' ? flatten(value as Record<string, unknown>, path) : [path]
      })
    const en = new Set(flatten(locales.en))
    const vi = new Set(flatten(locales.vi))
    assert.deepEqual([...en].filter(key => !vi.has(key)), [], 'keys present in en but missing from vi')
    assert.deepEqual([...vi].filter(key => !en.has(key)), [], 'keys present in vi but missing from en')
  })
})
