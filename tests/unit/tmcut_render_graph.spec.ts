import assert from 'node:assert/strict'
import { TICKS_PER_SECOND } from '@tmcut-core'
import {
  escapeDrawText,
  RenderGraph,
  mapXfadeTransition,
  compileTimelineToFfmpeg
} from '../../app/utils/tmcut/render'
import { compileTimelineToFfmpeg as facadeCompile } from '../../app/utils/tmcut/compiler'
import type { TmcutProject } from '../../app/composables/useTmcutProject'

// C16-R3: the store's in/out/offset are integer TICKS now — fixtures
// mirror that; every expected FFmpeg string above stays in SECONDS
// because toRenderClip decodes at the boundary.
function tk(sec: number): number {
  return Math.round(sec * TICKS_PER_SECOND)
}

let passed = 0

function check(label: string, fn: () => void) {
  fn()
  passed++
  console.log(`   ${label} PASSED`)
}

function main() {
  console.log('=== [TMCut Render Graph (Round 70 / R9) Test Suite] Starting tests ===\n')

  check('escapeDrawText handles backslashes, colons, single quotes and percent signs', () => {
    const raw = 'Hello: 100% \'World\' \\ Test'
    const escaped = escapeDrawText(raw)
    assert.equal(escaped, 'Hello\\: 100\\% \'\\\'\'World\'\\\'\' \\\\ Test')
  })

  check('RenderGraph tracks inputs and builds unique labels and chains', () => {
    const graph = new RenderGraph()
    const idx0 = graph.addInput('input1.mp4')
    const idx1 = graph.addInput('input2.mp4')
    assert.equal(idx0, 0)
    assert.equal(idx1, 1)

    const label1 = graph.nextLabel('v_node')
    const label2 = graph.nextLabel('v_node')
    assert.equal(label1, '[v_node_1]')
    assert.equal(label2, '[v_node_2]')

    graph.addFilterChain('[0:v]scale=1280:720[v_scaled]')
    assert.equal(graph.buildFilterComplex(), '[0:v]scale=1280:720[v_scaled]')
    assert.deepEqual(graph.buildInputArgs(), ['-i', 'input1.mp4', '-i', 'input2.mp4'])
  })

  check('mapXfadeTransition correctly maps TMCut transitions to FFmpeg names', () => {
    assert.equal(mapXfadeTransition('fade'), 'fade')
    assert.equal(mapXfadeTransition('dissolve'), 'dissolve')
    assert.equal(mapXfadeTransition('wipe-left'), 'wipeleft')
    assert.equal(mapXfadeTransition('wipe-right'), 'wiperight')
    assert.equal(mapXfadeTransition('slide-left'), 'slideleft')
    assert.equal(mapXfadeTransition('zoom-in'), 'zoomin')
    assert.equal(mapXfadeTransition(undefined), 'fade')
  })

  check('compileTimelineToFfmpeg builds color canvas when no video clips exist', () => {
    const project: TmcutProject = {
      version: 1,
      name: 'Color Canvas Test',
      canvas: { width: 1920, height: 1080, fps: 30, background: { type: 'color', value: '#123456' } },
      timeline: {
        tracks: [
          { id: 'v1', type: 'video', name: 'Video', items: [] },
          {
            id: 't1',
            type: 'text',
            name: 'Text',
            items: [
              { id: 'c1', trackId: 't1', text: 'Hello Title', offset: 0, in: 0, out: tk(5), fontSize: 48, color: 'white' }
            ]
          }
        ]
      }
    }

    const result = compileTimelineToFfmpeg(project, 'out.mp4')
    assert.ok(result.args.includes('-filter_complex'))
    const fc = result.args[result.args.indexOf('-filter_complex') + 1]!
    // R76: base layer now comes from core buildBackgroundSource() — 0x hex, r before d, 3-decimal duration.
    assert.ok(fc.includes('color=c=0x123456:s=1920x1080:r=30:d=1.000[v_base]'))
    assert.ok(fc.includes('drawtext=text=\'Hello Title\''))
    assert.equal(result.duration, 1)
  })

  check('compileTimelineToFfmpeg compiles video clips with transitions and text overlays', () => {
    const project: TmcutProject = {
      version: 1,
      name: 'Video Cut Test',
      canvas: { width: 1920, height: 1080, fps: 30 },
      timeline: {
        tracks: [
          {
            id: 'v1',
            type: 'video',
            name: 'Video',
            items: [
              { id: 'vclip1', trackId: 'v1', src: 'clip1.mp4', offset: 0, in: 0, out: tk(4), speed: 1 },
              {
                id: 'vclip2',
                trackId: 'v1',
                src: 'clip2.mp4',
                offset: tk(3.5),
                in: 0,
                out: tk(4),
                speed: 1,
                transitionIn: { type: 'dissolve', duration: tk(0.5) }
              }
            ]
          },
          {
            id: 't1',
            type: 'text',
            name: 'Text',
            items: [
              { id: 'tclip1', trackId: 't1', text: 'Watermark', offset: tk(1), in: 0, out: tk(3) }
            ]
          }
        ]
      }
    }

    const result = compileTimelineToFfmpeg(project, 'output.mp4', {
      encoder: 'libx264',
      crf: 20
    })

    assert.ok(result.args.includes('-i'))
    assert.ok(result.args.includes('clip1.mp4'))
    assert.ok(result.args.includes('clip2.mp4'))
    const fc = result.args[result.args.indexOf('-filter_complex') + 1]!
    assert.ok(fc.includes('xfade=transition=dissolve:duration=0.500:offset=3.500'))
    assert.ok(fc.includes('acrossfade=d=0.500:c1=tri:c2=tri'))
    assert.ok(fc.includes('drawtext=text=\'Watermark\''))
    assert.ok(result.args.includes('-crf'))
    assert.ok(result.args.includes('20'))
  })

  check('R128: new xfade keys compile end-to-end and unknown keys fall back to fade', () => {
    const projectWith = (transitionType: string): TmcutProject => ({
      version: 1,
      name: 'xfade Test',
      canvas: { width: 1920, height: 1080, fps: 30 },
      timeline: {
        tracks: [
          {
            id: 'v1',
            type: 'video',
            name: 'Video',
            items: [
              { id: 'vclip1', trackId: 'v1', src: 'clip1.mp4', offset: 0, in: 0, out: tk(4), speed: 1 },
              {
                id: 'vclip2',
                trackId: 'v1',
                src: 'clip2.mp4',
                offset: tk(3.5),
                in: 0,
                out: tk(4),
                speed: 1,
                transitionIn: { type: transitionType, duration: tk(0.5) }
              }
            ]
          }
        ]
      }
    })
    const filterComplex = (transitionType: string) => {
      const result = compileTimelineToFfmpeg(projectWith(transitionType), 'out.mp4')
      return result.args[result.args.indexOf('-filter_complex') + 1]!
    }
    // R128 keys pass through fxCatalog -> xfadeNameFor -> literal xfade name.
    for (const transitionType of ['circleopen', 'fadeblack', 'smoothleft', 'zoomin']) {
      assert.ok(
        filterComplex(transitionType).includes(`xfade=transition=${transitionType}:duration=0.500:offset=3.500`),
        `missing xfade for ${transitionType}`
      )
    }
    // An unknown key must never break the graph: it degrades to a safe fade.
    const unknownFc = filterComplex('star-wipe')
    assert.ok(unknownFc.includes('xfade=transition=fade:duration=0.500:offset=3.500'))
    assert.ok(unknownFc.includes('acrossfade='))
  })

  check('compileTimelineToFfmpeg supports GIF output with palettegen/paletteuse', () => {
    const project: TmcutProject = {
      version: 1,
      name: 'GIF Test',
      canvas: { width: 800, height: 600, fps: 30 },
      timeline: {
        tracks: [
          {
            id: 'v1',
            type: 'video',
            name: 'Video',
            items: [
              { id: 'g1', trackId: 'v1', src: 'demo.mp4', offset: 0, in: 0, out: tk(2) }
            ]
          }
        ]
      }
    }

    const result = compileTimelineToFfmpeg(project, 'anim.gif', { mode: 'gif' })
    const fc = result.args[result.args.indexOf('-filter_complex') + 1]!
    assert.ok(fc.includes('palettegen=stats_mode=diff[gif_pal]'))
    assert.ok(fc.includes('paletteuse=dither=bayer:bayer_scale=4[gif_out]'))
    assert.ok(result.args.includes('-loop'))
    assert.ok(result.args.includes('0'))
  })

  check('compileTimelineToFfmpeg supports Audio-only mode', () => {
    const project: TmcutProject = {
      version: 1,
      name: 'Audio Only Test',
      canvas: { width: 1920, height: 1080, fps: 30 },
      timeline: {
        tracks: [
          {
            id: 'a1',
            type: 'audio',
            name: 'Audio',
            items: [
              { id: 's1', trackId: 'a1', src: 'bgm.mp3', offset: 0, in: 0, out: tk(10), volume: 80 }
            ]
          }
        ]
      }
    }

    const result = compileTimelineToFfmpeg(project, 'track.mp3', { mode: 'audio' })
    assert.ok(result.args.includes('-c:a'))
    assert.ok(result.args.includes('libmp3lame'))
    assert.equal(result.duration, 10)
  })

  check('facadeCompile from compiler.ts matches render/ index compileTimelineToFfmpeg', () => {
    assert.equal(facadeCompile, compileTimelineToFfmpeg)
  })

  check('compileTimelineToFfmpeg image background registers looping input (R76)', () => {
    const project: TmcutProject = {
      version: 1,
      name: 'Image BG Test',
      canvas: { width: 1280, height: 720, fps: 30, background: { type: 'image', value: 'D:/assets/bg.png' } },
      timeline: {
        tracks: [
          { id: 'v1', type: 'video', name: 'Video', items: [] }
        ]
      }
    }

    const result = compileTimelineToFfmpeg(project, 'out.mp4')
    assert.ok(result.args.includes('-loop'))
    assert.ok(result.args.includes('1'))
    assert.ok(result.args.includes('D:/assets/bg.png'))
    const fc = result.args[result.args.indexOf('-filter_complex') + 1]!
    assert.ok(fc.includes('scale=1280:720:force_original_aspect_ratio=increase'))
    assert.ok(fc.includes('crop=1280:720'))
  })

  check('compileTimelineToFfmpeg transparent background uses alpha codec (R76)', () => {
    const project: TmcutProject = {
      version: 1,
      name: 'Transparent BG Test',
      canvas: { width: 1920, height: 1080, fps: 30, background: { type: 'transparent' } },
      timeline: {
        tracks: [
          { id: 'v1', type: 'video', name: 'Video', items: [] }
        ]
      }
    }

    const result = compileTimelineToFfmpeg(project, 'out.webm', { encoder: 'libvpx-vp9' })
    const fc = result.args[result.args.indexOf('-filter_complex') + 1]!
    assert.ok(fc.includes('color=c=0x00000000'))
    // libvpx-vp9 with transparent should pick alpha pix_fmt
    assert.ok(result.args.includes('-c:v'))
    assert.ok(result.args.includes('libvpx-vp9'))
    assert.ok(result.args.includes('yuva420p'))
  })

  check('compileTimelineToFfmpeg color background uses 0x hex (R75 regression)', () => {
    const project: TmcutProject = {
      version: 1,
      name: 'Color BG Hex Test',
      canvas: { width: 1920, height: 1080, fps: 30, background: { type: 'color', value: '#ff00cc' } },
      timeline: {
        tracks: [
          { id: 'v1', type: 'video', name: 'Video', items: [] }
        ]
      }
    }
    const result = compileTimelineToFfmpeg(project, 'out.mp4')
    const fc = result.args[result.args.indexOf('-filter_complex') + 1]!
    assert.ok(fc.includes('color=c=0xff00cc'))
  })

  check('compileTimelineToFfmpeg image background + scaled clip (R76 per-clip bg)', () => {
    const project: TmcutProject = {
      version: 1,
      name: 'Image BG With Clip',
      canvas: { width: 1280, height: 720, fps: 30, background: { type: 'image', value: 'D:/assets/bg.png' } },
      timeline: {
        tracks: [
          {
            id: 'v1',
            type: 'video',
            name: 'Video',
            items: [
              { id: 'c1', trackId: 'v1', src: 'clip1.mp4', offset: 0, in: 0, out: tk(4), scale: 150, x: 20, y: -10, speed: 1 }
            ]
          }
        ]
      }
    }
    const result = compileTimelineToFfmpeg(project, 'out.mp4')
    assert.ok(result.args.includes('-loop'))
    assert.ok(result.args.includes('1'))
    const fc = result.args[result.args.indexOf('-filter_complex') + 1]!
    // Image bg registered
    assert.ok(fc.includes('scale=1280:720:force_original_aspect_ratio=increase'))
    assert.ok(fc.includes('crop=1280:720'))
    // Per-clip transform reuses [v_bg] (bgInput supplied)
    assert.ok(fc.includes('[v_bg]'))
    // Clip scaling chain present
    assert.ok(fc.includes('scale=1920:1080'))
    // R79 (real-FFmpeg verified): the shared background label attaches
    // DIRECTLY to trim — `[v_bg],trim` parses as an empty filter and
    // `[in][out]` bare relabels have no filter; both are invalid graphs.
    // Input 0 is the looping bg image, so the clip chains live on index 1.
    assert.ok(fc.includes('[v_bg]trim=start=0:end=6,setpts=PTS-STARTPTS[v_bg_trim_1]'))
    assert.ok(fc.includes('[v_bg_trim_1][v_fg_1]overlay'))
    assert.ok(fc.includes(',scale=1280:720,setsar=1[v_scaled_1]'))
    assert.ok(!fc.includes('[v_bg],trim'))
    const bareRelabel = fc.split(';').some(chain => /^\[[\w]+\]\[[\w]+\]$/.test(chain.trim()))
    assert.equal(bareRelabel, false)
  })

  check('multi-track audio export mixes every audio track (R124 A1)', () => {
    const project: TmcutProject = {
      version: 1,
      name: 'Multi Audio',
      canvas: { width: 1920, height: 1080, fps: 30 },
      timeline: {
        tracks: [
          {
            id: 'a1',
            type: 'audio',
            name: 'Music',
            items: [{ id: 'a1c1', trackId: 'a1', src: 'music.mp3', offset: 0, in: 0, out: tk(5), volume: 100 }]
          },
          {
            id: 'a2',
            type: 'audio',
            name: 'Voice',
            items: [{ id: 'a2c1', trackId: 'a2', src: 'voice.wav', offset: tk(1), in: 0, out: tk(3), volume: 100 }]
          }
        ]
      }
    }
    const result = compileTimelineToFfmpeg(project, 'out.mp4', { mode: 'audio' })
    // Both audio inputs registered (old code took only the FIRST audio track).
    assert.equal(result.args.filter(a => a === '-i').length, 2)
    const fc = result.args[result.args.indexOf('-filter_complex') + 1]!
    assert.ok(fc.includes('music.mp3') || result.args.includes('music.mp3'))
    assert.ok(result.args.includes('voice.wav'))
    // Both buses feed the mix.
    assert.match(fc, /amix=inputs=2/)
  })

  check('muted audio track contributes nothing to the mix (R124 A1)', () => {
    const project: TmcutProject = {
      version: 1,
      name: 'Muted Track',
      canvas: { width: 1920, height: 1080, fps: 30 },
      timeline: {
        tracks: [
          {
            id: 'a1',
            type: 'audio',
            name: 'Music',
            items: [{ id: 'a1c1', trackId: 'a1', src: 'music.mp3', offset: 0, in: 0, out: tk(5), volume: 100 }]
          },
          {
            id: 'a2',
            type: 'audio',
            name: 'Muted SFX',
            muted: true,
            items: [{ id: 'a2c1', trackId: 'a2', src: 'sfx.wav', offset: 0, in: 0, out: tk(5), volume: 100 }]
          }
        ]
      }
    }
    const result = compileTimelineToFfmpeg(project, 'out.mp4', { mode: 'audio' })
    const fc = result.args[result.args.indexOf('-filter_complex') + 1]!
    // Only the unmuted bus remains — no amix (single stream), no sfx chain.
    assert.ok(!fc.includes('amix'))
    assert.ok(!/sfx\.wav/.test(result.args.join(' ')) || !fc.includes('sfx'))
  })

  check('track volume multiplies clip volume in the export chain (R124 A1)', () => {
    const project: TmcutProject = {
      version: 1,
      name: 'Track Volume',
      canvas: { width: 1920, height: 1080, fps: 30 },
      timeline: {
        tracks: [
          {
            id: 'a1',
            type: 'audio',
            name: 'Dimmed',
            volume: 50,
            items: [{ id: 'a1c1', trackId: 'a1', src: 'music.mp3', offset: 0, in: 0, out: tk(5), volume: 80 }]
          }
        ]
      }
    }
    const result = compileTimelineToFfmpeg(project, 'out.mp4', { mode: 'audio' })
    const fc = result.args[result.args.indexOf('-filter_complex') + 1]!
    // 80 * 50 / 10000 = 0.4 → single volume filter with the combined gain.
    assert.ok(fc.includes('volume=0.4'), `expected combined gain 0.4 in: ${fc}`)
  })

  check('track pan emits a stereotools filter (R124 A1)', () => {
    const project: TmcutProject = {
      version: 1,
      name: 'Panned Track',
      canvas: { width: 1920, height: 1080, fps: 30 },
      timeline: {
        tracks: [
          {
            id: 'a1',
            type: 'audio',
            name: 'Left',
            pan: -60,
            items: [{ id: 'a1c1', trackId: 'a1', src: 'music.mp3', offset: 0, in: 0, out: tk(5), volume: 100 }]
          }
        ]
      }
    }
    const result = compileTimelineToFfmpeg(project, 'out.mp4', { mode: 'audio' })
    const fc = result.args[result.args.indexOf('-filter_complex') + 1]!
    assert.ok(fc.includes('stereotools='), `expected stereotools Panas in: ${fc}`)
  })

  check('video mask emits a geq alpha chain (R124 A3)', () => {
    const project: TmcutProject = {
      version: 1,
      name: 'Masked Clip',
      canvas: { width: 1920, height: 1080, fps: 30 },
      timeline: {
        tracks: [
          {
            id: 'v1',
            type: 'video',
            name: 'Video',
            items: [
              {
                id: 'c1',
                trackId: 'v1',
                src: 'clip1.mp4',
                offset: 0,
                in: 0,
                out: tk(4),
                scale: 100,
                speed: 1,
                mask: { shape: 'circle', x: 0.2, y: 0.2, w: 0.6, h: 0.6, feather: 20, rotation: 30, invert: false, axis: 'x' }
              }
            ]
          }
        ]
      }
    }
    const result = compileTimelineToFfmpeg(project, 'out.mp4')
    const fc = result.args[result.args.indexOf('-filter_complex') + 1]!
    // The mask alpha must ride on a single-quoted geq alpha with the
    // circle distance core (hypot) — the shape signature.
    assert.ok(fc.includes('geq=r=\'r(X,Y)\':g=\'g(X,Y)\':b=\'b(X,Y)\':a=\''), 'expected geq rgba chain')
    assert.ok(fc.includes('hypot(abs('), 'expected circle signed distance')
    assert.ok(!fc.includes('colorchannelmixer'), 'mask path must not emit a static aa= filter')
  })

  check('no mask emits no geq (R124 A3 regression)', () => {
    const project: TmcutProject = {
      version: 1,
      name: 'Plain Clip',
      canvas: { width: 1920, height: 1080, fps: 30 },
      timeline: {
        tracks: [
          {
            id: 'v1',
            type: 'video',
            name: 'Video',
            items: [{ id: 'c1', trackId: 'v1', src: 'clip1.mp4', offset: 0, in: 0, out: tk(4), scale: 100, speed: 1 }]
          }
        ]
      }
    }
    const result = compileTimelineToFfmpeg(project, 'out.mp4')
    const fc = result.args[result.args.indexOf('-filter_complex') + 1]!
    // geq only ever appears for opacity keyframes or masks — plain clips
    // keep the byte-identical old chain.
    assert.ok(!fc.includes('geq='))
  })

  check('speed ramp emits the quoted non-linear setpts expr (R124 A4)', () => {
    const project: TmcutProject = {
      version: 1,
      name: 'Ramped Clip',
      canvas: { width: 1920, height: 1080, fps: 30 },
      timeline: {
        tracks: [
          {
            id: 'v1',
            type: 'video',
            name: 'Video',
            items: [
              {
                id: 'c1',
                trackId: 'v1',
                src: 'clip1.mp4',
                offset: 0,
                in: 0,
                out: tk(4),
                scale: 100,
                speed: 1,
                speedPoints: [
                  { t: 0, speed: 0.5 },
                  { t: tk(4), speed: 1.5 }
                ]
              }
            ]
          }
        ]
      }
    }
    const result = compileTimelineToFfmpeg(project, 'out.mp4')
    const fc = result.args[result.args.indexOf('-filter_complex') + 1]!
    // Commas inside the expr force the single-quoted form; the closed-form
    // inverse of a varying-speed integral must carry sqrt.
    assert.ok(/setpts='if\(lt\(/.test(fc), 'expected quoted ramp setpts expr')
    assert.ok(fc.includes('sqrt('), 'expected closed-form sqrt branch')
    assert.ok(fc.includes(':eval=frame'))
  })

  check('constant speed keeps the classic setpts path (R124 A4 regression)', () => {
    const project: TmcutProject = {
      version: 1,
      name: 'Fast Clip',
      canvas: { width: 1920, height: 1080, fps: 30 },
      timeline: {
        tracks: [
          {
            id: 'v1',
            type: 'video',
            name: 'Video',
            items: [{ id: 'c1', trackId: 'v1', src: 'clip1.mp4', offset: 0, in: 0, out: tk(4), scale: 100, speed: 2 }]
          }
        ]
      }
    }
    const result = compileTimelineToFfmpeg(project, 'out.mp4')
    const fc = result.args[result.args.indexOf('-filter_complex') + 1]!
    assert.ok(fc.includes('setpts=(PTS-STARTPTS)/2'))
    assert.ok(!fc.includes('sqrt('))
  })

  console.log(`\n=== All ${passed} tests passed successfully! ===`)
}

main()
