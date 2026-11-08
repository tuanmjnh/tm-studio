// =============================================================================
//  tmcut-core — effects registry (Roadmap C6)
//  First-wave effect descriptors + validation + normalization for clip
//  `effects: [{ type, params }]` (docs DSL v3, TmcutClipEffect).
//
//  `renderReady` is the definition-completeness flag: TRUE means the registry
//  ships a full semantic face for the effect (params + preview descriptor +
//  grade ops where applicable) that a renderer can consume. It is NOT a promise
//  the current file export bakes the effect — file-export eligibility is decided
//  separately by `planEncodeContent` (exportContent.mjs), which today refuses a
//  clip that carries effects until the WebCodecs painter learns to bake them.
//  Preview (CSS/filter) may still render it. `fxCapabilities.exportSupported`
//  mirrors this flag, so a tile badge reflects definition completeness, not the
//  export refusal — see the slice J audit note on that honesty gap.
//
//  `preview.layerOverlay` is the other honesty flag: TRUE only when this
//  effect's CSS overlay is what the export bakes into the layer, so a live
//  preview may paint it as its own plate. An overlay that only HINTS at the
//  result (a keying band, a pixel grid) stays a tile device and never reaches
//  the monitor.
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
    preview: { strategy: 'css', fidelity: 'approximate', layerOverlay: true },
    params: [
      { name: 'intensity', kind: 'number', min: 0, max: 100, default: 50 }
    ]
  },
  'grain': {
    type: 'grain',
    label: 'Grain',
    category: 'texture',
    renderReady: true,
    preview: { strategy: 'css', fidelity: 'approximate', layerOverlay: true },
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
      // Preset grades (R128 A3, slice J): 19 semantic grade op-lists (see
      // lutGrade), each an ordered instruction list a renderer consumes. The
      // first five keep their R4 order so stored projects resolve to the same
      // look; only 'neutral' is a no-op (lutGrade returns null). File-based
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
      // warmer (amber). One number; `lutGrade` carries it as a `balance` op.
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
    preview: { strategy: 'css', fidelity: 'exact', layerOverlay: true },
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
    // NOT `exact`: `alpha` inverts the alpha channel and CSS invert() has no
    // alpha face, so one reachable param makes the tile a different picture.
    // Policed by tests/unit/tmcut_fx_exact.spec.ts.
    preview: { strategy: 'css', fidelity: 'approximate' },
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

// Slice J — the same grades as semantic instruction lists, not FFmpeg text.
// Each op is a typed object a GPU/canvas/Web Audio renderer consumes directly;
// the UI maps the same ops to CSS. Order mirrors the old chain so the preview
// paints identically. 'neutral' is absent (the documented no-op → null).
//   balance   { rs,gs,bs, rm,gm,bm, rh,gh,bh }  shadow/mid/highlight offsets
//   eq        { brightness, contrast, saturation }  (only the fields set)
//   curves    { preset }  one of lighter|medium_contrast|strong_contrast|cross_process
//   desaturate  (hue=s=0)   sepia  (colorchannelmixer sepia matrix)
//   grain     { amount }  (noise alls)
const LUT_GRADES = {
  'warm': [{ op: 'balance', rs: 0.12, gs: 0.02, bs: -0.1 }],
  'cool': [{ op: 'balance', rs: -0.1, gs: 0.02, bs: 0.15 }],
  'cinematic': [{ op: 'curves', preset: 'cross_process' }, { op: 'eq', contrast: 1.1, saturation: 1.15 }],
  'vintage': [{ op: 'balance', rs: 0.15, gs: 0.08, bs: -0.12 }, { op: 'eq', contrast: 0.95, saturation: 0.85 }],
  'vivid': [{ op: 'eq', saturation: 1.45, contrast: 1.12, brightness: 0.02 }],
  'fade': [{ op: 'curves', preset: 'lighter' }, { op: 'eq', saturation: 0.78, contrast: 0.9, brightness: 0.03 }],
  'mono': [{ op: 'desaturate' }, { op: 'eq', contrast: 1.08 }],
  'sepia': [{ op: 'sepia' }],
  'noir': [{ op: 'desaturate' }, { op: 'curves', preset: 'strong_contrast' }, { op: 'eq', brightness: -0.02 }],
  'bleach': [{ op: 'curves', preset: 'strong_contrast' }, { op: 'eq', saturation: 0.35, contrast: 1.15 }],
  'teal-orange': [{ op: 'balance', bs: 0.18, gs: 0.05, rh: 0.14, rm: 0.1 }, { op: 'eq', saturation: 1.08 }],
  'sunset': [{ op: 'balance', rs: 0.2, gs: 0.05, bs: -0.15, rm: 0.1 }, { op: 'eq', saturation: 1.15, brightness: 0.02 }],
  'moonlight': [{ op: 'balance', rs: -0.12, bs: 0.2, bm: 0.08 }, { op: 'eq', brightness: -0.03, saturation: 0.85, contrast: 1.05 }],
  'forest': [{ op: 'balance', gs: 0.15, rs: -0.1, bs: 0.05 }, { op: 'eq', saturation: 1.1, contrast: 1.03 }],
  'rose': [{ op: 'balance', rs: 0.16, rm: 0.08, bs: -0.05 }, { op: 'eq', saturation: 1.08 }],
  'cyberpunk': [{ op: 'balance', bs: 0.25, rs: 0.1, bm: 0.15 }, { op: 'eq', saturation: 1.35, contrast: 1.15 }],
  'film': [{ op: 'curves', preset: 'medium_contrast' }, { op: 'eq', saturation: 0.92, brightness: 0.01 }, { op: 'grain', amount: 4 }],
  'honey': [{ op: 'balance', rs: 0.1, gs: 0.06, bs: -0.08 }, { op: 'curves', preset: 'lighter' }, { op: 'eq', saturation: 1.1 }],
  'arctic': [{ op: 'balance', bs: 0.18, gs: 0.06, rs: -0.12 }, { op: 'eq', saturation: 0.9, brightness: 0.02, contrast: 1.06 }]
}

/**
 * The semantic grade one `lut3d` preset maps to: an ordered list of typed ops
 * (balance/eq/curves/desaturate/sepia/grain), never FFmpeg filter text. Returns
 * null for an unknown id OR 'neutral' — both render as identity. A renderer
 * (GPU/canvas/Web Audio) consumes the ops directly; the UI derives CSS from the
 * same list so preset looks cannot drift.
 *
 * @param {string} preset
 * @returns {Array<object> | null}
 */
export function lutGrade(preset) {
  return Object.prototype.hasOwnProperty.call(LUT_GRADES, preset) ? LUT_GRADES[preset].map(op => ({ ...op })) : null
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
 * @returns {{ fidelity: 'exact'|'approximate'|'illustrative', strategy: string, layerOverlay: boolean, exportSupported: boolean, label: string, category: string } | null}
 */
export function fxCapabilities(type) {
  const desc = EFFECT_REGISTRY[type]
  if (!desc) return null
  return {
    fidelity: desc.preview?.fidelity ?? 'approximate',
    strategy: desc.preview?.strategy ?? 'css',
    layerOverlay: desc.preview?.layerOverlay === true,
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
