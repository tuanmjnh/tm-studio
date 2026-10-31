// @tmcut/core — assets / probe / cache tests. Run: node --test "test/*.test.mjs"
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  registerAsset,
  getAsset,
  findAssetByPath,
  attachMetadata,
  relinkAsset,
  removeAsset,
  listAssets
} from '../src/assets.mjs'
import { parseFrameRate, normalizeProbe } from '../src/probe.mjs'
import { fnv1aHex, cacheKeyForPath, cachePathFor, buildProxyArgs } from '../src/cache.mjs'

describe('assets', () => {
  function registryWithVideo() {
    const registry = []
    const record = registerAsset(registry, { locator: { runtime: 'electron', path: 'D:/Videos/A.mp4' } })
    return { registry, record }
  }

  it('registers records with derived kind, name and id', () => {
    const { record } = registryWithVideo()
    assert.equal(record.kind, 'video')
    assert.equal(record.name, 'A.mp4')
    assert.ok(record.id.startsWith('asset_'))
    assert.equal(record.status, 'analyzing')
  })

  it('finds records by id and by path', () => {
    const { registry, record } = registryWithVideo()
    assert.equal(getAsset(registry, record.id), record)
    assert.equal(getAsset(registry, 'ghost'), null)
    assert.equal(findAssetByPath(registry, 'd:/videos/a.mp4'), record)
    assert.equal(findAssetByPath(registry, 'd:/other.mp4'), null)
  })

  it('attaches metadata and flips analyzing to ready', () => {
    const { registry, record } = registryWithVideo()
    assert.equal(attachMetadata(registry, record.id, { durationSec: 12.5, width: 1920, hash: 'abc' }), true)
    assert.equal(record.durationSec, 12.5)
    assert.equal(record.hash, 'abc')
    assert.equal(record.status, 'ready')
    assert.equal(attachMetadata(registry, 'ghost', {}), false)
  })

  it('relinks and resets derived data', () => {
    const { registry, record } = registryWithVideo()
    attachMetadata(registry, record.id, { durationSec: 12.5 })
    const relinked = relinkAsset(registry, record.id, { runtime: 'electron', path: 'D:/Videos/B.mp3' })
    assert.equal(relinked.name, 'B.mp3')
    assert.equal(relinked.kind, 'audio')
    assert.equal(relinked.status, 'analyzing')
    assert.equal(relinked.durationSec, 0)
    assert.equal(relinkAsset(registry, 'ghost', { runtime: 'electron', path: 'x' }), null)
  })

  it('removes and lists records', () => {
    const { registry, record } = registryWithVideo()
    registerAsset(registry, { locator: { runtime: 'electron', path: 'D:/a.mp3' } })
    assert.equal(listAssets(registry).length, 2)
    assert.equal(listAssets(registry, 'audio').length, 1)
    assert.equal(removeAsset(registry, record.id), true)
    assert.equal(removeAsset(registry, record.id), false)
    assert.equal(listAssets(registry).length, 1)
  })
})

describe('probe', () => {
  it('parses frame-rate strings', () => {
    assert.equal(parseFrameRate('30000/1001'), 30000 / 1001)
    assert.equal(parseFrameRate('25'), 25)
    assert.equal(parseFrameRate('0/0'), 0)
    assert.equal(parseFrameRate('bogus'), 0)
    assert.equal(parseFrameRate(null), 0)
  })

  it('normalizes ffprobe json output', () => {
    const payload = {
      format: { duration: '12.500' },
      streams: [
        { codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '30/1' },
        { codec_type: 'audio' }
      ]
    }
    assert.deepEqual(normalizeProbe(payload), {
      durationSec: 12.5,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: true
    })
  })

  it('rejects unusable payloads', () => {
    assert.equal(normalizeProbe(null), null)
    assert.equal(normalizeProbe({}), null)
    assert.equal(normalizeProbe({ streams: [], format: {} }), null)
  })
})

describe('cache', () => {
  it('builds deterministic portable keys', () => {
    const revision = { mtimeMs: 1000, size: 2000 }
    const first = cacheKeyForPath('D:\\Videos\\A.mp4', revision)
    assert.equal(first, cacheKeyForPath('d:/videos/a.mp4', revision))
    assert.notEqual(first, cacheKeyForPath('D:/Videos/A.mp4', { mtimeMs: 1001, size: 2000 }))
    assert.equal(fnv1aHex('x'), fnv1aHex('x'))
    assert.notEqual(fnv1aHex('x'), fnv1aHex('y'))
  })

  it('builds cache paths and proxy plans', () => {
    assert.equal(cachePathFor('C:/cache/', 'thumb', 'a b', 'png'), 'C:/cache/thumb-a_b.png')
    const args = buildProxyArgs('in.mp4', 'out.mp4')
    assert.ok(args.includes('-i'))
    assert.ok(args.includes('in.mp4'))
    assert.ok(args.includes('scale=960:-2'))
    assert.ok(args.includes('libx264'))
    assert.ok(args.includes('aac'))
    assert.ok(args.includes('out.mp4'))
    assert.ok(buildProxyArgs('in.mp4', 'out.mp4', 480).includes('scale=480:-2'))

    const custom = buildProxyArgs('in.mov', 'out.mp4', { width: 720, crf: 26, fps: 30 })
    assert.ok(custom.includes('scale=720:-2,fps=30'))
    assert.ok(custom.includes('26'))
  })
})
