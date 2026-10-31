const { app, ipcMain } = require('electron')
const { autoUpdater } = require('electron-updater')
const https = require('https')

const moduleName = 'app-updater'

let mainWindow = null
let currentStatus = {
  state: 'idle', // 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  currentVersion: app.getVersion(),
  updateInfo: null,
  progress: {
    percent: 0,
    bytesPerSecond: 0,
    transferred: 0,
    total: 0
  },
  error: null
}

function sendToRenderer(channel, data) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    mainWindow.webContents.send(channel, JSON.parse(JSON.stringify(data)))
  } catch {
    // ignore
  }
}

function updateState(newState, patch = {}) {
  currentStatus = {
    ...currentStatus,
    state: newState,
    currentVersion: app.getVersion(),
    ...patch
  }
  sendToRenderer(`${moduleName}:status-changed`, currentStatus)
}

/**
 * Fetches latest release from GitHub API in dev mode for UI testing.
 */
function fetchLatestGitHubRelease() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/tuanmjnh/tm-tools-public/releases/latest',
      headers: {
        'User-Agent': 'tm-tools-updater/1.0',
        'Accept': 'application/vnd.github.v3+json'
      }
    }

    const req = https.get(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data))
          } catch (e) {
            reject(new Error('Failed to parse GitHub release JSON', { cause: e }))
          }
        } else {
          reject(new Error(`GitHub API returned status ${res.statusCode}: ${data}`))
        }
      })
    })

    req.on('error', reject)
    req.setTimeout(15000, () => req.destroy(new Error('GitHub API request timed out')))
  })
}

function initAutoUpdater() {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false

  autoUpdater.on('checking-for-update', () => {
    updateState('checking', { error: null })
  })

  autoUpdater.on('update-available', (info) => {
    updateState('available', {
      updateInfo: {
        version: info.version,
        releaseDate: info.releaseDate || '',
        releaseNotes: Array.isArray(info.releaseNotes)
          ? info.releaseNotes.map(n => typeof n === 'string' ? n : n.note).join('\n')
          : (info.releaseNotes || '')
      },
      error: null
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    updateState('not-available', {
      updateInfo: {
        version: info?.version || app.getVersion()
      },
      error: null
    })
  })

  autoUpdater.on('download-progress', (progressObj) => {
    updateState('downloading', {
      progress: {
        percent: Math.round(progressObj.percent || 0),
        bytesPerSecond: progressObj.bytesPerSecond || 0,
        transferred: progressObj.transferred || 0,
        total: progressObj.total || 0
      }
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    updateState('downloaded', {
      updateInfo: {
        version: info.version,
        releaseDate: info.releaseDate || '',
        releaseNotes: info.releaseNotes || ''
      },
      progress: { percent: 100, bytesPerSecond: 0, transferred: 0, total: 0 }
    })
  })

  autoUpdater.on('error', (err) => {
    updateState('error', {
      error: err?.message || 'Unknown update error'
    })
  })
}

function registerAppUpdaterController(win) {
  mainWindow = win
  initAutoUpdater()

  ipcMain.handle(`${moduleName}:getStatus`, () => {
    currentStatus.currentVersion = app.getVersion()
    return { status: true, data: currentStatus }
  })

  ipcMain.handle(`${moduleName}:checkForUpdates`, async () => {
    try {
      updateState('checking', { error: null })

      if (!app.isPackaged) {
        // In development mode, query GitHub Releases API directly for checking
        try {
          const release = await fetchLatestGitHubRelease()
          const latestVersion = (release.tag_name || '').replace(/^v/, '').trim()
          const currentVersion = app.getVersion()

          if (latestVersion && latestVersion !== currentVersion) {
            updateState('available', {
              updateInfo: {
                version: latestVersion,
                releaseDate: release.published_at || '',
                releaseNotes: release.body || ''
              },
              error: null
            })
            return {
              status: true,
              data: {
                hasUpdate: true,
                isDev: true,
                currentVersion,
                latestVersion,
                releaseNotes: release.body || ''
              }
            }
          }

          updateState('not-available', {
            updateInfo: { version: latestVersion || currentVersion },
            error: null
          })
          return {
            status: true,
            data: {
              hasUpdate: false,
              isDev: true,
              currentVersion,
              latestVersion: latestVersion || currentVersion
            }
          }
        } catch (devErr) {
          updateState('error', { error: `Dev update check failed: ${devErr.message}` })
          return { status: false, message: devErr.message }
        }
      }

      // Packaged production mode: use official electron-updater
      const checkResult = await autoUpdater.checkForUpdates()
      return { status: true, data: checkResult }
    } catch (e) {
      updateState('error', { error: e.message })
      return { status: false, message: e.message }
    }
  })

  ipcMain.handle(`${moduleName}:downloadUpdate`, async () => {
    try {
      if (!app.isPackaged) {
        // Simulation for development testing
        updateState('downloading', { progress: { percent: 0, bytesPerSecond: 1024 * 1024, transferred: 0, total: 100 } })
        let p = 0
        const interval = setInterval(() => {
          p += 20
          if (p >= 100) {
            clearInterval(interval)
            updateState('downloaded', { progress: { percent: 100, bytesPerSecond: 0, transferred: 100, total: 100 } })
          } else {
            updateState('downloading', { progress: { percent: p, bytesPerSecond: 2 * 1024 * 1024, transferred: p, total: 100 } })
          }
        }, 500)
        return { status: true, message: 'Simulated download started in dev mode' }
      }

      updateState('downloading', { progress: { percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 } })
      await autoUpdater.downloadUpdate()
      return { status: true }
    } catch (e) {
      updateState('error', { error: e.message })
      return { status: false, message: e.message }
    }
  })

  ipcMain.handle(`${moduleName}:quitAndInstall`, () => {
    if (!app.isPackaged) {
      return { status: true, message: 'quitAndInstall simulated in dev mode' }
    }
    // isSilent = false, isForceRunAfter = true
    autoUpdater.quitAndInstall(false, true)
    return { status: true }
  })
}

module.exports = {
  registerAppUpdaterController
}
