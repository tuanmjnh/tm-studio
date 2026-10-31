/**
 * Test harness for the app store (`useTmcutProject`) outside the browser.
 *
 * The composable is written for Nuxt (auto-imported Vue APIs, `localStorage`,
 * `import.meta.server`) but touches DOM globals only behind guards, so with
 * these two shims it runs in plain Node. That gives the store — split, trim,
 * ripple, undo, transitions — real behavioural coverage, which is the layer
 * C16-R3 needs: unit tests of the render strings alone cannot catch a
 * seconds/ticks mix-up inside the store.
 *
 * Import this module BEFORE `~/composables/useTmcutProject`.
 */
import * as Vue from 'vue'

// Nuxt auto-imports Vue APIs as globals; expose them for the Node runtime.
const globalScope = globalThis as Record<string, unknown>
for (const [key, value] of Object.entries(Vue)) {
  if (!(key in globalScope)) globalScope[key] = value
}

const backing = new Map<string, string>()
const storage: Storage = {
  get length() { return backing.size },
  clear: () => backing.clear(),
  key: (index: number) => [...backing.keys()][index] ?? null,
  getItem: (key: string) => (backing.has(key) ? backing.get(key)! : null),
  setItem: (key: string, value: string) => { backing.set(key, String(value)) },
  removeItem: (key: string) => { backing.delete(key) }
}
if (!('localStorage' in globalScope)) globalScope.localStorage = storage

export const TICKS = 120000

/** Fresh project + cleared selection; returns the store instance. */
export async function freshStore() {
  const { useTmcutProject } = await import('../../../app/composables/useTmcutProject')
  const store = useTmcutProject()
  store.createProject(`test-${Math.random().toString(36).slice(2, 8)}`)
  store.selectClip(null)
  return store
}

/** Read a clip straight off the video track (raw store fields). */
export function videoClip(store: Awaited<ReturnType<typeof freshStore>>, id: string) {
  const track = store.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!
  return track.items!.find(i => i.id === id)!
}
