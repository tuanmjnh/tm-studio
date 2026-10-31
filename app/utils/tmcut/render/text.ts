import type { TextOverlayClip } from './types'
import type { RenderGraph } from './graph'
import { filterPathArg, opacityAlpha } from './graph'
import { textBoxPadding, textStrokeWidth, textShadowOffset } from '../textStyle'
import { keyframeExpr, maskAlphaExpr } from '@tmcut-core'
import type { RenderClip } from './clip'

/**
 * Escapes text for FFmpeg drawtext filter
 */
export function escapeDrawText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '\'\\\'\'')
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
}

/**
 * Generates drawtext filter for ONE text clip (roadmap C-1, C-2, C-5, R2).
 */
export function textOverlayFilter(clip: TextOverlayClip): string {
  const escaped = escapeDrawText(clip.text || '')
  const fontSize = clip.fontSize || 36
  const fontColor = clip.color || 'white'
  const xOffset = clip.x || 0
  const yOffset = clip.y || 0
  const tStart = clip.offset || 0
  const duration = (clip.out - clip.in) / (clip.speed || 1)
  const tEnd = tStart + duration

  const fontFileArg = clip.fontFile ? `fontfile='${filterPathArg(clip.fontFile)}':` : ''

  // Text animations in/out (Roadmap C-5)
  const animIn = clip.animIn && clip.animIn !== 'none' ? clip.animIn : null
  const dIn = animIn ? Math.max(0.05, Math.min(duration / 2, clip.animInDuration ?? 0.5)) : 0
  const tInEnd = Number((tStart + dIn).toFixed(4))

  const animOut = clip.animOut && clip.animOut !== 'none' ? clip.animOut : null
  const dOut = animOut ? Math.max(0.05, Math.min(duration / 2, clip.animOutDuration ?? 0.5)) : 0
  const tOutStart = Number((tEnd - dOut).toFixed(4))

  let animAlphaExpr = ''
  if (dIn > 0 && dOut > 0) {
    animAlphaExpr = `if(lt(t,${tInEnd}),(t-${tStart})/${dIn},if(gt(t,${tOutStart}),(${tEnd}-t)/${dOut},1))`
  } else if (dIn > 0) {
    animAlphaExpr = `if(lt(t,${tInEnd}),(t-${tStart})/${dIn},1)`
  } else if (dOut > 0) {
    animAlphaExpr = `if(gt(t,${tOutStart}),(${tEnd}-t)/${dOut},1)`
  }

  const inXDir = animIn === 'slide-left' ? 100 : animIn === 'slide-right' ? -100 : 0
  const outXDir = animOut === 'slide-left' ? -100 : animOut === 'slide-right' ? 100 : 0
  let animXExpr = ''
  if (inXDir !== 0 && outXDir !== 0) {
    animXExpr = `if(lt(t,${tInEnd}),(1-(t-${tStart})/${dIn})*(${inXDir}),if(gt(t,${tOutStart}),(1-(${tEnd}-t)/${dOut})*(${outXDir}),0))`
  } else if (inXDir !== 0) {
    animXExpr = `if(lt(t,${tInEnd}),(1-(t-${tStart})/${dIn})*(${inXDir}),0)`
  } else if (outXDir !== 0) {
    animXExpr = `if(gt(t,${tOutStart}),(1-(${tEnd}-t)/${dOut})*(${outXDir}),0)`
  }

  const inYDir = animIn === 'slide-up' ? 60 : animIn === 'slide-down' ? -60 : 0
  const outYDir = animOut === 'slide-up' ? -60 : animOut === 'slide-down' ? 60 : 0
  let animYExpr = ''
  if (inYDir !== 0 && outYDir !== 0) {
    animYExpr = `if(lt(t,${tInEnd}),(1-(t-${tStart})/${dIn})*(${inYDir}),if(gt(t,${tOutStart}),-(1-(${tEnd}-t)/${dOut})*(${outYDir}),0))`
  } else if (inYDir !== 0) {
    animYExpr = `if(lt(t,${tInEnd}),(1-(t-${tStart})/${dIn})*(${inYDir}),0)`
  } else if (outYDir !== 0) {
    animYExpr = `if(gt(t,${tOutStart}),-(1-(${tEnd}-t)/${dOut})*(${outYDir}),0)`
  }

  // Keyframes (roadmap R2, core C3): evaluate x, y, and opacity in clip-local time.
  const localT = tStart > 0 ? `(t-${tStart})` : 't'
  const kfX = keyframeExpr(clip, 'x', localT)
  const kfY = keyframeExpr(clip, 'y', localT)
  const kfOpacity = keyframeExpr(clip, 'opacity', localT)

  const rawX = kfX ? `(${kfX})` : `${xOffset}`
  const xVal = animXExpr ? `(${rawX}+${animXExpr})` : (kfX ? `(${kfX})` : `(${xOffset})`)

  const rawY = kfY ? `(${kfY})` : `${yOffset}`
  const yVal = animYExpr ? `(${rawY}+${animYExpr})` : (kfY ? `(${kfY})` : `${yOffset}`)

  const xExpr = clip.align === 'left'
    ? `0+${xVal}`
    : clip.align === 'right'
      ? `w-text_w-${xVal}`
      : `(w-text_w)/2+${xVal}`
  const yExpr = `(h-text_h)/2+${yVal}`

  const opacityPct = clip.opacity ?? 100
  let alphaSuffix = ''
  let alphaArg = ''
  // NOTE (R124 A3): the per-pixel clip mask is NOT applied here — drawtext's
  // `:alpha` is a frame-level expression (it cannot reference X/W, Y/H pixel
  // coordinates). textOverlayChains routes masked text through a transparent
  // layer + a separate geq so the mask geometry works exactly like video.
  if (kfOpacity && animAlphaExpr) {
    alphaArg = `:alpha='((${kfOpacity})/100)*(${animAlphaExpr})'`
  } else if (kfOpacity) {
    alphaArg = `:alpha='(${kfOpacity})/100'`
  } else if (animAlphaExpr) {
    const baseA = Number((opacityPct / 100).toFixed(4))
    alphaArg = `:alpha='${baseA}*(${animAlphaExpr})'`
  } else if (opacityPct < 100) {
    alphaSuffix = `@${opacityAlpha(opacityPct)}`
  }
  const fontColorArg = `${fontColor}${alphaSuffix}`
  // Text effects (roadmap đợt 2): colours and the background plate are
  // optional fields, so an old project keeps the legacy black shadow/outline
  // and no box — byte-identical filter strings (see the export spec).
  const styleArgs = [
    clip.shadow ? `shadowx=${textShadowOffset(fontSize)}:shadowy=${textShadowOffset(fontSize)}:shadowcolor=${clip.shadowColor || 'black'}${alphaSuffix}` : '',
    clip.stroke ? `borderw=${textStrokeWidth(fontSize)}:bordercolor=${clip.strokeColor || 'black'}${alphaSuffix}` : '',
    // drawtext paints the box behind the glyphs; boxborderw is the padding,
    // the same number textBoxPadding() gives the preview plate.
    clip.bgColor ? `box=1:boxcolor=${clip.bgColor}${alphaSuffix}:boxborderw=${textBoxPadding(fontSize)}` : ''
  ].filter(Boolean).join(':')

  const xArg = animXExpr ? `x='${xExpr}'` : `x=${xExpr}`
  const yArg = animYExpr ? `y='${yExpr}'` : `y=${yExpr}`

  return `drawtext=${fontFileArg}text='${escaped}':fontsize=${fontSize}:fontcolor=${fontColorArg}:${xArg}:${yArg}:enable='between(t,${tStart},${tEnd})'${alphaArg}${styleArgs ? `:${styleArgs}` : ''}`
}

/**
 * One text clip's filter chains on top of `bus` (roadmap R12).
 */
export function textOverlayChains(
  bus: string,
  clip: TextOverlayClip,
  index: number,
  ctx: { canvasW: number, canvasH: number, fps: number }
): { chains: string[], out: string } {
  const out = `[v_txt_${index}]`
  const rotation = clip.rotation || 0
  // R124 A3: masked text routes through a transparent plate + a geq alpha
  // pass. drawtext's :alpha is frame-level (no X/W, Y/H pixel access), so
  // the per-pixel mask geometry from core has to run as its own filter.
  // The mask box is canvas-relative (the plate IS the canvas), matching
  // video clips where the fitted frame fills the canvas.
  const maskExpr = maskAlphaExpr(clip.mask)
  const tStart = clip.offset || 0
  const tEnd = tStart + (clip.out - clip.in) / (clip.speed || 1)
  if (!rotation) {
    if (!maskExpr) return { chains: [`${bus}${textOverlayFilter(clip)}${out}`], out }
    const layer = `[v_txtl_${index}]`
    const masked = `[v_txtm_${index}]`
    return {
      chains: [
        `color=c=black@0.0:s=${ctx.canvasW}x${ctx.canvasH}:r=${ctx.fps}:d=${(tEnd + 1).toFixed(3)},format=rgba,${textOverlayFilter(clip)}${layer}`,
        `${layer}geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='(${maskExpr})'${masked}`,
        `${bus}${masked}overlay=shortest=1${out}`
      ],
      out
    }
  }

  if ((clip.align || 'center') !== 'center') {
    throw new Error('Rotated text export needs center alignment — set the clip align to center, or clear its rotation')
  }
  const xOffset = clip.x || 0
  const yOffset = clip.y || 0
  const rad = rotation * Math.PI / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const rx = xOffset * cos - yOffset * sin
  const ry = xOffset * sin + yOffset * cos
  const ovX = Number((xOffset - rx).toFixed(3))
  const ovY = Number((yOffset - ry).toFixed(3))
  const layer = `[v_txtl_${index}]`
  const rotated = `[v_txtr_${index}]`
  // Mask BEFORE rotate: the mask box lives in the plate's (pre-rotation)
  // canvas space, so it travels with the text exactly like the glyphs.
  const masked = maskExpr
    ? `${layer}geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='(${maskExpr})'[v_txtm_${index}];[v_txtm_${index}]rotate=a=${rad.toFixed(6)}:fillcolor=none${rotated}`
    : `${layer}rotate=a=${rad.toFixed(6)}:fillcolor=none${rotated}`
  return {
    chains: [
      `color=c=black@0.0:s=${ctx.canvasW}x${ctx.canvasH}:r=${ctx.fps}:d=${(tEnd + 1).toFixed(3)},format=rgba,${textOverlayFilter(clip)}${layer}`,
      masked,
      `${bus}${rotated}overlay=x=${ovX}:y=${ovY}${out}`
    ],
    out
  }
}

/**
 * Applies all text overlay clips in sequence on top of the video bus.
 * C16-R2: takes RenderClip views. C16-R3: the drawtext builder still
 * contracts on SECONDS (enable/between windows), so the ticks store is
 * decoded through the canonical view here — raw is spread only for the
 * unit-agnostic style/keyframe fields (keyframes[] carry their own ticks,
 * converted inside keyframeExpr).
 */
export function applyTextOverlays(
  graph: RenderGraph,
  busStream: string,
  textClips: RenderClip[],
  ctx: { canvasW: number, canvasH: number, fps: number }
): string {
  let current = busStream
  for (let i = 0; i < textClips.length; i++) {
    const textClip = textClips[i]!
    const overlay: TextOverlayClip = {
      ...textClip.raw,
      offset: textClip.offsetSec,
      in: textClip.inSec,
      out: textClip.outSec
    }
    const overlaid = textOverlayChains(current, overlay, i, ctx)
    for (const chain of overlaid.chains) {
      graph.addFilterChain(chain)
    }
    current = overlaid.out
  }
  return current
}
