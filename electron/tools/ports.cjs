/**
 * Port resolution for the Electron shell (R148).
 *
 * Why this module exists: `main.cjs` used to read the dev renderer port as
 * `Number(process.env.PORT || 4003)`. A host shell commonly exports PORT for
 * unrelated tooling, and a value like "0" (truthy) or " " is NOT falsy, so it
 * survived the || and produced `http://localhost:0` — Electron answered
 * ERR_UNSAFE_PORT and the window stayed on an error page while the Nuxt dev
 * server was happily serving 4003. The same class of bug hits the packaged
 * path through APP_PORT.
 *
 * One rule, one place: only a value that parses to a REAL TCP port wins;
 * anything else falls back to the documented default. `APP_DEV_PORT` is the
 * app-owned override (ambient-immune), PORT stays supported for the existing
 * `.env` workflow that documents `pnpm dev` on 4003.
 */

/** A usable TCP port (integers 1..65535), or null for anything else. */
function parsePort(value) {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null
}

/**
 * Dev renderer port. Prefers the app-owned APP_DEV_PORT, then PORT, then the
 * shared default (4003 — the fleet port allocation the dev script binds to).
 */
function resolveDevPort(env = {}, fallback = 4003) {
  const own = parsePort(env.APP_DEV_PORT)
  if (own !== null) return own
  const ambient = parsePort(env.PORT)
  if (ambient !== null) return ambient
  return fallback
}

module.exports = { parsePort, resolveDevPort }
