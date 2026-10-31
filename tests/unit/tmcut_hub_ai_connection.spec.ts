/**
 * TM Hub → local gateway adoption (AI connect panel).
 *
 * The two AI providers connected in TM Hub (amd_radeon, nvidia) must power
 * tmcut WITHOUT hand-typing a key: the panel adopts a hub connection, which
 * fetches the stored key once and writes the local AI_* slots the Electron
 * gateway reads. These checks pin the rules that mapping depends on, plus the
 * component/i18n contract that keeps the button wired to that path.
 *
 * Why the rules matter:
 *  - a hub-only provider (nvidia) has no gateway preset → must fall back to
 *    the OpenAI-compatible `custom` family, never silently keep a stale
 *    provider id (that is how "gemini + gpt-4o-mini" drift happened);
 *  - aggregator connections carry no default model, so an empty model must be
 *    reported instead of sending a model-less request;
 *  - the endpoint must prefer the per-connection override (NVIDIA and AMD
 *    both use one) over any preset guess.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FALLBACK_PROVIDER_ID,
  connectionBaseUrl,
  connectionModel,
  firstAnsweringModel,
  hubConnectionLabel,
  isUsableHubConnection,
  resolveGatewayProvider,
  selectHubConnection
} from '../../app/utils/tmcut/hubAiConnection'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

let passed = 0
let failed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`[ok] ${name}`)
}

/** Async twin: settled before the summary prints, non-zero exit on failure. */
const pending: Array<Promise<void>> = []
function checkAsync(name: string, fn: () => Promise<void>) {
  pending.push(fn().then(() => {
    passed++
    console.log(`[ok] ${name}`)
  }).catch((err) => {
    failed++
    console.error(`[FAILED] ${name}: ${(err as Error)?.message || err}`)
  }))
}

// Gateway presets as the panel receives them from the gateway IPC.
const PRESETS = [
  { id: 'openai', baseUrl: 'https://api.openai.com/v1' },
  { id: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { id: 'amd_radeon', baseUrl: 'https://developer.amd.com.cn/radeon/api/v1' },
  { id: 'custom', baseUrl: '' }
]

// The two connections actually present in the hub for tm-tools.
const AMD = {
  id: '057084c5-4940-4871-ab91-61e7b141240a',
  provider: 'amd_radeon',
  label: 'https://developer.amd.com.cn/radeon/api/v1',
  baseUrlOverride: 'https://developer.amd.com.cn/radeon/api/v1',
  config: { AI_MODEL: 'GLM-5.3-Flash' },
  status: 'connected',
  hasSecrets: true,
  isEnabled: true
}
const NVIDIA = {
  id: '0b67bf6c-78e9-4dbe-8bf1-1c04c5cd6a64',
  provider: 'nvidia',
  label: 'https://integrate.api.nvidia.com/v1',
  baseUrlOverride: 'https://integrate.api.nvidia.com/v1',
  config: { AI_MODEL: '01-ai/yi-large' },
  status: 'connected',
  hasSecrets: true,
  isEnabled: true
}

check('a known hub provider keeps its gateway preset id (amd_radeon)', () => {
  const id = resolveGatewayProvider('amd_radeon', PRESETS)
  if (id !== 'amd_radeon') throw new Error(`expected amd_radeon, got ${id}`)
})

check('a hub-only provider falls back to the OpenAI-compatible family', () => {
  const id = resolveGatewayProvider('nvidia', PRESETS)
  if (id !== FALLBACK_PROVIDER_ID) throw new Error(`expected ${FALLBACK_PROVIDER_ID}, got ${id}`)
})

check('the connection endpoint wins over the preset guess', () => {
  const url = connectionBaseUrl(NVIDIA, PRESETS)
  if (url !== 'https://integrate.api.nvidia.com/v1') throw new Error(`got ${url}`)
})

check('a stored base URL is used when there is no override', () => {
  const url = connectionBaseUrl(
    { ...NVIDIA, baseUrlOverride: null, config: { AI_BASE_URL: 'https://proxy.example/v1' } },
    PRESETS
  )
  if (url !== 'https://proxy.example/v1') throw new Error(`got ${url}`)
})

check('model comes from the connection, discovery only fills a gap', () => {
  const own = connectionModel(AMD, ['ignored/model'])
  if (own !== 'GLM-5.3-Flash') throw new Error(`connection model must win, got ${own}`)
  const discovered = connectionModel({ ...AMD, config: {} }, ['01-ai/yi-large', 'adept/fuyu-8b'])
  if (discovered !== '01-ai/yi-large') throw new Error(`expected first discovered model, got ${discovered}`)
})

check('dead connections are filtered out of the picker', () => {
  if (!isUsableHubConnection(AMD)) throw new Error('a connected+enabled+hasSecrets row must be usable')
  for (const broken of [
    { ...AMD, status: 'error' },
    { ...AMD, isEnabled: false },
    { ...AMD, hasSecrets: false },
    { ...AMD, status: null }
  ]) {
    if (isUsableHubConnection(broken)) throw new Error(`must be rejected: ${JSON.stringify(broken.status ?? null)}`)
  }
})

check('adopting AMD/NVIDIA resolves every gateway slot', () => {
  for (const [connection, provider, model] of [[AMD, 'amd_radeon', 'GLM-5.3-Flash'], [NVIDIA, FALLBACK_PROVIDER_ID, '01-ai/yi-large']] as const) {
    const sel = selectHubConnection(connection!, PRESETS, { apiKey: 'k-123' })
    if (!sel.ok) throw new Error(`expected ok, got ${sel.error}`)
    if (sel.provider !== provider) throw new Error(`provider ${sel.provider} !== ${provider}`)
    if (sel.model !== model) throw new Error(`model ${sel.model} !== ${model}`)
    if (sel.apiKey !== 'k-123') throw new Error('the stored key must be carried into the save')
  }
})

check('a model-less connection is reported, never saved as empty', () => {
  const sel = selectHubConnection({ ...AMD, config: {} }, PRESETS, { apiKey: 'k' })
  if (sel.ok || sel.error !== 'missing-model') throw new Error(`expected missing-model, got ${JSON.stringify(sel)}`)
})

check('an explicit pick beats the connection default (model chooser)', () => {
  const sel = selectHubConnection(NVIDIA, PRESETS, { apiKey: 'k', model: 'meta/llama-3.1-405b-instruct' })
  if (!sel.ok) throw new Error(`expected ok, got ${sel.error}`)
  if (sel.model !== 'meta/llama-3.1-405b-instruct') throw new Error(`picked model ignored, got ${sel.model}`)
})

check('a connection with no endpoint at all is reported', () => {
  const sel = selectHubConnection(
    { provider: 'custom_openai', baseUrlOverride: null, config: { AI_MODEL: 'x' }, status: 'connected', hasSecrets: true, id: 'c' },
    PRESETS,
    { apiKey: 'k' }
  )
  if (sel.ok || sel.error !== 'missing-base-url') throw new Error(`expected missing-base-url, got ${JSON.stringify(sel)}`)
})

check('picker label never renders empty', () => {
  if (hubConnectionLabel(AMD) !== AMD.label) throw new Error('label must come from the connection label')
  if (hubConnectionLabel({ id: 'c', provider: 'nvidia' }) !== 'nvidia') throw new Error('provider is the last resort')
})

// ---------------------------------------------------------------------------
// Component + i18n contract
// ---------------------------------------------------------------------------
check('the panel adopts through the hub key endpoint and the normal save path', () => {
  const page = read('app/components/tmcut/TmcutAiConnect.vue')
  if (!page.includes('/ai/connections/')) throw new Error('panel must fetch the stored key from the hub')
  if (!/\/key`/.test(page)) throw new Error('the key endpoint must be the /key path')
  if (!page.includes('selectHubConnection(')) throw new Error('panel must resolve slots through the shared rules')
  if (!page.includes('await handleSave()')) throw new Error('adoption must save through the same path as the manual form')
  if (!/surfaces\.value\[task\] = \{ custom: false/.test(page)) {
    throw new Error('adoption must reset surface overrides so every AI feature inherits it')
  }
})

check('every new hub string exists in both locales', () => {
  const en = JSON.parse(read('i18n/locales/en.json')).tmcut
  const vi = JSON.parse(read('i18n/locales/vi.json')).tmcut
  const needed: Array<[string, string[]]> = [
    ['aiConnect', ['hubLabel', 'hubHint', 'hubUse', 'hubEmpty', 'hubNoKey', 'hubNoModelTitle', 'hubNoModelDesc', 'hubAdoptedTitle', 'hubAdoptedDesc', 'hubAdoptedSwappedDesc', 'hubProbeFailTitle', 'hubProbeFailDesc', 'hubProbeSilentDesc', 'hubKeyFailedTitle']],
    ['aiModelPicker', ['label', 'choose', 'loading', 'empty', 'hint', 'test', 'testOk', 'appliedTitle', 'appliedDesc', 'applyFailedTitle', 'surfaceScript', 'hubSignIn', 'hubUnavailable']]
  ]
  for (const [group, keys] of needed) {
    for (const key of keys) {
      if (!en[group]?.[key]) throw new Error(`en missing ${group}.${key}`)
      if (!vi[group]?.[key]) throw new Error(`vi missing ${group}.${key}`)
    }
  }
})

// ---------------------------------------------------------------------------
// AI Scriptwriter & Storyboard surface: model chooser only, no connection form
// ---------------------------------------------------------------------------
check('the scriptwriter modal offers a model chooser instead of the connection form', () => {
  const modal = read('app/components/tmcut/TmcutAiScriptModal.vue')
  if (modal.includes('<TmcutAiConnect')) {
    throw new Error('the scriptwriter must not carry the connection form (keys belong to TM Hub / the AutoCut panel)')
  }
  if (!modal.includes('<TmcutAiModelPicker')) throw new Error('the scriptwriter must mount the model chooser')
})

check('the chooser lists connected models only and can test one', () => {
  const picker = read('app/components/tmcut/TmcutAiModelPicker.vue')
  if (!picker.includes('isUsableHubConnection(')) throw new Error('only connected+enabled+keyed connections may be offered')
  if (!picker.includes('listModels(appId')) throw new Error('models must come from the hub catalogue')
  if (!picker.includes('isEnabled === false')) throw new Error('disabled models must be filtered out')
  // Test must be a REAL chat round-trip through the stored-key gateway path:
  // AMD answers /models while its /chat/completions hangs, so a catalogue
  // check alone would vouch for a model that cannot be used.
  if (!/complete\(\{\s*\n\s*task: props\.task/.test(picker)) throw new Error('the test must run a real completion via the stored-key path in main')
  if (!picker.includes('AI_PROVIDER_${up}') || !picker.includes('AI_MODEL_${up}')) {
    throw new Error('a pick must write THIS surface slots only')
  }
  if (!picker.includes('AI_API_KEY_${up}')) throw new Error('the picked connection supplies the key')
})

check('each row reads "Provider name — model id", never the connection URL', () => {
  const picker = read('app/components/tmcut/TmcutAiModelPicker.vue')
  if (!/providerName\} — \$\{model\.modelId\}/.test(picker)) {
    throw new Error('option label must be provider NAME + model id')
  }
  if (!picker.includes('item.definition?.name || connection.provider')) {
    throw new Error('provider name must come from the hub definition, not the URL label')
  }
})

check('an expired hub session reads as "sign in", not as "no providers"', () => {
  const picker = read('app/components/tmcut/TmcutAiModelPicker.vue')
  if (!picker.includes('hubError.value = /401|Unauthorized/.test(raw) ? \'signin\' : \'unavailable\'')) {
    throw new Error('the chooser must tell a 401 apart from an empty catalogue')
  }
  if (!picker.includes('hubError === \'signin\'')) throw new Error('the sign-in note must be rendered')
})

// ---------------------------------------------------------------------------
// Adopting must not save a model that cannot answer (live hub data: NVIDIA's
// stored `01-ai/yi-large` answers 404 today, AMD's chat endpoint hangs)
// ---------------------------------------------------------------------------
checkAsync('a retired stored model is walked past to one that answers', async () => {
  const tried: string[] = []
  const res = await firstAnsweringModel(
    ['01-ai/yi-large', 'adept/fuyu-8b', 'minimaxai/minimax-m3.1-flash', 'z-ai/glm-5.3-flash'],
    async (model) => {
      tried.push(model)
      return { state: model.startsWith('minimax') ? 'ok' as const : 'missing' as const }
    },
    { concurrency: 1 }
  )
  if (res.model !== 'minimaxai/minimax-m3.1-flash') throw new Error(`expected the answering model, got ${res.model}`)
  if (tried.length !== 3) throw new Error(`the walk must stop at the first answer, tried ${tried.join(', ')}`)
})

checkAsync('an unreachable ENDPOINT stops the walk (more models cannot help)', async () => {
  let calls = 0
  const res = await firstAnsweringModel(
    ['m1', 'm2', 'm3'],
    async () => {
      calls++
      return { state: 'unreachable' as const, detail: 'HTTP 401 Unauthorized' }
    },
    { concurrency: 1 }
  )
  if (res.model !== null) throw new Error('nothing may be adopted from a rejected endpoint')
  if (res.reason !== 'unreachable') throw new Error(`expected unreachable, got ${res.reason}`)
  if (calls !== 1) throw new Error(`must stop at the first transport/auth failure, made ${calls} calls`)
})

checkAsync('an endpoint that never answers is refused without walking the catalogue', async () => {
  // AMD hangs on its stored model but five of its models answer in <3s, so a
  // hang alone may not condemn the endpoint — only a run of timeouts with no
  // fast answer at all. The walk must then stop early instead of blocking the
  // panel for the whole catalogue.
  let calls = 0
  const res = await firstAnsweringModel(
    Array.from({ length: 20 }, (_, i) => `dead-${i}`),
    async () => {
      calls++
      await new Promise(resolve => setTimeout(resolve, 5))
      return { state: 'timeout' as const, detail: 'Request timed out after 10000ms' }
    },
    { concurrency: 3 }
  )
  if (res.model !== null) throw new Error('a silent endpoint must never be adopted')
  if (res.reason !== 'silent') throw new Error(`expected silent, got ${res.reason}`)
  if (calls > 6) throw new Error(`the walk must stop early, made ${calls} probes`)
})

checkAsync('one hung model does not condemn a working endpoint', async () => {
  const res = await firstAnsweringModel(
    ['hangs', 'answers'],
    async (model) => {
      if (model === 'hangs') return { state: 'timeout' as const, detail: 'Request timed out after 10000ms' }
      return { state: 'ok' as const }
    },
    { concurrency: 1 }
  )
  if (res.model !== 'answers') throw new Error(`expected to walk past the hang, got ${res.model}`)
})

checkAsync('duplicate and blank candidates are skipped, and the walk is capped', async () => {
  const seen: string[] = []
  const res = await firstAnsweringModel(
    ['a', 'a', '', ' ', 'b', 'c', 'd'],
    async (model) => {
      seen.push(model)
      return { state: 'missing' as const }
    },
    { concurrency: 1, limit: 3 }
  )
  if (res.model !== null || res.reason !== 'exhausted') throw new Error(`expected exhausted, got ${JSON.stringify(res)}`)
  if (seen.join(',') !== 'a,b,c') throw new Error(`dedup+limit failed: ${seen.join(',')}`)
  const empty = await firstAnsweringModel([], async () => ({ state: 'ok' as const }))
  if (empty.model !== null || empty.tried !== 0) throw new Error('no candidates must be a clean miss')
})

checkAsync('a probe that THROWS counts as "no", never crashes the adopt', async () => {
  const res = await firstAnsweringModel(
    ['boom', 'ok-model'],
    async (model) => {
      if (model === 'boom') throw new Error('IPC blew up')
      return { state: 'ok' as const }
    },
    { concurrency: 1 }
  )
  if (res.model !== 'ok-model') throw new Error(`expected the walk to continue, got ${res.model}`)
})

check('the panel proves a model answers BEFORE saving anything', () => {
  const page = read('app/components/tmcut/TmcutAiConnect.vue')
  if (!page.includes('firstAnsweringModel(')) throw new Error('adoption must probe candidate models')
  if (!page.includes('timeoutMs: ADOPT_PROBE_TIMEOUT_MS')) throw new Error('a probe must fail fast, not hold the UI for 60s')
  const probeAt = page.indexOf('firstAnsweringModel(')
  const saveAt = page.indexOf('await handleSave()')
  if (probeAt < 0 || saveAt < 0 || probeAt > saveAt) throw new Error('the probe must run before the save')
  if (!/if \(!answer\.model\) \{[\s\S]{0,900}return/.test(page.slice(probeAt, saveAt))) {
    throw new Error('a failed probe must bail out without writing config')
  }
  if (!page.includes('hubProbeFailTitle')) throw new Error('the refusal must explain itself to the user')
})

check('the test call and both generation calls give reasoning models room', () => {
  // GLM/Nemotron spend their first tokens thinking: at maxTokens 8 the answer
  // never arrives and a healthy model reports "no message content".
  const picker = read('app/components/tmcut/TmcutAiModelPicker.vue')
  if (!/maxTokens: 512/.test(picker)) throw new Error('the model test needs reasoning headroom')
  if (!/timeoutMs: 20000/.test(picker)) throw new Error('the model test must fail a hung endpoint quickly')
  for (const file of ['app/composables/useTmcutAiScript.ts', 'app/composables/useTmcutAutocut.ts']) {
    const src = read(file)
    if (!/maxTokens: 2048/.test(src)) throw new Error(`${file}: generation needs reasoning headroom or it falls back silently`)
  }
})

async function report() {
  await Promise.all(pending)
  if (failed) {
    console.log(`\n=== ${failed} hub-AI adoption check(s) FAILED, ${passed} passed ===`)
    process.exitCode = 1
    return
  }
  console.log(`\n=== All ${passed} hub-AI adoption checks passed ===`)
}

report().catch((err) => {
  console.error(`FAILED ${String((err as Error)?.message || err)}`)
  process.exitCode = 1
})
