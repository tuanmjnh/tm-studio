// R145 (§207): the ONE definition of "which config slots hold API keys".
// R139–R143 kept two byte-identical literals (main.cjs masks/decrypts,
// key-migrate.cjs filters) with a grep-pin spec as the drift alarm. The
// pin proved the rule mattered but was always a step behind: an edit
// that broke one copy turned a test red AFTER the divergence shipped in
// review. One module, three consumers (main, key-migrate, ai-gateway
// docs/tests) — drift becomes impossible, not just detected.
'use strict'

// API secrets use the full slot shape; configuration values that are not
// credentials (such as AI_BASE_URL and AI_MODEL) are never encrypted.
// The bare `AI_API_KEY` global
// slot MUST match (the surface suffix is optional — this exact subtlety
// is what §206.2 audited in the old inline capture).
// NUXT_HUB_APP_SECRET is the hosted-server hub credential the relay forwards
// server-to-server. It reaches Nitro through `loadUserConfig`, so it sits in
// config.env on disk like any API key — encrypted at rest by the same
// keychain, never a constant evaluated in the build config.
//
// HUB_DEVICE_SECRET is the per-device credential (v2) issued to this install at
// sign-in; the same vault slot family, encrypted at rest and masked on read.
const SECRET_SLOT_RE = /^(AI_API_KEY(_.+)?|TMCUT_GEMINI_API_KEY|NUXT_HUB_APP_SECRET|HUB_DEVICE_SECRET)$/

/** True when a config key is an API-key slot (encrypted at rest, masked
 *  to the renderer, re-encrypted by the migration). */
function isSecretSlot(key) {
  return SECRET_SLOT_RE.test(key)
}

module.exports = { SECRET_SLOT_RE, isSecretSlot }
