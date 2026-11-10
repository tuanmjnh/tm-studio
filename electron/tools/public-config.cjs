'use strict'
// Build-time public config. A packaged build may embed the Hub URL, the app id
// and the Hub PUBLIC JWKs; nothing else qualifies. The allow-list is explicit
// so a later `.env` addition can never leak into the installer by accident, and
// a JWK carrying `d` is refused (a private key is not public config, encrypted
// or not).
//
// Main applies the file as env DEFAULTS after config.env, so a per-user config
// still wins and a fresh install needs no hand configuration.

const fs = require('fs')
const path = require('path')
const { readConfigFile } = require('./config-file.cjs')

const PUBLIC_CONFIG_KEYS = [
  'NUXT_PUBLIC_HUB_URL',
  'NUXT_PUBLIC_HUB_APP_ID',
  'AUTH_JWT_PUBLIC_KEYS'
]
const FILE_NAME = 'public-config.json'

function isPublicJwk(value) {
  if (!value || typeof value !== 'object') return false
  if ('d' in value) return false
  return value.kty === 'RSA'
    && typeof value.n === 'string' && value.n.length > 0
    && typeof value.e === 'string' && value.e.length > 0
    && typeof value.kid === 'string' && value.kid.length > 0
}

function parsePublicKeys(raw, source) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${source}: AUTH_JWT_PUBLIC_KEYS is not valid JSON`)
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isPublicJwk)) {
    throw new Error(`${source}: AUTH_JWT_PUBLIC_KEYS must be a non-empty array of public RSA JWKs (no "d")`)
  }
  return parsed
}

/**
 * Reads the allow-listed keys from the process env (shell wins) or `.env`,
 * validates the key set and writes `resources/public-config.json`.
 */
function bakePublicConfig(options = {}) {
  const projectRoot = options.projectRoot || path.join(__dirname, '..', '..')
  const env = options.env || process.env
  const source = path.join(projectRoot, '.env')
  const fromFile = readConfigFile(source).values

  const values = {}
  for (const key of PUBLIC_CONFIG_KEYS) {
    const raw = String(env[key] || fromFile[key] || '').trim()
    if (raw) values[key] = raw
  }
  if (values.AUTH_JWT_PUBLIC_KEYS) {
    parsePublicKeys(values.AUTH_JWT_PUBLIC_KEYS, source)
  }

  const target = path.join(projectRoot, 'resources', FILE_NAME)
  fs.writeFileSync(target, `${JSON.stringify(values, null, 2)}\n`, 'utf8')
  return { path: target, keys: Object.keys(values) }
}

/** Applies baked public values as defaults: a real env/config.env value wins. */
function applyPublicConfig(file, env = process.env) {
  let values
  try {
    values = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return []
  }
  const applied = []
  for (const key of PUBLIC_CONFIG_KEYS) {
    const value = typeof values[key] === 'string' ? values[key].trim() : ''
    if (!value) continue
    if (!env[key]) {
      env[key] = value
      applied.push(key)
    }
  }
  return applied
}

module.exports = { bakePublicConfig, applyPublicConfig, PUBLIC_CONFIG_KEYS, FILE_NAME }

if (require.main === module) {
  const result = bakePublicConfig()
  // Names only: the values are public, but there is no reason to echo a full
  // key set into a build log.
  console.log(`[bake-public-config] wrote ${result.keys.join(', ') || '(empty)'} to ${result.path}`)
}
