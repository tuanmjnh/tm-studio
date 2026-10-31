const { ipcMain, app } = require('electron')
const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const { spawn } = require('child_process')
const { getToolsBinaries, getResourcesDir } = require('./paths.cjs')
const { pruneCommandRecordings } = require('./recordings.cjs')
const { assertDownloadUrl, resolveDownloadTarget } = require('./media-download.cjs')
const { fetchStockJson } = require('./stock-proxy.cjs')
const { sceneDetectionArgs, silenceDetectionArgs } = require('../../shared/utils/detection-args.cjs')
const { randomUUID } = require('node:crypto')
const {
  DEFAULT_VIENEU_BASE_URL,
  MAX_VOICE_REFERENCE_BYTES,
  MAX_TTS_TEXT_LENGTH,
  MAX_TTS_AUDIO_BYTES,
  normalizeVieNeuBaseUrl,
  parseVieNeuVoices,
  validateSynthesisInput,
  getServiceError
} = require('./tmcut-voice.cjs')

const moduleName = 'tmcut'

function getDirs() {
  const base = path.join(app.getPath('userData'), 'tmcut')
  return {
    base,
    projects: path.join(base, 'projects'),
    snapshots: path.join(base, 'projects', 'snapshots'),
    assetsFile: path.join(base, 'assets.json'),
    cache: path.join(base, 'cache'),
    thumbs: path.join(base, 'cache', 'thumbnails'),
    waveforms: path.join(base, 'cache', 'waveforms'),
    frames: path.join(base, 'cache', 'frames'),
    proxies: path.join(base, 'cache', 'proxies'),
    stabilized: path.join(base, 'cache', 'stabilized'),
    stabilizedTrf: path.join(base, 'cache', 'stabilized_trf'),
    recordings: path.join(base, 'recordings'),
    downloads: path.join(base, 'downloads'),
    voices: path.join(base, 'voices')
  }
}

/**
 * Structural validation for USER-SELECTED media paths (import dialog,
 * Explorer drag-and-drop, relink). These files legitimately live anywhere
 * on the user's disks, so a root whitelist cannot apply — the old
 * whitelist here (userData + resources only) silently rejected every
 * real import: analyzeAsset -> ok:false -> asset 'missing' -> the amber
 * "unreadable media" banner on every dropped file (R110).
 *
 * Every operation behind this guard is a read-only probe/thumbnail/
 * waveform/proxy pass or a stat on a file the user explicitly added;
 * internal app files (project JSON, snapshots, cache) are keyed through
 * sanitizeId() instead and never route here. Reject empty, non-absolute
 * or unparsable paths. Forward slashes from normalizeMediaPath() are
 * fine — path.resolve() canonicalizes them.
 */
function isUserMediaPath(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) return null
  const trimmed = filePath.trim()
  if (!path.isAbsolute(trimmed)) return null
  try {
    return path.resolve(trimmed)
  } catch {
    return null
  }
}

function ensureDirs() {
  const d = getDirs()
  for (const p of [d.base, d.projects, d.snapshots, d.cache, d.thumbs, d.waveforms, d.frames, d.proxies, d.stabilized, d.stabilizedTrf, d.recordings, d.downloads, d.voices]) {
    try {
      fs.mkdirSync(p, { recursive: true })
    } catch {
      // ignore
    }
  }
}

function sanitizeId(id) {
  const clean = String(id || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
  return clean || 'default'
}

function projectFile(id) {
  return path.join(getDirs().projects, `${sanitizeId(id)}.tmcut.json`)
}

function recoveryFile(id) {
  return path.join(getDirs().projects, `${sanitizeId(id)}.recovery.json`)
}

function snapshotFile(id, ts) {
  return path.join(getDirs().snapshots, `${sanitizeId(id)}-${ts}.json`)
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

// System font enumeration (roadmap C-1): resources/fontmanager.node is the
// font-scanner Node-API addon (ABI-stable — verified loading under
// Electron 43 / Node 24), and it returns each face WITH its file path, so
// the renderer picker previews a family while drawtext exports the very
// same file. Loaded lazily and cached for the session (one scan, ~50ms;
// only changes when fonts are installed). A missing/corrupt addon yields
// [] — the picker then stays hidden instead of listing faces it cannot
// resolve (honesty rule: no dead or lying controls).
let fontScanner = null
let systemFontsCache = null

function listSystemFonts() {
  if (systemFontsCache) return systemFontsCache
  if (fontScanner === null) {
    try {
      fontScanner = require(path.join(getResourcesDir(), 'fontmanager.node'))
    } catch (error) {
      console.error('fontmanager.node failed to load:', error.message)
      fontScanner = false
    }
  }
  if (!fontScanner) return []
  try {
    const faces = fontScanner.getAvailableFontsSync()
    systemFontsCache = (Array.isArray(faces) ? faces : [])
      .filter(f => f && typeof f.family === 'string' && typeof f.path === 'string' && f.family && f.path)
      .map(f => ({
        family: f.family,
        path: f.path,
        style: typeof f.style === 'string' && f.style ? f.style : 'Regular',
        weight: Number(f.weight) || 400,
        italic: !!f.italic,
        monospace: !!f.monospace
      }))
  } catch (error) {
    console.error('System font scan failed:', error.message)
    systemFontsCache = []
  }
  return systemFontsCache
}

function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, filePath)
}

function getFileStat(filePath) {
  try {
    const st = fs.statSync(filePath)
    return { exists: st.isFile(), size: st.size, mtimeMs: st.mtimeMs }
  } catch {
    return { exists: false, size: 0, mtimeMs: 0 }
  }
}

function toPosix(p) {
  return String(p || '').replace(/\\/g, '/')
}

function fnv1aHex(text) {
  const input = String(text || '')
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// Portable cache key (mirror of @tmcut/core src/cache.mjs — keep in sync).
// Replaces the old sha1 scheme so Electron and future Web runtimes share
// one layout (docs sections 27-28). Stale sha1-named files are simply
// orphaned cache and regenerate on demand. The `v2:` prefix marks the
// filmstrip thumbnail format (8 frames) — bump to regenerate old stills.
function cacheKeyFor(filePath, stat) {
  const raw = `v2:${toPosix(filePath).toLowerCase()}:${stat.mtimeMs}:${stat.size}`
  return fnv1aHex(raw)
}

function runFfmpeg(args, timeoutMs) {
  return new Promise((resolve) => {
    let child
    try {
      const exe = getToolsBinaries().ffmpeg
      // maxBuffer: 10 MB per stream to prevent OOM on malicious/huge output
      child = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024 })
    } catch (err) {
      return resolve({ ok: false, error: String((err && err.message) || err), stdout: null, stderr: '' })
    }
    let stdout = null
    let chunk = Buffer.alloc(0)
    let stderr = ''
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // ignore
      }
    }, timeoutMs)
    child.stdout.on('data', (data) => {
      chunk = Buffer.concat([chunk, data])
    })
    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, error: err.message, stdout: null, stderr })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      stdout = chunk
      resolve({ ok: code === 0, error: code === 0 ? null : stderr.slice(-500), stdout, stderr: stderr.slice(-500), code })
    })
  })
}

function probeDuration(filePath) {
  return new Promise((resolve) => {
    try {
      const exe = getToolsBinaries().ffprobe
      const child = spawn(exe, [
        '-v', 'quiet',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath
      ])
      let out = ''
      child.stdout.on('data', (data) => {
        out += data.toString()
      })
      child.on('close', () => {
        const value = parseFloat(out.trim())
        resolve(Number.isFinite(value) && value > 0 ? value : 0)
      })
      child.on('error', () => resolve(0))
    } catch {
      resolve(0)
    }
  })
}

// Session duration cache keyed by (path, mtime, size): frame batches
// probe the same file once per job otherwise (timeline filmstrips ask
// for dozens of seeks on one source). Negative results are not cached.
const durationCache = new Map()

function probeDurationCached(filePath, stat) {
  const key = `${filePath}|${stat.mtimeMs}|${stat.size}`
  const hit = durationCache.get(key)
  if (hit !== undefined) return hit
  return probeDuration(filePath).then((value) => {
    if (value > 0) durationCache.set(key, value)
    return value
  })
}

// Roadmap C-3: Whisper transcription needs an AUDIO input (provider
// endpoints take audio containers). One-shot 16kHz mono MP3 into the
// cache dir, keyed like thumbnails — re-captioning the same source
// version reuses the file and skips extraction entirely.
async function extractCaptionAudio(filePath) {
  const stat = getFileStat(filePath)
  if (!stat.exists) return { ok: false, error: 'File not found' }
  ensureDirs()
  const key = cacheKeyFor(filePath, stat)
  const out = path.join(getDirs().cache, `caption-${key}.mp3`)
  if (getFileStat(out).exists) return { ok: true, path: out }
  // 16kHz mono matches Whisper's native rate — no wasted bandwidth.
  const result = await runFfmpeg(['-y', '-i', filePath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', out], 120_000)
  if (!result.ok || !getFileStat(out).exists) return { ok: false, error: result.error || 'Audio extraction failed' }
  return { ok: true, path: out }
}

async function extractThumbnail(filePath) {
  ensureDirs()
  const stat = getFileStat(filePath)
  if (!stat.exists) return { ok: false, error: 'File not found' }
  const key = cacheKeyFor(filePath, stat)
  // Two artifacts per video: a single-frame COVER
  // for the media-library grid and an 8-frame
  // FILMSTRIP for timeline clips. Separate files
  // keep the library thumb a plain image instead
  // of a cropped filmstrip (the earlier scheme
  // reused one filmstrip file for both, which
  // showed all 8 stitched frames in the grid).
  const coverOut = path.join(getDirs().thumbs, `${key}-cover.png`)
  const stripOut = path.join(getDirs().thumbs, `${key}-strip.png`)
  if (fs.existsSync(coverOut) && fs.existsSync(stripOut)) {
    return { ok: true, cachePath: toPosix(coverOut), filmstripPath: toPosix(stripOut) }
  }
  const duration = await probeDuration(filePath)
  const frameCount = 8
  let args
  if (duration > 0) {
    // One decode, two outputs: the cover still
    // (seeked to skip black intro frames) and
    // the filmstrip spread evenly across the
    // whole source duration.
    const seek = Math.min(0.5, duration * 0.25)
    const fps = (frameCount / duration).toFixed(5)
    args = [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-ss', String(seek),
      '-i', filePath,
      '-map', '0:v:0',
      '-frames:v', '1',
      '-vf', 'scale=320:-2',
      '-q:v', '5',
      coverOut,
      '-map', '0:v:0',
      '-frames:v', '1',
      '-vf', `fps=${fps},scale=160:-2,tile=${frameCount}x1`,
      '-q:v', '5',
      stripOut
    ]
  } else {
    // Duration unknown: cover + a single-frame
    // strip, so the cache layout is always
    // complete (the timeline tiles it, same as
    // web session assets).
    args = [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-ss', '0.5',
      '-i', filePath,
      '-map', '0:v:0',
      '-frames:v', '1',
      '-vf', 'scale=320:-2',
      '-q:v', '5',
      coverOut,
      '-map', '0:v:0',
      '-frames:v', '1',
      '-vf', 'scale=160:-2',
      '-q:v', '5',
      stripOut
    ]
  }
  const res = await runFfmpeg(args, 60 * 1000)
  if (!res.ok || !fs.existsSync(coverOut)) {
    return { ok: false, error: res.error || 'Thumbnail extraction failed' }
  }
  return {
    ok: true,
    cachePath: toPosix(coverOut),
    filmstripPath: fs.existsSync(stripOut) ? toPosix(stripOut) : null
  }
}

// Cap for timestamps when the duration cannot be probed (roadmap G-1).
const MAX_FRAME_TIME_SEC = 24 * 3600

// Single-frame extractor (roadmap G-1, core C14 plans the timestamps):
// seeks to `atSec` and returns a small PNG in the frames cache, keyed per
// (path, mtime, size, time, width) so the same seek never decodes twice.
// The timestamp is limited: finite, >= 0 and inside the media when the
// duration is known (otherwise capped at MAX_FRAME_TIME_SEC).
async function extractFrameAt(filePath, atSec, width) {
  ensureDirs()
  const stat = getFileStat(filePath)
  if (!stat.exists) return { ok: false, error: 'File not found' }
  const wanted = Number(atSec)
  if (!Number.isFinite(wanted) || wanted < 0) return { ok: false, error: 'Invalid timestamp' }
  const px = Math.min(1280, Math.max(16, Math.round(Number(width) || 320)))
  const key = `${cacheKeyFor(filePath, stat)}-f${Math.round(wanted * 1000)}-w${px}`
  const out = path.join(getDirs().frames, `${key}.png`)
  if (fs.existsSync(out)) return { ok: true, path: toPosix(out), cached: true }
  const duration = await probeDurationCached(filePath, stat)
  const at = duration > 0
    ? Math.min(wanted, Math.max(0, duration - 0.05))
    : Math.min(wanted, MAX_FRAME_TIME_SEC)
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-ss', String(at),
    '-i', filePath,
    '-map', '0:v:0',
    '-frames:v', '1',
    '-vf', `scale=${px}:-2`,
    out
  ]
  const res = await runFfmpeg(args, 30 * 1000)
  if (!res.ok || !fs.existsSync(out)) {
    return { ok: false, error: res.error || 'Frame extraction failed' }
  }
  return { ok: true, path: toPosix(out), cached: false }
}

async function extractWaveform(filePath, buckets = 200) {
  ensureDirs()
  const stat = getFileStat(filePath)
  if (!stat.exists) return { ok: false, error: 'File not found' }
  const bucketCount = Math.max(16, Math.min(2000, Math.floor(buckets) || 200))
  const key = cacheKeyFor(filePath, stat)
  const out = path.join(getDirs().waveforms, `${key}.json`)
  if (fs.existsSync(out)) {
    const cached = readJsonSafe(out)
    if (cached && Array.isArray(cached.buckets)) {
      return {
        ok: true,
        cachePath: toPosix(out),
        buckets: cached.buckets,
        durationSec: Number(cached.durationSec) || 0
      }
    }
  }

  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', filePath,
    '-vn', '-ac', '1', '-ar', '8000',
    '-f', 's16le', 'pipe:1'
  ]
  const res = await runFfmpeg(args, 5 * 60 * 1000)

  if (!res.ok || !res.stdout || res.stdout.length < 2) {
    const duration = await probeDuration(filePath)
    const flat = new Array(bucketCount).fill(0)
    writeJsonAtomic(out, { buckets: flat, durationSec: duration })
    return { ok: true, cachePath: toPosix(out), buckets: flat, durationSec: duration }
  }

  const sampleCount = Math.floor(res.stdout.length / 2)
  const peaks = new Array(bucketCount).fill(0)
  if (sampleCount > 0) {
    const per = sampleCount / bucketCount
    for (let b = 0; b < bucketCount; b++) {
      const start = Math.floor(b * per)
      const end = Math.min(sampleCount, Math.floor((b + 1) * per))
      let max = 0
      for (let i = start; i < end; i++) {
        const v = Math.abs(res.stdout.readInt16LE(i * 2))
        if (v > max) max = v
      }
      peaks[b] = Math.min(1, max / 32768)
    }
  }
  const durationSec = sampleCount / 8000
  writeJsonAtomic(out, { buckets: peaks, durationSec })
  return { ok: true, cachePath: toPosix(out), buckets: peaks, durationSec }
}

// Full ffprobe JSON (format + streams). Raw output only — normalization
// stays in @tmcut/core (normalizeProbe) per the runtime-adapter rule.
function probeMediaJson(filePath) {
  return new Promise((resolve) => {
    let child = null
    try {
      const exe = getToolsBinaries().ffprobe
      // maxBuffer: 10 MB to prevent OOM
      child = spawn(exe, [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath
      ], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024 })
    } catch {
      resolve(null)
      return
    }
    let out = ''
    let exited = false
    const timer = setTimeout(() => {
      if (child && !exited) {
        exited = true
        child.kill()
        resolve(null)
      }
    }, 60 * 1000)
    child.stdout.on('data', (data) => {
      out += data.toString()
    })
    child.on('error', () => {
      if (exited) return
      exited = true
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', (code) => {
      if (exited) return
      exited = true
      clearTimeout(timer)
      if (code !== 0) {
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(out))
      } catch {
        resolve(null)
      }
    })
  })
}

// Run ffmpeg and capture stderr text (scene/silence detectors log there).
// Returns { code, log }. Parsing stays in @tmcut/core (analysis module).
function runFfmpegLog(args, timeoutMs) {
  return new Promise((resolve) => {
    let child = null
    try {
      const exe = getToolsBinaries().ffmpeg
      // maxBuffer: 10 MB to prevent OOM on malicious/huge stderr output
      child = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024 })
    } catch {
      resolve({ code: -1, log: '' })
      return
    }
    let log = ''
    let exited = false
    const timer = setTimeout(() => {
      if (child && !exited) {
        exited = true
        child.kill()
        resolve({ code: -1, log })
      }
    }, timeoutMs)
    child.stderr.on('data', (data) => {
      log += data.toString()
    })
    child.on('error', () => {
      if (exited) return
      exited = true
      clearTimeout(timer)
      resolve({ code: -1, log })
    })
    child.on('close', (code) => {
      if (exited) return
      exited = true
      clearTimeout(timer)
      resolve({ code: code === null ? -1 : code, log })
    })
  })
}

// Shot detection: lavfi scene filter + showinfo. Returns raw log +
// duration; the renderer parses cuts via core parseSceneOutput.
async function analyzeScenes(filePath, threshold) {
  const stat = getFileStat(filePath)
  if (!stat.exists) return { ok: false, error: 'File not found' }
  const probe = await probeMediaJson(filePath)
  const durationSec = probe && probe.format ? Number(probe.format.duration) || 0 : await probeDuration(filePath)
  const { code, log } = await runFfmpegLog(sceneDetectionArgs(filePath, threshold), 10 * 60 * 1000)
  if (code !== 0) return { ok: false, error: 'Scene detection failed' }
  return { ok: true, log, durationSec }
}

// Silence detection for speech/silence segmentation (podcast/vlog).
async function analyzeSilence(filePath, noiseDb, minDuration) {
  const stat = getFileStat(filePath)
  if (!stat.exists) return { ok: false, error: 'File not found' }
  const probe = await probeMediaJson(filePath)
  const durationSec = probe && probe.format ? Number(probe.format.duration) || 0 : await probeDuration(filePath)
  const { code, log } = await runFfmpegLog(silenceDetectionArgs(filePath, noiseDb, minDuration), 10 * 60 * 1000)
  if (code !== 0) return { ok: false, error: 'Silence detection failed' }
  return { ok: true, log, durationSec }
}

// Single-call media analysis pipeline (Phase 3 ElectronMediaRuntime):
// stat + probe + thumbnail/waveform in one IPC round-trip. The renderer
// normalizes `probe` with core normalizeProbe and persists the record.
async function analyzeAsset(filePath, kind) {
  const stat = getFileStat(filePath)
  if (!stat.exists) return { ok: false, error: 'File not found' }
  const result = {
    ok: true,
    stat: { size: stat.size, mtimeMs: stat.mtimeMs },
    probe: null,
    thumbCachePath: null,
    filmstripCachePath: null,
    waveCachePath: null
  }
  if (kind === 'image') return result
  try {
    result.probe = await probeMediaJson(filePath)
  } catch {
    result.probe = null
  }
  if (kind === 'video') {
    const thumb = await extractThumbnail(filePath)
    if (thumb && thumb.ok && thumb.cachePath) {
      result.thumbCachePath = thumb.cachePath
      result.filmstripCachePath = thumb.filmstripPath || null
    }
  } else if (kind === 'audio') {
    const wave = await extractWaveform(filePath, 200)
    if (wave && wave.ok && wave.cachePath) result.waveCachePath = wave.cachePath
  }
  // Audio-only containers mislabeled by extension (a .webm with no video
  // stream is the common one): the declared kind is wrong, so the probe's
  // OWN streams decide what to extract. Without this the asset gets
  // neither a thumbnail (ffmpeg finds no frame) nor a waveform.
  const streams = Array.isArray(result.probe?.streams) ? result.probe.streams : []
  const probedVideo = streams.some(stream => stream?.codec_type === 'video')
  const probedAudio = streams.some(stream => stream?.codec_type === 'audio')
  if (!result.thumbCachePath && !result.waveCachePath && !probedVideo && probedAudio) {
    const wave = await extractWaveform(filePath, 200)
    if (wave && wave.ok && wave.cachePath) result.waveCachePath = wave.cachePath
  }
  return result
}

function listProjectFiles() {
  ensureDirs()
  const dir = getDirs().projects
  let entries
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return []
  }
  const items = []
  for (const file of entries) {
    if (!file.endsWith('.tmcut.json')) continue
    const full = path.join(dir, file)
    const stat = getFileStat(full)
    const data = readJsonSafe(full)
    items.push({
      id: file.replace(/\.tmcut\.json$/, ''),
      name: (data && data.name) || 'Untitled Project',
      updatedAt: (data && data.updated_at) || new Date(stat.mtimeMs || Date.now()).toISOString(),
      size: stat.size
    })
  }
  items.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  return items
}

function listSnapshots(id) {
  ensureDirs()
  const dir = getDirs().snapshots
  let entries
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return []
  }
  const prefix = `${sanitizeId(id)}-`
  const items = []
  for (const file of entries) {
    if (!file.startsWith(prefix) || !file.endsWith('.json')) continue
    const full = path.join(dir, file)
    const data = readJsonSafe(full)
    const ts = Number(file.slice(prefix.length, -5)) || 0
    items.push({
      ts,
      name: (data && data.name) || `Snapshot ${new Date(ts).toLocaleString()}`,
      updatedAt: (data && data.updated_at) || new Date(ts).toISOString()
    })
  }
  items.sort((a, b) => b.ts - a.ts)
  return items
}

// Lightweight preview proxy generator (Roadmap F-4):
// Converts heavy 4K / camera footage to 540p/720p H.264 + AAC in the proxies cache,
// keyed per (path, mtime, size, width). Cached copies return instantly.
async function generateProxy(filePath, width = 960) {
  ensureDirs()
  const stat = getFileStat(filePath)
  if (!stat.exists) return { ok: false, error: 'File not found' }
  const targetWidth = Math.max(320, Math.min(1920, Math.floor(Number(width) || 960)))
  const key = `${cacheKeyFor(filePath, stat)}-w${targetWidth}`
  const out = path.join(getDirs().proxies, `proxy-${key}.mp4`)
  if (getFileStat(out).exists) {
    return { ok: true, path: toPosix(out), cached: true }
  }
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    filePath,
    '-vf',
    `scale=${targetWidth}:-2`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '28',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    out
  ]
  const res = await runFfmpeg(args, 15 * 60 * 1000)
  if (!res.ok || !getFileStat(out).exists) {
    return { ok: false, error: res.error || 'Proxy generation failed' }
  }
  return { ok: true, path: toPosix(out), cached: false }
}

const STABILIZE_PRESETS = {
  mild: { smoothing: 10, shakiness: 4, accuracy: 10, stepsize: 6, zoom: 0 },
  medium: { smoothing: 20, shakiness: 6, accuracy: 15, stepsize: 6, zoom: 0 },
  aggressive: { smoothing: 35, shakiness: 8, accuracy: 15, stepsize: 4, zoom: 0 }
}

function escapeFilterPath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').replace(/:/g, '\\:')
}

// 2-pass video stabilization (Roadmap E-5):
// Pass 1: vidstabdetect extracts camera motion vectors into a .trf file in cache/stabilized_trf
// Pass 2: vidstabtransform applies smoothing to produce a stable .mp4 in cache/stabilized
async function stabilizeVideo(filePath, options = {}) {
  ensureDirs()
  const stat = getFileStat(filePath)
  if (!stat.exists) return { ok: false, error: 'File not found' }
  const level = options.level && STABILIZE_PRESETS[options.level] ? options.level : 'medium'
  const preset = STABILIZE_PRESETS[level]
  const key = `${cacheKeyFor(filePath, stat)}-${level}`
  const out = path.join(getDirs().stabilized, `stab-${key}.mp4`)
  if (getFileStat(out).exists) {
    return { ok: true, path: toPosix(out), cached: true }
  }
  const trf = path.join(getDirs().stabilizedTrf, `trf-${key}.trf`)
  const escapedTrf = escapeFilterPath(trf)

  // Pass 1: vidstabdetect
  const detectArgs = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    filePath,
    '-vf',
    `vidstabdetect=stepsize=${preset.stepsize}:shakiness=${preset.shakiness}:accuracy=${preset.accuracy}:result='${escapedTrf}'`,
    '-f',
    'null',
    '-'
  ]
  const res1 = await runFfmpeg(detectArgs, 15 * 60 * 1000)
  if (!res1.ok || !getFileStat(trf).exists) {
    return { ok: false, error: res1.error || 'Stabilization Pass 1 (detection) failed' }
  }

  // Pass 2: vidstabtransform
  const transformArgs = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    filePath,
    '-vf',
    `vidstabtransform=input='${escapedTrf}':smoothing=${preset.smoothing}:optalgo=gauss:zoom=${preset.zoom}`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-c:a',
    'copy',
    out
  ]
  const res2 = await runFfmpeg(transformArgs, 15 * 60 * 1000)

  // Cleanup temporary .trf file
  try {
    if (fs.existsSync(trf)) fs.unlinkSync(trf)
  } catch {
    // ignore
  }

  if (!res2.ok || !getFileStat(out).exists) {
    return { ok: false, error: res2.error || 'Stabilization Pass 2 (transform) failed' }
  }
  return { ok: true, path: toPosix(out), cached: false }
}

/**
 * Generated media can arrive as a URL (a provider's download link). The
 * renderer cannot turn that into a file — a blob: import would be persisted
 * with a URL that dies on restart — so the download happens here, into
 * <base>/downloads/, and the renderer imports the resulting path through the
 * normal media pipeline (probe, thumbnail, filmstrip, waveform).
 *
 * Rules: http(s) only, manual redirects (max MAX_DOWNLOAD_REDIRECTS), a hard
 * size cap, a timeout, no overwriting an existing file, and a `.part` file that
 * is removed on any failure.
 */
const MAX_DOWNLOAD_REDIRECTS = 5
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000

function openDownloadStream(targetUrl, redirectsLeft, signal) {
  return new Promise((resolve, reject) => {
    const lib = targetUrl.startsWith('https:') ? https : http
    const request = lib.get(targetUrl, {
      headers: { 'user-agent': 'TM-Tools', 'accept': 'video/*,audio/*,image/*,*/*' }
    }, (res) => {
      const status = res.statusCode || 0
      const location = res.headers.location
      if (status >= 300 && status < 400 && location && redirectsLeft > 0) {
        res.resume()
        let next
        try {
          next = new URL(location, targetUrl).toString()
        } catch (error) {
          reject(new Error(`bad redirect: ${error.message}`))
          return
        }
        openDownloadStream(next, redirectsLeft - 1, signal).then(resolve, reject)
        return
      }
      if (status < 200 || status >= 300) {
        res.resume()
        reject(new Error(`HTTP ${status}`))
        return
      }
      resolve(res)
    })
    request.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
      request.destroy(new Error('download timed out'))
    })
    request.on('error', reject)
    if (signal) {
      if (signal.aborted) {
        request.destroy(new Error('cancelled'))
      } else {
        signal.addEventListener('abort', () => request.destroy(new Error('cancelled')), { once: true })
      }
    }
  })
}

/** Active downloads by id, so the renderer can cancel one in flight. */
const activeDownloads = new Map()

function cancelMediaDownload(id) {
  const entry = activeDownloads.get(String(id || ''))
  if (!entry) return false
  try {
    entry.controller.abort()
  } catch {
    // the promise settles as cancelled either way
  }
  return true
}

async function downloadMediaToFile({ url, filename, dir, id, onProgress }) {
  const checked = assertDownloadUrl(url)
  if (!checked.ok) return { ok: false, error: checked.reason }

  const downloadId = id ? String(id) : null
  const controller = new AbortController()
  if (downloadId) activeDownloads.set(downloadId, { controller })

  let res
  try {
    if (dir) fs.mkdirSync(dir, { recursive: true })
    else ensureDirs()
    res = await openDownloadStream(checked.url, MAX_DOWNLOAD_REDIRECTS, controller.signal)
  } catch (error) {
    if (downloadId) activeDownloads.delete(downloadId)
    const message = String((error && error.message) || error)
    return { ok: false, error: controller.signal.aborted ? 'cancelled' : message }
  }

  const declared = Number(res.headers['content-length']) || 0
  if (declared > MAX_DOWNLOAD_BYTES) {
    res.destroy()
    if (downloadId) activeDownloads.delete(downloadId)
    return { ok: false, error: 'file too large' }
  }

  const target = resolveDownloadTarget({
    dir: dir || getDirs().downloads,
    url: checked.url,
    filename,
    exists: candidate => fs.existsSync(candidate)
  })
  const partPath = `${target.path}.part`

  return await new Promise((resolve) => {
    const out = fs.createWriteStream(partPath)
    let bytes = 0
    let settled = false
    let lastProgressAt = 0

    const emitProgress = (force = false) => {
      if (typeof onProgress !== 'function') return
      const now = Date.now()
      // 200ms throttle: IPC per chunk would drown the renderer on a fast link.
      if (!force && now - lastProgressAt < 200) return
      lastProgressAt = now
      onProgress({ loaded: bytes, total: declared })
    }
    emitProgress(true)

    const cleanup = () => {
      try {
        if (fs.existsSync(partPath)) fs.unlinkSync(partPath)
      } catch {
        // best effort: an orphan .part is never referenced anywhere
      }
    }
    const fail = (error) => {
      if (settled) return
      settled = true
      if (downloadId) activeDownloads.delete(downloadId)
      res.destroy()
      out.destroy()
      cleanup()
      resolve({ ok: false, error })
    }

    controller.signal.addEventListener('abort', () => fail('cancelled'), { once: true })

    res.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > MAX_DOWNLOAD_BYTES) {
        fail('file too large')
        return
      }
      emitProgress()
    })
    res.on('error', error => fail(String((error && error.message) || error)))
    out.on('error', error => fail(String((error && error.message) || error)))
    res.pipe(out)
    out.on('finish', () => {
      if (settled) return
      if (bytes === 0) {
        fail('empty response')
        return
      }
      try {
        fs.renameSync(partPath, target.path)
      } catch (error) {
        fail(String((error && error.message) || error))
        return
      }
      settled = true
      if (downloadId) activeDownloads.delete(downloadId)
      if (typeof onProgress === 'function') onProgress({ loaded: bytes, total: declared || bytes, done: true })
      resolve({ ok: true, path: target.path, name: target.name, bytes })
    })
  })
}

function registerTmcutController() {
  // Voice-command captures are transcription scratch space: sweep yesterday's
  // leftovers on startup (voiceover takes are never touched).
  try {
    ensureDirs()
    const pruned = pruneCommandRecordings(getDirs().recordings)
    if (pruned.removed > 0) {
      console.log(`[tmcut] pruned ${pruned.removed} stale command recording(s)`)
    }
  } catch {
    // Housekeeping must never block the editor from opening.
  }

  ipcMain.handle(`${moduleName}:getPaths`, () => {
    ensureDirs()
    const d = getDirs()
  return {
    base: toPosix(d.base),
    projects: toPosix(d.projects),
      snapshots: toPosix(d.snapshots),
      assetsFile: toPosix(d.assetsFile),
      cache: toPosix(d.cache),
      thumbs: toPosix(d.thumbs),
      waveforms: toPosix(d.waveforms),
      proxies: toPosix(d.proxies)
    }
  })

  ipcMain.handle(`${moduleName}:readAssetsFile`, () => readJsonSafe(getDirs().assetsFile))

  ipcMain.handle(`${moduleName}:writeAssetsFile`, (_event, data) => {
    ensureDirs()
    try {
      writeJsonAtomic(getDirs().assetsFile, data || [])
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle(`${moduleName}:readProject`, (_event, id) => readJsonSafe(projectFile(id)))

  ipcMain.handle(`${moduleName}:writeProject`, (_event, { id, data }) => {
    ensureDirs()
    try {
      writeJsonAtomic(projectFile(id), data)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle(`${moduleName}:listProjectFiles`, () => listProjectFiles())

  ipcMain.handle(`${moduleName}:readProjectMeta`, (_event, id) => {
    const projStat = getFileStat(projectFile(id))
    const recStat = getFileStat(recoveryFile(id))
    let recoveryUpdatedAt = null
    if (recStat.exists) {
      const data = readJsonSafe(recoveryFile(id))
      if (data && data.updated_at) {
        recoveryUpdatedAt = Date.parse(data.updated_at)
        if (Number.isNaN(recoveryUpdatedAt)) recoveryUpdatedAt = null
      }
    }
    return {
      hasProject: projStat.exists,
      projectMtimeMs: projStat.mtimeMs,
      hasRecovery: recStat.exists,
      recoveryUpdatedAtMs: recoveryUpdatedAt
    }
  })

  ipcMain.handle(`${moduleName}:writeRecovery`, (_event, { id, data }) => {
    ensureDirs()
    try {
      writeJsonAtomic(recoveryFile(id), data)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle(`${moduleName}:readRecovery`, (_event, id) => readJsonSafe(recoveryFile(id)))

  ipcMain.handle(`${moduleName}:deleteRecovery`, (_event, id) => {
    try {
      if (fs.existsSync(recoveryFile(id))) fs.unlinkSync(recoveryFile(id))
    } catch {
      // ignore
    }
    return true
  })

  ipcMain.handle(`${moduleName}:deleteProject`, (_event, id) => {
    for (const p of [projectFile(id), recoveryFile(id)]) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p)
      } catch {
        // ignore
      }
    }
    const dir = getDirs().snapshots
    const prefix = `${sanitizeId(id)}-`
    try {
      for (const file of fs.readdirSync(dir)) {
        if (file.startsWith(prefix) && file.endsWith('.json')) {
          try {
            fs.unlinkSync(path.join(dir, file))
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
    return true
  })

  ipcMain.handle(`${moduleName}:listSnapshots`, (_event, id) => listSnapshots(id))

  ipcMain.handle(`${moduleName}:saveSnapshot`, (_event, { id, data, name }) => {
    ensureDirs()
    const ts = Date.now()
    try {
      const payload = data && typeof data === 'object' ? { ...data, name: name || data.name } : {}
      writeJsonAtomic(snapshotFile(id, ts), payload)
      return {
        ts,
        name: payload.name || `Snapshot ${new Date(ts).toLocaleString()}`,
        updatedAt: (payload.updated_at) || new Date(ts).toISOString()
      }
    } catch {
      return null
    }
  })

  ipcMain.handle(`${moduleName}:readSnapshot`, (_event, { id, ts }) => readJsonSafe(snapshotFile(id, Math.floor(Number(ts) || 0))))

  ipcMain.handle(`${moduleName}:deleteSnapshot`, (_event, { id, ts }) => {
    try {
      const p = snapshotFile(id, Math.floor(Number(ts) || 0))
      if (fs.existsSync(p)) fs.unlinkSync(p)
    } catch {
      // ignore
    }
    return true
  })

  ipcMain.handle(`${moduleName}:statFiles`, (_event, paths) => {
    const result = {}
    if (!Array.isArray(paths)) return result
    for (const p of paths.slice(0, 500)) {
      const safePath = isUserMediaPath(p)
      if (safePath) {
        result[p] = getFileStat(safePath)
      }
    }
    return result
  })

  ipcMain.handle(`${moduleName}:extractThumbnail`, async (_event, { filePath }) => {
    if (typeof filePath !== 'string' || !filePath) return { ok: false, error: 'Invalid path' }
    return extractThumbnail(filePath)
  })

  ipcMain.handle(`${moduleName}:extractFrame`, async (_event, { src, atSec, width }) => {
    const safePath = isUserMediaPath(src)
    if (!safePath) return { ok: false, error: 'Invalid path' }
    return extractFrameAt(safePath, atSec, width)
  })

  ipcMain.handle(`${moduleName}:extractAudio`, async (_event, { filePath }) => {
    const safePath = isUserMediaPath(filePath)
    if (!safePath) return { ok: false, error: 'Invalid path' }
    return extractCaptionAudio(safePath)
  })

  ipcMain.handle(`${moduleName}:voiceStatus`, async (_event, args = {}) => {
    try {
      const baseUrl = normalizeVieNeuBaseUrl(args.baseUrl || DEFAULT_VIENEU_BASE_URL)
      const response = await fetchVieNeu(baseUrl, '/health')
      if (!response.ok) return { ok: false, error: getServiceError(response.status, await response.text()) }
      let health = null
      try { health = await response.json() } catch { health = null }
      const voicesResponse = await fetchVieNeu(baseUrl, '/v1/voices')
      if (!voicesResponse.ok) return { ok: false, error: getServiceError(voicesResponse.status, await voicesResponse.text()) }
      return { ok: true, data: { baseUrl, health, voices: parseVieNeuVoices(await voicesResponse.json()) } }
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) }
    }
  })

  ipcMain.handle(`${moduleName}:enrollVoice`, async (_event, args = {}) => {
    try {
      const baseUrl = normalizeVieNeuBaseUrl(args.baseUrl || DEFAULT_VIENEU_BASE_URL)
      const filePath = isUserMediaPath(args.filePath)
      if (!filePath) return { ok: false, error: 'Select a valid local reference audio file' }
      const stat = fs.statSync(filePath)
      if (!stat.isFile() || stat.size === 0) return { ok: false, error: 'Reference audio file is empty or invalid' }
      if (stat.size > MAX_VOICE_REFERENCE_BYTES) return { ok: false, error: 'Reference audio exceeds the 20 MiB limit' }
      if (!['.wav', '.mp3', '.m4a', '.ogg', '.flac', '.webm'].includes(path.extname(filePath).toLowerCase())) {
        return { ok: false, error: 'Unsupported reference audio format' }
      }
      const name = String(args.name || '').trim()
      if (!name || name.length > 64 || !/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(name)) return { ok: false, error: 'Voice name must start with a letter or number and contain at most 64 letters, numbers, spaces, dots, hyphens or underscores' }
      const form = new FormData()
      form.append('name', name)
      form.append('description', String(args.description || '').slice(0, 500))
      form.append('denoise', args.denoise === false ? 'false' : 'true')
      form.append('file', new Blob([fs.readFileSync(filePath)]), path.basename(filePath))
      const response = await fetchVieNeu(baseUrl, '/v1/voices', { method: 'POST', body: form })
      const body = await response.text()
      if (response.status === 409) {
        const list = await fetchVieNeu(baseUrl, '/v1/voices')
        if (list.ok && parseVieNeuVoices(await list.json()).some(item => item.name === name)) {
          return { ok: true, data: { voice: name, alreadyPresent: true } }
        }
      }
      if (!response.ok) return { ok: false, error: getServiceError(response.status, body) }
      return { ok: true, data: { voice: name, response: parseJsonOrText(body) } }
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) }
    }
  })

  ipcMain.handle(`${moduleName}:listManagedVoices`, () => {
    ensureDirs()
    return readManagedVoices()
  })

  ipcMain.handle(`${moduleName}:addManagedVoice`, async (_event, args = {}) => {
    try {
      const filePath = isUserMediaPath(args.filePath)
      if (!filePath) return { ok: false, error: 'Select a valid local reference audio file' }
      const stat = fs.statSync(filePath)
      const ext = path.extname(filePath).toLowerCase()
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_VOICE_REFERENCE_BYTES) return { ok: false, error: 'Reference audio must be a non-empty file of 20 MiB or less' }
      if (!['.wav', '.mp3', '.m4a', '.ogg', '.flac'].includes(ext)) return { ok: false, error: 'Unsupported reference audio format' }
      const name = String(args.name || '').trim()
      if (!name || name.length > 64 || !/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(name)) return { ok: false, error: 'Voice name must start with a letter or number and contain at most 64 letters, numbers, spaces, dots, hyphens or underscores' }
      ensureDirs()
      const id = randomUUID().replace(/-/g, '')
      const engineName = `tmcut_${id.slice(0, 16)}`
      const referencePath = path.join(getDirs().voices, `${id}${ext}`)
      fs.copyFileSync(filePath, referencePath, fs.constants.COPYFILE_EXCL)
      const voices = readManagedVoices()
      const voice = { id, name, engineName, description: String(args.description || '').trim().slice(0, 500), referenceFile: path.basename(referencePath), createdAt: new Date().toISOString() }
      voices.push(voice)
      try {
        writeJsonAtomic(path.join(getDirs().voices, 'registry.json'), voices)
      } catch (error) {
        try { fs.unlinkSync(referencePath) } catch { /* preserve the original registry error */ }
        throw error
      }
      return { ok: true, data: voice }
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) }
    }
  })

  ipcMain.handle(`${moduleName}:deleteManagedVoice`, (_event, id) => {
    const voiceId = String(id || '')
    if (!/^[a-f0-9]{32}$/.test(voiceId)) return { ok: false, error: 'Invalid voice id' }
    try {
      const voices = readManagedVoices()
      const voice = voices.find(item => item.id === voiceId)
      if (!voice) return { ok: false, error: 'Voice not found' }
      const referencePath = path.join(getDirs().voices, voice.referenceFile)
      if (path.dirname(referencePath) !== getDirs().voices || path.basename(referencePath) !== voice.referenceFile) return { ok: false, error: 'Invalid reference path' }
      writeJsonAtomic(path.join(getDirs().voices, 'registry.json'), voices.filter(item => item.id !== voiceId))
      try { fs.unlinkSync(referencePath) } catch (error) { if (error.code !== 'ENOENT') throw error }
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) }
    }
  })

  ipcMain.handle(`${moduleName}:syncManagedVoice`, async (_event, args = {}) => {
    try {
      const voiceId = String(args.id || '')
      if (!/^[a-f0-9]{32}$/.test(voiceId)) return { ok: false, error: 'Invalid voice id' }
      const voice = readManagedVoices().find(item => item.id === voiceId)
      if (!voice) return { ok: false, error: 'Voice not found' }
      const baseUrl = normalizeVieNeuBaseUrl(args.baseUrl || DEFAULT_VIENEU_BASE_URL)
      const referencePath = path.join(getDirs().voices, voice.referenceFile)
      const form = new FormData()
      form.append('name', voice.engineName)
      form.append('description', voice.description || voice.name)
      form.append('denoise', 'true')
      form.append('file', new Blob([fs.readFileSync(referencePath)]), voice.referenceFile)
      const response = await fetchVieNeu(baseUrl, '/v1/voices', { method: 'POST', body: form })
      const body = await response.text()
      if (response.status === 409) {
        const list = await fetchVieNeu(baseUrl, '/v1/voices')
        if (list.ok && parseVieNeuVoices(await list.json()).some(item => item.name === voice.engineName)) return { ok: true, data: { voice: voice.engineName, alreadyPresent: true } }
      }
      if (!response.ok) return { ok: false, error: getServiceError(response.status, body) }
      return { ok: true, data: { voice: voice.engineName, response: parseJsonOrText(body) } }
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) }
    }
  })

  ipcMain.handle(`${moduleName}:synthesizeGeminiVoice`, async (_event, args = {}) => {
    try {
      // Secret comes from Electron's encrypted config -> main-process env;
      // never accept or forward an API key over renderer IPC.
      const apiKey = String(process.env.TMCUT_GEMINI_API_KEY || '').trim()
      const text = typeof args.text === 'string' ? args.text.trim() : ''
      const voice = String(args.voice || '').trim()
      if (!apiKey || apiKey.length > 512) return { ok: false, error: 'Set the Gemini API key in Voice Studio first' }
      if (!text || text.length > MAX_TTS_TEXT_LENGTH) return { ok: false, error: `Narration must contain 1–${MAX_TTS_TEXT_LENGTH} characters` }
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(voice)) return { ok: false, error: 'Choose a supported Gemini voice' }
      const style = String(args.style || '').trim().slice(0, 500)
      const model = String(args.model || 'gemini-3.8-flash-tts').trim()
      if (!['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'].includes(model)) return { ok: false, error: 'Unsupported Gemini TTS model' }
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          input: [{ type: 'user_input', content: [{ type: 'text', text, ...(style ? { annotations: [{ type: 'speech_metadata', style }] } : {}) }] }],
          response_format: { type: 'audio' },
          generation_config: { speech_config: [{ voice }] },
          // Avoid retaining Interaction objects when the editor only needs
          // the one generated WAV file.
          store: false
        }),
        signal: AbortSignal.timeout(120_000)
      })
      if (!response.ok) return { ok: false, error: `Gemini TTS HTTP ${response.status}: ${(await response.text()).slice(0, 500)}` }
      const payload = await response.json()
      const audio = Array.isArray(payload?.steps)
        ? payload.steps.filter(step => step?.type === 'model_output').flatMap(step => step.content || []).reverse().find(part => part?.type === 'audio')
        : null
      const encoded = String(audio?.data || payload?.output_audio?.data || '')
      if (!encoded || encoded.length > Math.ceil(MAX_TTS_AUDIO_BYTES * 4 / 3)) return { ok: false, error: 'Gemini returned empty audio or exceeded the 64 MiB limit' }
      const bytes = Buffer.from(encoded, 'base64')
      if (bytes.length > MAX_TTS_AUDIO_BYTES) return { ok: false, error: 'Gemini returned audio exceeding the 64 MiB limit' }
      if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') return { ok: false, error: 'Gemini did not return valid WAV audio' }
      // RIFF stores the payload length as uint32; do not write malformed
      // WAV output if Google ever returns an unexpectedly large container.
      if (bytes.readUInt32LE(4) + 8 > bytes.length) return { ok: false, error: 'Gemini returned an incomplete WAV audio file' }
      ensureDirs()
      const filePath = path.join(getDirs().recordings, `gemini-tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`)
      fs.writeFileSync(filePath, bytes, { flag: 'wx' })
      return { ok: true, path: filePath, size: bytes.length }
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) }
    }
  })

  ipcMain.handle(`${moduleName}:synthesizeVoice`, async (_event, args = {}) => {
    try {
      const baseUrl = normalizeVieNeuBaseUrl(args.baseUrl || DEFAULT_VIENEU_BASE_URL)
      const { text, voice } = validateSynthesisInput(args)
      const response = await fetchVieNeu(baseUrl, '/v1/audio/speech', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'vieneu-v3-turbo', input: text, voice, response_format: 'wav', stream_format: 'audio' })
      })
      if (!response.ok) return { ok: false, error: getServiceError(response.status, await response.text()) }
      const bytes = await readResponseBounded(response, MAX_TTS_AUDIO_BYTES)
      if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
        return { ok: false, error: 'VieNeu-TTS did not return a valid WAV audio stream' }
      }
      ensureDirs()
      const filePath = path.join(getDirs().recordings, `tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`)
      fs.writeFileSync(filePath, bytes, { flag: 'wx' })
      return { ok: true, path: filePath, size: bytes.length }
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) }
    }
  })

  // Roadmap D-4: MediaRecorder blobs must land on disk for the desktop
  // pipeline (FFmpeg export reads real paths). Saved under
  // <base>/recordings/ with a timestamped name — no dialog friction.
  ipcMain.handle(`${moduleName}:saveRecording`, async (_event, { data, ext, prefix }) => {
    try {
      const bytes = data instanceof Uint8Array
        ? data
        : data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : null
      if (!bytes || bytes.length === 0) return { ok: false, error: 'Empty recording' }
      ensureDirs()
      const safeExt = /^[a-z0-9]{1,8}$/i.test(String(ext || '')) ? String(ext) : 'webm'
      // Voiceover takes keep the historical name; command captures are
      // labelled so the user can tell the two apart on disk.
      const safePrefix = /^[a-z0-9-]{1,16}$/.test(String(prefix || '')) ? String(prefix) : 'voiceover'
      const filePath = path.join(getDirs().recordings, `${safePrefix}-${Date.now()}.${safeExt}`)
      fs.writeFileSync(filePath, Buffer.from(bytes))
      return { ok: true, path: filePath }
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) }
    }
  })

  // Generated media download (P4 groundwork): a provider hands out a URL, the
  // renderer needs a local file the media pipeline can import.
  ipcMain.handle(`${moduleName}:downloadMedia`, async (event, args) => {
    const { url, filename, id } = args || {}
    const downloadId = String(id || `dl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`)
    return downloadMediaToFile({
      url,
      filename,
      id: downloadId,
      onProgress: (progress) => {
        try {
          if (!event.sender.isDestroyed()) {
            event.sender.send(`${moduleName}:downloadProgress`, { id: downloadId, ...progress })
          }
        } catch {
          // A closed window must not break an in-flight download.
        }
      }
    })
  })

  ipcMain.handle(`${moduleName}:cancelDownload`, (_event, id) => cancelMediaDownload(id))

  // Stock media search (kho tài nguyên): the renderer builds the provider
  // request, main enforces the https + host allowlist and the body cap, and
  // returns JSON — never a raw response body.
  ipcMain.handle(`${moduleName}:stockSearch`, async (_event, args = {}) => {
    return fetchStockJson({ url: args?.url, headers: args?.headers })
  })

  ipcMain.handle(`${moduleName}:extractWaveform`, async (_event, { filePath, buckets }) => {
    const safePath = isUserMediaPath(filePath)
    if (!safePath) return { ok: false, error: 'Invalid path' }
    return extractWaveform(safePath, buckets)
  })

  ipcMain.handle(`${moduleName}:analyzeAsset`, async (_event, { filePath, kind }) => {
    const safePath = isUserMediaPath(filePath)
    if (!safePath) return { ok: false, error: 'Invalid path' }
    return analyzeAsset(safePath, kind)
  })

  ipcMain.handle(`${moduleName}:analyzeScenes`, async (_event, { filePath, threshold }) => {
    const safePath = isUserMediaPath(filePath)
    if (!safePath) return { ok: false, error: 'Invalid path' }
    return analyzeScenes(safePath, threshold)
  })

  ipcMain.handle(`${moduleName}:analyzeSilence`, async (_event, { filePath, noiseDb, minDuration }) => {
    const safePath = isUserMediaPath(filePath)
    if (!safePath) return { ok: false, error: 'Invalid path' }
    return analyzeSilence(safePath, noiseDb, minDuration)
  })

  ipcMain.handle(`${moduleName}:generateProxy`, async (_event, { filePath, width }) => {
    const safePath = isUserMediaPath(filePath)
    if (!safePath) return { ok: false, error: 'Invalid path' }
    return generateProxy(safePath, width)
  })

  ipcMain.handle(`${moduleName}:stabilizeVideo`, async (_event, { filePath, options }) => {
    const safePath = isUserMediaPath(filePath)
    if (!safePath) return { ok: false, error: 'Invalid path' }
    return stabilizeVideo(safePath, options)
  })

  ipcMain.handle(`${moduleName}:listFonts`, () => listSystemFonts())
}

// isUserMediaPath exported for the R110 regression spec (pure function,
// no Electron state involved; requiring this module outside Electron is
// side-effect-free because registration only runs from main.cjs).
function readManagedVoices() {
  const voices = readJsonSafe(path.join(getDirs().voices, 'registry.json'))
  if (!Array.isArray(voices)) return []
  return voices.filter(voice => voice && /^[a-f0-9]{32}$/.test(String(voice.id || ''))
    && typeof voice.name === 'string' && typeof voice.engineName === 'string'
    && typeof voice.referenceFile === 'string' && path.basename(voice.referenceFile) === voice.referenceFile)
}

async function fetchVieNeu(baseUrl, route, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120_000)
  try {
    return await fetch(`${baseUrl}${route}`, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function readResponseBounded(response, maxBytes) {
  const declared = Number(response.headers.get('content-length')) || 0
  if (declared > maxBytes) throw new Error('Generated audio exceeds the 64 MiB limit')
  if (!response.body) throw new Error('VieNeu-TTS returned an empty response')
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('Generated audio exceeds the 64 MiB limit')
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks, total)
}

function parseJsonOrText(value) {
  try { return JSON.parse(value) } catch { return String(value || '') }
}

module.exports = {
  registerTmcutController,
  isUserMediaPath,
  // Exported for the download integration test; not part of the IPC surface.
  downloadMediaToFile,
  cancelMediaDownload
}
