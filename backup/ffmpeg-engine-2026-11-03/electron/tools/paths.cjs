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

function getToolsBinaries() {
  return {
    ytDlp: resolveToolPath('TOOLS_YTDLP_PATH', 'yt-dlp.exe'),
    ffmpeg: resolveToolPath('TOOLS_FFMPEG_PATH', 'ffmpeg.exe'),
    ffprobe: resolveToolPath('TOOLS_FFPROBE_PATH', 'ffprobe.exe'),
    ffplay: resolveToolPath('TOOLS_FFPLAY_PATH', 'ffplay.exe')
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
    const args = type === 'ytDlp' ? ['--version'] : ['-version']
    execFile(filePath, args, { timeout: 2000 }, (error, stdout, stderr) => {
      // console.log('[verifyExecutable] file:', filePath, 'type:', type, 'error:', error, 'stdout:', stdout, 'stderr:', stderr)
      const output = (stdout + stderr).toLowerCase()
      if (type === 'ytDlp') {
        resolve(output.includes('yt-dlp') || /^\d{4}\.\d{2}\.\d{2}/.test(output.trim()) || output.includes('youtube-dl'))
      } else if (type === 'ffmpeg') {
        resolve(output.includes('ffmpeg version'))
      } else if (type === 'ffprobe') {
        resolve(output.includes('ffprobe version'))
      } else if (type === 'ffplay') {
        resolve(output.includes('ffplay version'))
      } else {
        resolve(false)
      }
    })
  })
}

module.exports = { getResourcesDir, getResourcePath, getToolsBinaries, verifyExecutable }
