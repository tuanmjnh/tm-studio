/**
 * Video Factory template store (Roadmap v1 §5 / §9, P3).
 *
 * Thin reactive wrapper over the pure lifecycle in
 * `~/utils/tmcut/videoTemplates`. Persistence is localStorage for now, matching
 * the existing timeline-template library (`tmcut_user_templates_v2`); when the
 * TM Hub template tables exist, only this file changes.
 *
 * Shipped templates are NOT copied into storage until a family is touched
 * (fork/publish), at which point the whole family is materialized so status
 * changes survive a restart. Deleting a shipped family is refused.
 */
import { computed, ref } from 'vue'
import type { VideoTemplate } from '~/types/videoTemplate'
import { getBuiltinVideoTemplates, getBuiltinVideoTemplate } from '~/utils/tmcut/videoTemplatePresets'
import {
  archiveVersion as archiveVersionIn,
  createDraftVersion as createDraftIn,
  deleteTemplateFamily as deleteFamilyIn,
  duplicateTemplate as duplicateIn,
  familyVersions,
  findTemplateVersion,
  isVideoTemplate,
  publishVersion as publishIn,
  runTemplateDryRun,
  sampleRecordFor,
  updateDraft as updateDraftIn,
  validateVideoTemplate,
  type TemplateOperationResult
} from '~/utils/tmcut/videoTemplates'

const STORAGE_KEY = 'tmcut_video_templates_v1'

const userTemplates = ref<VideoTemplate[]>([])
const loaded = ref(false)
const lastError = ref<string | null>(null)

function ensureLoaded() {
  if (loaded.value || typeof window === 'undefined') return
  loaded.value = true
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return
    // Untrusted storage: drop records that are not templates instead of
    // showing half-usable rows in the studio.
    userTemplates.value = parsed.filter(isVideoTemplate)
  } catch (error) {
    console.warn('[useVideoTemplates] Failed to read stored templates', error)
  }
}

function persist() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(userTemplates.value))
  } catch (error) {
    console.warn('[useVideoTemplates] Failed to persist templates', error)
  }
}

/** Copy a shipped family into storage the first time it is mutated. */
function materializeFamily(templateId: string) {
  if (userTemplates.value.some(t => t.templateId === templateId)) return
  const shipped = getBuiltinVideoTemplates().filter(t => t.templateId === templateId)
  if (shipped.length > 0) userTemplates.value = [...shipped, ...userTemplates.value]
}

export interface VideoTemplateFamily {
  templateId: string
  name: string
  topic: string
  tags: string[]
  builtin: boolean
  versionCount: number
  draftVersion?: string
  publishedVersion?: string
  latestVersion: string
  updatedAt: string
}

export function useVideoTemplates() {
  ensureLoaded()

  const builtinTemplates = computed<VideoTemplate[]>(() => getBuiltinVideoTemplates())

  /** Stored families shadow shipped ones (status changes, new versions). */
  const allTemplates = computed<VideoTemplate[]>(() => {
    const storedFamilies = new Set(userTemplates.value.map(t => t.templateId))
    return [
      ...userTemplates.value,
      ...builtinTemplates.value.filter(t => !storedFamilies.has(t.templateId))
    ]
  })

  const families = computed<VideoTemplateFamily[]>(() => {
    const ids = Array.from(new Set(allTemplates.value.map(t => t.templateId)))
    return ids
      .map((templateId) => {
        const versions = familyVersions(allTemplates.value, templateId)
        const newest = versions[0]!
        const draft = versions.find(t => t.status === 'draft')
        const published = versions.find(t => t.status === 'published')
        return {
          templateId,
          name: newest.name,
          topic: newest.topic,
          tags: [...newest.tags],
          builtin: !!getBuiltinVideoTemplate(templateId),
          versionCount: versions.length,
          draftVersion: draft?.version,
          publishedVersion: published?.version,
          latestVersion: newest.version,
          updatedAt: newest.updatedAt
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  function getVersion(templateId: string, version: string): VideoTemplate | undefined {
    return findTemplateVersion(allTemplates.value, templateId, version)
  }

  function publishedVersion(templateId: string): VideoTemplate | undefined {
    return allTemplates.value.find(t => t.templateId === templateId && t.status === 'published')
  }

  function draftVersion(templateId: string): VideoTemplate | undefined {
    return allTemplates.value.find(t => t.templateId === templateId && t.status === 'draft')
  }

  /**
   * Fork a draft from any version. A published/archived base yields the next
   * draft version; an existing draft is returned as an editable clone at the
   * same version (no version churn).
   */
  function createDraft(templateId: string, version: string): TemplateOperationResult {
    const base = getVersion(templateId, version)
    if (!base) {
      lastError.value = `template-not-found:${templateId}@${version}`
      return { ok: false, templates: allTemplates.value, error: { code: 'template-not-found', message: `No template ${templateId}@${version}` } }
    }
    materializeFamily(templateId)
    const result = createDraftIn(userTemplates.value, base, { templateId })
    if (result.ok) {
      userTemplates.value = result.templates
      persist()
      lastError.value = null
    }
    return result
  }

  function updateDraft(templateId: string, version: string, patch: Partial<VideoTemplate>): TemplateOperationResult {
    materializeFamily(templateId)
    const result = updateDraftIn(userTemplates.value, templateId, version, patch)
    if (result.ok) {
      userTemplates.value = result.templates
      persist()
      lastError.value = null
    } else {
      lastError.value = result.error?.message || null
    }
    return result
  }

  function publish(templateId: string, version: string, changes?: string[]): TemplateOperationResult {
    const base = getVersion(templateId, version)
    if (!base) {
      return { ok: false, templates: allTemplates.value, error: { code: 'template-not-found', message: `No template ${templateId}@${version}` } }
    }
    materializeFamily(templateId)
    const result = publishIn(userTemplates.value, templateId, version, { changes })
    if (result.ok) {
      userTemplates.value = result.templates
      persist()
      lastError.value = null
    } else {
      lastError.value = result.error?.message || null
    }
    return result
  }

  function archive(templateId: string, version: string): TemplateOperationResult {
    materializeFamily(templateId)
    const result = archiveVersionIn(userTemplates.value, templateId, version)
    if (result.ok) {
      userTemplates.value = result.templates
      persist()
    }
    return result
  }

  /** Duplicate a version into a NEW family (draft 0.1.0). */
  function duplicate(templateId: string, version: string, name?: string): TemplateOperationResult {
    const base = getVersion(templateId, version)
    if (!base) {
      return { ok: false, templates: allTemplates.value, error: { code: 'template-not-found', message: `No template ${templateId}@${version}` } }
    }
    const result = duplicateIn(userTemplates.value, templateId, version, { name })
    if (result.ok) {
      userTemplates.value = result.templates
      persist()
    }
    return result
  }

  /** Shipped templates cannot be removed — they are the factory's baseline. */
  function deleteFamily(templateId: string): TemplateOperationResult {
    if (getBuiltinVideoTemplate(templateId)) {
      return {
        ok: false,
        templates: allTemplates.value,
        error: { code: 'builtin-template', message: 'Shipped templates cannot be deleted' }
      }
    }
    const result = deleteFamilyIn(userTemplates.value, templateId)
    if (result.ok) {
      userTemplates.value = result.templates
      persist()
    }
    return result
  }

  function validate(template: VideoTemplate) {
    return validateVideoTemplate(template)
  }

  /** Offline test run: inputs → script → storyboard, no provider calls. */
  function testRun(templateId: string, version: string, record?: Record<string, unknown>) {
    const template = getVersion(templateId, version)
    if (!template) {
      return {
        ok: false,
        validation: { valid: false, errors: [{ path: '/', code: 'template-not-found', message: `No template ${templateId}@${version}` }], warnings: [] }
      }
    }
    return runTemplateDryRun(template, record ?? sampleRecordFor(template))
  }

  function sampleRecord(template: VideoTemplate): Record<string, unknown> {
    return sampleRecordFor(template)
  }

  return {
    allTemplates,
    families,
    userTemplates,
    lastError,
    getVersion,
    publishedVersion,
    draftVersion,
    createDraft,
    updateDraft,
    publish,
    archive,
    duplicate,
    deleteFamily,
    validate,
    testRun,
    sampleRecord
  }
}
