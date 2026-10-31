// =============================================================================
//  @tmcut/core — stabilize
//  Portable argument plans for 2-pass video stabilization via vidstab
//  (Roadmap E-5).
//  Pass 1: vidstabdetect extracts camera motion vectors into a .trf file.
//  Pass 2: vidstabtransform applies smoothing and compensation to generate
//  a stabilized video stream.
// =============================================================================

/**
 * Escape file path for FFmpeg filter parameter (forward slashes + colon escape).
 * Throws if the path contains single quotes, which cannot be escaped in FFmpeg filter strings.
 */
export function escapeFilterPath(filePath) {
  if (typeof filePath !== 'string') return ''
  if (filePath.includes('\'')) {
    throw new Error('File path cannot contain single quotes')
  }
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:')
}

/** Standard stabilization presets with tuned smoothing and accuracy values. */
export const STABILIZE_PRESETS = {
  mild: {
    smoothing: 10,
    shakiness: 4,
    accuracy: 10,
    stepsize: 6,
    zoom: 0,
    optalgo: 'gauss'
  },
  medium: {
    smoothing: 20,
    shakiness: 6,
    accuracy: 15,
    stepsize: 6,
    zoom: 0,
    optalgo: 'gauss'
  },
  aggressive: {
    smoothing: 35,
    shakiness: 8,
    accuracy: 15,
    stepsize: 4,
    zoom: 0,
    optalgo: 'gauss'
  }
}

/**
 * Resolves stabilization options from a level name or custom options object.
 *
 * @param {'mild' | 'medium' | 'aggressive' | Object} [options='medium']
 * @returns {Object} Complete stabilization configuration
 */
export function resolveStabilizeOptions(options = 'medium') {
  if (typeof options === 'string' && STABILIZE_PRESETS[options]) {
    return { ...STABILIZE_PRESETS[options], level: options }
  }
  if (typeof options === 'object' && options !== null) {
    const base = STABILIZE_PRESETS[options.level] || STABILIZE_PRESETS.medium
    return {
      level: options.level || 'medium',
      smoothing: Number.isFinite(options.smoothing) ? Math.max(1, options.smoothing) : base.smoothing,
      shakiness: Number.isFinite(options.shakiness) ? Math.max(1, Math.min(10, options.shakiness)) : base.shakiness,
      accuracy: Number.isFinite(options.accuracy) ? Math.max(1, Math.min(15, options.accuracy)) : base.accuracy,
      stepsize: Number.isFinite(options.stepsize) ? Math.max(1, options.stepsize) : base.stepsize,
      zoom: Number.isFinite(options.zoom) ? options.zoom : base.zoom,
      optalgo: options.optalgo || base.optalgo
    }
  }
  return { ...STABILIZE_PRESETS.medium, level: 'medium' }
}

/**
 * Builds FFmpeg argument list for Pass 1 (vidstabdetect).
 *
 * @param {string} input - Source video path
 * @param {string} trfPath - Destination path for motion vector file (.trf)
 * @param {'mild'|'medium'|'aggressive'|Object} [options='medium']
 * @returns {string[]} Argument array
 */
export function buildVidstabDetectArgs(input, trfPath, options = 'medium') {
  const cfg = resolveStabilizeOptions(options)
  const escapedTrf = escapeFilterPath(trfPath)
  const filter = `vidstabdetect=stepsize=${cfg.stepsize}:shakiness=${cfg.shakiness}:accuracy=${cfg.accuracy}:result='${escapedTrf}'`
  return [
    '-y',
    '-i',
    input,
    '-vf',
    filter,
    '-f',
    'null',
    '-'
  ]
}

/**
 * Builds FFmpeg argument list for Pass 2 (vidstabtransform).
 *
 * @param {string} input - Source video path
 * @param {string} trfPath - Motion vector file path (.trf)
 * @param {string} output - Destination stabilized video path (.mp4)
 * @param {'mild'|'medium'|'aggressive'|Object} [options='medium']
 * @returns {string[]} Argument array
 */
export function buildVidstabTransformArgs(input, trfPath, output, options = 'medium') {
  const cfg = resolveStabilizeOptions(options)
  const escapedTrf = escapeFilterPath(trfPath)
  const filter = `vidstabtransform=input='${escapedTrf}':smoothing=${cfg.smoothing}:optalgo=${cfg.optalgo}:zoom=${cfg.zoom}`
  return [
    '-y',
    '-i',
    input,
    '-vf',
    filter,
    '-c:v',
    'libx264',
    '-crf',
    '18',
    '-preset',
    'veryfast',
    '-c:a',
    'copy',
    output
  ]
}
