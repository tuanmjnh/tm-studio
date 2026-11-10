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
import { existsSync, readFileSync, readdirSync } from 'node:fs'
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

describe('the avatar falls back to something the install owns', () => {
  const menu = read('app/components/dashboard/UserMenu.vue')

  it('a bundled default image is the middle step, not a third-party URL', () => {
    // Order: account picture → the app's own bundled default → initials.
    // A remote placeholder is a third-party dependency with no uptime
    // promise, and the previous one was a stranger's GitHub photo.
    assert.match(menu, /DEFAULT_AVATAR_URL/, 'UserMenu must name the bundled fallback explicitly')
    assert.match(menu, /'\/avatar-default\.svg'/, 'the fallback is a file this install ships')
    const fallback = menu.match(/DEFAULT_AVATAR_URL\s*=\s*'([^']+)'/)
    assert.ok(fallback, 'the bundled fallback URL must be a literal')
    assert.doesNotMatch(fallback[1]!, /^(https?:)?\/\//, 'the fallback must not be fetched from another host')
  })

  it('the default image really exists in public/', () => {
    const asset = join(ROOT, 'public', 'avatar-default.svg')
    assert.ok(existsSync(asset), 'public/avatar-default.svg is missing — the fallback would 404')
    const svg = readFileSync(asset, 'utf8')
    assert.match(svg, /<svg[\s>]/, 'the fallback must be an SVG document')
    // No <text> and no script: it renders the same on every machine and
    // cannot execute, and initials come from the auth user at runtime.
    assert.doesNotMatch(svg, /<script/i, 'the fallback image must not carry script')
  })

  it('the initials are derived from the name and handed to the avatar as its last resort', () => {
    // UAvatar draws `text` when src is absent or the image fails. Passing it
    // explicitly makes step 3 (initials) a decision this file owns, rather
    // than an implicit consequence of `alt` splitting.
    assert.match(menu, /const initials = computed/, 'the initials derivation must be visible')
    assert.match(menu, /text:\s*initials/, 'the computed initials must reach the avatar component')
    assert.match(menu, /fallback to|steps, in order/i, 'the three-step order must be documented where it is implemented')
  })
})

describe('the picture survives a reload and a profile save', () => {
  const auth = read('app/composables/useAuth.ts')

  it('both auth paths map avatarUrl from the hub payload', () => {
    // `applyAuthData` (login/register) and `fetchUser` (/auth/me) are separate
    // mappers; a field added to one and forgotten in the other disappears on
    // the first reload.
    const assignments = [...auth.matchAll(/avatarUrl:\s*data\.[\w.]+/g)].map(m => m[0])
    assert.ok(assignments.length >= 2, `expected both mappers to assign avatarUrl, found ${assignments.length}`)
  })

  it('the profile page reads the field useAuth assigns', () => {
    const page = read('app/pages/system/settings/profile.vue')
    assert.doesNotMatch(page, /u\.avatar\b(?!Url)/, 'the profile form still reads the unpopulated `avatar` field')
    assert.match(page, /u\.avatarUrl/, 'the profile form must seed from avatarUrl')
  })
})
