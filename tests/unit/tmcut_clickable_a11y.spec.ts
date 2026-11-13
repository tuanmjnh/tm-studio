import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function vueFiles(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) vueFiles(path, out)
    else if (name.endsWith('.vue')) out.push(path)
  }
  return out
}

// Non-semantic elements can still be click targets, but only reach a keyboard
// when they are focusable and handle Enter/Space themselves. Native controls
// (UButton/USwitch/UCheckbox) already do that, so this scan only looks at
// div/li/span/td/tr/p rows.
const CLICKABLE = /<(div|li|span|td|tr|p)\b((?:[^>"']|"[^"]*"|'[^']*')*?)>/g

interface ClickSite {
  file: string
  line: number
  tag: string
  expr: string
  attrs: string
  tabindex: boolean
  keydown: boolean
  role: boolean
  keydownSelf: boolean
}

// GridList/SwipeCard now ship from @tuanmjnh/tm-ui, so the rows this spec guards
// are no longer under app/. Scan the linked package source as well, and give its
// sites a package-prefixed path so an exemption names exactly one copy.
const PACKAGE_ROOT = join(ROOT, '..', 'tm-platform', 'packages', 'tm-ui', 'src')

function scannedRoots(): Array<{ dir: string, prefix: string, relativeTo: string }> {
  const roots = [{ dir: join(ROOT, 'app'), prefix: '', relativeTo: ROOT }]
  if (existsSync(PACKAGE_ROOT)) {
    roots.push({ dir: PACKAGE_ROOT, prefix: 'packages/tm-ui/src/', relativeTo: PACKAGE_ROOT })
  }
  return roots
}

function scanClicks() {
  const sites: ClickSite[] = []
  for (const { dir, prefix, relativeTo } of scannedRoots())
  for (const path of vueFiles(dir)) {
    const rel = prefix + relative(relativeTo, path).replace(/\\/g, '/')
    const src = readFileSync(path, 'utf8')
    for (const match of src.matchAll(CLICKABLE)) {
      const attrs = match[2] ?? ''
      const click = attrs.match(/@click(?:\.\w+)*\s*=\s*"([^"]*)"/)
      if (!click) continue
      const expr = click[1].trim()
      // Bare @click.stop/@click.prevent only contain the event; they are not
      // interactive targets of their own.
      if (/^(?:stop|prevent)(?:\.(?:stop|prevent))*$/.test(expr)) continue
      sites.push({
        file: rel,
        line: src.slice(0, match.index).split('\n').length,
        tag: match[1]!,
        expr,
        attrs,
        tabindex: /\btabindex\s*=/.test(attrs),
        keydown: /@keydown/.test(attrs),
        keydownSelf: /@keydown\.(?:enter|space)\.self|@keydown\.self/.test(attrs),
        role: /\brole\s*=/.test(attrs)
      })
    }
  }
  return sites
}

// Rows that already hold a focusable native control doing the same job, or
// pointer-coordinate surfaces with an existing keyboard equivalent. Keyed by
// file + click expression so a new clickable row cannot inherit an exemption.
const EXEMPT = new Map<string, string>([
  ['app/components/tmcut/TmcutExportModal.vue::isExporting || (watchFolder = !watchFolder)', 'row wraps a UCheckbox'],
  ['app/components/tmcut/TmcutExportModal.vue::autoPreview = !autoPreview', 'row wraps a UCheckbox'],
  ['app/components/tmcut/TmcutExportModal.vue::isExporting || (denoise = !denoise)', 'row wraps a UCheckbox'],
  ['app/components/tmcut/TmcutInspector.vue::maskPatch({ invert: !clip.mask.invert })', 'row wraps a USwitch'],
  ['app/components/tmcut/TmcutShortcutsModal.vue::shortcutTips = !shortcutTips', 'row wraps a UCheckbox'],
  ['app/pages/tmcut/autocut.vue::selectSegment(index)', 'row wraps a UCheckbox'],
  ['app/components/tmcut/TmcutPreviewPlayer.vue::onCanvasClick', 'Space already toggles playback globally'],
  ['app/components/tmcut/TmcutKeyframeLane.vue::handleLaneClick', 'pointer-coordinate ruler; transport keys seek'],
  ['app/pages/tmcut/autocut.vue::seekReview', 'pointer-coordinate scrubber; transport keys seek']
])

// Rows that should announce themselves as buttons because they hold no other
// interactive descendant. Rows left out keep role off on purpose: role=button
// would make their nested buttons/checkbox presentational to screen readers.
const ROLE_REQUIRED = new Set([
  'app/components/gridList/Index.vue::emit(\'sort\', col)',
  'app/components/tmcut/TmcutExportModal.vue::selectEncoderProfile(\'nvenc\')',
  'app/components/tmcut/TmcutExportModal.vue::selectEncoderProfile(\'qsv\')',
  'app/components/tmcut/TmcutExportModal.vue::selectEncoderProfile(\'amf\')',
  'app/components/tmcut/TmcutExportModal.vue::selectEncoderProfile(\'cpu\')',
  'app/components/tmcut/TmcutTimeline.vue::clearRenderMarks()',
  'app/components/tmcut/TmcutMediaPanel.vue::handleImportMedia',
  'app/components/tmcut/TmcutMediaPanel.vue::handleAddTextPreset(preset)',
  'app/components/tmcut/TmcutProfileCard.vue::emit(\'select\', props.profile.id)',
  'app/pages/resources/connections.vue::!addSaving && (addStep = \'category\')',
  'app/pages/resources/connections.vue::!addSaving && addCategory && (addStep = \'provider\')',
  'app/pages/resources/connections.vue::selectCategory(cat)',
  'app/pages/resources/connections.vue::selectProvider(p)',
  'app/pages/system/ai-keys.vue::copy(m.modelId); notify.success(t(\'aiProviders.model_id_copied\', [m.modelId]))'
])

// Rows with nested controls must scope the keydown to the row itself, or an
// Enter on an inner button would also fire the row action.
const SELF_REQUIRED = new Set([
  'packages/tm-ui/src/gridlist/SwipeCard.vue::handleContentClick',
  'app/components/inbox/InboxList.vue::selectedId = mail.id',
  'app/components/tmcut/TmcutMediaPanel.vue::selectedFolderId = folder.id',
  'app/components/tmcut/TmcutMediaPanel.vue::asset.status !== \'missing\' && handleAddToTimeline(asset)',
  'app/components/tmcut/TmcutVideoFactory.vue::selectedBatchId = batch.batchId',
  'app/pages/tmcut/index.vue::router.push(`/tmcut/editor?project=${project.id}`)'
])

const sites = scanClicks()
const label = (s: ClickSite) => `${s.file}:${s.line} <${s.tag}> (${s.expr})`

describe('clickable non-semantic elements are keyboard operable', () => {
  it('scans a meaningful number of rows', () => {
    assert.ok(sites.length >= 25, `expected >=25 clickable rows, found ${sites.length}`)
  })

  it('every unexempted click target is focusable and handles Enter/Space', () => {
    const gaps = sites
      .filter(s => !EXEMPT.has(`${s.file}::${s.expr}`))
      .filter(s => !(s.tabindex && s.keydown))
      .map(label)
    assert.deepEqual(gaps, [], `add tabindex + @keydown.enter/@keydown.space (or an EXEMPT reason):\n${gaps.join('\n')}`)
  })

  it('rows without nested controls expose a button role', () => {
    const missing = sites
      .filter(s => ROLE_REQUIRED.has(`${s.file}::${s.expr}`))
      .filter(s => !s.role)
      .map(label)
    assert.deepEqual(missing, [], `these rows should carry role="button":\n${missing.join('\n')}`)
  })

  it('rows with nested controls scope the key handler to themselves', () => {
    const missing = sites
      .filter(s => SELF_REQUIRED.has(`${s.file}::${s.expr}`))
      .filter(s => !s.keydownSelf)
      .map(label)
    assert.deepEqual(missing, [], `use @keydown.enter.self so inner buttons keep their own Enter:\n${missing.join('\n')}`)
  })

  it('the fixed set stays wired', () => {
    const wired = sites.filter(s => !EXEMPT.has(`${s.file}::${s.expr}`) && s.tabindex && s.keydown)
    assert.ok(wired.length >= 20, `expected >=20 keyboard-operable rows, found ${wired.length}`)
    assert.ok(EXEMPT.size >= 9, 'the exemption list documents the deliberate pointer-only rows')
  })
})
