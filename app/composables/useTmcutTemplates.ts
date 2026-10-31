import type {
  TmcutTemplate,
  TmcutTemplateCategory
} from '~/types/tmcut'
import type { TmcutTrack } from './useTmcutProject'
import {
  getBuiltinTemplates,
  getTemplateById,
  instantiateTemplate,
  filterTemplates,
  createTemplateFromTimeline,
  validateTemplate,
  migrateTemplate,
  checkRequiredAssets,
  secToTicks,
  TICKS_PER_SECOND
} from '@tmcut-core'
import { normalizeCanvas, canvasFpsValue } from '~/utils/tmcut/canvas'
import {
  buildTemplateFile,
  safeTemplateFileName,
  parseTemplateFile,
  MAX_IMPORT_BATCH
} from '~/utils/tmcut/templateIo'

// Re-export for use in components
export const ticksToSeconds = (ticks: number) => (ticks / TICKS_PER_SECOND).toFixed(1)

// C16-R3: the storage key is the version stamp (same lesson as the
// project schema — NEVER guess units from magnitudes). v1 payloads carry
// flat item geometry in SECONDS; they are scaled to ticks once on load
// and rewritten under the v2 key.
const USER_TEMPLATES_STORAGE_KEY = 'tmcut_user_templates_v2'
const LEGACY_USER_TEMPLATES_STORAGE_KEY = 'tmcut_user_templates_v1'

interface UserTemplateItemLike {
  in?: number
  out?: number
  offset?: number
  [key: string]: unknown
}

function migrateTemplateItems(template: Record<string, unknown>) {
  const tracks = Array.isArray(template.tracks) ? template.tracks as Array<{ items?: UserTemplateItemLike[] }> : []
  for (const track of tracks) {
    for (const item of track.items || []) {
      item.in = Math.round(secToTicks(Number(item.in) || 0))
      item.out = Math.round(secToTicks(Number(item.out) || 0))
      item.offset = Math.round(secToTicks(Number(item.offset) || 0))
    }
  }
}

// Shared reactive state
const userTemplates = ref<TmcutTemplate[]>([])
const selectedCategory = ref<string>('all')
const selectedIndustry = ref<string>('all')
const selectedAspectRatio = ref<string>('all')
const searchQuery = ref<string>('')
const isLoaded = ref<boolean>(false)

function matchesCategory(tpl: TmcutTemplate, category: string): boolean {
  if (!category || category === 'all') return true
  // 'custom' is the library's "My Templates" facet: it means OWNED, not
  // category === 'custom'. A template saved from the AI builder keeps its
  // brief's category (intro, promo, …) and is badged Custom on its card —
  // filtering it only under "Intro" would make it unreachable by the label
  // the user was offered.
  if (category === 'custom') return !tpl.isBuiltin
  return tpl.category === category
}

function matchesIndustry(tpl: TmcutTemplate, industry: string): boolean {
  return !industry || industry === 'all' || tpl.industry === industry
}

export function useTmcutTemplates() {
  const { createProject, saveProject, currentProject } = useTmcutProject()

  function loadUserTemplates() {
    if (typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem(USER_TEMPLATES_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          // Roadmap v3 §6.4: stamp the schema version onto templates saved
          // before versioning existed (their shape IS v1). Invalid records
          // are dropped rather than shown half-usable.
          userTemplates.value = parsed
            .map((t: unknown) => migrateTemplate(t).migrated as TmcutTemplate | null)
            .filter((t): t is TmcutTemplate => !!t)
        }
      } else {
        // One-time migration from the seconds-era (v1) key.
        const legacyRaw = localStorage.getItem(LEGACY_USER_TEMPLATES_STORAGE_KEY)
        if (legacyRaw) {
          const legacy = JSON.parse(legacyRaw)
          if (Array.isArray(legacy)) {
            for (const tpl of legacy) {
              if (tpl && typeof tpl === 'object') migrateTemplateItems(tpl)
            }
            userTemplates.value = legacy
            persistUserTemplates()
            localStorage.removeItem(LEGACY_USER_TEMPLATES_STORAGE_KEY)
          }
        }
      }
    } catch (e) {
      console.warn('[useTmcutTemplates] Failed to parse user templates from localStorage', e)
    } finally {
      isLoaded.value = true
    }
  }

  function persistUserTemplates() {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(USER_TEMPLATES_STORAGE_KEY, JSON.stringify(userTemplates.value))
    } catch (e) {
      console.warn('[useTmcutTemplates] Failed to save user templates to localStorage', e)
    }
  }

  // Load once on client mount
  if (typeof window !== 'undefined' && !isLoaded.value) {
    loadUserTemplates()
  }

  const builtinList = computed<TmcutTemplate[]>(() => {
    return getBuiltinTemplates()
  })

  const allTemplates = computed<TmcutTemplate[]>(() => {
    return [...builtinList.value, ...userTemplates.value]
  })

  /** Facet before the category/industry chips — search + aspect ratio only. */
  const baseScope = computed<TmcutTemplate[]>(() => {
    return filterTemplates(allTemplates.value, {
      category: 'all',
      aspectRatio: selectedAspectRatio.value,
      search: searchQuery.value
    })
  })

  /**
   * Templates that pass every facet EXCEPT the category chip. The chip counts
   * are derived from this set, so a number on a chip is the number of cards
   * clicking that chip will show — with the old global counts a 9:16 filter
   * still advertised "Outro & End Cards 1" for a combination that renders an
   * empty grid.
   */
  const facetScope = computed<TmcutTemplate[]>(() => {
    return baseScope.value.filter(t => matchesIndustry(t, selectedIndustry.value))
  })

  /**
   * Templates that pass every facet EXCEPT the industry chip — the same
   * promise as above for the industry row, so both rows count honestly.
   */
  const industryScope = computed<TmcutTemplate[]>(() => {
    return baseScope.value.filter(t => matchesCategory(t, selectedCategory.value))
  })

  const filteredTemplates = computed<TmcutTemplate[]>(() => {
    return facetScope.value.filter(t => matchesCategory(t, selectedCategory.value))
  })

  const categoryCounts = computed<Record<string, number>>(() => {
    const counts: Record<string, number> = { all: facetScope.value.length, custom: 0 }
    for (const t of facetScope.value) {
      counts[t.category] = (counts[t.category] || 0) + 1
      if (!t.isBuiltin) counts.custom = (counts.custom || 0) + 1
    }
    return counts
  })

  const industryCounts = computed<Record<string, number>>(() => {
    const counts: Record<string, number> = { all: industryScope.value.length }
    for (const t of industryScope.value) {
      const id = t.industry || 'general'
      counts[id] = (counts[id] || 0) + 1
    }
    return counts
  })

  /**
   * Roadmap v3 §6.4 step 2 — BEFORE building anything, classify the
   * template's required assets against what the Asset Center has verified
   * installed. 'missingAssets' need an install (the UI offers it);
   * 'localNeeds' are files the template author had — the user must supply
   * them (never silently substituted).
   */
  function templateAssetReadiness(template: TmcutTemplate) {
    const assetCenter = useTmcutAssetCenter()
    const installedIds = assetCenter.installed.value
      .filter(r => r.state === 'installed')
      .map(r => `asset:${r.entryId}`)
    return checkRequiredAssets(template, { installedIds })
  }

  /**
   * Instantiates a template into a brand new project and saves it.
   */
  async function createProjectFromTemplate(
    template: TmcutTemplate,
    options: {
      projectName?: string
      replacements?: Record<string, { src?: string, text?: string, name?: string }>
    } = {}
  ) {
    const instantiated = instantiateTemplate(template, {
      replacements: options.replacements
    })

    const name = options.projectName?.trim() || `${template.name} - Project`
    const proj = createProject(name)

    // Write through the reactive ref, NOT the raw object createProject
    // returned: raw field writes bypass Vue's dependency tracking, so the
    // totalDuration computed would keep its stale (empty-project) cache
    // and saveProject would persist a wrong durationMs (tmcut_templates
    // spec, R91). Proxy writes write-through to the raw target, so the
    // returned `proj` still reflects everything.
    const live = currentProject.value
    if (!live) return proj

    // Set canvas
    live.canvas = normalizeCanvas({
      width: instantiated.canvas.width,
      height: instantiated.canvas.height,
      fps: instantiated.canvas.fps
    })

    // Set timeline items and duration.
    // The template engine round-trips whatever items the template stores;
    // app-authored templates carry app items verbatim, so re-asserting the
    // app track type at this boundary is sound (validateTemplate gates the
    // shape at save time; a foreign template would fail there first).
    live.timeline = {
      version: 1,
      tracks: instantiated.timeline.tracks as unknown as TmcutTrack[],
      durationMs: instantiated.durationMs,
      markers: instantiated.timeline.markers || []
    }
    saveProject()
    return proj
  }

  /**
   * §6.5 — persist a template that the AI pipeline built (already validated
   * by the core Template Plan builder). Kept separate from the manual
   * save-as path so provenance is explicit at the call site.
   */
  function saveAiTemplate(template: TmcutTemplate): TmcutTemplate | null {
    const check = validateTemplate(template)
    if (!check.valid) return null
    userTemplates.value = [template, ...userTemplates.value]
    persistUserTemplates()
    return template
  }

  /**
   * Saves current timeline as a user-defined template.
   */
  function saveCurrentProjectAsTemplate(meta: {
    name: string
    description?: string
    category?: TmcutTemplateCategory
    aspectRatio?: '9:16' | '16:9' | '1:1'
  }): TmcutTemplate | null {
    if (!currentProject.value) return null

    const aspect = meta.aspectRatio || (
      currentProject.value.canvas.height > currentProject.value.canvas.width
        ? '9:16'
        : currentProject.value.canvas.width === currentProject.value.canvas.height
          ? '1:1'
          : '16:9'
    )

    const rawTpl = createTemplateFromTimeline(currentProject.value.timeline, {
      name: meta.name,
      description: meta.description || '',
      category: meta.category || 'custom',
      aspectRatio: aspect,
      canvas: {
        width: currentProject.value.canvas.width,
        height: currentProject.value.canvas.height,
        fps: canvasFpsValue(currentProject.value.canvas)
      }
    })

    const validation = validateTemplate(rawTpl)
    if (!validation.valid) {
      console.error('[useTmcutTemplates] Invalid template generated', validation.errors)
      return null
    }

    const tpl = (rawTpl as unknown) as TmcutTemplate
    userTemplates.value.unshift(tpl)
    persistUserTemplates()
    return tpl
  }

  /**
   * Deletes a user template by ID.
   */
  function deleteUserTemplate(id: string): boolean {
    const initialLen = userTemplates.value.length
    userTemplates.value = userTemplates.value.filter(t => t.id !== id)
    if (userTemplates.value.length !== initialLen) {
      persistUserTemplates()
      return true
    }
    return false
  }

  // ==========================================================================
  // R131 — Template file exchange (docs §195): the library lives in this
  // install's localStorage, so a JSON file is the only honest way to move a
  // template between machines. Desktop path: native save/open dialogs +
  // file-manager IPC. Web path (dev in a browser): Blob download + <input
  // type=file>. Import always runs through parseTemplateFile (untrusted
  // input: garbage is refused, ids regenerated, isBuiltin forced false).
  // ==========================================================================

  function isDesktop(): boolean {
    return typeof window !== 'undefined' && !!window.electronAPI?.dialog && !!window.electronAPI?.fileManager
  }

  /** Web fallback: trigger a browser download of the file body. */
  function downloadJsonFallback(fileName: string, text: string): void {
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Revoke on the next tick so the download has taken the blob.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  /**
   * Export one template to a .tmcut-template.json file.
   * Desktop: native Save dialog (user chooses the path — the renderer never
   * writes to a path it invented). Web: browser download.
   */
  async function exportTemplate(template: TmcutTemplate): Promise<{ ok: boolean, path?: string, canceled?: boolean }> {
    const text = buildTemplateFile(template)
    const fileName = safeTemplateFileName(template)
    const api = isDesktop() ? window.electronAPI : null
    if (api?.dialog && api.fileManager) {
      const target = await api.dialog.saveFile({
        title: 'Export template',
        defaultPath: fileName,
        filters: [{ name: 'TMCut template', extensions: ['json'] }]
      })
      if (!target) return { ok: false, canceled: true }
      await api.fileManager.write({ filePath: target, data: text })
      return { ok: true, path: target }
    }
    downloadJsonFallback(fileName, text)
    return { ok: true, path: fileName }
  }

  /**
   * Import one or more template files (batch via the open dialog).
   * Every file is parsed independently; the returned counts are the truth —
   * failed files are skipped, never silently "repaired".
   */
  async function importTemplates(): Promise<{ imported: TmcutTemplate[], failed: number, canceled?: boolean }> {
    const api = isDesktop() ? window.electronAPI : null
    const dialog = api?.dialog
    const fileManager = api?.fileManager
    let texts: string[]
    if (dialog && fileManager) {
      const paths = await dialog.openFile({
        title: 'Import template',
        multiSelections: true,
        filters: [{ name: 'TMCut template / JSON', extensions: ['json'] }]
      })
      if (!paths || paths.length === 0) return { imported: [], failed: 0, canceled: true }
      texts = await Promise.all(
        paths.slice(0, MAX_IMPORT_BATCH).map(p => fileManager.read(p))
      )
    } else {
      texts = await pickFilesInBrowser()
      if (texts.length === 0) return { imported: [], failed: 0, canceled: true }
    }
    const imported: TmcutTemplate[] = []
    let failed = 0
    for (const text of texts) {
      const res = parseTemplateFile(text)
      if (res.ok && res.template) imported.push(res.template)
      else failed += 1
    }
    if (imported.length > 0) {
      userTemplates.value = [...imported, ...userTemplates.value]
      persistUserTemplates()
    }
    return { imported, failed }
  }

  /** Web fallback for import: a native file picker driven from JS. */
  function pickFilesInBrowser(): Promise<string[]> {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'application/json,.json'
      input.multiple = true
      input.onchange = () => {
        const files = Array.from(input.files || []).slice(0, MAX_IMPORT_BATCH)
        if (files.length === 0) {
          resolve([])
          return
        }
        Promise.all(files.map(f => f.text())).then(resolve).catch(() => resolve([]))
      }
      // Browsers fire no event when the dialog is dismissed with Cancel in
      // some engines; modern Chrome/Safari support 'cancel'.
      input.oncancel = () => resolve([])
      input.click()
    })
  }

  return {
    allTemplates,
    userTemplates,
    filteredTemplates,
    categoryCounts,
    industryCounts,
    selectedCategory,
    selectedIndustry,
    selectedAspectRatio,
    searchQuery,
    createProjectFromTemplate,
    saveCurrentProjectAsTemplate,
    saveAiTemplate,
    deleteUserTemplate,
    templateAssetReadiness,
    exportTemplate,
    importTemplates,
    getTemplateById,
    ticksToSeconds: (ticks: number) => (ticks / TICKS_PER_SECOND).toFixed(1)
  }
}
