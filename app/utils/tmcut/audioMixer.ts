// The preview mix (zero-FFmpeg slice G3, ADR-033).
//
// One question — "what does this timeline sound like at this tick" — is
// answered by core: `evaluateTimeline` multiplies the keyframed clip volume,
// the track volume and the fade envelope into `layer.volume`, folds the track's
// mute into `layer.audible`, and `audioMixAt` names the layers that get to
// sound at all. This file holds none of that arithmetic. It owns the graph:
// one node per sounding source, one bus for the monitoring level, and one write
// path so a caller never has to know whether the element it is holding is
// routed.
//
// What the file refuses to do:
//  - route an element twice. `createMediaElementSource` throws on a second call
//    for the same element, so a re-attach of the same pair answers the same
//    node instead of building a second one;
//  - route a cross-origin source. The CORS rules silence a tainted media
//    element the moment it enters a graph, so a stock clip would go from
//    audible to mute — the refusal keeps it on its own volume instead;
//  - route into a graph the user has not unlocked. An AudioContext created
//    before a gesture stays `suspended`, and a routed element inside one is
//    silence; before the first play click the mix therefore rides the elements;
//  - write both paths at once. A routed element is set to unity once, when it
//    enters the graph, and never written again — node AND element attenuation
//    would square every gain;
//  - become silence when the graph dies. `dispose` gives the nodes back and
//    leaves the element path working, so a closed context costs the mix its
//    graph, not its sound.

/** The part of a media element the mixer touches. */
export interface TmcutMixElement {
  volume: number
  src?: string
  currentSrc?: string
}

/** A gain in the graph — a layer's node or the monitoring bus. */
export interface TmcutMixGainNode {
  gain: { value: number }
  connect(target: unknown): void
  disconnect(): void
}

/** The routing a media element gets when it enters the graph. */
export interface TmcutMixSourceNode {
  connect(target: unknown): void
  disconnect(): void
}

/** The slice of Web Audio this mixer needs, so a test can hand a fake. */
export interface TmcutMixGraph {
  readonly state: string
  readonly destination: unknown
  createGain(): TmcutMixGainNode
  createMediaElementSource(element: TmcutMixElement): TmcutMixSourceNode
}

export interface TmcutAudioMixer {
  /** Route one element under one key. False when the graph or the source refuses it. */
  attach(key: string, element: TmcutMixElement): boolean
  /** Give a key's nodes back and stop writing its element. */
  detach(key: string): void
  /** The one write path: the node when routed, the element when not. */
  apply(key: string, gain: number, master: number): void
  /** Every held key sounds or is silent — a source the plan omits is silence. */
  applyPlan(plan: Map<string, number>, master: number): void
  /** The gain the node holds, or null when the key is not routed. */
  gainOf(key: string): number | null
  /** The monitoring level the last write set. */
  masterGain(): number
  routed(): string[]
  /** Give the whole graph back; the element path keeps working after this. */
  dispose(): void
}

/** Percent-free: everything the mix speaks is linear 0..1, and nothing guesses. */
function clampUnit(value: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
}

/** The address the browser will let a routed element play from. */
function pageOrigin(): string {
  const location = (globalThis as { location?: { origin?: string } }).location
  return typeof location?.origin === 'string' ? location.origin : ''
}

/** What the element actually plays now, which is not always what was authored. */
function playedSrc(element: TmcutMixElement): string {
  return String(element.currentSrc || element.src || '')
}

/**
 * May this source enter a graph? `blob:`/`data:` and same-origin files yes;
 * a cross-origin file no, because a CORS-tainted element is muted inside a
 * graph; and a host scheme this code cannot prove same-origin (desktop's
 * `media://local`) no, so it keeps the volume it already had.
 */
export function isRoutableMediaSrc(src: string | null | undefined, origin = pageOrigin()): boolean {
  const value = String(src ?? '').trim()
  if (!value) return false
  if (value.startsWith('blob:') || value.startsWith('data:')) return true
  if (value.startsWith('/')) return true
  if (!/^https?:/i.test(value)) return false
  if (!origin) return false
  try {
    return new URL(value).origin === origin
  } catch {
    return false
  }
}

/**
 * The mixer. `openGraph` is a parameter rather than an `new AudioContext()`
 * inside the law: the browser needs a gesture before a context runs, the app
 * decides when that gesture happened, and every rule above — routing, refusal,
 * fallback, silence for unplanned keys — has to be testable without an audio
 * device.
 */
export function createAudioMixer(openGraph: () => TmcutMixGraph | null): TmcutAudioMixer {
  const held = new Map<string, TmcutMixElement>()
  const nodes = new Map<string, { element: TmcutMixElement, source: TmcutMixSourceNode, gain: TmcutMixGainNode }>()
  let bus: TmcutMixGainNode | null = null
  let busValue = 1
  let discarded = false

  function giveBack(entry: { source: TmcutMixSourceNode, gain: TmcutMixGainNode }) {
    entry.gain.disconnect()
    entry.source.disconnect()
  }

  function attach(key: string, element: TmcutMixElement): boolean {
    if (discarded) return false
    held.set(key, element)
    const graph = openGraph()
    const routable = graph !== null
      && graph.state === 'running'
      && isRoutableMediaSrc(playedSrc(element))
    const existing = nodes.get(key)
    if (!routable || graph === null) {
      if (existing) {
        giveBack(existing)
        nodes.delete(key)
      }
      return false
    }
    // The same element under the same key is the same route — a per-frame sync
    // must not build a second source node, which the browser forbids anyway.
    if (existing) {
      if (existing.element === element) return true
      giveBack(existing)
      nodes.delete(key)
    }
    if (!bus) {
      bus = graph.createGain()
      bus.gain.value = busValue
      bus.connect(graph.destination)
    }
    const source = graph.createMediaElementSource(element)
    const gain = graph.createGain()
    // A node nobody has planned yet is silence, not last-session's level.
    gain.gain.value = 0
    gain.connect(bus)
    source.connect(gain)
    // The element stops being an attenuator the moment the node starts.
    element.volume = 1
    nodes.set(key, { element, source, gain })
    return true
  }

  function detach(key: string) {
    const existing = nodes.get(key)
    if (existing) {
      giveBack(existing)
      nodes.delete(key)
    }
    held.delete(key)
  }

  function apply(key: string, gain: number, master: number) {
    const layer = clampUnit(gain)
    const level = clampUnit(master)
    const entry = nodes.get(key)
    if (entry) {
      entry.gain.gain.value = layer
      if (bus) bus.gain.value = level
      busValue = level
      return
    }
    busValue = level
    const element = held.get(key)
    // Unrouted is not broken: it is the pre-G3 path, and the only one a
    // suspended or cross-origin source has.
    if (element) element.volume = layer * level
  }

  function applyPlan(plan: Map<string, number>, master: number) {
    const level = clampUnit(master)
    for (const [key, gain] of plan) apply(key, gain, level)
    for (const key of held.keys()) {
      if (!plan.has(key)) apply(key, 0, level)
    }
  }

  function dispose() {
    for (const entry of nodes.values()) giveBack(entry)
    nodes.clear()
    if (bus) bus.disconnect()
    bus = null
    discarded = true
  }

  return {
    attach,
    detach,
    apply,
    applyPlan,
    gainOf: (key) => {
      const entry = nodes.get(key)
      return entry ? entry.gain.gain.value : null
    },
    masterGain: () => busValue,
    routed: () => [...nodes.keys()],
    dispose
  }
}
