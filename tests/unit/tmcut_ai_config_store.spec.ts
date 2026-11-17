import assert from 'node:assert/strict'

process.env.NODE_ENV = 'test'

let failures = 0
function check(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (err) => {
      failures++
      console.log(`FAILED ${name}: ${(err as Error).message}`)
    }
  )
}

class MemoryCollection {
  docs: Array<Record<string, unknown>> = []
  indexes: Array<[Record<string, unknown>, Record<string, unknown>?]> = []

  async createIndex(spec: Record<string, unknown>, opts?: Record<string, unknown>) { this.indexes.push([spec, opts]) }

  find(filter: Record<string, unknown>) {
    const hit = (doc: Record<string, unknown>) => Object.entries(filter).every(([k, v]) => doc[k] === v)
    return { toArray: async () => this.docs.filter(hit).map(doc => ({ ...doc })) }
  }

  async findOne(filter: Record<string, unknown>) {
    const hit = (doc: Record<string, unknown>) => Object.entries(filter).every(([k, v]) => doc[k] === v)
    return this.docs.find(hit) ?? null
  }

  async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, opts?: { upsert?: boolean }) {
    const hit = (doc: Record<string, unknown>) => Object.entries(filter).every(([k, v]) => doc[k] === v)
    let doc = this.docs.find(hit)
    if (!doc) {
      if (!opts?.upsert) return {}
      doc = { ...filter }
      this.docs.push(doc)
    }
    Object.assign(doc, (update.$set ?? {}) as Record<string, unknown>)
    return {}
  }

  async deleteOne(filter: Record<string, unknown>) {
    const hit = (doc: Record<string, unknown>) => Object.entries(filter).every(([k, v]) => doc[k] === v)
    const i = this.docs.findIndex(hit)
    if (i >= 0) this.docs.splice(i, 1)
    return {}
  }
}

const collections = new Map<string, MemoryCollection>()
const fakeDb = {
  collection(name: string) {
    if (!collections.has(name)) collections.set(name, new MemoryCollection())
    return collections.get(name)!
  }
}

const mod = await import('../../server/utils/aiConfigMongo')

mod.__setTestHooks({
  db: fakeDb,
  secret: Buffer.alloc(32, 7).toString('base64'),
  env: {}
})

await check('stored rows are sealed and owner-scoped', async () => {
  const store = mod.tmStudioAIConfigStore('user-1')
  await store.upsertConnection({
    connectionId: 'lab',
    providerKey: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyCipher: await mod.tmStudioSeal('sk-x'),
    enabled: true,
    models: [{ modelId: 'gpt-4o-mini', enabled: true, isPrimary: true }]
  })
  const rows = await store.listConnections()
  assert.equal(rows.length, 1)
  assert.match(rows[0]!.apiKeyCipher!, /^v1\./)
  assert.equal((await mod.tmStudioAIConfigStore('user-2').listConnections()).length, 0)
})

await check('safe rows carry no ciphertext and open round-trips', async () => {
  const [row] = await mod.tmStudioAIConfigStore('user-1').listConnections()
  const safe = mod.tmStudioSafeConnection(row!)
  assert.equal(JSON.stringify(safe).includes('v1.'), false)
  assert.equal(safe.hasKey, true)
  assert.equal(safe.providerName.length > 0, true)
  assert.equal(await mod.tmStudioOpen(row!), 'sk-x')
})

await check('configured connections skip disabled rows and models', async () => {
  const store = mod.tmStudioAIConfigStore('user-1')
  await store.upsertConnection({
    connectionId: 'off',
    providerKey: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyCipher: await mod.tmStudioSeal('sk-y'),
    enabled: false,
    models: [{ modelId: 'gpt-4o', enabled: true, isPrimary: true }]
  })
  await store.upsertConnection({
    connectionId: 'part',
    providerKey: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyCipher: await mod.tmStudioSeal('sk-z'),
    enabled: true,
    models: [
      { modelId: 'gpt-4o', enabled: true, isPrimary: true },
      { modelId: 'gpt-4o-mini', enabled: false }
    ]
  })
  const entries = await mod.studioConfiguredConnections('user-1')
  assert.deepEqual(entries.map(entry => entry.connectionId).sort(), ['lab', 'part'])
  const part = entries.find(entry => entry.connectionId === 'part')!
  assert.deepEqual(part.models.map(model => model.modelId), ['gpt-4o'])
  assert.equal(part.apiKey, 'sk-z')
})

await check('hasKey follows the row shape and the named env slot', () => {
  const base = {
    ownerId: 'user-1',
    providerKey: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    enabled: true,
    models: []
  }
  // A sealed key answers without being opened.
  assert.equal(mod.tmStudioSafeConnection({ ...base, connectionId: 'sealed', apiKeyCipher: 'v1.cipher' }).hasKey, true)
  // No sealed key and no slot is the intentional keyless shape (local ollama).
  assert.equal(mod.tmStudioSafeConnection({ ...base, connectionId: 'keyless', apiKeyCipher: '' }).hasKey, true)

  const secret = Buffer.alloc(32, 7).toString('base64')
  mod.__setTestHooks({ db: fakeDb, secret, env: { FILLED_KEY: 'sk-env', BLANK_KEY: '   ' } })
  try {
    // An env-backed row is keyed only when the slot it names holds a value.
    assert.equal(
      mod.tmStudioSafeConnection({ ...base, connectionId: 'filled', apiKeyCipher: '', apiKeyEnv: 'FILLED_KEY' }).hasKey,
      true
    )
    assert.equal(
      mod.tmStudioSafeConnection({ ...base, connectionId: 'blank', apiKeyCipher: '', apiKeyEnv: 'BLANK_KEY' }).hasKey,
      false
    )
    assert.equal(
      mod.tmStudioSafeConnection({ ...base, connectionId: 'absent', apiKeyCipher: '', apiKeyEnv: 'MISSING_KEY' }).hasKey,
      false
    )
  } finally {
    mod.__setTestHooks({ db: fakeDb, secret, env: {} })
  }
})

await check('a missing master key fails with a 503', () => {
  mod.__setTestHooks({ db: fakeDb, secret: null, env: {} })
  assert.throws(() => mod.requireStudioAIConfigSecret(), (err: unknown) => {
    const e = err as { statusCode?: number, statusMessage?: string }
    return e.statusCode === 503 && e.statusMessage === 'error.aiConfigSecretMissing'
  })
})

if (failures) {
  console.log(`${failures} FAILED`)
  process.exit(1)
}
console.log('tmcut_ai_config_store: all checks passed')
