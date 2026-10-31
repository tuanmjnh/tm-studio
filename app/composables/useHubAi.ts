import type { HubConnectionStatus } from 'tm-hub-client'
import type { NitroFetchOptions, NitroFetchRequest } from 'nitropack'

/**
 * AI Provider definition from hub (GET /api/v1/apps/:appId/ai/providers).
 * Mirrors server/modules/ai-providers/store.ts ProviderDefinitionRow.
 */
export interface HubAiProviderDefinition {
  id: string
  key: string
  name: string
  category: string
  adapter_type: string
  base_url_default: string | null
  capabilities_supported: string[]
  model_discovery_strategy: string | null
  docs_url: string | null
  is_builtin: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

/**
 * AI Connection from hub (merged in providers payload, or listUsableConnections).
 * Mirrors SerializedConnection with AI-specific fields.
 */
export interface HubAiConnection {
  id: string
  provider: string
  name: string
  mode: 'manual'
  status: HubConnectionStatus
  label: string | null
  config: Record<string, unknown>
  hasSecrets: boolean
  isEnabled: boolean
  isShared: boolean
  environment: string | null
  baseUrlOverride: string | null
  category: string | null
  providerDefinitionId: string | null
  lastTestAt: string | null
  lastTestOk: boolean | null
  connectedAt: string
  expiresAt: string | null
  connectedBy: string | null
  updatedAt: string
}

/**
 * Provider item from /ai/providers endpoint.
 */
export interface HubAiProviderItem {
  definition: HubAiProviderDefinition
  connections: HubAiConnection[]
}

/**
 * Model catalogue entry from /ai/models.
 */
export interface HubAiModel {
  id: string
  provider: string
  connectionId: string | null
  modelId: string
  displayName: string | null
  capabilities: string[]
  isEnabled: boolean
  source: 'discovered' | 'manual'
  syncedAt: string | null
}

/**
 * Discover models result from /ai/discover.
 */
export interface HubAiDiscoverResult {
  baseUrl: string
  discovered: number
  persisted: number
  models: Array<{ id: string, displayName: string | null }>
}

/**
 * Grant entry from /ai/grants.
 */
export interface HubAiGrant {
  connectionId: string
  appId: string
  isEnabled: boolean
  grantedBy: string | null
  createdAt: string
  updatedAt: string
}

/**
 * AI-specific API client for the /ai namespace (R147).
 *
 * Built on `useHub().hubFetch` (Nitro $fetch) rather than the
 * tm-hub-client `request()` method: the client's public type restricts
 * `body` to `BodyInit`, while the /ai endpoints need plain object
 * payloads — the same pattern other satellite pages use for
 * object-body hub calls. hubFetch already attaches the Bearer token
 * and the X-App-Id header.
 */
export function useHubAi() {
  const { hubFetch } = useHub()

  /** Base path for AI endpoints under the current app. */
  function aiBase(appId: string) {
    return `/api/v1/apps/${encodeURIComponent(appId)}/ai`
  }

  /** Typed hubFetch: returns the envelope data, throws on non-2xx. */
  async function request<T>(path: string, options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
    body?: unknown
    query?: Record<string, string | boolean | undefined>
  } = {}): Promise<T> {
    const query = options.query
      ? Object.entries(options.query)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : ''
    const res = await hubFetch<{ success: boolean, data: T, message?: string, statusMessage?: string }>(
      `${path}${query ? `?${query}` : ''}`,
      {
        method: options.method || 'GET',
        body: options.body as NitroFetchOptions<NitroFetchRequest>['body']
      }
    )
    if (res && res.success === false) {
      throw new Error(res.message || res.statusMessage || 'Request failed')
    }
    return res.data as T
  }

  return {
    /**
     * GET /api/v1/apps/:appId/ai/providers
     * Returns all builtin provider definitions joined with this app's usable connections.
     */
    async listProviders(appId: string): Promise<HubAiProviderItem[]> {
      const data = await request<HubAiProviderItem[]>(`${aiBase(appId)}/providers`)
      return data || []
    },

    /**
     * POST /api/v1/apps/:appId/ai/discover
     * Fetch live model catalogue from a provider endpoint and optionally persist.
     * Body: { connectionId } (stored credential) OR { provider, baseUrl?, apiKey } (pre-save test).
     */
    async discoverModels(appId: string, body: {
      connectionId?: string
      provider?: string
      baseUrl?: string
      apiKey?: string
      persist?: boolean
    }): Promise<HubAiDiscoverResult> {
      return request<HubAiDiscoverResult>(`${aiBase(appId)}/discover`, { method: 'POST', body })
    },

    /**
     * GET /api/v1/apps/:appId/ai/models
     * Query params: provider?, connectionId?, includeDisabled?
     */
    async listModels(appId: string, params: {
      provider?: string
      connectionId?: string
      includeDisabled?: boolean
    } = {}): Promise<HubAiModel[]> {
      const data = await request<HubAiModel[]>(`${aiBase(appId)}/models`, {
        query: {
          provider: params.provider,
          connectionId: params.connectionId,
          includeDisabled: params.includeDisabled
        }
      })
      return data || []
    },

    /**
     * POST /api/v1/apps/:appId/ai/models
     * Add a model manually (when provider has no discovery or key can't list).
     */
    async addModel(appId: string, body: {
      provider: string
      connectionId: string | null
      modelId: string
      displayName?: string
      capabilities?: string[]
    }): Promise<HubAiModel> {
      return request<HubAiModel>(`${aiBase(appId)}/models`, { method: 'POST', body })
    },

    /**
     * POST /api/v1/apps/:appId/ai/models
     * Batch persist discovered models for a connection.
     */
    async addModels(appId: string, body: {
      provider: string
      connectionId: string | null
      models: Array<{ id: string, displayName?: string, capabilities?: string[] }>
    }): Promise<{ count: number, total: number }> {
      return request<{ count: number, total: number }>(`${aiBase(appId)}/models`, { method: 'POST', body })
    },


    /**
     * PATCH /api/v1/apps/:appId/ai/models/:modelId
     * Toggle model enabled/disabled.
     */
    async toggleModel(appId: string, modelId: string, enabled: boolean): Promise<void> {
      await request<unknown>(`${aiBase(appId)}/models/${encodeURIComponent(modelId)}`, {
        method: 'PATCH',
        body: { isEnabled: enabled }
      })
    },

    /**
     * DELETE /api/v1/apps/:appId/ai/models/:modelId
     */
    async deleteModel(appId: string, modelId: string): Promise<void> {
      await request<unknown>(`${aiBase(appId)}/models/${encodeURIComponent(modelId)}`, { method: 'DELETE' })
    },

    /**
     * POST /api/v1/apps/:appId/ai/connections/manual
     * Add or rotate one AI provider credential. `name` allows many
     * credentials per provider (primary/fallback). Same connections
     * table + AES-GCM path as Cloudinary — no second credential store.
     */
    async saveCredential(appId: string, body: {
      provider: string
      name?: string
      values: Record<string, string>
      environment?: string
      baseUrlOverride?: string
      isShared?: boolean
      preserveSecrets?: boolean
    }): Promise<{ connection: HubAiConnection, test: { ok: boolean, message?: string } }> {
      return request<{ connection: HubAiConnection, test: { ok: boolean, message?: string } }>(
        `${aiBase(appId)}/connections/manual`,
        { method: 'POST', body }
      )
    },

    /**
     * GET /api/v1/apps/:appId/ai/connections/:connectionId
     * Get a single AI connection by ID (for governance).
     */
    async getConnection(appId: string, connectionId: string): Promise<HubAiConnection> {
      return request<HubAiConnection>(`${aiBase(appId)}/connections/${encodeURIComponent(connectionId)}`)
    },

    /**
     * PATCH /api/v1/apps/:appId/ai/connections/:connectionId
     * Governance: isEnabled (master switch), isShared (cross-app grants).
     */
    async patchConnection(appId: string, connectionId: string, body: {
      isEnabled?: boolean
      isShared?: boolean
      status?: string
      lastTestOk?: boolean
      lastTestAt?: string
    }): Promise<HubAiConnection> {
      return request<HubAiConnection>(
        `${aiBase(appId)}/connections/${encodeURIComponent(connectionId)}`,
        { method: 'PATCH', body }
      )
    },

    /**
     * DELETE /api/v1/apps/:appId/ai/connections/:connectionId
     */
    async deleteConnection(appId: string, connectionId: string): Promise<void> {
      await request<unknown>(`${aiBase(appId)}/connections/${encodeURIComponent(connectionId)}`, { method: 'DELETE' })
    },

    /**
     * GET /api/v1/apps/:appId/ai/grants
     * List shared connections granted to this app.
     */
    async listGrants(appId: string): Promise<HubAiGrant[]> {
      const data = await request<HubAiGrant[]>(`${aiBase(appId)}/grants`)
      return data || []
    },

    /**
     * POST /api/v1/apps/:appId/ai/grants
     * Grant a shared connection to a target app.
     * Body: { connectionId, targetAppId }
     */
    async grantConnection(appId: string, body: {
      connectionId: string
      targetAppId: string
    }): Promise<void> {
      await request<unknown>(`${aiBase(appId)}/grants`, { method: 'POST', body })
    },

    /**
     * DELETE /api/v1/apps/:appId/ai/grants?connectionId=...&targetAppId=...
     * Revoke a grant.
     */
    async revokeGrant(appId: string, connectionId: string, targetAppId: string): Promise<void> {
      await request<unknown>(`${aiBase(appId)}/grants`, {
        method: 'DELETE',
        query: { connectionId, targetAppId }
      })
    }
  }
}
