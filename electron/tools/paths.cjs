const { app } = require('electron')
const { join } = require('path')
const fs = require('fs')

function getResourcesDir() {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources')
  }
  return join(process.cwd(), 'resources')
}

function getResourcePath(subPath) {
  return join(getResourcesDir(), subPath)
}

function readConfig() {
  const result = {}
  const configFile = join(app.getPath('userData'), 'config.env')
  try {
    const content = fs.readFileSync(configFile, 'utf8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      let value = trimmed.slice(eqIdx + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
        value = value.slice(1, -1)
      }
      result[key] = value
    }
  } catch (_) { }
  return result
}

function resolveToolPath(key, exeName) {
  const envValue = process.env[key]
  if (envValue) return envValue
  const config = readConfig()
  if (config[key]) return config[key]
  return getResourcePath(exeName)
}

// yt-dlp is the only external executable left: media work is WebCodecs and
// mediabunny in-process (ADR-028), so there is no binary to resolve for it.
function getToolsBinaries() {
  return {
    ytDlp: resolveToolPath('TOOLS_YTDLP_PATH', 'yt-dlp.exe')
  }
}

const { execFile } = require('child_process')

function verifyExecutable(filePath, type) {
  return new Promise((resolve) => {
    if (!filePath || !fs.existsSync(filePath)) {
      return resolve(false)
    }
    try {
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) {
        return resolve(false)
      }
    } catch {
      return resolve(false)
    }
    if (type !== 'ytDlp') return resolve(false)
    execFile(filePath, ['--version'], { timeout: 2000 }, (error, stdout, stderr) => {
      const output = (stdout + stderr).toLowerCase()
      resolve(output.includes('yt-dlp') || /^\d{4}\.\d{2}\.\d{2}/.test(output.trim()) || output.includes('youtube-dl'))
    })
  })
}

module.exports = { getResourcesDir, getResourcePath, getToolsBinaries, verifyExecutable }
