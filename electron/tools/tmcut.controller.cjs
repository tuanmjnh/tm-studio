const { ipcMain, app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const { getResourcesDir } = require('./paths.cjs')
const { pruneCommandRecordings } = require('./recordings.cjs')
const { assertDownloadUrl, resolveDownloadTarget, sanitizeFilename } = require('./media-download.cjs')
const { acceptRenderBytes, resolveRenderTarget, MAX_RENDER_BYTES } = require('./render-save.cjs')
const { fetchStockJson } = require('./stock-proxy.cjs')
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
    renders: path.join(base, 'renders'),
    voices: path.join(base, 'voices')
  }
}

/**
 * Structural validation for USER-SELECTED media paths (import dialog,
 * Explorer drag-and-drop, relink). These files legitimately live anywhere
 * on the user's disks, so a root whitelist cannot apply — the old
 * whitelist here (userData + resources only) silently rejected every
 * real import, which surfaced as the amber "unreadable media" banner on
 * every dropped file (R110).
 *
 * Every operation behind this guard is a read of a file the user
 * explicitly added (stat, voice reference audio, download destination);
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
  for (const p of [d.base, d.projects, d.snapshots, d.cache, d.thumbs, d.waveforms, d.frames, d.proxies, d.stabilized, d.stabilizedTrf, d.recordings, d.downloads, d.renders, d.voices]) {
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
      proxies: toPosix(d.proxies),
      // Where a rendered export lands. The dialog names this folder so the
      // result has a home the user can open, not just a Blob in memory.
      renders: toPosix(d.renders)
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

  ipcMain.handle(`${moduleName}:voiceStatus`, async (_event, args = {}) => {
    try {
      const baseUrl = normalizeVieNeuBaseUrl(args.baseUrl || DEFAULT_VIENEU_BASE_URL)
      const response = await fetchVieNeu(baseUrl, '/health')
      if (!response.ok) return { ok: false, error: getServiceError(response.status, await response.text()) }
      let health = null
      try {
        health = await response.json()
      } catch {
        health = null
      }
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
        try {
          fs.unlinkSync(referencePath)
        } catch {
          /* preserve the original registry error */
        }
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
      try {
        fs.unlinkSync(referencePath)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
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

  // The export runs in this renderer (WebCodecs + the muxer) and answers with a
  // Blob. On this host a Blob is not a file: there is no path to reveal, the
  // preview modal cannot play a blob: it classifies by extension, and the
  // browser download lane begins and then cancels (measured 2026-11-13). So the
  // renderer hands the bytes here and gets back a real path — which is what the
  // dialog can play, reveal, and copy somewhere else.
  //
  // `saveAs` asks the OS where to put the copy; without it the file lands in
  // <base>/renders/ so the dialog has something to reveal immediately.
  ipcMain.handle(`${moduleName}:saveRender`, async (event, args = {}) => {
    try {
      const bytes = acceptRenderBytes(args?.data)
      if (!bytes) return { ok: false, error: 'Empty render' }
      if (bytes.byteLength > MAX_RENDER_BYTES) return { ok: false, error: 'Render exceeds the 4 GiB limit' }
      ensureDirs()
      const requested = sanitizeFilename(args?.filename || 'render', 'mp4')
      let target
      if (args?.saveAs) {
        const { dialog } = require('electron')
        const owner = BrowserWindow.fromWebContents(event.sender)
        const options = {
          title: 'Save rendered video',
          defaultPath: path.join(app.getPath('videos'), requested),
          filters: [{ name: 'MP4 video', extensions: ['mp4'] }]
        }
        const picked = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
        if (picked.canceled || !picked.filePath) return { ok: false, canceled: true }
        target = { name: path.basename(picked.filePath), path: picked.filePath }
      } else {
        target = resolveRenderTarget({
          dir: getDirs().renders,
          filename: requested,
          exists: fullPath => fs.existsSync(fullPath)
        })
      }
      await fs.promises.writeFile(target.path, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
      return { ok: true, path: toPosix(target.path), name: target.name, bytes: bytes.byteLength }
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
  try {
    return JSON.parse(value)
  } catch {
    return String(value || '')
  }
}

module.exports = {
  registerTmcutController,
  isUserMediaPath,
  // Exported for the download integration test; not part of the IPC surface.
  downloadMediaToFile,
  cancelMediaDownload
}
