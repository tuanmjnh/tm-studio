/**
 * The dialog's choices, and which of them a browser export can honour.
 *
 * The modal offers a size, a frame rate, a format, a mode tab, an in/out range,
 * denoise and a LUT. A WebCodecs run can honour exactly two of those — size and
 * rate, because `planEncodeContent` reads the canvas and `createFrameScheduler`
 * builds its grid from the same numbers. Everything else is refused BY NAME
 * before a decoder opens, because the alternative is a control that is silently
 * ignored: the user picks 9:16 and gets 16:9, or asks for HEVC and receives
 * H.264 from the fallback ladder, and the app never says so.
 *
 * The codes are not core's `ENCODE_REFUSAL_REASONS`. Those name things a project
 * has (a mask, a blend, a transition) and core answers them alone. These name
 * things a DIALOG has, which only the app knows exist.
 */

import { fpsToRational } from 'tmcut-core'
import type { FrameRate } from 'tmcut-core'

/** A dialog choice the browser export cannot write, named so a UI can explain it. */
export type WebExportRefusalCode = 'mode' | 'format' | 'range' | 'effects'

export interface WebExportChoice {
  /** The output size the scale selector asked for. */
  width: number
  height: number
  fps: number
  mode: 'video' | 'audio' | 'gif'
  /** The modal's format id (`mp4-h264`, `webm-vp9`, …). */
  format: string
  /** Set when the user picked a section to render. */
  range: unknown | null
  denoise: boolean
  lut: string | null
}

export interface WebExportPlan<Project> {
  /** Which choices this export cannot honour, in the order they are checked. */
  refusals: WebExportRefusalCode[]
  /** The project to render: the caller's, with its canvas replaced. */
  project: Project
}

/**
 * The formats this writer can promise. `planEncodePresets` asks H.264 in MP4,
 * then VP9 and AV1 in WebM, and takes the first the runtime accepts — so a
 * request for HEVC or ProRes would be answered with an H.264 file, and a request
 * for VP9 could be answered with an MP4. Neither is the file the menu promised.
 */
const HONOURED_FORMATS = new Set(['mp4-h264'])

export function planWebExport<Project extends { canvas?: { width?: number, height?: number, fps?: unknown } }>(
  project: Project,
  choice: WebExportChoice
): WebExportPlan<Project> {
  const refusals: WebExportRefusalCode[] = []
  if (choice.mode !== 'video') refusals.push('mode')
  if (!HONOURED_FORMATS.has(choice.format)) refusals.push('format')
  if (choice.range) refusals.push('range')
  if (choice.denoise || Boolean(choice.lut)) refusals.push('effects')

  const fps: FrameRate = fpsToRational(choice.fps)
  return {
    refusals,
    // A copy, never a mutation: the store's project is the user's open document,
    // and an export that resized it would be a settings change nobody asked for.
    project: {
      ...project,
      canvas: { ...project.canvas, width: choice.width, height: choice.height, fps }
    }
  }
}
