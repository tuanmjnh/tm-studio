/**
 * TM Hub AI connection → local gateway slots (pure).
 *
 * The hub keeps ONE credential per provider connection and normally never
 * hands it to a satellite (the relay path uses an app secret instead). The
 * desktop app is the exception the user explicitly asked for: the AI connect
 * panel can ADOPT a hub connection, which fetches the stored key once and
 * writes it into the local AI_* slots that `electron/tools/ai-gateway.cjs`
 * already reads — so AI script / AutoCut work without hand-typing a key.
 *
 * Everything here is pure so the rules (provider id, base URL, model) can be
 * pinned in tests without Electron, a hub session, or a Vue runtime.
 */

/** Gateway provider used when the hub definition has no matching preset. */
export const FALLBACK_PROVIDER_ID = 'custom'

export interface GatewayPresetLike {
  id: string
  baseUrl?: string | null
}

export interface HubConnectionLike {
  id: string
  provider: string
  name?: string | null
  label?: string | null
  baseUrlOverride?: string | null
  config?: Record<string, unknown> | null
  status?: string | null
  hasSecrets?: boolean | null
  isEnabled?: boolean | null
}

/** Every gateway slot for one adopted connection. */
export interface HubSelectionOk {
  ok: true
  provider: string
  baseUrl: string
  model: string
  apiKey: string
}

/** What the panel must tell the user instead of saving a broken config. */
export interface HubSelectionProblem {
  ok: false
  error: 'missing-model' | 'missing-base-url'
}

export type HubConnectionSelection = HubSelectionOk | HubSelectionProblem

/**
 * A connection this app may actually chat through: connected, enabled, and
 * holding a secret. The hub already scopes the list to usable rows, but the
 * panel filters again so a stale payload cannot offer a dead connection.
 */
export function isUsableHubConnection(connection: HubConnectionLike): boolean {
  if (connection.isEnabled === false) return false
  if (connection.hasSecrets === false) return false
  return String(connection.status || '').toLowerCase() === 'connected'
}

/**
 * Gateway provider id for a hub provider key. Presets are the gateway's own
 * ids (`electron/tools/ai-gateway.cjs` PROVIDER_PRESETS); a hub-only provider
 * (nvidia, freellmapi…) has no family of its own and runs through the
 * OpenAI-compatible fallback, which is why base URL + model must be explicit.
 */
export function resolveGatewayProvider(hubProvider: string, presets: GatewayPresetLike[]): string {
  const key = String(hubProvider || '').trim().toLowerCase()
  if (!key) return FALLBACK_PROVIDER_ID
  return presets.some(preset => String(preset.id).toLowerCase() === key) ? key : FALLBACK_PROVIDER_ID
}

/** Endpoint precedence: per-connection override → stored config → preset. */
export function connectionBaseUrl(connection: HubConnectionLike, presets: GatewayPresetLike[]): string {
  const override = String(connection.baseUrlOverride || '').trim()
  if (override) return override
  const stored = String((connection.config || {})['AI_BASE_URL'] ?? '').trim()
  if (stored) return stored
  const provider = resolveGatewayProvider(connection.provider, presets)
  return String(presets.find(preset => preset.id === provider)?.baseUrl || '').trim()
}

/**
 * Model precedence: an explicit pick (the model chooser) → the connection's own
 * AI_MODEL → the first discovered hub model for that provider. Aggregator
 * connections have no default model, so an empty result is a real error the
 * caller must surface (the gateway would otherwise send a model-less request).
 */
export function connectionModel(
  connection: HubConnectionLike,
  hubModelIds: string[] = [],
  picked?: string | null
): string {
  const explicit = String(picked || '').trim()
  if (explicit) return explicit
  const stored = String((connection.config || {})['AI_MODEL'] ?? '').trim()
  if (stored) return stored
  const discovered = hubModelIds.map(id => String(id || '').trim()).filter(Boolean)
  return discovered[0] || ''
}

/** Label for the picker: connection label → provider name → provider key. */
export function hubConnectionLabel(connection: HubConnectionLike): string {
  return String(connection.label || connection.name || connection.provider || '').trim()
}

/**
 * Verdict of ONE real completion against a candidate model.
 *  - `ok`         — the model answered
 *  - `missing`    — the endpoint answered, but retired/unknown model (404/410…)
 *  - `timeout`    — the model's backend never answered within the budget
 *  - `unreachable` — the endpoint itself failed at the transport/auth level
 *    (network, 401/403), so no model on it can answer
 */
export interface ModelProbeVerdict {
  state: 'ok' | 'missing' | 'timeout' | 'unreachable'
  detail?: string
}

/** Why nothing was adopted (only when `model` is null). */
export type ModelWalkStop = 'unreachable' | 'silent' | 'exhausted'

export interface ModelWalkResult {
  /** The model to adopt, or null when none of the candidates answered. */
  model: string | null
  /** How many probes were actually made (bounds the cost of adopting). */
  tried: number
  reason?: ModelWalkStop
  last?: ModelProbeVerdict
}

export interface ModelWalkOptions {
  /** Probes in flight at once (the walk is a worker pool, not a queue). */
  concurrency?: number
  /** Hard cap on probes for ONE adopt. */
  limit?: number
  /** Consecutive timeouts with NO fast answer before the endpoint is called dead. */
  silentLimit?: number
}

const uniqueCandidates = (candidates: string[]): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of candidates) {
    const model = String(raw || '').trim()
    if (!model || seen.has(model)) continue
    seen.add(model)
    out.push(model)
  }
  return out
}

const runProbe = async (
  probe: (model: string) => Promise<ModelProbeVerdict>,
  model: string
): Promise<ModelProbeVerdict> => {
  try {
    return await probe(model)
  } catch (err) {
    // A probe that throws is an answer of "no", never a crash of the adopt.
    return { state: 'missing', detail: String((err as Error)?.message || err) }
  }
}

/**
 * The first candidate model that actually answers, or null.
 *
 * Adopting a hub connection writes the GLOBAL slots every AI surface falls
 * back to, so a retired stored id (NVIDIA's `01-ai/yi-large` answers 404)
 * would break AI script AND AutoCut at once — silently, because both callers
 * swallow AI errors and fall back to presets. The panel therefore proves a
 * model answers before saving anything.
 *
 * Live hub data says the walk has to be a POOL, not a queue:
 *  - NVIDIA answers a retired model in ~200ms while a handful of models hang
 *    for the full budget → walk on, cheaply, and stop at the first answer;
 *  - AMD hangs on its stored model yet five of its models answer in under 3s
 *    → a hang is NOT proof the endpoint is dead, so only `silentLimit`
 *    consecutive timeouts with not one fast response condemn the endpoint;
 *  - a 401/403 is endpoint-level by definition → stop at once.
 *
 * As soon as one worker has an answer the walk returns — in-flight probes are
 * not awaited, so a healthy adopt never waits out someone else's timeout.
 */
export async function firstAnsweringModel(
  candidates: string[],
  probe: (model: string) => Promise<ModelProbeVerdict>,
  options: ModelWalkOptions = {}
): Promise<ModelWalkResult> {
  const queue = uniqueCandidates(candidates)
  const concurrency = Math.max(1, Number(options.concurrency) || 6)
  const limit = Math.max(1, Number(options.limit) || 40)
  const silentLimit = Math.max(1, Number(options.silentLimit) || 3)
  if (queue.length === 0) return { model: null, tried: 0, reason: 'exhausted', last: { state: 'missing' } }

  let index = 0
  let tried = 0
  let timeouts = 0
  let fast = 0
  let last: ModelProbeVerdict = { state: 'missing' }
  let stopped: ModelWalkResult | null = null
  let announceStop: (() => void) | null = null
  const stoppedAt = new Promise<void>((resolve) => {
    announceStop = resolve
  })
  const stopWith = (result: ModelWalkResult) => {
    if (stopped) return
    stopped = result
    if (announceStop) announceStop()
  }

  const worker = async () => {
    while (!stopped) {
      if (index >= queue.length || tried >= limit) return
      const model = queue[index++]!
      tried++
      const verdict = await runProbe(probe, model)
      last = verdict
      if (verdict.state === 'ok') {
        stopWith({ model, tried })
        return
      }
      if (verdict.state === 'unreachable') {
        stopWith({ model: null, tried, reason: 'unreachable', last: verdict })
        return
      }
      if (verdict.state === 'timeout') {
        timeouts++
        if (fast === 0 && timeouts >= silentLimit) {
          stopWith({ model: null, tried, reason: 'silent', last: verdict })
          return
        }
      } else {
        fast++
      }
    }
  }

  const workers = Promise.all(Array.from({ length: concurrency }, () => worker()))
  await Promise.race([stoppedAt, workers])
  return stopped || { model: null, tried, reason: 'exhausted', last }
}

/** Resolve every slot the panel needs, or report exactly what is missing. */
export function selectHubConnection(
  connection: HubConnectionLike,
  presets: GatewayPresetLike[],
  options: { models?: string[], apiKey?: string, model?: string } = {}
): HubConnectionSelection {
  const baseUrl = connectionBaseUrl(connection, presets)
  const model = connectionModel(connection, options.models, options.model)
  const apiKey = String(options.apiKey || '').trim()
  if (!baseUrl) return { ok: false, error: 'missing-base-url' }
  if (!model) return { ok: false, error: 'missing-model' }
  return {
    ok: true,
    provider: resolveGatewayProvider(connection.provider, presets),
    baseUrl,
    model,
    apiKey
  }
}
