import { ref, computed } from 'vue'
import { TICKS_PER_SECOND, compositePlan, createFrameScheduler, renderAt, speedAt, ticksToSec } from 'tmcut-core'
import type { CoreEvaluatedLayer } from 'tmcut-core'
import { useTmcutProject } from './useTmcutProject'
import type { TmcutTimelineItem } from './useTmcutProject'
import { clipMediaTimeSec, clipStartSec } from '~/utils/tmcut/clipTime'

// One surface the canvas paints at this tick, straight from core's plan.
export type PaintSurface = {
  key: string
  role: 'paint' | 'outgoing'
  trackId: string | null
  trackIndex: number
  clip: TmcutTimelineItem
  layer: CoreEvaluatedLayer
  mediaTimeSec: number
  ownsAudio: boolean
  /** True when this surface's crossfade partner is on screen with it. */
  crossfades: boolean
}

// Shared playback state across TMCut editor
const playhead = ref(0) // Playhead position in seconds
const isPlaying = ref(false)
const zoom = ref(50) // Pixels per second (zoom level)
const videoRef = ref<HTMLVideoElement | null>(null)
// OUTGOING crossfade layer (roadmap B3): the second <video> element that
// fades out during a transition window; registered by the preview player.
const outgoingVideoRef = ref<HTMLVideoElement | null>(null)
// J-K-L shuttle rate: 1 = normal, 2/4/8 = fast forward, -1/-2/-4/-8 = reverse.
// Forward shuttle rides the native video playbackRate; reverse is seek-driven
// because HTMLVideoElement does not decode backwards reliably.
const shuttleRate = ref(1)
// In/Out render marks (export zone, design #3): null = unset. Valid range
// requires both marks with out > in — validated by renderRange.
const renderIn = ref<number | null>(null)
const renderOut = ref<number | null>(null)
// Loop playback (design #2 transport): wraps at the In/Out zone end when
// both marks are set, otherwise at the end of the timeline.
const loopPlayback = ref(false)
// Master preview volume/mute for the program monitor — the per-clip
// volume stays a separate factor applied on top of these.
const previewVolume = ref(1)
const previewMuted = ref(false)

export function useTmcutPlayback() {
  const { currentProject, totalDuration, contentDuration } = useTmcutProject()

  // Format seconds to HH:MM:SS.ff or MM:SS.ff. The frame field follows the
  // canvas rate (a 60fps project must not count frames 0-29); 30 stays the
  // default for callers that have no project in scope (export queue, ruler).
  function formatTimecode(seconds: number, fps = 30): string {
    if (isNaN(seconds) || seconds < 0) seconds = 0
    const rate = Number.isFinite(fps) && fps > 0 ? fps : 30
    const whole = Math.floor(seconds)
    const hrs = Math.floor(whole / 3600)
    const mins = Math.floor((whole % 3600) / 60)
    const secs = whole % 60
    const frames = Math.min(Math.ceil(rate) - 1, Math.floor((seconds - whole) * rate))

    const m = String(mins).padStart(2, '0')
    const s = String(secs).padStart(2, '0')
    const f = String(frames).padStart(2, '0')

    if (hrs > 0) {
      const h = String(hrs).padStart(2, '0')
      return `${h}:${m}:${s}.${f}`
    }
    return `${m}:${s}.${f}`
  }

  // Source-media time of a clip at a timeline position. Reverse clips
  // (roadmap B2) run from the source end backwards — core C4 retime
  // semantics. Shared by the main element and the crossfade layer.
  function mediaTimeAt(clip: TmcutTimelineItem, at: number): number {
    return clipMediaTimeSec(clip, at)
  }

  // ADR-018: one boundary rule for every timeline consumer, and since V4
  // Phase 2 item (1) one CALL that owns it. `renderAt` answers "where does
  // this timestamp actually render": half-open clip windows `[start, end)`,
  // the step back to the START of the last frame when the playhead rests at the
  // end of content (that instant belongs to no clip, and a canvas parked there
  // would go black exactly where playback leaves the viewer), and the frame the
  // position falls in. The preview asks in scrub mode — `snapToFrame: false`,
  // so a drag tracks the pointer — while a frame loop asks in frame mode and
  // gets the same law. The app used to keep its own copy of that step-back
  // here and in `clipTime.lastRenderableTicks`; both are gone, so a caption can
  // no longer be live in one surface and dead in another because two places
  // disagree about the last frame.
  //
  // The bound is the CONTENT extent core measures (`endTicks`), NOT
  // `totalDuration`: the latter carries a 5 s floor so the ruler never collapses
  // (tmcut_playback_duration), and that padded tail is not part of the export.
  const renderPosition = computed(() => renderAt(
    currentProject.value,
    Math.round(playhead.value * TICKS_PER_SECOND),
    { snapToFrame: false }
  ))
  const renderSeconds = computed(() => ticksToSec(renderPosition.value.at))

  // One evaluator pass per render position: the transition pair, the active
  // video layer, the active text overlays and their source positions all read
  // this answer, so the preview never re-derives window math of its own.
  const playheadEvaluation = computed(() => renderPosition.value.evaluation)

  // The renderable frame sequence (roadmap V4 Phase 2, item 3): a pure function
  // of the project and its canvas rate. Frame stepping reads it, so "frame 37"
  // is the same picture on the tenth press and the first — no wall clock, and
  // no second copy of the frame grid in the app.
  const frameScheduler = computed(() => createFrameScheduler(currentProject.value))
  const currentFrameIndex = computed(() => frameScheduler.value.indexOf(
    Math.round(playhead.value * TICKS_PER_SECOND)
  ))

  // Every surface the canvas must paint at this tick, in core's stack order
  // (Zero-FFmpeg slice F1/F2): `compositePlan` answers which layer of which row
  // is the picture, which is a transition's outgoing partner, and what overlays
  // the footage. The app used to answer all three itself — a `footageRow`
  // lookup, a pair scan over the layers, a "top layer" filter — while the
  // exporter answered them a second way, and that pair of answers is the drift
  // F1 retired the single-row law for.
  //
  // A surface joins back to the authored clip through `trackIndex`, the row's
  // position in `evaluateTimeline`'s own track list, and carries the evaluator's
  // layer BY REFERENCE: opacity, transform and source position must be the ones
  // core computed for this tick, never a second reading of the clip.
  //
  // `ownsAudio` marks the BOTTOM row's picture — the surface whose sound the
  // file carries, because the export's audio is one concat of that row. During
  // a crossfade that is the incoming clip, which is the simplification the
  // player already documents on the outgoing element.
  const paintPlan = computed(() => compositePlan(playheadEvaluation.value))
  const paintSurfaces = computed<PaintSurface[]>(() => {
    const tracks = currentProject.value?.timeline?.tracks
    if (!tracks) return []
    const surfaces: PaintSurface[] = []
    let audioClaimed = false
    for (const slot of paintPlan.value.slots) {
      if (slot.kind !== 'footage') continue
      const clip = tracks[slot.trackIndex]?.items?.find(item => item.id === slot.clipId)
      if (!clip) continue
      const ownsAudio = slot.role === 'paint' && !audioClaimed
      if (ownsAudio) audioClaimed = true
      surfaces.push({
        key: `${slot.trackId}:${slot.clipId}:${slot.role}`,
        role: slot.role,
        trackId: slot.trackId,
        trackIndex: slot.trackIndex,
        clip,
        layer: slot.layer,
        mediaTimeSec: slot.layer.sourceTicks === null
          ? mediaTimeAt(clip, playhead.value)
          : ticksToSec(slot.layer.sourceTicks),
        ownsAudio,
        crossfades: false
      })
    }
    // A crossfade only exists when BOTH of its layers are on screen. The plan
    // hands the outgoing slot directly under its picture, so that adjacency IS
    // the pair; a layer whose partner was trimmed away keeps painting as the
    // plain cut `compositePlan` decided, with no ramp on it.
    for (let index = 1; index < surfaces.length; index++) {
      const below = surfaces[index - 1]
      const above = surfaces[index]
      if (!below || !above) continue
      if (below.role === 'outgoing' && above.role === 'paint'
        && below.trackIndex === above.trackIndex) {
        below.crossfades = true
        above.crossfades = true
      }
    }
    return surfaces
  })

  // Transition crossfade state (roadmap B3 / core C5): while the playhead sits
  // inside a transition window core gives that row TWO surfaces — the outgoing
  // partner directly under the picture — so the pair is read off the surface
  // list rather than re-detected here. A broken pair (neighbor moved/trimmed
  // since) yields no window and renders as a plain cut, matching what the export
  // badge warns about until R3.
  //
  // The pair must belong to the row that owns the audio: the crossfade element
  // is a real <video>, so a window from any other row would show through while
  // the painting row could not crossfade. F2b lifts that scoping once every row
  // has its own element.
  const transitionCrossfade = computed(() => {
    const surfaces = paintSurfaces.value
    const index = surfaces.findIndex(surface => surface.ownsAudio)
    if (index < 1) return null
    const paint = surfaces[index]
    const partner = surfaces[index - 1]
    if (!paint || !partner) return null
    if (partner.role !== 'outgoing' || partner.trackIndex !== paint.trackIndex) return null
    const spec = paint.layer.transition
    if (!spec?.type || partner.layer.sourceTicks === null) return null
    return {
      incoming: paint.clip,
      outgoing: partner.clip,
      type: spec.type,
      progress: spec.progress,
      outgoingMediaTime: partner.mediaTimeSec
    }
  })

  // The surface the crossfade element carries: the partner sitting directly
  // under the main picture while a transition window is open. Exposed as a
  // surface so the DOM styles it with the same helper every other footage
  // layer uses, instead of a second ramp law keyed off the pair object.
  const crossfadeSurface = computed<PaintSurface | null>(() => {
    if (!transitionCrossfade.value) return null
    const owner = paintSurfaces.value.findIndex(surface => surface.ownsAudio)
    if (owner < 1) return null
    return paintSurfaces.value[owner - 1] ?? null
  })

  // The surface the main element carries — the bottom of the stack, the one
  // that owns the audio. Exposed as a surface (not just `{ clip, time }`) so
  // the DOM can style it with the same helper the stacked rows use.
  const mainSurface = computed<PaintSurface | null>(() =>
    paintSurfaces.value.find(item => item.ownsAudio) ?? null)

  // Active video clip at the render position — the surface that owns the audio,
  // i.e. the bottom of the stack. Inside a transition window that is the
  // incoming clip (its partner owns the second <video> element instead), so the
  // main element never shows a half-blended frame.
  const activeVideoClip = computed(() => {
    const surface = mainSurface.value
    if (!surface) return null
    return { clip: surface.clip, mediaCurrentTime: surface.mediaTimeSec }
  })

  // Every footage surface the DOM has no dedicated element for (Zero-FFmpeg
  // slice F2b). The main element already paints `mainSurface` and the crossfade
  // element paints its partner directly beneath it, so the v-for over the stack
  // is the plan MINUS those two: rendering the whole plan would double-paint the
  // bottom row, and rendering "everything after the owner" would drop a row
  // whose pair sits above the canvas.
  const stackedSurfaces = computed<PaintSurface[]>(() => {
    const surfaces = paintSurfaces.value
    const owner = surfaces.findIndex(surface => surface.ownsAudio)
    if (owner < 0) return []
    const carried = transitionCrossfade.value ? owner - 1 : -1
    return surfaces.filter((_, index) => index !== owner && index !== carried)
  })

  // Active text overlays at the render position — across EVERY visible text
  // track, so parallel caption/watermark tracks all render (R122). The plan
  // places them after all footage, which is also the DOM's paint order.
  const activeTextClips = computed<TmcutTimelineItem[]>(() => {
    const tracks = currentProject.value?.timeline?.tracks
    if (!tracks) return []
    const out: TmcutTimelineItem[] = []
    for (const slot of paintPlan.value.slots) {
      if (slot.kind !== 'overlay') continue
      const clip = tracks[slot.trackIndex]?.items?.find(item => item.id === slot.clipId)
      if (clip) out.push(clip)
    }
    return out
  })

  // Seek playhead to specific time in seconds
  function seek(timeInSec: number) {
    const clamped = Math.max(0, Math.min(totalDuration.value, timeInSec))
    playhead.value = clamped

    if (videoRef.value && activeVideoClip.value) {
      try {
        videoRef.value.currentTime = activeVideoClip.value.mediaCurrentTime
      } catch {
        // ignore seeks on unloaded metadata; the playback
        // loop self-heals the frame position while playing
      }
    }
    syncOutgoingVideo()
    syncStackedVideos()
  }

  // Frame-accurate seek (roadmap V4 Phase 2, item 3): the playhead lands on the
  // frame's START tick, which is exactly the position core evaluates the frame
  // for. An index outside the sequence moves nothing — there is no frame there
  // to land on, and the last frame is where the timeline already parks.
  function seekToFrame(index: number) {
    const frame = frameScheduler.value.frameAt(index)
    if (!frame) return
    seek(ticksToSec(frame.startTicks))
  }

  function stepFrame(delta: number) {
    if (!Number.isFinite(delta) || delta === 0) return
    seekToFrame(currentFrameIndex.value + delta)
  }

  // One media-clock rate for every footage element (Zero-FFmpeg F4): the
  // element must advance at the rate the seek target was BUILT with, or the
  // corrective seek fires every frame and the picture is a thrash instead of a
  // fast clip. The export has always divided `setpts` by the clip's speed for
  // every row, ramped or not (render/video.ts), so this is the screen-side
  // reading of that same number — core's `speedAt`, once, for the whole stack.
  // A constant `speed` is a speed: `isRamped` is not a gate here.
  function mediaRate(clip: TmcutTimelineItem | null | undefined): number {
    const shuttle = Math.abs(shuttleRate.value)
    // No footage under the playhead: nothing is retimed, only the shuttle.
    if (!clip) return Math.max(0.1, shuttle)
    // Read the curve at the tick the PLAN was built for, not at a fresh
    // playhead reading: a ramp sampled somewhere else is a third answer.
    const at = Math.round((renderSeconds.value - clipStartSec(clip)) * TICKS_PER_SECOND)
    return Math.min(16, Math.max(0.25, shuttle * speedAt(clip, at)))
  }

  // One media-clock law for the footage elements that are NOT the main one —
  // the crossfade partner and every stacked surface. Seek-driven for a reverse
  // clip or a reverse (J) shuttle, native forward play with drift correction
  // otherwise, paused whenever nothing is playing. Keeping this in one place is
  // what stops a second row from running a different clock than the first.
  function syncSecondaryVideo(el: HTMLVideoElement, clip: TmcutTimelineItem, target: number) {
    if (shuttleRate.value < 0 || clip.reverse) {
      if (!el.paused) el.pause()
      if (Math.abs(el.currentTime - target) > 0.25) {
        try {
          el.currentTime = target
        } catch {
          // ignore seeks on unloaded metadata; retried next frame
        }
      }
      return
    }
    if (Math.abs(el.currentTime - target) > 0.3) {
      try {
        el.currentTime = target
      } catch {
        // ignore seeks on unloaded metadata; retried next frame
      }
    }
    el.playbackRate = mediaRate(clip)
    if (isPlaying.value) {
      if (el.paused) el.play().catch(() => {})
    } else if (!el.paused) {
      el.pause()
    }
  }

  // Keep the OUTGOING crossfade layer in sync (roadmap B3).
  function syncOutgoingVideo() {
    const el = outgoingVideoRef.value
    if (!el) return
    const pair = transitionCrossfade.value
    if (!pair) {
      if (!el.paused) el.pause()
      return
    }
    syncSecondaryVideo(el, pair.outgoing, pair.outgoingMediaTime)
  }

  // The stacked surfaces' media elements, keyed by the surface each one paints
  // (Zero-FFmpeg slice F2b). A plain ref array cannot say which element belongs
  // to which row once the plan changes under it, so the player registers every
  // element it mounts against its surface key.
  const stackedVideoEls = new Map<string, HTMLVideoElement>()

  function setStackedVideoEl(key: string, el: unknown) {
    const node = el instanceof HTMLVideoElement ? el : null
    const previous = stackedVideoEls.get(key)
    if (previous && previous !== node) {
      if (!previous.paused) previous.pause()
      stackedVideoEls.delete(key)
    }
    if (node) stackedVideoEls.set(key, node)
  }

  function syncStackedVideos() {
    for (const surface of stackedSurfaces.value) {
      const el = stackedVideoEls.get(surface.key)
      if (!el) continue
      syncSecondaryVideo(el, surface.clip, surface.mediaTimeSec)
    }
  }

  // Playback animation loop
  let lastTimestamp = 0
  let animId: number | null = null

  // Loop wrap bounds: the In/Out zone when valid, else the full timeline.
  function loopBounds(): { start: number, end: number } {
    const hasRange = renderIn.value !== null && renderOut.value !== null
      && renderOut.value - renderIn.value >= 0.05
    return hasRange
      ? { start: renderIn.value!, end: renderOut.value! }
      : { start: 0, end: contentDuration.value }
  }

  function step(timestamp: number) {
    if (!isPlaying.value) {
      animId = null
      return
    }

    if (lastTimestamp === 0) {
      lastTimestamp = timestamp
    }

    const delta = (timestamp - lastTimestamp) / 1000 // seconds
    lastTimestamp = timestamp

    // Reverse shuttle: rewind the playhead and seek the video frame whenever
    // it drifts too far behind (the element stays paused in this mode).
    if (shuttleRate.value < 0) {
      const newTime = playhead.value + delta * shuttleRate.value
      if (loopPlayback.value) {
        const { start, end } = loopBounds()
        if (newTime <= start) {
          // Wrap backwards to the zone end, carrying the overshoot
          const span = Math.max(0.05, end - start)
          const wrapped = end - ((start - newTime) % span)
          seek(wrapped > start ? wrapped : end)
        } else {
          playhead.value = newTime
        }
      } else if (newTime <= 0) {
        playhead.value = 0
        pause()
        return
      } else {
        playhead.value = newTime
      }
      if (videoRef.value) {
        if (!videoRef.value.paused) videoRef.value.pause()
        const clip = activeVideoClip.value
        if (clip) {
          const targetTime = clip.mediaCurrentTime
          if (Math.abs(videoRef.value.currentTime - targetTime) > 0.25) {
            try {
              videoRef.value.currentTime = targetTime
            } catch {
              // ignore seeks on unloaded metadata; retried next frame
            }
          }
        }
      }
      syncOutgoingVideo()
      syncStackedVideos()
      animId = requestAnimationFrame(step)
      return
    }

    const newTime = playhead.value + delta * shuttleRate.value
    if (loopPlayback.value) {
      const { start, end } = loopBounds()
      if (newTime >= end) {
        // Wrap inside the loop zone, carrying the overshoot
        const span = Math.max(0.05, end - start)
        seek(start + ((newTime - start) % span))
      } else {
        playhead.value = newTime
      }
    } else if (newTime >= contentDuration.value) {
      playhead.value = contentDuration.value
      pause()
      return
    } else {
      playhead.value = newTime
    }

    // Keep active video element in sync + self-heal: resume the element if
    // it stalled (gap exit with unchanged src, autoplay race, slow metadata)
    // so the frame counter and the picture can never drift apart.
    if (videoRef.value) {
      if (activeVideoClip.value) {
        const targetTime = activeVideoClip.value.mediaCurrentTime
        // Reverse clips cannot play natively (the element only runs
        // forward): step by seeking, exactly like the J shuttle branch
        // above. Forward clips keep playing with drift-correction seeks.
        if (activeVideoClip.value.clip.reverse) {
          if (!videoRef.value.paused) videoRef.value.pause()
          if (Math.abs(videoRef.value.currentTime - targetTime) > 0.25) {
            try {
              videoRef.value.currentTime = targetTime
            } catch {
              // ignore seeks on unloaded metadata; retried next frame
            }
          }
        } else {
          // The same rate law every other footage element runs on: shuttle x
          // core's speed for this clip at this tick. The drift-correcting seek
          // below stays the anchor either way. Embedded audio warps with the
          // rate here — the export keeps it at the base speed (documented v1
          // gap). Applied while the element is paused too, so a resumed
          // element never plays one frame at the wrong rate.
          videoRef.value.playbackRate = mediaRate(activeVideoClip.value.clip)
          if (Math.abs(videoRef.value.currentTime - targetTime) > 0.3) {
            try {
              videoRef.value.currentTime = targetTime
            } catch {
              // ignore seeks on unloaded metadata; retried next frame
            }
          }
          if (videoRef.value.paused) {
            videoRef.value.play().catch(() => {})
          }
        }
      } else if (!videoRef.value.paused) {
        videoRef.value.pause()
      }
    }
    syncOutgoingVideo()
    syncStackedVideos()

    animId = requestAnimationFrame(step)
  }

  function play() {
    if (contentDuration.value <= 0) return
    // Do not animate the playhead when the timeline has no clips
    const hasClips = currentProject.value?.timeline?.tracks?.some(t => (t.items?.length || 0) > 0)
    if (!hasClips) return
    if (playhead.value >= contentDuration.value) {
      playhead.value = 0
    } else if (loopPlayback.value && playhead.value >= loopBounds().end) {
      // Loop zone is over: restart from the zone start
      playhead.value = loopBounds().start
    }
    isPlaying.value = true
    lastTimestamp = 0
    if (videoRef.value) {
      videoRef.value.playbackRate = mediaRate(activeVideoClip.value?.clip)
      videoRef.value.play().catch(() => {})
    }
    syncOutgoingVideo()
    syncStackedVideos()
    animId = requestAnimationFrame(step)
  }

  function pause() {
    isPlaying.value = false
    lastTimestamp = 0
    shuttleRate.value = 1 // K / pause always returns to normal speed
    if (animId) {
      cancelAnimationFrame(animId)
      animId = null
    }
    if (videoRef.value) {
      videoRef.value.pause()
      videoRef.value.playbackRate = 1
    }
    syncOutgoingVideo()
    syncStackedVideos()
  }

  function togglePlayPause() {
    if (isPlaying.value) {
      pause()
    } else {
      play()
    }
  }

  // Guards shared by the J/K/L shuttle: same conditions as play()
  function canShuttle(): boolean {
    if (contentDuration.value <= 0) return false
    return !!currentProject.value?.timeline?.tracks?.some(t => (t.items?.length || 0) > 0)
  }

  // L — start fast forward, each press doubles the speed up to 8x
  function shuttleForward() {
    if (!canShuttle()) return
    if (!isPlaying.value) {
      shuttleRate.value = 1
      play()
      return
    }
    shuttleRate.value = shuttleRate.value < 1 ? 1 : Math.min(8, shuttleRate.value * 2)
    if (videoRef.value) {
      videoRef.value.playbackRate = mediaRate(activeVideoClip.value?.clip)
    }
  }

  // J — start reverse, each press doubles the reverse speed up to -8x
  function shuttleBackward() {
    if (!canShuttle() || playhead.value <= 0) return
    if (!isPlaying.value || shuttleRate.value > 0) {
      shuttleRate.value = -1
      if (videoRef.value) {
        videoRef.value.pause()
        videoRef.value.playbackRate = 1
      }
      if (!isPlaying.value) {
        isPlaying.value = true
        lastTimestamp = 0
        animId = requestAnimationFrame(step)
      }
      return
    }
    shuttleRate.value = Math.max(-8, shuttleRate.value * 2)
  }

  // K — stop (pause and reset the shuttle rate)
  function shuttleStop() {
    pause()
  }

  function stepForward(seconds = 1) {
    seek(playhead.value + seconds)
  }

  function stepBackward(seconds = 1) {
    seek(playhead.value - seconds)
  }

  // Valid export zone: both marks present and out > in (min 50ms)
  const renderRange = computed(() => {
    const a = renderIn.value
    const b = renderOut.value
    if (a === null || b === null || b - a < 0.05) return null
    return { start: a, end: b }
  })

  // Toggle-style mark setter: pressing the same key near the existing mark
  // clears it, otherwise the mark moves to the playhead (design #3 I/O).
  function setRenderMark(which: 'in' | 'out') {
    const pos = playhead.value
    const current = which === 'in' ? renderIn.value : renderOut.value
    if (current !== null && Math.abs(pos - current) < 0.05) {
      if (which === 'in') renderIn.value = null
      else renderOut.value = null
      return
    }
    if (which === 'in') renderIn.value = pos
    else renderOut.value = pos
  }

  function clearRenderMarks() {
    renderIn.value = null
    renderOut.value = null
  }

  function zoomIn() {
    zoom.value = Math.min(200, zoom.value + 10)
  }

  function zoomOut() {
    zoom.value = Math.max(15, zoom.value - 10)
  }

  return {
    playhead,
    renderSeconds,
    frameScheduler,
    currentFrameIndex,
    isPlaying,
    zoom,
    videoRef,
    outgoingVideoRef,
    paintSurfaces,
    stackedSurfaces,
    mainSurface,
    crossfadeSurface,
    setStackedVideoEl,
    activeVideoClip,
    transitionCrossfade,
    activeTextClips,
    formatTimecode,
    seek,
    seekToFrame,
    stepFrame,
    play,
    pause,
    togglePlayPause,
    stepForward,
    stepBackward,
    shuttleForward,
    shuttleBackward,
    shuttleStop,
    renderIn,
    renderOut,
    renderRange,
    setRenderMark,
    clearRenderMarks,
    loopPlayback,
    previewVolume,
    previewMuted,
    zoomIn,
    zoomOut
  }
}
