/**
 * AI provider transfer (JSON / ENV / CSV).
 *
 * One canonical row shape is read from — and written to — all three formats so
 * an exported file can be re-imported without loss:
 *
 *   { provider, name, model, baseUrl, apiKey, enabled }
 *
 * Formats accepted on import:
 *   - JSON: tm-hub / tm-trading export envelopes (`{ connections }`), the
 *     FreeLLMAPI `{ keys }` shape, or a bare array.
 *   - ENV : dotenv text. Either the single-connection block
 *     (`AI_PROVIDER` + `AI_API_KEY` + `AI_BASE_URL` + `AI_MODEL`), or one block
 *     per provider (`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, ...).
 *     A `PREFIX__<name>` segment keeps several accounts of one provider apart.
 *   - CSV : header row with provider/name/model/baseUrl/enabled/apiKey columns
 *     (aliases and any column order are accepted).
 *
 * Secrets only ever travel inside the file the operator picked; nothing here
 * logs or persists a key.
 */
export type AiTransferFormat = 'json' | 'env' | 'csv'

export interface AiTransferRow {
  provider: string
  name: string
  model: string
  baseUrl: string
  apiKey: string
  enabled: boolean
}

export interface AiTransferIssue {
  /** Where the problem was found — a row number, a line or a CSV/JSON offset. */
  source: string
  message: string
}

export interface AiTransferParseResult {
  rows: AiTransferRow[]
  errors: AiTransferIssue[]
  format: AiTransferFormat | null
}

export interface AiTransferParseOptions {
  format?: AiTransferFormat | null
  fileName?: string
  defaultModel?: string
  /** Provider keys the current install knows (from the API catalogue). */
  knownProviders: string[]
  /** Where a provider with an explicit baseUrl but no known key lands. */
  customProviderKey?: string
}

export interface AiTransferMeta {
  appName: string
  appId: string
  includeSecrets: boolean
}

export const AI_TRANSFER_FORMATS: AiTransferFormat[] = ['json', 'env', 'csv']

const PROVIDER_ALIASES: Record<string, string> = {
  'google': 'google_ai',
  'google ai': 'google_ai',
  'google ai studio': 'google_ai',
  'gemini': 'google_ai',
  'github': 'github_models',
  'github models': 'github_models',
  'hf': 'huggingface',
  'hugging face': 'huggingface',
  'nvidia nim': 'nvidia',
  'z.ai': 'zhipu',
  'bigmodel': 'zhipu',
  'custom': 'custom_openai',
  'openai-compatible': 'custom_openai',
  'openai compatible': 'custom_openai'
}

/** Trim and strip one layer of matching quotes (`"sk-..."` / `'sk-...'`). */
export function cleanTransferValue(value: unknown): string {
  let out = String(value ?? '').trim()
  if (out.length >= 2) {
    const head = out[0]
    const tail = out[out.length - 1]
    if ((head === '"' && tail === '"') || (head === '\'' && tail === '\'')) out = out.slice(1, -1).trim()
  }
  return out
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const cleaned = cleanTransferValue(value)
    if (cleaned) return cleaned
  }
  return ''
}

function slugName(input: string, fallback: string): string {
  const raw = cleanTransferValue(input) || fallback
  const slug = raw.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
  return slug || fallback
}

function truthy(value: unknown, fallback = true): boolean {
  const raw = cleanTransferValue(value).toLowerCase()
  if (!raw) return fallback
  if (['0', 'false', 'no', 'off', 'disabled'].includes(raw)) return false
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(raw)) return true
  return fallback
}

/** Best-effort format guess from the file extension, then the payload shape. */
export function detectAiTransferFormat(text: string, fileName = ''): AiTransferFormat | null {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.csv')) return 'csv'
  if (lower.endsWith('.env') || lower.endsWith('.txt') || lower.endsWith('.ini')) return 'env'

  const trimmed = text.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json'
  const firstLine = trimmed.split(/\r?\n/, 1)[0] || ''
  if (/,/.test(firstLine) && /name|provider|model/i.test(firstLine)) return 'csv'
  return 'env'
}

function normalizeAliases(knownProviders: string[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const key of knownProviders) map.set(key.toLowerCase(), key)
  for (const [alias, key] of Object.entries(PROVIDER_ALIASES)) {
    if (!knownProviders.length || knownProviders.includes(key)) map.set(alias, key)
  }
  return map
}

interface RawRow {
  provider: unknown
  name?: unknown
  model?: unknown
  baseUrl?: unknown
  apiKey?: unknown
  enabled?: unknown
}

/**
 * Turn raw rows into validated transfer rows. Unknown providers fall back to
 * the custom-endpoint provider when the row carries its own HTTP base URL;
 * everything else is reported instead of guessed.
 */
function finalizeRows(raw: RawRow[], options: AiTransferParseOptions): AiTransferParseResult {
  const known = options.knownProviders.map(key => key.toLowerCase())
  const aliases = normalizeAliases(options.knownProviders)
  const customKey = options.customProviderKey || 'custom_openai'
  const defaultModel = cleanTransferValue(options.defaultModel)
  const rows: AiTransferRow[] = []
  const errors: AiTransferIssue[] = []
  const usedNames = new Set<string>()

  raw.forEach((entry, index) => {
    const source = `#${index + 1}`
    const baseUrl = firstString(entry.baseUrl)
    const providerRaw = firstString(entry.provider).toLowerCase()
    let provider = aliases.get(providerRaw) || (known.includes(providerRaw) ? providerRaw : '')

    if (!provider) {
      const looksHttp = /^https?:\/\//i.test(baseUrl)
      if (providerRaw && looksHttp && known.includes(customKey)) provider = customKey
      else if (!providerRaw && looksHttp && known.includes(customKey)) provider = customKey
      else {
        errors.push({
          source,
          message: providerRaw
            ? `unknown provider "${providerRaw}" (add it in TM Hub first, or provide a baseUrl to import it as ${customKey})`
            : 'provider is required'
        })
        return
      }
    }

    const model = firstString(entry.model) || defaultModel
    if (!model) {
      errors.push({ source, message: `${provider}: model is required (set a default model or add a model column)` })
      return
    }

    let name = slugName(firstString(entry.name), 'default')
    if (usedNames.has(`${provider}:${name}`)) {
      let n = 2
      while (usedNames.has(`${provider}:${name}-${n}`)) n += 1
      name = `${name}-${n}`
    }
    usedNames.add(`${provider}:${name}`)

    rows.push({
      provider,
      name,
      model,
      baseUrl,
      apiKey: firstString(entry.apiKey),
      enabled: truthy(entry.enabled, true)
    })
  })

  return { rows, errors, format: null }
}

// ── JSON ──────────────────────────────────────────────────────────────────────

function rowsFromJson(text: string): RawRow[] {
  const parsed = JSON.parse(text) as unknown
  let list: unknown[] = []
  if (Array.isArray(parsed)) {
    list = parsed
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    if (Array.isArray(obj.connections)) list = obj.connections
    else if (Array.isArray(obj.keys)) list = obj.keys
    else if (Array.isArray(obj.providers)) list = obj.providers
    else {
      // Keyed dictionary of providers e.g. { "freellmapi": { ... }, "openai": { ... } }
      const entries: RawRow[] = []
      for (const [providerKey, val] of Object.entries(obj)) {
        if (!val || typeof val !== 'object') continue
        const item = val as Record<string, unknown>
        const opts = (item.options && typeof item.options === 'object') ? (item.options as Record<string, unknown>) : {}
        const models = (item.models && typeof item.models === 'object') ? (item.models as Record<string, unknown>) : {}
        const modelNames = Object.keys(models)
        const firstModel = modelNames[0] || ''
        entries.push({
          provider: item.provider ?? item.platform ?? item.key ?? providerKey,
          name: item.name ?? item.label ?? providerKey,
          model: item.model ?? item.modelId ?? item.defaultModel ?? opts.model ?? firstModel,
          baseUrl: item.baseUrl ?? item.base_url ?? item.apiBase ?? item.api_base ?? item.url ?? opts.baseURL ?? opts.baseUrl,
          apiKey: item.apiKey ?? item.api_key ?? item.key ?? item.token ?? item.secret ?? opts.apiKey,
          enabled: item.enabled ?? item.isEnabled ?? (item.disabled === true ? false : undefined)
        })
      }
      if (entries.length > 0) return entries
    }
  }
  if (!Array.isArray(list)) throw new Error('expected an array, or an object with a connections/keys array')
  return list.map((item) => {
    const entry = (item || {}) as Record<string, unknown>
    const opts = (entry.options && typeof entry.options === 'object') ? (entry.options as Record<string, unknown>) : {}
    const models = (entry.models && typeof entry.models === 'object') ? (entry.models as Record<string, unknown>) : {}
    const modelNames = Object.keys(models)
    const firstModel = modelNames[0] || ''
    return {
      provider: entry.provider ?? entry.platform ?? entry.key ?? entry.providerKey,
      name: entry.name ?? entry.label,
      model: entry.model ?? entry.modelId ?? entry.defaultModel ?? entry.primaryModel ?? opts.model ?? firstModel,
      baseUrl: entry.baseUrl ?? entry.base_url ?? entry.apiBase ?? entry.api_base ?? entry.url ?? opts.baseURL ?? opts.baseUrl,
      apiKey: entry.apiKey ?? entry.api_key ?? entry.key ?? entry.token ?? entry.secret ?? opts.apiKey,
      enabled: entry.enabled ?? entry.isEnabled ?? (entry.disabled === true ? false : undefined)
    }
  })
}

// ── ENV ───────────────────────────────────────────────────────────────────────

const ENV_ROLE_SUFFIXES: Array<{ role: 'apiKey' | 'baseUrl' | 'model' | 'name' | 'enabled', suffix: string }> = [
  { role: 'apiKey', suffix: '_API_KEY' },
  { role: 'apiKey', suffix: '_KEY' },
  { role: 'apiKey', suffix: '_TOKEN' },
  { role: 'apiKey', suffix: '_SECRET' },
  { role: 'baseUrl', suffix: '_BASE_URL' },
  { role: 'baseUrl', suffix: '_URL' },
  { role: 'model', suffix: '_MODEL' },
  { role: 'name', suffix: '_NAME' },
  { role: 'enabled', suffix: '_ENABLED' }
]

function envLines(text: string): Array<{ key: string, value: string }> {
  const out: Array<{ key: string, value: string }> = []
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('export ')) line = line.slice(7).trim()
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (!/^[A-Za-z0-9_.-]+$/.test(key)) continue
    out.push({ key: key.toUpperCase(), value: line.slice(eq + 1).trim() })
  }
  return out
}

/** Split `OPENAI__work_API_KEY` into `{ prefix: 'OPENAI', name: 'work' }`. */
function splitEnvKey(key: string): { prefix: string, name: string, role: string | null } {
  for (const { role, suffix } of ENV_ROLE_SUFFIXES) {
    if (!key.endsWith(suffix)) continue
    const head = key.slice(0, -suffix.length)
    const sep = head.indexOf('__')
    if (sep > 0) return { prefix: head.slice(0, sep), name: head.slice(sep + 2), role }
    return { prefix: head, name: '', role }
  }
  return { prefix: '', name: '', role: null }
}

function rowsFromEnv(text: string): RawRow[] {
  const lines = envLines(text)
  const blocks = new Map<string, { provider: string, name: string, values: Record<string, string> }>()

  const blockFor = (provider: string, name: string) => {
    const id = `${provider}:${name}`
    let block = blocks.get(id)
    if (!block) {
      block = { provider, name, values: {} }
      blocks.set(id, block)
    }
    return block
  }

  // Single-connection dotenv block (the app's own AI_* keys).
  const generic: Record<string, string> = {}
  for (const { key, value } of lines) {
    if (key === 'AI_PROVIDER' || key === 'AI_API_KEY' || key === 'AI_BASE_URL' || key === 'AI_MODEL' || key === 'AI_NAME') {
      generic[key] = value
      continue
    }
    const split = splitEnvKey(key)
    if (!split.role || split.prefix === 'AI') continue
    const provider = split.prefix.toLowerCase().replace(/-/g, '_')
    const block = blockFor(provider, split.name.toLowerCase())
    block.values[split.role] = value
  }

  const rows: RawRow[] = []
  if (generic.AI_PROVIDER || generic.AI_API_KEY) {
    rows.push({
      provider: generic.AI_PROVIDER,
      name: generic.AI_NAME,
      model: generic.AI_MODEL,
      baseUrl: generic.AI_BASE_URL,
      apiKey: generic.AI_API_KEY,
      enabled: generic.AI_ENABLED
    })
  }
  for (const block of blocks.values()) {
    rows.push({
      provider: block.provider,
      name: block.values.name || block.name,
      model: block.values.model,
      baseUrl: block.values.baseUrl,
      apiKey: block.values.apiKey,
      enabled: block.values.enabled
    })
  }
  return rows
}

// ── CSV ───────────────────────────────────────────────────────────────────────

/** RFC4180-ish splitter: quoted fields, escaped quotes, CRLF/LF rows. */
function parseCsvGrid(text: string): string[][] {
  const grid: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      quoted = true
      continue
    }
    if (ch === ',' || ch === ';' || ch === '\t') {
      row.push(field)
      field = ''
      continue
    }
    if (ch === '\n') {
      row.push(field)
      grid.push(row)
      row = []
      field = ''
      continue
    }
    if (ch === '\r') continue
    field += ch
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    grid.push(row)
  }
  return grid.filter(cells => cells.some(cell => cell.trim() !== ''))
}

const CSV_HEADER_ALIASES: Record<string, keyof RawRow> = {
  provider: 'provider',
  platform: 'provider',
  key: 'provider',
  name: 'name',
  label: 'name',
  credential: 'name',
  model: 'model',
  modelid: 'model',
  defaultmodel: 'model',
  baseurl: 'baseUrl',
  url: 'baseUrl',
  endpoint: 'baseUrl',
  apikey: 'apiKey',
  key_apikey: 'apiKey',
  token: 'apiKey',
  secret: 'apiKey',
  enabled: 'enabled',
  disabled: 'enabled',
  isenabled: 'enabled',
  status: 'enabled'
}

function headerRole(cell: string): keyof RawRow | null {
  // Excel writes a UTF-8 BOM before the first header — it is not part of the name.
  const raw = cell.replace(/^\uFEFF/, '').toLowerCase().replace(/[\s_-]+/g, '')
  return CSV_HEADER_ALIASES[raw] ?? null
}

function rowsFromCsv(text: string): RawRow[] {
  const grid = parseCsvGrid(text)
  if (grid.length < 2) return []
  const header = grid[0]!.map(headerRole)
  const rows: RawRow[] = []
  for (const cells of grid.slice(1)) {
    const entry: RawRow = { provider: '' }
    header.forEach((role, index) => {
      if (!role) return
      const value = cells[index]
      if (value === undefined) return
      if (role === 'enabled') entry.enabled = /^(0|false|no|off|disabled)$/i.test(value.trim()) ? false : value
      else entry[role] = value
    })
    rows.push(entry)
  }
  return rows
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Format decoding only: every row is cleaned, but the provider key is NOT
 * mapped or validated — callers that validate server-side (tm-trading's import
 * endpoint) send these rows straight through.
 */
export function decodeAiTransfer(text: string, options: {
  format?: AiTransferFormat | null
  fileName?: string
} = {}): { rows: AiTransferRow[], errors: AiTransferIssue[], format: AiTransferFormat | null } {
  const content = String(text ?? '').replace(/^\uFEFF/, '').trim()
  if (!content) return { rows: [], errors: [{ source: 'file', message: 'the file is empty' }], format: null }

  let format = options.format ?? null
  if (format === 'json' && !/^[[{]/.test(content)) format = null
  format = format || detectAiTransferFormat(content, options.fileName || '')
  if (!format) return { rows: [], errors: [{ source: 'file', message: 'unrecognized format' }], format: null }

  let raw: RawRow[]
  try {
    if (format === 'json') raw = rowsFromJson(content)
    else if (format === 'csv') raw = rowsFromCsv(content)
    else raw = rowsFromEnv(content)
  } catch (err) {
    return {
      rows: [],
      errors: [{ source: 'file', message: err instanceof Error ? err.message : 'could not parse the file' }],
      format
    }
  }

  if (raw.length === 0) {
    return { rows: [], errors: [{ source: 'file', message: `no rows found in this ${format.toUpperCase()} file` }], format }
  }

  return {
    rows: raw.map(row => ({
      provider: firstString(row.provider),
      name: firstString(row.name),
      model: firstString(row.model),
      baseUrl: firstString(row.baseUrl),
      apiKey: firstString(row.apiKey),
      enabled: truthy(row.enabled, true)
    })),
    errors: [],
    format
  }
}

export function parseAiTransfer(text: string, options: AiTransferParseOptions): AiTransferParseResult {
  const decoded = decodeAiTransfer(text, { format: options.format, fileName: options.fileName })
  if (decoded.errors.length || !decoded.format) return decoded

  const finalized = finalizeRows(decoded.rows, options)
  return { rows: finalized.rows, errors: finalized.errors, format: decoded.format }
}

function csvCell(value: string): string {
  const raw = String(value ?? '')
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw
}

function envPrefix(row: AiTransferRow): string {
  const base = row.provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
  if (!row.name || row.name === 'default') return base
  const suffix = row.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
  return suffix ? `${base}__${suffix}` : base
}

export function serializeAiTransfer(
  rows: AiTransferRow[],
  format: AiTransferFormat,
  meta: AiTransferMeta
): { content: string, fileName: string, mime: string } {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const baseName = `${meta.appName}-ai-providers-${stamp}`

  if (format === 'json') {
    const content = JSON.stringify({
      version: 1,
      source: meta.appName,
      appId: meta.appId,
      exportedAt: new Date().toISOString(),
      includeSecrets: meta.includeSecrets,
      connections: rows.map(row => ({
        provider: row.provider,
        name: row.name,
        model: row.model,
        baseUrl: row.baseUrl || null,
        enabled: row.enabled,
        ...(meta.includeSecrets && row.apiKey ? { apiKey: row.apiKey } : {})
      }))
    }, null, 2)
    return { content, fileName: `${baseName}.json`, mime: 'application/json' }
  }

  if (format === 'csv') {
    const header = meta.includeSecrets
      ? ['provider', 'name', 'model', 'baseUrl', 'enabled', 'apiKey']
      : ['provider', 'name', 'model', 'baseUrl', 'enabled']
    const lines = [header.join(',')]
    for (const row of rows) {
      const cells = [row.provider, row.name, row.model, row.baseUrl, row.enabled ? 'true' : 'false']
      if (meta.includeSecrets) cells.push(row.apiKey)
      lines.push(cells.map(csvCell).join(','))
    }
    return { content: `${lines.join('\n')}\n`, fileName: `${baseName}.csv`, mime: 'text/csv' }
  }

  const lines = [
    `# ${meta.appName} — AI providers`,
    `# app: ${meta.appId} · exported: ${new Date().toISOString()}`,
    `# secrets: ${meta.includeSecrets ? 'included' : 'not included'}`,
    ''
  ]
  for (const row of rows) {
    const prefix = envPrefix(row)
    lines.push(`# ${row.provider} · ${row.name}${row.enabled ? '' : ' · disabled'}`)
    if (meta.includeSecrets && row.apiKey) lines.push(`${prefix}_API_KEY=${row.apiKey}`)
    if (row.baseUrl) lines.push(`${prefix}_BASE_URL=${row.baseUrl}`)
    lines.push(`${prefix}_MODEL=${row.model}`)
    lines.push(`${prefix}_NAME=${row.name}`)
    if (!row.enabled) lines.push(`${prefix}_ENABLED=0`)
    lines.push('')
  }
  return { content: `${lines.join('\n').trimEnd()}\n`, fileName: `${baseName}.env`, mime: 'text/plain' }
}
