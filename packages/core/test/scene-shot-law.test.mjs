// tmcut-core — one shot law for both producers (zero-FFmpeg slice E1). Run:
// node --test "test/*.test.mjs"
//
// AutoCut's shot list used to have exactly one producer: FFmpeg's stderr. Slice
// E adds a second (decoded frames), and the two must hand the scorer the same
// [{start,end}] for the same cut instants — so the law that turns instants into
// shots belongs to core, not to either reader. These checks pin that the
// stderr reader now goes through it, including the one place the old inline
// loop disagreed with the law: a cut reported past the end of the file.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseSceneOutput } from '../src/analysis.mjs'
import { cutsToShots } from '../src/detection.mjs'

describe('one shot law for both producers', () => {
  it('the stderr reader and the frame scan agree on the same cut instants', () => {
    const log = [
      '[Parsed_showinfo_1 @ 0x123] n:  10 pts:  240 pts_time:2.5 s:1920x1080 fmt:yuv420p',
      '[Parsed_showinfo_1 @ 0x123] n:  25 pts:  600 pts_time:6 s:1920x1080 fmt:yuv420p'
    ].join('\n')
    assert.deepEqual(parseSceneOutput(log, 10), cutsToShots([2.5, 6], 10))
  })

  it('a cut reported past the end of the file does not make a shot longer than the file', () => {
    // The old inline reader pushed whatever pts_time it saw, so a probe that
    // understated the duration handed AutoCut a shot running off the end of the
    // source. One law cannot: a shot stops at the duration it was given.
    const log = '[Parsed_showinfo_1 @ 0x123] n:  40 pts:  960 pts_time:12 s:1920x1080 fmt:yuv420p'
    assert.deepEqual(parseSceneOutput(log, 10), [{ start: 0, end: 10 }])
  })
})
