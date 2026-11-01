/**
 * AI provider transfer (JSON / ENV / CSV) — `app/utils/aiProviderTransfer.ts`.
 *
 * This module is the only path credentials take between an exported file and
 * the hub (`components/aiProviders/IoModal.vue`), and it had no coverage. The
 * checks below pin the three contracts the modal depends on:
 *  - decoding is tolerant of the real-world shapes (hub envelope, FreeLLMAPI
 *    `keys`, bare arrays, keyed dictionaries, BOM CSV, dotenv `export` lines);
 *  - validation never guesses: an unknown provider without an endpoint is an
 *    error, never a silent import under the wrong key;
 *  - export → import is LOSSLESS for every format, including a disabled row
 *    and a credential name that contains a hyphen (`team-2` used to come back
 *    as `team_2`, i.e. a different credential).
 */
import assert from 'node:assert/strict'
import {
  AI_TRANSFER_FORMATS,
  cleanTransferValue,
  decodeAiTransfer,
  detectAiTransferFormat,
  parseAiTransfer,
  serializeAiTransfer,
  type AiTransferRow
} from '../../app/utils/aiProviderTransfer'

let passed = 0

function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ${name} PASSED`)
}

const KNOWN = ['openai', 'google_ai', 'nvidia', 'custom_openai', 'zhipu']
const ROWS: AiTransferRow[] = [
  { provider: 'openai', name: 'default', model: 'gpt-4o-mini', baseUrl: '', apiKey: 'sk-main', enabled: true },
  { provider: 'nvidia', name: 'team-2', model: 'meta/llama-3.1-405b-instruct', baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: 'nv-key', enabled: false }
]

console.log('=== [AI provider transfer] Starting tests ===\n')

check('detectAiTransferFormat reads the extension first, then the payload shape', () => {
  assert.equal(detectAiTransferFormat('whatever', 'export.JSON'), 'json')
  assert.equal(detectAiTransferFormat('whatever', 'export.csv'), 'csv')
  assert.equal(detectAiTransferFormat('whatever', 'export.env'), 'env')
  assert.equal(detectAiTransferFormat('whatever', 'export.txt'), 'env')
  assert.equal(detectAiTransferFormat('{"connections":[]}'), 'json')
  assert.equal(detectAiTransferFormat('[1,2]'), 'json')
  assert.equal(detectAiTransferFormat('provider,name,model\nopenai,default,gpt-4o'), 'csv')
  assert.equal(detectAiTransferFormat('OPENAI_API_KEY=x'), 'env')
  assert.equal(detectAiTransferFormat('   '), null)
})

check('cleanTransferValue trims and strips exactly one layer of quotes', () => {
  assert.equal(cleanTransferValue('  "sk-1" '), 'sk-1')
  assert.equal(cleanTransferValue('\'sk-1\''), 'sk-1')
  assert.equal(cleanTransferValue('"sk-1\''), '"sk-1\'')
  assert.equal(cleanTransferValue(null), '')
  assert.equal(cleanTransferValue(undefined), '')
})

check('JSON accepts the hub envelope, FreeLLMAPI keys and a bare array', () => {
  const hub = parseAiTransfer(JSON.stringify({
    connections: [{ provider: 'openai', name: 'main', model: 'gpt-4o', apiKey: 'sk', enabled: true, baseUrl: null }]
  }), { knownProviders: KNOWN })
  assert.equal(hub.format, 'json')
  assert.equal(hub.errors.length, 0)
  assert.deepEqual(hub.rows, [
    { provider: 'openai', name: 'main', model: 'gpt-4o', baseUrl: '', apiKey: 'sk', enabled: true }
  ])

  const free = parseAiTransfer(JSON.stringify({
    keys: [{ provider: 'nvidia', label: 'Team', modelId: 'meta/llama', token: 'nv' }]
  }), { knownProviders: KNOWN })
  assert.deepEqual(free.rows[0], {
    provider: 'nvidia', name: 'team', model: 'meta/llama', baseUrl: '', apiKey: 'nv', enabled: true
  })

  const bare = parseAiTransfer('[{"platform":"openai","defaultModel":"gpt-4o-mini"}]', { knownProviders: KNOWN })
  assert.equal(bare.rows[0]!.provider, 'openai')
  assert.equal(bare.rows[0]!.model, 'gpt-4o-mini')
  assert.equal(bare.rows[0]!.apiKey, '')
})

check('JSON keyed dictionary picks the first model and nested options', () => {
  const parsed = parseAiTransfer(JSON.stringify({
    openai: {
      models: { 'gpt-4o': { name: 'GPT-4o' }, 'gpt-4o-mini': {} },
      options: { model: 'gpt-4o' },
      apiKey: 'sk-1'
    },
    nvidia: { platform: 'nvidia', label: 'nv-main', url: 'https://integrate.api.nvidia.com/v1', models: { 'meta/llama': {} } }
  }), { knownProviders: KNOWN })
  assert.equal(parsed.errors.length, 0)
  const byProvider = Object.fromEntries(parsed.rows.map(row => [row.provider, row]))
  assert.equal(byProvider.openai!.model, 'gpt-4o')
  assert.equal(byProvider.openai!.apiKey, 'sk-1')
  assert.equal(byProvider.nvidia!.name, 'nv-main')
  assert.equal(byProvider.nvidia!.model, 'meta/llama')
})

check('malformed JSON and empty files are reported, never guessed', () => {
  assert.equal(parseAiTransfer('{oops', { knownProviders: KNOWN }).errors[0]!.source, 'file')
  assert.equal(parseAiTransfer('   ', { knownProviders: KNOWN }).errors[0]!.message, 'the file is empty')
  assert.equal(parseAiTransfer('{"connections":[]}', { knownProviders: KNOWN }).errors[0]!.message,
    'no rows found in this JSON file')
})

check('ENV reads the single AI_* block including AI_ENABLED=0', () => {
  const parsed = parseAiTransfer([
    '# my key',
    'export AI_PROVIDER=openai',
    'AI_API_KEY="sk-single"',
    'AI_BASE_URL=https://proxy.example/v1',
    'AI_MODEL=gpt-4o-mini',
    'AI_NAME=work',
    'AI_ENABLED=0'
  ].join('\n'), { knownProviders: KNOWN })
  assert.equal(parsed.format, 'env')
  assert.deepEqual(parsed.rows, [{
    provider: 'openai',
    name: 'work',
    model: 'gpt-4o-mini',
    baseUrl: 'https://proxy.example/v1',
    apiKey: 'sk-single',
    enabled: false
  }])
})

check('ENV splits per-provider blocks and keeps several accounts apart with PREFIX__name', () => {
  const parsed = parseAiTransfer([
    'OPENAI_API_KEY=sk-a',
    'OPENAI_MODEL=gpt-4o',
    'OPENAI__work_API_KEY=sk-b',
    'OPENAI__work_MODEL=gpt-4o-mini',
    'NVIDIA_KEY=nv',
    'NVIDIA_MODEL=meta/llama',
    'NVIDIA_URL=https://integrate.api.nvidia.com/v1'
  ].join('\n'), { knownProviders: KNOWN })
  assert.equal(parsed.errors.length, 0)
  const names = parsed.rows.map(row => `${row.provider}:${row.name}`).sort()
  assert.deepEqual(names, ['nvidia:default', 'openai:default', 'openai:work'])
  const work = parsed.rows.find(row => row.name === 'work')!
  assert.equal(work.apiKey, 'sk-b')
  assert.equal(work.model, 'gpt-4o-mini')
  const nvidia = parsed.rows.find(row => row.provider === 'nvidia')!
  assert.equal(nvidia.baseUrl, 'https://integrate.api.nvidia.com/v1')
})

check('CSV accepts a BOM header, column aliases, quoted commas and semicolons', () => {
  const csv = [
    '\uFEFFPlatform,Label,Model,Endpoint,API Key,Enabled',
    '"openai","main, eu","gpt-4o","","sk,1",true',
    'nvidia;team;meta/llama;https://integrate.api.nvidia.com/v1;nv;false'
  ].join('\n')
  const parsed = parseAiTransfer(csv, { knownProviders: KNOWN, format: 'csv' })
  assert.equal(parsed.format, 'csv')
  assert.equal(parsed.errors.length, 0)
  // Quoted commas stay inside the field, and 'main, eu' slugs to 'main-eu'.
  assert.equal(parsed.rows[0]!.provider, 'openai')
  assert.equal(parsed.rows[0]!.name, 'main-eu')
  assert.equal(parsed.rows[0]!.apiKey, 'sk,1')
  // The splitter also accepts ';' as a delimiter, so the second row parses too.
  assert.equal(parsed.rows.length, 2)
  assert.equal(parsed.rows[1]!.provider, 'nvidia')
  assert.equal(parsed.rows[1]!.enabled, false)
})

check('CSV rejects a header with no data rows and keeps disabled=false', () => {
  assert.equal(parseAiTransfer('provider,name,model\n', { knownProviders: KNOWN, format: 'csv' }).errors[0]!.message,
    'no rows found in this CSV file')
  const parsed = parseAiTransfer('provider,name,model,enabled\nopenai,default,gpt-4o,off\n', {
    knownProviders: KNOWN,
    format: 'csv'
  })
  assert.equal(parsed.rows[0]!.enabled, false)
})

check('provider aliases map to the canonical key', () => {
  const parsed = parseAiTransfer(JSON.stringify([
    { provider: 'gemini', name: 'g', model: 'gemini-2.0-flash' },
    { provider: 'z.ai', name: 'z', model: 'glm-4' }
  ]), { knownProviders: KNOWN })
  assert.deepEqual(parsed.rows.map(row => row.provider), ['google_ai', 'zhipu'])
})

check('an unknown provider is an error unless it carries its own endpoint', () => {
  const unknown = parseAiTransfer(JSON.stringify([{ provider: 'acme', name: 'a', model: 'm1' }]), {
    knownProviders: KNOWN
  })
  assert.equal(unknown.rows.length, 0)
  assert.match(unknown.errors[0]!.message, /unknown provider "acme"/)

  const custom = parseAiTransfer(JSON.stringify([
    { provider: 'acme', name: 'a', model: 'm1', baseUrl: 'https://acme.example/v1' }
  ]), { knownProviders: KNOWN })
  assert.equal(custom.errors.length, 0)
  assert.equal(custom.rows[0]!.provider, 'custom_openai')
  assert.equal(custom.rows[0]!.baseUrl, 'https://acme.example/v1')

  const noProvider = parseAiTransfer(JSON.stringify([{ model: 'm1' }]), { knownProviders: KNOWN })
  assert.equal(noProvider.errors[0]!.message, 'provider is required')
})

check('a model is required, and defaultModel fills the gap', () => {
  const missing = parseAiTransfer(JSON.stringify([{ provider: 'openai', name: 'a' }]), { knownProviders: KNOWN })
  assert.equal(missing.rows.length, 0)
  assert.match(missing.errors[0]!.message, /model is required/)

  const filled = parseAiTransfer(JSON.stringify([{ provider: 'openai', name: 'a' }]), {
    knownProviders: KNOWN,
    defaultModel: 'gpt-4o-mini'
  })
  assert.equal(filled.rows[0]!.model, 'gpt-4o-mini')
})

check('duplicate names of one provider get a suffix instead of overwriting', () => {
  const parsed = parseAiTransfer(JSON.stringify([
    { provider: 'openai', name: 'work', model: 'gpt-4o' },
    { provider: 'openai', name: 'work', model: 'gpt-4o-mini' },
    { provider: 'openai', name: 'work', model: 'gpt-4.1' }
  ]), { knownProviders: KNOWN })
  assert.deepEqual(parsed.rows.map(row => row.name), ['work', 'work-2', 'work-3'])
})

check('decodeAiTransfer is format-only: it never validates providers', () => {
  const decoded = decodeAiTransfer('[{"provider":"acme","model":"m"}]', { format: 'json' })
  assert.equal(decoded.errors.length, 0)
  assert.equal(decoded.rows[0]!.provider, 'acme')
})

check('serialize hides secrets unless asked, in every format', () => {
  for (const format of AI_TRANSFER_FORMATS) {
    const hidden = serializeAiTransfer(ROWS, format, { appName: 'tm-studio', appId: 'app-1', includeSecrets: false })
    assert.ok(!hidden.content.includes('sk-main'), `${format}: secret leaked`)
    assert.ok(!hidden.content.includes('nv-key'), `${format}: secret leaked`)
    assert.equal(hidden.fileName.endsWith(`.${format}`), true)

    const shown = serializeAiTransfer(ROWS, format, { appName: 'tm-studio', appId: 'app-1', includeSecrets: true })
    assert.ok(shown.content.includes('sk-main'), `${format}: secret missing`)
  }
})

check('serialize keeps the header/comment contract of each format', () => {
  const meta = { appName: 'tm-studio', appId: 'app-1', includeSecrets: true }
  const json = JSON.parse(serializeAiTransfer(ROWS, 'json', meta).content)
  assert.equal(json.source, 'tm-studio')
  assert.equal(json.appId, 'app-1')
  assert.equal(json.includeSecrets, true)
  assert.equal(json.connections[1].enabled, false)

  const csv = serializeAiTransfer(ROWS, 'csv', meta)
  assert.equal(csv.mime, 'text/csv')
  assert.equal(csv.content.split('\n')[0], 'provider,name,model,baseUrl,enabled,apiKey')

  const env = serializeAiTransfer(ROWS, 'env', meta)
  assert.ok(env.content.includes('NVIDIA__TEAM-2_API_KEY=nv-key'), 'hyphenated name must survive as an env key segment')
  assert.ok(env.content.includes('NVIDIA__TEAM-2_ENABLED=0'), 'a disabled row must export its flag')
})

check('export → import round-trips every format without loss', () => {
  for (const format of AI_TRANSFER_FORMATS) {
    const file = serializeAiTransfer(ROWS, format, { appName: 'tm-studio', appId: 'app-1', includeSecrets: true })
    const back = parseAiTransfer(file.content, { knownProviders: KNOWN, format, fileName: file.fileName })
    assert.equal(back.errors.length, 0, `${format}: ${JSON.stringify(back.errors)}`)
    assert.equal(back.rows.length, ROWS.length, `${format}: row count`)

    const byProvider = (a: AiTransferRow, b: AiTransferRow) => a.provider.localeCompare(b.provider)
    assert.deepEqual([...back.rows].sort(byProvider), [...ROWS].sort(byProvider), `${format}: round-trip drifted`)
  }
})

check('export → import round-trips the secret-free variant too', () => {
  for (const format of AI_TRANSFER_FORMATS) {
    const file = serializeAiTransfer(ROWS, format, { appName: 'tm-studio', appId: 'app-1', includeSecrets: false })
    const back = parseAiTransfer(file.content, { knownProviders: KNOWN, format, fileName: file.fileName })
    assert.equal(back.errors.length, 0, `${format}: ${JSON.stringify(back.errors)}`)
    for (const row of back.rows) assert.equal(row.apiKey, '', `${format}: key appeared without secrets`)
  }
})

console.log(`\n=== All ${passed} AI-transfer checks passed ===`)
