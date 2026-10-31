import { defineEventHandler, readBody, createError } from 'h3'

interface DiscoverBody {
  provider?: string
  baseUrl: string
  apiKey?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<DiscoverBody>(event)
  if (!body?.baseUrl) {
    throw createError({ statusCode: 400, statusMessage: 'error.invalidRequest', message: 'baseUrl is required' })
  }

  const base = body.baseUrl.trim().replace(/\/+$/, '')
  const apiKey = (body.apiKey || '').trim()

  const headers: Record<string, string> = {
    accept: 'application/json'
  }
  if (apiKey) {
    if (body.provider === 'anthropic') {
      headers['x-api-key'] = apiKey
      headers['anthropic-version'] = '2023-06-01'
    } else {
      headers.authorization = `Bearer ${apiKey}`
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)

  try {
    let res = await fetch(`${base}/models`, {
      headers,
      signal: controller.signal
    })

    if (!res.ok && res.status === 404) {
      const altBase = base.endsWith('/v1') ? base.replace(/\/v1$/, '') : `${base}/v1`
      try {
        const altRes = await fetch(`${altBase}/models`, { headers, signal: controller.signal })
        if (altRes.ok) res = altRes
      } catch {
        // ignore fallback error and keep original res
      }
    }

    if (!res.ok) {
      return {
        ok: false,
        models: [],
        message: `HTTP ${res.status} from ${base}/models`
      }
    }

    const text = await res.text()
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      return { ok: false, models: [], message: 'Invalid JSON response from provider' }
    }

    const rawList: unknown[] = Array.isArray(parsed)
      ? parsed
      : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { data?: unknown[] }).data))
        ? (parsed as { data: unknown[] }).data
        : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { models?: unknown[] }).models))
          ? (parsed as { models: unknown[] }).models
          : []

    const models = rawList
      .map((m: unknown) => {
        if (typeof m === 'string') return { id: m.trim(), displayName: m.trim() }
        if (m && typeof m === 'object') {
          const item = m as { id?: unknown, name?: unknown, display_name?: unknown, model?: unknown }
          const id = String(item.id || item.name || item.model || '').trim()
          const displayName = item.display_name || item.name || item.id
            ? String(item.display_name || item.name || item.id).trim()
            : undefined
          return { id, displayName }
        }
        return { id: '', displayName: undefined }
      })
      .filter(m => m.id)
      .slice(0, 300)

    return {
      ok: true,
      models,
      count: models.length
    }
  } catch (err: unknown) {
    const isTimeout = (err as Error)?.name === 'AbortError'
    return {
      ok: false,
      models: [],
      message: isTimeout ? 'Request timed out after 10s' : ((err as Error)?.message || 'Failed to fetch models')
    }
  } finally {
    clearTimeout(timer)
  }
})
