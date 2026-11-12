/**
 * Server error codes must reach the user as copy, not as a wire code or as raw
 * upstream diagnostics.
 *
 * Three defects this pins, each measured against `getErrorMessage` before it was
 * fixed rather than inferred from reading it:
 *
 *  1. Twelve `statusMessage` values the server throws had no entry in either
 *     locale, so step 2 found no translation. Every one of those throw sites
 *     also attaches a `message`, so step 3's passthrough then returned that raw
 *     text: a TTS failure rendered `HTTP 500 from tts` or
 *     `connectionId is required` to the user instead of actionable copy.
 *  2. A backend that answers with the code itself — `data.message: 'not_found'`,
 *     the shape the sessions endpoint produced — hit the same passthrough and
 *     printed the identifier verbatim.
 *  3. Three codes disagreed with the table's naming (`error.bad_request`,
 *     `error.tts.upstream`, `error.tts.unreachable`), so even after adding keys
 *     the lookup could not match. The codes are now camelCase like the rest.
 *
 * The remaining guard is the point: a `statusMessage` added to the server
 * without a translation is invisible until someone hits that error in
 * production, so the scan makes it a test failure instead.
 */
import '../../tests/unit/helpers/tmcut_store_env'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getErrorMessage } from '../../app/shared/utils/errors'

let passed = 0
class CheckFailed extends Error {}
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
  } catch (error) {
    console.error(`FAILED: ${name}\n  ${(error as Error).message}`)
    throw error
  }
  passed++
  console.log(`[ok] ${name}`)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CheckFailed(message)
}

const EN = JSON.parse(readFileSync('i18n/locales/en.json', 'utf8')) as Record<string, unknown>
const VI = JSON.parse(readFileSync('i18n/locales/vi.json', 'utf8')) as Record<string, unknown>

/** A `t()` that behaves like vue-i18n: returns the key when a lookup misses. */
function makeT(locale: Record<string, unknown>) {
  return (key: string): string =>
    key.split('.').reduce<unknown>((node, part) => {
      if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
        return (node as Record<string, unknown>)[part]
      }
      return undefined
    }, locale) as string || key
}

/** Every `statusMessage: '…'` literal the Nitro layer can throw. */
function serverStatusMessages(dir = 'server', out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      serverStatusMessages(full, out)
    } else if (entry.name.endsWith('.ts')) {
      const src = readFileSync(full, 'utf8')
      for (const m of src.matchAll(/statusMessage:\s*'([^']+)'/g)) out.push(m[1]!)
    }
  }
  return out
}

async function main() {
  const en = makeT(EN)
  const vi = makeT(VI)

  await check('every statusMessage the server throws exists in both locales', async () => {
    const codes = [...new Set(serverStatusMessages())].sort()
    assert(codes.length > 10, `expected the scan to find the server's codes, found ${codes.length}`)
    const missing = codes.filter(code => en(code) === code || vi(code) === code)
    assert(
      missing.length === 0,
      `server throws codes with no translation (they render as the raw identifier):\n    ${missing.join('\n    ')}`
    )
  })

  await check('a translated server code is shown as copy, in both locales', async () => {
    // The shape the Nitro layer produces: statusMessage is the i18n key, and the
    // throw site also attaches a `message`. Before the fix that message won.
    const err = { statusCode: 502, statusMessage: 'error.ttsUpstream', message: 'HTTP 500 from tts' }
    assert(getErrorMessage(err, en) !== 'HTTP 500 from tts', 'en returned the upstream debug text')
    assert(getErrorMessage(err, vi) !== 'HTTP 500 from tts', 'vi returned the upstream debug text')
    assert(
      getErrorMessage(err, en) === en('error.ttsUpstream'),
      `expected the en copy, got ${JSON.stringify(getErrorMessage(err, en))}`
    )
    assert(
      getErrorMessage(err, vi) === vi('error.ttsUpstream'),
      `expected the vi copy, got ${JSON.stringify(getErrorMessage(err, vi))}`
    )
  })

  await check('an untranslated code falls back to the status copy, not to a raw message', async () => {
    // A code nobody has translated yet, on a throw site that also carries debug
    // text. `connectionId is required` is real server copy of this shape.
    const err = { statusCode: 400, statusMessage: 'error.notYetInTheTable', message: 'connectionId is required' }
    const shown = getErrorMessage(err, en)
    assert(shown === en('error.invalidRequest'), `400 resolved to ${JSON.stringify(shown)}`)
  })

  await check('a wire code in data.message never reaches the user', async () => {
    // The sessions endpoint answered `data.message: 'not_found'` and the user saw
    // the identifier. Same for any key-shaped token that did not translate.
    for (const code of ['not_found', 'some_new_code_not_in_the_table', 'error.doesNotExist']) {
      const shown = getErrorMessage({ statusCode: 404, data: { message: code } }, en)
      assert(shown !== code, `the raw code ${JSON.stringify(code)} was returned`)
      assert(shown === en('error.notFound'), `${code} resolved to ${JSON.stringify(shown)}`)
    }
  })

  await check('a real 404 still resolves to the not-found copy', async () => {
    // The shape the sessions endpoint produced in §69 must not regress while
    // fixing the identifier leak.
    for (const err of [
      { statusCode: 404, data: { success: false, error: 'not_found' } },
      { statusCode: 404, statusMessage: 'Not Found' },
      { statusCode: 404, data: { message: 'not_found' } }
    ]) {
      const shown = getErrorMessage(err, en)
      assert(shown === en('error.notFound'), `404 resolved to ${JSON.stringify(shown)}`)
    }
  })

  await check('a human sentence from the backend is still shown as-is', async () => {
    // The deliberate passthrough: a specific, actionable message beats a
    // generic status-code string. A single word counts — many upstream services
    // answer `Timeout` or `Unauthorized`, which reads fine and is not a code.
    for (const text of ['File exceeds the 512 MB upload limit', 'Timeout']) {
      assert(
        getErrorMessage({ statusCode: 400, data: { message: text } }, en) === text,
        `a specific backend sentence was replaced: ${JSON.stringify(text)}`
      )
    }
  })

  await check('the scan sees the same directory the server uses', async () => {
    assert(statSync('server').isDirectory(), 'expected a server/ directory')
  })

  console.log(`\n=== All ${passed} server error-copy checks passed ===`)
}

main().catch((error) => {
  if (error instanceof CheckFailed) process.exit(1)
  console.error(error)
  process.exit(1)
})
