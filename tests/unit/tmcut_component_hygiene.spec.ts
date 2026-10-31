/**
 * R148 specs — component & lifecycle hygiene for the tmcut surfaces.
 *
 * Both bugs here were invisible in `pnpm typecheck` and in every unit suite:
 * they only showed up as console output in the running Electron renderer.
 *
 *  1. `factory.vue` used `<URouterLink>`. Nuxt UI v4 dropped RouterLink
 *     (it ships Link.vue = ULink), so Vue could not resolve the component:
 *     it degraded to an unknown element, the "back to templates" link
 *     rendered as unstyled text, and `[Vue warn]: Failed to resolve
 *     component: URouterLink` fired on /tmcut/factory.
 *  2. `editor.vue` initialized the MCP renderer bridge inside an async
 *     `onMounted` AFTER an await. That loses Vue's instance context, so the
 *     bridge's `useToast()` warned `inject() can only be used inside
 *     setup()` AND its `onBeforeUnmount(teardown)` never registered — one
 *     leaked IPC listener per editor mount.
 *
 * Both checks are generic: the component scan covers every app template, so
 * the next `U*` component that does not exist fails here too.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { parse, compileScript } from 'vue/compiler-sfc'
import ts from 'typescript'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name)
    if (entry.isDirectory()) walk(rel, out)
    else if (entry.name.endsWith('.vue')) out.push(rel)
  }
  return out
}

/** Component NAMES in a tree, from the file basenames (nesting included —
 *  @nuxt/ui keeps e.g. LocaleSelect under components/locale/). */
function componentNames(dir: string): string[] {
  return walk(dir).map(p => p.replace(/\\/g, '/').split('/').pop()!.replace(/\.vue$/, ''))
}

describe('tmcut surfaces use only real components (R148)', () => {
  // Nested component folders count: a flat readdir reported the very real
  // ULocaleSelect (components/locale/LocaleSelect.vue) as missing.
  const uiComponents = componentNames('node_modules/@nuxt/ui/dist/runtime/components')

  it('@nuxt/ui really has no RouterLink (the bug premise)', () => {
    assert.ok(uiComponents.includes('Link'), 'ULink must exist (v4 name for the link component)')
    assert.ok(!uiComponents.includes('RouterLink'), 'URouterLink must NOT exist — did a stray one come back?')
  })

  it('every <U…> tag in app/ resolves to a Nuxt UI component file', () => {
    const files = walk('app')
    const missing: string[] = []
    let seen = 0
    for (const file of files) {
      const src = read(file)
      // Only tag OPENERS count: `</UButton>` and `<NuxtLink>` are not U-components.
      for (const match of src.matchAll(/<U([A-Z][A-Za-z0-9]*)(?=[\s/>])/g)) {
        seen++
        const name = match[1]
        if (!uiComponents.includes(name)) missing.push(`${name} in ${file}`)
      }
    }
    // Guard against a vacuous pass (a broken walk/regex would find nothing).
    assert.ok(seen > 50, `expected many U* components in app/, found ${seen}`)
    assert.deepEqual(missing, [], `unresolved Nuxt UI components: ${missing.join(', ')}`)
  })

  it('no app template still uses the removed URouterLink spelling', () => {
    const offenders = walk('app').filter(f => /<URouterLink[\s/>]/.test(read(f)))
    assert.deepEqual(offenders, [], `use <NuxtLink> (repo convention) instead: ${offenders.join(', ')}`)
  })

  it('factory.vue keeps a working route back to the template library', () => {
    const src = read('app/pages/tmcut/factory.vue')
    assert.ok(/<TmcutButton\b[^>]*\bto="\/tmcut\/templates"/.test(src), 'factory must supply the template route to its button')
    assert.ok(src.includes(`t('tmcut.factory.backToTemplates')`), 'the link must keep its label')
  })
})

describe('TMCut button delegates navigation and state to Nuxt UI', () => {
  const { descriptor } = parse(read('app/components/tmcut/TmcutButton.vue'))
  const script = compileScript(descriptor, { id: 'button-test', inlineTemplate: true })
  const { outputText } = ts.transpileModule(script.content, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
  const compiled = { exports: {} as { default?: Parameters<typeof createSSRApp>[0] } }
  new Function('require', 'module', 'exports', outputText)(createRequire(import.meta.url), compiled, compiled.exports)
  const Button = compiled.exports.default!

  async function render(props: Record<string, unknown>) {
    let forwarded: Record<string, unknown> = {}
    const app = createSSRApp({ render: () => h(Button, props, () => 'Action') })
    app.component('UButton', defineComponent({
      setup(_, { attrs, slots }) {
        forwarded = attrs
        return () => h(attrs.to ? 'a' : 'button', { href: attrs.to }, slots.default?.())
      }
    }))
    const html = await renderToString(app)
    return { html, forwarded }
  }

  it('forwards both back routes and the click handler', async () => {
    const onClick = () => undefined
    for (const to of ['/tmcut', '/tmcut/templates']) {
      const { html, forwarded } = await render({ to, onClick })
      assert.ok(html.includes(`href="${to}"`))
      assert.equal(forwarded.onClick, onClick)
    }
  })

  it('preserves color, loading, disabled and icon position', async () => {
    const { forwarded } = await render({ color: 'neutral', loading: true, disabled: true, icon: 'i-lucide-arrow-right', iconPosition: 'right', fullWidth: true })
    assert.equal(forwarded.color, 'neutral')
    assert.equal(forwarded.loading, true)
    assert.equal(forwarded.disabled, true)
    assert.equal(forwarded.trailing, true)
    assert.equal(forwarded.block, true)
    assert.equal(forwarded.icon, 'i-lucide-arrow-right')
  })

  it('uses soft primary defaults and an error color for destructive actions', async () => {
    const normal = await render({})
    assert.equal(normal.forwarded.variant, 'soft')
    assert.equal(normal.forwarded.color, 'primary')
    const destructive = await render({ variant: 'destructive' })
    assert.equal(destructive.forwarded.variant, 'soft')
    assert.equal(destructive.forwarded.color, 'error')
  })
})

describe('editor header keeps navigation and accessible project naming', () => {
  const editor = read('app/pages/tmcut/editor.vue')
  const leftSlot = editor.match(/<template #left>([\s\S]*?)<\/template>/)?.[1] ?? ''

  it('renders back navigation and sidebar collapse inside the active left slot', () => {
    assert.match(leftSlot, /<UButton\b[^>]*\bto="\/tmcut"/)
    assert.match(leftSlot, /<UDashboardSidebarCollapse\b/)
  })

  it('labels the editable project name', () => {
    const input = leftSlot.match(/<input\b[\s\S]*?>/)?.[0] ?? ''
    assert.match(input, /\bid="tmcut-project-name"/)
    assert.match(input, /:aria-label="t\('tmcut.templateLibrary.projectNameLabel'\)"/)
  })

  it('keeps collapsed workspace panels reachable through labelled controls', () => {
    for (const panel of ['media', 'inspector']) {
      assert.ok(editor.includes(`aria-controls="tmcut-${panel}-panel"`), `${panel} has an accessible toggle`)
      assert.ok(editor.includes(`id="tmcut-${panel}-panel"`), `${panel} has a matching panel`)
      assert.ok(editor.includes(`:aria-expanded="compactPanel === '${panel}'"`))
    }
  })
})

describe('timeline audio controls expose localized accessible names', () => {
  const timeline = read('app/components/tmcut/TmcutTimeline.vue')
  for (const field of ['volume', 'pan']) {
    it(`associates the ${field} field with its visible label`, () => {
      assert.ok(timeline.includes(`:for="\`track-${field}-\${track.id}\`"`))
      assert.ok(timeline.includes(`:id="\`track-${field}-\${track.id}\`"`))
      assert.ok(timeline.includes(`:aria-label="t('tmcut.tracks.${field}')"`))
    })
  }
})

describe('preview stage keeps the still-image layer off video sources', () => {
  const player = read('app/components/tmcut/TmcutPreviewPlayer.vue')
  const img = player.match(/<img\n[\s\S]*?\n\s*>/)?.[0] ?? ''

  it('binds src only while the active clip is an image', () => {
    assert.ok(img.includes(':src="isCurrentClipImage ? currentMediaSrc : undefined"'),
      'a video src in <img> always fires error and used to raise the load-error overlay over a playing clip')
  })

  it('ignores still-layer failures for non-image clips', () => {
    const handler = player.slice(player.indexOf('function onMediaError'))
    assert.ok(handler.slice(0, handler.indexOf('\n}')).includes('if (source === \'image\' && !isCurrentClipImage.value) return'))
  })
})

describe('editor MCP bridge is initialized during setup (R148)', () => {
  const editor = read('app/pages/tmcut/editor.vue')

  it('the bridge composable is called exactly once, in the setup body', () => {
    const calls = editor.match(/useMcpRendererBridge\(\)/g) || []
    assert.equal(calls.length, 1, 'exactly one initialization site (a second one would double-register the listener)')
    const callAt = editor.indexOf('useMcpRendererBridge()')
    const mountAt = editor.indexOf('onMounted(')
    assert.ok(mountAt > 0, 'editor must still have an onMounted block')
    // Before onMounted => synchronous setup scope => active instance exists.
    assert.ok(callAt < mountAt, 'the bridge must be initialized in the setup body, not inside a lifecycle hook')
  })

  it('it is not called from inside the async onMounted after an await', () => {
    const body = editor.slice(editor.indexOf('onMounted(async'))
    const end = body.indexOf('\n})')
    const hook = body.slice(0, end === -1 ? body.length : end)
    assert.ok(!hook.includes('useMcpRendererBridge()'),
      'after an await the instance context is gone: inject() warns and onBeforeUnmount(teardown) is dropped')
    // The event-emitter wiring stays where it was — it needs the loaded project.
    assert.ok(hook.includes('setMcpEventEmitter'), 'the export-queue event emitter must still be wired on mount')
  })

  it('the bridge needs setup scope (inject + a real unmount hook) — the reason for the rule', () => {
    const bridge = read('app/composables/useMcpRendererBridge.ts')
    // useTmcutExportQueue() injects the toast provider...
    assert.ok(bridge.includes('useTmcutExportQueue()'), 'bridge builds the export queue (which injects)')
    assert.ok(read('app/composables/useTmcutExportQueue.ts').includes('useToast()'),
      'the export queue injects the toast provider — setup scope required')
    // ...and teardown is registered through a lifecycle hook.
    assert.ok(bridge.includes('onBeforeUnmount('), 'bridge must register its own teardown')
    assert.ok(bridge.includes('teardown()'), 'that hook must call teardown')
  })
})

describe('dashboard search and filter bar stays inside the viewport', () => {
  const home = read('app/pages/tmcut/index.vue')
  // The filter group is ~600px wide; beside a 320px search field it only fits
  // from 1280px up. At the lg breakpoint it used to sit side-by-side and the
  // sort options plus both view toggles fell off the right edge at 1024.
  const bar = home.match(/<(div class="flex flex-col[^"]*"[^>]*)>[\s\S]*?TmcutSegmentedControl/) || []
  const row = bar[1] || ''

  it('shares one row only from xl, and gives the search field the full width below it', () => {
    assert.match(row, /flex-col xl:flex-row/, 'the bar must stack until 1280px')
    assert.ok(home.includes('w-full xl:w-80'), 'the search field is full width until xl')
  })

  it('wraps the filter group instead of hiding overflow behind a scroll area', () => {
    // One attribute per line is the repo's lint style, so the tag name and its
    // first attribute may sit on separate lines.
    const group = home.match(/<div class="flex[^"]*"[^>]*>\s*<TmcutSegmentedControl\s+v-model="aspectFilter"/)?.[0] ?? ''
    assert.match(group, /flex-wrap/, 'the filter group must wrap')
    assert.doesNotMatch(group, /overflow-x-auto/, 'a clipped scroll area reads as missing controls')
  })
})

describe('every icon name resolves offline', () => {
  // Nuxt UI renders `i-lucide-*` from the installed @iconify-json collection.
  // A name that is neither an icon nor an alias renders as nothing and only
  // shows up as `[Icon] failed to load icon` in the running app — typecheck
  // cannot see it. The export modal shipped `i-lucide-memory` this way.
  const collections = readdirSync(join(ROOT, 'node_modules/@iconify-json')).filter(d => !d.startsWith('.'))
  const known = new Map<string, Set<string>>()
  for (const collection of collections) {
    const json = JSON.parse(readFileSync(join(ROOT, 'node_modules/@iconify-json', collection, 'icons.json'), 'utf8')) as { icons: Record<string, unknown>, aliases?: Record<string, unknown> }
    known.set(collection, new Set([...Object.keys(json.icons), ...Object.keys(json.aliases || {})]))
  }

  it('the app references enough icons for the scan to mean something, and all resolve', () => {
    const files: string[] = []
    const collect = (dir: string) => {
      for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = join(dir, entry.name)
        if (entry.isDirectory()) collect(rel)
        else if (/\.(vue|ts)$/.test(entry.name)) files.push(rel)
      }
    }
    collect('app')

    // Repo spelling is `i-lucide-chevron-down` (dash, Nuxt UI), not the iconify
    // colon form — and both collection names here contain dashes, so the only
    // unambiguous read is to match each installed collection as a prefix.
    const missing: string[] = []
    let seen = 0
    for (const file of files) {
      const src = read(file)
      for (const collection of known.keys()) {
        const pattern = new RegExp(`i-${collection}[-:]([a-z0-9-]+)`, 'g')
        for (const match of src.matchAll(pattern)) {
          const name = match[1]!
          // `i-lucide-${icon}` composes at runtime — nothing to resolve here.
          if (name.includes('$') || name.includes('{')) continue
          seen++
          if (!known.get(collection)!.has(name)) {
            missing.push(`${file}:${src.slice(0, match.index!).split('\n').length} i-${collection}-${name}`)
          }
        }
      }
    }
    assert.ok(seen > 500, `expected hundreds of icon references in app/, found ${seen}`)
    assert.deepEqual(missing, [], `icons the renderer cannot load: ${missing.join(', ')}`)
  })
})

describe('template non-null assertions sit under a matching guard', () => {
  // `foo!.bar` compiles to a plain `foo.bar`: the assertion is a promise to
  // TypeScript that the renderer never checks. Breaking it is a crash, and the
  // AutoCut review branch did exactly that — it opened on `currentStep === 3`
  // alone, while the analysis composable clears `analyzing` one microtask
  // before the page stores `edlResult`. The flush in between rendered
  // `edlResult!.edl.profile` off a null ref: an uncaught TypeError and a red
  // error overlay on every single analysis run.
  const GUARD_NAMES = new Set(['v-if', 'v-else-if', 'v-show'])
  const ASSERTED = /\b([A-Za-z_$][\w$]*)!\s*\./g

  /**
   * Every expression in a template, with the guard conditions that enclose it.
   * `vue/compiler-dom` is not reachable from here (the `vue` package only
   * exports `compiler-sfc`), so this is a small scanner over the template body
   * instead of an AST walk: quotes are respected, so `v-if="a > b"` does not
   * end the tag, and `<!-- -->` is skipped.
   */
  function expressions(content: string): Array<{ source: string, line: number, guards: string[] }> {
    const out: Array<{ source: string, line: number, guards: string[] }> = []
    const stack: string[][] = []
    const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'track', 'wbr', 'area', 'base', 'col', 'embed'])
    const lineAt = (index: number) => content.slice(0, index).split('\n').length

    let pos = 0
    while (pos < content.length) {
      const char = content[pos]!
      if (char === '<' && content.startsWith('<!--', pos)) {
        pos = content.indexOf('-->', pos) + 3
        continue
      }
      if (char === '{' && content[pos + 1] === '{') {
        const end = content.indexOf('}}', pos)
        out.push({ source: content.slice(pos + 2, end), line: lineAt(pos), guards: stack.flat() })
        pos = end + 2
        continue
      }
      if (char !== '<' || !/[A-Za-z/]/.test(content[pos + 1] || '')) {
        pos++
        continue
      }
      // `>` only ends the tag outside of a quoted attribute value.
      let end = pos + 1
      let quote = ''
      const QUOTE_CHARS = [String.fromCharCode(34), String.fromCharCode(39)]
      while (end < content.length) {
        const c = content[end]!
        if (quote) {
          if (c === quote) quote = ''
        } else if (QUOTE_CHARS.includes(c)) {
          quote = c
        } else if (c === '>') {
          break
        }
        end++
      }
      const header = content.slice(pos + 1, end)
      const closing = header.startsWith('/')
      const name = ((closing ? header.slice(1) : header).match(/^[\w:.-]+/) || [''])[0]!.toLowerCase()
      if (closing) stack.pop()
      else if (!VOID.has(name) && !header.endsWith('/')) {
        const attrs = header.slice(name.length)
        const own: string[] = []
        for (const match of attrs.matchAll(/([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)) {
          const attr = match[1]!.toLowerCase()
          const value = match[2] ?? match[3]
          if (!value) continue
          if (GUARD_NAMES.has(attr)) own.push(value)
          else if (attr.startsWith(':') || attr.startsWith('@') || attr.startsWith('v-')) {
            out.push({ source: value, line: lineAt(pos), guards: stack.flat() })
          }
        }
        stack.push(own)
      }
      pos = end + 1
    }
    return out
  }

  function violations(content: string, file: string, lineOffset: number): string[] {
    const found: string[] = []
    for (const expr of expressions(content)) {
      for (const match of expr.source.matchAll(ASSERTED)) {
        const id = match[1]!
        if (!expr.guards.some(guard => new RegExp(`\\b${id}\\b`).test(guard))) {
          found.push(`${file}:${expr.line + lineOffset} ${id}!. in ${expr.source.trim().slice(0, 60)}`)
        }
      }
    }
    return found
  }

  it('recognises a guard and flags its absence (the scanner is wired)', () => {
    const broken = '<template><div><p>{{ edlResult!.profile }}</p></div></template>'
    assert.equal(violations(broken, 'synthetic.vue', 0).length, 1)
    const guarded = '<template><div v-if="edlResult"><p>{{ edlResult!.profile }}</p></div></template>'
    assert.deepEqual(violations(guarded, 'synthetic.vue', 0), [])
    const sibling = '<template><div v-if="a"><b/></div><div v-else-if="edlResult && b">{{ edlResult!.c }}</div></template>'
    assert.deepEqual(violations(sibling, 'synthetic.vue', 0), [])
  })

  it('no tmcut template dereferences an assertion its branch does not guard', () => {
    const files = [...walk('app/pages/tmcut'), ...walk('app/components/tmcut')]
    assert.ok(files.length > 10, `expected the tmcut surfaces to be scanned, found ${files.length}`)
    const found: string[] = []
    for (const file of files) {
      const descriptor = parse(read(file)).descriptor
      if (!descriptor.template) continue
      found.push(...violations(descriptor.template.content, file, descriptor.template.loc.start.line))
    }
    assert.deepEqual(found, [], `assertions that can render off a null ref:\n${found.join('\n')}`)
  })
})
