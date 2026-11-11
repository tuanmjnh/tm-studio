// =============================================================================
//  A dead decode must look like an error, not like "Buffering…" forever.
//
//  The reported bug: after import → timeline → Play, the preview showed
//  "Buffering…" continuously. The old flag was a single boolean set on
//  `waiting` and cleared on `playing` / `canplay`, so a decoder that never
//  recovered left the spinner on for the whole session — the viewer had no way
//  to tell "still fetching" from "this is broken".
//
//  The law that fixes it is core's (`planPlaybackFollow` reports `stalled` once
//  the picture has not moved for `TMCUT_PLAYBACK_STALL_LIMIT_MS`); this spec
//  holds the two application-side halves to it:
//   1. buffering clears only when data is actually present, not on `playing`;
//   2. a stall is a distinct, announced state (role="alert"), not a spinner.
//
//  Source contracts on purpose: the behaviour lives in a Vue component and a
//  composable the node runner cannot mount, and the failure mode (an endless
//  spinner) is visible in the template.
// =============================================================================
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TMCUT_PLAYBACK_STALL_LIMIT_MS, planPlaybackFollow } from 'tmcut-core'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
const player = read('app/components/tmcut/TmcutPreviewPlayer.vue')
const playback = read('app/composables/useTmcutPlayback.ts')

describe('buffering clears on data, not on an event that can lie', () => {
  it('the player clears the flag only when a future frame exists', () => {
    const fn = player.match(/function onVideoProgress\(\)[\s\S]*?\n\}/)?.[0] ?? ''
    assert.ok(fn, 'onVideoProgress is gone — buffering has no data-present escape')
    assert.match(fn, /readyState >= HTMLMediaElement\.HAVE_FUTURE_DATA/,
      'clearing on `playing` alone is the bug: a seek fires it before frames exist')
    assert.match(fn, /!el\.seeking/, 'a seek in flight is not "data present"')
  })

  it('data-present and seeked events all run that same clear', () => {
    for (const event of ['@progress', '@timeupdate', '@seeked']) {
      assert.ok(player.includes(event), `${event} no longer drives the buffering clear`)
    }
  })
})

describe('a stall is announced, not spun on', () => {
  it('core reports a stall at the budget, and only then', () => {
    const input = { targetSec: 20, elementSec: 3, readyState: 1 }
    assert.equal(planPlaybackFollow({ ...input, frozenMs: TMCUT_PLAYBACK_STALL_LIMIT_MS - 1 }).action, 'hold')
    assert.equal(planPlaybackFollow({ ...input, frozenMs: TMCUT_PLAYBACK_STALL_LIMIT_MS }).action, 'stalled')
  })

  it('the composable forwards the freeze budget and exposes the stalled flag', () => {
    assert.match(playback, /frozenMs: frozenMsOf\(/, 'the follow law is never told how long the picture has been frozen')
    assert.match(playback, /playbackStalled/, 'the player has no stall signal to show')
    assert.match(playback, /playbackStalled\.value = plan\.action === 'stalled'/,
      'the stalled flag must come from the law, not from a second guess')
  })

  it('the buffering pill yields to an alert when stalled', () => {
    assert.match(player, /v-if="isBuffering && !mediaLoadError && !playbackStalled"/,
      'the spinner and the error can both show, or the spinner outlives the stall')
    const stallBlock = player.match(/v-else-if="playbackStalled && !mediaLoadError"[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? ''
    assert.match(stallBlock, /role="alert"/, 'a dead decoder is not a status message')
    assert.match(stallBlock, /tmcut\.player\.stalled/, 'the stall shows a raw key instead of a sentence')
  })

  it('both locales ship the stall sentence', () => {
    for (const locale of ['en', 'vi']) {
      const copy = JSON.parse(read(`i18n/locales/${locale}.json`))?.tmcut?.player?.stalled
      assert.equal(typeof copy, 'string', `${locale} is missing tmcut.player.stalled`)
      assert.ok(copy.length > 0, `${locale} ships an empty stall sentence`)
    }
  })
})
