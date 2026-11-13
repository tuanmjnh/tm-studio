/**
 * The export's sound leg: one decode per file, core's sum per packet.
 *
 * §53.6 declared `pcm` as a port and stopped there, because the honest glue is
 * two different jobs and only one of them belongs to the seam:
 *  - DECODING a file's samples is `decodePcm`'s (E3), which reads a range and
 *    trims it to the requested instant;
 *  - SUMMING those runs into one packet is `planExportMixPacket`'s (H3d-2a),
 *    which owns position, resample, gain and the refusal vocabulary.
 *
 * What is left is the walk between them, and it is not glue for glue's sake: the
 * session asks about 47 times per second of file for the same handful of clips.
 * A leg that decoded per packet would re-open the container every ~21 ms - the
 * audio twin of the per-frame open the plate leg just retired (§53.8) - and one
 * that summed locally would be a second answer to what the file sounds like,
 * next to the one core already owns.
 *
 * The alignment is the load-bearing part. `planExportMixPacket` taps a source at
 * `mediaSeconds * sampleRate`, an ABSOLUTE index into the file. So the run a
 * source carries must start at media second 0, never at the clip's in-point: a
 * bed trimmed to start at 30 s whose run began there would read 30 s into a
 * 30-second buffer and export silence. The leg therefore decodes each sounding
 * file once, from 0 to the furthest out-point any clip authored from it, and
 * lets the law's own out-of-run tap answer silence past the end.
 *
 * What this spec pins, all of it invisible to a runtime with no AudioDecoder:
 *  - a host that cannot decode audio fails the export instead of writing a
 *    silent file the user can hear playing on the timeline;
 *  - one file is decoded once for a whole export, even across many packets;
 *  - a row core says is muted never costs a decode at all;
 *  - the packet handed back has exactly the target shape core asked for;
 *  - a file that will not decode is named in core's vocabulary, not dropped;
 *  - the media range asked starts at 0 even when the clip is trimmed;
 *  - `close()` ends the leg: silence afterwards, and nothing decoded again.
 *
 * The last check hands the real entry point the request the encode session
 * really makes, and compares the planes sample for sample with core's own plan
 * for the same packet - so the leg is proven to add no arithmetic of its own.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_export_mix_leg.spec.ts
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TICKS_PER_SECOND, audioMixAt, evaluateTimeline, planExportMixPacket } from 'tmcut-core'
import { createExportMixLeg } from '../../app/utils/tmcut/exportMixLeg'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

const TICKS = TICKS_PER_SECOND

/** One authored clip: media in/out in seconds, timeline start/duration in seconds. */
function clip(id: string, type: string, src: string, options: {
  inSec?: number
  outSec?: number
  startSec?: number
  durSec?: number
} = {}) {
  const inSec = options.inSec ?? 0
  const outSec = options.outSec ?? 4
  const durSec = options.durSec ?? outSec - inSec
  return {
    id,
    type,
    src,
    source: { in: Math.round(inSec * TICKS), out: Math.round(outSec * TICKS) },
    timeline: { start: Math.round((options.startSec ?? 0) * TICKS), duration: Math.round(durSec * TICKS) },
    speed: 1,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    effects: [],
    keyframes: []
  }
}

function projectOf(items: {
  video: ReturnType<typeof clip>[]
  audio?: ReturnType<typeof clip>[]
  muted?: boolean
}) {
  return {
    version: 3,
    canvas: {
      width: 640,
      height: 360,
      fps: { numerator: 30, denominator: 1 },
      background: { type: 'color', value: '#101820' }
    },
    markers: [],
    tracks: [
      { id: 'row-v', type: 'video', items: items.video },
      { id: 'row-a', type: 'audio', muted: items.muted === true, items: items.audio ?? [] }
    ]
  }
}

const TARGET = Object.freeze({ sampleRate: 48_000, channelCount: 2 })
const SILENCE = () => ({
  sampleRate: 48_000,
  channels: [new Float32Array(48_000 * 4), new Float32Array(48_000 * 4)]
})
const packet = (index: number) => ({
  index,
  startSample: index * 1024,
  frames: 1024,
  timestamp: Math.round((index * 1024 * 1_000_000) / TARGET.sampleRate),
  duration: Math.round((1024 * 1_000_000) / TARGET.sampleRate)
})

async function main() {
  console.log('=== [TMCut export mix leg] Starting ===\n')
  assert.ok(existsSync(join(root, 'app/utils/tmcut/exportMixLeg.ts')),
    'the walk between the decoder and the mix law is its own module')

  // 1. The leg holds no colour of its own: which layers sound is core's, how the
  //    samples add is core's, and the decode is the seam's.
  await check('the leg borrows the decoder and both core laws', () => {
    const source = read('app/utils/tmcut/exportMixLeg.ts')
    assert.match(source, /export function createExportMixLeg/, 'the leg is the module\'s export')
    assert.match(source, /from '\.\/audioDecode'/, 'samples come from the one seam that decodes')
    assert.match(source, /audioMixAt/, 'which layers sound at a tick is core\'s answer')
    assert.match(source, /planExportMixPacket/, 'and so is the number in the packet')
    assert.match(source, /evaluateTimeline/, 'the evaluation is core\'s too, not a local walk')
    assert.doesNotMatch(source, /for \(let (offset|sample) /, 'no local sample loop sums anything')
    assert.doesNotMatch(source, /mediabunny/, 'and no demuxer in this file')
  })

  // 2. A host without an audio decoder cannot make the file the user hears on the
  //    timeline. Silence written as success is the audio twin of a black frame.
  await check('a host with no audio decoder fails instead of exporting silence', async () => {
    let decodes = 0
    const leg = createExportMixLeg({
      hasDecoder: () => false,
      decode: async () => {
        decodes += 1
        return SILENCE()
      }
    })
    await assert.rejects(
      () => leg.mix({ project: projectOf({ video: [clip('v1', 'video', 'C:/media/v.mp4')] }), request: packet(0), target: TARGET }),
      /audio decoder/i,
      'the refusal names the host, so the button can say what happened'
    )
    assert.equal(decodes, 0, 'and no file was read to find that out')
    leg.close()
  })

  // 3. The whole reason this is a leg: one decode per file, not per packet.
  await check('one file is decoded once for a run of packets', async () => {
    const decodes: string[] = []
    const leg = createExportMixLeg({
      hasDecoder: () => true,
      decode: async (ask: { src: string }) => {
        decodes.push(ask.src)
        return SILENCE()
      }
    })
    const project = projectOf({
      video: [clip('v1', 'video', 'C:/media/v.mp4')],
      audio: [clip('a1', 'audio', 'C:/media/a.wav')]
    })
    for (const index of [0, 1, 2, 3]) {
      await leg.mix({ project, request: packet(index), target: TARGET })
    }
    assert.deepEqual(decodes.slice().sort(), ['C:/media/a.wav', 'C:/media/v.mp4'],
      'each sounding file read once, however many packets came out of it')
    leg.close()
  })

  // 4. Which files get read at all is core's answer, not the project's: a muted
  //    row is still on the timeline, and still costs nothing.
  await check('a row core says is muted never costs a decode', async () => {
    const decodes: string[] = []
    const leg = createExportMixLeg({
      hasDecoder: () => true,
      decode: async (ask: { src: string }) => {
        decodes.push(ask.src)
        return SILENCE()
      }
    })
    const project = projectOf({
      video: [clip('v1', 'video', 'C:/media/v.mp4')],
      audio: [clip('a1', 'audio', 'C:/media/a.wav')],
      muted: true
    })
    const planes = await leg.mix({ project, request: packet(0), target: TARGET })
    assert.deepEqual(decodes, ['C:/media/v.mp4'], 'the muted bed was never opened')
    assert.equal(planes.length, 2, 'the packet still has the shape the encoder was promised')
    assert.equal(planes[0]!.length, 1024, 'and the frames it asked for')
    leg.close()
  })

  // 5. A file the runtime cannot read is named, in core's own words, and the
  //    packet keeps its shape so the rest of the mix still reaches the file.
  await check('a file that will not decode is named, not silently missing', async () => {
    const leg = createExportMixLeg({
      hasDecoder: () => true,
      decode: async (ask: { src: string }) => (ask.src.endsWith('.wav') ? null : SILENCE())
    })
    const planes = await leg.mix({
      project: projectOf({
        video: [clip('v1', 'video', 'C:/media/v.mp4')],
        audio: [clip('a1', 'audio', 'C:/media/a.wav')]
      }),
      request: packet(0),
      target: TARGET
    })
    assert.equal(planes.length, 2)
    const refused = leg.refused()
    assert.deepEqual(refused.map(entry => entry.clipId).sort(), ['a1'],
      'the missing file is named by its clip')
    assert.deepEqual(refused.map(entry => entry.reason), ['no-pcm'],
      'with the reason core gives for a source that has no samples')
    leg.close()
  })

  // 6. The run must start at the start of the media, because the mix law taps an
  //    absolute index into it. Asking for the clip's in-point instead is how a
  //    trimmed bed goes silent.
  await check('the decoded range starts at media second zero, whatever the trim', async () => {
    const asks: Array<{ src: string, inSec: number, outSec: number }> = []
    const leg = createExportMixLeg({
      hasDecoder: () => true,
      decode: async (ask: { src: string, inSec: number, outSec: number }) => {
        asks.push({ src: ask.src, inSec: ask.inSec, outSec: ask.outSec })
        return SILENCE()
      }
    })
    const project = projectOf({
      video: [],
      // Live from timeline 0, but its media starts at 2 s: the packet reads media
      // second 2, so a run that began there would be the wrong buffer entirely.
      audio: [clip('a1', 'audio', 'C:/media/a.wav', { inSec: 2, outSec: 3, startSec: 0, durSec: 1 })]
    })
    await leg.mix({ project, request: packet(0), target: TARGET })
    assert.deepEqual(asks, [{ src: 'C:/media/a.wav', inSec: 0, outSec: 3 }],
      'from the first sample of the file to the furthest second any clip uses')
    leg.close()
  })

  // 7. Close is the end of the leg, and a closed leg does not read behind the
  //    caller's back after the export already ran its finally.
  await check('a closed leg answers silence and reads nothing more', async () => {
    let decodes = 0
    const leg = createExportMixLeg({
      hasDecoder: () => true,
      decode: async () => {
        decodes += 1
        return SILENCE()
      }
    })
    const project = projectOf({ video: [clip('v1', 'video', 'C:/media/v.mp4')] })
    await leg.mix({ project, request: packet(0), target: TARGET })
    assert.equal(decodes, 1)
    leg.close()
    const planes = await leg.mix({ project, request: packet(1), target: TARGET })
    assert.equal(planes.length, 2, 'still the shape a caller may hand the encoder')
    assert.equal(planes[0]!.length, 1024)
    assert.deepEqual(Array.from(planes[0]!.slice(0, 3)), [0, 0, 0], 'and silence')
    assert.equal(decodes, 1, 'close is the end of the leg, not a pause')
    leg.close()
    assert.equal(decodes, 1, 'closing twice reads nothing either')
  })

  // 8. The entry point the session calls, compared with core's own plan for the
  //    same packet: one sample of local arithmetic would show here. The runs are
  //    deliberately non-silent — against silent fixtures a leg that returned
  //    zeros would pass every equality in this file.
  await check('the encoder receives exactly the packet core planned', async () => {
    const tone = () => {
      const run = new Float32Array(48_000 * 4)
      for (let index = 0; index < run.length; index++) run[index] = (index % 97) / 97
      return { sampleRate: 48_000, channels: [run, run.slice()] }
    }
    const leg = createExportMixLeg({ hasDecoder: () => true, decode: async () => tone() })
    const project = projectOf({
      video: [clip('v1', 'video', 'C:/media/v.mp4')],
      audio: [clip('a1', 'audio', 'C:/media/a.wav', { inSec: 1, outSec: 3, startSec: 0, durSec: 2 })]
    })
    const request = packet(5)
    const planes = await leg.mix({ project, request, target: TARGET })

    const atTicks = Math.round((request.timestamp / 1_000_000) * TICKS)
    const evaluation = evaluateTimeline(project, atTicks)
    const plan = planExportMixPacket({
      at: atTicks,
      startSample: request.startSample,
      frames: request.frames,
      target: TARGET,
      sources: audioMixAt(evaluation).sources.map(source => ({ ...source, ...tone() }))
    })
    assert.ok(plan, 'core planned a packet for these numbers')
    assert.deepEqual(planes.map(plane => Array.from(plane)),
      plan.channels.map(plane => Array.from(plane)),
      'sample for sample, the leg is core\'s answer plus the decode')
    leg.close()
  })

  // 9. The store keeps rows under `project.timeline.tracks`; core reads both
  //    shapes, so a leg that read only the top level found no clip, decoded
  //    nothing, and wrote silence into a file core had called eligible.
  await check('a store-shaped project is mixed, not silently silent', async () => {
    const tone = () => {
      const run = new Float32Array(48_000 * 4)
      for (let index = 0; index < run.length; index++) run[index] = (index % 97) / 97
      return { sampleRate: 48_000, channels: [run, run.slice()] }
    }
    const decodes: string[] = []
    const leg = createExportMixLeg({
      hasDecoder: () => true,
      decode: async (ask: { src: string }) => {
        decodes.push(ask.src)
        return tone()
      }
    })
    const flat = projectOf({
      video: [clip('v1', 'video', 'C:/media/v.mp4')],
      audio: [clip('a1', 'audio', 'C:/media/a.wav', { inSec: 0, outSec: 2, startSec: 0, durSec: 2 })]
    })
    const stored = {
      version: flat.version,
      canvas: flat.canvas,
      timeline: { version: 3, durationMs: 2000, markers: [], tracks: flat.tracks }
    }
    const planes = await leg.mix({ project: stored, request: packet(0), target: TARGET })
    // Both rows sound: a video clip carries its own audio, so core names two
    // sources. What the check is about is WHERE the leg looked for them.
    assert.deepEqual(decodes.sort(), ['C:/media/a.wav', 'C:/media/v.mp4'],
      'both rows under timeline.tracks were opened')
    assert.ok(planes[0]!.some(sample => sample !== 0), 'and their tone reached the packet')
    leg.close()
  })

  // 10. The sound leg has the same hole the plate leg had until §53.12: it asked
  //     the location for samples and never the client cache, so a project whose
  //     upload was reclaimed mixed silence into a file core called eligible.
  //     One cache read per file — a per-packet read would hit storage ~47 times
  //     a second — and the cached copy is the one handed to the decoder.
  await check('the cached copy of a file is what the sound leg decodes', async () => {
    const asked: string[] = []
    const seen: Array<Blob | null> = []
    const blob = new Blob([new Uint8Array(24)])
    const leg = createExportMixLeg({
      hasDecoder: () => true,
      bytesFor: async (src: string) => {
        asked.push(src)
        return src.endsWith('.wav') ? blob : null
      },
      decode: async (ask: { src: string, bytes?: Blob | null }) => {
        seen.push(ask.bytes ?? null)
        return SILENCE()
      }
    })
    const project = projectOf({
      video: [clip('v1', 'video', 'C:/media/v.mp4')],
      audio: [clip('a1', 'audio', 'C:/media/a.wav')]
    })
    for (const index of [0, 1, 2]) await leg.mix({ project, request: packet(index), target: TARGET })
    assert.deepEqual(asked.sort(), ['C:/media/a.wav', 'C:/media/v.mp4'],
      'one cache read per sounding file, however many packets asked')
    assert.deepEqual(seen.map(entry => entry === blob).sort(), [false, true],
      'the wav was decoded from its cached copy and the mp4 from its location')
    leg.close()
  })

  // 11. Storage that throws is a miss, not the end of the export: the location is
  //     still a way to decode, and a thin cache must not silence a file.
  await check('a cache read that throws falls back to the location', async () => {
    const seen: Array<Blob | null> = []
    const leg = createExportMixLeg({
      hasDecoder: () => true,
      bytesFor: async () => {
        throw new Error('the storage layer refused this read')
      },
      decode: async (ask: { src: string, bytes?: Blob | null }) => {
        seen.push(ask.bytes ?? null)
        return SILENCE()
      }
    })
    const planes = await leg.mix({
      project: projectOf({ video: [clip('v1', 'video', 'C:/media/v.mp4')] }),
      request: packet(0),
      target: TARGET
    })
    assert.deepEqual(seen, [null], 'the decoder was handed a location, not a failure')
    assert.equal(planes.length, 2, 'and the packet kept the shape the encoder was promised')
    assert.deepEqual(leg.refused(), [], 'a thin cache is not a refusal')
    leg.close()
  })

  // 12b. The authored `clip.src` is not a location a decoder can open. On the
  //      desktop host `C:/Users/…/clip.mp4` is not a URL: Chromium reads the
  //      drive letter as a scheme and lands on a `file:///C:/…` load, which
  //      `webSecurity` refuses, so `fetch` rejects with `Failed to fetch` and the
  //      whole export fails — even though the plate leg had already read the
  //      same file through `media://`. Measured in the live app (2026-11-13):
  //      one export, two reads of one clip, `media://…` 206 then `C:/Users/…`
  //      `Failed to fetch`. The leg therefore resolves through the host's own
  //      rule, exactly as the plate leg does, while the AUTHORED path stays the
  //      cache key and the question "how far does any clip use this file".
  await check('the decoder is handed a resolved location, not the authored path', async () => {
    const decodes: Array<{ src: string, bytes?: Blob | null }> = []
    const asked: string[] = []
    const blob = new Blob([new Uint8Array(8)])
    const leg = createExportMixLeg({
      hasDecoder: () => true,
      resolveSrc: (src: string) => `media://local?file=${encodeURIComponent(src)}`,
      bytesFor: async (src: string) => {
        asked.push(src)
        return blob
      },
      decode: async (ask: { src: string, bytes?: Blob | null }) => {
        decodes.push({ src: ask.src, bytes: ask.bytes })
        return SILENCE()
      }
    })
    await leg.mix({
      project: projectOf({ video: [clip('v1', 'video', 'C:/media/v.mp4')] }),
      request: packet(0),
      target: TARGET
    })
    assert.deepEqual(decodes.map(entry => entry.src), ['media://local?file=C%3A%2Fmedia%2Fv.mp4'],
      'the decoder opened a location the browser can actually fetch')
    assert.deepEqual(asked, ['C:/media/v.mp4'],
      'while the cache still names the authored file, so a revision cannot be looked up by a URL')
    assert.equal(decodes[0]!.bytes, blob, 'and a cache hit is still the copy that is decoded')
    leg.close()
  })

  // 12c. A host that hands no resolver keeps the legacy behaviour: the authored
  //      path is what the decoder opens. The web host's `/uploads/…` reads as a
  //      same-origin path, which is why this gap never showed in a browser.
  await check('a leg with no resolver decodes the authored path, as the web host did', async () => {
    const seen: string[] = []
    const leg = createExportMixLeg({
      hasDecoder: () => true,
      decode: async (ask: { src: string }) => {
        seen.push(ask.src)
        return SILENCE()
      }
    })
    await leg.mix({
      project: projectOf({ video: [clip('v1', 'video', '/uploads/w.mp4')] }),
      request: packet(0),
      target: TARGET
    })
    assert.deepEqual(seen, ['/uploads/w.mp4'], 'no location was invented where the host gave no rule')
    leg.close()
  })

  // 12. No byte port at all is the leg §53.9 shipped, so the desktop path keeps
  //     working without being handed a browser storage API.
  await check('a leg with no byte port decodes each file from its location', async () => {
    const seen: Array<Blob | null> = []
    const leg = createExportMixLeg({
      hasDecoder: () => true,
      decode: async (ask: { src: string, bytes?: Blob | null }) => {
        seen.push(ask.bytes ?? null)
        return SILENCE()
      }
    })
    await leg.mix({
      project: projectOf({ video: [clip('v1', 'video', 'C:/media/v.mp4')] }),
      request: packet(0),
      target: TARGET
    })
    assert.deepEqual(seen, [null], 'no bytes were invented for a host that has no cache')
    leg.close()
  })

  console.log(`\n=== All ${passed} export-mix-leg checks passed ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
