// Roadmap v1 §7 (P7) — provider routing: capability matrix + per-scene fallback.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canServe,
  isProviderHealthy,
  routeScene,
  routeStoryboard,
  buildCapabilityMatrix,
  createCapabilityManifest
} from '../src/index.mjs'

const runway = createCapabilityManifest({
  providerId: 'runway',
  displayName: 'Runway',
  modalities: ['video'],
  maxDurationSec: 10,
  verified: true
})
const kling = createCapabilityManifest({
  providerId: 'kling',
  displayName: 'Kling',
  modalities: ['video'],
  maxDurationSec: 10,
  verified: true
})
const imageOnly = createCapabilityManifest({
  providerId: 'dallish',
  displayName: 'Image Only',
  modalities: ['image'],
  verified: true
})
const MANIFESTS = [runway, kling, imageOnly]

test('canServe matches modality and duration ceiling', () => {
  assert.equal(canServe(runway, { capabilities: ['video-gen'], durationSec: 5 }).ok, true)
  assert.equal(canServe(runway, { capabilities: ['video-gen'], durationSec: 12 }).ok, false)
  assert.equal(canServe(imageOnly, { capabilities: ['video-gen'] }).reason, 'no-video-modality')
  assert.equal(canServe(null, {}).ok, false)
})

test('isProviderHealthy skips the unhealthy set', () => {
  assert.equal(isProviderHealthy(runway, []), true)
  assert.equal(isProviderHealthy(runway, ['runway']), false)
  assert.equal(isProviderHealthy(null), false)
})

test('routeScene honours template fallbackOrder first', () => {
  const route = routeScene({
    request: { capabilities: ['video-gen'], durationSec: 5 },
    manifests: MANIFESTS,
    policy: { fallbackOrder: ['kling', 'runway'] }
  })
  assert.equal(route.ok, true)
  assert.equal(route.providerId, 'kling')
})

test('routeScene falls past a provider that cannot serve the request', () => {
  const route = routeScene({
    request: { capabilities: ['video-gen'], durationSec: 12 },
    manifests: [
      createCapabilityManifest({ providerId: 'shorty', displayName: 'S', modalities: ['video'], maxDurationSec: 8, verified: true }),
      createCapabilityManifest({ providerId: 'longy', displayName: 'L', modalities: ['video'], maxDurationSec: 20, verified: true })
    ],
    policy: { fallbackOrder: ['shorty', 'longy'] }
  })
  assert.equal(route.providerId, 'longy')
  assert.deepEqual(route.skipped, [{ providerId: 'shorty', reason: 'duration-12s-over-8s' }])
})

test('routeScene respects allowedProviders and reports skips', () => {
  const route = routeScene({
    request: { capabilities: ['video-gen'] },
    manifests: MANIFESTS,
    policy: { allowedProviders: ['dallish'] }
  })
  assert.equal(route.ok, false)
  assert.equal(route.reason, 'no-capable-provider')
  const reasons = route.skipped.map(s => `${s.providerId}:${s.reason}`)
  assert.ok(reasons.includes('kling:not-allowed-by-policy'))
  assert.ok(reasons.includes('dallish:no-video-modality'))
})

test('unhealthy providers are skipped for the wave', () => {
  const route = routeScene({
    request: { capabilities: ['video-gen'] },
    manifests: MANIFESTS,
    policy: { fallbackOrder: ['runway', 'kling'] },
    unhealthy: ['runway']
  })
  assert.equal(route.providerId, 'kling')
  assert.deepEqual(route.skipped, [{ providerId: 'runway', reason: 'unhealthy' }])
})

test('requireVerified excludes unverified manifests', () => {
  const unverified = createCapabilityManifest({ providerId: 'wild', displayName: 'W', modalities: ['video'], verified: false })
  const route = routeScene({
    request: { capabilities: ['video-gen'] },
    manifests: [unverified, runway],
    policy: { fallbackOrder: ['wild', 'runway'] },
    requireVerified: true
  })
  assert.equal(route.providerId, 'runway')
})

test('minimumCapabilities join the scene request', () => {
  const route = routeScene({
    request: { capabilities: [] },
    manifests: MANIFESTS,
    policy: { minimumCapabilities: ['video-gen'] }
  })
  assert.ok(['runway', 'kling'].includes(route.providerId))
})

test('routeStoryboard routes per scene and counts unrouted', () => {
  const { routed, unrouted, allRouted } = routeStoryboard({
    scenes: [
      { sceneId: 's1', capabilities: ['video-gen'], durationSec: 5 },
      { sceneId: 's2', capabilities: ['video-gen'], durationSec: 999 }
    ],
    manifests: MANIFESTS,
    policy: {}
  })
  assert.equal(routed.length, 2)
  assert.equal(routed[0].providerId !== null, true)
  assert.equal(routed[1].providerId, null)
  assert.equal(unrouted, 1)
  assert.equal(allRouted, false)
})

test('one template routes different shots to different providers', () => {
  // P7 acceptance: capability-driven split without touching the template schema.
  const text2video = createCapabilityManifest({ providerId: 't2v', displayName: 'T2V', modalities: ['video'], verified: true })
  const img2img = createCapabilityManifest({
    providerId: 'i2v', displayName: 'I2V', modalities: ['video'], verified: true,
    extraCapabilities: ['image-to-video']
  })
  const { routed, allRouted } = routeStoryboard({
    scenes: [
      { sceneId: 's1', capabilities: ['video-gen'] },
      { sceneId: 's2', capabilities: ['video-gen', 'image-to-video'] }
    ],
    manifests: [text2video, img2img],
    policy: { fallbackOrder: ['t2v', 'i2v'] }
  })
  assert.equal(allRouted, true)
  assert.equal(routed[0].providerId, 't2v')
  assert.equal(routed[1].providerId, 'i2v')
})

test('buildCapabilityMatrix summarises a fleet for the Provider Hub', () => {
  const matrix = buildCapabilityMatrix(MANIFESTS, { capabilities: ['video-gen'], durationSec: 5 })
  assert.equal(matrix.length, 3)
  const row = matrix.find(r => r.providerId === 'dallish')
  assert.equal(row.canServe, false)
  assert.equal(row.verified, true)
  assert.equal(row.modalities.includes('image'), true)
})
