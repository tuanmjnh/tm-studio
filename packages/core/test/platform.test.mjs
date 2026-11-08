// tmcut-core — platform contract tests. Run: node --test test/
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  PLATFORM_CAPABILITIES,
  PLATFORM_NAMES,
  createPlatformInfo,
  platformSupports
} from '../src/platform.mjs'

describe('platform contract', () => {
  it('declares the runtime names and capability keys', () => {
    assert.deepEqual([...PLATFORM_NAMES], ['electron', 'web', 'headless'])
    // Zero-FFmpeg slice I retired the `nativeFFmpeg` key: no host owns a
    // renderer any more.
    assert.equal(PLATFORM_CAPABILITIES.length, 7)
    assert.equal(new Set(PLATFORM_CAPABILITIES).size, 7)
    assert.equal(PLATFORM_CAPABILITIES.includes('nativeFFmpeg'), false)
    assert.equal(Object.isFrozen(PLATFORM_NAMES), true)
    assert.equal(Object.isFrozen(PLATFORM_CAPABILITIES), true)
  })

  it('defaults every capability to false', () => {
    const info = createPlatformInfo('web')
    assert.equal(info.name, 'web')
    assert.deepEqual(Object.keys(info.capabilities).sort(), [...PLATFORM_CAPABILITIES].sort())
    for (const key of PLATFORM_CAPABILITIES) assert.equal(info.capabilities[key], false)
  })

  it('keeps only strict true values', () => {
    const info = createPlatformInfo('electron', { webCodecs: 'yes', filesystem: 1 })
    assert.equal(info.capabilities.webCodecs, false)
    assert.equal(info.capabilities.webCodecs, false)
    assert.equal(info.capabilities.filesystem, false)
  })

  it('drops unknown capability keys', () => {
    const info = createPlatformInfo('electron', { teleport: true })
    assert.equal('teleport' in info.capabilities, false)
  })

  it('rejects unknown platform names', () => {
    assert.throws(() => createPlatformInfo('mobile'), TypeError)
    assert.throws(() => createPlatformInfo(undefined), TypeError)
  })

  it('answers capability queries defensively', () => {
    const info = createPlatformInfo('headless', { filesystem: true })
    assert.equal(platformSupports(info, 'filesystem'), true)
    assert.equal(platformSupports(info, 'webGPU'), false)
    assert.equal(platformSupports(info, 'teleport'), false)
    assert.equal(platformSupports(null, 'filesystem'), false)
  })
})
