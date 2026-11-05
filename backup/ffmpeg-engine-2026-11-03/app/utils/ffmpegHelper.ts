import type { FfmpegConfig, FfmpegLabel, ToolTask } from '#shared/types/electron'

// Helper interfaces
export interface RenderAspectRatio {
  id: number | string
  group: number
  title: string
  ratioX: number
  ratioY: number
  width: number
  height: number
  bitrate?: string
}

export interface VideoInfo {
  frame_rate: number
  bit_rate: number
  duration: number
  height: number
  width: number
}

export interface FfmpegModel {
  fnc: number
  inPath: string
  inputFile: string
  inputFiles: string[]
  inputExtraFiles: { inPath: string, children: string[] }[] | null
  inputSubPath: string
  inputSubFiles: string[]
  outPath: string
  outPathFix: string
  outFile: string
  outFileTmp: string[]
  configurationId: string
  threads: number
  aspectRatio: number
  bitrate: string
  videoEncoder: string
  audioEncoder: string
  overwrite: boolean
  hideBanner: boolean
  shuffle: boolean
  splitNumber: number
  splitSecondStart: number
  splitSecondRandomMin: number
  splitSecondRandomMax: number
  joinAll: boolean
  joinRandomNumberMin: number
  joinRandomNumberMax: number
}

// 1. Unique ID Generator
export function generateId(): string {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

// 2. parseFilePath
export function parseFilePath(e: string | null) {
  if (!e) return null
  try {
    const firstPart = e.split('?')[0]
    if (!firstPart) return null
    const t = firstPart.split(/[/\\]/)
    const l = t.pop() || null
    const r = t.length > 0 && t[t.length - 1] !== '' ? t.join('/') : null
    if (!l) return { fullPath: e, dirPath: r, fileName: null, fileNameNoExt: null, extension: null }
    const o = l.lastIndexOf('.')
    if (o <= 0) return { fullPath: e, dirPath: r, fileName: l, fileNameNoExt: l, extension: null }
    const a = l.slice(0, o)
    const u = l.slice(o + 1) || null
    return { fullPath: e, dirPath: r, fileName: l, fileNameNoExt: a, extension: u }
  } catch (n) {
    console.error('[parseFilePath] Error:', n)
    return null
  }
}

// 3. getFileName and getOutFile
export function getOutFile(inputFile: string, suffix = '') {
  const parseFile = parseFilePath(inputFile)
  const extension = parseFile?.extension
  if (suffix) {
    // A template literal is always truthy, so the previous
    // `\`${a}${suffix}.${b}\` || fallback` never reached the fallback: an
    // unparseable path produced "undefined.1.undefined" as the ffmpeg output.
    const base = parseFile?.fileNameNoExt || generateId()
    return extension ? `${base}${suffix}.${extension}` : `${base}${suffix}`
  }
  return parseFile?.fileName || `${generateId()}.${extension}`
}

export function suffixOutFile(input: string, output: string, suffix = '_render') {
  if (input === output) {
    const parseFile = parseFilePath(output)
    if (parseFile) {
      return [parseFile.dirPath, `${parseFile.fileNameNoExt}${suffix}.${parseFile.extension}`].join('/')
    }
  }
  return output
}

export function getOutPath(outPath: string, suffix = '') {
  if (!suffix || suffix === 'Default') return outPath
  const strs = suffix.split('|')
  if (strs.length > 1) {
    const fmtPattern = strs[1]
    if (fmtPattern && strs[0] === 'date') {
      const now = new Date()
      const yyyy = now.getFullYear()
      const mm = String(now.getMonth() + 1).padStart(2, '0')
      const dd = String(now.getDate()).padStart(2, '0')
      const fmt = fmtPattern.replace('yyyy', String(yyyy)).replace('MM', mm).replace('DD', dd).replace('dd', dd)
      suffix = fmt
    }
  }
  return [outPath, suffix].join('/')
}

// isImage and isVideo checks
const extensionPatterns = {
  image: /\.(gif|jpg|jpe?g|tiff|png|img|ico|jfif|webp|bmp|svg)$/i,
  video: /\.(3g2|3gp|3gp2|3gpp|3gpp2|amv|flv|gom|mp4|mov|mpe|mpeg|mpg|kmv|mkv|wvm|wmv|webm)$/i
}
const hasExtension = (e: string, n: RegExp) => {
  if (!e) return false
  const o = e.lastIndexOf('.')
  if (o <= 0) return false
  const ext = e.slice(o).toLowerCase()
  return n.test(ext)
}
const isImageFile = (e: string) => hasExtension(e, extensionPatterns.image)
const isVideoFile = (e: string) => hasExtension(e, extensionPatterns.video)
export { isImageFile, isVideoFile }

export function toURL(path: string | null | undefined): string {
  if (!path) return ''
  // Web uploads live on the local Nitro server under /uploads/ — a relative
  // URL that works for every port/host (R152). Desktop dirs can never start
  // with "/uploads/", so the pass-through is web-only by construction.
  if (/^(media:|https?:|data:|blob:|\/uploads\/)/.test(path)) return path
  if (/^file:\/\//.test(path)) {
    const raw = path.replace(/^file:\/\//, '')
    try {
      const decoded = decodeURIComponent(raw)
      const normalized = decoded.replace(/^\/+([a-zA-Z]:)/, '$1')
      return `media://local?file=${encodeURIComponent(normalized)}`
    } catch {
      return path
    }
  }
  const normalized = path.replace(/\\/g, '/')
  return `media://local?file=${encodeURIComponent(normalized)}`
}

export function hexToRgba(hex: string, opacity: number): string {
  const normalized = hex.replace('#', '')
  const full = normalized.length === 3 ? normalized.split('').map(c => c + c).join('') : normalized
  const num = parseInt(full || '000000', 16)
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

export function getMediaSize(filePath: string): Promise<{ w: number, h: number }> {
  return new Promise((resolve) => {
    try {
      if (isImageFile(filePath)) {
        const img = new Image()
        img.onload = () => resolve({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 })
        img.onerror = () => resolve({ w: 0, h: 0 })
        img.src = toURL(filePath)
      } else if (isVideoFile(filePath)) {
        const video = document.createElement('video')
        video.onloadedmetadata = () => resolve({ w: video.videoWidth || 0, h: video.videoHeight || 0 })
        video.onerror = () => resolve({ w: 0, h: 0 })
        video.src = toURL(filePath)
      } else {
        resolve({ w: 0, h: 0 })
      }
    } catch {
      resolve({ w: 0, h: 0 })
    }
  })
}

export function fontToStyle(font: { family?: string, monospace?: boolean, weight?: string | number, style?: string, italic?: boolean, width?: number }): Record<string, string | number> {
  const style: Record<string, string | number> = {}
  if (font.family) {
    style['fontFamily'] = `'${font.family}', ${font.monospace ? 'monospace' : 'sans-serif'}`
  }
  if (font.weight) {
    style['fontWeight'] = font.weight
  } else if (font.style?.toLowerCase().includes('bold')) {
    style['fontWeight'] = 'bold'
  }
  if (font.italic || font.style?.toLowerCase().includes('italic')) {
    style['fontStyle'] = 'italic'
  } else {
    style['fontStyle'] = 'normal'
  }
  if (font.width) {
    if (font.width < 100) style['fontStretch'] = 'condensed'
    else if (font.width > 100) style['fontStretch'] = 'expanded'
    else style['fontStretch'] = 'normal'
  }
  return style
}

export function toFileURL(filePath: string | null) {
  if (!filePath) return ''
  let urlPath = filePath.replace(/\\/g, '/')
  if (/^[a-zA-Z]:\//.test(urlPath)) {
    urlPath = '/' + urlPath
  }
  const parts = urlPath.split('/')
  const fileName = parts.pop() || ''
  const safeFileName = encodeURIComponent(fileName)
  return 'file://' + parts.join('/') + '/' + safeFileName
}

// 4. shuffleArray and splitRandomItems
export function shuffleArray<T>(r: T[]): T[] {
  const t = [...r]
  for (let e = t.length - 1; e > 0; e--) {
    const n = Math.floor(Math.random() * (e + 1))
    const temp = t[e] as T
    t[e] = t[n] as T
    t[n] = temp
  }
  return t
}

export function splitRandomItems<T>(r: T[], t: number, e: number, n = 0, s = false): T[][] {
  const o: T[][] = []
  if (!Array.isArray(r) || r.length === 0) return o
  if (t <= 0 || e < t) return [r]
  let i = [...r]
  if (s) {
    i = shuffleArray(i)
  }
  while (i.length > 0) {
    let a = Math.floor(Math.random() * (e - t + 1)) + t
    if (a > i.length) a = i.length
    const c = i.splice(0, a)
    o.push(c)
  }
  return o.filter(a => a.length >= n)
}

// 5. Media Info parsing
export function parseInfo(stringInfo: string): VideoInfo {
  const rs = { frame_rate: 30, bit_rate: 1000000, duration: 0, height: 1080, width: 1920 } as VideoInfo
  const arr = stringInfo.trim().split(/\r?\n/)
  for (const s of arr) {
    const a = s.trim().split('=')
    if (a.length > 1) {
      const key = a[0]?.trim()
      const val = a[1]?.trim()
      if (!key || !val) continue
      if (key === 'duration') rs.duration = parseFloat(val)
      else if (key === 'r_frame_rate') {
        const parts = val.split('/')
        if (parts.length > 1 && parts[0] && parts[1]) {
          rs.frame_rate = Math.round(parseFloat(parts[0]) / parseFloat(parts[1]))
        } else {
          rs.frame_rate = parseInt(val.replace('/1', '')) || 30
        }
      } else if (key === 'bit_rate') rs.bit_rate = parseInt(val) || 1000000
      else if (key === 'width') rs.width = parseInt(val) || 1920
      else if (key === 'height') rs.height = parseInt(val) || 1080
    }
  }
  return rs
}

export const CMDGetMediaInfo = (input: string) => {
  return ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,duration,bit_rate,r_frame_rate', '-of', 'default=noprint_wrappers=1', input]
}

export const onGetInfoMedia = async (input: string, getMediaInfoFunction?: (args: string[]) => Promise<any>): Promise<VideoInfo> => {
  if (!getMediaInfoFunction) {
    return { frame_rate: 30, bit_rate: 1000000, duration: 0, height: 1080, width: 1920 }
  }
  const cmd = CMDGetMediaInfo(input)
  const res = await getMediaInfoFunction(cmd)
  const info = parseInfo(res.stdout || '')
  return info
}

// 6. Font scaling and alignment helpers
export const scaleX = (frameW: number, baseW: number) => frameW / baseW
export const scaleY = (frameH: number, baseH: number) => frameH / baseH
export const toDisplay = (value: number, scale: number) => Math.round(value * scale)
export const toBase = (value: number, scale: number) => Math.round(value / scale)

export const scaleFont = (value: number, fromW: number, fromH: number, toW: number, toH: number) => {
  const scaleX = toW / fromW
  const scaleY = toH / fromH
  return Math.min(scaleX, scaleY) * value
}

export interface RenderTransform {
  x: number
  y: number
  scaleX: number
  scaleY: number
  fontSize: number
  width: number
  height: number
  boxBorderW: number
}

export function getTextRenderTransform(txt: FfmpegLabel): RenderTransform {
  const resizeMode = txt.resizeMode || 'scale'
  const scaleX = resizeMode === 'scale' ? (txt.scaleX ?? 1) : 1
  const scaleY = resizeMode === 'scale' ? (txt.scaleY ?? 1) : 1

  return {
    x: txt.x,
    y: txt.y,
    scaleX,
    scaleY,
    fontSize: Math.round(txt.size * scaleX),
    width: Math.round((txt.w || 200) * (txt.scaleX ?? 1)),
    height: Math.round((txt.h || 40) * (txt.scaleY ?? 1)),
    boxBorderW: Math.round((txt.boxBorderW || 10) * scaleX)
  }
}

type ModeAlign = 'horizontal' | 'vertical' | 'both'
export const alignElement = (el: any, frame: { w: number, h: number }, mode: ModeAlign = 'both') => {
  if (!el) return el
  let newX = el.x
  let newY = el.y

  if (mode === 'horizontal' || mode === 'both') {
    newX = Math.round((frame.w - el.w) / 2)
  }
  if (mode === 'vertical' || mode === 'both') {
    newY = Math.round((frame.h - el.h) / 2)
  }

  return { ...el, x: newX, y: newY }
}

export const alignAll = (elements: any[], frame: { w: number, h: number }, mode: ModeAlign = 'both') => {
  if (!elements || !elements.length) return elements
  return elements.map(el => alignElement(el, frame, mode))
}

export const scalePercentUI = (scaleValue: number, baseValue: number) => {
  return Math.round(scaleValue * 100 / baseValue)
}

export const scaleElementX = (el: any, frameW: number, scaleFile: any) => {
  const newW = Math.round(scaleFile.baseW * (scaleFile.w / 100))
  const offsetX = Math.round((frameW - newW) / 2)
  el.w = newW
  el.x = offsetX
}

export const scaleElementY = (el: any, frameH: number, scaleFile: any) => {
  const newH = Math.round(scaleFile.baseH * (scaleFile.h / 100))
  const offsetY = Math.round((frameH - newH) / 2)
  el.h = newH
  el.y = offsetY
}

// 7. Format helpers
export function format(r: string, ...i: any[]): string {
  let e = r
  let t = [...i]
  const s = i[i.length - 1]
  if (typeof s === 'object' && s !== null && !Array.isArray(s)) {
    const n = s
    for (const l in n) {
      const g = new RegExp(`\\{${l}\\}`, 'gi')
      e = e.replace(g, String(n[l] ?? ''))
    }
    t = i.slice(0, -1)
  }
  e = e.replace(/{(\d+)}/g, (n, l) => {
    const g = Number(l)
    return g < t.length ? String(t[g] ?? '') : n
  })
  for (const n of t) {
    e = e.replace(/%s/, String(n ?? ''))
  }
  return e
}

export function formatArray(r: string[], ...i: any[]): string[] {
  return r.map(e => format(e, ...i))
}

// 8. FFmpeg Command builders
const MAIN_FILE = '{mainfile}'
const OUT_PUT = '{output}'

function escapeTextForFFmpeg(s: string) {
  return (s ?? '').replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, '\\\'')
}

function inputFilterLabel(idx: number) {
  return `[${idx}:v]`
}

export const CMDZoom = (config: Partial<FfmpegConfig>, fps?: string) => {
  const str = [] as string[]
  const zoom_ratio = config.zoom_ratio || 1.1
  const zoom_time_start = config.zoom_time_start || 0
  const zoom_time_duration = config.zoom_time_duration || 0
  const zoom_time_loop = config.zoom_time_loop || 0

  if (zoom_time_loop > 0) {
    str.push(`zoompan=z='if(`)
    if (zoom_time_start > 0) str.push(`gte(time,${zoom_time_start})*`)
    str.push(`lte(mod(time,${zoom_time_loop}),${zoom_time_duration}),${zoom_ratio},1)':d=1:x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2)`)
  } else {
    str.push(`zoompan=z='if(between(time,${zoom_time_start},${zoom_time_start + zoom_time_duration}),${zoom_ratio},1)':d=1:x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2)`)
  }
  if (fps && fps.length > 0) str.push(`:fps=${fps}`)
  return str.join('')
}

export const CMDHFlip = (config: Partial<FfmpegConfig>) => {
  if (config.hflip_all === 1) return 'hflip'
  const start = config.hflip_time_start || 0
  const dur = config.hflip_time_duration || 0
  const loop = config.hflip_time_loop || 0
  if (start > 0 && dur > 0) {
    const str = [] as string[]
    if (loop > 0) {
      str.push(`hflip=enable='if(`)
      if (start > 0) str.push(`gte(t,${start})*`)
      str.push(`gte(mod(t-1,${loop}),${loop - dur}),1)'`)
    } else {
      str.push(`hflip=enable='if(between(t,${start},${start + dur}),1)'`)
    }
    return str.join('')
  }
  return ''
}

export const CMDVFlip = (config: Partial<FfmpegConfig>) => {
  if (config.vflip_all === 1) return 'vflip'
  const start = config.vflip_time_start || 0
  const dur = config.vflip_time_duration || 0
  const loop = config.vflip_time_loop || 0
  if (start > 0 && dur > 0) {
    const str = [] as string[]
    if (loop > 0) {
      str.push(`vflip=enable='if(`)
      if (start > 0) str.push(`gte(t,${start})*`)
      str.push(`gte(mod(t-1,${loop}),${loop - dur}),1)'`)
    } else {
      str.push(`vflip=enable='if(between(t,${start},${start + dur}),1)'`)
    }
    return str.join('')
  }
  return ''
}

export const CMDSpeedVideo = (speed: number, fps?: string) => {
  const str = [`setpts=PTS/${speed}`]
  if (fps && fps.length > 0) str.push(`fps=${fps}`)
  return str.join(',')
}

export const CMDSpeedAudio = (speed: number) => {
  return `atempo=${speed}`
}

export const CMDVolumeAudio = (volume: number) => {
  return `volume=${volume}`
}

export const CMDAudio = (renderCode: any, volume: number, speed: number) => {
  renderCode.filtersAudio.push(`[0:a]${CMDVolumeAudio(volume)},${CMDSpeedAudio(speed)}[a]`)
}

const loopSubFile = (type: 'image' | 'video' | 'audio' | 'subtitle' | string) => {
  return type === 'image' ? ['-loop', '1'] : ['-stream_loop', '-1']
}

export const CMDBackground = (renderCode: any, config: Partial<FfmpegConfig>, baseSize: { w: number, h: number }) => {
  const bgType = config.background_type || 'color'
  const bgFile = config.background_file
  const bgColor = config.background_color || '#000000'
  const bgBlur = config.background_boxblur || 10

  if (bgType === 'file' && bgFile) {
    renderCode.inputs = renderCode.inputs.concat(loopSubFile(isImage(bgFile) ? 'image' : 'video'))
    renderCode.inputs.push('-i', bgFile)
    renderCode.filtersVideo.push(`${inputFilterLabel(renderCode.index)}scale=${baseSize.w}:${baseSize.h},setsar=1[bg]`)
    renderCode.index += 1
  } else if (bgType === 'boxblur') {
    renderCode.filtersVideo.push(`[0:v]boxblur=${bgBlur},scale=${baseSize.w}:${baseSize.h},setsar=1[bg]`)
  } else {
    renderCode.filtersVideo.push(`color=c=${bgColor}:s=${baseSize.w}x${baseSize.h},setsar=1[bg]`)
  }
  return renderCode
}

export const CMDMainFile = (renderCode: any, scale: { w: number, h: number }, mainOptions?: string) => {
  renderCode.inputs.push('-i', MAIN_FILE)
  if (mainOptions && mainOptions.length > 0) {
    renderCode.filtersVideo.push(`${inputFilterLabel(renderCode.index)}${mainOptions}[main]`)
    renderCode.filtersVideo.push(`[main]scale=${scale.w}:${scale.h}[main]`)
  } else {
    renderCode.filtersVideo.push(`${inputFilterLabel(renderCode.index)}scale=${scale.w}:${scale.h}[main]`)
  }
  renderCode.index += 1
  return renderCode
}

export const CMDMainFileBackground = (renderCode: any, scale: { x: number, y: number }) => {
  renderCode.filtersVideo.push(`[bg][main]overlay=${scale.x}:${scale.y}:shortest=1[v]`)
  return renderCode
}

export const CMDSubFiles = (renderCode: any, files: any[]) => {
  files.forEach((s, i) => {
    if (s.type === 'image' || s.type === 'video') {
      renderCode.inputs = renderCode.inputs.concat(loopSubFile(s.type))
      renderCode.inputs.push('-i', s.path)
      const lbl = `sub${i}`
      renderCode.filtersVideo.push(`${inputFilterLabel(renderCode.index)}scale=${s.w}:${s.h}[${lbl}]`)
      renderCode.filtersVideo.push(`[v][${lbl}]overlay=${s.x}:${s.y}:shortest=1[v]`)
      renderCode.index += 1
    }
  })
  return renderCode
}

export const CMDLabels = (renderCode: any, labels: FfmpegLabel[], baseSize: { w: number, h: number }, frameSize: { w: number, h: number }) => {
  labels.forEach((t) => {
    const txt = escapeTextForFFmpeg(t.text)
    const fontFile = t.path ? t.path.replace('C:', '').replace(/\\/g, '/') : ''
    const transform = getTextRenderTransform(t)
    let boxBorder = ''
    if (t.box) {
      boxBorder = `:box=1:boxcolor=${t.boxColor || '#A3A3A3'}@${t.boxOpacity || 0.5}:boxborderw=${transform.boxBorderW}`
    }
    const fontArg = fontFile ? `fontfile='${fontFile}':` : ''
    renderCode.filtersVideo.push(`[v]drawtext=${fontArg}text='${txt}':x=${transform.x}:y=${transform.y}:fontsize=${transform.fontSize}:fontcolor=${t.color || 'white'}${boxBorder}[v]`)
  })
  return renderCode
}

export const CMDRenderArgs = (options: FfmpegModel, aspectRatio: RenderAspectRatio, renderCode: any, format: any): string[] => {
  const args: string[] = []
  if (options.hideBanner) args.push('-hide_banner')
  if (options.overwrite) args.push('-y')
  args.push(...renderCode.inputs)
  args.push('-aspect', `${aspectRatio.ratioX}:${aspectRatio.ratioY}`)
  args.push('-b:v', options.bitrate)
  args.push('-filter_complex', `${renderCode.filtersVideo.join(';')};${renderCode.filtersAudio.join(';')}`)
  args.push('-map', '[v]', '-map', '[a]')
  args.push('-c:v', options.videoEncoder)
  args.push('-shortest')
  args.push(OUT_PUT)
  return formatArray(args, format)
}

// 9. Task compilation requests (Fnc 0 to 6)
export const taskRenderRequest = async (
  options: FfmpegModel,
  aspectRatio: RenderAspectRatio,
  renderCode: any,
  getMediaInfoFunction?: (args: string[]) => Promise<any>,
  taskId?: string
) => {
  try {
    const tasks = <any[]>[]
    const outPath = getOutPath(options.outPath, options.outPathFix)
    for (const file of options.inputFiles) {
      if (!file) continue
      const infoMedia = await onGetInfoMedia(file, getMediaInfoFunction)
      const outFile = options.outFile || [outPath, getOutFile(file)].join('/')
      const output = suffixOutFile(file, outFile)
      tasks.push({
        meta: {
          taskId: taskId || generateId(),
          input: file,
          output: output,
          outPath: outPath,
          duration: infoMedia.duration
        },
        command: '',
        options: { shell: false, windowsHide: true },
        args: CMDRenderArgs(options, aspectRatio, renderCode, { mainfile: file, output: output, frame_rate: infoMedia.frame_rate })
      })
    }
    return tasks
  } catch (error) {
    throw 'buildRenderCode'
  }
}

function CMDSplitArgs(inputPath: string, outputPath: string, start: number, duration: number, videoEncoder: string, audioEncoder: string): string[] {
  return ['-hide_banner', '-y', '-ss', start.toString(), '-i', inputPath, '-t', duration.toString(), '-c:v', videoEncoder, '-c:a', audioEncoder, outputPath]
}

export const taskSplitRequest = async (
  options: FfmpegModel,
  getMediaInfoFunction?: (args: string[]) => Promise<any>,
  taskId?: string
) => {
  try {
    const tasks = <any[]>[]
    const outPath = getOutPath(options.outPath, options.outPathFix)
    for (let f = 0; f < options.inputFiles.length; f++) {
      let cutIndex = 0
      const file = options.inputFiles[f]
      if (!file) continue
      let currentStart = options.splitSecondStart
      const infoMedia = await onGetInfoMedia(file, getMediaInfoFunction)
      if (options.splitNumber > 0) {
        for (let i = 0; i < options.splitNumber; i++) {
          if (currentStart >= infoMedia.duration) break
          let duration = Math.floor(Math.random() * (options.splitSecondRandomMax - options.splitSecondRandomMin + 1)) + options.splitSecondRandomMin
          if (currentStart + duration > infoMedia.duration) duration = infoMedia.duration - currentStart
          if (duration <= 0) break
          const output = [outPath, getOutFile(file, `.${++cutIndex}`)].join('/')
          tasks.push({
            meta: {
              taskId: taskId || generateId(),
              input: file,
              output: output,
              outPath: outPath,
              duration: duration
            },
            command: '',
            options: { shell: false, windowsHide: true },
            args: CMDSplitArgs(file, output, currentStart, duration, options.videoEncoder, options.audioEncoder)
          })
          currentStart += duration
        }
      } else {
        while (currentStart < infoMedia.duration) {
          let duration = Math.floor(Math.random() * (options.splitSecondRandomMax - options.splitSecondRandomMin + 1)) + options.splitSecondRandomMin
          if (currentStart + duration > infoMedia.duration) duration = infoMedia.duration - currentStart
          if (duration <= 0) break
          const output = [outPath, getOutFile(file, `.${++cutIndex}`)].join('/')
          tasks.push({
            meta: {
              taskId: taskId || generateId(),
              input: file,
              output: output,
              outPath: outPath,
              duration: duration
            },
            command: '',
            options: { shell: false, windowsHide: true },
            args: CMDSplitArgs(file, output, currentStart, duration, options.videoEncoder, options.audioEncoder)
          })
          currentStart += duration
        }
      }
    }
    return tasks
  } catch (error) {
    throw 'buildRenderCode'
  }
}

export const CMDSplitRenderArgs = (options: FfmpegModel, aspectRatio: RenderAspectRatio, renderCode: any, start: number, duration: number, format: any): string[] => {
  const args: string[] = []
  if (options.hideBanner) args.push('-hide_banner')
  if (options.overwrite) args.push('-y')
  args.push('-ss', start.toString())
  const inputs = JSON.parse(JSON.stringify(renderCode.inputs))
  inputs.splice(2, 0, '-t', duration.toString())
  args.push(...inputs)
  args.push('-aspect', `${aspectRatio.ratioX}:${aspectRatio.ratioY}`)
  args.push('-b:v', options.bitrate)
  args.push('-filter_complex', `${renderCode.filtersVideo.join(';')};${renderCode.filtersAudio.join(';')}`)
  args.push('-map', '[v]', '-map', '[a]')
  args.push('-c:v', options.videoEncoder)
  args.push('-c:a', options.audioEncoder)
  args.push('-shortest')
  args.push(OUT_PUT)
  return formatArray(args, format)
}

export const taskSplitRenderRequest = async (
  options: FfmpegModel,
  aspectRatio: RenderAspectRatio,
  renderCode: any,
  getMediaInfoFunction?: (args: string[]) => Promise<any>,
  taskId?: string
) => {
  try {
    const tasks = <any[]>[]
    const outPath = getOutPath(options.outPath, options.outPathFix)
    for (let f = 0; f < options.inputFiles.length; f++) {
      let cutIndex = 0
      const file = options.inputFiles[f]
      if (!file) continue
      let currentStart = options.splitSecondStart
      const infoMedia = await onGetInfoMedia(file, getMediaInfoFunction)
      if (options.splitNumber > 0) {
        for (let i = 0; i < options.splitNumber; i++) {
          if (currentStart >= infoMedia.duration) break
          let duration = Math.floor(Math.random() * (options.splitSecondRandomMax - options.splitSecondRandomMin + 1)) + options.splitSecondRandomMin
          if (currentStart + duration > infoMedia.duration) duration = infoMedia.duration - currentStart
          if (duration <= 0) break
          const output = [outPath, getOutFile(file, `.${++cutIndex}`)].join('/')
          tasks.push({
            meta: {
              taskId: taskId || generateId(),
              input: file,
              output: output,
              outPath: outPath,
              duration: duration
            },
            command: '',
            options: { shell: false, windowsHide: true },
            args: CMDSplitRenderArgs(options, aspectRatio, renderCode, currentStart, duration, { mainfile: file, output: output, frame_rate: infoMedia.frame_rate })
          })
          currentStart += duration
        }
      } else {
        while (currentStart < infoMedia.duration) {
          let duration = Math.floor(Math.random() * (options.splitSecondRandomMax - options.splitSecondRandomMin + 1)) + options.splitSecondRandomMin
          if (currentStart + duration > infoMedia.duration) duration = infoMedia.duration - currentStart
          if (duration <= 0) break
          const output = [outPath, getOutFile(file, `.${++cutIndex}`)].join('/')
          tasks.push({
            meta: {
              taskId: taskId || generateId(),
              input: file,
              output: output,
              outPath: outPath,
              duration: duration
            },
            command: '',
            options: { shell: false, windowsHide: true },
            args: CMDSplitRenderArgs(options, aspectRatio, renderCode, currentStart, duration, { mainfile: file, output: output, frame_rate: infoMedia.frame_rate })
          })
          currentStart += duration
        }
      }
    }
    return tasks
  } catch (error) {
    throw 'buildRenderCode'
  }
}

export const CMDJoin = (options: FfmpegModel, aspectRatio: RenderAspectRatio, output: string) => {
  const args: string[] = []
  if (options.hideBanner) args.push('-hide_banner')
  if (options.overwrite) args.push('-y')
  options.inputFiles.forEach((file) => {
    args.push('-i', file)
  })

  const filterParts: string[] = []
  const concatInputs: string[] = []

  options.inputFiles.forEach((_, i) => {
    filterParts.push(`[${i}:v:0]scale=${aspectRatio.width}:${aspectRatio.height},setdar=${aspectRatio.ratioX}/${aspectRatio.ratioY}[v${i}]`)
    concatInputs.push(`[v${i}][${i}:a:0]`)
  })

  const filterComplex = filterParts.join(';') + ';' + concatInputs.join('') + `concat=n=${options.inputFiles.length}:v=1:a=1[v][a]`
  args.push('-filter_complex', filterComplex)
  args.push('-map', '[v]', '-map', '[a]')
  args.push('-c:v', options.videoEncoder, '-crf', '23', '-preset', 'fast', '-c:a', options.audioEncoder, '-b:a', '128k', output)
  return args
}

export const taskJoinRequest = async (
  options: FfmpegModel,
  aspectRatio: RenderAspectRatio,
  getMediaInfoFunction?: (args: string[]) => Promise<any>,
  taskId?: string
) => {
  try {
    const tasks = <any[]>[]
    const parseFile = parseFilePath(options.outFile)
    const infoMedias: VideoInfo[] = []
    for (const i of options.inputFiles) {
      if (!i) continue
      const infoMedia = await onGetInfoMedia(i, getMediaInfoFunction)
      infoMedias.push(infoMedia)
    }
    taskId = taskId || generateId()
    tasks.push({
      meta: {
        taskId: taskId,
        input: `[${options.inputFiles.length}]${taskId}`,
        inputs: JSON.parse(JSON.stringify(options.inputFiles)),
        output: options.outFile,
        outPath: parseFile?.dirPath || '',
        duration: infoMedias.reduce((acc, curr) => acc + curr.duration, 0)
      },
      command: '',
      options: { shell: false, windowsHide: true },
      args: CMDJoin(options, aspectRatio, options.outFile)
    })
    return tasks
  } catch (error) {
    throw 'buildRenderCode'
  }
}

export const taskJoinOneFolderRequest = async (
  options: FfmpegModel,
  aspectRatio: RenderAspectRatio,
  getMediaInfoFunction?: (args: string[]) => Promise<any>,
  taskId?: string
) => {
  try {
    const tasks = <any[]>[]
    const outPath = getOutPath(options.outPath, options.outPathFix)
    const firstFile = options.inputFiles[0]
    if (!firstFile) throw 'noInputFiles'

    if (options.joinAll) {
      taskId = taskId || generateId()
      const parseFile = parseFilePath(firstFile)
      const inputFile = [options.inPath, parseFile?.extension || 'mp4'].join('.')
      const output = [outPath, getOutFile(inputFile)].join('/')
      const infoMedias: VideoInfo[] = []
      for (const i of options.inputFiles) {
        if (!i) continue
        const infoMedia = await onGetInfoMedia(i, getMediaInfoFunction)
        infoMedias.push(infoMedia)
      }
      tasks.push({
        meta: {
          taskId: taskId,
          input: `[${options.inputFiles.length}]${taskId}`,
          inputs: JSON.parse(JSON.stringify(options.inputFiles)),
          output: output,
          outPath: outPath,
          duration: infoMedias.reduce((acc, curr) => acc + curr.duration, 0)
        },
        command: '',
        options: { shell: false, windowsHide: true },
        args: CMDJoin(options, aspectRatio, output)
      })
    } else {
      const files = splitRandomItems(options.inputFiles, options.joinRandomNumberMin, options.joinRandomNumberMax, 2, options.shuffle)
      for (let idx = 0; idx < files.length; idx++) {
        const groupFiles = files[idx]
        if (!groupFiles) continue
        const optionsFile = { ...options, inputFiles: groupFiles }
        taskId = generateId()
        const parseFile = parseFilePath(firstFile)
        const inputFile = [options.inPath, parseFile?.extension || 'mp4'].join('.')
        const output = [outPath, getOutFile(inputFile, `.${idx + 1}`)].join('/')
        const infoMedias: VideoInfo[] = []
        for (const i of groupFiles) {
          if (!i) continue
          const infoMedia = await onGetInfoMedia(i, getMediaInfoFunction)
          infoMedias.push(infoMedia)
        }
        tasks.push({
          meta: {
            taskId: taskId,
            input: `[${groupFiles.length}]${taskId}`,
            inputs: JSON.parse(JSON.stringify(optionsFile.inputFiles)),
            output: output,
            outPath: outPath,
            duration: infoMedias.reduce((acc, curr) => acc + curr.duration, 0)
          },
          command: '',
          options: { shell: false, windowsHide: true },
          args: CMDJoin(optionsFile, aspectRatio, output)
        })
      }
    }
    return tasks
  } catch (error) {
    throw 'buildRenderCode'
  }
}

export const taskJoinsubfoldersRequest = async (
  options: FfmpegModel,
  aspectRatio: RenderAspectRatio,
  getMediaInfoFunction?: (args: string[]) => Promise<any>,
  taskId?: string
) => {
  try {
    const tasks = <any[]>[]
    const outPath = getOutPath(options.outPath, options.outPathFix)
    if (!options.inputExtraFiles) return tasks

    for (let idx = 0; idx < options.inputExtraFiles.length; idx++) {
      const extra = options.inputExtraFiles[idx]
      if (!extra || !extra.children.length) continue
      const firstFile = extra.children[0]
      if (!firstFile) continue

      const optionsFile = { ...options, inPath: extra.inPath, inputFiles: extra.children }
      taskId = generateId()
      const parseFile = parseFilePath(firstFile)
      const inputFile = [optionsFile.inPath, parseFile?.extension || 'mp4'].join('.')
      const output = [outPath, getOutFile(inputFile)].join('/')
      const infoMedias: VideoInfo[] = []
      for (const i of extra.children) {
        if (!i) continue
        const infoMedia = await onGetInfoMedia(i, getMediaInfoFunction)
        infoMedias.push(infoMedia)
      }
      tasks.push({
        meta: {
          taskId: taskId,
          input: `[${optionsFile.inputFiles.length}]${taskId}`,
          inputs: JSON.parse(JSON.stringify(optionsFile.inputFiles)),
          output: output,
          outPath: outPath,
          duration: infoMedias.reduce((acc, curr) => acc + curr.duration, 0)
        },
        command: '',
        options: { shell: false, windowsHide: true },
        args: CMDJoin(optionsFile, aspectRatio, output)
      })
    }
    return tasks
  } catch (error) {
    throw 'buildRenderCode'
  }
}

export const taskJoinRenderRequest = async (
  options: FfmpegModel,
  aspectRatio: RenderAspectRatio,
  renderCode: any,
  getMediaInfoFunction?: (args: string[]) => Promise<any>
) => {
  try {
    const tasks = <any[]>[]
    const taskId = generateId()
    const parseFile = parseFilePath(options.outFile)
    const outFile = `${parseFile?.dirPath || ''}/${taskId}.${parseFile?.extension || 'mp4'}`
    const outPath = getOutPath(parseFile?.dirPath || '', '')
    const infoMedias: VideoInfo[] = []
    for (const i of options.inputFiles) {
      if (!i) continue
      const infoMedia = await onGetInfoMedia(i, getMediaInfoFunction)
      infoMedias.push(infoMedia)
    }
    const duration = infoMedias.reduce((acc, curr) => acc + curr.duration, 0)
    options.outFileTmp.push(outFile)

    // Join files
    tasks.push({
      meta: {
        taskId: taskId,
        input: `[${options.inputFiles.length}]${taskId}`,
        inputs: JSON.parse(JSON.stringify(options.inputFiles)),
        output: outFile,
        outPath: parseFile?.dirPath || '',
        duration: duration
      },
      command: '',
      options: { shell: false, windowsHide: true },
      args: CMDJoin(options, aspectRatio, outFile)
    })

    // Render file joined
    const firstInfo = infoMedias[0]
    const frameRate = firstInfo ? firstInfo.frame_rate : 30
    tasks.push({
      meta: {
        taskId: generateId(),
        input: outFile,
        output: options.outFile,
        outPath: outPath,
        duration: duration
      },
      command: '',
      options: { shell: false, windowsHide: true },
      args: CMDRenderArgs(options, aspectRatio, renderCode, { mainfile: outFile, output: options.outFile, frame_rate: frameRate })
    })
    return [tasks]
  } catch (error) {
    throw 'buildRenderCode'
  }
}

export const CMDSlideshowArgs = (
  options: FfmpegModel,
  aspectRatio: RenderAspectRatio,
  images: string[],
  settings: {
    w: number
    h: number
    fps: number
    image_durations: number[]
    transition_durations: number[]
    transitions: string[]
    audioPath: string | null
    speed: number
    volume: number
  },
  output: string
): string[] => {
  const args: string[] = []
  if (options.hideBanner) args.push('-hide_banner')
  if (options.overwrite) args.push('-y')

  // Inputs
  images.forEach((img) => {
    args.push('-i', img)
  })
  if (settings.audioPath) {
    args.push('-i', settings.audioPath)
  }

  const w = settings.w
  const h = settings.h
  const fps = settings.fps
  const speed = settings.speed
  const vol = settings.volume

  // Complex Filter
  const filterComplex: string[] = []
  let prevZoomDir = ''
  let prevZoomMode = ''

  for (let i = 0; i < images.length; i++) {
    const dur = settings.image_durations[i] || 4.0
    const totalFrames = Math.round(dur * fps)

    // Zoom direction
    const directions = ['center', 'left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right']
    const availableDirs = prevZoomDir ? directions.filter(d => d !== prevZoomDir) : directions
    const actualDir = availableDirs[Math.floor(Math.random() * availableDirs.length)] || 'center'
    prevZoomDir = actualDir

    // Zoom mode (in vs out)
    const actualMode = prevZoomMode === 'in' ? 'out' : 'in'
    prevZoomMode = actualMode

    // Zoom expression
    const ratio = 0.8 // shrink ratio
    const currMaxZoom = 1.15
    const zoomRange = currMaxZoom - 1.0
    const frameSpeed = zoomRange / totalFrames

    const zExpr = actualMode === 'out'
      ? `${currMaxZoom}-${frameSpeed.toFixed(6)}*on`
      : `1.0+${frameSpeed.toFixed(6)}*on`

    // Direction coordinate expressions
    let xExpr = '0'
    let yExpr = '0'
    if (actualDir === 'center') {
      xExpr = 'iw/2-(iw/zoom/2)'
      yExpr = 'ih/2-(ih/zoom/2)'
    } else if (actualDir === 'left') {
      xExpr = '0'
      yExpr = 'ih/2-(ih/zoom/2)'
    } else if (actualDir === 'right') {
      xExpr = 'iw-iw/zoom'
      yExpr = 'ih/2-(ih/zoom/2)'
    } else if (actualDir === 'top') {
      xExpr = 'iw/2-(iw/zoom/2)'
      yExpr = '0'
    } else if (actualDir === 'bottom') {
      xExpr = 'iw/2-(iw/zoom/2)'
      yExpr = 'ih-ih/zoom'
    } else if (actualDir === 'top-left') {
      xExpr = '0'
      yExpr = '0'
    } else if (actualDir === 'top-right') {
      xExpr = 'iw-iw/zoom'
      yExpr = '0'
    } else if (actualDir === 'bottom-left') {
      xExpr = '0'
      yExpr = 'ih-ih/zoom'
    } else if (actualDir === 'bottom-right') {
      xExpr = 'iw-iw/zoom'
      yExpr = 'ih-ih/zoom'
    }

    // Shrink scale dimensions
    const shrinkW = Math.round(w * 4 * ratio)
    const shrinkH = Math.round(h * 4 * ratio)

    const bgBlurFilter = `[${i}:v]split=2[bg_raw${i}][fg_raw${i}];[bg_raw${i}]scale=${w * 4}:${h * 4}:force_original_aspect_ratio=increase,crop=${w * 4}:${h * 4},boxblur=40:3[bg_blurred${i}];[fg_raw${i}]scale=${shrinkW}:${shrinkH}:force_original_aspect_ratio=decrease[fg_scaled${i}];[bg_blurred${i}][fg_scaled${i}]overlay=(W-w)/2:(H-h)/2[v_prezoom${i}]`
    filterComplex.push(bgBlurFilter)

    // Post-zoompan filter
    const postFilter = `[v_prezoom${i}]zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=${totalFrames}:s=${w}x${h}:fps=${fps},scale=${w}:${h},setsar=1,setpts=${(1.0 / speed).toFixed(4)}*PTS[v${i}]`
    filterComplex.push(postFilter)
  }

  // Chain xfade transitions between clips
  let currentV = '[v0]'
  let cumulativeOffset = 0.0
  for (let i = 1; i < images.length; i++) {
    const tDur = settings.transition_durations[i - 1] || 1.0
    const durPrev = (settings.image_durations[i - 1] || 4.0) / speed
    cumulativeOffset += (durPrev - tDur)

    const offsetVal = cumulativeOffset.toFixed(3)
    const trans = settings.transitions[i - 1] || 'fade'
    const newV = `[vt${i}]`
    filterComplex.push(`${currentV}[v${i}]xfade=transition=${trans}:duration=${tDur}:offset=${offsetVal}${newV}`)
    currentV = newV
  }

  // Audio mix filters
  if (settings.audioPath) {
    const audioIdx = images.length
    const atempoArg = speed !== 1.0 ? `,atempo=${speed.toFixed(2)}` : ''
    filterComplex.push(`[${audioIdx}:a]volume=${vol}${atempoArg}[afinal]`)
  }

  args.push('-filter_complex', filterComplex.join(';'))
  args.push('-map', currentV)
  if (settings.audioPath) {
    args.push('-map', '[afinal]', '-shortest')
  }

  args.push('-c:v', options.videoEncoder, '-b:v', options.bitrate, '-pix_fmt', 'yuv420p', '-r', fps.toString(), '-fps_mode', 'cfr')
  if (settings.audioPath) {
    args.push('-c:a', options.audioEncoder, '-b:a', '128k')
  }

  args.push(output)
  return args
}

export const taskSlideshowRequest = async (
  options: FfmpegModel,
  aspectRatio: RenderAspectRatio,
  getMediaInfoFunction?: (args: string[]) => Promise<any>,
  taskId?: string
) => {
  try {
    const tasks = <any[]>[]
    const parseFile = parseFilePath(options.outFile)
    taskId = taskId || generateId()

    const w = aspectRatio.width || 1280
    const h = aspectRatio.height || 720
    const fps = 30
    const speed = (options as any).speed || 1.0
    const vol = (options as any).volume || 1.0

    const imageDurations: number[] = []
    const transitionDurations: number[] = []
    const transitionsList: string[] = []

    const availableTransitions = [
      'fade', 'slideleft', 'slideright', 'slideup', 'slidedown',
      'wipeleft', 'wiperight', 'wipeup', 'wipedown',
      'dissolve', 'pixelize', 'zoomin'
    ]

    let currentTotalDuration = 0.0
    for (let i = 0; i < options.inputFiles.length; i++) {
      const dur = Math.round((Math.random() * 2.0 + 3.0) * 100) / 100
      imageDurations.push(dur)

      if (i === 0) {
        currentTotalDuration = dur
      } else {
        let tDur = Math.round((Math.random() * 0.4 + 0.8) * 100) / 100
        tDur = Math.min(tDur, dur * 0.4, (imageDurations[i - 1] || 4.0) * 0.4)
        transitionDurations.push(tDur)
        currentTotalDuration += (dur - tDur)

        const trans = availableTransitions[Math.floor(Math.random() * availableTransitions.length)] || 'fade'
        transitionsList.push(trans)
      }
    }

    const audioPath = options.inputSubFiles && options.inputSubFiles.length > 0 ? options.inputSubFiles[0] || null : null

    const slideshowSettings = {
      w,
      h,
      fps,
      image_durations: imageDurations,
      transition_durations: transitionDurations,
      transitions: transitionsList,
      audioPath,
      speed,
      volume: vol
    }

    tasks.push({
      meta: {
        taskId,
        input: `[${options.inputFiles.length}]${taskId}`,
        inputs: JSON.parse(JSON.stringify(options.inputFiles)),
        output: options.outFile,
        outPath: parseFile?.dirPath || '',
        duration: Math.round(currentTotalDuration / speed * 100) / 100
      },
      command: '',
      options: { shell: false, windowsHide: true },
      args: CMDSlideshowArgs(options, aspectRatio, options.inputFiles, slideshowSettings, options.outFile)
    })

    return tasks
  } catch (error) {
    throw 'buildSlideshowCode'
  }
}

export const taskBatchSlideshowRequest = async (
  options: FfmpegModel,
  aspectRatio: RenderAspectRatio,
  getMediaInfoFunction?: (args: string[]) => Promise<any>,
  taskId?: string
) => {
  try {
    const tasks = <any[]>[]
    const outPath = getOutPath(options.outPath, options.outPathFix)

    if (!options.inputExtraFiles || !options.inputExtraFiles.length) {
      return tasks
    }

    const w = aspectRatio.width || 1280
    const h = aspectRatio.height || 720
    const fps = 30
    const speed = (options as any).speed || 1.0
    const vol = (options as any).volume || 1.0

    const availableTransitions = [
      'fade', 'slideleft', 'slideright', 'slideup', 'slidedown',
      'wipeleft', 'wiperight', 'wipeup', 'wipedown',
      'dissolve', 'pixelize', 'zoomin'
    ]

    for (let f = 0; f < options.inputExtraFiles.length; f++) {
      const folderData = options.inputExtraFiles[f]
      if (!folderData || !folderData.children || folderData.children.length < 2) continue

      const subFolderImages = folderData.children
      const folderName = folderData.inPath.replace(/\\/g, '/').split('/').pop() || `slideshow_${f + 1}`
      const ext = options.outFile ? parseFilePath(options.outFile)?.extension || 'mp4' : 'mp4'
      const output = `${outPath}/${folderName}.${ext}`

      const imageDurations: number[] = []
      const transitionDurations: number[] = []
      const transitionsList: string[] = []

      let currentTotalDuration = 0.0
      for (let i = 0; i < subFolderImages.length; i++) {
        const dur = Math.round((Math.random() * 2.0 + 3.0) * 100) / 100
        imageDurations.push(dur)

        if (i === 0) {
          currentTotalDuration = dur
        } else {
          let tDur = Math.round((Math.random() * 0.4 + 0.8) * 100) / 100
          tDur = Math.min(tDur, dur * 0.4, (imageDurations[i - 1] || 4.0) * 0.4)
          transitionDurations.push(tDur)
          currentTotalDuration += (dur - tDur)

          const trans = availableTransitions[Math.floor(Math.random() * availableTransitions.length)] || 'fade'
          transitionsList.push(trans)
        }
      }

      const audioPath = options.inputSubFiles && options.inputSubFiles.length > 0 ? options.inputSubFiles[0] || null : null

      const slideshowSettings = {
        w,
        h,
        fps,
        image_durations: imageDurations,
        transition_durations: transitionDurations,
        transitions: transitionsList,
        audioPath,
        speed,
        volume: vol
      }

      tasks.push({
        meta: {
          taskId: generateId(),
          input: `[${subFolderImages.length}]${folderName}`,
          inputs: JSON.parse(JSON.stringify(subFolderImages)),
          output: output,
          outPath: outPath,
          duration: Math.round(currentTotalDuration / speed * 100) / 100
        },
        command: '',
        options: { shell: false, windowsHide: true },
        args: CMDSlideshowArgs(options, aspectRatio, subFolderImages, slideshowSettings, output)
      })
    }

    return tasks
  } catch (error) {
    throw 'buildBatchSlideshowCode'
  }
}
