// @tmcut-core — clip masks (R124 A3, CapCut §5.7).
//
// A mask restricts the VISIBLE area of a video clip to a shape with a
// feathered edge, an optional rotation and an optional inversion. Stored
// on the clip as:
//
//   mask: {
//     shape: 'rectangle' | 'circle' | 'linear',
//     x, y, w, h,          // normalized 0..1 box of the clip frame
//     feather: 0..100,     // soft-edge width across the border band
//     rotation: -180..180, // degrees around the box center
//     invert: boolean,     // show OUTSIDE the shape instead
//     axis: 'x' | 'y'      // 'linear' only: gradient direction along it
//   }
//
// Two pure builders share the SAME geometry so preview and export can
// never disagree on where the shape is:
//  - maskAlphaExpr(): a per-pixel alpha expression (0..255) for FFmpeg
//    `geq` on the export path. The sample point is rotated back by
//    -rotation around the box center, a signed distance (negative inside)
//    is taken, and a clamped linear ramp across the feather band decides
//    coverage.
//  - maskCssMaskImage(): an SVG data-URI used as a CSS `mask-image`
//    (alpha mask — opaque = visible) in the browser preview.

/** Shapes understood by normalizeMask/maskAlphaExpr/maskCssMaskImage. */
export const TMUTCUT_MASK_SHAPES = ['rectangle', 'circle', 'linear']

const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/**
 * Sanitize a stored (or UI-supplied) mask into a full geometry object
 * with every field present and in range. Returns null when `mask` is
 * absent or carries an unknown shape — callers treat null as "no mask".
 */
export function normalizeMask(mask) {
  if (!mask || !TMUTCUT_MASK_SHAPES.includes(mask.shape)) return null
  return {
    shape: mask.shape,
    x: clamp(num(mask.x, 0), 0, 1),
    y: clamp(num(mask.y, 0), 0, 1),
    w: clamp(num(mask.w, 1), 0.001, 1),
    h: clamp(num(mask.h, 1), 0.001, 1),
    feather: clamp(num(mask.feather, 0), 0, 100),
    rotation: clamp(num(mask.rotation, 0), -180, 180),
    invert: !!mask.invert,
    axis: mask.axis === 'y' ? 'y' : 'x'
  }
}

const fmt = (n) => String(Number(n.toFixed(6)))

/** Normalized center and half-extents of the mask box. */
function geometry(m) {
  return {
    cx: m.x + m.w / 2,
    cy: m.y + m.h / 2,
    hw: Math.max(0.0005, m.w / 2),
    hh: Math.max(0.0005, m.h / 2)
  }
}

/**
 * FFmpeg `geq` alpha expression (0..255), embedded as:
 *   format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='<this>'
 * Contains commas (min/max/hypot) — the caller MUST wrap it in single
 * quotes (same convention as keyframeExpr). '' when there is no mask.
 */
export function maskAlphaExpr(mask) {
  const m = normalizeMask(mask)
  if (!m) return ''
  const { cx, cy, hw, hh } = geometry(m)
  const rad = (m.rotation * Math.PI) / 180
  const cos = fmt(Math.cos(rad))
  const sin = fmt(Math.sin(rad))
  // Sample point rotated back by -rotation around the box center
  // (normalized frame units; X/W and Y/H are geq frame coordinates).
  const dx = `(${cos}*((X/W)-${fmt(cx)})-${sin}*((Y/H)-${fmt(cy)}))`
  const dy = `(${sin}*((X/W)-${fmt(cx)})+${cos}*((Y/H)-${fmt(cy)}))`

  let u // coverage: 0 = inside (opaque side), 1 = outside (cleared)
  if (m.shape === 'linear') {
    // Linear wipe: a ramp along the axis. Position normalized by the
    // half-extent is -1 at the start edge, +1 at the end; the feather
    // fraction (0.02..1) compresses the ramp toward the center, leaving
    // opaque/clear plateaus at both ends when < 100.
    const half = m.axis === 'y' ? hh : hw
    const along = m.axis === 'y' ? dy : dx
    const f = Math.max(0.02, m.feather / 100)
    u = `((min(1\,max(-1\,((${along})/${fmt(half)})/${fmt(f)})))+1)/2`
  } else {
    // Signed distance in normalized units: negative inside, ~0 border.
    const sd = m.shape === 'rectangle'
      ? `(max(abs(${dx})/${fmt(hw)}\,abs(${dy})/${fmt(hh)})-1)`
      : `(hypot(abs(${dx})/${fmt(hw)}\,abs(${dy})/${fmt(hh)})-1)`
    // Ramp half-width in sd units — feather 0 stays a hard edge.
    const f = Math.max(0.02, m.feather / 100)
    u = `min(1\,max(0\,((${sd})+${fmt(f)})/${fmt(2 * f)}))`
  }
  // alpha: opaque inside unless inverted, then opaque outside.
  return m.invert ? `255*(${u})` : `255*(1-(${u}))`
}

/**
 * CSS-compatible SVG mask-image (alpha channel) for the browser preview.
 * `wPx`/`hPx` are the frame's pixel aspect (canvas/render size) — the SVG
 * is authored in that aspect so rotation stays undistorted; CSS then
 * stretches the image exactly onto the element (mask-size: 100% 100%).
 * Returns null when there is no mask.
 */
export function maskCssMaskImage(mask, wPx = 100, hPx = 100) {
  const m = normalizeMask(mask)
  if (!m) return null
  const W = Math.max(1, Math.round(wPx))
  const H = Math.max(1, Math.round(hPx))
  const { cx, cy, hw, hh } = geometry(m)
  const px = cx * W
  const py = cy * H
  const rx = hw * W
  const ry = hh * H
  const rot = m.rotation ? ` transform="rotate(${fmt(m.rotation)} ${fmt(px)} ${fmt(py)})"` : ''
  // Feather → Gaussian blur on the shape, scaled to the smaller radius so
  // 100% on any shape reads soft on both axes (preview approximation).
  const blurStd = (m.feather / 100) * Math.max(rx, ry, 1)
  const filter = m.feather > 0
    ? `<filter id="f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${fmt(blurStd)}"/></filter>`
    : ''
  const filterAttr = m.feather > 0 ? ' filter="url(#f)"' : ''

  let shapeMarkup
  if (m.shape === 'linear') {
    // Gradient along the axis across the box; feather compresses stops.
    const f = Math.max(0.02, m.feather / 100)
    // Opaque stop before the ramp, clear after it.
    const mid = m.axis === 'y' ? py : px
    const half = m.axis === 'y' ? ry : rx
    const s0 = mid - half * f
    const s1 = mid + half * f
    const coords = m.axis === 'y'
      ? `x1="0" y1="${fmt(s0)}" x2="0" y2="${fmt(s1)}"`
      : `x1="${fmt(s0)}" y1="0" x2="${fmt(s1)}" y2="0"`
    const stops = m.invert
      ? '<stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="1"/>'
      : '<stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>'
    shapeMarkup = `<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" ${coords}>${stops}</linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/>`
  } else {
    const shapeEl = m.shape === 'rectangle'
      ? `<rect x="${fmt(px - rx)}" y="${fmt(py - ry)}" width="${fmt(rx * 2)}" height="${fmt(ry * 2)}" fill="#fff"${rot}/>`
      : `<ellipse cx="${fmt(px)}" cy="${fmt(py)}" rx="${fmt(rx)}" ry="${fmt(ry)}" fill="#fff"${rot}/>`
    shapeMarkup = m.invert
      ? `<mask id="m"><rect width="${W}" height="${H}" fill="#fff"/>${shapeEl.replace('fill="#fff"', 'fill="#000"')}</mask><rect width="${W}" height="${H}" fill="#fff" mask="url(#m)"/>`
      : shapeEl
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${filter ? `<defs>${filter}</defs>` : ''}<g${filterAttr}>${shapeMarkup}</g></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}
