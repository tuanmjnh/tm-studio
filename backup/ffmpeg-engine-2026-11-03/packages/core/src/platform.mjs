// =============================================================================
//  tmcut-core — platform
//  Host capability negotiation (V4 Phase 1 / M1, ADR-014).
//
//  The core never detects its host: the app builds ONE PlatformInfo at
//  startup and every feature flag reads it, so the same build cannot silently
//  behave differently in two code paths. Host services themselves (media
//  resolution, frame capture, encoding) stay out of core — their interfaces
//  live in types/platform.ts and are injected by the host.
// =============================================================================

/** Host names, matching TmcutRuntimeInfo in types/runtime.ts. */
export const PLATFORM_NAMES = Object.freeze(['electron', 'web', 'headless'])

/** Capability keys, matching TmcutCapabilities in types/runtime.ts. */
export const PLATFORM_CAPABILITIES = Object.freeze([
  'filesystem',
  'nativeFFmpeg',
  'webCodecs',
  'webGPU',
  'hardwareEncoding',
  'backgroundRender',
  'cloudRender',
  'largeFileAccess'
])

/**
 * Normalize a host declaration: unknown names throw (a typo must not
 * silently downgrade the app to headless), and every capability is a
 * strict boolean so `if (capabilities.webCodecs)` is never truthy-by-string.
 *
 * @param {'electron' | 'web' | 'headless'} name
 * @param {Record<string, unknown>} [capabilities]
 * @returns {{ name: string, capabilities: Record<string, boolean> }}
 */
export function createPlatformInfo(name, capabilities = {}) {
  if (!PLATFORM_NAMES.includes(name)) {
    throw new TypeError(`unknown platform "${name}" (expected ${PLATFORM_NAMES.join(' | ')})`)
  }
  const normalized = {}
  for (const key of PLATFORM_CAPABILITIES) {
    normalized[key] = capabilities?.[key] === true
  }
  return { name, capabilities: normalized }
}

/** True only when the host declared the capability (unknown keys are false). */
export function platformSupports(info, capability) {
  return info?.capabilities?.[capability] === true
}
