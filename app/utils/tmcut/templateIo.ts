/**
 * R131 — Template file exchange (.tmcut-template.json) pure helpers.
 *
 * Template JSON leaves the app so users can move/share templates between
 * machines (the library itself lives in localStorage, per install). The
 * file format is versioned, and every import is treated as UNTRUSTED input
 * (same doctrine as the AI parsers): garbage returns null, it never throws
 * into the UI, and imported templates are never allowed to masquerade as
 * builtins or to collide with an existing template id.
 *
 * Pure module: no Vue, no window, no Electron — the composable owns IO.
 */
import { migrateTemplate, validateTemplate } from '@tmcut-core'
import type { TmcutTemplate } from '~/types/tmcut'

export const TEMPLATE_FILE_KIND = 'tmcut-template'
export const TEMPLATE_FILE_VERSION = 1

/** Upper bound for an imported template file (real templates are KBs). */
export const MAX_TEMPLATE_FILE_BYTES = 8 * 1024 * 1024

/** How many user templates may be imported at once via batch selection. */
export const MAX_IMPORT_BATCH = 50

export interface TemplateFileEnvelope {
  kind: typeof TEMPLATE_FILE_KIND
  version: number
  exportedAt: string
  template: TmcutTemplate
}

let idCounter = 0

/** Fresh id for imported templates — never reuse the file's id. */
export function newTemplateId(): string {
  idCounter += 1
  return `usr_tpl_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

/** Serialize a template into the portable file format. */
export function buildTemplateFile(template: TmcutTemplate): string {
  const envelope: TemplateFileEnvelope = {
    kind: TEMPLATE_FILE_KIND,
    version: TEMPLATE_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    template
  }
  return JSON.stringify(envelope, null, 2)
}

/** Default export filename: slugified template name. */
export function safeTemplateFileName(template: Pick<TmcutTemplate, 'name'>): string {
  const base = String(template.name || 'template')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${base || 'template'}.tmcut-template.json`
}

export type TemplateImportErrorCode
  = | 'empty'
    | 'too-large'
    | 'invalid-json'
    | 'invalid-format'
    | 'validation-failed'

export interface TemplateImportResult {
  ok: boolean
  template?: TmcutTemplate
  error?: TemplateImportErrorCode
  /** Core validator messages, present with 'validation-failed'. */
  details?: string[]
}

/**
 * Accept the envelope ({kind, template}) OR a bare template object (a
 * hand-written file, or JSON copied from another tool), then hard-sanitize:
 * - isBuiltin forced false (an import can never look like an app builtin)
 * - id regenerated (no collision with builtins or existing user templates)
 * - core validateTemplate gates the structure
 * Returns null on anything structurally unusable.
 */
export function sanitizeImportedTemplate(raw: unknown): TmcutTemplate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const candidate = (obj.template && typeof obj.template === 'object' && !Array.isArray(obj.template))
    ? obj.template
    : obj
  const tpl = structuredClone(candidate) as unknown as TmcutTemplate
  tpl.isBuiltin = false
  tpl.id = newTemplateId()
  // createdAt is display metadata; keep it when sane, otherwise now.
  if (typeof tpl.createdAt !== 'number' || !Number.isFinite(tpl.createdAt)) {
    tpl.createdAt = Date.now()
  }
  // Roadmap v3 §6.4 step 1: migrate + validate BEFORE anything else. A
  // template written by a newer schema is refused with a clear message
  // (core migrateTemplate), never half-read; a clean import is stamped
  // with the current schema version.
  const migration = migrateTemplate(tpl)
  if (!migration.migrated) return null
  return migration.migrated as unknown as TmcutTemplate
}

/** Parse an imported file body. Never throws. */
export function parseTemplateFile(text: string): TemplateImportResult {
  if (!text || !text.trim()) return { ok: false, error: 'empty' }
  if (text.length > MAX_TEMPLATE_FILE_BYTES) return { ok: false, error: 'too-large' }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'invalid-json' }
  }
  const tpl = sanitizeImportedTemplate(parsed)
  if (!tpl) {
    // Distinguish "shape wrong" from "core validator refused the content"
    // only when a candidate object exists at all.
    const hasCandidate = parsed && typeof parsed === 'object'
    if (!hasCandidate) return { ok: false, error: 'invalid-format' }
    const obj = parsed as Record<string, unknown>
    const candidate = (obj.template && typeof obj.template === 'object') ? obj.template : parsed
    const validation = validateTemplate(candidate)
    return { ok: false, error: 'validation-failed', details: validation.errors }
  }
  return { ok: true, template: tpl }
}
