import { nextTick, onUnmounted, ref, watch } from 'vue'

// Shared right-click menu plumbing for the timeline. The clip menu used to
// clamp the panel with a guessed height (`innerHeight - 250`), so the tall
// panel — the 36-entry transition grid is ~770px — ran off the bottom of the
// window with no way to reach the rest. Here the panel is measured AFTER it
// mounts and then flipped/shifted inside the viewport, and the panel carries
// its own max-height so the clamp can always succeed.
export interface TmcutMenuPoint {
  x: number
  y: number
}

const VIEWPORT_MARGIN = 8

export function useTmcutContextMenu() {
  const open = ref(false)
  // False until the first measured position lands — the panel stays hidden
  // for that single frame instead of flashing at the cursor.
  const ready = ref(false)
  const pos = ref<TmcutMenuPoint>({ x: 0, y: 0 })
  const el = ref<HTMLElement | null>(null)
  let anchor: TmcutMenuPoint = { x: 0, y: 0 }
  // Content grows after a pick (the amber refusal note, the locked hint), so
  // the panel is re-measured instead of keeping the height it had on open.
  let observer: ResizeObserver | null = null

  function stopMeasuring() {
    observer?.disconnect()
    observer = null
  }

  async function place() {
    await nextTick()
    const node = el.value
    if (!node) return
    if (!observer) {
      observer = new ResizeObserver(() => {
        void place()
      })
      observer.observe(node)
    }
    const maxX = window.innerWidth - VIEWPORT_MARGIN
    const maxY = window.innerHeight - VIEWPORT_MARGIN
    const w = node.offsetWidth
    const h = node.offsetHeight
    // Flip left/up when the panel would leave the viewport, then clamp so a
    // panel larger than the cursor gap still starts on-screen.
    const x = anchor.x + w > maxX ? Math.max(VIEWPORT_MARGIN, anchor.x - w) : anchor.x
    const y = anchor.y + h > maxY ? Math.max(VIEWPORT_MARGIN, maxY - h) : anchor.y
    pos.value = { x, y }
    ready.value = true
  }

  function openAt(e: MouseEvent) {
    e.preventDefault()
    anchor = { x: e.clientX, y: e.clientY }
    pos.value = anchor
    ready.value = false
    open.value = true
  }

  function close() {
    open.value = false
    ready.value = false
    stopMeasuring()
  }

  function onDocMouseDown(e: MouseEvent) {
    if (el.value && e.target instanceof Node && el.value.contains(e.target)) return
    close()
  }

  function onDocKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') close()
  }

  // A fixed panel anchored to viewport coordinates goes stale on scroll or
  // resize; closing is the standard menu behaviour and cheaper than tracking.
  // Scrolls INSIDE the panel (the capped transition grid) are not viewport
  // changes — closing on those would make the grid impossible to browse.
  function onViewportChange(e: Event) {
    if (el.value && e.target instanceof Node && el.value.contains(e.target)) return
    close()
  }

  watch(open, (isOpen) => {
    if (isOpen) {
      document.addEventListener('mousedown', onDocMouseDown, true)
      document.addEventListener('keydown', onDocKeyDown, true)
      window.addEventListener('resize', onViewportChange)
      window.addEventListener('scroll', onViewportChange, true)
      void place()
    } else {
      document.removeEventListener('mousedown', onDocMouseDown, true)
      document.removeEventListener('keydown', onDocKeyDown, true)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
      stopMeasuring()
    }
  })

  onUnmounted(() => {
    stopMeasuring()
    document.removeEventListener('mousedown', onDocMouseDown, true)
    document.removeEventListener('keydown', onDocKeyDown, true)
    window.removeEventListener('resize', onViewportChange)
    window.removeEventListener('scroll', onViewportChange, true)
  })

  return { open, ready, pos, el, openAt, close }
}
