const { ipcMain, app } = require('electron')
const { existsSync, mkdirSync, statSync } = require('fs')
const { spawn, execSync, execFile } = require('child_process')
const path = require('path')
const { getToolsBinaries, verifyExecutable } = require('./paths.cjs')
const { TaskProcessManager } = require('./task-manager.cjs')
const sqlite = require('./sqlite.cjs')
const { checkFfmpegUpdate, installFfmpeg } = require('./updater.cjs')

const isImageFile = (filePath) => {
  if (!filePath) return false
  return /\.(gif|jpg|jpe?g|tiff|png|img|ico|jfif|webp|bmp|svg)$/i.test(filePath)
}

const moduleName = 'tools:ffmpeg'
let taskManager = new TaskProcessManager(1, 200, 2, 30 * 60 * 1000)
let binaries = getToolsBinaries()
const updateUI = { delay: 500, lastSend: 0 }

function send(event, channel, data) {
  try {
    event.sender.send(channel, JSON.parse(JSON.stringify(data)))
  } catch {
    // ignore
  }
}

function resolveExecutable() {
  binaries = getToolsBinaries()
  return binaries
}

function buildResponse(task) {
  const meta = task.meta || {}
  return {
    taskId: meta.taskId,
    taskKey: meta.taskKey,
    thread: meta.thread,
    input: meta.input,
    inputs: meta.inputs,
    output: meta.output,
    outPath: meta.outPath,
    duration: meta.duration
  }
}

function initTaskManager(event, args) {
  taskManager = new TaskProcessManager(
    args?.threads || 1,
    args?.delay || 200,
    args?.maxRetry ?? 2,
    args?.timeout || 30 * 60 * 1000
  )
  updateUI.delay = args?.delayUI || 500
  send(event, `${moduleName}:managerInitialized`, args)
}

let cachedGpuSupport = null

function detectGpuSupport() {
  if (cachedGpuSupport) return cachedGpuSupport

  try {
    const ffmpegExe = resolveExecutable().ffmpeg
    const output = execSync(`"${ffmpegExe}" -hide_banner -encoders`, { encoding: 'utf8', stdio: 'pipe' })

    let gpus = []
    try {
      const cmd = 'powershell -Command "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"'
      const gpuOutput = execSync(cmd, { encoding: 'utf8', stdio: 'pipe' })
      gpus = gpuOutput.split('\n').map(line => line.trim()).filter(Boolean)
    } catch {
      // ignore
    }

    // Probe real encoder initialization (detect HW thật)
    let nvenc = false
    if (output.includes('h264_nvenc')) {
      try {
        execSync(`"${ffmpegExe}" -hide_banner -f lavfi -i color=s=64x64:d=0.04 -c:v h264_nvenc -f null -`, { stdio: 'pipe' })
        nvenc = true
      } catch {
        // probe failed — encoder unavailable at runtime
      }
    }

    let amf = false
    if (output.includes('h264_amf')) {
      try {
        execSync(`"${ffmpegExe}" -hide_banner -f lavfi -i color=s=64x64:d=0.04 -c:v h264_amf -f null -`, { stdio: 'pipe' })
        amf = true
      } catch {
        // probe failed — encoder unavailable at runtime
      }
    }

    let qsv = false
    if (output.includes('h264_qsv')) {
      try {
        execSync(`"${ffmpegExe}" -hide_banner -f lavfi -i color=s=64x64:d=0.04 -c:v h264_qsv -f null -`, { stdio: 'pipe' })
        qsv = true
      } catch {
        // probe failed — encoder unavailable at runtime
      }
    }

    cachedGpuSupport = {
      nvenc,
      amf,
      qsv,
      gpus
    }
    return cachedGpuSupport
  } catch {
    return { nvenc: false, amf: false, qsv: false, gpus: [] }
  }
}

function getToolVersion(exePath) {
  return new Promise((resolve) => {
    if (!exePath || !existsSync(exePath)) {
      return resolve('Not found')
    }
    execFile(exePath, ['-version'], { timeout: 3000 }, (error, stdout, stderr) => {
      if (error && !stdout) {
        return resolve(error.message || 'Error')
      }
      const output = stdout || stderr || ''
      const firstLine = output.split(/\r?\n/)[0]?.trim()
      resolve(firstLine || 'Unknown version')
    })
  })
}

async function getVersions() {
  const exe = resolveExecutable()
  const [ffmpegVer, ffprobeVer, ffplayVer] = await Promise.all([
    getToolVersion(exe.ffmpeg),
    getToolVersion(exe.ffprobe),
    getToolVersion(exe.ffplay)
  ])
  return {
    ffmpeg: ffmpegVer,
    ffprobe: ffprobeVer,
    ffplay: ffplayVer
  }
}

function getFileSizeSync(filePath) {
  try {
    if (filePath && existsSync(filePath)) {
      return statSync(filePath).size
    }
  } catch {
    // ignore
  }
  return 0
}

function substituteVariables(pattern, inputFile, configTitle, idx, outputDir) {
  const ext = path.extname(inputFile).slice(1)
  const name = path.basename(inputFile, path.extname(inputFile))
  const fulldir = path.dirname(inputFile).replace(/\\/g, '/')
  const folder = path.basename(fulldir)
  const outdir = outputDir ? outputDir.replace(/\\/g, '/') : fulldir

  const now = new Date()
  const dateStr = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0')
  const timeStr = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0') + String(now.getSeconds()).padStart(2, '0')
  const datetimeStr = `${dateStr}_${timeStr}`

  let result = pattern
    .replace(/{name}/g, name)
    .replace(/{ext}/g, ext)
    .replace(/{dirname}/g, outputDir ? outdir : fulldir)
    .replace(/{fulldir}/g, fulldir)
    .replace(/{outdir}/g, outdir)
    .replace(/{folder}/g, folder)
    .replace(/{date}/g, dateStr)
    .replace(/{datetime}/g, datetimeStr)
    .replace(/{config}/g, configTitle || 'default')
    .replace(/{idx}/g, String(idx + 1))

  if (outputDir && !path.isAbsolute(result)) {
    result = path.join(outdir, result)
  }

  return path.resolve(result).replace(/\\/g, '/')
}

function appendVideoAudioEncoderArgs(args, chosenEncoder, gpuSupport) {
  let vEncoder = 'libx264'
  if (chosenEncoder) {
    if (chosenEncoder === 'nvenc' && gpuSupport?.nvenc) vEncoder = 'h264_nvenc'
    else if (chosenEncoder === 'amf' && gpuSupport?.amf) vEncoder = 'h264_amf'
    else if (chosenEncoder === 'qsv' && gpuSupport?.qsv) vEncoder = 'h264_qsv'
  } else if (gpuSupport) {
    if (gpuSupport.nvenc) vEncoder = 'h264_nvenc'
    else if (gpuSupport.amf) vEncoder = 'h264_amf'
    else if (gpuSupport.qsv) vEncoder = 'h264_qsv'
  }

  if (vEncoder === 'libx264') {
    args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p')
  } else if (vEncoder === 'h264_nvenc') {
    args.push('-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '23', '-pix_fmt', 'yuv420p')
  } else if (vEncoder === 'h264_amf') {
    args.push('-c:v', 'h264_amf', '-quality', 'balanced', '-pix_fmt', 'yuv420p')
  } else if (vEncoder === 'h264_qsv') {
    args.push('-c:v', 'h264_qsv', '-global_quality', '23', '-pix_fmt', 'nv12')
  } else {
    args.push('-c:v', vEncoder, '-pix_fmt', 'yuv420p')
  }

  args.push('-c:a', 'aac', '-b:a', '128k')
}

function hasAudioStream(filePath) {
  try {
    const ffprobeExe = resolveExecutable().ffprobe
    const out = execSync(`"${ffprobeExe}" -v error -select_streams a -show_entries stream=index -of csv=p=0 "${filePath}"`, { encoding: 'utf8', stdio: 'pipe' })
    return out.trim().length > 0
  } catch {
    return true
  }
}

function buildFfmpegArgs(input, output, config, gpuSupport, chosenEncoder, seekOptions = {}) {
  const args = ['-y']

  // Parse sub-files first
  let subFiles = []
  if (config) {
    if (typeof config.files === 'string') {
      try {
        subFiles = JSON.parse(config.files)
      } catch {
        // ignore
      }
    } else if (Array.isArray(config.files)) {
      subFiles = config.files
    }
  }
  subFiles = subFiles.filter(f => f.hidden !== true)

  // Inputs
  if (seekOptions.seekStart !== undefined && seekOptions.seekStart !== null && seekOptions.seekStart >= 0) {
    args.push('-ss', String(seekOptions.seekStart))
  }
  if (seekOptions.duration !== undefined && seekOptions.duration !== null && seekOptions.duration > 0) {
    args.push('-t', String(seekOptions.duration))
  }
  args.push('-i', input)

  let inputCount = 1
  let bgInputIndex = -1
  let hasBgFile = false
  if (config && config.background_type === 'file' && config.background_file) {
    if (isImageFile(config.background_file)) {
      args.push('-loop', '1')
    } else {
      args.push('-stream_loop', '-1')
    }
    args.push('-i', config.background_file)
    bgInputIndex = inputCount
    inputCount++
    hasBgFile = true
  }

  const subFileInputIndices = []
  if (subFiles && subFiles.length > 0) {
    subFiles.forEach((file) => {
      if (isImageFile(file.path)) {
        args.push('-loop', '1')
      } else {
        args.push('-stream_loop', '-1')
      }
      args.push('-i', file.path)
      subFileInputIndices.push(inputCount)
      inputCount++
    })
  }

  // Video filter construction
  let filterComplex = ''
  let currentTag = '[0:v]'

  if (config) {
    // 1. Zoom (static center scale & crop to avoid zoompan errors)
    if (config.zoom_enable && config.zoom_ratio > 1) {
      const z = config.zoom_ratio
      filterComplex += `${currentTag}scale=w=iw*${z}:h=ih*${z},crop=w=iw:h=ih[vzoom];`
      currentTag = '[vzoom]'
    }

    // 2. Flips
    if (config.hflip_enable) {
      if (config.hflip_all) {
        filterComplex += `${currentTag}hflip[vhflip];`
        currentTag = '[vhflip]'
      } else {
        const start = config.hflip_time_start || 0
        const dur = config.hflip_time_duration || 0
        filterComplex += `${currentTag}hflip=enable='between(t,${start},${start + dur})'[vhflip];`
        currentTag = '[vhflip]'
      }
    }
    if (config.vflip_enable) {
      if (config.vflip_all) {
        filterComplex += `${currentTag}vflip[vvflip];`
        currentTag = '[vvflip]'
      } else {
        const start = config.vflip_time_start || 0
        const dur = config.vflip_time_duration || 0
        filterComplex += `${currentTag}vflip=enable='between(t,${start},${start + dur})'[vvflip];`
        currentTag = '[vvflip]'
      }
    }

    // 3. Aspect Ratio & Background
    if (config.aspect_ratio > 0) {
      let tw = 1920, th = 1080
      if (config.aspect_ratio === 2) {
        tw = 1080
        th = 1920
      } else if (config.aspect_ratio === 3) {
        tw = 1080
        th = 1080
      } else if (config.aspect_ratio === 4) {
        tw = 1440
        th = 1080
      }

      if (config.background_type === 'color') {
        const color = config.background_color || '#000000'
        filterComplex += `color=c=${color}:s=${tw}x${th}[vbg];`
        filterComplex += `${currentTag}scale=${tw}:${th}:force_original_aspect_ratio=decrease[vfg];`
        filterComplex += `[vbg][vfg]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2[vbgoverlay];`
        currentTag = '[vbgoverlay]'
      } else if (config.background_type === 'boxblur') {
        const blur = config.background_boxblur || 10
        filterComplex += `${currentTag}split[vsplit1][vsplit2];`
        filterComplex += `[vsplit1]scale=${tw}:${th}:force_original_aspect_ratio=increase,crop=${tw}:${th},boxblur=${blur}[vbg];`
        filterComplex += `[vsplit2]scale=${tw}:${th}:force_original_aspect_ratio=decrease[vfg];`
        filterComplex += `[vbg][vfg]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2[vbgoverlay];`
        currentTag = '[vbgoverlay]'
      } else if (config.background_type === 'file' && hasBgFile) {
        filterComplex += `[${bgInputIndex}:v]scale=${tw}:${th}[vbg];`
        filterComplex += `${currentTag}scale=${tw}:${th}:force_original_aspect_ratio=decrease[vfg];`
        filterComplex += `[vbg][vfg]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2:shortest=1[vbgoverlay];`
        currentTag = '[vbgoverlay]'
      }
    }

    // 4. Scale
    if (config.scale_w > 0 && config.scale_h > 0) {
      const sw = Math.max(2, Math.floor(config.scale_w / 2) * 2)
      const sh = Math.max(2, Math.floor(config.scale_h / 2) * 2)
      filterComplex += `${currentTag}scale=${sw}:${sh}[vscale];`
      currentTag = '[vscale]'
    }

    // 4.5. Sub-files (Image & Video overlays)
    if (subFiles && subFiles.length > 0) {
      subFiles.forEach((file, idx) => {
        const inputIdx = subFileInputIndices[idx]
        const w = Math.max(2, Math.floor((file.w || 100) / 2) * 2)
        const h = Math.max(2, Math.floor((file.h || 100) / 2) * 2)
        const x = Math.round(file.x || 0)
        const y = Math.round(file.y || 0)
        const subTag = `vsubfile${idx}`
        const overlayTag = `vsuboverlay${idx}`

        filterComplex += `[${inputIdx}:v]scale=${w}:${h}[${subTag}];`
        filterComplex += `${currentTag}[${subTag}]overlay=${x}:${y}:shortest=1[${overlayTag}];`
        currentTag = `[${overlayTag}]`
      })
    }

    // 5. Labels (Text overlay)
    let labels = []
    if (typeof config.labels === 'string') {
      try {
        labels = JSON.parse(config.labels)
      } catch {
        // ignore
      }
    } else if (Array.isArray(config.labels)) {
      labels = config.labels
    }
    labels = labels.filter(l => l.hidden !== true)

    if (labels && labels.length > 0) {
      const isWin = process.platform === 'win32'
      labels.forEach((lbl, idx) => {
        const text = (lbl.text || '').replace(/'/g, '\'\\\\\'\'')
        const color = lbl.color || 'white'
        const resizeMode = lbl.resizeMode || 'scale'
        const scaleX = resizeMode === 'scale' ? (lbl.scaleX ?? 1) : 1
        const size = Math.max(8, Math.round((lbl.size || 24) * scaleX))
        const x = Math.round(lbl.x || 0)
        const y = Math.round(lbl.y || 0)

        let boxBorder = ''
        if (lbl.box) {
          const bColor = lbl.boxColor || '#A3A3A3'
          const bOpacity = lbl.boxOpacity ?? 0.5
          const bBorderW = Math.round((lbl.boxBorderW || 10) * scaleX)
          boxBorder = `:box=1:boxcolor=${bColor}@${bOpacity}:boxborderw=${bBorderW}`
        }

        const fontParam = isWin ? 'fontfile=\'C\\:/Windows/Fonts/arial.ttf\'' : 'font=\'Arial\''
        const tag = `vlabel${idx}`
        filterComplex += `${currentTag}drawtext=${fontParam}:text='${text}':fontcolor=${color}:fontsize=${size}:x=${x}:y=${y}${boxBorder}[${tag}];`
        currentTag = `[${tag}]`
      })
    }

    // 6. Subtitles
    if (config.subtitle) {
      const escapedSubPath = config.subtitle.replace(/\\/g, '/').replace(/:/g, '\\:')
      filterComplex += `${currentTag}subtitles='${escapedSubPath}'[vsub];`
      currentTag = '[vsub]'
    }

    // 7. Speed
    if (config.speed && config.speed !== 1) {
      filterComplex += `${currentTag}setpts=1/${config.speed}*PTS[vspeed];`
      currentTag = '[vspeed]'
    }
  }

  // Ensure final output dimensions are always even numbers (divisible by 2) for H.264/H.265
  if (filterComplex) {
    filterComplex += `${currentTag}scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1[vout];`
    currentTag = '[vout]'

    if (filterComplex.endsWith(';')) {
      filterComplex = filterComplex.slice(0, -1)
    }
    args.push('-filter_complex', filterComplex, '-map', currentTag)
  } else {
    args.push('-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1')
  }

  // Audio filters
  let audioFilters = []
  if (config) {
    if (config.speed && config.speed !== 1) {
      let s = config.speed
      while (s > 2) {
        audioFilters.push('atempo=2.0')
        s /= 2
      }
      while (s < 0.5) {
        audioFilters.push('atempo=0.5')
        s /= 0.5
      }
      audioFilters.push(`atempo=${s}`)
    }
    if (config.volume !== undefined && config.volume !== 1) {
      audioFilters.push(`volume=${config.volume}`)
    }
  }

  if (audioFilters.length > 0) {
    args.push('-filter:a', audioFilters.join(','))
  } else {
    // Map default audio
    args.push('-map', '0:a?')
  }

  appendVideoAudioEncoderArgs(args, chosenEncoder, gpuSupport)
  args.push('-y', output)

  return args
}

function buildSplitArgs(input, output, startTime, duration, config, gpuSupport, chosenEncoder) {
  if (config) {
    return buildFfmpegArgs(input, output, config, gpuSupport, chosenEncoder, { seekStart: startTime, duration })
  }
  const args = ['-y']
  if (startTime !== undefined && startTime !== null && startTime >= 0) {
    args.push('-ss', String(startTime))
  }
  if (duration !== undefined && duration !== null && duration > 0) {
    args.push('-t', String(duration))
  }
  args.push('-i', input, '-c', 'copy', '-avoid_negative_ts', 'make_zero', output)
  return args
}

function buildJoinArgs(inputFiles, output, config, gpuSupport, chosenEncoder) {
  if (!Array.isArray(inputFiles) || inputFiles.length === 0) {
    return ['-y']
  }
  if (inputFiles.length === 1) {
    if (config) {
      return buildFfmpegArgs(inputFiles[0], output, config, gpuSupport, chosenEncoder)
    }
    return ['-y', '-i', inputFiles[0], '-c', 'copy', output]
  }

  const args = ['-y']
  inputFiles.forEach((file) => {
    if (isImageFile(file)) {
      args.push('-loop', '1')
    }
    args.push('-i', file)
  })

  // Parse config subFiles and background file if config exists
  let subFiles = []
  if (config) {
    if (typeof config.files === 'string') {
      try {
        subFiles = JSON.parse(config.files)
      } catch {
        // ignore
      }
    } else if (Array.isArray(config.files)) {
      subFiles = config.files
    }
  }
  subFiles = subFiles.filter(f => f.hidden !== true)

  let inputCount = inputFiles.length
  let bgInputIndex = -1
  let hasBgFile = false
  if (config && config.background_type === 'file' && config.background_file) {
    if (isImageFile(config.background_file)) {
      args.push('-loop', '1')
    } else {
      args.push('-stream_loop', '-1')
    }
    args.push('-i', config.background_file)
    bgInputIndex = inputCount
    inputCount++
    hasBgFile = true
  }

  const subFileInputIndices = []
  if (subFiles && subFiles.length > 0) {
    subFiles.forEach((file) => {
      if (isImageFile(file.path)) {
        args.push('-loop', '1')
      } else {
        args.push('-stream_loop', '-1')
      }
      args.push('-i', file.path)
      subFileInputIndices.push(inputCount)
      inputCount++
    })
  }

  // Normalize each input video stream to 1920x1080, uniform fps/sar/pix_fmt and ensure audio sync
  let filterComplex = ''
  for (let i = 0; i < inputFiles.length; i++) {
    const isImg = isImageFile(inputFiles[i])
    if (isImg) {
      const imgDur = 3.0
      filterComplex += `[${i}:v]trim=duration=${imgDur},setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[vnorm${i}];`
      filterComplex += `anullsrc=r=44100:cl=stereo,atrim=0:${imgDur},asetpts=PTS-STARTPTS[anorm${i}];`
    } else {
      filterComplex += `[${i}:v]setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[vnorm${i}];`
      if (hasAudioStream(inputFiles[i])) {
        filterComplex += `[${i}:a]asetpts=PTS-STARTPTS,aformat=sample_rates=44100:channel_layouts=stereo[anorm${i}];`
      } else {
        let dur = 10
        try {
          const ffprobeExe = resolveExecutable().ffprobe
          const durOut = execSync(`"${ffprobeExe}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputFiles[i]}"`, { encoding: 'utf8', stdio: 'pipe' })
          dur = parseFloat(durOut) || 10
        } catch {
          // ignore
        }
        filterComplex += `anullsrc=r=44100:cl=stereo,atrim=0:${dur},asetpts=PTS-STARTPTS[anorm${i}];`
      }
    }
  }

  const concatInputs = inputFiles.map((_, i) => `[vnorm${i}][anorm${i}]`).join('')
  filterComplex += `${concatInputs}concat=n=${inputFiles.length}:v=1:a=1[vjoined][ajoined];`

  let currentTag = '[vjoined]'
  let currentAudioTag = '[ajoined]'

  if (config) {
    // 1. Zoom
    if (config.zoom_enable && config.zoom_ratio > 1) {
      const z = config.zoom_ratio
      filterComplex += `${currentTag}scale=w=iw*${z}:h=ih*${z},crop=w=iw:h=ih[vzoom];`
      currentTag = '[vzoom]'
    }

    // 2. Flips
    if (config.hflip_enable) {
      if (config.hflip_all) {
        filterComplex += `${currentTag}hflip[vhflip];`
        currentTag = '[vhflip]'
      } else {
        const start = config.hflip_time_start || 0
        const dur = config.hflip_time_duration || 0
        filterComplex += `${currentTag}hflip=enable='between(t,${start},${start + dur})'[vhflip];`
        currentTag = '[vhflip]'
      }
    }
    if (config.vflip_enable) {
      if (config.vflip_all) {
        filterComplex += `${currentTag}vflip[vvflip];`
        currentTag = '[vvflip]'
      } else {
        const start = config.vflip_time_start || 0
        const dur = config.vflip_time_duration || 0
        filterComplex += `${currentTag}vflip=enable='between(t,${start},${start + dur})'[vvflip];`
        currentTag = '[vvflip]'
      }
    }

    // 3. Aspect Ratio & Background
    if (config.aspect_ratio > 0) {
      let tw = 1920, th = 1080
      if (config.aspect_ratio === 2) {
        tw = 1080
        th = 1920
      } else if (config.aspect_ratio === 3) {
        tw = 1080
        th = 1080
      } else if (config.aspect_ratio === 4) {
        tw = 1440
        th = 1080
      }

      if (config.background_type === 'color') {
        const color = config.background_color || '#000000'
        filterComplex += `color=c=${color}:s=${tw}x${th}[vbg];`
        filterComplex += `${currentTag}scale=${tw}:${th}:force_original_aspect_ratio=decrease[vfg];`
        filterComplex += `[vbg][vfg]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2[vbgoverlay];`
        currentTag = '[vbgoverlay]'
      } else if (config.background_type === 'boxblur') {
        const blur = config.background_boxblur || 10
        filterComplex += `${currentTag}split[vsplit1][vsplit2];`
        filterComplex += `[vsplit1]scale=${tw}:${th}:force_original_aspect_ratio=increase,crop=${tw}:${th},boxblur=${blur}[vbg];`
        filterComplex += `[vsplit2]scale=${tw}:${th}:force_original_aspect_ratio=decrease[vfg];`
        filterComplex += `[vbg][vfg]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2[vbgoverlay];`
        currentTag = '[vbgoverlay]'
      } else if (config.background_type === 'file' && hasBgFile) {
        filterComplex += `[${bgInputIndex}:v]scale=${tw}:${th}[vbg];`
        filterComplex += `${currentTag}scale=${tw}:${th}:force_original_aspect_ratio=decrease[vfg];`
        filterComplex += `[vbg][vfg]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2:shortest=1[vbgoverlay];`
        currentTag = '[vbgoverlay]'
      }
    }

    // 4. Scale
    if (config.scale_w > 0 && config.scale_h > 0) {
      const sw = Math.max(2, Math.floor(config.scale_w / 2) * 2)
      const sh = Math.max(2, Math.floor(config.scale_h / 2) * 2)
      filterComplex += `${currentTag}scale=${sw}:${sh}[vscale];`
      currentTag = '[vscale]'
    }

    // 4.5. Sub-files
    if (subFiles && subFiles.length > 0) {
      subFiles.forEach((file, idx) => {
        const inputIdx = subFileInputIndices[idx]
        const w = Math.max(2, Math.floor((file.w || 100) / 2) * 2)
        const h = Math.max(2, Math.floor((file.h || 100) / 2) * 2)
        const x = Math.round(file.x || 0)
        const y = Math.round(file.y || 0)
        const subTag = `vsubfile${idx}`
        const overlayTag = `vsuboverlay${idx}`

        filterComplex += `[${inputIdx}:v]scale=${w}:${h}[${subTag}];`
        filterComplex += `${currentTag}[${subTag}]overlay=${x}:${y}:shortest=1[${overlayTag}];`
        currentTag = `[${overlayTag}]`
      })
    }

    // 5. Labels
    let labels = []
    if (typeof config.labels === 'string') {
      try {
        labels = JSON.parse(config.labels)
      } catch {
        // ignore
      }
    } else if (Array.isArray(config.labels)) {
      labels = config.labels
    }
    labels = labels.filter(l => l.hidden !== true)

    if (labels && labels.length > 0) {
      const isWin = process.platform === 'win32'
      labels.forEach((lbl, idx) => {
        const text = (lbl.text || '').replace(/'/g, '\'\\\\\'\'')
        const color = lbl.color || 'white'
        const resizeMode = lbl.resizeMode || 'scale'
        const scaleX = resizeMode === 'scale' ? (lbl.scaleX ?? 1) : 1
        const size = Math.max(8, Math.round((lbl.size || 24) * scaleX))
        const x = Math.round(lbl.x || 0)
        const y = Math.round(lbl.y || 0)

        let boxBorder = ''
        if (lbl.box) {
          const bColor = lbl.boxColor || '#A3A3A3'
          const bOpacity = lbl.boxOpacity ?? 0.5
          const bBorderW = Math.round((lbl.boxBorderW || 10) * scaleX)
          boxBorder = `:box=1:boxcolor=${bColor}@${bOpacity}:boxborderw=${bBorderW}`
        }

        const fontParam = isWin ? 'fontfile=\'C\\:/Windows/Fonts/arial.ttf\'' : 'font=\'Arial\''
        const tag = `vlabel${idx}`
        filterComplex += `${currentTag}drawtext=${fontParam}:text='${text}':fontcolor=${color}:fontsize=${size}:x=${x}:y=${y}${boxBorder}[${tag}];`
        currentTag = `[${tag}]`
      })
    }

    // 6. Subtitles
    if (config.subtitle) {
      const escapedSubPath = config.subtitle.replace(/\\/g, '/').replace(/:/g, '\\:')
      filterComplex += `${currentTag}subtitles='${escapedSubPath}'[vsub];`
      currentTag = '[vsub]'
    }

    // 7. Speed
    if (config.speed && config.speed !== 1) {
      filterComplex += `${currentTag}setpts=1/${config.speed}*PTS[vspeed];`
      currentTag = '[vspeed]'
    }
  }

  // Ensure divisible by 2
  filterComplex += `${currentTag}scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1[vout];`
  currentTag = '[vout]'

  // Audio filters
  let audioFilters = []
  if (config) {
    if (config.speed && config.speed !== 1) {
      let s = config.speed
      while (s > 2) {
        audioFilters.push('atempo=2.0')
        s /= 2
      }
      while (s < 0.5) {
        audioFilters.push('atempo=0.5')
        s /= 0.5
      }
      audioFilters.push(`atempo=${s}`)
    }
    if (config.volume !== undefined && config.volume !== 1) {
      audioFilters.push(`volume=${config.volume}`)
    }
  }

  if (audioFilters.length > 0) {
    filterComplex += `${currentAudioTag}${audioFilters.join(',')}[aout];`
    currentAudioTag = '[aout]'
  }

  if (filterComplex.endsWith(';')) {
    filterComplex = filterComplex.slice(0, -1)
  }

  args.push('-filter_complex', filterComplex, '-map', currentTag, '-map', currentAudioTag)
  appendVideoAudioEncoderArgs(args, chosenEncoder, gpuSupport)
  args.push('-r', '30', '-fps_mode', 'cfr', '-ar', '44100', '-y', output)

  return args
}

function buildAudioToolArgs(input, output, audioMode, options = {}) {
  const args = ['-y', '-i', input]

  if (audioMode === 'extract') {
    const ext = path.extname(output).toLowerCase()
    args.push('-vn')
    if (ext === '.mp3') {
      args.push('-c:a', 'libmp3lame', '-q:a', '2')
    } else if (ext === '.wav') {
      args.push('-c:a', 'pcm_s16le')
    } else {
      args.push('-c:a', 'aac', '-b:a', '192k')
    }
    args.push(output)
  } else if (audioMode === 'mute') {
    args.push('-c:v', 'copy', '-an', output)
  } else if (audioMode === 'replace_bgm') {
    const audioFile = options.audioFile
    if (!audioFile) {
      throw new Error('Audio file is required for replace_bgm')
    }
    args.push('-i', audioFile)
    const volume = options.volume !== undefined ? Number(options.volume) : 1.0
    if (volume !== 1.0) {
      args.push('-filter:a', `volume=${volume}`)
    }
    args.push('-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', output)
  } else if (audioMode === 'mix_bgm') {
    const audioFile = options.audioFile
    if (!audioFile) {
      throw new Error('Audio file is required for mix_bgm')
    }
    const origVol = options.origVolume !== undefined ? Number(options.origVolume) : 1.0
    const bgmVol = options.bgmVolume !== undefined ? Number(options.bgmVolume) : 0.4
    args.push('-stream_loop', '-1', '-i', audioFile)
    const filter = `[0:a]volume=${origVol}[a0];[1:a]volume=${bgmVol}[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[aout]`
    args.push('-filter_complex', filter, '-map', '0:v:0', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', output)
  } else {
    args.push('-c', 'copy', output)
  }

  return args
}

const XFADE_TRANSITIONS = [
  'fade', 'wipeleft', 'wiperight', 'wipeup', 'wipedown',
  'slideleft', 'slideright', 'slideup', 'slidedown',
  'circlecrop', 'rectcrop', 'distance', 'fadeblack', 'fadewhite',
  'radial', 'smoothleft', 'smoothright', 'smoothup', 'smoothdown',
  'circleopen', 'circleclose', 'vertopen', 'vertclose', 'horzopen', 'horzclose',
  'dissolve', 'pixelize'
]

// ---------------------------------------------------------------------------
// Shared transition resolution (R128).
//
// Mirror of the render-side catalog `app/utils/tmcut/fxCatalog.ts`. The
// packaged app ships only electron/** and .output/** (electron-builder.yml
// `files:`), so this CommonJS main-process file cannot `require` the
// Nuxt/TypeScript module — this block is therefore the CJS twin of
// `xfadeNameFor()`. tests/unit/tmcut_fx_catalog.spec.ts extracts the block
// between the markers below and asserts it resolves identically — table for
// table and input for input — to the app catalog, so the app graph and the
// legacy image2video path can never disagree.
// FXCATALOG-MIRROR-BEGIN
const FXCATALOG_LEGACY_ALIASES = [
  ['fade', 'fade'],
  ['dissolve', 'dissolve'],
  ['wipe-left', 'wipeleft'],
  ['wipe-right', 'wiperight'],
  ['slide-left', 'slideleft'],
  ['zoom-in', 'zoomin']
]

// Documented FFmpeg xfade names (`ffmpeg -h filter=xfade`). Kept verbatim in
// sync with FFMPEG_XFADE_NAMES in app/utils/tmcut/fxCatalog.ts.
const FFMPEG_XFADE_NAMES = [
  'circleclose', 'circlecrop', 'circleopen', 'coverdown', 'coverleft', 'coverright',
  'coverup', 'custom', 'diagbl', 'diagbr', 'diagtl', 'diagtr', 'distance', 'dissolve',
  'fade', 'fadeblack', 'fadefast', 'fadegrays', 'fadeslow', 'fadewhite', 'hblur',
  'hlslice', 'hlwind', 'horzclose', 'horzopen', 'hrslice', 'hrwind', 'pixelize',
  'radial', 'rectcrop', 'revealdown', 'revealleft', 'revealright', 'revealup',
  'slideleft', 'slideright', 'slidedown', 'slideup', 'smoothdown', 'smoothleft',
  'smoothright', 'smoothup', 'squeezeh', 'squeezev', 'vertclose', 'vertopen',
  'vdslice', 'vdwind', 'vuslice', 'vuwind', 'wipebl', 'wipebr', 'wipedown',
  'wipeleft', 'wiperight', 'wipetl', 'wipetr', 'wipeup', 'zoomin'
]

/**
 * Resolves a stored transition key to an FFmpeg xfade name. Legacy TMCut keys
 * resolve through their alias; an unknown key that is already a documented
 * xfade name passes through (except `custom`, which needs an expr); anything
 * else falls back to `fade` so an unknown/garbage key can never produce a
 * broken filter graph.
 */
function xfadeNameFor(key) {
  if (typeof key === 'string') {
    for (const [name, xfade] of FXCATALOG_LEGACY_ALIASES) {
      if (name === key) return xfade
    }
    if (key !== 'custom' && FFMPEG_XFADE_NAMES.includes(key)) return key
  }
  return 'fade'
}
// FXCATALOG-MIRROR-END

function buildImage2VideoArgs(images, output, settings = {}, gpuSupport = {}, chosenEncoder = 'cpu') {
  const fps = settings.fps || 30
  const width = settings.width || 1920
  const height = settings.height || 1080
  const bitrate = settings.bitrate || '5000k'
  const zoomEffect = settings.zoomEffect || 'random'
  const blurBackground = settings.blurBackground !== false
  const transitionEffect = settings.transitionEffect || 'random'
  const transitionDuration = settings.transitionDuration || 0.8
  const imageDurations = settings.imageDurations || images.map(() => 3.0)
  const audioFile = settings.audioFile && existsSync(settings.audioFile) ? settings.audioFile : null
  const audioVolume = settings.audioVolume || 1.0

  const args = ['-y']

  images.forEach((img) => {
    args.push('-i', img)
  })

  let hasAudio = false
  if (audioFile) {
    args.push('-i', audioFile)
    hasAudio = true
  }

  const filterComplex = []
  const w = width
  const h = height
  let prevZoomMode = null

  for (let i = 0; i < images.length; i++) {
    const dur = imageDurations[i] || 3.0
    const totalFrames = Math.max(1, Math.floor(dur * fps))

    let mode = zoomEffect
    if (mode === 'random') {
      if (prevZoomMode === 'in') mode = 'out'
      else if (prevZoomMode === 'out') mode = 'in'
      else mode = Math.random() > 0.5 ? 'in' : 'out'
      prevZoomMode = mode
    }

    const ratio = blurBackground ? 0.85 : 1.0

    if (blurBackground) {
      const shrinkW = Math.max(2, Math.floor((w * 4 * ratio) / 2) * 2)
      const shrinkH = Math.max(2, Math.floor((h * 4 * ratio) / 2) * 2)
      const splitOverlay = `[${i}:v]split=2[bg_raw${i}][fg_raw${i}];`
        + `[bg_raw${i}]scale=${w * 4}:${h * 4}:force_original_aspect_ratio=increase,crop=${w * 4}:${h * 4},boxblur=40:3[bg_blurred${i}];`
        + `[fg_raw${i}]scale=${shrinkW}:${shrinkH}:force_original_aspect_ratio=decrease[fg_scaled${i}];`
        + `[bg_blurred${i}][fg_scaled${i}]overlay=(W-w)/2:(H-h)/2[v_prezoom${i}]`
      filterComplex.push(splitOverlay)
    } else {
      filterComplex.push(`[${i}:v]scale=${w * 4}:${h * 4}:force_original_aspect_ratio=decrease,pad=${w * 4}:${h * 4}:(ow-iw)/2:(oh-ih)/2:color=black[v_prezoom${i}]`)
    }

    let zExpr = '1.0'
    let xExpr = '0'
    let yExpr = '0'

    if (mode !== 'none') {
      const currMaxZoom = blurBackground ? 1.0 / ratio : 1.15
      const zoomRange = currMaxZoom - 1.0
      const speed = (zoomRange / totalFrames).toFixed(6)

      if (mode === 'out') {
        zExpr = `${currMaxZoom.toFixed(4)}-on*${speed}`
      } else {
        zExpr = `1.0+on*${speed}`
      }
      xExpr = 'iw/2-(iw/zoom/2)'
      yExpr = 'ih/2-(ih/zoom/2)'
    }

    const filtersPost = [
      `zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=${totalFrames}:s=${w}x${h}:fps=${fps}`,
      `scale=${w}:${h},setsar=1`
    ]
    filterComplex.push(`[v_prezoom${i}]${filtersPost.join(',')}[v${i}]`)
  }

  let currentV = '[v0]'
  let cumulativeOffset = 0.0

  let availableTransitions = XFADE_TRANSITIONS
  if (Array.isArray(settings.transitions) && settings.transitions.length > 0) {
    availableTransitions = settings.transitions
  } else if (transitionEffect && transitionEffect !== 'random') {
    availableTransitions = [transitionEffect]
  }

  for (let i = 1; i < images.length; i++) {
    const durPrev = imageDurations[i - 1] || 3.0
    const tDur = Math.min(transitionDuration, durPrev * 0.4)
    cumulativeOffset += (durPrev - tDur)
    const offsetVal = Math.max(0, cumulativeOffset).toFixed(3)

    const trans = xfadeNameFor(availableTransitions[Math.floor(Math.random() * availableTransitions.length)] || 'fade')

    const newV = `[vt${i}]`
    filterComplex.push(`${currentV}[v${i}]xfade=transition=${trans}:duration=${tDur.toFixed(2)}:offset=${offsetVal}${newV}`)
    currentV = newV
  }

  if (hasAudio) {
    const audioIdx = images.length
    filterComplex.push(`[${audioIdx}:a]volume=${audioVolume}[afinal]`)
  }

  args.push('-filter_complex', filterComplex.join(';'))
  args.push('-map', currentV)

  if (hasAudio) {
    args.push('-map', '[afinal]', '-shortest')
  }

  let vEncoder = 'libx264'
  if (chosenEncoder === 'nvenc' && gpuSupport.nvenc) vEncoder = 'h264_nvenc'
  else if (chosenEncoder === 'amf' && gpuSupport.amf) vEncoder = 'h264_amf'
  else if (chosenEncoder === 'qsv' && gpuSupport.qsv) vEncoder = 'h264_qsv'

  if (vEncoder === 'libx264') {
    args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '23')
  } else if (vEncoder === 'h264_nvenc') {
    args.push('-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '23')
  } else if (vEncoder === 'h264_amf') {
    args.push('-c:v', 'h264_amf', '-quality', 'balanced')
  } else if (vEncoder === 'h264_qsv') {
    args.push('-c:v', 'h264_qsv', '-global_quality', '23')
  } else {
    args.push('-c:v', vEncoder)
  }

  if (hasAudio) {
    args.push('-c:a', 'aac', '-b:a', '128k')
  }

  args.push('-b:v', bitrate, '-pix_fmt', 'yuv420p', '-r', String(fps), '-fps_mode', 'cfr')
  args.push('-y', output)

  return args
}

function resolveTasks(args) {
  const gpuSupport = detectGpuSupport()
  const exe = resolveExecutable().ffmpeg

  return (args || []).map((task, i) => {
    const meta = task.meta || {}
    let finalArgs = task.args

    // Resolve output via variables substitution
    if (meta.outputPattern) {
      const substitutedOutput = substituteVariables(meta.outputPattern, meta.input, meta.configTitle, i, meta.outputDir)
      meta.output = substitutedOutput
    }

    if (meta.operation === 'image2video' && Array.isArray(meta.images) && meta.images.length > 0) {
      finalArgs = buildImage2VideoArgs(meta.images, meta.output, meta.settings, gpuSupport, task.options?.encoder)
    } else if ((meta.operation === 'join' || meta.operation === 'join_render') && Array.isArray(meta.joinFiles) && meta.joinFiles.length > 0) {
      const config = meta.config || (meta.configId ? sqlite.getFfmpegConfig(meta.configId) : null)
      finalArgs = buildJoinArgs(meta.joinFiles, meta.output, config, gpuSupport, task.options?.encoder)
    } else if (meta.operation === 'split' || meta.operation === 'split_render') {
      const config = meta.config || (meta.configId ? sqlite.getFfmpegConfig(meta.configId) : null)
      finalArgs = buildSplitArgs(meta.input, meta.output, meta.splitStartTime, meta.splitDuration, config, gpuSupport, task.options?.encoder)
    } else if (meta.operation === 'audio_tool') {
      finalArgs = buildAudioToolArgs(meta.input, meta.output, meta.audioMode, meta.audioOptions)
    } else {
      const config = meta.config || (meta.configId ? sqlite.getFfmpegConfig(meta.configId) : null)
      if (config) {
        finalArgs = buildFfmpegArgs(meta.input, meta.output, config, gpuSupport, task.options?.encoder)
      }
    }

    if (meta.output) {
      const outDir = path.dirname(meta.output)
      if (outDir && !existsSync(outDir)) {
        mkdirSync(outDir, { recursive: true })
      }
    }

    return {
      ...task,
      command: exe,
      args: finalArgs,
      meta: { ...meta, taskKey: i, thread: i }
    }
  })
}

function setTasks(event, args) {
  const tasks = resolveTasks(args)
  taskManager.setTasks(tasks)
}

function setGroupTasks(event, args) {
  const exe = resolveExecutable().ffmpeg
  const gpuSupport = detectGpuSupport()
  const groups = (args || []).map((group, g) => group.map((task, j) => {
    const meta = task.meta || {}
    let finalArgs = task.args

    if (meta.outputPattern) {
      const substitutedOutput = substituteVariables(meta.outputPattern, meta.input, meta.configTitle, g, meta.outputDir)
      meta.output = substitutedOutput
    }

    if (meta.operation === 'image2video' && Array.isArray(meta.images) && meta.images.length > 0) {
      finalArgs = buildImage2VideoArgs(meta.images, meta.output, meta.settings, gpuSupport)
    } else if ((meta.operation === 'join' || meta.operation === 'join_render') && Array.isArray(meta.joinFiles) && meta.joinFiles.length > 0) {
      const config = meta.config || (meta.configId ? sqlite.getFfmpegConfig(meta.configId) : null)
      finalArgs = buildJoinArgs(meta.joinFiles, meta.output, config, gpuSupport)
    } else if (meta.operation === 'split' || meta.operation === 'split_render') {
      const config = meta.config || (meta.configId ? sqlite.getFfmpegConfig(meta.configId) : null)
      finalArgs = buildSplitArgs(meta.input, meta.output, meta.splitStartTime, meta.splitDuration, config, gpuSupport)
    } else if (meta.operation === 'audio_tool') {
      finalArgs = buildAudioToolArgs(meta.input, meta.output, meta.audioMode, meta.audioOptions)
    } else {
      const config = meta.config || (meta.configId ? sqlite.getFfmpegConfig(meta.configId) : null)
      if (config) {
        finalArgs = buildFfmpegArgs(meta.input, meta.output, config, gpuSupport)
      }
    }

    if (meta.output) {
      const outDir = path.dirname(meta.output)
      if (outDir && !existsSync(outDir)) {
        mkdirSync(outDir, { recursive: true })
      }
    }

    return {
      ...task,
      command: exe,
      args: finalArgs,
      meta: { ...meta, taskKey: j, thread: 0 }
    }
  }))
  taskManager.setGroupedTasks(groups)
}

function startTasks(event) {
  updateUI.lastSend = 0
  taskManager.beforeRunTask = (thread, idx, task) => {
    const response = { ...buildResponse(task), taskKey: idx, thread, percent: 0, done: false }
    send(event, `${moduleName}:beforeRunTask`, response)
  }

  taskManager.onTaskStderr = (thread, idx, task, data) => {
    const line = data.toString()

    // Extract duration from FFmpeg header if missing
    if (!task.meta) task.meta = {}
    if (!task.meta.duration) {
      const durMatch = line.match(/Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/)
      if (durMatch) {
        task.meta.duration = parseTimeToSeconds(durMatch[1])
      }
    }

    // Match current encoding time and speed
    const timeMatch = line.match(/time=(\d+:\d+:\d+(?:\.\d+)?)/)
    if (!timeMatch) return

    const currentSec = parseTimeToSeconds(timeMatch[1])
    const duration = task.meta.duration || 0
    const speedMatch = line.match(/speed=\s*([\d.]+)x/)

    let percent = 0
    if (duration > 0) {
      percent = Math.min(99, Math.round((currentSec / duration) * 100))
    }

    const now = Date.now()
    if (now - updateUI.lastSend < updateUI.delay) return
    updateUI.lastSend = now

    const response = {
      ...buildResponse(task),
      taskKey: idx,
      thread,
      percent,
      speed: speedMatch ? `${speedMatch[1]}x` : undefined,
      done: false
    }
    send(event, `${moduleName}:progressTask`, response)
  }

  taskManager.afterRunTask = (pid, thread, idx, task, code, signal, stdout, stderr) => {
    const meta = task.meta || {}
    const response = { ...buildResponse(task), taskKey: idx, thread, percent: 100, done: true, code }
    send(event, `${moduleName}:progressTask`, response)

    // Save to history SQLite
    sqlite.addFfmpegHistory({
      config_id: meta.configId || null,
      config_title: meta.configTitle || null,
      batch_config_id: meta.batchConfigId || null,
      batch_config_title: meta.batchConfigTitle || null,
      input_file: meta.input || null,
      input_files: meta.inputs ? JSON.stringify(meta.inputs) : null,
      output_file: meta.output || null,
      output_path: meta.outPath || (meta.output ? path.dirname(meta.output) : null),
      operation: meta.operation || 'render',
      duration: meta.duration || 0,
      file_size: code === 0 ? getFileSizeSync(meta.output) : 0,
      status: code === 0 ? 'completed' : 'failed',
      error_message: code === 0 ? null : stderr.slice(-500),
      threads: meta.threads || 1,
      started_at: meta.startedAt || new Date().toISOString(),
      completed_at: new Date().toISOString()
    })
  }

  taskManager.onAllTasksDone = (total) => {
    send(event, `${moduleName}:allTasksDone`, { total })
  }

  taskManager.onTaskError = (thread, idx, task, code, signal, stderr) => {
    const response = { ...buildResponse(task), taskKey: idx, thread, percent: 0, done: false, message: stderr, code }
    send(event, `${moduleName}:errorTask`, response)
  }

  taskManager.onTaskRetry = (idx, retryCount) => {
    send(event, `${moduleName}:taskRetry`, { taskKey: idx, retryCount })
  }

  taskManager.onTaskTimeout = (idx) => {
    send(event, `${moduleName}:taskTimeout`, { taskKey: idx })
  }

  taskManager.start().catch(() => { })
}

function parseTimeToSeconds(time) {
  const parts = String(time).split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0] || 0
}

function getMediaInfo(event, args) {
  return new Promise((resolve) => {
    const exe = resolveExecutable().ffprobe
    const child = spawn(exe, args || [])
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })
    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })
    child.on('close', (code, signal) => {
      resolve({ pid: child.pid, code, signal, stdout, stderr })
    })
    child.on('error', (err) => {
      resolve({ pid: 0, code: -1, signal: null, stdout: '', stderr: err.message })
    })
  })
}

function globFiles(event, pattern) {
  try {
    const normalized = pattern.replace(/\\/g, '/')
    const lastSlash = normalized.lastIndexOf('/')
    if (lastSlash === -1) return []
    const dir = normalized.slice(0, lastSlash) || '.'
    const filePattern = normalized.slice(lastSlash + 1)

    if (!existsSync(dir)) return []

    const regexStr = '^' + filePattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.') + '$'
    const regex = new RegExp(regexStr, 'i')

    const files = require('fs').readdirSync(dir)
    return files
      .filter(f => regex.test(f))
      .map(f => path.join(dir, f).replace(/\\/g, '/'))
  } catch {
    return []
  }
}

function scanImageSubfolders(event, inputDir, extensions, mode = 'subfolder') {
  try {
    if (!inputDir || !existsSync(inputDir)) return []
    const normalizedInput = inputDir.replace(/\\/g, '/')

    let imageExtRegex = /\.(jpe?g|png|webp|bmp)$/i
    if (Array.isArray(extensions) && extensions.length > 0) {
      const cleanExts = extensions.map(e => e.replace(/^\./, '')).join('|')
      imageExtRegex = new RegExp(`\\.(${cleanExts})$`, 'i')
    }

    if (mode === 'root') {
      const files = require('fs').readdirSync(normalizedInput)
      const images = files
        .filter(f => imageExtRegex.test(f))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
        .map(f => path.join(normalizedInput, f).replace(/\\/g, '/'))
      if (images.length > 0) {
        return [{
          name: path.basename(normalizedInput),
          path: normalizedInput,
          count: images.length,
          images
        }]
      }
      return []
    }

    const entries = require('fs').readdirSync(normalizedInput, { withFileTypes: true })
    const subfolders = []

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subfolderPath = path.join(normalizedInput, entry.name).replace(/\\/g, '/')
        try {
          const files = require('fs').readdirSync(subfolderPath)
          const images = files
            .filter(f => imageExtRegex.test(f))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
            .map(f => path.join(subfolderPath, f).replace(/\\/g, '/'))
          if (images.length > 0) {
            subfolders.push({
              name: entry.name,
              path: subfolderPath,
              count: images.length,
              images
            })
          }
        } catch {
          // ignore inaccessible folder
        }
      }
    }
    return subfolders
  } catch {
    return []
  }
}

function probeMedia(event, filePath) {
  return new Promise((resolve) => {
    try {
      if (!filePath || !existsSync(filePath)) {
        return resolve({ duration: 0, width: 0, height: 0, fps: 0, bitrate: 0 })
      }
      const exe = resolveExecutable().ffprobe
      const child = spawn(exe, [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath
      ])
      let stdout = ''
      child.stdout.on('data', (data) => {
        stdout += data.toString()
      })
      child.on('close', () => {
        try {
          const info = JSON.parse(stdout)
          const videoStream = info.streams?.find(s => s.codec_type === 'video') || {}
          let duration = parseFloat(info.format?.duration || videoStream.duration || 0)
          let fps = 0
          if (videoStream.r_frame_rate) {
            const parts = videoStream.r_frame_rate.split('/')
            if (parts.length === 2 && parseFloat(parts[1]) > 0) {
              fps = Math.round(parseFloat(parts[0]) / parseFloat(parts[1]))
            } else {
              fps = parseFloat(videoStream.r_frame_rate) || 0
            }
          }
          const width = videoStream.width || 0
          const height = videoStream.height || 0
          const bitrate = parseInt(info.format?.bit_rate || videoStream.bit_rate || 0, 10)

          resolve({
            duration: isNaN(duration) ? 0 : duration,
            width,
            height,
            fps: isNaN(fps) ? 0 : fps,
            bitrate: isNaN(bitrate) ? 0 : bitrate
          })
        } catch {
          resolve({ duration: 0, width: 0, height: 0, fps: 0, bitrate: 0 })
        }
      })
      child.on('error', () => {
        resolve({ duration: 0, width: 0, height: 0, fps: 0, bitrate: 0 })
      })
    } catch {
      resolve({ duration: 0, width: 0, height: 0, fps: 0, bitrate: 0 })
    }
  })
}

function scanJoinFolders(event, rootPath, mode = 'root', extensions = []) {
  try {
    if (!rootPath || !existsSync(rootPath)) return []
    const normalizedRoot = rootPath.replace(/\\/g, '/')

    let mediaExtRegex = /\.(mp4|mkv|mov|avi|flv|wmv|webm|ts|m4v|jpe?g|png|webp|bmp)$/i
    if (Array.isArray(extensions) && extensions.length > 0) {
      const cleanExts = extensions.map(e => e.replace(/^\./, '')).join('|')
      mediaExtRegex = new RegExp(`\\.(${cleanExts})$`, 'i')
    }

    if (mode === 'root') {
      const files = require('fs').readdirSync(normalizedRoot)
      const mediaFiles = files
        .filter(f => mediaExtRegex.test(f))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
        .map(f => path.join(normalizedRoot, f).replace(/\\/g, '/'))

      if (mediaFiles.length > 0) {
        return [{
          name: path.basename(normalizedRoot),
          path: normalizedRoot,
          count: mediaFiles.length,
          files: mediaFiles
        }]
      }
      return []
    }

    // mode === 'subfolder'
    const entries = require('fs').readdirSync(normalizedRoot, { withFileTypes: true })
    const result = []
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subPath = path.join(normalizedRoot, entry.name).replace(/\\/g, '/')
        try {
          const files = require('fs').readdirSync(subPath)
          const mediaFiles = files
            .filter(f => mediaExtRegex.test(f))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
            .map(f => path.join(subPath, f).replace(/\\/g, '/'))
          if (mediaFiles.length > 0) {
            result.push({
              name: entry.name,
              path: subPath,
              count: mediaFiles.length,
              files: mediaFiles
            })
          }
        } catch {
          // ignore
        }
      }
    }
    return result
  } catch {
    return []
  }
}

function registerFfmpegController() {
  ipcMain.handle(`${moduleName}:probeMedia`, (event, filePath) => probeMedia(event, filePath))
  ipcMain.handle(`${moduleName}:scanJoinFolders`, (event, rootPath, mode, extensions) => scanJoinFolders(event, rootPath, mode, extensions))
  ipcMain.handle(`${moduleName}:scanImageSubfolders`, (event, inputDir, extensions, mode) => scanImageSubfolders(event, inputDir, extensions, mode))
  ipcMain.handle(`${moduleName}:globFiles`, (event, pattern) => globFiles(event, pattern))
  ipcMain.handle(`${moduleName}:checkExecutable`, async () => {
    const exe = resolveExecutable()
    const rs = {}
    for (const [key, value] of Object.entries(exe)) {
      if (key === 'ytDlp') continue
      const exists = existsSync(value)
      let isValid = false
      if (exists) {
        isValid = await verifyExecutable(value, key)
      }
      rs[key] = { path: value, exists, isValid }
    }
    return { data: rs, status: Object.values(rs).every(v => v.exists && v.isValid) }
  })

  ipcMain.handle(`${moduleName}:getStatus`, () => taskManager.getStatus())
  ipcMain.handle(`${moduleName}:getTasks`, () => {
    return taskManager.tasks.map((task, idx) => {
      const status = taskManager.taskStatus[idx] || 'waiting'
      const progress = status === 'completed' ? 100 : 0
      return {
        key: idx,
        task,
        status,
        retry: taskManager.retryCount[idx] || 0,
        progress,
        speed: '0',
        downloaded: ''
      }
    })
  })

  ipcMain.handle(`${moduleName}:initTaskManager`, (event, args) => initTaskManager(event, args))

  ipcMain.handle(`${moduleName}:setTasks`, (event, args) => setTasks(event, args))

  ipcMain.handle(`${moduleName}:setGroupTasks`, (event, args) => setGroupTasks(event, args))

  ipcMain.handle(`${moduleName}:startTasks`, event => startTasks(event))

  ipcMain.handle(`${moduleName}:pauseTasks`, async () => {
    await taskManager.pause()
    return taskManager.getStatus()
  })

  ipcMain.handle(`${moduleName}:continueTasks`, async () => {
    await taskManager.continue()
    return taskManager.getStatus()
  })

  ipcMain.handle(`${moduleName}:stopTask`, async (event, idx) => {
    await taskManager.stopTask(idx)
    send(event, `${moduleName}:stoppedTask`, true)
    return taskManager.getStatus()
  })

  ipcMain.handle(`${moduleName}:stopTasks`, async (event) => {
    await taskManager.stop()
    send(event, `${moduleName}:stoppedTasks`, true)
    return taskManager.getStatus()
  })

  ipcMain.handle(`${moduleName}:getMediaInfo`, (event, args) => getMediaInfo(event, args))

  // SQLite CRUD handlers
  ipcMain.handle(`${moduleName}:listFfmpegConfigs`, () => sqlite.listFfmpegConfigs())
  ipcMain.handle(`${moduleName}:createFfmpegConfig`, (event, data) => {
    const id = sqlite.createFfmpegConfig(data)
    return { status: true, data: { id } }
  })
  ipcMain.handle(`${moduleName}:updateFfmpegConfig`, (event, { id, data }) => {
    sqlite.updateFfmpegConfig(id, data)
    return { status: true }
  })
  ipcMain.handle(`${moduleName}:deleteFfmpegConfig`, (event, id) => {
    sqlite.deleteFfmpegConfig(id)
    return { status: true }
  })

  ipcMain.handle(`${moduleName}:listFfmpegBatchConfigs`, () => sqlite.listFfmpegBatchConfigs())
  ipcMain.handle(`${moduleName}:createFfmpegBatchConfig`, (event, data) => {
    const id = sqlite.createFfmpegBatchConfig(data)
    return { status: true, data: { id } }
  })
  ipcMain.handle(`${moduleName}:updateFfmpegBatchConfig`, (event, { id, data }) => {
    sqlite.updateFfmpegBatchConfig(id, data)
    return { status: true }
  })
  ipcMain.handle(`${moduleName}:deleteFfmpegBatchConfig`, (event, id) => {
    sqlite.deleteFfmpegBatchConfig(id)
    return { status: true }
  })

  ipcMain.handle(`${moduleName}:listFfmpegHistory`, (event, limit) => sqlite.listFfmpegHistory(limit))
  ipcMain.handle(`${moduleName}:deleteFfmpegHistory`, (event, id) => {
    sqlite.deleteFfmpegHistory(id)
    return { status: true }
  })
  ipcMain.handle(`${moduleName}:detectGpuSupport`, () => detectGpuSupport())
  ipcMain.handle(`${moduleName}:getVersion`, async () => {
    try {
      const versions = await getVersions()
      return { status: true, data: versions }
    } catch (e) {
      return { status: false, message: e.message }
    }
  })
  ipcMain.handle(`${moduleName}:checkUpdate`, async (_event, options) => {
    try {
      let currentVersion = ''
      try {
        const vers = await getVersions()
        currentVersion = vers.ffmpeg || ''
      } catch {
        // ignore
      }
      return await checkFfmpegUpdate(currentVersion, options)
    } catch (e) {
      return { status: false, message: e.message }
    }
  })
  ipcMain.handle(`${moduleName}:performUpdate`, async (event, options) => {
    try {
      const result = await installFfmpeg(options, (progress) => {
        send(event, `${moduleName}:updateProgress`, progress)
      })
      binaries = getToolsBinaries()
      return result
    } catch (e) {
      return { status: false, message: e.message }
    }
  })

  app.on('will-quit', () => {
    taskManager.stop().catch(() => { })
  })
}

module.exports = {
  registerFfmpegController, ffmpegEvents: {
    managerInitialized: `${moduleName}:managerInitialized`,
    beforeRunTask: `${moduleName}:beforeRunTask`,
    progressTask: `${moduleName}:progressTask`,
    allTasksDone: `${moduleName}:allTasksDone`,
    stoppedTask: `${moduleName}:stoppedTask`,
    stoppedTasks: `${moduleName}:stoppedTasks`,
    errorTask: `${moduleName}:errorTask`,
    taskRetry: `${moduleName}:taskRetry`,
    taskTimeout: `${moduleName}:taskTimeout`
  }
}
