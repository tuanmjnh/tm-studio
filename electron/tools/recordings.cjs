/**
 * Recording housekeeping (roadmap v1 §4, P2).
 *
 * Voice commands are saved as `command-<epochMs>.<ext>` purely so the speech
 * gateway has a real file to read. They are NOT project assets: once the
 * transcription is in, the file is dead weight.
 *
 * Voiceover takes (`voiceover-<epochMs>.<ext>`) are different — they are
 * imported into the media library and may be in use by a timeline, so this
 * module never touches them.
 *
 * Pure and clock-injected so the retention rule is testable without Electron.
 */

const fs = require('fs')
const path = require('path')

/** Only files this app wrote for a one-shot transcription command. */
const COMMAND_FILE_RE = /^command-(\d{10,})\.(webm|m4a|mp3|wav)$/

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Delete stale command captures in `dir`.
 *
 * @param {string} dir recordings directory (`<userData>/tmcut/recordings`)
 * @param {{ maxAgeMs?: number, now?: number }} [options]
 * @returns {{ removed: number, kept: number, failed: number }}
 */
function pruneCommandRecordings(dir, options = {}) {
  const maxAgeMs = Number.isFinite(options.maxAgeMs) && options.maxAgeMs > 0
    ? options.maxAgeMs
    : DEFAULT_MAX_AGE_MS
  const now = Number.isFinite(options.now) ? options.now : Date.now()

  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    // Missing directory simply means nothing has been recorded yet.
    return { removed: 0, kept: 0, failed: 0 }
  }

  let removed = 0
  let kept = 0
  let failed = 0
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const match = COMMAND_FILE_RE.exec(entry.name)
    if (!match) continue
    const createdAt = Number(match[1])
    if (!Number.isFinite(createdAt) || now - createdAt <= maxAgeMs) {
      kept++
      continue
    }
    try {
      fs.unlinkSync(path.join(dir, entry.name))
      removed++
    } catch {
      failed++
    }
  }
  return { removed, kept, failed }
}

module.exports = { pruneCommandRecordings, COMMAND_FILE_RE, DEFAULT_MAX_AGE_MS }
