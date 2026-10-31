/**
 * Ripple-mode / drag-insert behaviour (R96).
 *
 * addClipToTrack is the only store-side insertion entry-point; the UI
 * toggles rippleMode on/off. When the mode is ON and the target offset
 * collides with existing items, the store routes through
 * `insertClipRipple(v3, ...)` so the new item forces all later items on
 * the same track rightwards in one atomic core op; the result is merged
 * back via `applyV3Edit`. The offset argument is in SECONDS (the UI
 * contract), but the store / core work in TICKS.
 *
 * The contract the spec pins:
 * - plain (no ripple) → strict overlay (no shifting)
 * - ripple ON + COLLISION → push-later-clips; the inserted clip keeps the
 *   requested offset but everything at >= offset is moved right by
 *   inserted duration; the UI shows no gaps after the insertion.
 * - ripple ON + NO COLLISION (empty gap) → plain overlay behaviour
 * - ripple ON + locked target track → core refuses the bridge; fallback
 *   to plain overlay to avoid a silent no-op (store already encodes this
 *   fallback).
 */
import { TICKS, freshStore } from './helpers/tmcut_store_env'

let passed = 0
async function check(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`[ok] ${name}`)
}

const tk = (sec: number) => Math.round(sec * TICKS)
const dur = (sec: number) => tk(sec)
const start = (item: { in: number, offset: number, speed: number }) =>
  item.offset + (item.in > 0 ? item.in : 0)

function videoItems(s: Awaited<ReturnType<typeof freshStore>>) {
  return s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!.items!
}

async function main() {
  await check('plain insert (ripple OFF) overlays without shifting', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: dur(3), offset: 0 })
    s.addClipToTrack('video', { src: 'b.mp4', in: 0, out: dur(3), offset: tk(2) }) // overlapped
    const v = videoItems(s)
    if (v.length !== 2) throw new Error(`expected 2 items, got ${v.length}`)
    if (start(v[1]) !== tk(2)) throw new Error('plain insert must keep its requested start')
    // overlay means first clip stays unchanged.
  })

  await check('ripple ON with collision pushes later clips rightwards', async () => {
    const s = await freshStore()
    const track = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!.id
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: dur(2), offset: 0 }, track)
    s.addClipToTrack('video', { src: 'b.mp4', in: 0, out: dur(3), offset: tk(2) }, track)
    s.addClipToTrack('video', { src: 'c.mp4', in: 0, out: dur(4), offset: tk(5) }, track)

    // turn ripple ON in the store (the only way to route via insertClipRipple)
    ;(s as unknown as { rippleMode: { value: boolean } }).rippleMode.value = true
    const newItem = s.addClipToTrack('video', { src: 'x.mp4', in: 0, out: dur(2), offset: tk(2) }, track)
    if (!newItem) throw new Error('ripple insert returned null')
    const items = videoItems(s)
    // Find newly inserted clip (src == 'x.mp4')
    const inserted = items.find(i => i.src === 'x.mp4')
    if (!inserted) throw new Error('inserted clip missing')
    // Ripple means later clips (b and c) are shifted right by dur(insert)
    const after = items.filter(i => i.id !== inserted.id && start(i) >= tk(2)).sort((a, b) => start(a) - start(b))
    if (after.length < 2) throw new Error('ripple failed to shift enough items')
    // 'b' should have slid right by dur(2) (= 240000)
    const b = items.find(i => i.src === 'b.mp4')!
    const expectedBstart = tk(2) + dur(2)
    if (start(b) !== expectedBstart) throw new Error(`b not shifted: got ${start(b) / TICKS}s, want ${expectedBstart / TICKS}s`)
    // 'c' must also be shifted right accordingly
    const c = items.find(i => i.src === 'c.mp4')!
    const expectedCstart = tk(5) + dur(2)
    if (start(c) !== expectedCstart) throw new Error(`c not shifted: got ${start(c) / TICKS}s, want ${expectedCstart / TICKS}s`)
  })

  await check('ripple ON without collision falls back to plain overlay', async () => {
    const s = await freshStore()
    const track = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!.id
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: dur(2), offset: 0 }, track)
    ;(s as unknown as { rippleMode: { value: boolean } }).rippleMode.value = true
    const newItem = s.addClipToTrack('video', { src: 'x.mp4', in: 0, out: dur(2), offset: tk(5) }, track)
    if (!newItem) throw new Error('insert failed')
    // No collision → plain overlay; items count and positions unchanged
    const items = videoItems(s)
    const a = items.find(i => i.src === 'a.mp4')!
    const x = items.find(i => i.src === 'x.mp4')!
    if (start(a) !== 0) throw new Error('a moved unexpectedly')
    if (start(x) !== tk(5)) throw new Error('x start changed unexpectedly')
  })

  await check('ripple insert on locked target track falls back to plain overlay without silent loss', async () => {
    const s = await freshStore()
    const track = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!
    track.locked = true
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: dur(2), offset: 0 })
    ;(s as unknown as { rippleMode: { value: boolean } }).rippleMode.value = true
    const newItem = s.addClipToTrack('video', { src: 'x.mp4', in: 0, out: dur(2), offset: tk(1) })
    if (!newItem) throw new Error('locked track must still create a plain clip via fallback')
    const items = videoItems(s)
    if (items.length !== 2) throw new Error('fallback must still insert')
    const x = items.find(i => i.src === 'x.mp4')!
    if (!x) throw new Error('fallback inserted clip missing')
    // plain overlay means a is untouched and x lands at tk(1).
    if (start(x) !== tk(1)) throw new Error('fallback changed clip start')
  })

  await check('ripple mode only affects the track it lands on; other tracks untouched', async () => {
    const s = await freshStore()
    s.addClipToTrack('audio', { src: 'a.wav', in: 0, out: dur(3), offset: 0 })
    s.addClipToTrack('audio', { src: 'b.wav', in: 0, out: dur(3), offset: tk(2) })
    ;(s as unknown as { rippleMode: { value: boolean } }).rippleMode.value = true
    const track = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!.id
    s.addClipToTrack('video', { src: 'v.mp4', in: 0, out: dur(2), offset: tk(1) }, track)
    // Audio track should be untouched
    const audioItems = s.currentProject.value!.timeline.tracks.find(t => t.type === 'audio')!.items!
    if (audioItems.length !== 2) throw new Error('audio items count changed')
    if (start(audioItems[1]) !== tk(2)) throw new Error('audio items were shifted by video ripple')
  })

  console.log(`\n=== All ${passed} ripple checks passed ===`)
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
