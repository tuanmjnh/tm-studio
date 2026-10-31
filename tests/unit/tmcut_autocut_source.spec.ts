import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, compileTemplate } from 'vue/compiler-sfc'
import { computed, ref, watch } from 'vue'
import type { Ref } from 'vue'
import ts from 'typescript'
import type { TmcutAsset } from '../../app/types/tmcut'
import { createEmptyTmcutAssetMeta } from '../../app/types/tmcut'
import { classifyAssetKind, mediaFileKey } from '../../app/utils/tmcut/media'
import { AUTOCUT_PREFS_DEFAULT, splitKeywords } from '../../app/utils/tmcut/autocutPrefs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const page = read('app/pages/tmcut/autocut.vue')
const { descriptor, errors } = parse(page)
assert.deepEqual(errors, [])
const script = descriptor.scriptSetup!.content
  .replace(/^import .*$/gm, '')
  .replaceAll('import.meta.client', 'false')
const exposed = [
  'currentStep', 'sourceAsset', 'sourceBusy', 'sourceError', 'mediaChooserOpen',
  'selectedMediaId', 'readySourceAssets', 'handleChooseFromDevice',
  'handleChooseFromMedia', 'confirmMediaSource', 'onSourceDrop',
  'onSourceDragEnter', 'onSourceDragOver', 'onSourceDragLeave', 'sourceDropActive'
]
const { outputText } = ts.transpileModule(`${script}\nreturn {${exposed.map(name => `${name}: typeof ${name} === 'undefined' ? undefined : ${name}`).join(',')}}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
})

function video(name = 'clip.mp4', overrides: Partial<TmcutAsset> = {}): TmcutAsset {
  return {
    id: name, path: `/uploads/${name}`, name, kind: 'video', status: 'ready',
    addedAt: '2026-01-01', usedBy: [],
    meta: { ...createEmptyTmcutAssetMeta(), fileSize: 3 }, ...overrides
  }
}
const file = (name = 'clip.mp4') => new File(['abc'], name, { type: 'video/mp4' })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
interface SourceState {
  currentStep: Ref<number>
  sourceAsset: Ref<TmcutAsset | null>
  sourceBusy: Ref<boolean>
  sourceError: Ref<string | null>
  mediaChooserOpen: Ref<boolean>
  selectedMediaId: Ref<string | undefined>
  readySourceAssets: Ref<TmcutAsset[]>
  sourceDropActive: Ref<boolean>
  handleChooseFromDevice: () => Promise<void>
  handleChooseFromMedia: () => Promise<void>
  confirmMediaSource: () => void
  onSourceDrop: (event: DragEvent) => Promise<void>
  onSourceDragEnter: (event: DragEvent) => void
  onSourceDragOver: (event: DragEvent) => void
  onSourceDragLeave: (event: DragEvent) => void
}
function harness(initial: TmcutAsset[] = [], desktop = false) {
  const messages: { title: string, description?: string, color: string }[] = []
  const pickedFiles = [file()]
  const importedPaths: string[][] = []
  const importedFiles: File[][] = []
  const media = {
    assets: ref(initial), isDesktop: ref(desktop), importing: ref(false),
    importError: ref<string | null>(null), webUpload: ref(null),
    loadLibrary: async () => {},
    importFiles: async (paths: string[]) => {
      importedPaths.push(paths)
      return { added: 0, duplicates: paths.length, failed: 0 }
    },
    importWebFiles: async (files: File[]) => {
      importedFiles.push(files)
      media.importError.value = null
      const created = files.filter(f => !media.assets.value.some(a => a.name.toLowerCase() === f.name.toLowerCase() && a.meta.fileSize === f.size))
        .map(f => video(f.name))
      media.assets.value.unshift(...created)
      return created
    },
    findAssetBySrc: (path: string) => media.assets.value.find(a => mediaFileKey(a.path) === mediaFileKey(path)),
    getThumbUrl: () => '', mediaUrl: (path: string) => path
  }
  const fs = {
    pickWebFiles: async () => pickedFiles,
    pickFile: async (): Promise<string | string[] | null> => 'C:/clips/clip.mp4'
  }
  const autocut = { analyzing: ref(false), stageKey: ref(''), analysisError: ref(null), analyzeSource: async () => null, applyDraft: async () => null }
  const electronAPI = { getPathForFile: (f: File) => `C:/clips/${f.name}` }
  const scope = {
    ref, computed, watch, useI18n: () => ({ t: (key: string) => key }),
    useToast: () => ({ add: (message: typeof messages[number]) => messages.push(message) }),
    useFileSystem: () => ({ pickWebFiles: () => fs.pickWebFiles(), pickFile: () => fs.pickFile() }),
    useTmcutMedia: () => ({
      ...media,
      loadLibrary: () => media.loadLibrary(),
      importFiles: (paths: string[]) => media.importFiles(paths),
      importWebFiles: (files: File[]) => media.importWebFiles(files)
    }),
    useTmcutAutocut: () => autocut,
    useTmcutFrames: () => ({ available: ref(false), extractFrames: async () => new Map() }),
    onMounted: () => {}, onUnmounted: () => {},
    AUTOCUT_PREFS_DEFAULT, splitKeywords, classifyAssetKind,
    window: { electronAPI }, console: { error: () => {} }
  }
  const state = new Function(...Object.keys(scope), outputText)(...Object.values(scope)) as SourceState
  return { state, media, fs, autocut, electronAPI, messages, importedPaths, importedFiles, pickedFiles }
}
function drop(files: File[], types = ['Files']) {
  let prevented = false
  const event = {
    dataTransfer: { files, types, dropEffect: 'none', getData: () => { throw new Error('Must not read dropped URLs/text') } },
    preventDefault: () => { prevented = true }, stopPropagation: () => {}
  } as unknown as DragEvent
  return { event, prevented: () => prevented }
}

for (const input of ['picker', 'drop'] as const) {
  describe(`AutoCut ${input} source import`, () => {
    async function choose(h: ReturnType<typeof harness>) {
      if (input === 'picker') return h.state.handleChooseFromDevice()
      assert.equal(typeof h.state.onSourceDrop, 'function', 'dropzone must handle file drops')
      return h.state.onSourceDrop(drop(h.pickedFiles).event)
    }
    it('selects an existing ready duplicate by case-insensitive name and size, not the newest asset', async () => {
      const existing = video('CLIP.MP4')
      const h = harness([video('unrelated.mp4', { addedAt: '2026-10-01' }), existing])
      await choose(h)
      assert.equal(h.state.sourceAsset.value?.id, existing.id)
      assert.equal(h.state.currentStep.value, 2)
      assert.ok(!h.messages.some(m => m.title === 'tmcut.steps.noSource'))
    })
    it('imports new web Files and chooses the first requested ready video', async () => {
      const h = harness([video('CLIP.MP4')])
      h.pickedFiles.push(file('second.mp4'))
      await choose(h)
      assert.equal(h.importedFiles.length, 1)
      assert.equal(h.state.sourceAsset.value?.name, 'CLIP.MP4')
      assert.equal(h.state.currentStep.value, 2)
    })
    it('surfaces caught per-file upload errors instead of a misleading no-source warning', async () => {
      const h = harness()
      h.media.importWebFiles = async () => {
        h.media.importError.value = 'Upload exceeds server limit'
        return []
      }
      await choose(h)
      assert.equal(h.state.currentStep.value, 1)
      assert.equal(h.state.sourceAsset.value, null)
      assert.ok(h.messages.some(m => m.color === 'error' && m.description?.includes('server limit')))
      assert.ok(!h.messages.some(m => m.title === 'tmcut.steps.noSource'))
      assert.match(h.state.sourceError.value!, /server limit/)
      assert.equal(h.state.sourceBusy.value, false)
    })
    it('keeps successful partial imports usable while reporting failures', async () => {
      const h = harness()
      h.media.importWebFiles = async () => {
        const asset = video()
        h.media.assets.value.push(asset)
        h.media.importError.value = 'Another upload failed'
        return [asset]
      }
      await choose(h)
      assert.equal(h.state.currentStep.value, 2)
      assert.equal(h.state.sourceAsset.value?.name, 'clip.mp4')
      assert.ok(h.messages.some(m => m.color === 'error'))
    })
    it('catches unexpected import rejection and preserves the previous source', async () => {
      const h = harness()
      h.state.sourceAsset.value = video('previous.mp4')
      h.media.importWebFiles = async () => {
        throw new Error('offline')
      }
      await assert.doesNotReject(() => choose(h))
      assert.equal(h.state.currentStep.value, 1)
      assert.equal(h.state.sourceAsset.value?.name, 'previous.mp4')
      assert.ok(h.messages.some(m => m.color === 'error'))
      assert.equal(h.state.sourceBusy.value, false)
    })
    it('does not reuse missing, analyzing, error, non-video or different-sized assets', async () => {
      for (const asset of [
        video('clip.mp4', { status: 'missing' }), video('clip.mp4', { status: 'analyzing' }),
        video('clip.mp4', { status: 'error' }), video('clip.mp4', { kind: 'audio' }),
        video('clip.mp4', { meta: { ...createEmptyTmcutAssetMeta(), fileSize: 99 } })
      ]) {
        const h = harness([asset])
        h.media.importWebFiles = async () => []
        await choose(h)
        assert.equal(h.state.sourceAsset.value, null)
        assert.equal(h.state.currentStep.value, 1)
      }
    })
    it('uses normalized desktop paths and selects ready duplicates', async () => {
      const h = harness([video('clip.mp4', { path: 'C:\\clips\\clip.mp4' })], true)
      await choose(h)
      assert.deepEqual(h.importedPaths, [['C:/clips/clip.mp4']])
      assert.equal(h.importedFiles.length, 0)
      assert.equal(h.state.currentStep.value, 2)
    })
    it('blocks input while the shared importer or analysis is running', async () => {
      for (const busy of ['importing', 'analyzing'] as const) {
        const h = harness()
        if (busy === 'importing') h.media.importing.value = true
        else h.autocut.analyzing.value = true
        await choose(h)
        assert.equal(h.importedFiles.length, 0)
        assert.equal(h.state.currentStep.value, 1)
      }
    })
    it('treats empty selection as cancellation without a warning', async () => {
      const h = harness()
      h.pickedFiles.length = 0
      await choose(h)
      assert.equal(h.state.currentStep.value, 1)
      assert.equal(h.messages.length, 0)
    })
  })
}

describe('AutoCut source controls', () => {
  it('catches picker rejection and allows retry', async () => {
    const h = harness()
    h.fs.pickWebFiles = async () => {
      throw new Error('picker unavailable')
    }
    await assert.doesNotReject(() => h.state.handleChooseFromDevice())
    assert.equal(h.state.sourceBusy.value, false)
    assert.ok(h.messages.some(m => m.color === 'error'))
    h.fs.pickWebFiles = async () => h.pickedFiles
    await h.state.handleChooseFromDevice()
    assert.equal(h.state.currentStep.value, 2)
    assert.equal(h.state.sourceError.value, null)
  })
  it('guards repeated picking, dropping, and media choosing for the whole picker/import operation', async () => {
    const h = harness()
    const pending = deferred<File[]>()
    let picks = 0
    h.fs.pickWebFiles = () => {
      picks++
      return pending.promise
    }
    const first = h.state.handleChooseFromDevice()
    assert.equal(h.state.sourceBusy.value, true)
    await h.state.handleChooseFromDevice()
    await h.state.onSourceDrop(drop([file()]).event)
    await h.state.handleChooseFromMedia()
    assert.equal(picks, 1)
    assert.equal(h.state.mediaChooserOpen.value, false)
    pending.resolve([])
    await first
    assert.equal(h.state.sourceBusy.value, false)
  })
  it('ignores URL/text drops without importing anything', async () => {
    const h = harness()
    assert.equal(typeof h.state.onSourceDrop, 'function')
    await h.state.onSourceDrop(drop([], ['text/uri-list', 'text/plain']).event)
    assert.equal(h.importedFiles.length, 0)
    assert.equal(h.state.currentStep.value, 1)
    assert.equal(h.messages.length, 0)
  })
  it('reports desktop path extraction failure without treating a File name as a path', async () => {
    const h = harness([], true)
    h.electronAPI.getPathForFile = () => {
      throw new Error('path unavailable')
    }
    assert.equal(typeof h.state.onSourceDrop, 'function')
    await assert.doesNotReject(() => h.state.onSourceDrop(drop([file()]).event))
    assert.equal(h.importedPaths.length, 0)
    assert.ok(h.messages.some(m => m.color === 'error'))
  })
  it('keeps file-drop highlighting stable across child enter/leave events and clears it on drop', async () => {
    const h = harness()
    const drag = drop([file()])
    assert.equal(typeof h.state.onSourceDragEnter, 'function')
    h.state.onSourceDragEnter(drag.event)
    h.state.onSourceDragEnter(drag.event)
    h.state.onSourceDragLeave(drag.event)
    assert.equal(h.state.sourceDropActive.value, true)
    h.state.onSourceDragOver(drag.event)
    assert.equal(drag.event.dataTransfer!.dropEffect, 'copy')
    await h.state.onSourceDrop(drag.event)
    assert.equal(h.state.sourceDropActive.value, false)
  })
  it('opens a chooser with only ready videos and waits for explicit selection', async () => {
    const h = harness([video('older.mp4'), video('newer.mp4'), video('missing.mp4', { status: 'missing' }), video('audio.mp3', { kind: 'audio' })])
    await h.state.handleChooseFromMedia()
    assert.equal(h.state.currentStep.value, 1)
    assert.equal(h.state.sourceAsset.value, null)
    assert.equal(h.state.mediaChooserOpen.value, true)
    assert.equal(h.state.selectedMediaId.value, undefined, 'URadioGroup starts with no selection')
    assert.deepEqual(h.state.readySourceAssets.value.map(a => a.id), ['older.mp4', 'newer.mp4'])
    h.state.selectedMediaId.value = 'older.mp4'
    h.state.confirmMediaSource()
    assert.equal(h.state.sourceAsset.value?.id, 'older.mp4')
    assert.equal(h.state.currentStep.value, 2)
    assert.equal(h.state.mediaChooserOpen.value, false)
  })
  it('does not select on cancel and revalidates a removed/unready selection on confirm', async () => {
    const h = harness([video()])
    await h.state.handleChooseFromMedia()
    assert.equal(h.state.currentStep.value, 1)
    h.state.selectedMediaId.value = 'clip.mp4'
    h.state.mediaChooserOpen.value = false
    assert.equal(h.state.sourceAsset.value, null)
    await h.state.handleChooseFromMedia()
    assert.equal(h.state.selectedMediaId.value, undefined, 'reopening the chooser clears the previous pick')
    h.state.selectedMediaId.value = 'clip.mp4'
    h.media.assets.value[0]!.status = 'missing'
    h.state.confirmMediaSource()
    assert.equal(h.state.currentStep.value, 1)
    assert.equal(h.state.sourceAsset.value, null)
  })
  it('loads the library for the chooser with loading and recoverable error state', async () => {
    const h = harness()
    const pending = deferred<undefined>()
    h.media.loadLibrary = () => pending.promise
    const choosing = h.state.handleChooseFromMedia()
    assert.equal(h.state.mediaChooserOpen.value, true)
    assert.equal(h.state.sourceBusy.value, true)
    pending.resolve(undefined)
    await choosing
    assert.equal(h.state.sourceBusy.value, false)
    h.state.mediaChooserOpen.value = false
    h.media.loadLibrary = async () => {
      throw new Error('library unavailable')
    }
    await assert.doesNotReject(() => h.state.handleChooseFromMedia())
    assert.match(h.state.sourceError.value!, /library unavailable/)
    assert.equal(h.state.sourceBusy.value, false)
  })
  it('wires real drop events, busy controls and a Nuxt modal body/footer', () => {
    const template = descriptor.template!.content
    for (const event of ['dragenter', 'dragover', 'dragleave', 'drop']) assert.match(template, new RegExp(`@${event}(?:\\.[\\w]+)*=`))
    for (const handler of ['handleChooseFromDevice', 'handleChooseFromMedia']) {
      const button = template.match(new RegExp(`<TmcutButton\\b[^>]*@click="${handler}"[^>]*>`))?.[0] || ''
      assert.match(button, /:disabled="sourceBusy/)
    }
    assert.match(template, /:loading="sourceBusy/)
    assert.match(template, /:disabled="!sourceAsset \|\| sourceBusy"/)
    const modal = template.match(/<LazyUModal\b[\s\S]*?<\/LazyUModal>/)?.[0] || ''
    assert.match(modal, /v-model:open="mediaChooserOpen"/)
    assert.match(modal, /<template #body>/)
    assert.match(modal, /<template #footer/)
    assert.match(modal, /confirmMediaSource/)
    assert.match(modal, /USkeleton/)
    assert.match(modal, /sourceError/)
    assert.match(modal, /tmcut.steps.noSource/)
    assert.deepEqual(compileTemplate({ source: template, filename: 'autocut.vue', id: 'autocut-source-test' }).errors, [])
  })
  it('describes an editable draft, not a finished render or guaranteed 2GB upload', () => {
    for (const locale of ['en', 'vi']) {
      const steps = JSON.parse(read(`i18n/locales/${locale}.json`)).tmcut.steps
      assert.doesNotMatch(steps.dragDropDesc, /2\s*GB/i)
      assert.doesNotMatch(steps.step1Desc, /Cloudinary/i)
      for (const key of ['step4Title', 'step4Desc', 'edlDoneTitle', 'edlDoneDesc', 'acceptDraft']) {
        assert.match(steps[key], locale === 'en' ? /draft/i : /nháp/i)
      }
      assert.doesNotMatch(steps.step4Title, /render/i)
      assert.equal(steps.acceptDraft, locale === 'en' ? 'Create draft' : 'Tạo bản nháp')
    }
  })
})
