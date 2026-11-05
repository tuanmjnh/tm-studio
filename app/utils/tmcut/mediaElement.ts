/**
 * The release law for a media element that exists to answer one question.
 *
 * A throwaway element is the only way a web runtime can ask what a file is: no
 * ffprobe, no container reader, just `<video>` reporting at `loadedmetadata`.
 * But an element that has answered is not finished with the file. Its `src`
 * still names the blob or the `/uploads/` URL, its reader stays attached to
 * those bytes, and its handlers still hold closures over the caller. Assigning
 * nothing and dropping the reference is not enough — the browser releases the
 * media resource when the source is removed and `load()` re-selects, which is
 * the same idiom this repo already honours on the demuxer side: Mediabunny
 * "keeps fetching ranges until disposed", so the container opener hands back a
 * `close` and every caller runs it in a `finally`.
 *
 * The watchdog belongs to the same moment. A read that armed fifteen seconds and
 * answered in one used to leave that timer running until it fired, so an import
 * of forty files kept forty live timers and forty live decoders after every
 * answer had already been delivered. Here the element and its watchdog die
 * together, at the settle.
 */

/** How long to wait before deciding an element will never answer. */
export const THROWAWAY_MEDIA_TIMEOUT_MS = 15000

export function withThrowawayMedia<T>(
  kind: 'video' | 'audio',
  setup: (el: HTMLVideoElement, settle: (value: T | null) => void) => void,
  timeoutMs: number = THROWAWAY_MEDIA_TIMEOUT_MS
): Promise<T | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null)
      return
    }
    // `new Audio()` has no videoWidth in the DOM types but does at runtime, so
    // one element type drives both branches.
    const el = (kind === 'audio' ? new Audio() : document.createElement('video')) as HTMLVideoElement
    let settled = false
    const settle = (value: T | null) => {
      if (settled) return
      settled = true
      clearTimeout(watchdog)
      release(el)
      resolve(value)
    }
    // Armed before `setup` runs, so a caller that settles synchronously is still
    // covered by a watchdog that can be cleared.
    const watchdog = setTimeout(() => settle(null), timeoutMs)
    try {
      setup(el, settle)
    } catch {
      settle(null)
    }
  })
}

/**
 * Detach, stop, and let go. Handlers first, because `load()` with no source
 * reports an error and a live handler would answer a question nobody asked.
 */
function release(el: HTMLVideoElement) {
  el.onloadeddata = null
  el.onloadedmetadata = null
  el.onseeked = null
  el.onerror = null
  el.pause()
  el.srcObject = null
  el.removeAttribute('src')
  el.load()
}
