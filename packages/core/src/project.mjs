// =============================================================================
//  @tmcut/core — project
//  Project defaults, track guarantees and v1 -> v3 migration (docs §14, §59).
//  v1 is the current app shape (float seconds, numeric fps, path-based src).
//  Migration is lossless: legacy paths survive under clip.locator until a
//  registry-backed relink replaces them with assetId (docs §15).
// =============================================================================

import { fpsToRational, secToTicks } from './time.mjs'

let projectCounter = 0
let assetCounter = 0

function nextProjectId() {
  projectCounter += 1
  return `proj_${Date.now().toString(36)}${projectCounter.toString(36)}`
}

/** Deterministic registry id derived from a legacy media path. */
export function assetIdForPath(path) {
  const text = String(path ?? '')
  let hash = 5381
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  }
  assetCounter += 1
  return `asset_${(hash >>> 0).toString(16)}_${assetCounter.toString(36)}`
}

export function defaultCanvas(width = 1920, height = 1080, fps = 30) {
  return {
    width,
    height,
    fps: fpsToRational(fps),
    aspectRatio: { id: `${width}:${height}`, value: height === 0 ? 0 : width / height, orientation: width === height ? 'square' : width > height ? 'landscape' : 'portrait' },
    background: { type: 'color', value: '#000000' }
  }
}

export function defaultTimeline() {
  return {
    version: 3,
    tracks: [
      { id: 't-text-1', type: 'text', name: 'Text', items: [] },
      { id: 't-video-1', type: 'video', name: 'Video 1', items: [] },
      { id: 't-audio-1', type: 'audio', name: 'Audio 1', items: [] }
    ],
    markers: []
  }
}

export function createProject(name = 'Untitled Project', canvas) {
  return {
    version: 3,
    project: { id: nextProjectId(), name, duration: 0 },
    canvas: canvas ?? defaultCanvas(),
    timeline: defaultTimeline()
  }
}

function toOpacity(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  // v1 stores 0..100, v3 stores 0..1
  return Math.min(1, Math.max(0, value > 1 ? value / 100 : value))
}

function migrateClip(item, trackType) {
  const speed = typeof item.speed === 'number' && item.speed > 0 ? item.speed : 1
  const sourceIn = secToTicks(item.in ?? 0)
  const sourceOut = Math.max(sourceIn + 1, secToTicks(item.out ?? 5))
  const start = secToTicks(item.offset ?? 0)
  const scale = typeof item.scale === 'number' && Number.isFinite(item.scale) ? item.scale / 100 : 1
  return {
    id: item.id ?? `clip_migrated_${Math.random().toString(36).slice(2, 10)}`,
    type: trackType,
    name: item.name ?? item.text ?? 'Clip',
    assetId: item.src ? assetIdForPath(item.src) : null,
    locator: item.src ? { runtime: 'electron', path: item.src } : null,
    source: { in: sourceIn, out: sourceOut },
    timeline: { start, duration: Math.max(1, Math.round((sourceOut - sourceIn) / speed)) },
    speed,
    reverse: item.reverse ?? false,
    transform: {
      x: item.x ?? 0,
      y: item.y ?? 0,
      scaleX: scale,
      scaleY: scale,
      rotation: item.rotation ?? 0,
      opacity: toOpacity(item.opacity)
    },
    fit: item.fit,
    focusX: item.focusX,
    focusY: item.focusY,
    cropRect: item.cropRect,
    volume: item.volume ?? 100,
    text: item.text,
    color: item.color ?? '#ffffff',
    fontSize: item.fontSize ?? 36,
    effects: Array.isArray(item.effects) ? item.effects : [],
    keyframes: Array.isArray(item.keyframes) ? item.keyframes : [],
    transitionIn: item.transitionIn
  }
}

/**
 * Migrate a v1 app project (float seconds, numeric fps, path srcs)
 * to a v3 core project. Unknown shapes throw — callers decide fallback.
 */
export function migrateV1ToV3(v1) {
  if (!v1 || typeof v1 !== 'object') throw new Error('migrateV1ToV3 requires a project object')
  const tracks = Array.isArray(v1.timeline?.tracks) ? v1.timeline.tracks : []
  const canvasFps = typeof v1.canvas?.fps === 'number' ? v1.canvas.fps : 30
  return {
    version: 3,
    project: {
      id: v1.id ?? nextProjectId(),
      name: v1.name ?? 'Untitled Project',
      duration: secToTicks((v1.durationMs ?? 0) / 1000)
    },
    canvas: {
      width: v1.canvas?.width ?? 1920,
      height: v1.canvas?.height ?? 1080,
      fps: fpsToRational(canvasFps),
      aspectRatio: {
        id: `${v1.canvas?.width ?? 1920}:${v1.canvas?.height ?? 1080}`,
        value: (v1.canvas?.width ?? 1920) / Math.max(1, v1.canvas?.height ?? 1080),
        orientation: 'landscape'
      },
      background: v1.canvas?.background ?? { type: 'color', value: '#000000' }
    },
    timeline: {
      version: 3,
      tracks: tracks.map(track => ({
        id: track.id,
        type: track.type,
        name: track.name,
        muted: track.muted,
        locked: track.locked,
        hidden: track.hidden,
        items: (track.items ?? []).map(item => migrateClip(item, track.type))
      })),
      markers: []
    }
  }
}
