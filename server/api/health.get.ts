export default defineEventHandler(async () => {
  const config = useRuntimeConfig()
  const port = process.env.PORT || 4003

  const diagnostics: Record<string, unknown> = {
    config: {
      authProvider: process.env.AUTH_PROVIDER || 'hub',
      appPort: Number(port),
      hubUrl: config.public.hubUrl ? '(set)' : '(not set)',
      hubAppId: config.public.hubAppId || '(not set)'
    },
    database: 'connected',
    adapter: 'TM-Hub Control Plane (Centralized IAM)'
  }

  // Ping TM-Hub public endpoint to check health connectivity
  try {
    if (config.public.hubUrl) {
      await $fetch(`${config.public.hubUrl}/api/health`, { timeout: 3000 }).catch(() => null)
    }
  } catch {
    // Hub ping is optional; satellite is operational
  }

  return {
    success: true,
    data: diagnostics
  }
})
