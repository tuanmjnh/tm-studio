// @tmcut/core — stabilize tests (Roadmap E-5). Run: node --test "test/*.test.mjs"
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  escapeFilterPath,
  resolveStabilizeOptions,
  buildVidstabDetectArgs,
  buildVidstabTransformArgs
} from '../src/stabilize.mjs'

describe('stabilize (E-5)', () => {
  it('escapes colons and forward slashes for FFmpeg filter paths', () => {
    assert.equal(escapeFilterPath('D:\\Videos\\footage.trf'), 'D\\:/Videos/footage.trf')
    assert.equal(escapeFilterPath('/tmp/cache/a:b.trf'), '/tmp/cache/a\\:b.trf')
    assert.throws(() => escapeFilterPath('file\'with\'quote.trf'), /cannot contain single quotes/)
  })

  it('resolves preset levels and custom overrides', () => {
    const mild = resolveStabilizeOptions('mild')
    assert.equal(mild.level, 'mild')
    assert.equal(mild.smoothing, 10)
    assert.equal(mild.shakiness, 4)

    const med = resolveStabilizeOptions('medium')
    assert.equal(med.level, 'medium')
    assert.equal(med.smoothing, 20)
    assert.equal(med.shakiness, 6)

    const agg = resolveStabilizeOptions('aggressive')
    assert.equal(agg.level, 'aggressive')
    assert.equal(agg.smoothing, 35)
    assert.equal(agg.shakiness, 8)

    const custom = resolveStabilizeOptions({ level: 'mild', smoothing: 25 })
    assert.equal(custom.level, 'mild')
    assert.equal(custom.smoothing, 25)
    assert.equal(custom.shakiness, 4)

    const fallback = resolveStabilizeOptions('unknown')
    assert.equal(fallback.level, 'medium')
    assert.equal(fallback.smoothing, 20)
  })

  it('builds vidstabdetect arguments for Pass 1', () => {
    const args = buildVidstabDetectArgs('D:/footage.mp4', 'D:/cache/motion.trf', 'medium')
    assert.ok(args.includes('-i'))
    assert.ok(args.includes('D:/footage.mp4'))
    assert.ok(args.includes('-vf'))

    const vfIndex = args.indexOf('-vf')
    const filter = args[vfIndex + 1]
    assert.ok(filter.startsWith('vidstabdetect='))
    assert.ok(filter.includes('stepsize=6'))
    assert.ok(filter.includes('shakiness=6'))
    assert.ok(filter.includes('accuracy=15'))
    assert.ok(filter.includes('result=\'D\\:/cache/motion.trf\''))
    assert.ok(args.includes('-f'))
    assert.ok(args.includes('null'))
    assert.ok(args.includes('-'))
  })

  it('builds vidstabtransform arguments for Pass 2', () => {
    const args = buildVidstabTransformArgs('D:/footage.mp4', 'D:/cache/motion.trf', 'D:/cache/out.mp4', 'aggressive')
    assert.ok(args.includes('-i'))
    assert.ok(args.includes('D:/footage.mp4'))
    assert.ok(args.includes('-vf'))

    const vfIndex = args.indexOf('-vf')
    const filter = args[vfIndex + 1]
    assert.ok(filter.startsWith('vidstabtransform='))
    assert.ok(filter.includes('input=\'D\\:/cache/motion.trf\''))
    assert.ok(filter.includes('smoothing=35'))
    assert.ok(filter.includes('optalgo=gauss'))
    assert.ok(filter.includes('zoom=0'))

    assert.ok(args.includes('-c:v'))
    assert.ok(args.includes('libx264'))
    assert.ok(args.includes('-crf'))
    assert.ok(args.includes('18'))
    assert.ok(args.includes('-c:a'))
    assert.ok(args.includes('copy'))
    assert.equal(args[args.length - 1], 'D:/cache/out.mp4')
  })
})
