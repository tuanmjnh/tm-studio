import type {
  AiChatMessage,
  AiCompleteInput,
  AiCompleteResult,
  AiGatewayStatus,
  AiModelInfo,
  AiProviderPreset,
  AiRelayConnection,
  AiTaskStatus
} from '#shared/types/electron'
import { useHub } from './useHub'

function aiApi() {
  return typeof window !== 'undefined' ? window.electronAPI?.tools?.aiGateway : undefined
}

// ===== Web (browser) runtime: TM Hub AI relay through the local Nitro proxy =====
// The desktop gateway (Electron IPC) and the web relay both return the same
// shapes so consumers keep one code path. The web branch calls our OWN server
// (/api/v1/ai/relay/*, user-JWT protected) which forwards to the hub relay
// with the app secret server-side — secrets never reach the browser.

type RelayChatResponse = { success: boolean, data?: { ok: boolean, content: string, provider: string, model: string, usage: unknown } }
type RelayCatalogResponse = { success: boolean, data?: { connections?: AiRelayConnection[] } }

/**
 * Turn a relay HTTP failure into a message worth reading. Our proxy answers
 * with the stable code in `message` and the provider's own reply in
 * `data.detail`; ofetch keeps that body under `err.data`, so the reason is two
 * levels below the code. A bare "ai.network" told the user nothing while the
 * hub already knew it was "HTTP 404 — Function not found for account".
 */
function relayFailure(err: unknown): Error {
  const body = (err as { data?: { message?: string, data?: { detail?: string } } })?.data
  const code = String(body?.message ?? '').trim()
  const detail = String(body?.data?.detail ?? '').trim()
  if (!code && !detail) {
    // Our own proxy never answered (server down, request aborted): the
    // transport error is the only signal, and it beats a made-up code.
    return new Error(String((err as Error)?.message ?? '').trim() || 'ai.relay-unreachable')
  }
  const parts = [
    code || 'ai.relay-failed',
    detail && detail !== code ? detail : ''
  ].filter(Boolean)
  return new Error(parts.join(' — ').slice(0, 300))
}

const relayCache: { connections: AiRelayConnection[] | null, at: number } = { connections: null, at: 0 }
const RELAY_CACHE_TTL_MS = 60_000
/** Why the last catalogue read failed — the UI's "no AI" message is useless without it. */
const relayCatalogFailure: { message: string } = { message: '' }

async function relayCatalog(): Promise<AiRelayConnection[]> {
  if (relayCache.connections && Date.now() - relayCache.at < RELAY_CACHE_TTL_MS) {
    return relayCache.connections
  }
  try {
    const res = await $fetch<RelayCatalogResponse>('/api/v1/ai/relay/catalog')
    const conns = res?.data?.connections ?? []
    // Cache only in the browser and only when usable; an empty catalogue
    // stays uncached so a hub-side adoption becomes visible on the next call.
    if (conns.length && typeof window !== 'undefined') relayCache.connections = conns
    relayCache.at = Date.now()
    relayCatalogFailure.message = ''
    return conns
  } catch (err: unknown) {
    relayCatalogFailure.message = relayFailure(err).message
    return []
  }
}

// ===== Web persisted per-surface routing choice ==============================
// Desktop saves per-surface model choices as AI_*_<TASK> config slots in the
// gateway (electron IPC). The web runtime has no gateway and must never hold
// provider keys — the relay resolves credentials server-side per
// connectionId — so the browser only remembers the ROUTING decision: which
// hub connection + model a surface runs on. `default` mirrors the desktop
// global config; task slots override it exactly like their desktop
// counterparts.
type WebAiSlot = { connectionId: string, provider: string, model: string }
type WebAiSlots = { default?: WebAiSlot, plan?: WebAiSlot, triage?: WebAiSlot }

const WEB_SLOTS_KEY = 'tmcut_ai_web_slots_v1'

function parseWebSlots(): WebAiSlots {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(localStorage.getItem(WEB_SLOTS_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** Saved routing choice for a surface; explicit task slots override the default. */
function webSlotFor(task?: string): WebAiSlot | null {
  const slots = parseWebSlots()
  const typed = slots as Record<string, WebAiSlot | undefined>
  return (task && typed[task]) || typed.default || null
}

/** Persist one surface's routing choice. Web-only: never called on desktop. */
function saveWebSlot(task: string | undefined, slot: WebAiSlot | null): void {
  if (typeof window === 'undefined') return
  const slots = parseWebSlots() as Record<string, WebAiSlot | undefined>
  const key = task || 'default'
  // Assign undefined (not `delete` — the lint rule forbids dynamic deletes);
  // JSON.stringify omits undefined-valued keys, so clearing behaves the same.
  slots[key] = slot ?? undefined
  try {
    localStorage.setItem(WEB_SLOTS_KEY, JSON.stringify(slots))
  } catch {
    // Quota/full storage: fail soft — the pick lives until reload.
  }
}

/** Pick the relay connection for a completion call. */
function pickRelayConnection(
  input: AiCompleteInput,
  conns: AiRelayConnection[],
  slot: WebAiSlot | null
): AiRelayConnection | null {
  if (input.provider) {
    const wanted = input.provider.toLowerCase()
    const byProvider = conns.find(c => c.provider.toLowerCase() === wanted)
    if (byProvider) return byProvider
  }
  // Saved per-surface pick (web slot store): the exact hub connection the
  // user chose for this surface, mirroring the desktop AI_*_<TASK> slots.
  if (slot) {
    const byId = conns.find(c => c.connectionId === slot.connectionId)
    if (byId) return byId
  }
  // Default: the first usable connection — hub ordering puts own rows first.
  return conns[0] ?? null
}

/** Resolve the model to relay with: explicit call input > saved default > primary > first. */
function relayModelFor(conn: AiRelayConnection, input: AiCompleteInput, slot: WebAiSlot | null): string {
  const fromInput = typeof input.model === 'string' ? input.model.trim() : ''
  return fromInput
    // The saved model only applies to ITS connection (the choice may be
    // adopted on the hub since then — fall through to the defaults there).
    || (slot && slot.connectionId === conn.connectionId ? slot.model : '')
    || (conn.model || '')
    || conn.models.find(m => m.isPrimary)?.modelId
    || conn.models[0]?.modelId
    || ''
}

/**
 * An empty catalogue has two very different causes — the hub said no, or the
 * hub never answered — and the read failure is the actionable one.
 */
function noConnectionUsable(): Error {
  return new Error(
    relayCatalogFailure.message
      ? `No AI connection is usable by this app on TM Hub — ${relayCatalogFailure.message}`
      : 'No AI connection is usable by this app on TM Hub — connect a model on the hub first'
  )
}

/** One chat call through the relay. */
async function relayChat(call: {
  connectionId: string
  model: string
  messages: AiChatMessage[]
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
}): Promise<AiCompleteResult> {
  const started = Date.now()
  let res: RelayChatResponse
  try {
    res = await $fetch<RelayChatResponse>('/api/v1/ai/relay/chat', {
      method: 'POST',
      body: {
        connectionId: call.connectionId,
        messages: call.messages,
        model: call.model,
        maxTokens: call.maxTokens,
        temperature: call.temperature
      },
      // The desktop gateway enforces `timeoutMs` itself; without this the web
      // branch waited out the hub's own 60s bound instead.
      timeout: call.timeoutMs
    })
  } catch (err: unknown) {
    throw relayFailure(err)
  }
  if (!res?.success || !res.data?.ok) {
    throw new Error(`AI relay call failed (${call.model})`)
  }
  return { content: res.data.content, usage: res.data.usage, model: res.data.model, latencyMs: Date.now() - started }
}

/**
 * Probe ONE exact hub connection with a real completion (Key Vault "Test").
 * `complete()` resolves a connection from a provider key or a saved slot and
 * can therefore land on a different connection than the one being tested; this
 * pins the id, because a green badge has to describe THAT connection.
 */
async function probeConnection(connectionId: string): Promise<AiCompleteResult & { connectionId: string, provider: string }> {
  const conns = await relayCatalog()
  const conn = conns.find(c => c.connectionId === connectionId)
  if (!conn) {
    if (!conns.length) throw noConnectionUsable()
    throw new Error(`Connection ${connectionId} is not usable by this app on TM Hub`)
  }
  const model = relayModelFor(conn, { messages: [] }, null)
  if (!model) {
    throw new Error(`AI connection "${conn.name}" has no enabled model`)
  }
  const res = await relayChat({
    connectionId: conn.connectionId,
    model,
    messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
    maxTokens: 8,
    timeoutMs: 20_000
  })
  return { ...res, connectionId: conn.connectionId, provider: conn.provider }
}

/**
 * Relay the completion through our server. The hub supports neither
 * response_format (jsonMode) nor per-call timeout overrides, so jsonMode is
 * honoured with a system-level instruction nudge (the prompt contract for
 * plan/triage tasks already demands raw JSON, this only enforces it).
 */
async function relayComplete(input: AiCompleteInput): Promise<AiCompleteResult> {
  const conns = await relayCatalog()
  const slot = webSlotFor(input.task)
  const conn = pickRelayConnection(input, conns, slot)
  if (!conn) throw noConnectionUsable()
  const model = relayModelFor(conn, input, slot)
  if (!model) {
    throw new Error(`AI connection "${conn.name}" has no enabled model`)
  }
  const messages = input.jsonMode
    ? [{ role: 'system' as const, content: 'Reply with valid raw JSON only. No markdown fences, no commentary.' }, ...input.messages]
    : input.messages
  return relayChat({
    connectionId: conn.connectionId,
    model,
    messages,
    maxTokens: input.maxTokens,
    temperature: input.temperature,
    timeoutMs: input.timeoutMs
  })
}

/** Web status derived from the relay catalogue (same shape as the gateway's). */
async function relayStatus(): Promise<AiGatewayStatus | null> {
  const conns = await relayCatalog()
  const conn = conns.find(c => c.hasKey || c.models.length > 0)
  if (!conn) return null
  const model = relayModelFor(conn, { messages: [] }, null)
  return {
    provider: conn.provider,
    providerLabel: conn.name || conn.provider,
    baseUrl: '',
    model,
    hasKey: conn.hasKey,
    keyless: !conn.hasKey,
    needsBaseUrl: false,
    needsModel: !model,
    // The catalogue only lists connections the hub deems usable (has key or
    // keyless provider), so presence + a resolvable model is "configured".
    configured: Boolean(model),
    rpm: 0,
    timeoutMs: 0
  }
}

/**
 * Renderer-side AI client (roadmap section 66). Desktop: thin IPC wrapper
 * only — keys, rate limits, retries and audit logs live in the main-process
 * gateway (electron/tools/ai-gateway.cjs), never in the renderer.
 * Web: identical call shapes served by the TM Hub AI relay through the
 * local Nitro proxy (/api/v1/ai/relay/*, R151) — the app secret stays on
 * the tm-tools server, provider credentials stay on the hub.
 */
export function useTmcutAi() {
  const isDesktop = computed(() => !!aiApi())

  // Resolved lazily on purpose: the gateway itself is Electron IPC and needs
  // no hub session, so building the hub client here would make every consumer
  // of this composable (Node unit harnesses included) require the Nuxt runtime.
  // Only the hub provider catalogue touches it.
  let hub: ReturnType<typeof useHub> | null = null
  function hubClient() {
    if (!hub) hub = useHub()
    return hub
  }

  async function complete(input: AiCompleteInput) {
    const api = aiApi()
    if (!api) return relayComplete(input)
    const res = await api.complete(input)
    if (!res?.ok || !res.data) {
      throw new Error(res?.error || `AI request failed (${res?.code || 'unknown'})`)
    }
    return res.data
  }

  // Latched AI availability for UI gates. Desktop: always true. Web: true
  // once the relay catalogue proves it has at least one usable connection
  // (probed on demand — components that used to gate on isDesktop probe on
  // mount instead so their buttons enable without a full status round-trip).
  const aiReady = ref(false)
  async function probeAiReady(): Promise<boolean> {
    if (aiApi()) {
      aiReady.value = true
      return true
    }
    aiReady.value = (await relayCatalog()).length > 0
    return aiReady.value
  }

  /**
   * Save one surface's model choice (web only). Desktop callers write
   * AI_*_<TASK> config slots via electron IPC instead; this only exists so
   * the per-surface pickers can persist their routing decision in the
   * browser without touching a key.
   */
  function saveTaskSlot(task: string | undefined, slot: { connectionId: string, provider: string, model: string }) {
    if (aiApi()) return
    saveWebSlot(task, slot)
  }

  async function transcribe(filePath: string, opts: { provider?: string, model?: string, language?: string, format?: 'text' | 'verbose_json' } = {}) {
    const api = aiApi()
    if (!api) throw new Error('AI gateway requires the desktop (Electron) app')
    const res = await api.transcribe({ filePath, ...opts })
    if (!res?.ok || !res.data) {
      throw new Error(res?.error || `Transcription failed (${res?.code || 'unknown'})`)
    }
    return res.data
  }

  async function status(): Promise<AiGatewayStatus | null> {
    const api = aiApi()
    if (!api) {
      try {
        return await relayStatus()
      } catch {
        return null
      }
    }
    try {
      return await api.getStatus()
    } catch {
      return null
    }
  }

  /**
   * Model discovery for multi-provider gateways (FreeLLMAPI et al.):
   * GET {base}/models through the main process, so the key never reaches
   * the renderer and the result can populate a model picker.
   * With `task` (R139) the call resolves the SAVED per-surface slots in
   * the main process — a "test this connection" action verifies the
   * surface's stored key without the renderer ever holding it.
   */
  async function listModels(args: { provider?: string, apiKey?: string, baseUrl?: string, task?: string } = {}): Promise<AiModelInfo[]> {
    const api = aiApi()
    if (!api) {
      // Web: flatten the relay catalogue — every enabled model row of every
      // usable connection is pickable (the relay resolves credentials).
      const conns = await relayCatalog()
      const connList = args.provider
        ? conns.filter(c => c.provider.toLowerCase() === args.provider!.toLowerCase())
        : conns
      const out: AiModelInfo[] = []
      for (const conn of connList) {
        for (const m of conn.models) {
          if (out.some(x => x.id === m.modelId)) continue
          out.push({ id: m.modelId, label: `${m.displayName} (${conn.name})` })
        }
      }
      return out
    }
    const res = await api.models(args)
    if (!res?.ok || !res.data) {
      throw new Error(res?.error || `Model list failed (${res?.code || 'unknown'})`)
    }
    return res.data.models
  }

  /**
   * Provider presets — gateway builtins (IPC) MERGED with the hub's global
   * provider catalog (`GET /api/v1/apps/:appId/ai/providers`, user JWT +
   * `ai.providers.read`; fail-soft 403/offline → gateway builtins only).
   * A hub preset with the same id OVERRIDES the gateway builtin (central
   * baseUrl correction); hub-only definitions are appended as new presets.
   */
  async function providerPresets(): Promise<AiProviderPreset[]> {
    const gateway = await (async () => {
      const api = aiApi()
      if (!api) return []
      try {
        const res = await api.presets()
        return res?.ok && res.data ? res.data.presets : []
      } catch {
        return []
      }
    })()

    try {
      const { hubFetch, appId } = hubClient()
      const res = await hubFetch<{ success: boolean, data: Array<{ definition: { key: string, name: string, category: string, base_url_default: string | null } }> }>(
        `/api/v1/apps/${appId}/ai/providers`
      )
      const defs = (res?.data ?? []).filter(d => d.definition?.category === 'ai_llm')
      const byId = new Map(gateway.map(p => [p.id, { ...p }]))
      for (const { definition } of defs) {
        const preset: AiProviderPreset = {
          id: definition.key,
          label: definition.name,
          baseUrl: definition.base_url_default || '',
          keyless: false,
          requiresModel: false,
          needsBaseUrl: !definition.base_url_default
        }
        byId.set(definition.key, preset) // hub wins on the same id
      }
      return [...byId.values()]
    } catch {
      return gateway
    }
  }

  /**
   * Per-surface routing (editor vs AutoCut): which provider/model each AI
   * task ACTUALLY runs on. A task can differ from the global config when
   * the AI_*_<TASK> slots are set, so surfaces badge their own model.
   */
  async function tasks(): Promise<Record<string, AiTaskStatus> | null> {
    const api = aiApi()
    if (!api) {
      // Web: chat relay covers every surface the same way (plan/triage) —
      // transcription has no relay endpoint and stays desktop-only.
      try {
        const st = await relayStatus()
        if (!st) return null
        const chatSurface: AiTaskStatus = {
          provider: st.provider,
          providerLabel: st.providerLabel,
          baseUrl: '',
          model: st.model,
          hasKey: st.hasKey,
          overridden: false,
          customized: false,
          configured: st.configured
        }
        // Saved per-surface picks (web slot store) override the catalogue
        // default — same as the desktop AI_*_<TASK> slots, so surfaces
        // badge their own model.
        const slotSurface = (task: 'plan' | 'triage'): AiTaskStatus => {
          const slot = webSlotFor(task)
          if (!slot) return chatSurface
          const conn = relayCache.connections?.find(c => c.connectionId === slot.connectionId)
          return {
            ...chatSurface,
            provider: slot.provider,
            providerLabel: conn?.name || slot.provider,
            model: slot.model,
            overridden: true,
            customized: true,
            configured: true
          }
        }
        const transcribeSurface: AiTaskStatus = { ...chatSurface, provider: '', providerLabel: '', model: '', configured: false }
        return { plan: slotSurface('plan'), triage: slotSurface('triage'), transcribe: transcribeSurface }
      } catch {
        return null
      }
    }
    try {
      const res = await api.tasks()
      return res?.ok && res.data ? res.data.tasks : null
    } catch {
      return null
    }
  }

  return {
    isDesktop,
    aiReady,
    probeAiReady,
    saveTaskSlot,
    complete,
    probeConnection,
    transcribe,
    status,
    listModels,
    providerPresets,
    tasks
  }
}
