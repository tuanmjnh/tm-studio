/**
 * Video Factory template lifecycle (roadmap v1 §5, P3).
 *
 * The roadmap's P3 acceptance criterion is that one template VERSION is a
 * stable artifact: editing forks a draft, publishing never rewrites history,
 * and a dry run is deterministic. These checks cover the pure lifecycle the
 * Template Studio will call, plus the two shipped starter templates.
 */
import { getBuiltinVideoTemplates } from '../../app/utils/tmcut/videoTemplatePresets'
import {
  buildStoryboard,
  buildTemplateInputs,
  createDraftVersion,
  duplicateTemplate,
  publishVersion,
  runTemplateDryRun,
  sampleRecordFor,
  updateDraft,
  validateVideoTemplate
} from '../../app/utils/tmcut/videoTemplates'
import { useVideoTemplates } from '../../app/composables/useVideoTemplates'
import type { VideoTemplate } from '../../app/types/videoTemplate'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`[ok] ${name}`)
}

function builtins() {
  return getBuiltinVideoTemplates()
}

function productTemplate(): VideoTemplate {
  return builtins()[0]!
}

function withTemplates(...items: VideoTemplate[]): VideoTemplate[] {
  return items
}

function main() {
  check('shipped templates are valid and returned as fresh clones', () => {
    const first = builtins()
    const second = builtins()
    if (first.length < 2) throw new Error('expected at least two starter templates')
    for (const template of first) {
      const result = validateVideoTemplate(template)
      if (!result.valid) throw new Error(`${template.name} is invalid: ${result.errors.map(e => e.message).join('; ')}`)
      if (template.status !== 'published') throw new Error('starter templates must ship published')
    }
    first[0]!.name = 'mutated'
    if (second[0]!.name === 'mutated') throw new Error('builtins must not share references')
  })

  check('editing a published version forks a draft and keeps the original immutable', () => {
    const base = productTemplate()
    const result = createDraftVersion(withTemplates(base), base, { now: '2026-10-24T00:00:00.000Z' })
    if (!result.ok || !result.template) throw new Error('draft not created')
    const draft = result.template
    if (draft.version !== '1.1.0') throw new Error(`expected 1.1.0, got ${draft.version}`)
    if (draft.status !== 'draft') throw new Error('fork must be a draft')
    const original = result.templates.find(t => t.version === base.version)!
    if (original.status !== 'published') throw new Error('the published version must not change')
    if (original.version !== '1.0.0') throw new Error('the published version moved')
    if (draft === base) throw new Error('the draft must be a clone, never the source object')
    if (base.status !== 'published' || base.version !== '1.0.0') throw new Error('the source object was mutated')
  })

  check('asking for a draft twice reuses the same draft version', () => {
    const base = productTemplate()
    const first = createDraftVersion(withTemplates(base), base)
    const second = createDraftVersion(first.templates, base)
    const drafts = second.templates.filter(t => t.status === 'draft')
    if (drafts.length !== 1) throw new Error(`expected one draft, got ${drafts.length}`)
    if (second.template?.version !== '1.1.0') throw new Error('draft version drifted')
  })

  check('a published version cannot be patched', () => {
    const base = productTemplate()
    const attempt = updateDraft(withTemplates(base), base.templateId, base.version, { name: 'hacked' })
    if (attempt.ok) throw new Error('published version must be immutable')
    if (attempt.error?.code !== 'immutable-version') throw new Error(`wrong code: ${attempt.error?.code}`)
    if (attempt.templates[0]!.name !== base.name) throw new Error('templates array must be untouched')
  })

  check('publishing a valid draft archives the previous published version', () => {
    const base = productTemplate()
    const forked = createDraftVersion(withTemplates(base), base)
    const draft = forked.template!
    const published = publishVersion(forked.templates, draft.templateId, draft.version, {
      now: '2026-10-24T10:00:00.000Z',
      changes: ['Tightened the hook']
    })
    if (!published.ok || !published.template) throw new Error('publish failed: ' + JSON.stringify(published.error))
    if (published.template.status !== 'published') throw new Error('draft must be published')
    if (published.template.publishedAt !== '2026-10-24T10:00:00.000Z') throw new Error('publishedAt missing')
    const entry = published.template.changelog.find(c => c.version === draft.version)
    if (!entry || entry.changes[0] !== 'Tightened the hook') throw new Error('changelog entry missing')
    const previous = published.templates.find(t => t.version === base.version)!
    if (previous.status !== 'archived') throw new Error('previous published version must be archived')
    const publishedCount = published.templates.filter(t => t.templateId === base.templateId && t.status === 'published').length
    if (publishedCount !== 1) throw new Error('a family must have exactly one published version')
  })

  check('publishing an invalid draft is refused with validation errors', () => {
    const base = productTemplate()
    const forked = createDraftVersion(withTemplates(base), base)
    const draft = forked.template!
    const broken = updateDraft(forked.templates, draft.templateId, draft.version, {
      sceneBlueprints: [draft.sceneBlueprints[0]!]
    })
    if (!broken.ok) throw new Error('the draft edit itself should be accepted')
    const result = publishVersion(broken.templates, draft.templateId, draft.version)
    if (result.ok) throw new Error('invalid template must not publish')
    if (result.error?.code !== 'validation-failed') throw new Error(`wrong code: ${result.error?.code}`)
    if (!result.validation || result.validation.errors.length === 0) throw new Error('validation payload missing')
    const status = result.templates.find(t => t.version === draft.version)!.status
    if (status !== 'draft') throw new Error('failed publish must leave the draft as a draft')
  })

  check('duplicating creates a new family at 0.1.0 without touching the source', () => {
    const base = productTemplate()
    const result = duplicateTemplate(withTemplates(base), base.templateId, base.version, { name: 'My Product Ad' })
    if (!result.ok || !result.template) throw new Error('duplicate failed')
    const copy = result.template
    if (copy.templateId === base.templateId) throw new Error('duplicate needs a new templateId')
    if (copy.version !== '0.1.0') throw new Error(`expected 0.1.0, got ${copy.version}`)
    if (copy.status !== 'draft') throw new Error('duplicate must be a draft')
    if (copy.name !== 'My Product Ad') throw new Error('override name ignored')
    const source = result.templates.find(t => t.templateId === base.templateId && t.version === base.version)!
    if (source.status !== 'published' || source.name !== base.name) throw new Error('source was modified')
  })

  check('validation catches unknown prompt variables and empty captions', () => {
    const base = productTemplate()
    const forked = createDraftVersion(withTemplates(base), base)
    const draft = forked.template!
    const edited = updateDraft(forked.templates, draft.templateId, draft.version, {
      promptBlocks: [...draft.promptBlocks, {
        id: 'rogue',
        type: 'shot-template',
        content: 'Invent a detail about {{productPrice}}',
        appliesTo: ['scene']
      }],
      sceneBlueprints: draft.sceneBlueprints.map((scene, index) => index === 0 ? { ...scene, onScreenText: '' } : scene)
    })
    const check1 = validateVideoTemplate(edited.template!)
    const codes = check1.errors.map(e => e.code)
    if (!codes.includes('unknown-variable')) throw new Error('unknown placeholder not caught')
    if (!codes.includes('missing-captions')) throw new Error('missing caption not caught')
  })

  check('inputs are validated against the schema (required, range, select)', () => {
    const base = productTemplate()
    const empty = buildTemplateInputs(base, {})
    if (empty.ok) throw new Error('missing required inputs must fail')
    const missing = empty.errors.map(e => e.fieldId)
    if (!missing.includes('productName') || !missing.includes('keyBenefit')) throw new Error('required fields not reported')

    const numeric = { ...base, inputSchema: [{ id: 'qty', label: 'Quantity', type: 'number' as const, required: true, validation: { min: 2, max: 5 } }] }
    if (buildTemplateInputs(numeric, { qty: 1 }).ok) throw new Error('min not enforced')
    if (buildTemplateInputs(numeric, { qty: 9 }).ok) throw new Error('max not enforced')
    if (!buildTemplateInputs(numeric, { qty: 3 }).ok) throw new Error('valid number rejected')

    const select = { ...base, inputSchema: [{ id: 'tone', label: 'Tone', type: 'select' as const, required: true, validation: { options: [{ value: 'calm', label: 'Calm' }] } }] }
    if (buildTemplateInputs(select, { tone: 'wild' }).ok) throw new Error('unknown option accepted')
    if (!buildTemplateInputs(select, { tone: 'calm' }).ok) throw new Error('valid option rejected')

    const defaults = buildTemplateInputs(base, { productName: 'Lamp', keyBenefit: 'Light that lasts' })
    if (!defaults.ok) throw new Error('defaults should fill the CTA: ' + JSON.stringify(defaults.errors))
    if (defaults.values.ctaText !== 'Shop now') throw new Error('default value not applied')
  })

  check('the dry run is deterministic and resolves prompts from inputs', () => {
    const base = productTemplate()
    const record = { productName: 'Nova Lamp', keyBenefit: '40 hours per charge', ctaText: 'Order today' }
    const first = runTemplateDryRun(base, record)
    const second = runTemplateDryRun(base, record)
    if (!first.ok) throw new Error('dry run failed: ' + JSON.stringify(first.validation.errors))
    if (JSON.stringify(first.storyboard) !== JSON.stringify(second.storyboard)) {
      throw new Error('storyboard must be deterministic')
    }
    const hook = first.storyboard!.find(scene => scene.sceneId === 'scene-hook')!
    if (!hook.prompt.includes('Nova Lamp')) throw new Error('prompt did not resolve productName')
    if (!hook.onScreenText?.includes('Nova Lamp')) throw new Error('on-screen text not resolved')
    const total = first.storyboard!.reduce((sum, scene) => sum + scene.durationSec, 0)
    if (first.durationSec !== total) throw new Error('duration must equal the scene sum')
    if (first.sceneCount !== base.sceneBlueprints.length) throw new Error('scene count mismatch')

    const sample = runTemplateDryRun(base, sampleRecordFor(base))
    if (!sample.ok) throw new Error('sample record should satisfy the template: ' + JSON.stringify(sample.validation.errors))
  })

  check('storyboard and script stay stable across repeated builds', () => {
    const base = builtins()[1]!
    const values = { topic: 'CSS Grid', audience: 'junior devs', keyTakeaway: 'Name the lines, not the pixels', ctaText: 'Follow' }
    const boardA = buildStoryboard(base, values)
    const boardB = buildStoryboard(base, values)
    if (JSON.stringify(boardA) !== JSON.stringify(boardB)) throw new Error('storyboard drifted')
    if (!boardA[0]!.prompt.includes('CSS Grid')) throw new Error('topic not substituted')
  })

  check('the store runs a shipped template and refuses to delete it', () => {
    const store = useVideoTemplates()
    const builtin = store.families.value.find(family => family.builtin)
    if (!builtin) throw new Error('no shipped family visible')
    if (!builtin.publishedVersion) throw new Error('shipped family must expose its published version')
    const run = store.testRun(builtin.templateId, builtin.publishedVersion)
    if (!run.ok) throw new Error('store test run failed')
    const deletion = store.deleteFamily(builtin.templateId)
    if (deletion.ok) throw new Error('shipped template must not be deletable')
    if (deletion.error?.code !== 'builtin-template') throw new Error(`wrong code: ${deletion.error?.code}`)
  })

  console.log(`\n=== All ${passed} video-template checks passed ===`)
}

main()
