// =============================================================================
//  Provider routing — capability matrix + per-scene fallback (Roadmap v1 §7, P7).
//
//  One template can route supported shots to different providers WITHOUT
//  changing the template's logical schema: the scene asks for capabilities
//  ('video-gen', 'image-gen', 'tts'), the template's providerPolicy narrows
//  the field (allowedProviders + fallbackOrder + minimumCapabilities) and
//  this module picks the first provider whose capability manifest can
//  actually serve the request — duration ceiling included.
//
//  Pure: inputs and outputs are plain JSON. The caller owns the adapter
//  registry; this module only reads `createCapabilityManifest`-shaped objects.
// =============================================================================

/** Map a scene-level capability token to the manifest modality it needs. */
const CAPABILITY_MODALITY = {
  'video-gen': 'video',
  'image-gen': 'image'
}

/** Providers that failed their last health check are skipped for one wave. */
export function isProviderHealthy(manifest, unhealthy = []) {
  if (!manifest) return false
  return !unhealthy.includes(manifest.providerId)
}

/** Can this manifest serve a request needing `capabilities` + `durationSec`? */
export function canServe(manifest, request = {}) {
  if (!manifest || typeof manifest !== 'object') return { ok: false, reason: 'no-manifest' }
  const capabilities = Array.isArray(request.capabilities) ? request.capabilities : []
  const modalities = Array.isArray(manifest.modalities) ? manifest.modalities : []

  for (const capability of capabilities) {
    // Tokens with no modality mapping (tts, upscale…) are checked by the
    // manifest's own capability list when the provider declares one.
    const needed = CAPABILITY_MODALITY[capability]
    if (needed) {
      if (!modalities.includes(needed)) return { ok: false, reason: `no-${needed}-modality` }
    } else if (Array.isArray(manifest.extraCapabilities)) {
      if (!manifest.extraCapabilities.includes(capability)) {
        return { ok: false, reason: `unsupported-${capability}` }
      }
    }
  }

  const durationSec = Number(request.durationSec)
  if (Number.isFinite(durationSec) && durationSec > 0) {
    const ceiling = Number(manifest.maxDurationSec)
    if (Number.isFinite(ceiling) && durationSec > ceiling) {
      return { ok: false, reason: `duration-${durationSec}s-over-${ceiling}s` }
    }
  }

  return { ok: true }
}

/**
 * Pick the provider for one scene.
 *
 * Order: template fallbackOrder first, then any other allowed provider, then
 * (unless the policy restricts it) every known provider. Minimum capabilities
 * join the scene's own requirements. `unhealthy` ids (a previous failure in
 * this wave) are skipped, which is what makes the fallback chain observable
 * instead of aspirational.
 *
 * @returns {{ ok: boolean, providerId?: string, reason?: string, skipped: Array<{ providerId: string, reason: string }> }}
 */
export function routeScene(options = {}) {
  const request = options.request || {}
  const manifests = Array.isArray(options.manifests) ? options.manifests : []
  const policy = options.policy || {}
  const unhealthy = Array.isArray(options.unhealthy) ? options.unhealthy : []
  const requireVerified = Boolean(options.requireVerified)

  const byId = new Map(manifests.map(m => [m.providerId, m]))
  const allowed = Array.isArray(policy.allowedProviders) && policy.allowedProviders.length > 0
    ? new Set(policy.allowedProviders)
    : null
  const fallback = Array.isArray(policy.fallbackOrder) ? policy.fallbackOrder : []
  const minimums = Array.isArray(policy.minimumCapabilities) ? policy.minimumCapabilities : []
  const capabilities = [...new Set([...minimums, ...(Array.isArray(request.capabilities) ? request.capabilities : [])])]

  // Candidate order: explicit fallback order, then remaining allowed, then the rest.
  const ordered = []
  const seen = new Set()
  for (const id of fallback) {
    if (!seen.has(id)) { seen.add(id); ordered.push(id) }
  }
  for (const [id] of byId) {
    if (!seen.has(id)) { seen.add(id); ordered.push(id) }
  }

  const skipped = []
  for (const providerId of ordered) {
    if (allowed && !allowed.has(providerId)) {
      skipped.push({ providerId, reason: 'not-allowed-by-policy' })
      continue
    }
    const manifest = byId.get(providerId)
    if (!manifest) {
      skipped.push({ providerId, reason: 'not-registered' })
      continue
    }
    if (!isProviderHealthy(manifest, unhealthy)) {
      skipped.push({ providerId, reason: 'unhealthy' })
      continue
    }
    if (requireVerified && !manifest.verified) {
      skipped.push({ providerId, reason: 'not-verified' })
      continue
    }
    const verdict = canServe(manifest, { ...request, capabilities })
    if (!verdict.ok) {
      skipped.push({ providerId, reason: verdict.reason })
      continue
    }
    return { ok: true, providerId, skipped }
  }

  return {
    ok: false,
    reason: 'no-capable-provider',
    skipped
  }
}

/**
 * Route every scene of a storyboard in one pass. Fails per scene, never for
 * the whole batch — a template whose second shot needs 12s while no connected
 * provider does 12s must still surface WHICH shots are unroutable, not throw.
 */
export function routeStoryboard(options = {}) {
  const scenes = Array.isArray(options.scenes) ? options.scenes : []
  const routed = []
  let unrouted = 0
  for (const scene of scenes) {
    const route = routeScene({ ...options, request: scene })
    if (route.ok) {
      routed.push({ sceneId: scene.sceneId ?? null, providerId: route.providerId, skipped: route.skipped })
    } else {
      unrouted += 1
      routed.push({ sceneId: scene.sceneId ?? null, providerId: null, skipped: route.skipped, reason: route.reason })
    }
  }
  return { routed, unrouted, allRouted: unrouted === 0 }
}

/**
 * Compact matrix for the Provider Hub UI: one row per provider, which scene
 * capabilities it can serve at the template's duration.
 */
export function buildCapabilityMatrix(manifests = [], request = {}) {
  return manifests.map((manifest) => {
    const verdict = canServe(manifest, request)
    return {
      providerId: manifest.providerId,
      displayName: manifest.displayName || manifest.providerId,
      verified: Boolean(manifest.verified),
      modalities: Array.isArray(manifest.modalities) ? [...manifest.modalities] : [],
      maxDurationSec: Number(manifest.maxDurationSec) || 0,
      costModel: manifest.costModel || 'per-credit',
      estimatedCostPerUnit: Number(manifest.estimatedCostPerUnit) || 0,
      canServe: verdict.ok,
      reason: verdict.ok ? null : verdict.reason
    }
  })
}
