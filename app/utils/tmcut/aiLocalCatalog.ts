import { mergeCatalog, toAppCatalogConnection, type CatalogConnection, type CatalogModelEntry } from '@tuanmjnh/tm-ai-client'

export interface LocalConnectionRow {
  connectionId: string
  providerKey: string
  baseUrl: string
  hasKey: boolean
  enabled: boolean
  models: Array<{ modelId: string, displayName?: string, enabled: boolean, isPrimary?: boolean }>
}

export interface RelayConnectionModel {
  modelId: string
  displayName: string
  isPrimary?: boolean
}

export interface RelayConnectionLike {
  connectionId: string
  provider: string
  name: string
  adapterType: string
  origin: 'own' | 'shared'
  hasKey: boolean
  model: string | null
  models: RelayConnectionModel[]
}

type CatalogModel = CatalogModelEntry & { isPrimary?: boolean }
type CatalogWithOrigin = Omit<CatalogConnection, 'models'> & { origin?: 'own' | 'shared', models: CatalogModel[] }

export type AppCatalogRow = CatalogConnection

export function localRowsToCatalog(rows: LocalConnectionRow[]): CatalogConnection[] {
  const out: CatalogConnection[] = []
  for (const row of rows) {
    if (!row.enabled) continue
    const models = row.models.filter(model => model.enabled)
    const catalogModels: CatalogModel[] = models.map(model => ({
      modelId: model.modelId,
      ...(model.displayName ? { displayName: model.displayName } : {}),
      ...(model.isPrimary ? { isPrimary: true } : {})
    }))
    const base = toAppCatalogConnection({
      connectionId: row.connectionId,
      providerKey: row.providerKey,
      baseUrl: row.baseUrl,
      models: catalogModels
    }, { hasKey: row.hasKey })
    out.push({
      ...base,
      model: catalogModels.find(model => model.isPrimary)?.modelId ?? catalogModels[0]?.modelId ?? null,
      models: catalogModels
    })
  }
  return out
}

export function mergeRelayCatalog(hub: RelayConnectionLike[], app: CatalogConnection[]): RelayConnectionLike[] {
  const merged = mergeCatalog(hub as unknown as CatalogConnection[], app) as unknown as CatalogWithOrigin[]
  return merged.map((conn) => {
    const models = conn.models
      .filter(model => !model.shadowed)
      .map(model => ({
        modelId: model.modelId,
        displayName: model.displayName ?? model.modelId,
        ...(model.isPrimary ? { isPrimary: true } : {})
      }))
    return {
      connectionId: conn.connectionId,
      provider: conn.provider,
      name: conn.name,
      adapterType: conn.adapterType,
      origin: conn.origin ?? 'own',
      hasKey: conn.hasKey,
      model: conn.model,
      models
    }
  })
}
