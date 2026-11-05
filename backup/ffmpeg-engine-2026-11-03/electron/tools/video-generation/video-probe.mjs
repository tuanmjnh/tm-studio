// =============================================================================
//  TM TOOLS - Shared video probing helper (main process only).
//
//  Wraps ffprobe to extract width/height/duration/fps from a local media file.
//  Resolution order:
//    1. Bundled/configured ffprobe from electron/tools/paths.cjs (TOOLS_FFPROBE_PATH)
//    2. `ffprobe` on PATH (dev convenience)
//  Never uses a shell: the file path is passed as a spawn argument, so paths
//  with spaces or special characters are safe.
// =============================================================================

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

let cachedProbeExe = null

/**
 * Resolve the ffprobe executable path.
 * Falls back to bare "ffprobe" (PATH lookup) when the bundled binary is missing.
 */
export function resolveFfprobePath() {
  if (cachedProbeExe) return cachedProbeExe
  try {
    // paths.cjs requires electron's `app`; only call it lazily and guard it so
    // this module still works in unit tests without an Electron runtime.
    const { getToolsBinaries } = require('../paths.cjs')
    const configured = getToolsBinaries()?.ffprobe
    if (configured && fs.existsSync(configured)) {
      cachedProbeExe = configured
      return cachedProbeExe
    }
  } catch {
    // Not running inside Electron main (tests) — fall through to PATH.
  }
  cachedProbeExe = 'ffprobe'
  return cachedProbeExe
}

/**
 * Parse an ffprobe rational string like "30000/1001" into a number.
 * Returns 0 for malformed or zero-denominator input (never eval).
 */
export function parseRational(value) {
  if (typeof value !== 'string' || !value.trim()) return 0
  const [num, den] = value.split('/')
  const n = Number(num)
  if (!Number.isFinite(n)) return 0
  if (den === undefined) return n
  const d = Number(den)
  if (!Number.isFinite(d) || d === 0) return 0
  return n / d
}

/**
 * Probe a local media file with ffprobe.
 * @param {string} filePath Absolute path to the media file
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ width: number, height: number, durationSec: number, fps: number }>}
 */
export function probeVideo(filePath, options = {}) {
  const { timeoutMs = 15000 } = options
  const absPath = path.resolve(filePath)

  if (!fs.existsSync(absPath)) {
    return Promise.reject(new Error(`probeVideo: file not found: ${absPath}`))
  }

  const exe = resolveFfprobePath()

  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,duration,avg_frame_rate',
      '-show_entries', 'format=duration',
      '-of', 'json',
      absPath
    ]

    let proc
    try {
      proc = spawn(exe, args, { windowsHide: true })
    } catch (err) {
      return reject(new Error(`probeVideo: failed to spawn ffprobe (${exe}): ${err.message}`))
    }

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { proc.kill() } catch { /* already exited */ }
      reject(new Error(`probeVideo: ffprobe timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    proc.stdout.on('data', chunk => { stdout += chunk })
    proc.stderr.on('data', chunk => { stderr += chunk })
    proc.on('error', err => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`probeVideo: ffprobe error (${exe}): ${err.message}`))
    })
    proc.on('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)

      if (code !== 0) {
        return reject(new Error(`probeVideo: ffprobe exited with ${code}: ${stderr.slice(0, 300)}`))
      }

      let json
      try {
        json = JSON.parse(stdout || '{}')
      } catch {
        return reject(new Error('probeVideo: invalid JSON from ffprobe'))
      }

      const stream = Array.isArray(json.streams) ? json.streams[0] : null
      if (!stream) {
        return reject(new Error('probeVideo: no video stream found'))
      }

      const durationSec = parseFloat(stream.duration ?? json.format?.duration ?? '0') || 0
      let fps = parseRational(stream.avg_frame_rate)
      if (!Number.isFinite(fps) || fps <= 0) fps = 30

      resolve({
        width: Number(stream.width) || 0,
        height: Number(stream.height) || 0,
        durationSec,
        fps
      })
    })
  })
}

/**
 * Reset the cached ffprobe path (tests only).
 */
export function _resetProbeCache() {
  cachedProbeExe = null
}

export default { probeVideo, parseRational, resolveFfprobePath }
