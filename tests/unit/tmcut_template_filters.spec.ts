/**
 * Template-library facet filtering (`TmcutFilterChips` + `useTmcutTemplates`).
 *
 * Two defects found by driving /tmcut/templates in a real browser, neither of
 * which `nuxt typecheck` can see:
 *
 *  1. The category chips are a single-select group (`:max-selected="1"`) that
 *     also carries an 'all' entry. The component's multi-select rule — freeze
 *     every sibling once the limit is reached — therefore disabled all seven
 *     chips as soon as 'all' was on, i.e. after ANY deselect or Reset click.
 *     The filter bar was unreachable in normal use, and the only way out was
 *     reloading the page.
 *  2. The number printed on a chip was a count over ALL templates while the
 *     grid was filtered by ratio + search too, so "Outro & End Cards 1" stayed
 *     on screen for a 9:16 selection whose grid is empty. Selecting it proved
 *     the number a lie. "My Templates" had the mirror problem: it filtered
 *     `category === 'custom'`, so a template saved from the AI builder (which
 *     keeps its brief's category, e.g. intro) was badged Custom but could not
 *     be reached through the chip that promises the user's own templates.
 *  3. Both filter bars announced themselves to assistive tech with a
 *     hard-coded English string baked into the component, so a Vietnamese
 *     session still read "Filter chips"/"Segmented control" — the bars are
 *     now named from the page through the `label` prop.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_template_filters.spec.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import './helpers/tmcut_store_env' // side effects FIRST: Vue globals + localStorage (the SFCs use Nuxt's auto-imports)
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScript, parse } from 'vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, h, nextTick, reactive } from 'vue'
import type { App, Component, VNode } from 'vue'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(import.meta.url)

function loadComponent(name: string): Component {
  const filename = join(root, 'app/components/tmcut', `${name}.vue`)
  const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename })
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: name, inlineTemplate: true })
  const output = ts.transpileModule(script.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const compiled = { exports: {} as { default: Component } }
  // Only the Nuxt auto-import boundary is stubbed; '~/' helpers load for real.
  const scopedRequire = (id: string) => {
    if (id === '#components') return stubs
    if (id.startsWith('~/') || id.startsWith('@/')) {
      const base = join(root, 'app', id.slice(2))
      for (const ext of ['.ts', '.mjs', '.js', '']) {
        if (existsSync(base + ext)) return require(base + ext)
      }
      throw new Error(`cannot resolve ${id} from ${base}`)
    }
    return require(id)
  }
  new Function('require', 'module', 'exports', output)(scopedRequire, compiled, compiled.exports)
  return compiled.exports.default
}

const Icon = {
  setup() { return () => h('i') }
} as unknown as Component
const stubs: Record<string, unknown> = { UIcon: Icon }

interface TestNode {
  type: string
  props: Record<string, unknown>
  children: TestNode[]
  parent: TestNode | null
  text: string
}
function node(type: string, text = ''): TestNode {
  return { type, props: {}, children: [], parent: null, text }
}
const renderer = createRenderer<TestNode, TestNode>({
  createElement: type => node(type),
  createText: text => node('#text', text),
  createComment: text => node('#comment', text),
  setText: (el, text) => { el.text = text },
  setElementText(el, text) {
    el.text = text
    el.children = []
  },
  parentNode: el => el.parent,
  nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] || null,
  patchProp: (el, key, _, value) => { el.props[key] = value },
  insert(el, parent, anchor) {
    if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1)
    el.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(el)
    else parent.children.splice(index, 0, el)
  },
  remove(el) {
    if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1)
    el.parent = null
  }
})
function mount(render: () => VNode) {
  const container = node('root')
  const app: App = renderer.createApp({ render })
  for (const [name, component] of Object.entries(stubs)) app.component(name, component)
  app.mount(container)
  return { container, unmount: () => app.unmount() }
}
function findAll(el: TestNode, predicate: (n: TestNode) => boolean): TestNode[] {
  return [el, ...el.children.flatMap(child => findAll(child, predicate))].filter(predicate)
}
function text(el: TestNode): string {
  // v-if/v-else leave comment nodes in the tree (their block is the condition
  // source), and adjacent spans need a separator or "All Categories" + "7"
  // reads as one token.
  return [el.type === '#comment' ? '' : el.text, ...el.children.map(text)].filter(Boolean).join(' ')
}

const Chips = loadComponent('TmcutFilterChips')

/** The library's own option list: 'all' first, then facets, then ownership. */
const OPTIONS = [
  { value: 'all', label: 'All Categories', count: 7 },
  { value: 'intro', label: 'Intro & Openers', count: 3 },
  { value: 'outro', label: 'Outro & End Cards', count: 1 },
  { value: 'custom', label: 'My Templates', count: 1 }
]

function chip(container: TestNode, value: string) {
  const label = OPTIONS.find(o => o.value === value)!.label
  return findAll(container, el => el.type === 'button' && text(el).includes(label))[0]
}

function mountChips(initial: string[], maxSelected: number | undefined, label?: string) {
  const emitted: string[][] = []
  // The page owns the selection in a ref and writes each emit straight back
  // into the prop. A static prop would hide the very defect under test: the
  // second click would still see `['all']`, so the component's "limit reached"
  // branch would look like it had never fired.
  const state = reactive<{ modelValue: string[] }>({ modelValue: [...initial] })
  const view = mount(() => h(Chips, {
    'modelValue': state.modelValue,
    'options': OPTIONS,
    'max-selected': maxSelected,
    ...(label === undefined ? {} : { label }),
    'onUpdate:modelValue': (value: string[]) => {
      emitted.push(value)
      state.modelValue = value
    }
  }))
  return { ...view, emitted, state }
}

function group(container: TestNode) {
  return findAll(container, el => el.props.role === 'group')[0]
}

describe('template library category chips stay usable (single select)', () => {
  it('does not freeze the group when the "all" entry is the selected one', () => {
    const view = mountChips(['all'], 1)
    try {
      for (const value of ['intro', 'outro', 'custom']) {
        const chipEl = chip(view.container, value)
        assert.ok(chipEl, `chip ${value} renders`)
        assert.notEqual(chipEl.props.disabled, true, `chip ${value} must stay clickable while "all" is on`)
        assert.ok(!String(chipEl.props.class || '').includes('cursor-not-allowed'), `chip ${value} must not look dead`)
      }
      assert.equal(chip(view.container, 'all').props['aria-pressed'], true, '"all" is the active facet')
    } finally { view.unmount() }
  })

  it('replaces the selection instead of ignoring the click', async () => {
    const view = mountChips(['all'], 1)
    try {
      chip(view.container, 'intro').props.onClick?.()
      await nextTick()
      assert.deepEqual(view.emitted, [['intro']])
      // From a real facet, switching to another facet also replaces (the
      // multi-select "limit reached" branch must never swallow it).
      chip(view.container, 'outro').props.onClick?.()
      await nextTick()
      assert.deepEqual(view.emitted, [['intro'], ['outro']])
      // Clicking the pressed chip clears the facet.
      chip(view.container, 'outro').props.onClick?.()
      await nextTick()
      assert.deepEqual(view.emitted, [['intro'], ['outro'], []])
    } finally { view.unmount() }
  })

  it('keeps the multi-select limit behaviour it was designed for', () => {
    const view = mountChips(['intro', 'outro'], 2)
    try {
      assert.equal(chip(view.container, 'custom').props.disabled, true, 'a third facet is blocked at max 2')
      assert.equal(chip(view.container, 'intro').props.disabled, false, 'the selected ones stay reachable to unselect')
      assert.equal(chip(view.container, 'all').props.disabled, true)
    } finally { view.unmount() }
  })

  it('blocks nothing when no limit is given', () => {
    const view = mountChips(['intro'], undefined)
    try {
      for (const value of ['all', 'outro', 'custom']) {
        assert.notEqual(chip(view.container, value).props.disabled, true)
      }
    } finally { view.unmount() }
  })

  it('names the group so a screen reader can tell the filter bars apart', () => {
    const unnamed = mountChips(['all'], 1)
    const named = mountChips(['all'], 1, 'Filter templates by category')
    try {
      assert.ok(String(group(unnamed.container).props['aria-label']), 'a group is never left unnamed')
      assert.equal(group(named.container).props['aria-label'], 'Filter templates by category', 'the page passes its translated label through')
    } finally {
      unnamed.unmount()
      named.unmount()
    }
  })
})

describe('ratio/tab bar is named and reports its own state', () => {
  const Segmented = loadComponent('TmcutSegmentedControl')

  function mountSegmented(modelValue: string, label?: string) {
    const emitted: string[] = []
    const state = reactive<{ modelValue: string }>({ modelValue })
    const view = mount(() => h(Segmented, {
      'modelValue': state.modelValue,
      'options': OPTIONS,
      ...(label === undefined ? {} : { label }),
      'onUpdate:modelValue': (value: string) => {
        emitted.push(value)
        state.modelValue = value
      }
    }))
    return { ...view, emitted, state }
  }

  it('takes the accessible name from the page instead of a baked-in string', () => {
    const fallback = mountSegmented('all')
    const named = mountSegmented('all', 'Filter templates by aspect ratio')
    try {
      assert.ok(String(findAll(fallback.container, el => el.props.role === 'radiogroup')[0].props['aria-label']), 'never unnamed')
      assert.equal(
        findAll(named.container, el => el.props.role === 'radiogroup')[0].props['aria-label'],
        'Filter templates by aspect ratio',
        'the translated label reaches the radiogroup'
      )
    } finally {
      fallback.unmount()
      named.unmount()
    }
  })

  it('marks exactly one option checked and switches on click', async () => {
    const view = mountSegmented('all')
    try {
      const checked = () => findAll(view.container, el => el.type === 'button' && el.props['aria-checked'] === true).map(el => text(el).trim())
      assert.deepEqual(checked(), ['All Categories 7'], 'the model value is the checked radio')
      const square = findAll(view.container, el => el.type === 'button' && text(el).includes('My Templates'))[0]
      square.props.onClick?.()
      await nextTick()
      assert.deepEqual(view.emitted, ['custom'], 'clicking reports its own value')
      assert.deepEqual(checked(), ['My Templates 1'], 'and becomes the checked one')
      assert.equal(findAll(view.container, el => el.type === 'button' && text(el).includes('All Categories'))[0].props['aria-checked'], false, 'the previous one clears')
    } finally { view.unmount() }
  })
})

// ---------------------------------------------------------------------------
// Part B — the composable's facet counts. The store harness shims Vue globals
// and localStorage, and MUST be imported before the composable (which
// auto-loads user templates at module scope).
// ---------------------------------------------------------------------------
const storage = globalThis.localStorage
;(globalThis as Record<string, unknown>).window = {}
const storeMod = await import('../../app/composables/useTmcutProject')
;(globalThis as Record<string, unknown>).useTmcutProject = storeMod.useTmcutProject
const { useTmcutTemplates } = await import('../../app/composables/useTmcutTemplates')
const { freshStore } = await import('./helpers/tmcut_store_env')
const TICKS = 120000

const api = useTmcutTemplates()

/** The composable's state is a module singleton shared by the three subtests,
 *  so each one starts from the unfiltered library. */
function resetFacets() {
  api.selectedCategory.value = 'all'
  api.selectedAspectRatio.value = 'all'
  api.searchQuery.value = ''
}

describe('template facet counts describe the grid they filter', () => {
  // The catalogue is data, not a fixture: these assertions derive their
  // expectations from the live builtin library so adding cards (the industry
  // pack added 24) cannot turn a green invariant red.
  it('counts the other facets, not the whole library', async () => {
    resetFacets()
    storage.removeItem('tmcut_user_templates_v2')
    api.userTemplates.value = []

    const builtin = api.filteredTemplates.value.length
    assert.ok(builtin > 0, 'the builtin library is not empty')
    assert.equal(api.categoryCounts.value.all, builtin, 'unfiltered count matches the grid')
    assert.equal(api.categoryCounts.value.custom, 0, 'no owned templates yet')

    api.selectedAspectRatio.value = '9:16'
    const vertical = api.filteredTemplates.value.length
    assert.equal(api.categoryCounts.value.all, vertical, 'vertical count matches the vertical grid')
    assert.ok(vertical > 0 && vertical < builtin, 'the ratio actually narrows the library')
    for (const value of ['all', 'intro', 'outro', 'split-screen', 'promo', 'minimal']) {
      api.selectedCategory.value = value
      assert.equal(
        api.filteredTemplates.value.length,
        api.categoryCounts.value[value] || 0,
        `chip "${value}" must show what it filters (ratio 9:16)`
      )
    }

    const emptyCategory = ['intro', 'outro', 'split-screen', 'promo', 'minimal']
      .find(value => !(api.categoryCounts.value[value] || 0))
    if (emptyCategory) {
      api.selectedCategory.value = emptyCategory
      assert.deepEqual(api.filteredTemplates.value, [], 'selecting a zero facet gives an empty grid, not a phantom count')
    }

    resetFacets()
  })

  it('treats "My Templates" as ownership, so an owned intro template is reachable', async () => {
    resetFacets()
    const beforeAll = api.categoryCounts.value.all
    const beforeIntro = api.categoryCounts.value.intro || 0
    api.selectedAspectRatio.value = '9:16'
    const verticalBefore = api.filteredTemplates.value.length
    resetFacets()

    const store = await freshStore()
    store.addClipToTrack('video', { src: 'a.mp4', in: 0, out: TICKS * 3, offset: 0 })
    const owned = api.saveCurrentProjectAsTemplate({ name: 'Owned Intro', category: 'intro', aspectRatio: '9:16' })
    assert.ok(owned, 'template saved from the timeline')

    assert.equal(api.categoryCounts.value.all, beforeAll + 1, 'library grew by one')
    assert.equal(api.categoryCounts.value.intro, beforeIntro + 1, 'it is an intro by category')
    assert.equal(api.categoryCounts.value.custom, 1, 'and the only owned one')

    api.selectedCategory.value = 'custom'
    assert.deepEqual(api.filteredTemplates.value.map(t => t.name), ['Owned Intro'], 'the ownership facet finds it')
    assert.equal(api.filteredTemplates.value.length, api.categoryCounts.value.custom, 'count = grid')

    api.selectedAspectRatio.value = '9:16'
    assert.equal(api.categoryCounts.value.all, verticalBefore + 1, 'vertical scope covers the owned template too')
    assert.equal(api.filteredTemplates.value.length, api.categoryCounts.value.custom, 'still honest under both facets')
    assert.equal(api.filteredTemplates.value.length, 1, 'the ownership grid holds the owned template only')

    // The vertical library as a whole: every 9:16 builtin + the owned one.
    api.selectedCategory.value = 'all'
    assert.equal(api.filteredTemplates.value.length, verticalBefore + 1, 'all 9:16 builtins + the owned template')

    // The invariant that broke: for every chip, its number must equal the size
    // of the grid that clicking it produces.
    for (const value of ['all', 'intro', 'outro', 'split-screen', 'promo', 'minimal', 'custom']) {
      api.selectedCategory.value = value
      assert.equal(
        api.filteredTemplates.value.length,
        api.categoryCounts.value[value] || 0,
        `chip "${value}" must show what it filters (ratio 9:16)`
      )
    }
    resetFacets()
  })

  it('honours the search facet in the counts as well', () => {
    resetFacets()
    const unfiltered = api.filteredTemplates.value.length
    api.searchQuery.value = 'outro'
    const matches = api.filteredTemplates.value
    assert.ok(matches.length >= 1, 'the search finds the outro card')
    assert.ok(matches.length < unfiltered, 'the search narrows the library')
    assert.equal(api.categoryCounts.value.all, matches.length, 'count = grid')
    assert.equal(
      api.categoryCounts.value.outro || 0,
      matches.filter(t => t.category === 'outro').length,
      'the outro chip counts the matching outro cards'
    )
    assert.equal(
      api.categoryCounts.value.intro || 0,
      matches.filter(t => t.category === 'intro').length,
      'the intro chip counts the matching intro cards'
    )
    resetFacets()
  })
})
