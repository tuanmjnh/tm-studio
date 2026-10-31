const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')
const { execFile } = require('child_process')
const { getResourcesDir, getToolsBinaries } = require('./paths.cjs')

/**
 * Downloads a file from a URL with redirect support.
 */
function downloadFile(url, destPath, onProgress, maxRedirects = 10) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      return reject(new Error('Too many redirects while downloading'))
    }

    const client = url.startsWith('https:') ? https : http
    const parsedUrl = new URL(url)
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) tm-tools-updater/1.0',
        'Accept': '*/*'
      }
    }

    const req = client.get(options, (res) => {
      // Handle redirects (301, 302, 303, 307, 308)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location
        if (!redirectUrl.startsWith('http://') && !redirectUrl.startsWith('https://')) {
          redirectUrl = new URL(redirectUrl, url).toString()
        }
        res.resume()
        return resolve(downloadFile(redirectUrl, destPath, onProgress, maxRedirects - 1))
      }

      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`Download failed with HTTP status: ${res.statusCode}`))
      }

      const totalBytes = parseInt(res.headers['content-length'] || '0', 10)
      let receivedBytes = 0

      const partPath = `${destPath}.part`
      const fileStream = fs.createWriteStream(partPath)

      res.on('data', (chunk) => {
        receivedBytes += chunk.length
        if (onProgress && totalBytes > 0) {
          const percent = Math.min(100, Math.round((receivedBytes / totalBytes) * 100))
          onProgress({ percent, receivedBytes, totalBytes })
        }
      })

      res.pipe(fileStream)

      fileStream.on('finish', () => {
        fileStream.close(() => {
          try {
            if (fs.existsSync(destPath)) {
              fs.unlinkSync(destPath)
            }
            fs.renameSync(partPath, destPath)
            resolve(destPath)
          } catch (err) {
            reject(err)
          }
        })
      })

      fileStream.on('error', (err) => {
        try {
          if (fs.existsSync(partPath)) {
            fs.unlinkSync(partPath)
          }
        } catch {
          // ignore
        }
        reject(err)
      })
    })

    req.on('error', (err) => {
      reject(err)
    })

    req.setTimeout(60000, () => {
      req.destroy(new Error('Connection timed out while downloading'))
    })
  })
}

/**
 * Fetches text content from a URL with redirect support.
 */
function fetchText(url, maxRedirects = 10) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      return reject(new Error('Too many redirects while fetching text'))
    }

    const client = url.startsWith('https:') ? https : http
    const parsedUrl = new URL(url)
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) tm-tools/1.0',
        'Accept': 'application/json, text/plain, */*'
      }
    }

    const req = client.get(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location
        if (!redirectUrl.startsWith('http://') && !redirectUrl.startsWith('https://')) {
          redirectUrl = new URL(redirectUrl, url).toString()
        }
        res.resume()
        return resolve(fetchText(redirectUrl, maxRedirects - 1))
      }

      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`Request failed with status ${res.statusCode}`))
      }

      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => resolve(data.trim()))
    })

    req.on('error', reject)
    req.setTimeout(30000, () => req.destroy(new Error('Request timed out')))
  })
}

/**
 * Extracts a zip archive using tar.exe (built-in Windows 10/11) with PowerShell fallback.
 */
function extractZip(zipPath, targetDir) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    // Try Windows tar.exe first (bsdtar handles .zip natively)
    execFile('tar.exe', ['-xf', zipPath, '-C', targetDir], { windowsHide: true }, (tarErr) => {
      if (!tarErr) {
        return resolve(targetDir)
      }

      // Fallback: PowerShell Expand-Archive
      const psScript = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, '\'\'')}' -DestinationPath '${targetDir.replace(/'/g, '\'\'')}' -Force`
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], { windowsHide: true }, (psErr) => {
        if (psErr) {
          return reject(new Error(`Failed to extract archive: ${psErr.message}`))
        }
        resolve(targetDir)
      })
    })
  })
}

/**
 * Recursively searches for files matching any of the specified file names.
 */
function findFilesRecursive(dir, fileNames) {
  const results = {}
  if (!fs.existsSync(dir)) return results

  function scan(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        scan(fullPath)
      } else if (entry.isFile()) {
        const lowerName = entry.name.toLowerCase()
        for (const target of fileNames) {
          if (lowerName === target.toLowerCase()) {
            results[target] = fullPath
          }
        }
      }
    }
  }

  scan(dir)
  return results
}

/**
 * Helper to parse a date number (YYYYMMDD) from a version string or date text.
 */
function parseDateNum(str) {
  if (!str || typeof str !== 'string') return 0
  const m1 = str.match(/(20\d{2})[.-](\d{2})[.-](\d{2})/)
  if (m1) return parseInt(m1[1] + m1[2] + m1[3], 10)
  const m2 = str.match(/(20\d{2})(\d{2})(\d{2})/)
  if (m2) return parseInt(m2[1] + m2[2] + m2[3], 10)
  return 0
}

/**
 * Safely copies a file to destination, creating parent directory if needed.
 * Includes fallback rename-then-copy on Windows when the target executable is locked or busy.
 */
function safeCopyFile(src, dest) {
  const destDir = path.dirname(dest)
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true })
  }

  // Avoid copying file onto itself
  if (path.resolve(src) === path.resolve(dest)) {
    return
  }

  try {
    fs.copyFileSync(src, dest)
  } catch (err) {
    // Windows file locking (EBUSY / EPERM): rename existing destination first, then copy
    const tempBak = `${dest}.${Date.now()}.bak`
    try {
      if (fs.existsSync(dest)) {
        fs.renameSync(dest, tempBak)
      }
      fs.copyFileSync(src, dest)
      try {
        fs.unlinkSync(tempBak)
      } catch {
        // Ignored: OS or cleanup will handle it later
      }
    } catch (fallbackErr) {
      throw new Error(`Cannot overwrite "${dest}": ${err.message || fallbackErr.message}`, { cause: fallbackErr })
    }
  }
}

/**
 * Checks for yt-dlp update using GitHub Release API.
 */
async function checkYtDlpUpdate(currentVersion = '') {
  try {
    const jsonStr = await fetchText('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest')
    const release = JSON.parse(jsonStr)

    const latestVersion = (release.tag_name || '').replace(/^v/, '').trim()
    const cleanCurrent = (currentVersion || '').replace(/^v/, '').trim()

    let downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
    if (Array.isArray(release.assets)) {
      const exeAsset = release.assets.find(a => a.name === 'yt-dlp.exe')
      if (exeAsset?.browser_download_url) {
        downloadUrl = exeAsset.browser_download_url
      }
    }

    const currentDateNum = parseDateNum(cleanCurrent)
    const latestDateNum = parseDateNum(latestVersion) || parseDateNum(release.published_at)

    let hasUpdate = false
    if (!cleanCurrent || cleanCurrent === 'Not found' || cleanCurrent === 'Unknown') {
      hasUpdate = true
    } else if (latestDateNum > 0 && currentDateNum > 0) {
      hasUpdate = latestDateNum > currentDateNum
    } else {
      hasUpdate = Boolean(latestVersion && cleanCurrent !== latestVersion)
    }

    return {
      status: true,
      data: {
        hasUpdate,
        currentVersion: cleanCurrent || 'Unknown',
        latestVersion: latestVersion || 'Unknown',
        downloadUrl,
        releaseUrl: release.html_url || 'https://github.com/yt-dlp/yt-dlp/releases',
        publishedAt: release.published_at || ''
      }
    }
  } catch (err) {
    return {
      status: false,
      message: `Failed to check yt-dlp update: ${err.message}`
    }
  }
}

/**
 * Downloads and installs yt-dlp into resources folder and active binary path.
 */
async function installYtDlp({ cleanTemp = true, downloadUrl: customDownloadUrl } = {}, onProgress) {
  const downloadsDir = app.getPath('downloads')
  const resourcesDir = getResourcesDir()
  const downloadedExe = path.join(downloadsDir, 'yt-dlp-latest.exe')
  const defaultResourceExe = path.join(resourcesDir, 'yt-dlp.exe')

  // Find all target locations to update:
  // 1. Default resources directory (resources/yt-dlp.exe)
  // 2. Active configured path if specified in system config / environment (e.g. C:/Users/.../Downloads/yt-dlp.exe)
  const targetPaths = new Set()
  targetPaths.add(path.resolve(defaultResourceExe))

  try {
    const binaries = getToolsBinaries()
    if (binaries && binaries.ytDlp) {
      targetPaths.add(path.resolve(binaries.ytDlp))
    }
  } catch {
    // Ignore fallback if binaries resolution fails
  }

  try {
    if (onProgress) onProgress({ stage: 'downloading', percent: 0, message: 'Downloading yt-dlp.exe...' })

    const downloadUrl = customDownloadUrl || 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
    await downloadFile(downloadUrl, downloadedExe, (p) => {
      if (onProgress) onProgress({ stage: 'downloading', percent: p.percent, message: `Downloading yt-dlp (${p.percent}%)` })
    })

    if (onProgress) onProgress({ stage: 'copying', percent: 90, message: 'Overwriting yt-dlp executable...' })

    for (const targetExe of targetPaths) {
      safeCopyFile(downloadedExe, targetExe)
    }

    if (cleanTemp) {
      const isTarget = Array.from(targetPaths).some(p => path.resolve(p) === path.resolve(downloadedExe))
      if (!isTarget) {
        if (onProgress) onProgress({ stage: 'cleaning', percent: 98, message: 'Cleaning temp download...' })
        try {
          if (fs.existsSync(downloadedExe)) {
            fs.unlinkSync(downloadedExe)
          }
        } catch {
          // ignore
        }
      }
    }

    if (onProgress) onProgress({ stage: 'done', percent: 100, message: 'Update completed successfully' })

    return { status: true, message: 'Updated yt-dlp successfully' }
  } catch (err) {
    try {
      if (cleanTemp) {
        const isTarget = Array.from(targetPaths).some(p => path.resolve(p) === path.resolve(downloadedExe))
        if (!isTarget && fs.existsSync(downloadedExe)) {
          fs.unlinkSync(downloadedExe)
        }
      }
    } catch {
      // ignore
    }
    throw new Error(`Failed to install yt-dlp: ${err.message}`, { cause: err })
  }
}

/**
 * Checks for FFmpeg update from selectable sources (BtbN or Gyan.dev).
 * @param {string} currentVersion
 * @param {object} [options]
 * @param {'btbn' | 'gyan'} [options.source='btbn']
 */
async function checkFfmpegUpdate(currentVersion = '', { source = 'btbn' } = {}) {
  const cleanCurrent = (currentVersion || '').trim()
  const currentVerDisplay = cleanCurrent.split(' ')[2] || cleanCurrent.split('\n')[0] || cleanCurrent || 'Unknown'

  if (source === 'gyan') {
    try {
      const latestVersion = (await fetchText('https://www.gyan.dev/ffmpeg/builds/release-version')).trim()
      const hasUpdate = Boolean(latestVersion && (!cleanCurrent || !cleanCurrent.includes(latestVersion)))

      return {
        status: true,
        data: {
          hasUpdate,
          currentVersion: currentVerDisplay,
          latestVersion: `Release ${latestVersion}`,
          downloadUrl: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
          releaseUrl: 'https://www.gyan.dev/ffmpeg/builds/',
          publishedAt: '',
          source: 'gyan'
        }
      }
    } catch (err) {
      return {
        status: false,
        message: `Failed to check FFmpeg update from Gyan.dev: ${err.message}`
      }
    }
  }

  // Default: BtbN/FFmpeg-Builds
  try {
    const jsonStr = await fetchText('https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest')
    const release = JSON.parse(jsonStr)

    // Find Windows 64-bit GPL build (preferred: ffmpeg-master-latest-win64-gpl.zip or ffmpeg-n*-latest-win64-gpl*.zip)
    let gplAsset = null
    if (Array.isArray(release.assets)) {
      gplAsset = release.assets.find(a => a.name === 'ffmpeg-master-latest-win64-gpl.zip')
        || release.assets.find(a => a.name.includes('win64-gpl') && !a.name.includes('shared') && a.name.endsWith('.zip'))
    }

    const downloadUrl = gplAsset?.browser_download_url || 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'

    let latestVersion = release.name || release.tag_name || 'Latest'
    latestVersion = latestVersion.replace(/^Latest\s*/i, '').trim()

    const currentDateNum = parseDateNum(cleanCurrent)
    const latestDateNum = parseDateNum(release.name) || parseDateNum(release.published_at) || parseDateNum(gplAsset?.updated_at)

    let hasUpdate = false
    if (!cleanCurrent || cleanCurrent === 'Not found' || cleanCurrent === 'Unknown') {
      hasUpdate = true
    } else if (latestDateNum > 0 && currentDateNum > 0) {
      hasUpdate = latestDateNum > currentDateNum
    } else {
      hasUpdate = Boolean(latestVersion && !cleanCurrent.includes(latestVersion))
    }

    return {
      status: true,
      data: {
        hasUpdate,
        currentVersion: currentVerDisplay,
        latestVersion,
        downloadUrl,
        releaseUrl: release.html_url || 'https://github.com/BtbN/FFmpeg-Builds/releases',
        publishedAt: release.published_at || gplAsset?.updated_at || '',
        source: 'btbn'
      }
    }
  } catch (err) {
    return {
      status: false,
      message: `Failed to check FFmpeg update from BtbN: ${err.message}`
    }
  }
}

/**
 * Downloads and installs FFmpeg (ffmpeg.exe, ffprobe.exe, ffplay.exe) into resources.
 * @param {object} [options]
 * @param {boolean} [options.cleanTemp=true]
 * @param {string} [options.downloadUrl]
 * @param {'btbn' | 'gyan'} [options.source='btbn']
 * @param {function} [onProgress]
 */
async function installFfmpeg({ cleanTemp = true, downloadUrl: customDownloadUrl, source = 'btbn' } = {}, onProgress) {
  const downloadsDir = app.getPath('downloads')
  const resourcesDir = getResourcesDir()

  const defaultUrl = source === 'gyan'
    ? 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
    : 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'

  const downloadUrl = customDownloadUrl || defaultUrl
  const zipFileName = source === 'gyan' ? 'ffmpeg-release-essentials.zip' : 'ffmpeg-master-latest-win64-gpl.zip'
  const zipFile = path.join(downloadsDir, zipFileName)
  const extractDir = path.join(downloadsDir, `ffmpeg-update-temp-${Date.now()}`)

  try {
    const label = source === 'gyan' ? 'Gyan.dev' : 'BtbN'
    if (onProgress) onProgress({ stage: 'downloading', percent: 0, message: `Downloading FFmpeg from ${label}...` })

    await downloadFile(downloadUrl, zipFile, (p) => {
      if (onProgress) onProgress({ stage: 'downloading', percent: p.percent, message: `Downloading FFmpeg (${p.percent}%)` })
    })

    if (onProgress) onProgress({ stage: 'extracting', percent: 80, message: 'Extracting FFmpeg package...' })

    await extractZip(zipFile, extractDir)

    if (onProgress) onProgress({ stage: 'copying', percent: 90, message: 'Copying binaries to resources...' })

    const targetFiles = ['ffmpeg.exe', 'ffprobe.exe', 'ffplay.exe']
    const found = findFilesRecursive(extractDir, targetFiles)

    if (!found['ffmpeg.exe']) {
      throw new Error('Could not find ffmpeg.exe inside extracted archive')
    }

    let binaries = {}
    try {
      binaries = getToolsBinaries()
    } catch {
      // Ignore fallback if binaries resolution fails
    }

    for (const fileName of targetFiles) {
      if (found[fileName]) {
        const destResources = path.join(resourcesDir, fileName)
        safeCopyFile(found[fileName], destResources)

        let activeKey = null
        if (fileName === 'ffmpeg.exe') activeKey = binaries.ffmpeg
        else if (fileName === 'ffprobe.exe') activeKey = binaries.ffprobe
        else if (fileName === 'ffplay.exe') activeKey = binaries.ffplay

        if (activeKey && path.resolve(activeKey) !== path.resolve(destResources)) {
          try {
            safeCopyFile(found[fileName], activeKey)
          } catch (e) {
            console.error(`Failed to copy ${fileName} to active path ${activeKey}:`, e)
          }
        }
      }
    }

    if (cleanTemp) {
      if (onProgress) onProgress({ stage: 'cleaning', percent: 98, message: 'Cleaning temp download and extracted files...' })
      try {
        if (fs.existsSync(zipFile)) {
          fs.unlinkSync(zipFile)
        }
      } catch {
        // ignore
      }
      try {
        if (fs.existsSync(extractDir)) {
          fs.rmSync(extractDir, { recursive: true, force: true })
        }
      } catch {
        // ignore
      }
    }

    if (onProgress) onProgress({ stage: 'done', percent: 100, message: 'FFmpeg update completed successfully' })

    return { status: true, message: 'Updated FFmpeg successfully' }
  } catch (err) {
    try {
      if (cleanTemp) {
        if (fs.existsSync(zipFile)) {
          fs.unlinkSync(zipFile)
        }
        if (fs.existsSync(extractDir)) {
          fs.rmSync(extractDir, { recursive: true, force: true })
        }
      }
    } catch {
      // ignore
    }
    throw new Error(`Failed to install FFmpeg: ${err.message}`, { cause: err })
  }
}

module.exports = {
  checkYtDlpUpdate,
  installYtDlp,
  checkFfmpegUpdate,
  installFfmpeg
}
