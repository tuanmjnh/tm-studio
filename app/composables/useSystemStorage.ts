export const useSystemStorage = () => {
  const { t } = useI18n()
  const toast = useToast()
  const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined'

  function clearCookiesRaw(): void {
    document.cookie.split(';').forEach((c) => {
      const name = c.split('=')[0]?.trim()
      if (name) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
      }
    })
  }

  async function clearIndexedDB(): Promise<void> {
    if ('indexedDB' in window && indexedDB.databases) {
      const dbs = await indexedDB.databases()
      await Promise.all(dbs.map((db) => {
        if (db.name) return indexedDB.deleteDatabase(db.name)
      }))
    }
  }

  async function clearPwaData(): Promise<void> {
    if (!isBrowser) return
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map(reg => reg.unregister()))
    }
    if ('caches' in window) {
      const cacheNames = await caches.keys()
      await Promise.all(cacheNames.map(name => caches.delete(name)))
    }
    await clearIndexedDB()
  }

  function notifySuccess(key: string) {
    toast.add({ title: t(key), icon: 'i-lucide-check-circle', color: 'success' })
  }

  function notifyError(error: unknown) {
    console.error('Failed to clear storage:', error)
    toast.add({ title: t('settings.storage.clear_failed'), icon: 'i-lucide-alert-circle', color: 'error' })
  }

  function scheduleReload(delay: number = 1500) {
    setTimeout(() => {
      window.location.reload()
    }, delay)
  }

  function clearLocalStorage() {
    if (!isBrowser) return
    try {
      localStorage.clear()
      notifySuccess('settings.storage.local_storage_cleared')
    } catch (error) {
      notifyError(error)
    }
  }

  function clearSessionStorage() {
    if (!isBrowser) return
    try {
      sessionStorage.clear()
      notifySuccess('settings.storage.session_storage_cleared')
    } catch (error) {
      notifyError(error)
    }
  }

  function clearCookies() {
    if (!isBrowser) return
    try {
      clearCookiesRaw()
      notifySuccess('settings.storage.cookies_cleared')
    } catch (error) {
      notifyError(error)
    }
  }

  async function clearSiteData() {
    if (!isBrowser) return
    try {
      localStorage.clear()
      sessionStorage.clear()
      clearCookiesRaw()
      await clearPwaData()
      notifySuccess('settings.storage.site_data_cleared')
      scheduleReload()
    } catch (error) {
      notifyError(error)
    }
  }

  async function clearAllStorage() {
    if (!isBrowser) return
    try {
      localStorage.clear()
      sessionStorage.clear()
      clearCookiesRaw()
      await clearPwaData()
      const storage = navigator.storage as (StorageManager & { clear?: () => Promise<void> })
      if (storage?.clear) {
        await storage.clear()
      }
      notifySuccess('settings.storage.all_cleared_reload')
      scheduleReload()
    } catch (error) {
      notifyError(error)
    }
  }

  return {
    clearLocalStorage,
    clearSessionStorage,
    clearCookies,
    clearPwaData,
    clearSiteData,
    clearAllStorage
  }
}
