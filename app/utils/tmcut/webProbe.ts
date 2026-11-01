/**
 * The browser's answer to `media.probe` (ADR-020).
 *
 * A web runtime has no ffprobe, so the only way to ask what a file is is to
 * load it into a throwaway media element and read what it reports at
 * `loadedmetadata`. That is a genuinely different set of facts from a host with
 * a probe pipeline, and this module states them: duration and intrinsic size
 * are real, frame rate is not reported by any browser, and audio presence is
 * only knowable where the engine exposes a track list — otherwise an element
 * with no video track is the audio-only signal available.
 *
 * It lives outside `useTmcutMedia` on purpose: probing a file must not
 * instantiate the project store, and the desktop branch of the adapter does not
 * reach this code at all.
 */
import type { TmcutAssetKind, TmcutMediaMetadata } from '@tmcut-core'

/** How long to wait before deciding the element will never answer. */
const PROBE_TIMEOUT_MS = 15000

export function probeWebMetadata(url: string, kind: TmcutAssetKind = 'video'): Promise<TmcutMediaMetadata | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null)
      return
    }
    try {
      // `new Audio()` has no videoWidth in the DOM types but does at runtime,
      // so one element type drives both branches.
      const el = (kind === 'audio' ? new Audio() : document.createElement('video')) as HTMLVideoElement
      el.preload = 'metadata'
      let settled = false
      const finish = (meta: TmcutMediaMetadata | null) => {
        if (settled) return
        settled = true
        resolve(meta)
      }
      el.onloadedmetadata = () => {
        const durationSec = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0
        if (durationSec === 0) {
          finish(null)
          return
        }
        const width = Number.isFinite(el.videoWidth) ? el.videoWidth : 0
        const height = Number.isFinite(el.videoHeight) ? el.videoHeight : 0
        const reported = el as HTMLVideoElement & { mozHasAudio?: boolean, audioTracks?: { length: number } }
        const hasAudio = reported.mozHasAudio ?? (reported.audioTracks ? reported.audioTracks.length > 0 : width === 0)
        finish({ durationSec, width, height, fps: 0, hasAudio })
      }
      el.onerror = () => finish(null)
      el.src = url
      setTimeout(() => finish(null), PROBE_TIMEOUT_MS)
    } catch {
      resolve(null)
    }
  })
}
