'use strict'

/**
 * AutoCut's two detection passes, as ONE argv source for both runtimes: the
 * Electron main process (tmcut.controller.cjs) and the web endpoint
 * (server/api/v1/media/analyze.post.ts). They must stay byte-identical — the
 * renderer parses both logs with the same @tmcut/core readers, so any drift
 * changes the EDL between desktop and web.
 *
 * It also pins the FFmpeg build contract: `-vsync` was removed in the bundled
 * N-126482, and the desktop copy of this call shipped it for months, which
 * made scene detection fail on every AutoCut run. tmcut_detect_smoke.spec.ts
 * runs these exact vectors against resources/ffmpeg.exe.
 */

/** Scene scores are 0..1; anything else falls back to the pipeline default. */
function sceneThreshold(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.4
}

function silenceNoise(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : -30
}

function silenceDuration(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0.5
}

/**
 * Shot detection. `select=…,showinfo` on a null muxer never reaches an
 * encoder, so the audio/subtitle/data streams are dropped instead of being
 * decoded and re-encoded for nothing; passthrough keeps frame order.
 */
function sceneDetectionArgs(input, threshold) {
  return [
    '-hide_banner',
    '-i', input,
    '-an', '-sn', '-dn',
    '-vf', `select='gt(scene,${sceneThreshold(threshold)})',showinfo`,
    '-fps_mode', 'passthrough',
    '-f', 'null', '-'
  ]
}

/** Silence detection: audio filter only, video and data streams dropped. */
function silenceDetectionArgs(input, noiseDb, minDuration) {
  return [
    '-hide_banner',
    '-i', input,
    '-af', `silencedetect=noise=${silenceNoise(noiseDb)}dB:d=${silenceDuration(minDuration)}`,
    '-vn', '-sn', '-dn',
    '-f', 'null', '-'
  ]
}

module.exports = { sceneDetectionArgs, silenceDetectionArgs, sceneThreshold, silenceNoise, silenceDuration }
