/**
 * How the studio decides that a token is real.
 *
 * Today it holds `AUTH_JWT_SECRET` — the same symmetric secret the hub signs
 * with — and verifies HS256 locally. That is a shared bootstrap secret on
 * every satellite, and a packaged desktop build has nowhere safe to keep it.
 * The hub ships two things that make it optional:
 *
 *  - `POST /api/v1/auth/introspect` answers with the claims for a bearer token
 *    (verified in the tests below against a fake transport, and live in P5).
 *  - A JWKS URL is the asymmetric end state; the hub does not publish one yet,
 *    so the verifier already accepts RS256/ES256 keys and prefers them when a
 *    URL is configured. The phased rule is: JWKS first, shared secret second,
 *    introspection last — old and new tokens both verify during a migration.
 *
 * These checks run the real verifier against real tokens signed by `jose`;
 * only the network hop is substituted.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { SignJWT, generateKeyPair, exportJWK } from 'jose'
import { createAccessTokenVerifier } from '../../server/utils/tokenVerify'

const SECRET = 'a-shared-secret-that-is-long-enough-for-hs256-use'
const OTHER_SECRET = 'a-different-secret-that-must-never-verify-the-same-token'

async function hs256(claims: Record<string, unknown>, secret = SECRET, expiry = '15m'): Promise<string> {
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(new TextEncoder().encode(secret))
}

const claims = {
  sub: 'user-1',
  appId: 'tm-studio_vhvrhn',
  email: 'user@example.com',
  name: 'Test User',
  roles: ['admin'],
  permissions: ['media:read']
}

describe('access token verification', () => {
  it('verifies a real HS256 token with the configured shared secret', async () => {
    const verify = createAccessTokenVerifier({ sharedSecret: SECRET })
    const payload = await verify(await hs256(claims))
    assert.ok(payload)
    assert.equal(payload.appId, 'tm-studio_vhvrhn')
    assert.equal(payload.userId, 'user-1', 'sub is exposed as userId for the shared TokenPayload type')
    assert.deepEqual(payload.permissions, ['media:read'])
  })

  it('refuses a token signed with a different secret', async () => {
    const verify = createAccessTokenVerifier({ sharedSecret: SECRET })
    assert.equal(await verify(await hs256(claims, OTHER_SECRET)), null)
  })

  it('refuses an expired token', async () => {
    // jose reads the real clock; `now` in the verifier only bounds the
    // introspection cache. So the token itself is minted already expired.
    const verify = createAccessTokenVerifier({ sharedSecret: SECRET })
    const past = Math.floor(Date.now() / 1000) - 3600
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(past)
      .setExpirationTime(past + 60)
      .sign(new TextEncoder().encode(SECRET))
    assert.equal(await verify(token), null)
  })

  it('refuses a 2FA challenge token as an access token', async () => {
    // `signTotpChallenge` uses the same secret and a 5-minute TTL. Accepting
    // purpose=totp here would let a pending-login token read the workspace
    // before the second factor was ever presented.
    const verify = createAccessTokenVerifier({ sharedSecret: SECRET })
    assert.equal(await verify(await hs256({ ...claims, purpose: 'totp' })), null)
  })

  it('refuses a token with no subject', async () => {
    const verify = createAccessTokenVerifier({ sharedSecret: SECRET })
    assert.equal(await verify(await hs256({ appId: 'tm-studio_vhvrhn' })), null)
  })

  it('verifies an RS256 token against an inline public key set (what a client build ships)', async () => {
    // The desktop build ships PUBLIC keys only — that is not a secret, and it
    // is the whole point: a packaged client verifies hub tokens without
    // holding the signing material.
    const { publicKey, privateKey } = await generateKeyPair('RS256')
    const jwk = { ...(await exportJWK(publicKey)), kid: 'pub-1', alg: 'RS256', use: 'sig' }
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'pub-1' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey)

    const verify = createAccessTokenVerifier({ publicKeys: JSON.stringify([jwk]) })
    const payload = await verify(token)
    assert.ok(payload, 'an inline public JWK must verify the matching RS256 token')
    assert.equal(payload.userId, 'user-1')
  })

  it('ignores a public key set that carries private key material', async () => {
    // Defensive read: a JWK with `d` is a private key. It must never be used
    // for verification, and its presence is a configuration error, not a pass.
    const { privateKey } = await generateKeyPair('RS256', { extractable: true })
    const leaked = await exportJWK(privateKey)
    assert.equal(typeof leaked.d, 'string', 'the fixture must really contain private material')
    const verify = createAccessTokenVerifier({ publicKeys: JSON.stringify([{ ...leaked, kid: 'leak' }]) })
    const { privateKey: realSigner } = await generateKeyPair('RS256')
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'leak' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(realSigner)
    assert.equal(await verify(token), null, 'a JWK containing `d` must be discarded')
  })

  it('refuses `alg: none` and unexpected algorithms outright', async () => {
    const verify = createAccessTokenVerifier({ sharedSecret: SECRET })
    const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`
    assert.equal(await verify(unsigned), null)
  })

  it('verifies a token through a JWKS endpoint', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256')
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey)

    const verify = createAccessTokenVerifier({
      jwksUrl: 'https://hub.example/.well-known/jwks.json',
      jwksResolver: async () => [jwk]
    })
    const payload = await verify(token)
    assert.ok(payload, 'an RS256 token with a published kid must verify')
    assert.equal(payload.userId, 'user-1')
  })

  it('refuses an RS256 token signed by a key the JWKS does not publish', async () => {
    const { publicKey } = await generateKeyPair('RS256')
    const { privateKey: attacker } = await generateKeyPair('RS256')
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(attacker)

    const verify = createAccessTokenVerifier({
      jwksUrl: 'https://hub.example/.well-known/jwks.json',
      jwksResolver: async () => [jwk]
    })
    assert.equal(await verify(token), null)
  })

  it('during migration, a hub that has not rotated yet still verifies by secret', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256')
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
    const newToken = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey)

    const verify = createAccessTokenVerifier({
      jwksUrl: 'https://hub.example/.well-known/jwks.json',
      jwksResolver: async () => [jwk],
      sharedSecret: SECRET
    })
    assert.ok(await verify(newToken), 'JWKS path first')
    assert.ok(await verify(await hs256(claims)), 'HS256 tokens issued before the rotation still verify')
  })

  it('falls back to introspection when it holds no local key material', async () => {
    let calls = 0
    const verify = createAccessTokenVerifier({
      introspect: async (token) => {
        calls++
        return token === 'good-token'
          ? { userId: 'user-1', appId: 'tm-studio_vhvrhn', email: 'user@example.com', role: 'admin', permissions: ['*'], expiresAt: Date.now() + 60_000 }
          : null
      }
    })
    assert.ok(await verify('good-token'))
    assert.equal(await verify('bad-token'), null)
    assert.equal(calls, 2)
  })

  it('caches an introspected token until it expires instead of calling the hub per request', async () => {
    let calls = 0
    const verify = createAccessTokenVerifier({
      introspect: async () => {
        calls++
        return { userId: 'user-1', appId: 'tm-studio_vhvrhn', email: 'u@example.com', role: 'admin', permissions: [], expiresAt: Date.now() + 60_000 }
      }
    })
    await verify('token')
    await verify('token')
    await verify('token')
    assert.equal(calls, 1, 'a valid token must be cached until its expiry')
  })

  it('never caches a rejection, so a revoked token stops working once the cache expires', async () => {
    let calls = 0
    const verify = createAccessTokenVerifier({
      introspect: async () => {
        calls++
        return null
      }
    })
    await verify('revoked')
    await verify('revoked')
    assert.equal(calls, 2)
  })

  it('denies everything when no verification material is configured', async () => {
    const verify = createAccessTokenVerifier({})
    assert.equal(await verify(await hs256(claims)), null)
  })

  it('does not let introspection claims smuggle a TOTP challenge through', async () => {
    const verify = createAccessTokenVerifier({
      introspect: async () => ({ userId: 'user-1', appId: 'x', email: 'e', role: 'user', permissions: [], purpose: 'totp' })
    })
    assert.equal(await verify('pending'), null)
  })
})
