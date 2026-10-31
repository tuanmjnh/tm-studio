// =============================================================================
//  @tmcut/core — effects registry (Roadmap C6)
//  First-wave effect descriptors + validation + normalization for clip
//  `effects: [{ type, params }]` (docs DSL v3, TmcutClipEffect).
//
//  `renderReady` is the honesty flag: it stays FALSE until the export
//  compiler actually maps the effect (Roadmap R4) — consumers must show a
//  truthful "not exported yet" badge instead of implying the file will
//  contain the effect. Preview (CSS/filter) may still render it.
//
//  `label` is an English constant (AGENTS.md); UIs translate by the
//  registry type key and treat `label` as a developer fallback only.
// =============================================================================

/**
 * Effect parameter descriptor. Kinds (spec C6): number (min/max range),
 * color (hex string), enum (options list), bool (true/false).
 */
// EffectParam = { name, kind, min?, max?, default?, options? }

export const EFFECT_REGISTRY = {
  'blur': {
    type: 'blur',
    label: 'Blur',
    category: 'blur',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'approximate' },
    params: [
      { name: 'amount', kind: 'number', min: 0, max: 100, default: 50 }
    ]
  },
  'sharpen': {
    type: 'sharpen',
    label: 'Sharpen',
    category: 'sharpen',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'approximate' },
    params: [
      { name: 'amount', kind: 'number', min: 0, max: 100, default: 50 }
    ]
  },
  'vignette': {
    type: 'vignette',
    label: 'Vignette',
    category: 'light',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'approximate' },
    params: [
      { name: 'intensity', kind: 'number', min: 0, max: 100, default: 50 }
    ]
  },
  'grain': {
    type: 'grain',
    label: 'Grain',
    category: 'texture',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'approximate' },
    params: [
      { name: 'amount', kind: 'number', min: 0, max: 100, default: 30 },
      { name: 'size', kind: 'enum', options: ['fine', 'medium', 'coarse'], default: 'fine' }
    ]
  },
  'chromakey': {
    type: 'chromakey',
    label: 'Chroma Key',
    category: 'keying',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'illustrative' },
    params: [
      { name: 'color', kind: 'color', default: '#00ff00' },
      { name: 'similarity', kind: 'number', min: 0, max: 100, default: 30 },
      { name: 'blend', kind: 'number', min: 0, max: 100, default: 10 },
      { name: 'spill', kind: 'bool', default: true }
    ]
  },
  'lut3d': {
    type: 'lut3d',
    label: 'LUT 3D',
    category: 'color',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'approximate' },
    params: [
      // Preset grades (R128 A3): 20 linear FFmpeg mappings, all render
      // verified. The first five keep their R4 order/output byte-identical
      // so stored projects resolve to the exact same filter strings; only
      // 'neutral' is a no-op (see buildFfmpegEffectFilters). File-based
      // `.cube` loading still arrives with a future `file` param kind.
      {
        name: 'lut',
        kind: 'enum',
        options: [
          'neutral', 'warm', 'cool', 'cinematic', 'vintage',
          'vivid', 'fade', 'mono', 'sepia', 'noir',
          'bleach', 'teal-orange', 'sunset', 'moonlight', 'forest',
          'rose', 'cyberpunk', 'film', 'honey', 'arctic'
        ],
        default: 'neutral'
      }
    ]
  },
  'stabilize': {
    type: 'stabilize',
    label: 'Stabilize',
    category: 'motion',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'illustrative' },
    params: [
      { name: 'strength', kind: 'number', min: 0, max: 100, default: 50 }
    ]
  },
  'eq-grade': {
    type: 'eq-grade',
    label: 'EQ / Grade',
    category: 'color',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'approximate' },
    params: [
      { name: 'brightness', kind: 'number', min: -100, max: 100, default: 0 },
      { name: 'contrast', kind: 'number', min: 0, max: 200, default: 100 },
      { name: 'saturation', kind: 'number', min: 0, max: 200, default: 100 },
      // R117: color temperature — negative = cooler (blue), positive =
      // warmer (amber). Mapped to FFmpeg colorbalance (red/blue) at export.
      { name: 'temp', kind: 'number', min: -100, max: 100, default: 0 },
      // R128 A4 adjust params. Every default is a true no-op so a stored
      // legacy eq-grade exports the byte-identical filter string. hue is
      // degrees, gamma is percent (100 = neutral 1.0), fade lifts the black
      // floor (matte look) and vibrance is a biased -100..100 saturation.
      { name: 'hue', kind: 'number', min: -180, max: 180, default: 0 },
      { name: 'gamma', kind: 'number', min: 10, max: 300, default: 100 },
      { name: 'fade', kind: 'number', min: 0, max: 100, default: 0 },
      { name: 'vibrance', kind: 'number', min: -100, max: 100, default: 0 }
    ]
  },
  // --- R128 A2: stylize ---
  'pixelate': {
    type: 'pixelate',
    label: 'Pixelate',
    category: 'stylize',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'approximate' },
    params: [
      // Block size in pixels. Mapped to FFmpeg `pixelize` rather than a
      // scale-down/scale-up pair: scaling cannot restore the exact frame
      // size (trunc() leaves a remainder), and the render path comma-chains
      // effects into streams that must keep their dimensions for concat.
      { name: 'size', kind: 'number', min: 1, max: 64, default: 12 },
      { name: 'mode', kind: 'enum', options: ['avg', 'min', 'max'], default: 'avg' }
    ]
  },
  'emboss': {
    type: 'emboss',
    label: 'Emboss',
    category: 'stylize',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'illustrative' },
    params: [
      // Scales the convolution divisor (100 = the classic 3x3 kernel).
      { name: 'amount', kind: 'number', min: 0, max: 100, default: 100 }
    ]
  },
  'edge-detect': {
    type: 'edge-detect',
    label: 'Edge Detect',
    category: 'stylize',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'illustrative' },
    params: [
      // low/high only apply to the canny mode; the other modes ignore them.
      { name: 'mode', kind: 'enum', options: ['wires', 'colormix', 'canny'], default: 'wires' },
      { name: 'low', kind: 'number', min: 0, max: 1, default: 0.1 },
      { name: 'high', kind: 'number', min: 0, max: 1, default: 0.4 }
    ]
  },
  'letterbox': {
    type: 'letterbox',
    label: 'Letterbox',
    category: 'stylize',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'exact' },
    params: [
      // Bar height as a percentage of the frame height.
      { name: 'size', kind: 'number', min: 1, max: 40, default: 12 }
    ]
  },
  // --- R128 A2: color ---
  'negate': {
    type: 'negate',
    label: 'Negate',
    category: 'color',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'exact' },
    params: [
      { name: 'alpha', kind: 'bool', default: false }
    ]
  },
  'vivid': {
    type: 'vivid',
    label: 'Vivid',
    category: 'color',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'approximate' },
    params: [
      { name: 'amount', kind: 'number', min: 0, max: 100, default: 50 }
    ]
  },
  'bleach-bypass': {
    type: 'bleach-bypass',
    label: 'Bleach Bypass',
    category: 'color',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'approximate' },
    params: [
      { name: 'amount', kind: 'number', min: 0, max: 100, default: 100 }
    ]
  },
  'teal-orange': {
    type: 'teal-orange',
    label: 'Teal & Orange',
    category: 'color',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'approximate' },
    params: [
      { name: 'amount', kind: 'number', min: 0, max: 100, default: 60 }
    ]
  },
  'vibrance': {
    type: 'vibrance',
    label: 'Vibrance',
    category: 'color',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'approximate' },
    params: [
      { name: 'intensity', kind: 'number', min: -100, max: 100, default: 50 }
    ]
  },
  // --- R128 A2: distort ---
  'mirror-h': {
    type: 'mirror-h',
    label: 'Mirror Horizontal',
    category: 'distort',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'exact' },
    params: [
      { name: 'axis', kind: 'enum', options: ['horizontal', 'vertical', 'both'], default: 'horizontal' }
    ]
  },
  'mirror-v': {
    type: 'mirror-v',
    label: 'Mirror Vertical',
    category: 'distort',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'exact' },
    params: [
      { name: 'axis', kind: 'enum', options: ['horizontal', 'vertical', 'both'], default: 'vertical' }
    ]
  },
  'rotate-90': {
    type: 'rotate-90',
    label: 'Rotate 90',
    category: 'distort',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'approximate' },
    params: [
      // 1..3 clockwise quarter turns. NOTE: this is the only new effect that
      // swaps the frame width/height (transpose), so the caller has to
      // re-fit the clip stream to the canvas before concat/xfade.
      { name: 'turns', kind: 'number', min: 1, max: 3, default: 1 }
    ]
  },
  'chromatic': {
    type: 'chromatic',
    label: 'Chromatic Aberration',
    category: 'distort',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'approximate' },
    params: [
      { name: 'shift', kind: 'number', min: 1, max: 64, default: 6 }
    ]
  },
  'fisheye': {
    type: 'fisheye',
    label: 'Fisheye',
    category: 'distort',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'illustrative' },
    params: [
      { name: 'strength', kind: 'number', min: 0, max: 100, default: 30 }
    ]
  },
  // --- R128 A2: motion ---
  'motion-blur': {
    type: 'motion-blur',
    label: 'Motion Blur',
    category: 'motion',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'illustrative' },
    params: [
      { name: 'frames', kind: 'number', min: 2, max: 30, default: 8 }
    ]
  },
  'afterimage': {
    type: 'afterimage',
    label: 'Afterimage',
    category: 'motion',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'illustrative' },
    params: [
      { name: 'decay', kind: 'number', min: 0, max: 100, default: 80 }
    ]
  },
  // --- R128 A2: texture ---
  'denoise': {
    type: 'denoise',
    label: 'Denoise',
    category: 'texture',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'approximate' },
    params: [
      { name: 'strength', kind: 'number', min: 0, max: 100, default: 50 }
    ]
  },
  'deband': {
    type: 'deband',
    label: 'Deband',
    category: 'texture',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'approximate' },
    params: [
      // Threshold in 1/1000 units (20 = the FFmpeg default 0.02).
      { name: 'threshold', kind: 'number', min: 1, max: 100, default: 20 },
      { name: 'range', kind: 'number', min: 4, max: 64, default: 16 }
    ]
  },
  // --- R128 A2: retro ---
  'sepia': {
    type: 'sepia',
    label: 'Sepia',
    category: 'retro',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'exact' },
    params: [
      { name: 'intensity', kind: 'number', min: 0, max: 100, default: 100 }
    ]
  },
  'mono': {
    type: 'mono',
    label: 'Monochrome',
    category: 'retro',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'approximate' },
    params: [
      { name: 'intensity', kind: 'number', min: 0, max: 100, default: 100 }
    ]
  },
  'vhs': {
    type: 'vhs',
    label: 'VHS',
    category: 'retro',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'approximate' },
    params: [
      { name: 'amount', kind: 'number', min: 0, max: 100, default: 50 }
    ]
  }
}

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

function paramErrors(type, param, value) {
  const at = `effect ${type}.${param.name}`
  switch (param.kind) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return [`${at} must be a number`]
      }
      if (value < param.min || value > param.max) {
        return [`${at}: ${value} out of range [${param.min}, ${param.max}]`]
      }
      return []
    }
    case 'color': {
      if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
        return [`${at} must be a hex color (#rgb/#rrggbb/#rrggbbaa)`]
      }
      return []
    }
    case 'enum': {
      if (!Array.isArray(param.options) || !param.options.includes(value)) {
        return [`${at}: ${JSON.stringify(value)} not in options [${(param.options ?? []).join(', ')}]`]
      }
      return []
    }
    case 'bool': {
      if (typeof value !== 'boolean') return [`${at} must be a boolean`]
      return []
    }
    default:
      return [`${at}: unsupported param kind ${param.kind}`]
  }
}

/**
 * Structural validation of ONE effect (error style of `validateTimeline`:
 * human-readable strings, empty = valid). Only PRESENT params are checked —
 * missing params are legal (normalize fills the defaults).
 */
export function validateEffect(effect) {
  if (!effect || typeof effect !== 'object' || Array.isArray(effect)) {
    return ['effect must be an object']
  }
  const desc = EFFECT_REGISTRY[effect.type]
  if (!desc) return [`unknown effect type: ${effect.type}`]
  const params = effect.params
  if (params === undefined || params === null) return []
  if (typeof params !== 'object' || Array.isArray(params)) {
    return [`effect ${effect.type} params must be an object`]
  }
  const errors = []
  for (const [key, value] of Object.entries(params)) {
    const param = desc.params.find(candidate => candidate.name === key)
    if (!param) {
      errors.push(`effect ${effect.type} has unknown param: ${key}`)
      continue
    }
    errors.push(...paramErrors(effect.type, param, value))
  }
  return errors
}

function coerceValue(param, raw) {
  const fallback = param.default
  switch (param.kind) {
    case 'number': {
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        return Math.min(param.max, Math.max(param.min, raw))
      }
      return fallback
    }
    case 'color': {
      return typeof raw === 'string' && HEX_COLOR.test(raw) ? raw : fallback
    }
    case 'enum': {
      return Array.isArray(param.options) && param.options.includes(raw) ? raw : fallback
    }
    case 'bool':
      return typeof raw === 'boolean' ? raw : fallback
    default:
      return fallback
  }
}

/**
 * Clean a dirty effects list into well-formed `TmcutClipEffect[]`:
 * unknown entries/types are DROPPED, unknown param fields are dropped
 * (registry whitelist), numbers are clamped into range, invalid values
 * fall back to the param default, and every registry param is filled —
 * so the output always passes `validateEffect`.
 */
export function normalizeEffects(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const desc = EFFECT_REGISTRY[entry.type]
    if (!desc) continue
    const params = entry.params && typeof entry.params === 'object' && !Array.isArray(entry.params)
      ? entry.params
      : {}
    const clean = {}
    for (const param of desc.params) {
      clean[param.name] = coerceValue(param, params[param.name])
    }
    out.push({ type: entry.type, params: clean })
  }
  return out
}

// R128 A3 — lut3d preset chains. Every value is one linear FFmpeg chain
// (single input, comma-chained like the caller does) and was render-verified
// against real FFmpeg. The first five keep their R4 strings byte-identical;
// 'neutral' is deliberately absent so it emits nothing (legacy no-op).
const LUT3D_CHAINS = {
  'warm': 'colorbalance=rs=0.12:gs=0.02:bs=-0.1',
  'cool': 'colorbalance=rs=-0.1:gs=0.02:bs=0.15',
  'cinematic': 'curves=preset=cross_process,eq=contrast=1.1:saturation=1.15',
  'vintage': 'colorbalance=rs=0.15:gs=0.08:bs=-0.12,eq=contrast=0.95:saturation=0.85',
  'vivid': 'eq=saturation=1.45:contrast=1.12:brightness=0.02',
  'fade': 'curves=preset=lighter,eq=saturation=0.78:contrast=0.9:brightness=0.03',
  'mono': 'hue=s=0,eq=contrast=1.08',
  'sepia': 'colorchannelmixer=rr=0.393:rg=0.769:rb=0.189:gr=0.349:gg=0.686:gb=0.168:br=0.272:bg=0.534:bb=0.131',
  'noir': 'hue=s=0,curves=preset=strong_contrast,eq=brightness=-0.02',
  'bleach': 'curves=preset=strong_contrast,eq=saturation=0.35:contrast=1.15',
  'teal-orange': 'colorbalance=bs=0.18:gs=0.05:rh=0.14:rm=0.1,eq=saturation=1.08',
  'sunset': 'colorbalance=rs=0.2:gs=0.05:bs=-0.15:rm=0.1,eq=saturation=1.15:brightness=0.02',
  'moonlight': 'colorbalance=rs=-0.12:bs=0.2:bm=0.08,eq=brightness=-0.03:saturation=0.85:contrast=1.05',
  'forest': 'colorbalance=gs=0.15:rs=-0.1:bs=0.05,eq=saturation=1.1:contrast=1.03',
  'rose': 'colorbalance=rs=0.16:rm=0.08:bs=-0.05,eq=saturation=1.08',
  'cyberpunk': 'colorbalance=bs=0.25:rs=0.1:bm=0.15,eq=saturation=1.35:contrast=1.15',
  'film': 'curves=preset=medium_contrast,eq=saturation=0.92:brightness=0.01,noise=alls=4:allf=t',
  'honey': 'colorbalance=rs=0.1:gs=0.06:bs=-0.08,curves=preset=lighter,eq=saturation=1.1',
  'arctic': 'colorbalance=bs=0.18:gs=0.06:rs=-0.12,eq=saturation=0.9:brightness=0.02:contrast=1.06'
}

/**
 * Map an array of clip effects to FFmpeg video filter strings (Roadmap R4, core C6).
 * Safe against dirty or unnormalized inputs (runs normalizeEffects first).
 * Order of effects is preserved.
 *
 * @param {Array<object>} effects
 * @returns {string[]} array of FFmpeg filter strings
 */
export function buildFfmpegEffectFilters(effects) {
  const clean = normalizeEffects(effects)
  if (clean.length === 0) return []

  const filters = []
  for (const { type, params } of clean) {
    switch (type) {
      case 'blur': {
        const amount = Number(params.amount) || 0
        if (amount > 0) {
          const sigma = Number(((amount / 100) * 20).toFixed(2))
          filters.push(`gblur=sigma=${sigma}`)
        }
        break
      }
      case 'sharpen': {
        const amount = Number(params.amount) || 0
        if (amount > 0) {
          const la = Number(((amount / 100) * 2.5).toFixed(2))
          filters.push(`unsharp=5:5:${la}:5:5:0.0`)
        }
        break
      }
      case 'vignette': {
        const intensity = Number(params.intensity) || 0
        if (intensity > 0) {
          const angle = Number(((Math.PI / 4) * (intensity / 100 * 1.5)).toFixed(4))
          filters.push(`vignette=angle=${angle}`)
        }
        break
      }
      case 'grain': {
        const amount = Number(params.amount) || 0
        if (amount > 0) {
          const flag = params.size === 'coarse' ? 't' : params.size === 'medium' ? 'u' : 't+u'
          filters.push(`noise=alls=${Math.round(amount * 0.6)}:allf=${flag}`)
        }
        break
      }
      case 'chromakey': {
        const hex = (params.color || '#00ff00').replace('#', '')
        const sim = (Number(params.similarity || 30) / 100).toFixed(2)
        const bl = (Number(params.blend || 10) / 100).toFixed(2)
        filters.push(`colorkey=0x${hex}:${sim}:${bl}`)
        break
      }
      case 'lut3d': {
        // R128 A3: one linear chain per preset. 'neutral' maps to nothing
        // (a true no-op) — the only registry entry the honesty rule exempts.
        const chain = LUT3D_CHAINS[params.lut]
        if (chain) filters.push(chain)
        break
      }
      case 'stabilize': {
        const strength = Number(params.strength) || 50
        const rx = Math.max(8, Math.round((strength / 100) * 32))
        filters.push(`deshake=rx=${rx}:ry=${rx}:edge=mirror`)
        break
      }
      case 'eq-grade': {
        const b = Number(params.brightness || 0)
        const c = Number(params.contrast || 100)
        const s = Number(params.saturation || 100)
        const bVal = Number((b / 100 * 0.5).toFixed(3))
        const cVal = Number((c / 100).toFixed(3))
        const sVal = Number((s / 100).toFixed(3))
        // R128 honesty rule: eq-grade is renderReady, so the base eq is
        // ALWAYS emitted — at registry defaults it is a bit-exact identity
        // grade, and a stored project with real values keeps the exact same
        // string it produced before this round (b=0/c=100/s=100 previously
        // produced no filter at all, which made the honesty flag a lie).
        filters.push(`eq=brightness=${bVal}:contrast=${cVal}:saturation=${sVal}`)
        // R117: color temperature — negative = cooler (blue), positive =
        // warmer (amber). Mapped to FFmpeg colorbalance red/blue; the
        // value is clamped to [-1, 1] so a stray param never breaks the
        // graph (real-FFmpeg verified, same range as the lut3d presets).
        const t = Number(params.temp || 0)
        if (t !== 0) {
          const r = Number(Math.max(-1, Math.min(1, t / 100)).toFixed(3))
          filters.push(`colorbalance=rs=${r}:bs=${-r}`)
        }
        // R128 A4 adjust params. Each stays silent at its default value, so
        // an untouched grade keeps a byte-identical export.
        const hue = Number(params.hue || 0)
        if (hue !== 0) {
          const hVal = Number(Math.max(-180, Math.min(180, hue)).toFixed(3))
          filters.push(`hue=h=${hVal}`)
        }
        const gamma = Number(params.gamma ?? 100)
        if (gamma !== 100) {
          const gVal = Number(Math.max(0.1, Math.min(3, gamma / 100)).toFixed(3))
          filters.push(`eq=gamma=${gVal}`)
        }
        const fade = Number(params.fade || 0)
        if (fade !== 0) {
          // Fade lifts the black floor (colorlevels minimum, 0..1 per plane).
          const fVal = Number((Math.max(0, Math.min(100, fade)) / 100 * 0.25).toFixed(3))
          filters.push(`colorlevels=rimin=${fVal}:gimin=${fVal}:bimin=${fVal}`)
        }
        const vibrance = Number(params.vibrance || 0)
        if (vibrance !== 0) {
          const vVal = Number((Math.max(-100, Math.min(100, vibrance)) / 100).toFixed(3))
          filters.push(`vibrance=intensity=${vVal}`)
        }
        break
      }
      // --- R128 A2: second-wave effects, all single-input linear chains ---
      case 'pixelate': {
        const size = Math.max(1, Math.min(64, Math.round(Number(params.size) || 12)))
        const mode = ['avg', 'min', 'max'].includes(params.mode) ? params.mode : 'avg'
        filters.push(`pixelize=w=${size}:h=${size}:mode=${mode}`)
        break
      }
      case 'emboss': {
        const amount = Math.max(0, Math.min(100, Number(params.amount ?? 100)))
        const rdiv = Math.max(0.01, Number((amount / 100).toFixed(3)))
        filters.push(`convolution=0m='-2 -1 0 -1 1 1 0 1 2':0rdiv=${rdiv}:0bias=0`)
        break
      }
      case 'edge-detect': {
        const mode = ['wires', 'colormix', 'canny'].includes(params.mode) ? params.mode : 'wires'
        if (mode === 'canny') {
          const low = Number(Math.max(0, Math.min(1, Number(params.low ?? 0.1))).toFixed(3))
          const high = Number(Math.max(0, Math.min(1, Number(params.high ?? 0.4))).toFixed(3))
          filters.push(`edgedetect=mode=canny:low=${low}:high=${high}`)
        } else {
          filters.push(`edgedetect=mode=${mode}`)
        }
        break
      }
      case 'letterbox': {
        const size = Math.max(1, Math.min(40, Number(params.size) || 12))
        const bar = Number((size / 100).toFixed(2))
        const offset = Number((1 - bar).toFixed(2))
        const top = `drawbox=x=0:y=0:w=iw:h=ih*${bar}:color=black:t=fill`
        const bottom = `drawbox=x=0:y=ih*${offset}:w=iw:h=ih*${bar}:color=black:t=fill`
        filters.push(`${top},${bottom}`)
        break
      }
      case 'negate': {
        filters.push(params.alpha === true ? 'negate=negate_alpha=1' : 'negate')
        break
      }
      case 'vivid': {
        const amount = Math.max(0, Math.min(100, Number(params.amount ?? 50)))
        const sat = Number((1 + amount / 100 * 0.6).toFixed(3))
        const contrast = Number((1 + amount / 100 * 0.15).toFixed(3))
        filters.push(`eq=saturation=${sat}:contrast=${contrast}`)
        break
      }
      case 'bleach-bypass': {
        const amount = Math.max(0, Math.min(100, Number(params.amount ?? 100)))
        const contrast = Number((1 + amount / 100 * 0.3).toFixed(3))
        const sat = Number((1 - amount / 100 * 0.65).toFixed(3))
        filters.push(`eq=contrast=${contrast}:saturation=${sat}`)
        break
      }
      case 'teal-orange': {
        const amount = Math.max(0, Math.min(100, Number(params.amount ?? 60)))
        const k = amount / 100
        const scaled = value => Number((value * k).toFixed(3))
        const lift = Number((1 + k * 0.05).toFixed(3))
        const balance = `colorbalance=bs=${scaled(0.15)}:gs=${scaled(0.05)}:rh=${scaled(0.12)}:rm=${scaled(0.08)}`
        filters.push(`${balance},eq=saturation=${lift}:contrast=${lift}`)
        break
      }
      case 'vibrance': {
        const intensity = Math.max(-100, Math.min(100, Number(params.intensity ?? 50)))
        filters.push(`vibrance=intensity=${Number((intensity / 100).toFixed(3))}`)
        break
      }
      case 'mirror-h':
      case 'mirror-v': {
        const axis = ['horizontal', 'vertical', 'both'].includes(params.axis) ? params.axis : 'horizontal'
        if (axis === 'vertical') filters.push('vflip')
        else if (axis === 'both') filters.push('hflip,vflip')
        else filters.push('hflip')
        break
      }
      case 'rotate-90': {
        // transpose=1 is one clockwise quarter turn; transpose=2 is one
        // counter-clockwise turn (used to keep the 3-turn case on one filter).
        const turns = Math.max(1, Math.min(3, Math.round(Number(params.turns) || 1)))
        filters.push(turns === 3 ? 'transpose=2' : Array(turns).fill('transpose=1').join(','))
        break
      }
      case 'chromatic': {
        const shift = Math.max(1, Math.min(64, Math.round(Number(params.shift) || 6)))
        filters.push(`rgbashift=rh=${shift}:bh=${-shift}`)
        break
      }
      case 'fisheye': {
        const strength = Math.max(0, Math.min(100, Number(params.strength ?? 30)))
        const k1 = Number((-(strength / 100)).toFixed(3))
        filters.push(`lenscorrection=k1=${k1}:k2=0:i=bilinear`)
        break
      }
      case 'motion-blur': {
        const frames = Math.max(2, Math.min(30, Math.round(Number(params.frames) || 8)))
        filters.push(`tmix=frames=${frames}`)
        break
      }
      case 'afterimage': {
        const decay = Math.max(0, Math.min(100, Number(params.decay ?? 80)))
        filters.push(`lagfun=decay=${Number((decay / 100).toFixed(2))}`)
        break
      }
      case 'denoise': {
        const strength = Math.max(0, Math.min(100, Number(params.strength ?? 50)))
        const spatial = Number((strength / 10).toFixed(2))
        const chromaSpatial = Number((spatial * 0.6).toFixed(2))
        const temporal = Number((strength / 8).toFixed(2))
        const chromaTemporal = Number((temporal * 0.75).toFixed(2))
        const luma = `hqdn3d=luma_spatial=${spatial}:chroma_spatial=${chromaSpatial}`
        filters.push(`${luma}:luma_tmp=${temporal}:chroma_tmp=${chromaTemporal}`)
        break
      }
      case 'deband': {
        const threshold = Math.max(1, Math.min(100, Number(params.threshold) || 20))
        const thr = Number((threshold / 1000).toFixed(4))
        const range = Math.max(4, Math.min(64, Math.round(Number(params.range) || 16)))
        const thresholds = `1thr=${thr}:2thr=${thr}:3thr=${thr}:4thr=${thr}`
        filters.push(`deband=${thresholds}:range=${range}:blur=true`)
        break
      }
      case 'sepia': {
        const t = Math.max(0, Math.min(100, Number(params.intensity ?? 100))) / 100
        const mix = value => Number(value.toFixed(3))
        const matrix = [
          `rr=${mix(1 - 0.607 * t)}`,
          `rg=${mix(0.769 * t)}`,
          `rb=${mix(0.189 * t)}`,
          `gr=${mix(0.349 * t)}`,
          `gg=${mix(1 - 0.314 * t)}`,
          `gb=${mix(0.168 * t)}`,
          `br=${mix(0.272 * t)}`,
          `bg=${mix(0.534 * t)}`,
          `bb=${mix(1 - 0.869 * t)}`
        ]
        filters.push(`colorchannelmixer=${matrix.join(':')}`)
        break
      }
      case 'mono': {
        const intensity = Math.max(0, Math.min(100, Number(params.intensity ?? 100)))
        const sat = Number(Math.max(0, 1 - intensity / 100).toFixed(3))
        filters.push(`hue=s=${sat}`)
        break
      }
      case 'vhs': {
        const amount = Math.max(0, Math.min(100, Number(params.amount ?? 50)))
        const noise = Math.round(amount * 0.2)
        const shift = Math.round(amount * 0.06)
        filters.push(`noise=alls=${noise}:allf=t,chromashift=cbh=${shift}:crh=${-shift}`)
        break
      }
    }
  }
  return filters
}

/**
 * The export chain one `lut3d` preset maps to, straight from the table above.
 * Exposed so the UI derives its grade preview from the same data the renderer
 * uses instead of keeping a second, drift-prone colour table (Roadmap v1 §5.1).
 * Returns null when the preset has no chain — an unknown id OR 'neutral', the
 * documented no-op; both render as identity.
 *
 * @param {string} preset
 * @returns {string | null}
 */
export function lut3dChain(preset) {
  return Object.prototype.hasOwnProperty.call(LUT3D_CHAINS, preset) ? LUT3D_CHAINS[preset] : null
}

/**
 * Preview/export capability matrix for one registry effect (Roadmap v1 §5.6).
 *
 * The UI reads fidelity from HERE instead of from a presentation table, so a
 * thumbnail can never claim more than the definition actually delivers.
 * Returns null for an unknown type — callers must show an honest unknown
 * state rather than a generic animation.
 *
 * @param {string} type
 * @returns {{ fidelity: 'exact'|'approximate'|'illustrative', strategy: string, exportSupported: boolean, label: string, category: string } | null}
 */
export function fxCapabilities(type) {
  const desc = EFFECT_REGISTRY[type]
  if (!desc) return null
  return {
    fidelity: desc.preview?.fidelity ?? 'approximate',
    strategy: desc.preview?.strategy ?? 'css',
    exportSupported: desc.renderReady === true,
    label: desc.label,
    category: desc.category
  }
}

/**
 * Clamp/repair a single raw param value against the registry descriptor.
 * Same coercion `normalizeEffects` uses, exposed so inspector controls and
 * thumbnails enforce the documented bounds instead of inventing their own.
 * Returns undefined when the type or param name is not registered.
 *
 * @param {string} type
 * @param {string} name
 * @param {unknown} raw
 * @returns {unknown}
 */
export function clampEffectParam(type, name, raw) {
  const desc = EFFECT_REGISTRY[type]
  if (!desc) return undefined
  const param = desc.params.find(candidate => candidate.name === name)
  if (!param) return undefined
  return coerceValue(param, raw)
}
