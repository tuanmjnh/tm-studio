'use strict'
// =============================================================================
//  Asset Center controller (roadmap v3 PART A — Phase 2).
//
//  A THIN, path-confined I/O adapter. Per the runtime-adapter rule the whole
//  download-queue state machine (concurrency, retries, license gate,
//  recovery) lives in @tmcut/core and is driven renderer-side; this file only
//  does what a renderer cannot: stream an HTTPS asset package to disk, verify
//  its checksum, and keep the small on-disk registries. No queue logic here.
//
//  Security posture (matches the rest of the Electron layer):
//   - HTTPS-only fetch, redirects bounded;
//   - the renderer NEVER supplies a path — it names entryId/version/filename
//     and the controller builds a path pinned inside the asset-center base
//     (sanitize + resolve + prefix check), so there is no traversal surface;
//   - atomic write (.part -> rename) so a crash never leaves a half file that
//     looks installed;
//   - checksum mismatch or oversize deletes the artifact and reports failure
//     (roadmap: "a partial/corrupted download must never appear usable");
//   - per-job cancellation via an AbortController registry.
// =============================================================================

const { ipcMain, app } = require('electron')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const https = require('https')
const { getResourcePath } = require('./paths.cjs')

const moduleName = 'tmcut'
const MAX_REDIRECTS = 5
// Hard ceiling per package (512 MiB). Asset Center packages are effects/
// LUTs/audio/titles — anything larger is a misconfigured or hostile URL.
const MAX_PACKAGE_BYTES = 512 * 1024 * 1024

function getAssetCenterDirs() {
  const base = path.join(app.getPath('userData'), 'tmcut', 'asset-center')
  return {
    base,
    packages: path.join(base, 'packages'),
    catalogCache: path.join(base, 'catalog.json'),
    installedFile: path.join(base, 'installed.json')
  }
}

function ensureAssetCenterDirs() {
  const d = getAssetCenterDirs()
  for (const p of [d.base, d.packages]) {
    try {
      fs.mkdirSync(p, { recursive: true })
    } catch {
      // ignore — callers re-check the file they actually wrote
    }
  }
  return d
}

function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, filePath)
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

// Internal registry ids are sanitized (never traversal), mirroring the
// project/snapshot handlers in tmcut.controller.cjs.
function sanitizeSegment(value) {
  const clean = String(value || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
  return clean || 'x'
}

/**
 * Build a path PINNED inside `baseDir` from untrusted segments. Every
 * segment is sanitized and the resolved result is re-checked against the
 * base, so a crafted entry/version/filename can never escape the directory
 * (traversal guard). Pure — exported for the traversal unit spec.
 */
function resolvePinnedPath(baseDir, segments) {
  const parts = (Array.isArray(segments) ? segments : [segments])
    .map(s => (String(s || '').includes('/') || String(s || '').includes('\\')
      ? String(s).split(/[\\/]/).map(seg => (seg === '..' ? '_' : sanitizeSegment(seg)))
      : sanitizeSegment(s)))
    .flat()
    .filter(Boolean)
  const target = path.resolve(baseDir, ...parts)
  const baseResolved = path.resolve(baseDir)
  if (target !== baseResolved && !target.startsWith(baseResolved + path.sep)) return null
  return target
}

// Build a package path pinned inside the asset-center base.
function packageFilePath({ entryId, version, filename }) {
  const dirs = getAssetCenterDirs()
  const safeName = String(filename || 'package.bin').split(/[\\/]/).pop() || 'package.bin'
  return resolvePinnedPath(dirs.packages, [entryId, version, safeName])
}

// Live downloads by job id, so a cancel can abort the in-flight request.
const activeDownloads = new Map()

// One HTTPS GET with bounded redirects. Resolves { stream, url }; the caller
// owns the stream. Rejects on non-HTTPS or too many redirects.
function httpsGet(targetUrl, redirectsLeft, signal) {
  return new Promise((resolve, reject) => {
    if (redirectsLeft < 0) return reject(new Error('Too many redirects'))
    let parsed
    try {
      parsed = new URL(targetUrl)
    } catch {
      return reject(new Error('Invalid URL'))
    }
    if (parsed.protocol !== 'https:') return reject(new Error('HTTPS required'))
    const req = https.get(parsed, { signal }, (res) => {
      const status = res.statusCode || 0
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        const next = new URL(res.headers.location, parsed).toString()
        httpsGet(next, redirectsLeft - 1, signal).then(resolve, reject)
        return
      }
      if (status < 200 || status >= 300) {
        res.resume()
        reject(new Error(`HTTP ${status}`))
        return
      }
      resolve({ res, finalUrl: parsed.toString() })
    })
    req.on('error', reject)
  })
}

/**
 * Download one package file to its pinned path, verify sha256 + size, and
 * atomically commit. Progress is pushed per chunk (throttled by the caller's
 * needs — the renderer queue turns these into UI updates).
 * Returns { ok, path?, sha256?, size?, reason? }.
 */
async function downloadPackage({ jobId, url, entryId, version, filename, expectSha256, expectBytes, sendProgress }) {
  const target = packageFilePath({ entryId, version, filename })
  if (!target) return { ok: false, reason: 'invalid-path' }
  ensureAssetCenterDirs()
  const partPath = `${target}.part`

  const controller = new AbortController()
  activeDownloads.set(String(jobId), controller)

  let res
  try {
    const got = await httpsGet(String(url), MAX_REDIRECTS, controller.signal)
    res = got.res
  } catch (error) {
    activeDownloads.delete(String(jobId))
    if (controller.signal.aborted) return { ok: false, reason: 'cancelled' }
    return { ok: false, reason: `network: ${error.message}` }
  }

  return await new Promise((resolve) => {
    const hash = crypto.createHash('sha256')
    const out = fs.createWriteStream(partPath)
    let loaded = 0
    const declared = Number(res.headers['content-length']) || 0

    const cleanup = () => {
      activeDownloads.delete(String(jobId))
    }

    const fail = (reason) => {
      res.destroy()
      out.destroy()
      try {
        if (fs.existsSync(partPath)) fs.unlinkSync(partPath)
      } catch {
        // best-effort: an orphan .part is invisible to the registry
      }
      cleanup()
      resolve({ ok: false, reason })
    }

    res.on('data', (chunk) => {
      loaded += chunk.length
      if (loaded > MAX_PACKAGE_BYTES) {
        fail('oversize')
        return
      }
      hash.update(chunk)
      if (sendProgress) sendProgress({ loaded, total: declared || Number(expectBytes) || 0 })
    })
    res.on('error', () => fail('network-stream'))
    out.on('error', () => fail('write'))
    out.on('finish', () => {
      const sha256 = hash.digest('hex')
      const size = loaded
      // Cross-check the declared content-length first when the server sent it.
      if (declared && declared !== size) {
        fail('truncated')
        return
      }
      if (expectBytes && size > Number(expectBytes) * 2) {
        fail('oversize')
        return
      }
      // Checksum gate: a mismatch must never be committed (roadmap §15).
      if (expectSha256 && sha256.toLowerCase() !== String(expectSha256).toLowerCase()) {
        fail('checksum')
        return
      }
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.renameSync(partPath, target)
      } catch {
        fail('rename')
        return
      }
      cleanup()
      resolve({ ok: true, path: target, sha256, size })
    })
    res.pipe(out)
  })
}

function registerAssetCenterController(getWindow) {
  const sendProgress = (payload) => {
    const win = typeof getWindow === 'function' ? getWindow() : null
    if (win && !win.isDestroyed()) {
      win.webContents.send(`${moduleName}:assetCenter:progress`, payload)
    }
  }

  // Starter catalog ships inside the installer (roadmap §5: "only a small
  // starter set" — the full catalog is fetched on demand later). Sample
  // effect files live beside it and back the local-source test entries so
  // the whole download -> verify -> install -> use -> offline loop can be
  // exercised with no network (roadmap §15 gate).
  ipcMain.handle(`${moduleName}:assetCenter:readStarterCatalog`, () => {
    const file = getResourcePath(path.join('tmcut-catalog', 'starter-catalog.json'))
    return readJsonSafe(file)
  })

  // Absolute path of a bundled sample file (local-source installs read it
  // directly — no download). Unknown ids return null; the id never becomes
  // a path, only a lookup key into the fixed sample list.
  ipcMain.handle(`${moduleName}:assetCenter:getSamplePath`, (_event, sampleId) => {
    const samples = { 'sample-sfx-sweep': 'sample-sfx-sweep.wav' }
    const name = samples[String(sampleId || '')]
    if (!name) return null
    const file = getResourcePath(path.join('tmcut-catalog', name))
    return fs.existsSync(file) ? file : null
  })

  ipcMain.handle(`${moduleName}:assetCenter:getDirs`, () => {
    const d = ensureAssetCenterDirs()
    return { base: d.base, packages: d.packages }
  })

  ipcMain.handle(`${moduleName}:assetCenter:readRegistry`, () => {
    const data = readJsonSafe(getAssetCenterDirs().installedFile)
    return Array.isArray(data) ? data : []
  })

  ipcMain.handle(`${moduleName}:assetCenter:writeRegistry`, (_event, list) => {
    if (!Array.isArray(list)) return false
    ensureAssetCenterDirs()
    try {
      writeJsonAtomic(getAssetCenterDirs().installedFile, list)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle(`${moduleName}:assetCenter:readCatalogCache`, () => readJsonSafe(getAssetCenterDirs().catalogCache))

  ipcMain.handle(`${moduleName}:assetCenter:writeCatalogCache`, (_event, catalog) => {
    if (!catalog || typeof catalog !== 'object') return false
    ensureAssetCenterDirs()
    try {
      writeJsonAtomic(getAssetCenterDirs().catalogCache, catalog)
      return true
    } catch {
      return false
    }
  })

  // Download is dispatched per-job so the renderer queue owns concurrency.
  // jobId lets a later cancel() abort exactly this request.
  ipcMain.handle(`${moduleName}:assetCenter:downloadPackage`, async (_event, args) => {
    const { jobId, url, entryId, version, filename, expectSha256, expectBytes } = args || {}
    if (!jobId || !url || !entryId) return { ok: false, reason: 'bad-request' }
    return downloadPackage({
      jobId,
      url,
      entryId,
      version,
      filename,
      expectSha256,
      expectBytes,
      sendProgress: p => sendProgress({ jobId, entryId, ...p })
    })
  })

  ipcMain.handle(`${moduleName}:assetCenter:cancelDownload`, (_event, jobId) => {
    const controller = activeDownloads.get(String(jobId))
    if (controller) {
      try {
        controller.abort()
      } catch {
        // ignore — the download settles as cancelled either way
      }
      activeDownloads.delete(String(jobId))
      return true
    }
    return false
  })

  // Install from a LOCAL source (bundled sample, or a user-picked file):
  // stream-copy into the pinned package dir with the same checksum gate as
  // a download, so the verify -> commit -> registry path is one code path.
  ipcMain.handle(`${moduleName}:assetCenter:installLocal`, async (_event, args) => {
    const { jobId, sourcePath, entryId, version, filename, expectSha256 } = args || {}
    if (!jobId || !sourcePath || !entryId) return { ok: false, reason: 'bad-request' }
    const src = String(sourcePath)
    if (!path.isAbsolute(src) || !fs.existsSync(src) || !fs.statSync(src).isFile()) {
      return { ok: false, reason: 'source-missing' }
    }
    const target = packageFilePath({ entryId, version, filename })
    if (!target) return { ok: false, reason: 'invalid-path' }
    ensureAssetCenterDirs()
    const partPath = `${target}.part`
    return await new Promise((resolve) => {
      const input = fs.createReadStream(src)
      const out = fs.createWriteStream(partPath)
      const hash = crypto.createHash('sha256')
      let loaded = 0
      const fail = (reason) => {
        input.destroy()
        out.destroy()
        try {
          if (fs.existsSync(partPath)) fs.unlinkSync(partPath)
        } catch {
          // ignore
        }
        resolve({ ok: false, reason })
      }
      input.on('data', (chunk) => {
        loaded += chunk.length
        if (loaded > MAX_PACKAGE_BYTES) {
          fail('oversize')
          return
        }
        hash.update(chunk)
        sendProgress({ jobId, entryId, loaded, total: loaded })
      })
      input.on('error', () => fail('read'))
      out.on('error', () => fail('write'))
      out.on('finish', () => {
        const sha256 = hash.digest('hex')
        if (expectSha256 && sha256.toLowerCase() !== String(expectSha256).toLowerCase()) {
          fail('checksum')
          return
        }
        try {
          fs.mkdirSync(path.dirname(target), { recursive: true })
          fs.renameSync(partPath, target)
        } catch {
          fail('rename')
          return
        }
        resolve({ ok: true, path: target, sha256, size: loaded })
      })
      input.pipe(out)
    })
  })

  // Uninstall: remove a package directory (pinned inside base), then the
  // renderer trims its registry entry. Removing anything outside base fails.
  ipcMain.handle(`${moduleName}:assetCenter:removePackageDir`, (_event, { entryId, version }) => {
    const dirs = getAssetCenterDirs()
    const target = resolvePinnedPath(dirs.packages, [entryId, version])
    if (!target || target === path.resolve(dirs.packages)) return { ok: false, reason: 'invalid-path' }
    try {
      fs.rmSync(target, { recursive: true, force: true })
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: String(error.message || error) }
    }
  })

  // On-demand verification of an installed file (used by the missing/relink
  // path): re-hash a pinned file and report whether it still matches.
  ipcMain.handle(`${moduleName}:assetCenter:verifyFile`, (_event, { entryId, version, filename, expectSha256 }) => {
    const target = packageFilePath({ entryId, version, filename })
    if (!target) return { ok: false, reason: 'invalid-path' }
    try {
      const buf = fs.readFileSync(target)
      const sha256 = crypto.createHash('sha256').update(buf).digest('hex')
      const ok = !expectSha256 || sha256.toLowerCase() === String(expectSha256).toLowerCase()
      return { ok, sha256, size: buf.length }
    } catch {
      return { ok: false, reason: 'missing' }
    }
  })
}

module.exports = { registerAssetCenterController, resolvePinnedPath }
