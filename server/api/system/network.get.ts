import { ofetch } from 'ofetch'

/**
 * Sidebar connectivity probe. The renderer only needs one bit — is the hub
 * reachable — so the hop is measured here and reported with latency. A failed
 * probe is a normal state (offline), not an HTTP error, so the indicator does
 * not flash an error toast on every poll.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const hubUrl = String(config.public.hubUrl || '').replace(/\/+$/, '')
  const hubAppId = String(config.public.hubAppId || '')
  const checkedAt = new Date().toISOString()

  if (!hubUrl) {
    return { success: true, data: { online: false, latencyMs: -1, checkedAt, method: 'unconfigured' } }
  }

  const started = Date.now()
  try {
    const res = await ofetch<{ data?: { status?: string } }>(`${hubUrl}/api/v1/health`, {
      headers: hubAppId ? { 'X-App-Id': hubAppId } : {},
      timeout: 5000
    })
    return {
      success: true,
      data: {
        online: res?.data?.status === 'healthy',
        latencyMs: Date.now() - started,
        checkedAt,
        method: 'hub'
      }
    }
  } catch {
    return { success: true, data: { online: false, latencyMs: -1, checkedAt, method: 'hub' } }
  }
})
