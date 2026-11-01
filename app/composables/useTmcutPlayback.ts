import { ref, computed } from 'vue'
import { TICKS_PER_SECOND, createClock, evaluateTimeline, isRamped, speedAt, ticksToSec } from '@tmcut-core'
import { useTmcutProject } from './useTmcutProject'
import type { TmcutTimelineItem } from './useTmcutProject'
import { clipMediaTimeSec, clipStartSec, lastRenderableTicks } from '~/utils/tmcut/clipTime'

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

  // ADR-018: one boundary rule for every timeline consumer — a clip window is
  // half-open, `[start, end)`, so it never paints on the first frame of the
  // window after it (an inclusive end made adjacent captions overlap for one
  // frame in BOTH preview and export). The playhead itself still rests on the
  // end of the content, which is what the ruler and the timecode show, and
  // that instant sits just past the last frame. So the position the canvas
  // renders from is pulled back to the last frame's start — otherwise a
  // project would go blank the moment it finished.
  //
  // The bound is `contentDuration`, NOT `totalDuration`: the latter carries a
  // 5 s floor so the ruler never collapses (tmcut_playback_duration), and that
  // padded tail is not part of the export. Clamping against it would leave the
  // canvas black for the whole tail and only heal the last ruler pixel.
  const playheadClock = computed(() => createClock(
    currentProject.value?.canvas?.fps || { numerator: 30, denominator: 1 }
  ))
  const renderSeconds = computed(() => {
    const endTicks = Math.round(contentDuration.value * TICKS_PER_SECOND)
    const atTicks = Math.round(playhead.value * TICKS_PER_SECOND)
    if (!(endTicks > 0) || atTicks < endTicks) return playhead.value
    return ticksToSec(lastRenderableTicks(playheadClock.value, endTicks))
  })

  // One evaluator pass per render position: the transition pair, the active
  // video layer, the active text overlays and their source positions all read
  // this answer, so the preview never re-derives window math of its own.
  const playheadEvaluation = computed(() => evaluateTimeline(
    currentProject.value,
    Math.round(renderSeconds.value * TICKS_PER_SECOND)
  ))

  // Transition crossfade state (roadmap B3 / core C5): while the playhead
  // sits inside a transition window BOTH clips are live — the INCOMING
  // clip carries `transitionIn`, the OUTGOING clip is the neighbor whose
  // end lands on the window end (an intact pair). Core's `evaluateTimeline`
  // owns the window/role/progress/source math for BOTH stored clip shapes
  // (DSL v3 and the app's flat offset/in/out); a broken pair (neighbor
  // moved/trimmed since) yields no window and renders as a plain cut,
  // matching what the export badge warns about until R3.
  const transitionCrossfade = computed(() => {
    const items = currentProject.value?.timeline?.tracks?.find(t => t.type === 'video')?.items
    if (!items?.length) return null
    const layers = playheadEvaluation.value.tracks.find(track => track.type === 'video')?.layers ?? []
    const incomingLayer = layers.find(layer => layer.transition?.role === 'incoming')
    if (!incomingLayer?.transition?.type) return null
    const outgoingLayer = layers.find(layer =>
      layer.clipId !== incomingLayer.clipId && layer.transition?.role === 'outgoing')
    if (!outgoingLayer || outgoingLayer.sourceTicks === null) return null
    const incoming = items.find(item => item.id === incomingLayer.clipId)
    const outgoing = items.find(item => item.id === outgoingLayer.clipId)
    if (!incoming || !outgoing) return null
    return {
      incoming,
      outgoing,
      type: incomingLayer.transition.type,
      progress: incomingLayer.transition.progress,
      outgoingMediaTime: ticksToSec(outgoingLayer.sourceTicks)
    }
  })

  // Active video clip at current playhead. With parallel video tracks
  // (CapCut-style layering) the TOP track wins: the header/track rows
  // render the store array in order, so index 0 IS the top row and also
  // the topmost rendered layer. Within a track the latest-starting live
  // layer is on top (that is also the incoming clip of a transition).
  const activeVideoClip = computed(() => {
    const tracks = currentProject.value?.timeline?.tracks
    if (!tracks) return null
    const crossfade = transitionCrossfade.value
    const videoTracks = tracks.filter(track => track.type === 'video')
    const videoEvaluations = playheadEvaluation.value.tracks.filter(track => track.type === 'video')
    for (let index = 0; index < videoEvaluations.length; index++) {
      const evaluation = videoEvaluations[index]
      if (!evaluation || evaluation.hidden) continue
      // Inside a transition window the OUTGOING clip owns the second
      // layer — the main element always renders the INCOMING clip.
      const live = evaluation.layers.filter(layer =>
        !(crossfade && layer.clipId === crossfade.outgoing.id))
      const top = live[live.length - 1]
      if (!top) continue
      const clip = videoTracks[index]?.items.find(item => item.id === top.clipId)
      if (!clip) continue
      return {
        clip,
        mediaCurrentTime: top.sourceTicks === null
          ? mediaTimeAt(clip, playhead.value)
          : ticksToSec(top.sourceTicks)
      }
    }
    return null
  })

  // Active text overlays at the render position — across EVERY text track, so
  // parallel caption/watermark tracks all render (R122). The evaluator owns
  // which clips are live (ADR-018), so the preview reads its layer list
  // instead of testing a window of its own; hidden rows stay hidden the way
  // the video path already treats them.
  const activeTextClips = computed<TmcutTimelineItem[]>(() => {
    const tracks = currentProject.value?.timeline?.tracks
    if (!tracks) return []
    const out: TmcutTimelineItem[] = []
    for (const evaluation of playheadEvaluation.value.tracks) {
      if (evaluation.type !== 'text' || evaluation.hidden) continue
      const track = tracks.find(item => item.type === 'text' && item.id === evaluation.id)
      for (const layer of evaluation.layers) {
        const clip = track?.items?.find(item => item.id === layer.clipId)
        if (clip) out.push(clip)
      }
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
  }

  // Keep the OUTGOING crossfade layer in sync (roadmap B3). Mirrors the
  // main element: seek-driven for reverse clips or a reverse (J) shuttle,
  // playing forward with drift correction otherwise; paused whenever no
  // transition window is active.
  function syncOutgoingVideo() {
    const el = outgoingVideoRef.value
    if (!el) return
    const pair = transitionCrossfade.value
    if (!pair) {
      if (!el.paused) el.pause()
      return
    }
    const target = pair.outgoingMediaTime
    if (shuttleRate.value < 0 || pair.outgoing.reverse) {
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
    el.playbackRate = Math.max(0.1, Math.abs(shuttleRate.value))
    if (isPlaying.value) {
      if (el.paused) el.play().catch(() => {})
    } else if (!el.paused) {
      el.pause()
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
          // Speed ramp (R124 A4): ride the instantaneous curve speed so
          // the element advances at the same rate the export's setpts
          // expression produces; the drift-correcting seek below stays the
          // anchor either way. Embedded audio warps with the rate here —
          // the export keeps it at the base speed (documented v1 gap).
          const ramped = isRamped(activeVideoClip.value.clip)
          if (ramped && !videoRef.value.paused) {
            const at = Math.round((playhead.value - clipStartSec(activeVideoClip.value.clip)) * TICKS_PER_SECOND)
            const want = Math.min(16, Math.max(0.25, Math.abs(shuttleRate.value) * speedAt(activeVideoClip.value.clip, at)))
            if (Math.abs(videoRef.value.playbackRate - want) > 0.02) {
              videoRef.value.playbackRate = want
            }
          }
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
      videoRef.value.playbackRate = Math.max(0.1, Math.abs(shuttleRate.value))
      videoRef.value.play().catch(() => {})
    }
    syncOutgoingVideo()
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
      videoRef.value.playbackRate = shuttleRate.value
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
    isPlaying,
    zoom,
    videoRef,
    outgoingVideoRef,
    activeVideoClip,
    transitionCrossfade,
    activeTextClips,
    formatTimecode,
    seek,
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
