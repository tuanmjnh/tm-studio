interface NetworkData {
  online: boolean
  latencyMs: number
  checkedAt: string
  method: string
}

export function useNetworkStatus(options: { interval?: number } = {}) {
  const interval = options.interval ?? 15000
  const online = ref(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const checking = ref(false)
  const latency = ref<number | null>(null)
  const lastChecked = ref<string | null>(null)
  const method = ref<string | null>(null)

  let timer: ReturnType<typeof setInterval> | null = null

  async function check() {
    checking.value = true
    try {
      const res = await $fetch<{ success: boolean, data: NetworkData }>('/api/system/network')
      online.value = res.data.online
      latency.value = res.data.latencyMs >= 0 ? res.data.latencyMs : null
      lastChecked.value = res.data.checkedAt
      method.value = res.data.method
    } catch {
      online.value = false
    } finally {
      checking.value = false
    }
  }

  function start() {
    check()
    timer = setInterval(check, interval)
  }

  function stop() {
    if (timer) clearInterval(timer)
    timer = null
  }

  if (import.meta.client) {
    const onBrowserOnline = () => {
      online.value = true
    }
    const onBrowserOffline = () => {
      online.value = false
    }

    onMounted(() => {
      window.addEventListener('online', onBrowserOnline)
      window.addEventListener('offline', onBrowserOffline)
      start()
    })
    onUnmounted(() => {
      window.removeEventListener('online', onBrowserOnline)
      window.removeEventListener('offline', onBrowserOffline)
      stop()
    })
  }

  return { online, checking, latency, lastChecked, method, check }
}
