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
import type { TmcutAssetKind, TmcutMediaMetadata } from 'tmcut-core'
import { THROWAWAY_MEDIA_TIMEOUT_MS, withThrowawayMedia } from './mediaElement'

export function probeWebMetadata(url: string, kind: TmcutAssetKind = 'video'): Promise<TmcutMediaMetadata | null> {
  return withThrowawayMedia<TmcutMediaMetadata>(
    kind === 'audio' ? 'audio' : 'video',
    (el, settle) => {
      el.preload = 'metadata'
      el.onloadedmetadata = () => {
        const durationSec = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0
        if (durationSec === 0) {
          settle(null)
          return
        }
        const width = Number.isFinite(el.videoWidth) ? el.videoWidth : 0
        const height = Number.isFinite(el.videoHeight) ? el.videoHeight : 0
        const reported = el as HTMLVideoElement & { mozHasAudio?: boolean, audioTracks?: { length: number } }
        const hasAudio = reported.mozHasAudio ?? (reported.audioTracks ? reported.audioTracks.length > 0 : width === 0)
        settle({ durationSec, width, height, fps: 0, hasAudio })
      }
      el.onerror = () => settle(null)
      el.src = url
    },
    THROWAWAY_MEDIA_TIMEOUT_MS
  )
}
