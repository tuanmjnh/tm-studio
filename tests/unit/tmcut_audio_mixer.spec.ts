/**
 * Web Audio mixer (zero-FFmpeg slice G3, ADR-033).
 *
 * Slice G2 gave the app a waveform made in the browser. This slice gives it a
 * mix: one graph per preview, one node per sounding source, and the gains read
 * from core (`audioMixAt` over `evaluateTimeline`, which already multiplies the
 * keyframed clip volume, the track volume and the fade envelope). Before this,
 * the player computed the same number three different ways — `videoVolume` for
 * the main element, an inline percent product for the audio elements, and the
 * export's filter chain for the file — and the audio-element way silently
 * dropped fades and volume keyframes, so a bed that ramped in the file did not
 * ramp on the screen.
 *
 * Two browser laws bound the design, and both are pinned below rather than
 * assumed: a media element may only be routed into a graph ONCE
 * (`createMediaElementSource` throws on a second call), and a cross-origin
 * source is muted by the CORS rules the moment it is routed. An AudioContext
 * that the user has not unlocked with a gesture stays `suspended`, and a routed
 * element in a suspended graph is silence. So the mixer has one write path that
 * covers both cases — routed gains go to the node, refused ones go to the
 * element — and the player never has to know which one it is holding.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_audio_mixer.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TmcutAudioMixer } from '../../app/utils/tmcut/audioMixer'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

interface FakeGain { value: number }
interface FakeNode {
  gain: FakeGain
  connected: unknown[]
  disconnects: number
  connect(target: unknown): void
  disconnect(): void
}
interface FakeElement { volume: number, src: string, muted?: boolean }
interface FakeGraph {
  state: 'suspended' | 'running' | 'closed'
  destination: object
  createdSources: number
  routedElements: FakeElement[]
  sourceNodes: { disconnects: number }[]
  createGain(): FakeNode
  createMediaElementSource(element: FakeElement): { disconnects: number, connect(target: unknown): void, disconnect(): void }
}

function fakeNode(): FakeNode {
  const node: FakeNode = {
    gain: { value: 1 },
    connected: [],
    disconnects: 0,
    connect(target: unknown) { node.connected.push(target) },
    disconnect() { node.disconnects++ }
  }
  return node
}

function fakeGraph(state: 'suspended' | 'running' | 'closed' = 'running'): FakeGraph {
  const graph: FakeGraph = {
    state,
    destination: { name: 'destination' },
    createdSources: 0,
    routedElements: [],
    sourceNodes: [],
    createGain: () => fakeNode(),
    createMediaElementSource(element: FakeElement) {
      graph.createdSources++
      graph.routedElements.push(element)
      const source = {
        disconnects: 0,
        connect(_target: unknown) {},
        disconnect() { source.disconnects++ }
      }
      graph.sourceNodes.push(source)
      return source
    }
  }
  return graph
}

function fakeElement(src = '/uploads/a.mp4', volume = 1): FakeElement {
  return { volume, src }
}

async function main() {
  const mixer = await import('../../app/utils/tmcut/audioMixer')
  type Held = { graph: FakeGraph, mixer: TmcutAudioMixer }
  const build = (state?: 'suspended' | 'running' | 'closed'): Held => {
    const graph = fakeGraph(state)
    return { graph, mixer: mixer.createAudioMixer(() => graph) }
  }

  await check('a routed gain lands on the node and never on the element', () => {
    const { mixer: m } = build()
    const el = fakeElement()
    assert.equal(m.attach('a', el), true, 'a same-origin element routes')
    m.apply('a', 0.5, 1)
    // Writing both would square the gain: the graph attenuates AND the element
    // does, so the screen is quieter than the file.
    assert.equal(el.volume, 1, 'the element keeps its own volume untouched')
    assert.equal(m.gainOf('a'), 0.5)
  })

  await check('routing an element neutralizes its own volume first', () => {
    // The element path writes `layer * master`; the node path writes `layer`. A
    // volume the element path left behind still attenuates what the graph
    // captures, so routing an element in without neutralizing it squares every
    // gain — the screen quieter than the file. One write path means the node
    // owns the number from the moment it exists.
    const { graph, mixer: m } = build('suspended')
    const el = fakeElement('/uploads/a.mp4', 1)
    m.attach('a', el)
    m.apply('a', 0.4, 1)
    assert.equal(el.volume, 0.4, 'before the graph is unlocked the element carries the gain')
    graph.state = 'running'
    assert.equal(m.attach('a', el), true, 'the same element routes once the gesture lands')
    assert.equal(el.volume, 1, 'entering the graph gives the element its unity back')
    m.apply('a', 0.5, 1)
    assert.equal(el.volume, 1, 'and the node takes every write after that')
    assert.equal(m.gainOf('a'), 0.5)
    assert.equal(graph.createdSources, 1, 'no second source node for the same element')
  })

  await check('the mix speaks linear, so a stored percent never reaches an element', () => {
    // The bug this law exists to keep out: the store holds 0..100 and
    // HTMLMediaElement.volume speaks 0..1, and the old inline product could hand
    // e.g. 100 straight to the element, which Chrome rejects outright.
    const { mixer: m } = build('suspended')
    const el = fakeElement('https://cdn.example.com/b.mp4')
    assert.equal(m.attach('b', el), false, 'a cross-origin element is not routed')
    m.apply('b', 100, 1)
    assert.equal(el.volume, 1)
    m.apply('b', 0.25, 1)
    assert.equal(el.volume, 0.25)
    m.apply('b', -3, 1)
    assert.equal(el.volume, 0)
    m.apply('b', 0.5, NaN)
    assert.equal(el.volume, 0, 'a master that is not a number silences rather than guesses')
  })

  await check('a cross-origin source is not routed, because a graph would mute it', () => {
    const { graph, mixer: m } = build()
    assert.equal(m.attach('x', fakeElement('https://cdn.example.com/x.mp4')), false)
    assert.equal(m.attach('y', fakeElement('blob:https://app.test/1')), true)
    assert.equal(m.attach('z', fakeElement('/uploads/z.mp4')), true)
    assert.equal(graph.createdSources, 2, 'only the routable elements were routed')
  })

  await check('every leg of the routability rule is asked on its own', () => {
    // The check above runs in a Node harness where `pageOrigin()` is empty, so a
    // cross-origin address is refused by the missing origin *and* by the
    // comparison — either leg alone survives a mutation of the other. Calling
    // the law with an origin hands each leg its own question.
    const routable = mixer.isRoutableMediaSrc
    assert.equal(routable('https://cdn.example.com/x.mp4', 'https://app.test'), false, 'a foreign origin is not routed')
    assert.equal(routable('https://app.test/x.mp4', 'https://app.test'), true, 'the page origin is')
    assert.equal(routable('https://app.test/x.mp4', ''), false, 'no page origin means no https route at all')
    assert.equal(routable('media://local/x.mp4', 'https://app.test'), false, 'the desktop scheme is not a page origin')
    assert.equal(routable('', 'https://app.test'), false, 'an empty address routes nothing')
  })

  await check('an unlocked graph routes nothing, so the preview is never silent', () => {
    // Autoplay policy: the context exists but no gesture has resumed it. A
    // routed element would then feed a suspended graph — silence — while the
    // same element with its own volume would still be heard.
    for (const state of ['suspended', 'closed'] as const) {
      const { graph, mixer: m } = build(state)
      const el = fakeElement()
      assert.equal(m.attach(`k-${state}`, el), false)
      assert.equal(graph.createdSources, 0)
      m.apply(`k-${state}`, 0.6, 1)
      assert.equal(el.volume, 0.6, `${state}: the element still speaks`)
    }
  })

  await check('one element gets one source node', () => {
    const { graph, mixer: m } = build()
    const el = fakeElement()
    assert.equal(m.attach('a', el), true)
    assert.equal(m.attach('a', el), true, 're-attaching the same pair answers the same')
    assert.equal(graph.createdSources, 1, 'createMediaElementSource throws on a second call')
  })

  await check('a key that re-registers to another element gives back the old node', () => {
    const { graph, mixer: m } = build()
    const first = fakeElement('/uploads/1.mp4')
    const second = fakeElement('/uploads/2.mp4')
    m.attach('a', first)
    m.attach('a', second)
    assert.equal(graph.createdSources, 2)
    assert.equal(m.routed().length, 1)
    m.apply('a', 0.5, 1)
    assert.equal(m.gainOf('a'), 0.5)
    assert.equal(first.volume, 1, 'the element the plan left behind is no longer written')
  })

  await check('the plan is the only set that sounds', () => {
    const { mixer: m } = build()
    m.attach('a', fakeElement())
    m.attach('b', fakeElement())
    m.applyPlan(new Map([['a', 0.4]]), 1)
    assert.equal(m.gainOf('a'), 0.4)
    assert.equal(m.gainOf('b'), 0, 'a source the plan does not name is silence, not its last gain')
    m.applyPlan(new Map([['b', 0.7]]), 1)
    assert.equal(m.gainOf('a'), 0)
    assert.equal(m.gainOf('b'), 0.7)
  })

  await check('the master rides the bus, not every layer', () => {
    const { graph, mixer: m } = build()
    m.attach('a', fakeElement())
    m.applyPlan(new Map([['a', 0.5]]), 0.4)
    assert.equal(m.gainOf('a'), 0.5, 'the layer keeps the number core answered')
    assert.equal(m.masterGain(), 0.4)
    const muted = fakeElement('https://cdn.example.com/v.mp4')
    m.attach('v', muted)
    m.applyPlan(new Map([['a', 0.5], ['v', 0.8]]), 0.25)
    assert.equal(muted.volume, 0.2, 'an unrouted element still hears the master')
    assert.equal(m.masterGain(), 0.25)
    assert.equal(graph.routedElements.length, 1, 'only the routable element is in the graph')
  })

  await check('a master that is not a number silences rather than guesses', () => {
    const { mixer: m } = build()
    m.attach('a', fakeElement())
    m.applyPlan(new Map([['a', 0.5]]), NaN)
    assert.equal(m.masterGain(), 0, 'the bus carries the silence')
    assert.equal(m.gainOf('a'), 0.5, 'and the layer keeps the number core answered')
  })

  await check('detach gives the node back and stops writing that element', () => {
    const { mixer: m } = build()
    const el = fakeElement()
    m.attach('a', el)
    m.apply('a', 0.5, 1)
    m.detach('a')
    assert.deepEqual(m.routed(), [])
    assert.equal(m.gainOf('a'), null, 'a detached key is not a node any more')
    m.apply('a', 0.2, 1)
    assert.equal(el.volume, 1, 'an element the mixer no longer holds is not written')
  })

  await check('a graph that dies mid-session falls back to the elements', () => {
    // An AudioContext can close on its own (a suspended tab, a device change).
    // The mix must not become silence — it becomes what it was before G3.
    const { graph, mixer: m } = build()
    const el = fakeElement()
    m.attach('a', el)
    m.apply('a', 0.5, 1)
    m.dispose()
    assert.equal(graph.routedElements.length, 1, 'nothing new was routed')
    assert.equal(graph.sourceNodes[0].disconnects, 1, 'the source node was given back')
    assert.equal(m.gainOf('a'), null)
    m.apply('a', 0.3, 1)
    assert.equal(el.volume, 0.3, 'after dispose the element is the only path left')
  })

  await check('the player asks the mixer and stops computing gains of its own', () => {
    const player = read('app/components/tmcut/TmcutPreviewPlayer.vue')
    const seam = read('app/composables/useTmcutPlayback.ts')
    assert.match(player, /from '~\/utils\/tmcut\/audioMixer'/, 'the mixer is imported once, from the seam')
    // The playhead evaluation lives in the composable, so the call that reads
    // core's answer lives there too; the player consumes that one answer. An
    // assertion pinned to the player file would only say which file imports the
    // law, not that the player stopped inventing one.
    assert.match(seam, /audioMixAt/, 'the SET of sounding layers is core\'s, read at the playhead')
    assert.match(seam, /audioMix\b/, 'and the composable hands it to the player')
    assert.match(player, /audioMix\b/, 'the player takes the plan instead of a gain of its own')
    assert.doesNotMatch(player, /const videoVolume = computed/, 'the private video gain is gone')
    assert.doesNotMatch(player, /const isVideoMuted = computed/, 'the private track mute is gone')
    assert.doesNotMatch(player, /trackVol \/ 10000/, 'the audio-element percent product is gone')
    assert.doesNotMatch(player, /:volume="/, 'no template volume: the mixer has the only write path')
  })

  await check('the mix law lives in core, not in the player', () => {
    const barrel = read('packages/core/src/index.mjs')
    const types = read('packages/core/src/index.d.ts')
    assert.match(barrel, /from '\.\/audioMix\.mjs'/, 'the module is part of the public surface')
    assert.match(types, /export function audioMixAt/, 'and typed for the app')
  })

  await check('the audio leg takes its TIME from core, not from a private map', () => {
    // G3 retired the level copies; G4 is the half-clock: the position inside the
    // file, the element rate and whether an element can play the clip at all.
    // Each of these was computed somewhere on the screen, so a 6x clip could run
    // its picture at 6x and its sound at 1x, and a ramped bed reached the end of
    // its file late. A source-reading guard is the only way to pin a retirement.
    const player = read('app/components/tmcut/TmcutPreviewPlayer.vue')
    const seam = read('app/composables/useTmcutPlayback.ts')
    assert.match(player, /mediaTicks/, 'the seek target comes from the plan')
    assert.match(seam, /shuttle/, 'the host clock is handed to core, not multiplied afterwards')
    assert.match(seam, /elementRate/, 'the footage rate asks core the same question the audio leg asks')
    assert.doesNotMatch(seam, /Math\.min\(16, Math\.max\(0\.25/, 'the private element-rate clamp is gone')
    assert.doesNotMatch(player, /clipMediaTimeSec/, 'the app-side media map is gone')
    assert.doesNotMatch(player, /clip\.speed >= 0\.25/, 'the app-side audio rate clamp is gone')
    assert.doesNotMatch(player, /if \(clip\.reverse\) continue/, 'a refusal is core\'s answer, not a silent skip')
  })

  console.log(`\n=== Audio mixer: ${passed}/${passed} checks PASSED ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
