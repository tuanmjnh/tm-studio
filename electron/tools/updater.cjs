const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) tm-studio-updater/1.0',
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) tm-studio/1.0',
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

module.exports = {
  checkYtDlpUpdate,
  installYtDlp
}
