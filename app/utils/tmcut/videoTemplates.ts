/**
 * Video template lifecycle + validation + dry run (Roadmap v1 §5, P3).
 *
 * Everything here is pure: functions take the template list and return a NEW
 * list, or a structured result. The reactive store (useVideoTemplates) and the
 * future Template Studio UI are thin wrappers — which is what makes the
 * immutability rules testable without a browser.
 *
 * Rules encoded here (roadmap §5):
 *  - a published version is IMMUTABLE; editing forks a new draft version;
 *  - a draft is editable in place until it is published;
 *  - publishing validates first and keeps exactly one published version
 *    (the previous one becomes `archived`, still resolvable by a running batch);
 *  - duplicating a template creates a NEW templateId at 0.1.0 — it never
 *    rewrites the source version;
 *  - the dry run resolves inputs → script outline → storyboard with no network
 *    and no provider cost.
 */
import type {
  VideoTemplate,
  TemplateValidationResult,
  TemplateValidationError,
  TemplateValidationWarning,
  TemplateInputField,
  SceneBlueprint
} from '~/types/videoTemplate'

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------

/** Deep clone for JSON-shaped template documents (no functions, no refs). */
export function cloneTemplate<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

interface Semver {
  major: number
  minor: number
  patch: number
}

export function parseVersion(version: string): Semver | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version || '').trim())
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

export function formatVersion(parts: Semver): string {
  return `${parts.major}.${parts.minor}.${parts.patch}`
}

function bumpMinor(version: string): string {
  const parsed = parseVersion(version) || { major: 1, minor: 0, patch: 0 }
  return formatVersion({ major: parsed.major, minor: parsed.minor + 1, patch: 0 })
}

function bumpPatch(version: string): string {
  const parsed = parseVersion(version) || { major: 1, minor: 0, patch: 0 }
  return formatVersion({ major: parsed.major, minor: parsed.minor, patch: parsed.patch + 1 })
}

export interface TemplateOperationResult {
  ok: boolean
  templates: VideoTemplate[]
  template?: VideoTemplate
  error?: { code: string, message: string }
}

function fail(templates: VideoTemplate[], code: string, message: string): TemplateOperationResult {
  return { ok: false, templates, error: { code, message } }
}

/** All versions of one family, newest version first. */
export function familyVersions(templates: VideoTemplate[], templateId: string): VideoTemplate[] {
  return templates
    .filter(t => t.templateId === templateId)
    .sort((a, b) => compareVersionStrings(b.version, a.version))
}

export function compareVersionStrings(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return String(a).localeCompare(String(b))
  return (pa.major - pb.major) || (pa.minor - pb.minor) || (pa.patch - pb.patch)
}

export function findTemplateVersion(
  templates: VideoTemplate[],
  templateId: string,
  version: string
): VideoTemplate | undefined {
  return templates.find(t => t.templateId === templateId && t.version === version)
}

export function publishedVersionOf(templates: VideoTemplate[], templateId: string): VideoTemplate | undefined {
  return templates.find(t => t.templateId === templateId && t.status === 'published')
}

export function draftVersionOf(templates: VideoTemplate[], templateId: string): VideoTemplate | undefined {
  return templates.find(t => t.templateId === templateId && t.status === 'draft')
}

// -----------------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------------

export interface CreateDraftOptions {
  /** Template id to fork into (duplicate flow). Defaults to the base family. */
  templateId?: string
  name?: string
  now?: string
}

/**
 * Fork a template into an editable draft.
 *  - base is a draft → a clone at the SAME version (it is edited in place);
 *  - base is published/archived → the next unused minor version.
 */
export function createDraftVersion(
  templates: VideoTemplate[],
  base: VideoTemplate,
  options: CreateDraftOptions = {}
): TemplateOperationResult {
  const now = options.now || new Date().toISOString()
  const targetId = options.templateId || base.templateId

  // One editable draft per family: pressing "edit" twice must not spawn
  // 1.1.0 then 1.1.1 — the existing draft IS the workspace.
  const existingDraft = draftVersionOf(templates, targetId)
  if (existingDraft && targetId === base.templateId) {
    return { ok: true, templates, template: cloneTemplate(existingDraft) }
  }

  const draft = cloneTemplate(base)
  draft.templateId = targetId
  draft.updatedAt = now

  if (base.status !== 'draft' || targetId !== base.templateId) {
    let version = targetId === base.templateId ? bumpMinor(base.version) : '0.1.0'
    // Never collide with an existing version of the same family.
    const used = new Set(familyVersions(templates, targetId).map(t => t.version))
    while (used.has(version)) version = bumpPatch(version)
    draft.version = version
    draft.status = 'draft'
    draft.publishedAt = undefined
    draft.createdAt = now
  }
  if (options.name) draft.name = options.name

  return {
    ok: true,
    templates: [...templates, draft],
    template: draft
  }
}

/**
 * Patch a DRAFT version. Published/archived versions are immutable — callers
 * must fork a draft first (that is the whole point of the version split).
 */
export function updateDraft(
  templates: VideoTemplate[],
  templateId: string,
  version: string,
  patch: Partial<VideoTemplate>,
  now = new Date().toISOString()
): TemplateOperationResult {
  const index = templates.findIndex(t => t.templateId === templateId && t.version === version)
  if (index === -1) return fail(templates, 'template-not-found', `No template ${templateId}@${version}`)
  const current = templates[index]!
  if (current.status !== 'draft') {
    return fail(templates, 'immutable-version', `Version ${version} is ${current.status}; fork a draft to edit it`)
  }
  const next: VideoTemplate = {
    ...current,
    ...patch,
    // Identity and lifecycle fields are not patchable.
    templateId: current.templateId,
    version: current.version,
    status: 'draft',
    publishedAt: current.publishedAt,
    createdAt: current.createdAt,
    updatedAt: now
  }
  const copy = [...templates]
  copy[index] = next
  return { ok: true, templates: copy, template: next }
}

export interface PublishOptions {
  now?: string
  /** Changelog lines describing what changed in this version. */
  changes?: string[]
}

/**
 * Publish a validated draft. The previous published version of the same
 * family becomes `archived` (still resolvable, no longer offered for new
 * runs). Invalid templates are refused with the validation payload.
 */
export function publishVersion(
  templates: VideoTemplate[],
  templateId: string,
  version: string,
  options: PublishOptions = {}
): TemplateOperationResult & { validation?: TemplateValidationResult } {
  const now = options.now || new Date().toISOString()
  const index = templates.findIndex(t => t.templateId === templateId && t.version === version)
  if (index === -1) return fail(templates, 'template-not-found', `No template ${templateId}@${version}`)
  const target = templates[index]!
  if (target.status !== 'draft') {
    return fail(templates, 'not-a-draft', `Only drafts can be published (version ${version} is ${target.status})`)
  }

  const validation = validateVideoTemplate(target)
  if (!validation.valid) {
    return {
      ...fail(templates, 'validation-failed', `Template has ${validation.errors.length} blocking error(s)`),
      validation
    }
  }

  const published: VideoTemplate = {
    ...cloneTemplate(target),
    status: 'published',
    publishedAt: now,
    updatedAt: now,
    changelog: [
      ...target.changelog.filter(entry => entry.version !== version),
      { version, date: now, changes: options.changes || ['Published'] }
    ]
  }

  const next = templates.map((template) => {
    if (template.templateId !== templateId) return template
    if (template.version === version) return published
    // One current published version per family; the rest stay resolvable.
    if (template.status === 'published') return { ...template, status: 'archived' as const, updatedAt: now }
    return template
  })

  return { ok: true, templates: next, template: published, validation }
}

export function archiveVersion(
  templates: VideoTemplate[],
  templateId: string,
  version: string,
  now = new Date().toISOString()
): TemplateOperationResult {
  const index = templates.findIndex(t => t.templateId === templateId && t.version === version)
  if (index === -1) return fail(templates, 'template-not-found', `No template ${templateId}@${version}`)
  const current = templates[index]!
  if (current.status === 'archived') return { ok: true, templates, template: current }
  const next = [...templates]
  next[index] = { ...current, status: 'archived', updatedAt: now }
  return { ok: true, templates: next, template: next[index] }
}

/**
 * Duplicate a template into a NEW template family at version 0.1.0 (draft).
 * The source version is never modified.
 */
export function duplicateTemplate(
  templates: VideoTemplate[],
  templateId: string,
  version: string,
  options: { name?: string, newTemplateId?: string, now?: string } = {}
): TemplateOperationResult {
  const source = findTemplateVersion(templates, templateId, version)
  if (!source) return fail(templates, 'template-not-found', `No template ${templateId}@${version}`)
  const now = options.now || new Date().toISOString()
  const newId = options.newTemplateId || `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const copy = cloneTemplate(source)
  copy.templateId = newId
  copy.version = '0.1.0'
  copy.name = options.name || `${source.name} (copy)`
  copy.status = 'draft'
  copy.publishedAt = undefined
  copy.createdAt = now
  copy.updatedAt = now
  copy.changelog = []
  return { ok: true, templates: [...templates, copy], template: copy }
}

export function deleteTemplateFamily(
  templates: VideoTemplate[],
  templateId: string
): TemplateOperationResult {
  const next = templates.filter(t => t.templateId !== templateId)
  if (next.length === templates.length) return fail(templates, 'template-not-found', `No template ${templateId}`)
  return { ok: true, templates: next }
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

/** Placeholders resolved per scene at storyboard time — never inputs. */
const SCENE_SCOPED_PLACEHOLDERS = new Set(['sceneId', 'sceneRole', 'shotType', 'visualIntent'])

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g

export function collectPlaceholders(text: string): string[] {
  const found = new Set<string>()
  for (const match of String(text || '').matchAll(PLACEHOLDER_RE)) {
    if (match[1]) found.add(match[1])
  }
  return Array.from(found)
}

function err(errors: TemplateValidationError[], path: string, code: string, message: string) {
  errors.push({ path, code, message })
}

function warn(warnings: TemplateValidationWarning[], path: string, code: string, message: string) {
  warnings.push({ path, code, message })
}

function sceneDurations(template: VideoTemplate): number[] {
  return template.sceneBlueprints.map(scene => Number(scene.durationTargetSec) || 0)
}

export function totalSceneDurationSec(template: VideoTemplate): number {
  return sceneDurations(template).reduce((sum, value) => sum + value, 0)
}

/**
 * Structural validation + quality gates. Blocking problems are errors;
 * advisory problems are warnings. A template may be saved/stored while it has
 * errors (it is a draft) — only publishing is blocked.
 */
export function validateVideoTemplate(template: VideoTemplate): TemplateValidationResult {
  const errors: TemplateValidationError[] = []
  const warnings: TemplateValidationWarning[] = []

  if (!String(template.name || '').trim()) err(errors, '/name', 'name-required', 'Template needs a name')
  if (!String(template.description || '').trim()) {
    warn(warnings, '/description', 'description-empty', 'A description helps users pick the template')
  }
  if (!parseVersion(template.version)) {
    err(errors, '/version', 'bad-version', `Version "${template.version}" is not semantic (x.y.z)`)
  }

  // --- Input schema ---
  const inputIds = new Set<string>()
  const inputFields = template.inputSchema || []
  if (inputFields.length === 0) {
    err(errors, '/inputSchema', 'inputs-required', 'At least one input field is required')
  }
  inputFields.forEach((field, index) => {
    const path = `/inputSchema/${index}`
    if (!field.id || !/^[A-Za-z0-9_]+$/.test(field.id)) {
      err(errors, `${path}/id`, 'bad-input-id', 'Input ids must be alphanumeric (they are prompt variables)')
    } else if (inputIds.has(field.id)) {
      err(errors, `${path}/id`, 'duplicate-input-id', `Duplicate input id "${field.id}"`)
    } else {
      inputIds.add(field.id)
    }
    if (!String(field.label || '').trim()) err(errors, `${path}/label`, 'label-required', 'Input needs a label')
    if (field.type === 'select' && !(field.validation?.options?.length)) {
      err(errors, `${path}/validation/options`, 'select-options-required', `Select "${field.id}" needs options`)
    }
  })

  // --- Prompt blocks ---
  if ((template.promptBlocks || []).length === 0) {
    warn(warnings, '/promptBlocks', 'no-prompt-blocks', 'No prompt blocks — generation prompts will fall back to scene intent')
  }
  const blockIds = new Set<string>()
  ;(template.promptBlocks || []).forEach((block, index) => {
    const path = `/promptBlocks/${index}`
    if (blockIds.has(block.id)) err(errors, `${path}/id`, 'duplicate-block-id', `Duplicate prompt block "${block.id}"`)
    blockIds.add(block.id)
    if (!String(block.content || '').trim()) err(errors, `${path}/content`, 'block-empty', 'Prompt block is empty')
    for (const placeholder of collectPlaceholders(block.content)) {
      if (!inputIds.has(placeholder) && !SCENE_SCOPED_PLACEHOLDERS.has(placeholder)) {
        err(
          errors,
          `${path}/content`,
          'unknown-variable',
          `Placeholder {{${placeholder}}} is not an input field of this template`
        )
      }
    }
  })

  // --- Scenes ---
  const scenes = template.sceneBlueprints || []
  if (scenes.length === 0) err(errors, '/sceneBlueprints', 'scenes-required', 'At least one scene is required')
  const sceneIds = new Set<string>()
  scenes.forEach((scene, index) => {
    const path = `/sceneBlueprints/${index}`
    if (sceneIds.has(scene.id)) err(errors, `${path}/id`, 'duplicate-scene-id', `Duplicate scene id "${scene.id}"`)
    sceneIds.add(scene.id)
    if (!(Number(scene.durationTargetSec) > 0)) {
      err(errors, `${path}/durationTargetSec`, 'bad-scene-duration', 'Scene duration must be greater than 0')
    }
    if (!String(scene.visualIntent || '').trim()) {
      err(errors, `${path}/visualIntent`, 'scene-intent-required', 'Scene needs a visual intent')
    }
    if (!Array.isArray(scene.providerCapabilities) || scene.providerCapabilities.length === 0) {
      warn(warnings, `${path}/providerCapabilities`, 'no-capabilities', 'Scene declares no provider capability')
    }
  })

  // --- Assembly profile ---
  const profile = template.assemblyProfile?.outputProfile
  if (!profile) {
    err(errors, '/assemblyProfile/outputProfile', 'output-profile-required', 'An output profile is required')
  } else {
    const portrait = profile.aspectRatio === '9:16' || profile.aspectRatio === '4:5'
    const landscape = profile.aspectRatio === '16:9'
    if (portrait && profile.resolution.width > profile.resolution.height) {
      err(errors, '/assemblyProfile/outputProfile/resolution', 'aspect-mismatch', 'Resolution contradicts the portrait aspect ratio')
    }
    if (landscape && profile.resolution.width < profile.resolution.height) {
      err(errors, '/assemblyProfile/outputProfile/resolution', 'aspect-mismatch', 'Resolution contradicts the landscape aspect ratio')
    }
    if (profile.frameRate < 24 || profile.frameRate > 60) {
      warn(warnings, '/assemblyProfile/outputProfile/frameRate', 'unusual-fps', 'Frame rate is outside the usual 24–60 range')
    }
  }

  // --- Quality gates ---
  const duration = totalSceneDurationSec(template)
  for (const gate of template.qualityGates || []) {
    const path = `/qualityGates/${gate.id}`
    const blocking = gate.severity === 'error'
    const report = (code: string, message: string) => {
      if (blocking) err(errors, path, code, message)
      else warn(warnings, path, code, message)
    }
    switch (gate.type) {
      case 'scene-count': {
        const min = Number(gate.config.min)
        const max = Number(gate.config.max)
        if (Number.isFinite(min) && scenes.length < min) report('too-few-scenes', gate.message || `Need at least ${min} scenes`)
        if (Number.isFinite(max) && scenes.length > max) report('too-many-scenes', gate.message || `At most ${max} scenes`)
        break
      }
      case 'duration': {
        const min = Number(gate.config.minSec)
        const max = Number(gate.config.maxSec)
        if (Number.isFinite(min) && duration < min) report('too-short', gate.message || `Video must be at least ${min}s`)
        if (Number.isFinite(max) && duration > max) report('too-long', gate.message || `Video must be at most ${max}s`)
        break
      }
      case 'aspect-ratio': {
        const expected = String(gate.config.aspectRatio || '')
        if (expected && profile && expected !== profile.aspectRatio) {
          report('aspect-ratio-mismatch', gate.message || `Output must be ${expected}`)
        }
        break
      }
      case 'subtitle-presence': {
        const missing = scenes.filter(scene => !String(scene.onScreenText || '').trim())
        if (missing.length > 0) {
          report('missing-captions', gate.message || `${missing.length} scene(s) have no on-screen text`)
        }
        break
      }
      default:
        // moderation/custom gates need data this offline check does not have.
        break
    }
  }

  // --- Script budget coherence ---
  const target = Number(template.scriptBlueprint?.durationTargetSec) || 0
  if (target > 0 && duration > 0) {
    const delta = Math.abs(duration - target) / target
    if (delta > 0.2) {
      warn(
        warnings,
        '/scriptBlueprint/durationTargetSec',
        'duration-drift',
        `Scenes total ${duration}s against a ${target}s script target`
      )
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

// -----------------------------------------------------------------------------
// Inputs → script → storyboard (deterministic, offline)
// -----------------------------------------------------------------------------

export interface BuildInputsResult {
  ok: boolean
  values: Record<string, unknown>
  errors: Array<{ fieldId: string, code: string, message: string }>
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

/** Validate one input record against the template's input schema. */
export function buildTemplateInputs(
  template: VideoTemplate,
  record: Record<string, unknown> = {}
): BuildInputsResult {
  const values: Record<string, unknown> = {}
  const errors: BuildInputsResult['errors'] = []

  for (const field of template.inputSchema || []) {
    const raw = record[field.id]
    const value = isEmpty(raw) ? field.defaultValue : raw
    if (isEmpty(value)) {
      if (field.required) {
        errors.push({ fieldId: field.id, code: 'required', message: `"${field.label}" is required` })
      }
      continue
    }
    const push = (code: string, message: string) => errors.push({ fieldId: field.id, code, message })
    if (field.type === 'number') {
      const numeric = Number(value)
      if (!Number.isFinite(numeric)) push('not-a-number', `"${field.label}" must be a number`)
      else {
        if (typeof field.validation?.min === 'number' && numeric < field.validation.min) {
          push('min', `"${field.label}" must be at least ${field.validation.min}`)
        }
        if (typeof field.validation?.max === 'number' && numeric > field.validation.max) {
          push('max', `"${field.label}" must be at most ${field.validation.max}`)
        }
      }
      values[field.id] = numeric
      continue
    }
    if (field.type === 'select') {
      const options = (field.validation?.options || []).map(option => option.value)
      if (options.length > 0 && !options.includes(String(value))) {
        push('option', `"${field.label}" must be one of: ${options.join(', ')}`)
      }
      values[field.id] = String(value)
      continue
    }
    if (field.type === 'boolean') {
      values[field.id] = value === true || value === 'true'
      continue
    }
    // text / textarea / media / color / date / json-ish fields stay strings
    const text = String(value)
    if (typeof field.validation?.minLength === 'number' && text.length < field.validation.minLength) {
      push('min-length', `"${field.label}" needs at least ${field.validation.minLength} characters`)
    }
    if (typeof field.validation?.maxLength === 'number' && text.length > field.validation.maxLength) {
      push('max-length', `"${field.label}" allows at most ${field.validation.maxLength} characters`)
    }
    if (field.validation?.pattern) {
      try {
        if (!new RegExp(field.validation.pattern).test(text)) {
          push('pattern', `"${field.label}" has an invalid format`)
        }
      } catch {
        push('bad-pattern', `"${field.label}" has an invalid validation pattern`)
      }
    }
    values[field.id] = text
  }

  return { ok: errors.length === 0, values, errors }
}

function resolveText(text: string, values: Record<string, unknown>): string {
  return String(text || '').replace(PLACEHOLDER_RE, (full, name: string) => {
    const value = values[name]
    return value === undefined || value === null ? full : String(value)
  })
}

function sceneValues(scene: SceneBlueprint, values: Record<string, unknown>): Record<string, unknown> {
  return {
    ...values,
    sceneId: scene.id,
    sceneRole: scene.role,
    shotType: scene.shotType,
    visualIntent: scene.visualIntent
  }
}

export interface StoryboardScene {
  sceneId: string
  order: number
  role: string
  shotType: string
  cameraMovement?: string
  durationSec: number
  prompt: string
  narration?: string
  onScreenText?: string
  capabilities: string[]
}

/**
 * Deterministic storyboard: same template version + same inputs always
 * produce the same scenes, prompts and durations.
 */
export function buildStoryboard(
  template: VideoTemplate,
  values: Record<string, unknown> = {}
): StoryboardScene[] {
  const shotTemplate = (template.promptBlocks || []).find(block => block.type === 'shot-template')
  const styleBible = (template.promptBlocks || []).find(block => block.type === 'style-bible')

  return [...(template.sceneBlueprints || [])]
    .sort((a, b) => a.order - b.order)
    .map((scene) => {
      const merged = sceneValues(scene, values)
      const base = shotTemplate?.content
        ? resolveText(shotTemplate.content, merged)
        : scene.visualIntent
      const style = styleBible?.content ? resolveText(styleBible.content, merged) : ''
      return {
        sceneId: scene.id,
        order: scene.order,
        role: scene.role,
        shotType: scene.shotType,
        cameraMovement: scene.cameraMovement,
        durationSec: Number(scene.durationTargetSec) || 0,
        prompt: [base, style].filter(part => String(part || '').trim()).join('. '),
        narration: scene.narration ? resolveText(scene.narration, merged) : undefined,
        onScreenText: scene.onScreenText ? resolveText(scene.onScreenText, merged) : undefined,
        capabilities: [...(scene.providerCapabilities || [])]
      }
    })
}

export interface ScriptOutline {
  hook: { purpose: string, guidance: string, maxWords?: number }
  intro: { purpose: string, guidance: string, maxWords?: number }
  beats: Array<{ id: string, title: string, purpose: string, keyPoints: string[], estimatedDurationSec: number }>
  cta: { purpose: string, guidance: string, maxWords?: number }
  outro?: { purpose: string, guidance: string, maxWords?: number }
  wordCountLimit?: number
  durationTargetSec?: number
}

/** Resolve the script blueprint against the input values. */
export function buildScriptOutline(
  template: VideoTemplate,
  values: Record<string, unknown> = {}
): ScriptOutline {
  const blueprint = template.scriptBlueprint
  const segment = (source: { purpose: string, guidance: string, maxWords?: number }) => ({
    purpose: resolveText(source.purpose, values),
    guidance: resolveText(source.guidance, values),
    maxWords: source.maxWords
  })
  return {
    hook: segment(blueprint.hook),
    intro: segment(blueprint.intro),
    beats: (blueprint.beats || []).map(beat => ({
      id: beat.id,
      title: resolveText(beat.title, values),
      purpose: resolveText(beat.purpose, values),
      keyPoints: (beat.keyPoints || []).map(point => resolveText(point, values)),
      estimatedDurationSec: beat.estimatedDurationSec
    })),
    cta: segment(blueprint.cta),
    outro: blueprint.outro ? segment(blueprint.outro) : undefined,
    wordCountLimit: blueprint.wordCountLimit,
    durationTargetSec: blueprint.durationTargetSec
  }
}

export interface TemplateDryRun {
  ok: boolean
  validation: TemplateValidationResult
  inputs?: BuildInputsResult
  script?: ScriptOutline
  storyboard?: StoryboardScene[]
  durationSec?: number
  sceneCount?: number
}

/**
 * The Template Studio "test run": no providers, no cost, no network. It only
 * proves the template can turn one input record into a validated storyboard.
 */
export function runTemplateDryRun(
  template: VideoTemplate,
  record: Record<string, unknown> = {}
): TemplateDryRun {
  const validation = validateVideoTemplate(template)
  if (!validation.valid) return { ok: false, validation }

  const inputs = buildTemplateInputs(template, record)
  if (!inputs.ok) {
    return {
      ok: false,
      validation: {
        valid: false,
        errors: inputs.errors.map((issue, index) => ({
          path: `/inputSchema/${index}`,
          code: issue.code,
          message: issue.message
        })),
        warnings: validation.warnings
      },
      inputs
    }
  }

  const script = buildScriptOutline(template, inputs.values)
  const storyboard = buildStoryboard(template, inputs.values)
  return {
    ok: true,
    validation,
    inputs,
    script,
    storyboard,
    sceneCount: storyboard.length,
    durationSec: storyboard.reduce((sum, scene) => sum + scene.durationSec, 0)
  }
}

/** Type guard used by the UI before treating a stored record as a template. */
export function isVideoTemplate(value: unknown): value is VideoTemplate {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<VideoTemplate>
  return typeof candidate.templateId === 'string'
    && typeof candidate.version === 'string'
    && typeof candidate.name === 'string'
    && Array.isArray(candidate.inputSchema)
    && Array.isArray(candidate.sceneBlueprints)
}

/** A ready-to-use input record from the schema defaults (test-run convenience). */
export function sampleRecordFor(template: VideoTemplate): Record<string, unknown> {
  const record: Record<string, unknown> = {}
  for (const field of template.inputSchema || []) {
    if (field.defaultValue !== undefined) {
      record[field.id] = field.defaultValue
      continue
    }
    record[field.id] = sampleValueFor(field)
  }
  return record
}

function sampleValueFor(field: TemplateInputField): unknown {
  switch (field.type) {
    case 'number': return field.validation?.min ?? 1
    case 'boolean': return true
    case 'select': return field.validation?.options?.[0]?.value ?? ''
    case 'media': return 'sample-media'
    case 'color': return '#ffffff'
    case 'date': return new Date(0).toISOString().slice(0, 10)
    case 'json': return '{}'
    default: return `Sample ${field.label}`
  }
}
