import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScript, parse } from 'vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, createSSRApp, defineComponent, h, nextTick, reactive } from 'vue'
import type { App, Component, Slots, VNode } from 'vue'
import { renderToString } from 'vue/server-renderer'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const t = (key: string) => `localized:${key}`
const require = createRequire(import.meta.url)

/** Compile the real SFCs, replacing only Nuxt's auto-import boundary. */
function loadComponent(name: string): Component {
  const filename = join(root, 'app/components/tmcut', `${name}.vue`)
  const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename })
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: name, inlineTemplate: true })
  const result = ts.transpileModule(script.content, {
    fileName: `${name}.ts`,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true
  })
  assert.deepEqual(result.diagnostics, [])
  const compiled = { exports: {} as { default: Component } }
  const scopedRequire = (id: string) => id === '#components' ? components : require(id)
  new Function('require', 'module', 'exports', result.outputText)(scopedRequire, compiled, compiled.exports)
  return compiled.exports.default
}

// This contract double deliberately treats UModal's default slot as a trigger,
// not its body. Focus trapping/portals remain Nuxt UI/Reka's responsibility.
const Modal = defineComponent({
  inheritAttrs: false,
  props: ['open', 'title', 'description', 'close', 'dismissible', 'ui'],
  emits: ['update:open'],
  setup(props, { slots, emit }) {
    const close = () => emit('update:open', false)
    return () => h('div', { 'data-modal': true, 'forwarded': { ...props }, 'onOpen': () => emit('update:open', true) }, [
      slots.default?.(),
      props.open
        ? h('section', { role: 'dialog' }, [
            h('h2', props.title),
            props.description ? h('p', props.description) : null,
            props.close !== false ? h('button', { 'data-close': true, ...props.close, 'onClick': close }) : null,
            slots.body?.({ close }),
            slots.footer?.({ close })
          ])
        : null
    ])
  }
})
const Button = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) { return () => h('button', attrs, slots.default?.()) }
})
const Input = defineComponent({
  inheritAttrs: false,
  props: ['modelValue'],
  emits: ['update:modelValue'],
  setup(props, { attrs, emit }) {
    return () => h('input', {
      ...attrs,
      value: props.modelValue,
      onInput: (event: { target: { value: string } }) => emit('update:modelValue', event.target.value)
    })
  }
})
const Field = defineComponent({
  setup(_, { attrs, slots }) { return () => h('label', [String(attrs.label || ''), slots.default?.()]) }
})
const Icon = defineComponent({
  setup() { return () => h('i') }
})
const components: Record<string, Component> = {
  UModal: Modal,
  UButton: Button,
  UInput: Input,
  UFormField: Field,
  UIcon: Icon,
  TmcutButton: Button
}
components.TmcutPlaceholderEditor = loadComponent('TmcutPlaceholderEditor')
const Customize = loadComponent('TmcutTemplateCustomizeModal')
const SharedModal = loadComponent('TmcutModal')

function configure(app: App) {
  for (const [name, component] of Object.entries(components)) app.component(name, component)
  app.config.globalProperties.$t = t
  return app
}

interface TestNode {
  type: string
  props: Record<string, unknown>
  children: TestNode[]
  parent: TestNode | null
  text: string
  value?: string
  listeners: Record<string, ((event: unknown) => void)[]>
  addEventListener: (name: string, callback: (event: unknown) => void) => void
}
function node(type: string, text = ''): TestNode {
  const listeners: TestNode['listeners'] = {}
  return {
    type, props: {}, children: [], parent: null, text, listeners,
    addEventListener(name, callback) { (listeners[name] ||= []).push(callback) }
  }
}
const renderer = createRenderer<TestNode, TestNode>({
  createElement: type => node(type),
  createText: text => node('#text', text),
  createComment: text => node('#comment', text),
  setText: (el, text) => { el.text = text },
  setElementText: (el, text) => {
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
  const warnings: string[] = []
  const app = configure(renderer.createApp({ render }))
  app.config.warnHandler = message => warnings.push(message)
  app.mount(container)
  return { container, warnings, unmount: () => app.unmount() }
}
function findAll(container: TestNode, predicate: (node: TestNode) => boolean): TestNode[] {
  return [container, ...container.children.flatMap(child => findAll(child, predicate))].filter(predicate)
}
function find(container: TestNode, predicate: (node: TestNode) => boolean): TestNode {
  const found = findAll(container, predicate)[0]
  assert.ok(found, 'expected rendered node')
  return found
}
function invoke(el: TestNode, key: string, value?: unknown) {
  const handlers = el.props[key]
  for (const handler of Array.isArray(handlers) ? handlers : [handlers]) {
    assert.equal(typeof handler, 'function', `expected ${key} handler`)
    handler(value)
  }
}
function enter(el: TestNode, value: string) {
  el.value = value
  const event = { target: el }
  for (const handler of el.listeners.input || []) handler(event)
  invoke(el, 'onInput', event)
}
function text(el: TestNode): string {
  return el.text + el.children.map(text).join('')
}

const template = {
  name: 'Launch', aspectRatio: '16:9', durationTicks: 120,
  placeholders: [
    { id: 'headline', label: 'Headline', type: 'text' as const },
    { id: 'caption', label: 'Caption', type: 'text' as const }
  ]
}
function customizeProps() {
  return {
    open: true, activeTemplate: template, projectNameInput: 'Launch project',
    placeholderTextInputs: { headline: 'Initial headline', caption: 'Initial caption' },
    isCreating: false, activeReadiness: null,
    assetInstallState: () => 'catalog', assetTitle: (id: string) => id,
    tts: () => '2'
  }
}

describe('template customization modal', () => {
  it('hides all content when closed (including the default-slot trigger boundary)', async () => {
    const app = configure(createSSRApp({ render: () => h(Customize, { ...customizeProps(), open: false }) }))
    const html = await renderToString(app)
    assert.ok(!html.includes('Launch project'), 'closed modal must not render editable content')
    assert.ok(!html.includes('role="dialog"'))
    assert.ok(!html.includes(t('tmcut.templateLibrary.createProjectBtn')))
  })

  it('forwards open/close updates and supplies the accessible heading and description', async () => {
    const props = reactive(customizeProps())
    const updates: boolean[] = []
    const view = mount(() => h(Customize, {
      ...props,
      'onUpdate:open': (value: boolean) => {
        updates.push(value)
        props.open = value
      }
    }))
    try {
      const modal = find(view.container, el => !!el.props['data-modal'])
      assert.equal((modal.props.forwarded as Record<string, unknown>).open, true)
      assert.equal(text(find(view.container, el => el.type === 'h2')), t('tmcut.templateLibrary.modalTitle'))
      assert.ok(text(view.container).includes('Launch · 16:9 (2s)'))
      invoke(find(view.container, el => !!el.props['data-close']), 'onClick')
      await nextTick()
      assert.deepEqual(updates, [false])
      assert.equal(findAll(view.container, el => el.type === 'input').length, 0)
      invoke(modal, 'onOpen')
      await nextTick()
      assert.deepEqual(updates, [false, true])
      invoke(find(view.container, el => el.type === 'button' && text(el) === t('tmcut.hotkeys.close')), 'onClick')
      assert.deepEqual(updates, [false, true, false])
    } finally { view.unmount() }
  })

  it('emits project-name edits without mutating props and reflects parent updates', async () => {
    const props = reactive(customizeProps())
    const updates: string[] = []
    const view = mount(() => h(Customize, { ...props, 'onUpdate:projectNameInput': (value: string) => updates.push(value) }))
    try {
      const input = findAll(view.container, el => el.type === 'input')[0]!
      enter(input, 'Edited project')
      assert.deepEqual(updates, ['Edited project'])
      assert.equal(props.projectNameInput, 'Launch project')
      assert.deepEqual(view.warnings, [], 'editing must not attempt to mutate a readonly prop')
      props.projectNameInput = 'Parent replacement'
      await nextTick()
      assert.equal(findAll(view.container, el => el.type === 'input')[0]!.props.value, 'Parent replacement')
    } finally { view.unmount() }
  })

  it('displays parent placeholders and preserves sibling edits through the customize boundary', async () => {
    const props = reactive(customizeProps())
    const original = props.placeholderTextInputs
    const view = mount(() => h(Customize, {
      ...props,
      'onUpdate:placeholderTextInputs': (value: typeof props.placeholderTextInputs) => { props.placeholderTextInputs = value }
    }))
    try {
      let inputs = findAll(view.container, el => el.type === 'input')
      assert.deepEqual(inputs.slice(1).map(el => el.props.value), ['Initial headline', 'Initial caption'])
      enter(inputs[1]!, 'Edited headline')
      await nextTick()
      inputs = findAll(view.container, el => el.type === 'input')
      enter(inputs[2]!, 'Edited caption')
      await nextTick()
      assert.deepEqual(props.placeholderTextInputs, { headline: 'Edited headline', caption: 'Edited caption' })
      assert.deepEqual(original, { headline: 'Initial headline', caption: 'Initial caption' })
    } finally { view.unmount() }
  })

  it('keeps creation loading/disabled and prevents duplicate confirmation', async () => {
    const props = reactive(customizeProps())
    let confirmed = 0
    const view = mount(() => h(Customize, { ...props, onConfirm: () => confirmed++ }))
    try {
      const button = find(view.container, el => el.type === 'button' && text(el) === t('tmcut.templateLibrary.createProjectBtn'))
      invoke(button, 'onClick')
      assert.equal(confirmed, 1)
      props.isCreating = true
      await nextTick()
      assert.equal(button.props.disabled, true)
      assert.equal(button.props.loading, true)
      const inputs = findAll(view.container, el => el.type === 'input')
      assert.deepEqual(inputs.map(el => el.props['aria-label']), [t('tmcut.templateLibrary.projectNameLabel'), 'Headline', 'Caption'])
      assert.ok(inputs.every(el => el.props.disabled === true))
      assert.equal(findAll(view.container, el => !!el.props['data-close']).length, 0, 'creating must hide the dismiss control')
      invoke(button, 'onClick')
      assert.equal(confirmed, 1)
    } finally { view.unmount() }
  })
})

describe('controlled placeholder editor', () => {
  it('merges sibling edits into the latest props without mutating the previous map', async () => {
    const original = Object.freeze({ headline: 'Initial headline', caption: 'Initial caption' })
    const state = reactive<{ textInputs: Record<string, string> }>({ textInputs: original })
    const view = mount(() => h('div', template.placeholders.map(placeholder => h(components.TmcutPlaceholderEditor!, {
      placeholder, 'textInputs': state.textInputs,
      'onUpdate:text-inputs': (value: Record<string, string>) => { state.textInputs = value }
    }))))
    try {
      enter(findAll(view.container, el => el.type === 'input')[0]!, 'First edit')
      await nextTick()
      enter(findAll(view.container, el => el.type === 'input')[1]!, 'Second edit')
      await nextTick()
      assert.deepEqual(state.textInputs, { headline: 'First edit', caption: 'Second edit' })
      assert.notEqual(state.textInputs, original)
      assert.deepEqual(original, { headline: 'Initial headline', caption: 'Initial caption' })
    } finally { view.unmount() }
  })

  it('refreshes reused placeholder IDs when the parent switches templates, including empty values', async () => {
    const state = reactive({ textInputs: { headline: 'Old headline', caption: 'Old caption' } })
    const view = mount(() => h(components.TmcutPlaceholderEditor!, {
      'placeholder': template.placeholders[0], 'textInputs': state.textInputs,
      'onUpdate:text-inputs': (value: typeof state.textInputs) => { state.textInputs = value }
    }))
    try {
      state.textInputs = { headline: '', caption: 'New caption' }
      await nextTick()
      const input = find(view.container, el => el.type === 'input')
      assert.equal(input.props.value, '')
      enter(input, 'New headline')
      assert.deepEqual(state.textInputs, { headline: 'New headline', caption: 'New caption' })
    } finally { view.unmount() }
  })
})

describe('shared TMCut modal', () => {
  async function render(open: boolean, slots: Partial<Slots>) {
    return renderToString(configure(createSSRApp({ render: () => h(SharedModal, { open, title: 'Delete template' }, slots) })))
  }

  it('renders delete #body content and footer, preferring #body over the legacy default slot', async () => {
    const html = await render(true, {
      body: () => h('p', 'Delete Launch permanently?'),
      default: () => h('p', 'Legacy fallback'),
      footer: () => h('button', 'Confirm deletion')
    })
    assert.ok(html.includes('Delete Launch permanently?'))
    assert.ok(html.includes('Confirm deletion'))
    assert.ok(!html.includes('Legacy fallback'))
  })

  it('keeps the legacy default slot in the body and hides body/footer when closed', async () => {
    const slots = { default: () => h('p', 'Rename project'), footer: () => h('button', 'Save project') }
    assert.ok((await render(true, slots)).includes('Rename project'))
    const closed = await render(false, slots)
    assert.ok(!closed.includes('Rename project'))
    assert.ok(!closed.includes('Save project'))
  })

  it('delegates sizes, dismissal, localized close and scoped footer close to Nuxt UModal', async () => {
    const props = reactive({ open: true, showClose: true, closeOnOverlayClick: false, size: 'sm' })
    const updates: boolean[] = []
    const view = mount(() => h(SharedModal, {
      ...props, 'title': 'Delete template', 'description': 'Cannot be undone',
      'onUpdate:open': (value: boolean) => {
        updates.push(value)
        props.open = value
      }
    }, {
      body: () => h('p', 'Delete body'),
      footer: ({ close }: { close: () => void }) => h('button', { 'data-footer': true, 'onClick': close }, 'Cancel')
    }))
    try {
      const modal = find(view.container, el => !!el.props['data-modal'])
      let forwarded = modal.props.forwarded as Record<string, unknown>
      assert.equal(forwarded.title, 'Delete template')
      assert.equal(forwarded.description, 'Cannot be undone')
      assert.equal(forwarded.dismissible, false)
      // Nuxt UI supplies the localized accessible name for the default close button.
      assert.equal(forwarded.close, true)
      for (const [size, width] of Object.entries({ sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-xl', full: 'max-w-4xl' })) {
        props.size = size
        await nextTick()
        forwarded = modal.props.forwarded as Record<string, unknown>
        assert.ok(String((forwarded.ui as Record<string, unknown>).content).includes(width))
      }
      props.showClose = false
      props.closeOnOverlayClick = true
      await nextTick()
      forwarded = modal.props.forwarded as Record<string, unknown>
      assert.equal(forwarded.close, false)
      assert.equal(forwarded.dismissible, true)
      invoke(find(view.container, el => !!el.props['data-footer']), 'onClick')
      await nextTick()
      assert.deepEqual(updates, [false])
      assert.equal(findAll(view.container, el => el.props.role === 'dialog').length, 0)
      invoke(modal, 'onOpen')
      assert.deepEqual(updates, [false, true])
    } finally { view.unmount() }
  })
})

it('loads demand-only template panels and modals through Nuxt Lazy references', () => {
  const page = read('app/pages/tmcut/templates.vue')
  for (const name of ['TmcutTemplateCustomizeModal', 'TmcutModal', 'TmcutAiTemplates', 'TmcutVideoTemplateStudio', 'TmcutVideoFactory', 'TmcutMarketplace']) {
    assert.match(page, new RegExp(`<Lazy${name}\\b`))
    assert.doesNotMatch(page, new RegExp(`<${name}\\b`))
    const { descriptor } = parse(page)
    assert.doesNotMatch(descriptor.scriptSetup!.content, new RegExp(`\\b${name}\\b`))
  }
})
