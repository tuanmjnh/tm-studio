/**
 * The user menu avatar, and why every user saw a stranger's face.
 *
 * `UserMenu.vue` read `auth.user.value?.avatar`, but `useAuth()` only ever
 * assigns `avatarUrl` (shared/types/auth.ts declares `avatar?` as well, so the
 * read type-checks and fails silently). The expression was therefore always
 * `undefined`, and EVERY signed-in user fell through to the hardcoded
 * `https://github.com/benjamincanac.png` — the Nuxt UI author's GitHub avatar,
 * left over from the upstream dashboard template.
 *
 * Two consequences, one of them visible in the console:
 *
 *  1. The account's own picture never rendered.
 *  2. Chromium blocked that cross-origin response with CORB (it is fetched as
 *     an <img> but served without an image-friendly content-type), so every
 *     page carrying the app shell logged
 *     `[issue] Response was blocked by CORB (Cross-Origin Read Blocking)`.
 *
 * The guard is generic: it fails if any template or composable reads an avatar
 * field the auth layer does not populate, or hardcodes a third party's avatar.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) walk(rel, out)
    else if (entry.name.endsWith('.vue') || entry.name.endsWith('.ts')) out.push(rel)
  }
  return out
}

describe('the signed-in avatar comes from the auth user', () => {
  const files = [...walk('app'), ...walk('shared')]

  it('no source hardcodes a third-party avatar as its fallback', () => {
    const offenders: string[] = []
    for (const file of files) {
      const src = read(file)
      for (const match of src.matchAll(/https:\/\/github\.com\/[\w-]+\.png/g)) {
        offenders.push(`${file}: ${match[0]}`)
      }
    }
    assert.deepEqual(offenders, [],
      'a third-party GitHub avatar is used as a fallback — it is not ours, it never belonged to the user, and Chromium blocks the cross-origin response')
  })

  it('the user menu reads the field useAuth actually populates', () => {
    const src = read('app/components/dashboard/UserMenu.vue')
    const srcLine = src.match(/src:\s*([^\n,]+)/)
    assert.ok(srcLine, 'UserMenu no longer declares an avatar src')

    const expression = srcLine[1]!
    // `useAuth()` assigns avatarUrl in both the login and /auth/me paths and
    // never assigns `avatar`; reading the latter is always undefined.
    assert.match(expression, /avatarUrl/, `avatar src reads "${expression.trim()}", but useAuth() only ever sets avatarUrl`)
    assert.doesNotMatch(expression, /\.avatar\b(?!Url)/,
      `avatar src reads "${expression.trim()}": .avatar is never populated by useAuth()`)
  })

  it('the field the menu reads is the one the auth composable assigns', () => {
    const auth = read('app/composables/useAuth.ts')
    assert.match(auth, /avatarUrl:/, 'useAuth no longer assigns avatarUrl — update UserMenu and this guard together')
  })
})
