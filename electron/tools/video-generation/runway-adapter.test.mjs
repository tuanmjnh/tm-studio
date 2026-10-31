// =============================================================================
//  TM TOOLS - Runway Video Generation Adapter Tests
// =============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import runwayAdapter, { RunwayAdapterError } from './runway-adapter.mjs'

test('runwayAdapter.manifest', async (t) => {
  await t.test('returns manifest with video modality (verified=false until full audit)', () => {
    const m = runwayAdapter.manifest()
    assert.equal(m.schemaVersion, 1)
    assert.equal(m.providerId, 'runway')
    assert.equal(m.verified, false)
    assert.deepEqual(m.modalities, ['video'])
    assert.deepEqual(m.outputFormats.video, ['mp4'])
    assert.equal(m.supportsAsync, true)
    assert.equal(m.supportsCancel, true)
    assert.ok(m.displayName.includes('Gen-4'))
  })
})

test('runwayAdapter.estimateCost', async (t) => {
  await t.test('calculates estimate based on duration and model', () => {
    const estTurbo = runwayAdapter.estimateCost({ params: { durationSec: 5, model: 'gen4_turbo' } })
    assert.equal(estTurbo.estimatedCostUsd, 0.15) // 5 * 0.03
    assert.equal(estTurbo.budgetWarning, false)

    const estGen4 = runwayAdapter.estimateCost({ params: { durationSec: 10, model: 'gen4' } })
    assert.equal(estGen4.estimatedCostUsd, 0.50) // 10 * 0.05
    assert.equal(estGen4.budgetWarning, false)
  })
})

test('runwayAdapter._internal.validateJobInput', async (t) => {
  const { validateJobInput } = runwayAdapter._internal

  await t.test('rejects missing or unsupported taskType', () => {
    assert.throws(() => validateJobInput({ prompt: 'test' }), /taskType must be/)
    assert.throws(() => validateJobInput({ taskType: 'audio', prompt: 'test' }), /taskType must be/)
  })

  await t.test('rejects missing prompt', () => {
    assert.throws(() => validateJobInput({ taskType: 'text-to-video', prompt: '' }), /prompt is required/)
  })

  await t.test('requires inputMediaRef for image-to-video', () => {
    assert.throws(() => validateJobInput({ taskType: 'image-to-video', prompt: 'animate' }), /image-to-video requires inputMediaRef/)
  })

  await t.test('accepts valid text-to-video input', () => {
    assert.doesNotThrow(() => validateJobInput({
      taskType: 'text-to-video',
      prompt: 'A sleek cinematic shot of a coffee cup',
      params: { durationSec: 5 }
    }))
  })
})

test('runwayAdapter API error handling', async (t) => {
  await t.test('submitJob throws no-key error when RUNWAY_API_KEY is missing', async () => {
    const prevKey = process.env.RUNWAY_API_KEY
    delete process.env.RUNWAY_API_KEY
    try {
      await assert.rejects(
        async () => {
          await runwayAdapter.submitJob({
            taskType: 'text-to-video',
            prompt: 'Test prompt'
          })
        },
        (err) => {
          assert.equal(err instanceof RunwayAdapterError, true)
          assert.equal(err.code, 'no-key')
          return true
        }
      )
    } finally {
      if (prevKey) process.env.RUNWAY_API_KEY = prevKey
    }
  })
})
