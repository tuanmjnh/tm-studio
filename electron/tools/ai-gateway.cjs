// =============================================================================
//  TM TOOLS - AI GATEWAY (main process).
//
//  One abstraction over OpenAI-compatible chat APIs plus audio transcription,
//  zero dependencies (raw fetch). Port of the tm-trading/ai/gateway.mjs
//  pattern, adapted for Electron: API keys never touch the renderer, calls
//  go through IPC, and every call is audit-logged.
//
//  Families (selected by provider name):
//   - openai    : POST {base}/chat/completions (OpenAI, OpenRouter, Groq,
//                 Ollama, Gemini OpenAI endpoint, and every OpenAI-compatible
//                 AGGREGATOR — one base URL routing many providers/models,
//                 e.g. FreeLLMAPI, 9Router/OmniRoute, LiteLLM)
//   - anthropic : POST {base}/v1/messages
//
//  PROVIDER_PRESETS below is the single source for default endpoints, so a
//  misconfigured provider can no longer silently fall back to api.openai.com:
//  an unknown/aggregator provider without a built-in endpoint fails with
//  ai.no-base-url and one without a documented default model with ai.no-model.
//
//  Transcription uses the OpenAI-compatible audio endpoint:
//   - POST {base}/audio/transcriptions (Groq Whisper, OpenAI Whisper)
//
//  Model discovery (aggregator support):
//   - GET {base}/models -> listModels() -> the renderer's model picker
//
//  Task routing (docs section 66): callers pass task: transcribe | triage |
//  plan and the gateway resolves per-task model overrides from env
//  (AI_MODEL_TRANSCRIBE / AI_MODEL_TRIAGE / AI_MODEL_PLAN, else AI_MODEL).
//
//  Env: AI_PROVIDER, AI_API_KEY, AI_BASE_URL, AI_MODEL, AI_MAX_TOKENS,
//       AI_TIMEOUT_MS, AI_RPM, AI_TEMPERATURE, AI_LOG_DIR
//  Per-call overrides (e.g. from TM Hub app configs) win over env.
//
//  Stable error codes (AIGatewayError.code):
//   ai.no-key | ai.no-base-url | ai.no-model | ai.rate-limited | ai.timeout |
//   ai.network | ai.http-error | ai.api-error | ai.bad-shape | ai.no-file
// =============================================================================

const fs = require('node:fs')
const path = require('node:path')

/** Gateway error with a stable machine-readable `code`. */
class AIGatewayError extends Error {
  constructor(code, message, extra) {
    super(message)
    this.name = 'AIGatewayError'
    this.code = code
    Object.assign(this, extra || {})
  }
}

/**
 * AI tasks with dedicated configuration slots. The two AI surfaces of the
 * app route through these ids: `plan` = script generation (editor modal),
 * `transcribe` = captions/subtitles (editor + AutoCut), `triage` = AutoCut
 * content analysis. Each task can run on a DIFFERENT provider/model while
 * everything unset falls back to the global AI_* config.
 */
const AI_TASKS = ['plan', 'triage', 'transcribe']

/**
 * Build config from env (pure — tests pass their own env object).
 *
 * With `task` (see AI_TASKS) the per-task slots apply on ONE simple rule:
 * explicit per-task fields win, and a per-task PROVIDER override re-scopes
 * the *defaults* (that provider's endpoint + model) so one gateway can run
 * plan -> anthropic and transcribe -> groq from a single config.env:
 *
 *   AI_PROVIDER_<T> | AI_BASE_URL_<T> | AI_API_KEY_<T> | AI_MODEL_<T>   (T = PLAN/TRIAGE/TRANSCRIBE)
 *
 * Without a task this is exactly legacy aiConfig().
 */
function taskConfig(task, env) {
  const source = env || process.env
  // Numeric env vars must be guarded: a typo such as AI_TIMEOUT_MS=abc would
  // otherwise yield NaN and every call would abort as ai.timeout.
  const num = (raw, fallback) => {
    const n = Number(raw)
    return raw === undefined || raw === '' || !Number.isFinite(n) ? fallback : n
  }
  // Only the known surfaces get slots — an arbitrary task string must not
  // silently invent config keys.
  const up = AI_TASKS.includes(String(task || '').toLowerCase()) ? String(task).toUpperCase() : ''
  const slot = base => (up ? String(source[`${base}_${up}`] || '').trim() : '')
  const globalProvider = String(source.AI_PROVIDER || 'openai').toLowerCase()
  const provider = (slot('AI_PROVIDER') || globalProvider).toLowerCase()
  // An explicit global base URL applies only while the task did NOT switch
  // providers; a switched provider re-scopes to its own endpoint unless
  // AI_BASE_URL_<T> is explicit (that is the whole point of a switch).
  const globalBaseUrl = String(source.AI_BASE_URL || '').trim()
  const baseUrl = slot('AI_BASE_URL')
    || (provider === globalProvider
      ? (globalBaseUrl || defaultBaseUrl(provider))
      : defaultBaseUrl(provider))
  const apiKey = slot('AI_API_KEY') || String(source.AI_API_KEY || '').trim()
  // Model follows the same switch rule: a different provider must not
  // inherit the global model id (aggregator ids are provider-specific).
  const globalModel = String(source.AI_MODEL || '').trim()
  const model = slot('AI_MODEL')
    || (provider === globalProvider ? (globalModel || defaultModel(provider)) : defaultModel(provider))
  return Object.freeze({
    provider,
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    model,
    task: up || '',
    maxTokens: num(source.AI_MAX_TOKENS, 1024),
    timeoutMs: num(source.AI_TIMEOUT_MS, 60000),
    rpm: num(source.AI_RPM, 30),
    temperature: num(source.AI_TEMPERATURE, 0.3),
    logDir: String(source.AI_LOG_DIR || '').trim()
  })
}

/** Global config (no task slot applied). Kept as the stable public entry. */
function aiConfig(env) {
  return taskConfig(null, env)
}

/**
 * Provider presets — the single source for built-in endpoints and for the
 * renderer's provider picker. `family` selects the request/response shape,
 * `keyless` marks local runtimes that need no API key, `requiresModel` marks
 * providers whose model ids cannot be guessed (aggregators proxy arbitrary
 * provider/model pairs, so AI_MODEL must be chosen explicitly).
 *
 * `baseUrl: ''` means "no guessable endpoint": AI_BASE_URL is required.
 */
const PROVIDER_PRESETS = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com', family: 'anthropic' },
  { id: 'gemini', label: 'Google Gemini (OpenAI-compatible)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'mistral', label: 'Mistral AI', baseUrl: 'https://api.mistral.ai/v1' },
  { id: 'together', label: 'Together AI', baseUrl: 'https://api.together.xyz/v1' },
  { id: 'cerebras', label: 'Cerebras', baseUrl: 'https://api.cerebras.ai/v1' },
  { id: 'amd_radeon', label: 'AMD Radeon AI', baseUrl: 'https://developer.amd.com.cn/radeon/api/v1' },
  { id: 'ollama', label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', keyless: true },
  // Multi-provider gateway: one API surface in front of many providers/models.
  { id: 'freellmapi', label: 'FreeLLMAPI (multi-provider gateway)', baseUrl: '', keyless: true, requiresModel: true },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', baseUrl: '', requiresModel: true }
]

function presetFor(provider) {
  const id = String(provider || '').toLowerCase()
  return PROVIDER_PRESETS.find(candidate => candidate.id === id) || null
}

/** JSON-safe preset list for the renderer's provider picker. */
function providerPresets() {
  return PROVIDER_PRESETS.map(preset => ({
    id: preset.id,
    label: preset.label,
    baseUrl: preset.baseUrl,
    keyless: preset.keyless === true,
    requiresModel: preset.requiresModel === true,
    needsBaseUrl: !preset.baseUrl
  }))
}

function defaultBaseUrl(provider) {
  const preset = presetFor(provider)
  return preset ? preset.baseUrl : ''
}

function defaultModel(provider) {
  if (provider === 'anthropic') return 'claude-haiku-4-5'
  const preset = presetFor(provider)
  if (preset && preset.requiresModel) return ''
  return 'gpt-4o-mini'
}

/** The provider has no built-in endpoint, so AI_BASE_URL must be set. */
function needsBaseUrl(provider) {
  return defaultBaseUrl(provider) === ''
}

function assertEndpoint(cfg) {
  if (!cfg.baseUrl) {
    throw new AIGatewayError(
      'ai.no-base-url',
      `Provider "${cfg.provider}" has no built-in endpoint — set AI_BASE_URL to an OpenAI-compatible base URL`
    )
  }
}

function isLocalEndpoint(baseUrl) {
  if (!baseUrl) return false
  const s = String(baseUrl).trim()
  if (!s) return false
  try {
    const raw = s.includes('://') ? s : `http://${s}`
    const u = new URL(raw)
    const h = u.hostname.toLowerCase()
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0' || h.endsWith('.local')
      || /^(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.)/.test(h)
  } catch {
    return /localhost|127\.0\.0\.1|::1|0\.0\.0\.0|\.local/i.test(s)
  }
}

function assertCredentials(cfg) {
  const preset = presetFor(cfg.provider)
  if (preset && preset.keyless) return
  if (isLocalEndpoint(cfg.baseUrl)) return
  if (!cfg.apiKey) throw new AIGatewayError('ai.no-key', `Missing API key for provider "${cfg.provider}"`)
}

/**
 * Task routing helpers (docs §66). The config slots themselves live in
 * taskConfig(): AI_PROVIDER_<T> / AI_BASE_URL_<T> / AI_API_KEY_<T> /
 * AI_MODEL_<T> for the T = PLAN | TRIAGE | TRANSCRIBE surfaces.
 * This helper resolves just the model slot on top of an already-resolved
 * config (kept for callers that resolve config once, then route tasks).
 */
function resolveTaskModel(task, cfg, env) {
  const source = env || process.env
  const key = `AI_MODEL_${String(task || '').toUpperCase()}`
  const override = String((source && source[key]) || '').trim()
  if (override) return override
  return cfg.model
}

/**
 * Effective model for ONE call. taskConfig() already resolved the model:
 * global AI_MODEL, then the AI_MODEL_<TASK> slot, then the provider default.
 * The one case that must NOT inherit the configured model: a per-call
 * `provider` override that differs from it — model ids are provider-
 * specific, so switching providers re-derives that provider's default
 * ('' for aggregators, which forces ai.no-model instead of silently
 * requesting a model the new endpoint may not expose).
 */
function resolveCallModel(input, envCfg, provider) {
  if (input.model) return String(input.model)
  if (input.provider && String(input.provider).toLowerCase() !== envCfg.provider) {
    return defaultModel(provider)
  }
  return envCfg.model
}

/** Sliding-window rate limiter (rpm calls per 60s). */
class RateLimiter {
  constructor(limit, windowMs) {
    this.limit = Math.max(1, Number(limit) || 1)
    this.windowMs = Math.max(1, Number(windowMs) || 60000)
    this.stamps = []
  }

  attempt(now) {
    const at = now === undefined ? Date.now() : now
    const cut = at - this.windowMs
    this.stamps = this.stamps.filter(t => t > cut)
    if (this.stamps.length >= this.limit) {
      const waitMs = Math.max(1, this.stamps[0] + this.windowMs - at)
      return { ok: false, retryAfterMs: waitMs }
    }
    this.stamps.push(at)
    return { ok: true, retryAfterMs: 0 }
  }
}

/** Canonical {role, content} messages -> provider request. */
function buildChatRequest(cfg, input) {
  const messages = (input.messages || []).map(m => ({
    role: m.role,
    content: String(m.content ?? '')
  }))
  if (cfg.provider === 'anthropic') {
    return {
      url: `${cfg.baseUrl}/v1/messages`,
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: {
        model: input.model || cfg.model,
        max_tokens: input.maxTokens || cfg.maxTokens,
        temperature: input.temperature !== undefined ? input.temperature : cfg.temperature,
        messages
      }
    }
  }
  const body = {
    model: input.model || cfg.model,
    max_tokens: input.maxTokens || cfg.maxTokens,
    temperature: input.temperature !== undefined ? input.temperature : cfg.temperature,
    messages
  }
  if (input.jsonMode) body.response_format = { type: 'json_object' }
  const headers = { 'content-type': 'application/json' }
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`
  return { url: `${cfg.baseUrl}/chat/completions`, headers, body }
}

/** Provider response JSON -> { content, usage }. Throws AIGatewayError. */
function parseChatResponse(provider, json) {
  if (provider === 'anthropic') {
    const text = json && Array.isArray(json.content)
      ? json.content.filter(b => b && b.type === 'text').map(b => b.text).join('')
      : ''
    if (!text) throw new AIGatewayError('ai.bad-shape', 'Anthropic response has no text content')
    return { content: text, usage: json.usage || null }
  }
  const message = json && json.choices && json.choices[0] && json.choices[0].message
  const content = message && typeof message.content === 'string' ? message.content : ''
  if (!content) throw new AIGatewayError('ai.bad-shape', 'Chat response has no message content')
  return { content, usage: json.usage || null }
}

function excerpt(value, length) {
  const text = String(value ?? '')
  const max = length || 1200
  return text.length > max ? `${text.slice(0, max)}…[+${text.length - max} chars]` : text
}

function appendAudit(logDir, entry) {
  if (!logDir) return
  try {
    fs.mkdirSync(logDir, { recursive: true })
    fs.appendFileSync(path.join(logDir, 'ai.ndjson'), `${JSON.stringify(entry)}\n`, 'utf8')
  } catch {
    // audit must never break the call
  }
}

async function postJson(url, headers, body, timeoutMs, fetchImpl) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const fetchFn = fetchImpl || fetch
    const res = await fetchFn(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    })
    const text = await res.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    return { status: res.status, json, text }
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new AIGatewayError('ai.timeout', `Request timed out after ${timeoutMs}ms`)
    }
    throw new AIGatewayError('ai.network', String((err && err.message) || err))
  } finally {
    clearTimeout(timer)
  }
}

const limiters = new Map()

function limiterFor(key, rpm) {
  const id = `${key}:${rpm}`
  if (!limiters.has(id)) limiters.set(id, new RateLimiter(rpm))
  return limiters.get(id)
}

/**
 * Chat completion. `args`: { provider?, apiKey?, baseUrl?, model?,
 * messages, maxTokens?, temperature?, jsonMode?, task? }.
 * Per-call fields win over env. `opts`: { fetchImpl?, logDir? }.
 */
async function complete(args, opts) {
  const input = args || {}
  const options = opts || {}
  // Task routing (docs §66 + R128): AI_PROVIDER_<T>/AI_BASE_URL_<T>/
  // AI_API_KEY_<T>/AI_MODEL_<T> let each app surface run its own model.
  const envCfg = taskConfig(input.task)
  const cfg = {
    ...envCfg,
    provider: String(input.provider || envCfg.provider).toLowerCase(),
    apiKey: input.apiKey !== undefined ? String(input.apiKey) : envCfg.apiKey,
    baseUrl: (input.baseUrl !== undefined ? String(input.baseUrl) : envCfg.baseUrl).replace(/\/+$/, ''),
    model: resolveCallModel(input, envCfg, String(input.provider || envCfg.provider).toLowerCase())
  }
  if (!input.messages || input.messages.length === 0) {
    throw new AIGatewayError('ai.bad-shape', 'messages must be a non-empty array')
  }
  assertEndpoint(cfg)
  assertCredentials(cfg)
  if (!cfg.model) {
    throw new AIGatewayError('ai.no-model', `No model configured for provider "${cfg.provider}" — set AI_MODEL`)
  }
  const limiter = limiterFor(cfg.model, envCfg.rpm)
  const gate = limiter.attempt()
  if (!gate.ok) {
    throw new AIGatewayError('ai.rate-limited', `Rate limited, retry after ${gate.retryAfterMs}ms`, { retryAfterMs: gate.retryAfterMs })
  }
  const startedAt = Date.now()
  const request = buildChatRequest(cfg, {
    messages: input.messages,
    model: cfg.model,
    maxTokens: input.maxTokens,
    temperature: input.temperature,
    jsonMode: input.jsonMode
  })
  const timeoutMs = Number(input.timeoutMs) > 0 ? Number(input.timeoutMs) : envCfg.timeoutMs
  const { status, json, text } = await postJson(request.url, request.headers, request.body, timeoutMs, options.fetchImpl)
  if (status === 429) {
    throw new AIGatewayError('ai.rate-limited', 'Provider rate limit (429)')
  }
  if (status < 200 || status >= 300) {
    const message = (json && (json.error?.message || json.message)) || text || `HTTP ${status}`
    throw new AIGatewayError('ai.http-error', String(message).slice(0, 500), { status })
  }
  let parsed
  try {
    parsed = parseChatResponse(cfg.provider, json)
  } catch (err) {
    throw new AIGatewayError('ai.api-error', err.message)
  }
  appendAudit(options.logDir !== undefined ? options.logDir : envCfg.logDir || null, {
    at: new Date(startedAt).toISOString(),
    task: input.task || null,
    provider: cfg.provider,
    model: cfg.model,
    prompt: excerpt(input.messages.map(m => m.content).join('\n')),
    response: excerpt(parsed.content),
    usage: parsed.usage,
    latencyMs: Date.now() - startedAt,
    ok: true
  })
  return { content: parsed.content, usage: parsed.usage, model: cfg.model, latencyMs: Date.now() - startedAt }
}

/**
 * Audio transcription via the OpenAI-compatible endpoint.
 * `args`: { filePath, ...config overrides, model?, language?,
 * format?: 'text' | 'verbose_json' }. Verbose mode also returns
 * timestamped segments for speech-aware scoring (docs section 40).
 */
async function transcribe(args, opts) {
  const input = args || {}
  const options = opts || {}
  const envCfg = taskConfig(input.task || 'transcribe')
  const cfg = {
    ...envCfg,
    provider: String(input.provider || envCfg.provider).toLowerCase(),
    apiKey: input.apiKey !== undefined ? String(input.apiKey) : envCfg.apiKey,
    baseUrl: (input.baseUrl !== undefined ? String(input.baseUrl) : envCfg.baseUrl).replace(/\/+$/, ''),
    model: resolveCallModel(input, envCfg, String(input.provider || envCfg.provider).toLowerCase())
  }
  if (typeof input.filePath !== 'string' || !input.filePath) {
    throw new AIGatewayError('ai.no-file', 'filePath must be a non-empty string')
  }
  let buffer
  try {
    buffer = fs.readFileSync(input.filePath)
  } catch {
    throw new AIGatewayError('ai.no-file', `Cannot read file: ${input.filePath}`)
  }
  assertEndpoint(cfg)
  assertCredentials(cfg)
  if (!cfg.model) {
    throw new AIGatewayError('ai.no-model', `No transcription model configured for provider "${cfg.provider}" — set AI_MODEL_TRANSCRIBE or AI_MODEL`)
  }
  const form = new FormData()
  form.append('model', cfg.model)
  form.append('file', new Blob([buffer]), path.basename(input.filePath))
  if (input.language) form.append('language', String(input.language))
  const verbose = input.format === 'verbose_json'
  if (verbose) form.append('response_format', 'verbose_json')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(envCfg.timeoutMs, 5 * 60 * 1000))
  try {
    const fetchFn = options.fetchImpl || fetch
    const res = await fetchFn(`${cfg.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.apiKey}` },
      body: form,
      signal: controller.signal
    })
    const text = await res.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    if (res.status === 429) throw new AIGatewayError('ai.rate-limited', 'Provider rate limit (429)')
    if (res.status < 200 || res.status >= 300) {
      throw new AIGatewayError('ai.http-error', String((json && json.error?.message) || text || `HTTP ${res.status}`).slice(0, 500), { status: res.status })
    }
    const transcript = json && typeof json.text === 'string' ? json.text : ''
    if (!transcript) throw new AIGatewayError('ai.bad-shape', 'Transcription response has no text')
    const result = { text: transcript }
    if (verbose && json && Array.isArray(json.segments)) {
      result.segments = json.segments
        .filter(segment => segment && Number.isFinite(segment.start) && Number.isFinite(segment.end))
        .map(segment => ({ start: segment.start, end: segment.end, text: String(segment.text || '') }))
    }
    return result
  } catch (err) {
    if (err instanceof AIGatewayError) throw err
    if (err && err.name === 'AbortError') throw new AIGatewayError('ai.timeout', 'Transcription timed out')
    throw new AIGatewayError('ai.network', String((err && err.message) || err))
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Discover the models an endpoint exposes (GET {base}/models). This is what
 * makes a multi-provider gateway (FreeLLMAPI, OpenRouter, LiteLLM, …) usable:
 * one base URL and one key, many provider/model ids to choose from.
 *
 * Tolerates the three response shapes seen in the wild:
 *   { data: [{ id }] } | { models: [{ id | name }] } | [{ id }]
 * `args` accepts the same per-call overrides as complete(): { provider?,
 * apiKey?, baseUrl?, task? }. With a `task` (R139) the SAME per-surface
 * AI_*_<TASK> slots complete() uses resolve the endpoint + stored key, so
 * a "test this surface" action can verify a saved surface without the
 * renderer ever holding its key. Without a task this is the global config.
 * `opts`: { fetchImpl? } for tests.
 */
async function listModels(args, opts) {
  const input = args || {}
  const options = opts || {}
  const envCfg = taskConfig(input.task)
  const cfg = {
    ...envCfg,
    provider: String(input.provider || envCfg.provider).toLowerCase(),
    apiKey: input.apiKey !== undefined ? String(input.apiKey) : envCfg.apiKey,
    baseUrl: (input.baseUrl !== undefined ? String(input.baseUrl) : envCfg.baseUrl).replace(/\/+$/, '')
  }
  assertEndpoint(cfg)
  assertCredentials(cfg)

  const headers = {}
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), envCfg.timeoutMs)
  try {
    const fetchFn = options.fetchImpl || fetch
    let res = await fetchFn(`${cfg.baseUrl}/models`, {
      method: 'GET',
      headers,
      signal: controller.signal
    })
    if (res.status === 404) {
      const altBase = cfg.baseUrl.endsWith('/v1') ? cfg.baseUrl.replace(/\/v1$/, '') : `${cfg.baseUrl}/v1`
      try {
        const altRes = await fetchFn(`${altBase}/models`, { method: 'GET', headers, signal: controller.signal })
        if (altRes.status >= 200 && altRes.status < 300) res = altRes
      } catch {
        // keep original res
      }
      if (res.status === 404) {
        try {
          const tagsUrl = `${cfg.baseUrl.replace(/\/v1$/, '')}/api/tags`
          const tagsRes = await fetchFn(tagsUrl, { method: 'GET', headers, signal: controller.signal })
          if (tagsRes.status >= 200 && tagsRes.status < 300) res = tagsRes
        } catch {
          // keep original res
        }
      }
    }
    const text = await res.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    if (res.status === 429) throw new AIGatewayError('ai.rate-limited', 'Provider rate limit (429)')
    if (res.status < 200 || res.status >= 300) {
      const message = (json && (json.error?.message || json.message)) || text || `HTTP ${res.status}`
      throw new AIGatewayError('ai.http-error', String(message).slice(0, 500), { status: res.status })
    }
    const rows = Array.isArray(json)
      ? json
      : Array.isArray(json && json.data)
        ? json.data
        : Array.isArray(json && json.models)
          ? json.models
          : []
    const seen = new Map()
    for (const row of rows) {
      const raw = typeof row === 'string' ? row : (row && (row.id || row.name || row.model))
      const id = String(raw || '').trim()
      if (!id || seen.has(id)) continue
      const label = row && typeof row === 'object' && typeof row.name === 'string' && row.name ? row.name : id
      seen.set(id, { id, label })
    }
    if (seen.size === 0) {
      throw new AIGatewayError('ai.bad-shape', 'Model list response has no model ids')
    }
    const models = [...seen.values()].sort((a, b) => a.id.localeCompare(b.id))
    return { models, provider: cfg.provider, baseUrl: cfg.baseUrl, count: models.length }
  } catch (err) {
    if (err instanceof AIGatewayError) throw err
    if (err && err.name === 'AbortError') {
      throw new AIGatewayError('ai.timeout', `Model list timed out after ${envCfg.timeoutMs}ms`)
    }
    throw new AIGatewayError('ai.network', String((err && err.message) || err))
  } finally {
    clearTimeout(timer)
  }
}

let auditDir = null

function maskedStatus() {
  const cfg = aiConfig()
  const preset = presetFor(cfg.provider)
  const keyless = !!(preset && preset.keyless)
  const requiresModel = !!(preset && preset.requiresModel)
  const needsBase = !cfg.baseUrl
  const needsKey = !keyless && cfg.apiKey.length === 0
  const needsModel = requiresModel && !cfg.model
  return {
    provider: cfg.provider,
    providerLabel: preset ? preset.label : cfg.provider,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    hasKey: cfg.apiKey.length > 0,
    keyless,
    needsBaseUrl: needsBase,
    needsModel,
    // A single boolean the UI can badge on: endpoint + credentials + model set.
    configured: !needsBase && !needsKey && !needsModel,
    rpm: cfg.rpm,
    timeoutMs: cfg.timeoutMs
  }
}

/**
 * Per-surface status: one masked entry per AI task, so the editor and the
 * AutoCut panels can each badge the provider/model THEY actually run on
 * (a task may differ from the global config when AI_*_<TASK> slots are set).
 */
function tasksStatus() {
  const out = {}
  const globalCfg = aiConfig()
  for (const task of AI_TASKS) {
    const cfg = taskConfig(task)
    const preset = presetFor(cfg.provider)
    const keyless = !!(preset && preset.keyless)
    const up = task.toUpperCase()
    // True when the surface has its own AI_*_<TASK> slot set, so the UI can
    // render the override editor as active after a reload.
    const customized = ['AI_PROVIDER', 'AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL']
      .some(base => String((process.env && process.env[`${base}_${up}`]) || '').trim() !== '')
    out[task] = {
      provider: cfg.provider,
      providerLabel: preset ? preset.label : cfg.provider,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      hasKey: keyless || cfg.apiKey.length > 0,
      // True when this task's provider differs from the global one.
      overridden: cfg.provider !== globalCfg.provider,
      customized,
      configured: !!cfg.baseUrl && (keyless || cfg.apiKey.length > 0) && !!cfg.model
    }
  }
  return out
}

/** Register IPC handlers. Requires Electron (called from main process only). */
function registerAiGateway() {
  const { app, ipcMain } = require('electron')
  try {
    auditDir = path.join(app.getPath('userData'), 'logs')
  } catch {
    auditDir = null
  }
  ipcMain.handle('tools:ai-gateway:complete', async (_event, args) => {
    try {
      const result = await complete(args, { logDir: auditDir })
      return { ok: true, data: result }
    } catch (err) {
      return { ok: false, code: err.code || 'ai.network', error: err.message }
    }
  })
  ipcMain.handle('tools:ai-gateway:transcribe', async (_event, args) => {
    try {
      const result = await transcribe(args, {})
      return { ok: true, data: result }
    } catch (err) {
      return { ok: false, code: err.code || 'ai.network', error: err.message }
    }
  })
  ipcMain.handle('tools:ai-gateway:getStatus', () => maskedStatus())
  ipcMain.handle('tools:ai-gateway:tasks', () => ({ ok: true, data: { tasks: tasksStatus() } }))
  // Model discovery: lets the renderer offer the model ids an aggregator
  // (FreeLLMAPI et al.) exposes instead of asking the user to type them.
  ipcMain.handle('tools:ai-gateway:models', async (_event, args) => {
    try {
      const result = await listModels(args, {})
      return { ok: true, data: result }
    } catch (err) {
      return { ok: false, code: err.code || 'ai.network', error: err.message }
    }
  })
  ipcMain.handle('tools:ai-gateway:presets', () => ({ ok: true, data: { presets: providerPresets() } }))
}

module.exports = {
  AIGatewayError,
  AI_TASKS,
  aiConfig,
  taskConfig,
  RateLimiter,
  resolveTaskModel,
  buildChatRequest,
  parseChatResponse,
  complete,
  transcribe,
  listModels,
  maskedStatus,
  tasksStatus,
  needsBaseUrl,
  providerPresets,
  registerAiGateway
}
