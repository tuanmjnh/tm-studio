/**
 * Device credential scoping (`shared/utils/deviceCredentialScope.ts`).
 *
 * A credential is a row in ONE Hub. Pointing the app at another Hub leaves a
 * credential that Hub never issued, and sending it answers 401 on every call —
 * which the UI would otherwise report as an expired session.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { credentialBelongsTo, isTerminalDeviceRejection, normalizeOrigin } from '../../shared/utils/deviceCredentialScope'

const PROD = 'https://hub.prod.test'
const LOCAL = 'http://localhost:4000'
const APP = 'tm-studio_app'

const credential = (overrides: Record<string, string> = {}) => ({
  deviceId: 'dev-1',
  secret: 's3cret',
  hubOrigin: PROD,
  appId: APP,
  ...overrides
})

describe('normalizeOrigin', () => {
  it('ignores trailing slashes and letter case', () => {
    assert.equal(normalizeOrigin('https://Hub.Prod.Test/'), 'https://hub.prod.test')
    assert.equal(normalizeOrigin(undefined), '')
  })
})

describe('credentialBelongsTo', () => {
  it('accepts the exact Hub and app that issued the credential', () => {
    assert.equal(credentialBelongsTo(credential(), { hubUrl: PROD, appId: APP }), true)
  })

  it('refuses a credential from another Hub', () => {
    assert.equal(credentialBelongsTo(credential({ hubOrigin: LOCAL }), { hubUrl: PROD, appId: APP }), false)
  })

  it('refuses the same Hub under a different app id', () => {
    assert.equal(credentialBelongsTo(credential({ appId: 'tm-studio_other' }), { hubUrl: PROD, appId: APP }), false)
  })

  it('never assumes a legacy row without an origin belongs to the current Hub', () => {
    assert.equal(credentialBelongsTo(credential({ hubOrigin: '' }), { hubUrl: PROD, appId: APP }), false)
  })

  it('refuses when either side is incomplete', () => {
    assert.equal(credentialBelongsTo(null, { hubUrl: PROD, appId: APP }), false)
    assert.equal(credentialBelongsTo(credential({ secret: '' }), { hubUrl: PROD, appId: APP }), false)
    assert.equal(credentialBelongsTo(credential(), { hubUrl: '', appId: APP }), false)
    assert.equal(credentialBelongsTo(credential(), { hubUrl: PROD, appId: '' }), false)
  })
})

describe('isTerminalDeviceRejection', () => {
  it('accepts only a 401 naming a terminal device error', () => {
    assert.equal(isTerminalDeviceRejection(401, 'error.deviceUnauthorized'), true)
    assert.equal(isTerminalDeviceRejection(401, 'error.deviceExpired'), true)
    assert.equal(isTerminalDeviceRejection(401, 'error.invalidToken'), false)
  })

  it('leaves the credential alone on network, server and scope failures', () => {
    assert.equal(isTerminalDeviceRejection(undefined, undefined), false)
    assert.equal(isTerminalDeviceRejection(503, 'error.deviceUnauthorized'), false)
    assert.equal(isTerminalDeviceRejection(403, 'error.forbidden'), false)
    assert.equal(isTerminalDeviceRejection(401, ''), false)
  })
})
