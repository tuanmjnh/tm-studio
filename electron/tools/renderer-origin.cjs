'use strict'
// Renderer origin rules — pure, so the Electron entry point and the unit
// specs share one definition.
//
// Why this is security-relevant: WebAuthn rejects an IP address as a relying
// party ID, so a renderer served from http://127.0.0.1:<port> can never run a
// passkey ceremony. The packaged app therefore loads from localhost, which
// Chromium treats as a secure origin and which matches the RP ID the hub
// issues for the browser build. The 127.0.0.1 origin is kept for the one-time
// localStorage/cookie migration and for media:// CORS only.
function resolveOrigins({ isDev, port, devPort }) {
  if (isDev) {
    const primary = `http://localhost:${devPort}`
    return {
      primary,
      legacy: null,
      allowed: [primary, `http://127.0.0.1:${devPort}`]
    }
  }
  const primary = `http://localhost:${port}`
  const legacy = `http://127.0.0.1:${port}`
  return { primary, legacy, allowed: [primary, legacy] }
}

module.exports = { resolveOrigins }
