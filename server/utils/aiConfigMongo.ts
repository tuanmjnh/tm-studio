import mongoose, { type Connection } from 'mongoose'
import {
  createMongoAIConfigStore,
  openSecret,
  providerDisplayName,
  sealSecret,
  storedToAppConnection,
  type AIConfigStore,
  type AppAIConnection,
  type MongoCollectionLike,
  type MongoDatabaseLike,
  type StoredAIConnection
} from '@tuanmjnh/tm-ai-client'
import { createMongoConnectionManager } from '@tuanmjnh/tm-mongo'

export interface SafeStudioAIModel {
  modelId: string
  displayName?: string
  enabled: boolean
  isPrimary?: boolean
}

export interface SafeStudioAIConnection {
  connectionId: string
  providerKey: string
  providerName: string
  baseUrl: string
  apiKeyEnv: string | null
  hasKey: boolean
  enabled: boolean
  models: SafeStudioAIModel[]
}

interface TestHooks {
  db?: MongoDatabaseLike
  secret?: string | null
  env?: Record<string, string | undefined>
}

let hooks: TestHooks = {}

export function __setTestHooks(next: TestHooks): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('test hooks are not available')
  hooks = next
}

function envValue(key: string): string | undefined {
  return (hooks.env ?? process.env)[key]
}

export function resolveStudioAIConfigSecret(): string | null {
  if (hooks.secret !== undefined) return hooks.secret
  const value = String(process.env.AI_CONFIG_SECRET || '').trim()
  return value || null
}

function aiConfigError(statusCode: number, statusMessage: string, message: string): Error {
  return Object.assign(new Error(message), { statusCode, statusMessage })
}

export function requireStudioAIConfigSecret(): string {
  const secret = resolveStudioAIConfigSecret()
  if (!secret) {
    throw aiConfigError(503, 'error.aiConfigSecretMissing', 'AI_CONFIG_SECRET is not configured on this server')
  }
  return secret
}

const manager = createMongoConnectionManager<Connection>({
  createConnection: (uri, options) => mongoose.createConnection(uri, options)
})

let ready: Promise<MongoDatabaseLike> | null = null

async function studioDb(): Promise<MongoDatabaseLike> {
  if (hooks.db) return hooks.db
  if (!ready) {
    ready = (async () => {
      const uri = String(envValue('MONGODB_URI') || '').trim()
      if (!uri) {
        throw aiConfigError(503, 'error.mongoMissing', 'MONGODB_URI is not configured on this server')
      }
      const dbName = String(envValue('MONGODB_DB') || '').trim() || 'tm_studio'
      const conn = await manager.get(uri, dbName, 'tm-studio')
      if (!conn || !conn.db) {
        throw aiConfigError(503, 'error.mongoUnavailable', 'MongoDB is not reachable')
      }
      return conn.db as unknown as MongoDatabaseLike
    })().catch((err: unknown) => {
      ready = null
      throw err
    })
  }
  return ready
}

const studioDbProxy: MongoDatabaseLike = {
  collection(name: string): MongoCollectionLike {
    const live = async () => (await studioDb()).collection(name)
    return {
      find: filter => ({ toArray: async () => (await live()).find(filter).toArray() }),
      findOne: filter => live().then(collection => collection.findOne(filter)),
      updateOne: (filter, update, options) => live().then(collection => collection.updateOne(filter, update, options)),
      deleteOne: filter => live().then(collection => collection.deleteOne(filter)),
      createIndex: (spec, options) => live().then(collection => collection.createIndex(spec, options))
    }
  }
}

const storesByOwner = new Map<string, AIConfigStore>()

export function tmStudioAIConfigStore(ownerId: string): AIConfigStore {
  if (hooks.db) return createMongoAIConfigStore(hooks.db, ownerId)
  const cached = storesByOwner.get(ownerId)
  if (cached) return cached
  const store = createMongoAIConfigStore(studioDbProxy, ownerId)
  storesByOwner.set(ownerId, store)
  return store
}

export async function tmStudioSeal(plain: string): Promise<string> {
  return sealSecret(requireStudioAIConfigSecret(), plain)
}

export async function tmStudioOpen(record: StoredAIConnection): Promise<string | undefined> {
  if (record.apiKeyCipher) return openSecret(requireStudioAIConfigSecret(), record.apiKeyCipher)
  if (record.apiKeyEnv) return String(envValue(record.apiKeyEnv) || '').trim() || undefined
  return undefined
}

export function tmStudioSafeConnection(record: StoredAIConnection): SafeStudioAIConnection {
  return {
    connectionId: record.connectionId,
    providerKey: record.providerKey,
    providerName: providerDisplayName(record.providerKey),
    baseUrl: record.baseUrl,
    apiKeyEnv: record.apiKeyEnv ?? null,
    // A row with no sealed key and no env slot is keyless on purpose (local
    // ollama); an env-backed row only reports a key when that slot is filled.
    hasKey: Boolean(record.apiKeyCipher) || !record.apiKeyEnv || Boolean(String(envValue(record.apiKeyEnv) || '').trim()),
    enabled: record.enabled,
    models: record.models.map(model => ({
      modelId: model.modelId,
      displayName: model.displayName,
      enabled: model.enabled,
      isPrimary: Boolean(model.isPrimary)
    }))
  }
}

export async function studioConfiguredConnections(ownerId: string): Promise<AppAIConnection[]> {
  const records = await tmStudioAIConfigStore(ownerId).listConnections()
  const out: AppAIConnection[] = []
  for (const record of records) {
    if (!record.enabled) continue
    const apiKey = await tmStudioOpen(record).catch(() => undefined)
    out.push(storedToAppConnection(record, { apiKey }))
  }
  return out
}
