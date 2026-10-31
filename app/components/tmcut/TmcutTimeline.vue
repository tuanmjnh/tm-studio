<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { TICKS_PER_SECOND, parseSrt, serializeSrt, cuesToCaptionClips, secToTicks, ticksToSec } from '@tmcut-core'
import { useTmcutProject } from '~/composables/useTmcutProject'
import type { TmcutTrack } from '~/composables/useTmcutProject'
import { useTmcutContextMenu } from '~/composables/useTmcutContextMenu'
import { useTmcutPlayback } from '~/composables/useTmcutPlayback'
import { useFileSystem } from '~/composables/useFileSystem'
import { useTmcutMedia } from '~/composables/useTmcutMedia'
import { useTmcutUiPrefs } from '~/composables/useTmcutUiPrefs'
import { toURL } from '~/utils/ffmpegHelper'
import { TMCUT_ASSET_MIME } from '~/utils/tmcut/dnd'
import type { TmcutAssetDragPayload } from '~/utils/tmcut/dnd'
import { clipStartSec, clipEndSec, clipDurationSec, clipStartTicks, clipDurationTicks } from '~/utils/tmcut/clipTime'

const { t } = useI18n()

const {
  currentProject,
  selectedClipId,
  totalDuration,
  contentDuration,
  addClipToTrack,
  removeClip,
  splitClip,
  undo,
  redo,
  canUndo,
  canRedo,
  toggleTrackMute,
  toggleTrackLock,
  toggleTrackHidden,
  updateTrackVolume,
  updateTrackPan,
  addTrackToProject,
  moveTrackInProject,
  removeTrackFromProject,
  clipboard,
  rippleMode,
  copySelectedClips,
  pasteClipboardAt,
  duplicateSelectedClips,
  rippleDeleteSelected,
  snapTimeSec,
  timelineMarkers,
  addMarkerAt,
  updateMarker,
  removeMarkerById,
  trimSelectedEdgeAt,
  toggleFadeSelection,
  groupSelection,
  ungroupSelection,
  toggleLinkSelection,
  closeProjectGaps,
  flushDiskSave
} = useTmcutProject()

const {
  playhead,
  zoom,
  formatTimecode,
  seek,
  pause,
  renderIn,
  renderOut,
  renderRange,
  setRenderMark,
  clearRenderMarks
} = useTmcutPlayback()

const { pickFile, pickWebFiles, selectSaveFile, readText, writeText } = useFileSystem()
const { isDesktop, importWebFiles, addAssetToTimeline } = useTmcutMedia()
const { transcribe } = useTmcutAi()
const { tip, shortcutsOpen, snapOn } = useTmcutUiPrefs()
const toast = useToast()

// ===== Right-click track menu =====
// Right-clicking the EMPTY part of a track row is the quickest path to
// whole-row actions (paste at the playhead, close gaps, hide/lock/mute,
// remove) without hunting the small header buttons. Placement is shared
// with the clip menu, so neither panel is clipped by the timeline's
// overflow nor runs off the bottom of the window.
const {
  open: trackMenuOpen,
  ready: trackMenuReady,
  pos: trackMenuPos,
  el: trackMenuEl,
  openAt: openTrackMenuAt,
  close: closeTrackMenu
} = useTmcutContextMenu()
const trackMenuId = ref<string | null>(null)
const trackMenuTarget = computed<TmcutTrack | null>(() =>
  currentProject.value?.timeline?.tracks?.find(track => track.id === trackMenuId.value) ?? null)
const canPasteOnTrack = computed(() => (clipboard.value?.clips?.length ?? 0) > 0)

function onTrackContextMenu(e: MouseEvent, track: TmcutTrack) {
  trackMenuId.value = track.id
  openTrackMenuAt(e)
}

function runTrackPaste() {
  if (pasteClipboardAt(playhead.value).length > 0) {
    toast.add({ title: t('tmcut.timelineActions.pasted'), color: 'success' })
  }
  closeTrackMenu()
}

function runTrackCloseGaps() {
  const closedTicks = closeProjectGaps()
  if (closedTicks > 0) {
    toast.add({
      title: t('tmcut.timelineActions.gapsClosed', { seconds: Number(ticksToSec(closedTicks).toFixed(2)) }),
      color: 'success'
    })
  } else {
    toast.add({ title: t('tmcut.timelineActions.noGaps'), color: 'neutral' })
  }
  closeTrackMenu()
}

function runTrackToggle(action: 'hidden' | 'locked' | 'muted') {
  const track = trackMenuTarget.value
  if (!track) return
  if (action === 'hidden') toggleTrackHidden(track.id)
  else if (action === 'locked') toggleTrackLock(track.id)
  else toggleTrackMute(track.id)
  closeTrackMenu()
}

function runTrackRemove() {
  const track = trackMenuTarget.value
  if (track && !track.locked) removeTrackFromProject(track.id)
  closeTrackMenu()
}

const tracksContainerRef = ref<HTMLDivElement | null>(null)
const rulerRef = ref<HTMLDivElement | null>(null)

// Visible width of the tracks viewport (no scrollbar). The canvas floor is
// THIS number, not a fixed constant: a hard 1200px floor made a narrow
// (web) panel grow a horizontal scrollbar that scrolled into empty space
// beyond the content — the "kéo scroll ngang không thấy gì" report.
const tracksViewportWidth = ref(0)
let viewportWidthObserver: ResizeObserver | null = null

function syncTracksViewportWidth() {
  const el = tracksContainerRef.value
  if (el) tracksViewportWidth.value = el.clientWidth
}

// Total width of the timeline in pixels: the content (duration + 10s of
// working room) at the current zoom, but never narrower than the panel —
// so the canvas fills the visible area and the horizontal scrollbar only
// ever appears when there is real content (or zoom) to reach.
const timelineWidth = computed(() => {
  const content = (totalDuration.value + 10) * zoom.value
  return Math.max(content, tracksViewportWidth.value || 0)
})

// Fit the whole timeline (content + right padding) into the visible
// tracks viewport — the "fit to screen" button of design #2.
function zoomToFit() {
  const el = tracksContainerRef.value
  if (!el || totalDuration.value <= 0) return
  const fit = (el.clientWidth - 8) / (totalDuration.value + 10)
  zoom.value = Math.round(Math.min(200, Math.max(15, fit)))
}

// Ctrl/Cmd + wheel zooms the timeline anchored at the cursor position
// (plain wheel keeps the native horizontal scrolling). preventDefault
// also stops Electron/Chromium from page-zooming the app window.
function onTracksWheel(event: WheelEvent) {
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  const container = tracksContainerRef.value
  if (!container) return
  const offsetX = event.clientX - container.getBoundingClientRect().left
  const timeAtCursor = (container.scrollLeft + offsetX) / zoom.value
  const direction = event.deltaY > 0 ? -1 : 1
  zoom.value = Math.round(Math.min(200, Math.max(15, zoom.value + direction * 10)))
  nextTick(() => {
    container.scrollLeft = Math.max(0, timeAtCursor * zoom.value - offsetX)
  })
}

// Keyboard twin of the Ctrl+wheel zoom (roadmap K6): the same ±10 step
// and 15..200 clamp, anchored at the PLAYHEAD (a keypress has no cursor
// position) so the edit point stays pixel-locked on screen.
function stepZoomKeyboard(direction: 1 | -1) {
  const container = tracksContainerRef.value
  const prev = zoom.value
  const next = Math.round(Math.min(200, Math.max(15, prev + direction * 10)))
  if (next === prev) return
  const screenX = container ? playhead.value * prev - container.scrollLeft : 0
  zoom.value = next
  if (container) {
    nextTick(() => {
      container.scrollLeft = Math.max(0, playhead.value * next - screenX)
    })
  }
}

// Bring the playhead into view after a keyboard jump (roadmap K7) —
// seek() only moves time, never the horizontal scroll position.
function scrollPlayheadIntoView() {
  nextTick(() => {
    const container = tracksContainerRef.value
    if (!container) return
    const x = playhead.value * zoom.value
    const margin = 40
    if (x < container.scrollLeft + margin || x > container.scrollLeft + container.clientWidth - margin) {
      container.scrollLeft = Math.max(0, x - container.clientWidth / 2)
    }
  })
}

// Generate tick markers for ruler (every 1s, with major ticks every 5s)
const rulerTicks = computed(() => {
  const count = Math.ceil(totalDuration.value + 10)
  const ticks = []
  // Depending on zoom, choose interval
  const step = zoom.value < 30 ? 5 : zoom.value < 60 ? 2 : 1

  for (let s = 0; s <= count; s += step) {
    ticks.push({
      sec: s,
      left: s * zoom.value,
      isMajor: s % 5 === 0,
      label: formatTimecode(s).split('.')[0] // exclude frames on ruler label
    })
  }
  return ticks
})

// Playhead position in pixels
const playheadLeft = computed(() => playhead.value * zoom.value)

// ---- Ruler markers (roadmap B5) ----
const MARKER_COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#a855f7', '#e5e7eb']

// Marker pins: ticks → px at the current zoom. The value is shifted
// left by 6px so the wrapper's 12px hit strip is centered on the line
// (an easy dblclick target).
const markerPins = computed(() => timelineMarkers.value.map(m => ({
  ...m,
  left: (m.at / TICKS_PER_SECOND) * zoom.value - 6
})))

const editingMarkerId = ref<string | null>(null)
const editingMarkerLabel = ref('')
const markerEditorPos = ref({ x: 0, y: 0 })
const markerEditorRef = ref<HTMLElement | null>(null)
const markerLabelInputRef = ref<HTMLInputElement | null>(null)

// Label/color editor opened by dblclicking a pin. It is fixed-positioned
// because the ruler clips overflow; a window mousedown listener commits
// the label and dismisses it when clicking anywhere else (Esc discards).
function openMarkerEditor(marker: { id: string, label?: string }, e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  editingMarkerId.value = marker.id
  editingMarkerLabel.value = marker.label || ''
  markerEditorPos.value = {
    x: Math.min(rect.left, window.innerWidth - 240),
    y: Math.min(rect.bottom + 6, window.innerHeight - 120)
  }
}

function commitMarkerEditor() {
  const id = editingMarkerId.value
  editingMarkerId.value = null
  if (!id) return
  const pin = timelineMarkers.value.find(m => m.id === id)
  if (!pin) return
  const label = editingMarkerLabel.value.trim()
  // Touch history only when the label really changed.
  if (label !== (pin.label || '')) updateMarker(id, { label })
}

function setMarkerColor(color: string) {
  if (editingMarkerId.value) updateMarker(editingMarkerId.value, { color })
}

function deleteMarker() {
  const id = editingMarkerId.value
  editingMarkerId.value = null
  if (id) removeMarkerById(id)
}

function onMarkerEditorOutside(e: MouseEvent) {
  if (markerEditorRef.value && !markerEditorRef.value.contains(e.target as Node)) {
    commitMarkerEditor()
  }
}

watch(editingMarkerId, (id) => {
  if (id) {
    window.addEventListener('mousedown', onMarkerEditorOutside)
    nextTick(() => markerLabelInputRef.value?.focus())
  } else {
    window.removeEventListener('mousedown', onMarkerEditorOutside)
  }
})

// In/Out render zone (export zone) overlay geometry — shown on the ruler
// (flags + tint) and across the track rows (transparent highlight band).
const renderZoneStyle = computed(() => {
  const range = renderRange.value
  if (!range) return null
  return {
    left: `${range.start * zoom.value}px`,
    width: `${Math.max(2, (range.end - range.start) * zoom.value)}px`
  }
})

const markInStyle = computed(() => (
  renderIn.value !== null ? { left: `${renderIn.value * zoom.value}px` } : null
))

const markOutStyle = computed(() => (
  renderOut.value !== null ? { left: `${renderOut.value * zoom.value}px` } : null
))

// --- Minimap overview strip (Roadmap A7) ---
// Fixed bar above the scroll area: clip blocks for the whole project,
// viewport frame and playhead. DOM scrollLeft/width are not reactive,
// so they are mirrored here on scroll/zoom/resize.
const minimapRef = ref<HTMLDivElement | null>(null)
const minimapState = ref({ scrollLeft: 0, width: 0 })

function syncMinimapState() {
  const el = tracksContainerRef.value
  if (!el) return
  minimapState.value = { scrollLeft: el.scrollLeft, width: el.clientWidth }
}

watch([zoom, timelineWidth], async () => {
  await nextTick()
  syncMinimapState()
})

// Clip blocks: every track's items projected onto the bar (content px
// → bar px via visibleWidth / timelineWidth). Duration honors speed so
// blocks match what the timeline rows show.
const minimapClipBlocks = computed(() => {
  const tracks = currentProject.value?.timeline?.tracks || []
  const w = minimapState.value.width
  const denom = timelineWidth.value || 1
  const blocks: Array<{ id: string, left: number, width: number, color: string }> = []
  for (const track of tracks) {
    const color = track.type === 'video'
      ? 'bg-blue-400/50'
      : track.type === 'text'
        ? 'bg-amber-400/50'
        : 'bg-emerald-400/50'
    for (const clip of track.items || []) {
      const dur = clipDurationSec(clip)
      blocks.push({
        id: clip.id,
        left: (clipStartSec(clip) * zoom.value * w) / denom,
        width: Math.max(1, (dur * zoom.value * w) / denom),
        color
      })
    }
  }
  return blocks
})

// Viewport frame: the slice of the content currently visible. Clamped so
// a content narrower than the viewport still renders a full-width frame.
const minimapViewportStyle = computed(() => {
  const w = minimapState.value.width
  const denom = timelineWidth.value || 1
  if (!w) return null
  const left = (minimapState.value.scrollLeft / denom) * w
  const width = Math.max(4, Math.min(w - left, (w * w) / denom))
  return { left: `${left}px`, width: `${width}px` }
})

const minimapPlayheadStyle = computed(() => ({
  left: `${(playhead.value * zoom.value * minimapState.value.width) / (timelineWidth.value || 1)}px`
}))

// Click/drag anywhere on the bar centers the viewport at that position
// (the scroll event then refreshes the frame via syncMinimapState).
function panFromMinimap(e: MouseEvent) {
  const container = tracksContainerRef.value
  const bar = minimapRef.value
  if (!container || !bar) return
  const rect = bar.getBoundingClientRect()
  const ratio = (e.clientX - rect.left) / rect.width
  container.scrollLeft = (ratio * timelineWidth.value) - container.clientWidth / 2
}

function onMinimapMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  panFromMinimap(e)

  function onMouseMove(moveEvent: MouseEvent) {
    panFromMinimap(moveEvent)
  }

  function onMouseUp() {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

// Handle scrubbing on ruler (pauses playback, like other NLEs)
function onRulerMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  pause()
  updatePlayheadFromPointer(e)

  function onMouseMove(moveEvent: MouseEvent) {
    updatePlayheadFromPointer(moveEvent)
  }

  function onMouseUp() {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

function updatePlayheadFromPointer(e: MouseEvent) {
  if (!rulerRef.value) return
  // The ruler lives INSIDE the scroll container, so its
  // viewport rect already includes the horizontal scroll
  // offset. Adding scrollLeft here double-counted it and
  // shifted every scrub by the scroll distance (the
  // "playhead jumps / misaligns after scrolling" bug).
  const rect = rulerRef.value.getBoundingClientRect()
  const clickX = e.clientX - rect.left
  const targetSec = Math.max(0, clickX / zoom.value)
  seek(targetSec)
}

// --- Media card drop (Roadmap A4): HTML5 DnD from the media grid ---
function onMediaDragOver(e: DragEvent) {
  // Only accept our own asset payload so external file drags are ignored.
  if (!e.dataTransfer?.types.includes(TMCUT_ASSET_MIME)) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
}

function onMediaDrop(e: DragEvent) {
  const raw = e.dataTransfer?.getData(TMCUT_ASSET_MIME)
  if (!raw) return
  e.preventDefault()
  let payload: TmcutAssetDragPayload
  try {
    payload = JSON.parse(raw) as TmcutAssetDragPayload
  } catch {
    return
  }
  // Handlers live on the scroll container, not the rows canvas, so a drop
  // in the EMPTY AREA BELOW the last row still lands (R124). The canvas
  // only spans the rows; the container spans the whole viewport.
  const container = e.currentTarget as HTMLElement
  const containerRect = container.getBoundingClientRect()
  // Scroll-space x: the container rect is the fixed viewport, content is
  // shifted by scrollLeft — exact same coordinate the ruler scrub uses.
  const targetSec = Math.max(0, (e.clientX - containerRect.left + container.scrollLeft) / zoom.value)
  const snappedSec = snapTimeSec(targetSec, playhead.value, { thresholdSec: 8 / zoom.value })
  const desiredType = payload.kind === 'audio' ? 'audio' : 'video'
  const tracks = currentProject.value?.timeline?.tracks || []
  // Row hit-test through the DOM, not a 56px guess (row borders drift).
  // Dropping on a row of the wanted type lands THAT track — parallel
  // audio lanes (CapCut-style). The empty area below the last row is an
  // explicit "ADD A ROW" gesture (R124 "kéo file xuống dòng để thêm
  // audio song song"): always create a fresh track of the wanted type;
  // only fall back to the last lane of that type when track creation
  // fails (locked/full state).
  const rowEl = (e.target as HTMLElement)?.closest('[data-track-row]')
  const rowTrackId = rowEl?.getAttribute('data-track-row') || undefined
  const rowTrack = rowTrackId ? tracks.find(tr => tr.id === rowTrackId) : undefined
  if (!rowTrack) {
    const created = addTrackToProject(desiredType)
    const trackId = created
      ? (currentProject.value?.timeline?.tracks || []).slice(-1)[0]?.id
      : [...tracks].reverse().find(tr => tr.type === desiredType)?.id
    addAssetToTimeline(payload.id, { offset: snappedSec, trackId })
    return
  }
  const trackId = rowTrack.type === desiredType ? rowTrack.id : undefined
  addAssetToTimeline(payload.id, { offset: snappedSec, trackId })
}

// Click empty track background to seek (CapCut-style). Clip interactions
// are guarded by [data-tmcut-clip] so drags/trims never trigger a seek.
function onTracksBackgroundMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  const target = e.target as HTMLElement
  if (target.closest('[data-tmcut-clip]')) return
  pause()
  updatePlayheadFromPointer(e)
}

// Split clip action
function handleSplit() {
  if (selectedClipId.value) {
    const success = splitClip(selectedClipId.value, playhead.value)
    if (success) {
      toast.add({ title: t('tmcut.timelineActions.splitClipAtPlayhead'), color: 'success' })
      return
    }
  }

  // Roadmap B6 — razor mode: with nothing selected (or the selected
  // clip out of range), cut EVERY clip under the playhead across all
  // unlocked tracks. Iterate a snapshot because splitClip splices a
  // second piece into the same array — fresh pieces must not split
  // again — and let splitClip's own 0.1s margin guard reject edges.
  let count = 0
  for (const track of currentProject.value?.timeline?.tracks || []) {
    if (track.locked) continue
    for (const clip of [...(track.items || [])]) {
      if (playhead.value > clipStartSec(clip) && playhead.value < clipEndSec(clip)) {
        if (splitClip(clip.id, playhead.value)) count++
      }
    }
  }
  if (count > 0) {
    toast.add({ title: t('tmcut.timelineActions.razorSplitCount', { count }), color: 'success' })
    return
  }

  toast.add({ title: t('tmcut.timelineActions.placePlayheadToSplit'), color: 'warning' })
}

// Alt+[ / Alt+] (roadmap B7): cut the selected clip's In/Out edge to
// the playhead through core trimClip (via the v1↔v3 bridge). One toast
// covers every no-op case: no selection, locked track, or playhead
// outside the clip.
function handleTrimEdge(edge: 'in' | 'out') {
  if (trimSelectedEdgeAt(edge, playhead.value)) {
    toast.add({ title: t('tmcut.timelineActions.trimAtPlayhead'), color: 'success' })
  } else {
    toast.add({ title: t('tmcut.timelineActions.trimNotPossible'), color: 'warning' })
  }
}

// Groups & linked pairs (roadmap B4). Every no-op gets an honest toast:
// the single-clip selection can only group what its relations expand to.
function handleGroup() {
  if (groupSelection()) {
    toast.add({ title: t('tmcut.timelineActions.groupCreated'), color: 'success' })
  } else {
    toast.add({ title: t('tmcut.timelineActions.relationsNone'), color: 'warning' })
  }
}

function handleUngroup() {
  if (ungroupSelection()) {
    toast.add({ title: t('tmcut.timelineActions.ungrouped'), color: 'success' })
  } else {
    toast.add({ title: t('tmcut.timelineActions.relationsNone'), color: 'warning' })
  }
}

function handleLinkToggle() {
  const result = toggleLinkSelection()
  if (result === 'linked') {
    toast.add({ title: t('tmcut.timelineActions.linkCreated'), color: 'success' })
  } else if (result === 'unlinked') {
    toast.add({ title: t('tmcut.timelineActions.linkRemoved'), color: 'success' })
  } else {
    toast.add({ title: t('tmcut.timelineActions.linkNotPossible'), color: 'warning' })
  }
}

// Shift+D quick fade in/out (roadmap K8 / D-1): toggles the default
// 0.5s envelope on the selected media clip; every outcome gets an
// honest toast (nothing selected / a text clip cannot fade).
function handleFadeToggle() {
  const result = toggleFadeSelection()
  if (result === 'applied') {
    toast.add({ title: t('tmcut.timelineActions.fadeApplied'), color: 'success' })
  } else if (result === 'cleared') {
    toast.add({ title: t('tmcut.timelineActions.fadeCleared'), color: 'success' })
  } else {
    toast.add({ title: t('tmcut.timelineActions.fadeNoTarget'), color: 'warning' })
  }
}

// Close gaps (roadmap B9 — core C2): pull every unlocked track together.
function handleCloseGaps() {
  const closedTicks = closeProjectGaps()
  if (closedTicks > 0) {
    toast.add({
      title: t('tmcut.timelineActions.gapsClosed', { seconds: Math.round(ticksToSec(closedTicks) * 10) / 10 }),
      color: 'success'
    })
  } else {
    toast.add({ title: t('tmcut.timelineActions.noGaps'), color: 'warning' })
  }
}

// Track add menu (Roadmap A5): one entry per track type, opened from the
// "+"/TRACKS corner above the track headers.
const addTrackMenuItems = computed(() => [
  [
    { label: t('tmcut.tracks.addVideoTrack'), icon: 'i-lucide-film', onSelect: () => addTrackToProject('video') },
    { label: t('tmcut.tracks.addTextTrack'), icon: 'i-lucide-type', onSelect: () => addTrackToProject('text') },
    { label: t('tmcut.tracks.addAudioTrack'), icon: 'i-lucide-music', onSelect: () => addTrackToProject('audio') }
  ]
])

// Delete clip action (ripple mode closes the gap via the core engine)
function handleDelete() {
  if (!selectedClipId.value) return
  if (rippleMode.value) {
    if (rippleDeleteSelected()) {
      // toast.add({ title: t('tmcut.timelineActions.clipDeleted'), color: 'success' })
    }
    return
  }
  removeClip(selectedClipId.value)
  // toast.add({ title: t('tmcut.timelineActions.clipDeleted'), color: 'success' })
}

// Clipboard actions (core copy/paste/duplicate, merged back by clip id)
function handleCopy() {
  if (copySelectedClips()) {
    toast.add({ title: t('tmcut.timelineActions.copied'), color: 'success' })
  }
}

function handlePaste() {
  const ids = pasteClipboardAt(playhead.value)
  if (ids.length > 0) {
    toast.add({ title: t('tmcut.timelineActions.pasted'), color: 'success' })
  }
}

function handleDuplicate() {
  const ids = duplicateSelectedClips()
  if (ids.length > 0) {
    toast.add({ title: t('tmcut.timelineActions.duplicated'), color: 'success' })
  }
}

// Add local video file
async function handleAddVideo() {
  if (!isDesktop.value) {
    const files = await pickWebFiles(['mp4', 'mov', 'webm', 'mkv', 'avi'], true)
    if (files.length === 0) return
    const imported = await importWebFiles(files)
    for (const asset of imported) {
      if (asset.kind !== 'video') continue
      addClipToTrack('video', {
        name: asset.name,
        src: asset.path,
        in: 0,
        out: asset.meta.durationSec > 0 ? Math.round(secToTicks(asset.meta.durationSec)) : 10 * TICKS_PER_SECOND,
        speed: 1
      })
      toast.add({ title: t('tmcut.timelineActions.videoAdded', { name: asset.name }), color: 'success' })
    }
    return
  }
  const filePath = await pickFile({
    title: t('tmcut.timelineActions.selectVideoToAdd'),
    filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'webm', 'mkv', 'avi'] }]
  })

  if (!filePath || typeof filePath !== 'string') return

  // Probe media metadata using HTML5 Video element
  // (toURL serves the file through the privileged media://local protocol)
  const mediaUrl = toURL(filePath)
  const tempVideo = document.createElement('video')
  tempVideo.src = mediaUrl
  tempVideo.preload = 'metadata'

  tempVideo.onloadedmetadata = () => {
    const dur = tempVideo.duration || 10
    const filename = filePath.split(/[\\/]/).pop() || 'Video'
    addClipToTrack('video', {
      name: filename,
      src: filePath,
      in: 0,
      out: Math.round(secToTicks(dur)),
      speed: 1
    })
    toast.add({ title: t('tmcut.timelineActions.videoAdded', { name: filename }), color: 'success' })
  }

  tempVideo.onerror = () => {
    // Fallback if metadata fails
    const filename = filePath.split(/[\\/]/).pop() || 'Video'
    addClipToTrack('video', {
      name: filename,
      src: filePath,
      in: 0,
      out: 10 * TICKS_PER_SECOND,
      speed: 1
    })
    toast.add({ title: t('tmcut.timelineActions.videoAdded', { name: filename }), color: 'success' })
  }
}

// Add text overlay
function handleAddText() {
  addClipToTrack('text', {
    name: t('tmcut.timelineActions.newText'),
    text: t('tmcut.inspectorProps.textPlaceholder'),
    in: 0,
    out: 4 * TICKS_PER_SECOND,
    offset: Math.round(secToTicks(playhead.value)),
    fontSize: 42,
    color: '#ffffff'
  })
  toast.add({ title: t('tmcut.timelineActions.textAdded'), color: 'success' })
}

// ===== SRT import / export (roadmap C-4, core C11) =====
// Desktop only: both flows need the Electron dialog + file IPC, so the
// dropdown never renders on web sessions (no dead control). Cue times
// are absolute timeline seconds; text clips carry duration in in/out.
async function handleImportSrt() {
  const path = await pickFile({
    title: t('tmcut.timelineActions.srtImport'),
    filters: [{ name: 'SRT', extensions: ['srt'] }]
  })
  if (!path || typeof path !== 'string') return
  try {
    const content = await readText(path)
    const cues = parseSrt(content)
    if (cues.length === 0) {
      toast.add({ title: t('tmcut.timelineActions.srtEmpty'), color: 'warning' })
      return
    }
    for (const cue of cues) {
      addClipToTrack('text', {
        name: cue.text.replace(/\s+/g, ' ').trim().slice(0, 24),
        text: cue.text,
        in: 0,
        out: Math.max(TICKS_PER_SECOND / 10, Math.round(secToTicks(cue.end - cue.start))),
        offset: Math.max(0, Math.round(secToTicks(cue.start))),
        fontSize: 42,
        color: '#ffffff'
      })
    }
    toast.add({ title: t('tmcut.timelineActions.srtImported', { n: cues.length }), color: 'success' })
  } catch (error) {
    console.error('SRT import failed:', error)
    toast.add({ title: t('tmcut.timelineActions.srtFailed'), color: 'error' })
  }
}

async function handleExportSrt() {
  const textItems = currentProject.value?.timeline?.tracks.find(tr => tr.type === 'text')?.items || []
  const cues = textItems
    .filter(item => (item.text || '').trim().length > 0)
    .map(item => ({
      text: item.text || '',
      start: clipStartSec(item),
      end: clipEndSec(item)
    }))
    .filter(cue => cue.end > cue.start)
    .sort((a, b) => a.start - b.start)
  if (cues.length === 0) {
    toast.add({ title: t('tmcut.timelineActions.srtNoText'), color: 'warning' })
    return
  }
  const path = await selectSaveFile({
    title: t('tmcut.timelineActions.srtExport'),
    defaultPath: 'subtitles.srt',
    filters: [{ name: 'SRT', extensions: ['srt'] }]
  })
  if (!path) return
  try {
    await writeText({ filePath: path, data: serializeSrt(cues) })
    toast.add({ title: t('tmcut.timelineActions.srtExported', { n: cues.length }), description: path, color: 'success' })
  } catch (error) {
    console.error('SRT export failed:', error)
    toast.add({ title: t('tmcut.timelineActions.srtFailed'), color: 'error' })
  }
}

const srtMenuItems = computed(() => [
  { label: t('tmcut.timelineActions.srtImport'), icon: 'i-lucide-upload', onSelect: () => void handleImportSrt() },
  { label: t('tmcut.timelineActions.srtExport'), icon: 'i-lucide-download', onSelect: () => void handleExportSrt() }
])

// ===== Auto-captions (roadmap C-3, core C11) =====
// Desktop only: audio extraction (FFmpeg) and Whisper (AI gateway) both
// live in main-process IPC. Captions the video clip under the playhead,
// anchored to that clip's timeline position and clamped to its range —
// cues outside the clip never leak onto other clips' time.
const captionBusy = ref(false)

async function handleAutoCaptions() {
  if (captionBusy.value || !isDesktop.value) return
  const tracks = currentProject.value?.timeline?.tracks || []
  const clip = tracks
    .filter(track => track.type === 'video' && !track.hidden)
    .flatMap(track => track.items || [])
    .find(item => item.src
      && playhead.value >= clipStartSec(item)
      && playhead.value < clipEndSec(item))
  if (!clip?.src) {
    toast.add({ title: t('tmcut.timelineActions.captionNoClip'), color: 'warning' })
    return
  }
  captionBusy.value = true
  try {
    const audio = await window.electronAPI?.tmcut.extractAudio({ filePath: clip.src })
    if (!audio?.ok || !audio.path) throw new Error(audio?.error || 'Audio extraction failed')
    const data = await transcribe(audio.path, { format: 'verbose_json' })
    const cues = (data.segments || [])
      .map(segment => ({
        text: String(segment.text || '').trim(),
        start: Number(segment.start) || 0,
        end: Number(segment.end) || 0
      }))
      .filter(cue => cue.text.length > 0 && cue.end > cue.start)
    if (cues.length === 0) {
      toast.add({ title: t('tmcut.timelineActions.captionEmpty'), color: 'warning' })
      return
    }
    // Core works in TICKS — like the store now (C16-R3): the clip's
    // offset/duration read as ticks directly, and the caption items
    // handed to addClipToTrack carry ticks too. Cue times are relative
    // to the clip, so fromTicks anchors at the clip start.
    const fromTicks = clipStartTicks(clip)
    const durationTicks = clipDurationTicks(clip)
    const captions = cuesToCaptionClips(cues, {
      fromTicks,
      rangeTicks: { start: fromTicks, end: fromTicks + durationTicks }
    })
    for (const caption of captions) {
      addClipToTrack('text', {
        name: caption.text.slice(0, 24),
        text: caption.text,
        in: 0,
        out: Math.max(TICKS_PER_SECOND / 10, caption.out),
        offset: caption.offset,
        fontSize: 42,
        color: '#ffffff'
      })
    }
    toast.add({ title: t('tmcut.timelineActions.captionCreated', { n: captions.length }), color: 'success' })
  } catch (error) {
    console.error('Auto-captions failed:', error)
    toast.add({
      title: t('tmcut.timelineActions.captionFailed'),
      description: String((error as Error)?.message || error),
      color: 'error'
    })
  } finally {
    captionBusy.value = false
  }
}

// Add audio file
async function handleAddAudio() {
  if (!isDesktop.value) {
    const files = await pickWebFiles(['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg'], true)
    if (files.length === 0) return
    const imported = await importWebFiles(files)
    for (const asset of imported) {
      if (asset.kind !== 'audio') continue
      addClipToTrack('audio', {
        name: asset.name,
        src: asset.path,
        in: 0,
        out: asset.meta.durationSec > 0 ? Math.round(secToTicks(asset.meta.durationSec)) : 15 * TICKS_PER_SECOND,
        volume: 100
      })
      toast.add({ title: t('tmcut.timelineActions.audioAdded', { name: asset.name }), color: 'success' })
    }
    return
  }
  const filePath = await pickFile({
    title: t('tmcut.timelineActions.selectAudio'),
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg'] }]
  })

  if (!filePath || typeof filePath !== 'string') return

  const mediaUrl = toURL(filePath)
  const tempAudio = new Audio(mediaUrl)

  tempAudio.onloadedmetadata = () => {
    const dur = tempAudio.duration || 15
    const filename = filePath.split(/[\\/]/).pop() || 'Audio'
    addClipToTrack('audio', {
      name: filename,
      src: filePath,
      in: 0,
      out: Math.round(secToTicks(dur)),
      volume: 100
    })
    toast.add({ title: t('tmcut.timelineActions.audioAdded', { name: filename }), color: 'success' })
  }

  tempAudio.onerror = () => {
    const filename = filePath.split(/[\\/]/).pop() || 'Audio'
    addClipToTrack('audio', {
      name: filename,
      src: filePath,
      in: 0,
      out: 15 * TICKS_PER_SECOND,
      volume: 100
    })
    toast.add({ title: t('tmcut.timelineActions.audioAdded', { name: filename }), color: 'success' })
  }
}

// Synchronize scrolling between panels: the canvas is the master axes
// pair; the headers column mirrors vertical scroll (R124), and the ruler
// stays pinned via position:sticky.
const trackHeadersRef = ref<HTMLDivElement | null>(null)

function onTracksScroll(e: Event) {
  const target = e.target as HTMLElement
  if (rulerRef.value) {
    rulerRef.value.scrollLeft = target.scrollLeft
  }
  if (trackHeadersRef.value) {
    trackHeadersRef.value.scrollTop = target.scrollTop
  }
  syncMinimapState()
}

// Global shortcuts (timeline scope):
// Ctrl/Cmd+Z/Y undo-redo, Ctrl/Cmd+C/V/D clipboard, Ctrl/Cmd+S save,
// Ctrl/Cmd+E export, Ctrl/Cmd+K help, Ctrl/Cmd+G group, Ctrl/Cmd+L link,
// S split (razor when nothing is selected), Delete/Backspace remove,
// R ripple toggle, N snap toggle, M add marker, I/O render marks,
// Alt+[/] trim edge to playhead, ?/F1 shortcuts help (§65.1).
const emit = defineEmits<{
  (e: 'open-export' | 'open-voice-studio'): void
}>()

// Shared help overlay state (useTmcutUiPrefs.shortcutsOpen) — also opened
// from the editor header button, so one instance is used everywhere.

function handleGlobalKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
    return
  }
  const key = e.key.toLowerCase()
  if (e.ctrlKey || e.metaKey) {
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault()
      undo()
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault()
      redo()
    } else if (key === 'c') {
      e.preventDefault()
      handleCopy()
    } else if (key === 'v') {
      e.preventDefault()
      handlePaste()
    } else if (key === 'd') {
      e.preventDefault()
      handleDuplicate()
    } else if (key === 's') {
      e.preventDefault()
      flushDiskSave()
    } else if (key === 'e') {
      e.preventDefault()
      emit('open-export')
    } else if (key === 'k') {
      // Ctrl+K opens the help; the modal focuses its own search field
      e.preventDefault()
      shortcutsOpen.value = true
    } else if (key === 'g') {
      // Ctrl+G groups / Ctrl+Shift+G ungroups the expanded selection (B4)
      e.preventDefault()
      if (e.shiftKey) handleUngroup()
      else handleGroup()
    } else if (key === 'l') {
      // Ctrl+L links / Ctrl+Shift+L unlinks overlapping clips (B4)
      e.preventDefault()
      handleLinkToggle()
    } else if (key === '=' || key === '+' || key === 'add') {
      // Ctrl+= (also Ctrl++ / numpad +) zooms in, Ctrl+-/-Subtract zooms
      // out — keyboard twin of the Ctrl+wheel step (roadmap K6).
      // preventDefault keeps Chromium from page-zooming the window.
      e.preventDefault()
      stepZoomKeyboard(1)
    } else if (key === '-' || key === 'subtract') {
      e.preventDefault()
      stepZoomKeyboard(-1)
    }
    return
  }
  // While the help overlay is open only ?/F1 stay active (toggle to close),
  // so editing keys cannot fire behind the modal.
  if (shortcutsOpen.value) {
    if (key === '?' || key === 'f1') {
      e.preventDefault()
      shortcutsOpen.value = false
    }
    return
  }
  if (key === 's') {
    handleSplit()
  } else if (key === 'delete' || key === 'backspace') {
    e.preventDefault()
    handleDelete()
  } else if (key === 'r') {
    // R toggles ripple editing (the toolbar button shows the state)
    rippleMode.value = !rippleMode.value
  } else if (key === 'n') {
    // N toggles magnetic snap (the Magnet toolbar button shows the state)
    snapOn.value = !snapOn.value
  } else if (key === 'm') {
    // M drops a ruler marker at the playhead (roadmap B5)
    addMarkerAt(playhead.value)
  } else if (key === 'i') {
    setRenderMark('in')
  } else if (key === 'o') {
    setRenderMark('out')
  } else if (key === 'd' && e.shiftKey) {
    // Shift+D toggles the default fade in/out on the selected clip
    // (roadmap K8 / D-1 — plain Ctrl+D stays duplicate above)
    handleFadeToggle()
  } else if (key === 'home') {
    // Jump to the start / end of content (roadmap K7)
    e.preventDefault()
    seek(0)
    scrollPlayheadIntoView()
  } else if (key === 'end') {
    e.preventDefault()
    seek(contentDuration.value)
    scrollPlayheadIntoView()
  } else if (e.altKey && (key === '[' || key === ']')) {
    // Alt+[ / Alt+] cut the selected clip's In/Out edge to the
    // playhead (roadmap B7)
    handleTrimEdge(key === '[' ? 'in' : 'out')
  } else if (key === '?' || key === 'f1') {
    e.preventDefault()
    shortcutsOpen.value = true
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown)
  window.addEventListener('resize', syncMinimapState)
  syncTracksViewportWidth()
  syncMinimapState()
  // The panel width changes without a window resize (sidebar collapse,
  // docked layouts, window maximize) — track the viewport so the canvas
  // floor follows and the scrollbar can never span dead space.
  if (tracksContainerRef.value) {
    viewportWidthObserver = new ResizeObserver(() => {
      syncTracksViewportWidth()
      syncMinimapState()
    })
    viewportWidthObserver.observe(tracksContainerRef.value)
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('resize', syncMinimapState)
  viewportWidthObserver?.disconnect()
  viewportWidthObserver = null
  // A marker editor left open would otherwise keep its outside-click
  // listener alive after the timeline unmounts.
  window.removeEventListener('mousedown', onMarkerEditorOutside)
})
</script>

<template>
  <div
    class="h-full flex flex-col bg-neutral-100 dark:bg-neutral-900 border-t border-neutral-300 dark:border-neutral-800 text-neutral-700 dark:text-neutral-200 select-none">
    <!-- Timeline Toolbar -->
    <div
      class="min-h-10 px-3 py-1 gap-2 border-b border-neutral-300 dark:border-neutral-800 flex flex-wrap items-center justify-between bg-neutral-100/90 dark:bg-neutral-900/90 shrink-0">
      <!-- Left: History + Tools (Undo, Redo, Split, Delete, Add Media) -->
      <div class="flex items-center gap-1.5 max-w-full overflow-x-auto whitespace-nowrap *:shrink-0">
        <UButton icon="i-lucide-undo-2" size="xs" variant="ghost" color="neutral" :disabled="!canUndo"
          :title="tip(t('tmcut.timelineActions.undo'), 'Ctrl+Z')" @click="undo" />
        <UButton icon="i-lucide-redo-2" size="xs" variant="ghost" color="neutral" :disabled="!canRedo"
          :title="tip(t('tmcut.timelineActions.redo'), 'Ctrl+Shift+Z')" @click="redo" />

        <div class="h-4 w-px bg-neutral-200 dark:bg-neutral-800 mx-1" />

        <UButton icon="i-lucide-scissors" size="xs" variant="soft" color="neutral"
          :title="tip(t('tmcut.timelineActions.split'), 'S')" @click="handleSplit">
          {{ t('tmcut.timelineActions.split') }}
        </UButton>
        <UButton icon="i-lucide-trash" size="xs" variant="soft" color="error" :disabled="!selectedClipId"
          :title="tip(t('tmcut.timelineActions.delete'), 'Del')" @click="handleDelete">
          {{ t('tmcut.timelineActions.delete') }}
        </UButton>
        <UButton icon="i-lucide-copy" size="xs" variant="soft" color="neutral" :disabled="!selectedClipId"
          :title="tip(t('tmcut.timelineActions.duplicate'), 'Ctrl+D')" @click="handleDuplicate" />
        <UButton icon="i-lucide-clipboard-paste" size="xs" variant="soft" color="neutral" :disabled="!clipboard"
          :title="tip(t('tmcut.timelineActions.paste'), 'Ctrl+V')" @click="handlePaste" />
        <UButton icon="i-lucide-fold-horizontal" size="xs" :variant="rippleMode ? 'solid' : 'soft'"
          :color="rippleMode ? 'primary' : 'neutral'" :title="tip(t('tmcut.timelineActions.ripple'), 'R')"
          @click="rippleMode = !rippleMode" />
        <UButton icon="i-lucide-magnet" size="xs" :variant="snapOn ? 'solid' : 'soft'"
          :color="snapOn ? 'primary' : 'neutral'" :title="tip(t('tmcut.timelineActions.magnet'), 'N')"
          @click="snapOn = !snapOn" />
        <UButton icon="i-lucide-chevrons-left" size="xs" variant="soft" color="neutral"
          :title="t('tmcut.timelineActions.closeGaps')" @click="handleCloseGaps" />

        <div class="h-4 w-px bg-neutral-200 dark:bg-neutral-800 mx-1" />

        <UButton icon="i-lucide-plus" size="xs" variant="soft" color="primary" @click="handleAddVideo">
          + {{ t('tmcut.addVideo') }}
        </UButton>
        <UButton icon="i-lucide-type" size="xs" variant="soft" color="primary" @click="handleAddText">
          + {{ t('tmcut.addText') }}
        </UButton>
        <UButton icon="i-lucide-music" size="xs" variant="soft" color="primary" @click="handleAddAudio">
          + {{ t('tmcut.addAudio') }}
        </UButton>
        <UButton icon="i-lucide-audio-lines" size="xs" variant="soft" color="secondary"
          :title="t('tmcut.voice.openStudio')" @click="emit('open-voice-studio')">
          {{ t('tmcut.voice.openStudio') }}
        </UButton>

        <!-- SRT import/export (roadmap C-4): desktop only — the dialog
             + file IPC do not exist on web sessions. -->
        <UDropdownMenu v-if="isDesktop" :items="srtMenuItems" :content="{ align: 'start' }">
          <UButton icon="i-lucide-captions" size="xs" variant="soft" color="neutral"
            :title="t('tmcut.timelineActions.srtMenu')">
            SRT
          </UButton>
        </UDropdownMenu>

        <!-- Auto-captions (roadmap C-3): desktop only — FFmpeg audio
             extraction + Whisper both live in main-process IPC. -->
        <UButton v-if="isDesktop" icon="i-lucide-sparkles" size="xs" variant="soft" color="neutral"
          :loading="captionBusy" :disabled="captionBusy" :title="t('tmcut.timelineActions.captionCreate')"
          @click="handleAutoCaptions">
          {{ t('tmcut.timelineActions.captionShort') }}
        </UButton>
      </div>

      <!-- Center: Timecode Info -->
      <div
        class="font-mono text-xs flex items-center gap-1 bg-neutral-100 dark:bg-neutral-950 px-2.5 py-0.5 rounded border border-neutral-300 dark:border-neutral-800">
        <span class="text-primary font-semibold">{{ formatTimecode(playhead) }}</span>
        <span class="text-neutral-500">/</span>
        <span class="text-neutral-500 dark:text-neutral-400">{{ formatTimecode(contentDuration) }}</span>
      </div>

      <!-- In/Out render zone chip (clears on click) -->
      <div v-if="renderIn !== null || renderOut !== null"
        class="font-mono text-[10px] flex items-center gap-1.5 bg-primary/10 px-2 py-0.5 rounded border border-primary/30 text-primary select-none"
        :title="t('tmcut.timelineActions.clearMarks')" @click="clearRenderMarks()">
        <span>I {{ renderIn !== null ? formatTimecode(renderIn) : '--:--' }}</span>
        <span class="opacity-50">→</span>
        <span>O {{ renderOut !== null ? formatTimecode(renderOut) : '--:--' }}</span>
        <UIcon name="i-lucide-x" class="size-3 hover:text-red-400 cursor-pointer" />
      </div>

      <!-- Right: Shortcuts help + Timeline Zoom Slider -->
      <div class="flex items-center gap-2">
        <UButton icon="i-lucide-keyboard" size="xs" variant="ghost" color="neutral"
          :title="tip(t('tmcut.hotkeys.title'), '?, F1')" @click="shortcutsOpen = true" />
        <UIcon name="i-lucide-zoom-out" class="size-3.5 text-neutral-500" />
        <input id="tmcut-timeline-zoom" v-model.number="zoom" :aria-label="t('tmcut.timelineActions.zoom')" type="range"
          min="15" max="200" step="5" class="w-24 accent-primary cursor-pointer"
          :title="t('tmcut.timelineActions.zoom')">
        <UIcon name="i-lucide-zoom-in" class="size-3.5 text-neutral-500" />
        <span class="text-[10px] font-mono text-neutral-500 dark:text-neutral-400 w-11 text-right">{{ zoom }}px</span>
        <UButton icon="i-lucide-maximize-2" size="xs" variant="ghost" color="neutral"
          :title="t('tmcut.timelineActions.zoomFit')" @click="zoomToFit" />
      </div>
    </div>

    <!-- R124 A2: keyframe animation lane for the selected clip (CapCut
         §5.5). A separate full-width band between the toolbar and the
         track rows — expanding a track row would desync the header/canvas
         scroll pairing (R124 alignment), so the curve gets its own strip.
         Renders even with no selection (empty-state hint). -->
    <TmcutKeyframeLane />

    <!-- Timeline Workspace -->
    <div class="flex-1 flex overflow-hidden relative">
      <!-- Fixed Left Track Headers (w-44) -->
      <div
        class="w-44 border-r border-neutral-300 dark:border-neutral-800 bg-neutral-100/80 dark:bg-neutral-950/80 flex flex-col shrink-0 z-20">
        <!-- Spacer aligned with the minimap strip on the right, so the
             TRACKS corner keeps matching the ruler height -->
        <div class="h-4 mt-1 mx-1 shrink-0" />

        <!-- Ruler Corner (+ opens the add-track menu) -->
        <div
          class="h-6 border-b border-neutral-300 dark:border-neutral-800 flex items-center justify-between px-2 text-[10px] font-mono text-neutral-500">
          <span>TRACKS</span>
          <UDropdownMenu :items="addTrackMenuItems" :content="{ align: 'end' }">
            <UButton icon="i-lucide-plus" size="xs" variant="ghost" color="neutral"
              :title="t('tmcut.tracks.addTrack')" />
          </UDropdownMenu>
        </div>

        <!-- Track Labels with eye / lock / mute (CapCut-style).
             overflow-y-hidden: kept visually clipped; every row is
             synced with the canvas wheel-scroll handler instead (R124),
             because overflow-y:auto here showed its own scrollbar that
             did not move the canvas rows.
             overflow-x-hidden too: overflow-y:hidden alone makes the
             browser COMPUTE overflow-x as auto, so the audio row (Vol/Pan)
             used to raise a horizontal scrollbar on the header column —
             dragging it scrolled the labels into blank space ("kéo không
             hiển thị được gì"). The row layout now fits 176px, and the
             axis stays closed as a guarantee. -->
        <div ref="trackHeadersRef" data-tmcut-track-headers
          class="flex-1 flex flex-col divide-y divide-neutral-200/60 dark:divide-neutral-800/60 overflow-y-hidden overflow-x-hidden">
          <!-- No 24px spacer here (was the R124 misalignment bug): the
               TRACKS corner above this box is the cover band and already
               sits flush with the canvas ruler (both 763..787), so the
               header rows must start at the same y as the canvas track
               rows (both 787). An extra in-box spacer pushed every header
               row 24px below its clip. Rows scroll up out of this
               overflow-hidden box under the opaque TRACKS corner, exactly
               as canvas rows scroll under the sticky ruler. -->
          <div v-for="track in currentProject?.timeline?.tracks || []" :key="track.id"
            class="h-14 shrink-0 px-2 flex flex-col justify-center gap-0.5 text-xs font-medium text-neutral-600 dark:text-neutral-300">
            <div class="flex items-center justify-between gap-1 min-w-0">
              <div class="flex items-center gap-1.5 truncate min-w-0">
                <UIcon
                  :name="track.type === 'video' ? 'i-lucide-film' : track.type === 'text' ? 'i-lucide-type' : 'i-lucide-music'"
                  class="size-4 shrink-0"
                  :class="track.type === 'video' ? 'text-blue-400' : track.type === 'text' ? 'text-amber-400' : 'text-emerald-400'" />
                <span class="truncate">{{ track.name || track.type }}</span>
              </div>
              <div class="flex items-center shrink-0">
                <!-- Stacking order (layer groundwork, R122): the preview
                     takes the TOPMOST video track, so "up" = render above.
                     A dropdown instead of two buttons keeps the 176px
                     header row from overflowing. -->
                <UDropdownMenu :items="[[
                  { label: t('tmcut.tracks.moveUp'), icon: 'i-lucide-arrow-up-to-line', onSelect: () => moveTrackInProject(track.id, 'up') },
                  { label: t('tmcut.tracks.moveDown'), icon: 'i-lucide-arrow-down-to-line', onSelect: () => moveTrackInProject(track.id, 'down') }
                ]]" :content="{ align: 'end' }">
                  <UButton icon="i-lucide-layers" size="xs" variant="ghost" color="neutral"
                    :title="t('tmcut.tracks.order')" />
                </UDropdownMenu>
                <UButton :icon="track.hidden ? 'i-lucide-eye-off' : 'i-lucide-eye'" size="xs" variant="ghost"
                  :color="track.hidden ? 'warning' : 'neutral'"
                  :title="track.hidden ? t('tmcut.tracks.show') : t('tmcut.tracks.hide')"
                  @click="toggleTrackHidden(track.id)" />
                <UButton :icon="track.locked ? 'i-lucide-lock' : 'i-lucide-lock-open'" size="xs" variant="ghost"
                  :color="track.locked ? 'warning' : 'neutral'"
                  :title="track.locked ? t('tmcut.tracks.unlock') : t('tmcut.tracks.lock')"
                  @click="toggleTrackLock(track.id)" />
                <UButton v-if="track.type !== 'text'" :icon="track.muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'"
                  size="xs" variant="ghost" :color="track.muted ? 'warning' : 'neutral'"
                  :title="track.muted ? t('tmcut.tracks.unmute') : t('tmcut.tracks.mute')"
                  @click="toggleTrackMute(track.id)" />
                <UButton icon="i-lucide-trash-2" size="xs" variant="ghost" color="neutral" :disabled="track.locked"
                  :title="t('tmcut.tracks.removeTrack')" @click="removeTrackFromProject(track.id)" />
              </div>
            </div>
            <!-- R124 A1 → refit: track-level volume/pan for audio tracks
                 (CapCut §5.3) moved to its own compact second line. It sat
                 INLINE before, overflowing the 176px header column and
                 raising the phantom horizontal scrollbar (Vol+Pan+inputs
                 ≈ 300px in 176px). Now: labels + two grow-to-fit number
                 inputs, always inside the row width. -->
            <div v-if="track.type === 'audio'" class="flex items-center gap-1.5 min-w-0">
              <label :for="`track-volume-${track.id}`"
                class="text-[9px] text-neutral-500 dark:text-neutral-400 shrink-0"
                :title="t('tmcut.tracks.volume')">Vol</label>
              <UInput :id="`track-volume-${track.id}`" :aria-label="t('tmcut.tracks.volume')" type="number" min="0"
                max="100" step="5" size="xs" class="flex-1 min-w-0" :model-value="track.volume ?? 100"
                @update:model-value="updateTrackVolume(track.id, Number($event))" />
              <label :for="`track-pan-${track.id}`" class="text-[9px] text-neutral-500 dark:text-neutral-400 shrink-0"
                :title="t('tmcut.tracks.pan')">Pan</label>
              <UInput :id="`track-pan-${track.id}`" :aria-label="t('tmcut.tracks.pan')" type="number" min="-100"
                max="100" step="5" size="xs" class="flex-1 min-w-0" :model-value="track.pan ?? 0"
                @update:model-value="updateTrackPan(track.id, Number($event))" />
            </div>
          </div>

          <!-- Trailing 24px spacer (NOT a leading one): the canvas column
               carries an extra 24px ruler above its rows, so its vertical
               scroll range is 24px taller than a rows-only header column.
               Mirroring container.scrollTop onto this box then clamps
               24px early and the last rows drift. This tail keeps the two
               scroll ranges equal (rows + 24 ≥ ruler + rows) and renders
               as the same blank strip the canvas shows below its last row. -->
          <div class="h-6 shrink-0" aria-hidden="true" />
        </div>
      </div>

      <!-- Right column: fixed minimap strip + scrollable tracks -->
      <div class="flex-1 flex flex-col overflow-hidden min-w-0">
        <!-- Minimap overview (Roadmap A7): clip blocks for the whole
             project + viewport frame + playhead; click/drag pans the
             scroll viewport -->
        <div ref="minimapRef"
          class="h-4 mt-1 mx-1 shrink-0 relative rounded-sm bg-neutral-100 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-800 overflow-hidden cursor-ew-resize"
          :title="t('tmcut.timelineActions.minimap')" @mousedown="onMinimapMouseDown">
          <div v-for="block in minimapClipBlocks" :key="block.id" class="absolute top-0 bottom-0 opacity-70"
            :class="block.color" :style="{ left: `${block.left}px`, width: `${block.width}px` }" />
          <div v-if="minimapViewportStyle"
            class="absolute top-0 bottom-0 border-x border-primary/70 bg-primary/15 pointer-events-none"
            :style="minimapViewportStyle" />
          <div class="absolute top-0 bottom-0 w-px bg-primary pointer-events-none" :style="minimapPlayheadStyle" />
        </div>

        <!-- Scrollable Tracks & Ruler Area. Vertical overflow scrolls too
             (R124): more than ~3 tracks used to be simply unreachable.
             The headers column follows via onTracksScroll. -->
        <div ref="tracksContainerRef" data-tmcut-tracks-container
          class="flex-1 flex flex-col overflow-x-auto overflow-y-auto relative select-none" @scroll="onTracksScroll"
          @wheel="onTracksWheel" @dragover="onMediaDragOver" @drop="onMediaDrop">
          <!-- Time Ruler Bar (sticky top so vertical track scrolling (R124)
               never loses the time labels; rows scroll beneath it) -->
          <div ref="rulerRef" data-tmcut-ruler
            class="h-6 sticky top-0 z-10 border-b border-neutral-300 dark:border-neutral-800 bg-neutral-100/60 dark:bg-neutral-950/60 cursor-pointer overflow-hidden shrink-0"
            :style="{ width: `${timelineWidth}px` }" @mousedown="onRulerMouseDown">
            <!-- Ruler Ticks -->
            <div v-for="tick in rulerTicks" :key="tick.sec" class="absolute top-0 bottom-0 flex flex-col justify-end"
              :style="{ left: `${tick.left}px` }">
              <div class="w-px bg-neutral-300 dark:bg-neutral-700"
                :class="tick.isMajor ? 'h-3.5 bg-neutral-500' : 'h-2'" />
              <span v-if="tick.isMajor"
                class="absolute -top-0.5 left-1 text-[9px] font-mono text-neutral-500 select-none pointer-events-none">
                {{ tick.label }}
              </span>
            </div>

            <!-- In/Out render zone tint + edge flags on the ruler -->
            <div v-if="renderZoneStyle"
              class="absolute top-0 bottom-0 bg-primary/10 border-x border-primary/50 pointer-events-none"
              :style="renderZoneStyle" />
            <div v-if="markInStyle" class="absolute top-0 bottom-0 w-0.5 bg-primary/80 pointer-events-none"
              :style="markInStyle">
              <span class="absolute top-0 left-1 text-[9px] font-mono font-bold text-primary leading-none">I</span>
            </div>
            <div v-if="markOutStyle" class="absolute top-0 bottom-0 w-0.5 bg-primary/80 pointer-events-none"
              :style="markOutStyle">
              <span class="absolute top-0 left-1 text-[9px] font-mono font-bold text-primary leading-none">O</span>
            </div>

            <!-- Ruler markers (roadmap B5): the pin keeps bubbling its
                 mousedown to the ruler (click seeks), while dblclick
                 stops here and opens the label/color editor. -->
            <div v-for="pin in markerPins" :key="pin.id" class="absolute top-0 bottom-0 w-3 cursor-pointer"
              :style="{ left: `${pin.left}px` }" :title="pin.label || undefined"
              @dblclick.stop="openMarkerEditor(pin, $event)">
              <div class="absolute left-[5px] top-0 h-full w-0.5" :style="{ background: pin.color || '#3b82f6' }" />
              <div class="absolute left-[4px] top-0 h-2 w-2 rotate-45"
                :style="{ background: pin.color || '#3b82f6' }" />
              <span v-if="pin.label"
                class="absolute top-0.5 left-[9px] max-w-24 truncate rounded bg-neutral-200/90 dark:bg-neutral-800/90 px-1 py-0.5 text-[8px] leading-none text-neutral-600 dark:text-neutral-300">
                {{ pin.label }}
              </span>
            </div>
          </div>

          <!-- Tracks Canvas -->
          <div class="flex-1 flex flex-col divide-y divide-neutral-200/60 dark:divide-neutral-800/60 relative"
            :style="{ width: `${timelineWidth}px` }" @mousedown="onTracksBackgroundMouseDown">
            <!-- Vertical playhead line (primary accent, design #2) -->
            <div class="absolute top-0 bottom-0 w-0.5 bg-primary z-30 pointer-events-none"
              :style="{ left: `${playheadLeft}px` }">
              <!-- Top Playhead Needle Head -->
              <div class="absolute -top-6 -translate-x-1/2 w-3 h-3 bg-primary rotate-45 rounded-xs" />
            </div>

            <!-- Background Time Grid Lines -->
            <div v-for="tick in rulerTicks" v-show="tick.isMajor" :key="'grid-' + tick.sec"
              class="absolute top-0 bottom-0 w-px bg-neutral-200/30 dark:bg-neutral-800/30 pointer-events-none"
              :style="{ left: `${tick.left}px` }" />

            <!-- Track Rows (right-click the empty lane for the track menu;
                 the clips stopPropagation, so this only fires off-clip) -->
            <div v-for="track in currentProject?.timeline?.tracks || []" :key="track.id" :data-track-row="track.id"
              class="h-14 relative bg-neutral-100/40 dark:bg-neutral-900/40 hover:bg-neutral-200/20 dark:hover:bg-neutral-800/20 transition-colors"
              :class="track.hidden ? 'opacity-40' : ''" @contextmenu.prevent="onTrackContextMenu($event, track)">
              <!-- Clips inside track -->
              <TmcutTimelineClip v-for="clip in track.items" :key="clip.id" :track-type="track.type" :clip="clip"
                :locked="!!track.locked" />
            </div>

            <!-- In/Out render zone band across tracks (export zone) -->
            <div v-if="renderZoneStyle"
              class="absolute top-0 bottom-0 bg-primary/5 border-x-2 border-primary/40 z-20 pointer-events-none"
              :style="renderZoneStyle" />
          </div>
        </div>
      </div>
    </div>

    <!-- Right-click track menu (empty lane area): whole-row actions with the
         same measured placement as the clip menu. -->
    <Teleport to="body">
      <div v-if="trackMenuOpen && trackMenuTarget" ref="trackMenuEl" data-tmcut-track-menu
        class="fixed z-[120] w-56 max-h-[calc(100vh-16px)] overflow-y-auto rounded-lg border border-neutral-400 bg-neutral-100/95 p-1.5 text-xs text-neutral-700 shadow-2xl backdrop-blur-sm select-none dark:border-neutral-700 dark:bg-neutral-900/95 dark:text-neutral-200"
        :class="trackMenuReady ? 'opacity-100' : 'opacity-0'"
        :style="{ left: `${trackMenuPos.x}px`, top: `${trackMenuPos.y}px` }" @contextmenu.prevent>
        <div class="flex items-center justify-between gap-2 px-1.5 pb-1">
          <span class="flex min-w-0 items-center gap-1.5">
            <UIcon
              :name="trackMenuTarget.type === 'video' ? 'i-lucide-film' : trackMenuTarget.type === 'text' ? 'i-lucide-type' : 'i-lucide-music'"
              class="size-3.5 shrink-0 opacity-80" />
            <span class="truncate text-[11px] font-semibold">{{ trackMenuTarget.name || trackMenuTarget.type }}</span>
          </span>
          <span class="shrink-0 font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
            {{ t('tmcut.workspace.clipCount', { count: trackMenuTarget.items.length }) }}
          </span>
        </div>

        <div class="flex flex-col gap-0.5">
          <UButton icon="i-lucide-clipboard-paste" variant="ghost" color="neutral" size="xs" block
            class="justify-start gap-2" :disabled="!!trackMenuTarget.locked || !canPasteOnTrack"
            data-track-menu-action="paste" @click="runTrackPaste">
            {{ t('tmcut.clipMenu.actions.paste') }}
            <span class="ml-auto font-mono text-[10px] text-neutral-500">Ctrl+V</span>
          </UButton>
          <UButton icon="i-lucide-chevrons-left" variant="ghost" color="neutral" size="xs" block
            class="justify-start gap-2" data-track-menu-action="close-gaps" @click="runTrackCloseGaps">
            {{ t('tmcut.clipMenu.actions.closeGapsAll') }}
          </UButton>
        </div>

        <div class="mt-1 flex flex-col gap-0.5 border-t border-neutral-300/80 pt-1 dark:border-neutral-700/80">
          <UButton :icon="trackMenuTarget.locked ? 'i-lucide-lock-open' : 'i-lucide-lock'" variant="ghost"
            color="neutral" size="xs" block class="justify-start gap-2" data-track-menu-action="toggle-lock"
            @click="runTrackToggle('locked')">
            {{ trackMenuTarget.locked ? t('tmcut.tracks.unlock') : t('tmcut.tracks.lock') }}
          </UButton>
          <UButton :icon="trackMenuTarget.hidden ? 'i-lucide-eye-off' : 'i-lucide-eye'" variant="ghost" color="neutral"
            size="xs" block class="justify-start gap-2" data-track-menu-action="toggle-hidden"
            @click="runTrackToggle('hidden')">
            {{ trackMenuTarget.hidden ? t('tmcut.tracks.show') : t('tmcut.tracks.hide') }}
          </UButton>
          <UButton v-if="trackMenuTarget.type !== 'text'"
            :icon="trackMenuTarget.muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'" variant="ghost" color="neutral"
            size="xs" block class="justify-start gap-2" data-track-menu-action="toggle-muted"
            @click="runTrackToggle('muted')">
            {{ trackMenuTarget.muted ? t('tmcut.tracks.unmute') : t('tmcut.tracks.mute') }}
          </UButton>
        </div>

        <div class="mt-1 border-t border-neutral-300/80 pt-1 dark:border-neutral-700/80">
          <UButton icon="i-lucide-trash-2" variant="ghost" color="error" size="xs" block class="justify-start gap-2"
            :disabled="!!trackMenuTarget.locked" data-track-menu-action="remove" @click="runTrackRemove">
            {{ t('tmcut.tracks.removeTrack') }}
          </UButton>
        </div>
      </div>
    </Teleport>

    <!-- Marker label/color editor (roadmap B5): fixed-positioned so the
         ruler's overflow-hidden never clips it. Enter or an outside
         click commits the label; Esc discards; dots recolor, trash
         deletes (with undo history). -->
    <div v-if="editingMarkerId" ref="markerEditorRef"
      class="fixed z-50 w-56 rounded-md border border-neutral-400 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-900 p-2 shadow-xl shadow-black/40"
      :style="{ left: `${markerEditorPos.x}px`, top: `${markerEditorPos.y}px` }" @mousedown.stop>
      <input id="tmcut-timeline-marker-label" ref="markerLabelInputRef" v-model="editingMarkerLabel"
        :aria-label="t('tmcut.marker.label')"
        class="h-7 w-full rounded border border-neutral-400 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-950 px-2 text-xs text-neutral-700 dark:text-neutral-200 outline-none focus:border-primary"
        @keydown.enter="commitMarkerEditor" @keydown.esc="editingMarkerId = null">
      <div class="mt-2 flex items-center gap-1.5">
        <button v-for="color in MARKER_COLORS" :key="color" type="button"
          class="h-4 w-4 rounded-full border border-neutral-400 dark:border-neutral-600 transition-transform hover:scale-110"
          :style="{ background: color }" :aria-label="t('tmcut.marker.color')" @click="setMarkerColor(color)" />
        <button type="button"
          class="ml-auto flex h-6 w-6 items-center justify-center rounded text-red-400 hover:bg-red-500/10"
          :aria-label="t('tmcut.marker.delete')" @click="deleteMarker">
          <UIcon name="i-lucide-trash-2" class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>

    <!-- Keyboard shortcuts help -->
    <TmcutShortcutsModal v-model:open="shortcutsOpen" />
  </div>
</template>
