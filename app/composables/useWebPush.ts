import { getErrorMessage } from '~/shared/utils/errors'

export const useWebPush = () => {
  const { hubFetch, appId } = useHub()
  const { t } = useI18n()
  const isSupported = ref(false)
  const isSubscribed = ref(false)
  const permission = ref<NotificationPermission>('default')
  const subscription = ref<PushSubscription | null>(null)
  const currentFcmToken = ref<string | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  const isElectronEnv = (): boolean => {
    if (typeof window === 'undefined') return false
    const electronAPI = (window as unknown as { electronAPI?: { isElectron?: boolean } }).electronAPI
    return !!electronAPI?.isElectron || (typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent))
  }

  const checkSupport = () => {
    if (typeof window === 'undefined') return false

    const hasNotification = 'Notification' in window
    const hasServiceWorker = 'serviceWorker' in navigator
    const hasPushManager = 'PushManager' in window

    // In Electron or desktop wrappers, native desktop Notification is supported
    const supported = hasNotification && (isElectronEnv() || (hasServiceWorker && hasPushManager))
    isSupported.value = supported

    if (hasNotification) {
      permission.value = Notification.permission
    }

    return supported
  }

  const requestPermission = async (): Promise<NotificationPermission> => {
    if (!checkSupport()) {
      error.value = t('error.unexpected')
      return 'denied'
    }

    try {
      const result = await Notification.requestPermission()
      permission.value = result
      return result
    } catch (err) {
      console.error('Error requesting notification permission:', err)
      error.value = getErrorMessage(err, key => t(key))
      return 'denied'
    }
  }

  const showNativeNotification = async (title: string, body?: string) => {
    if (typeof window === 'undefined') return
    const electronAPI = (window as unknown as {
      electronAPI?: {
        system?: { showNotification?: (payload: { title: string, body?: string }) => Promise<boolean> }
      }
    }).electronAPI
    if (electronAPI?.system?.showNotification) {
      try {
        const res = await electronAPI.system.showNotification({ title, body })
        if (res) return
      } catch (e) {
        console.warn('[Electron] system:showNotification call failed, falling back to Notification API:', e)
      }
    }

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body,
          icon: '/icon.png'
        })
      } catch (e) {
        console.warn('Native notification display failed:', e)
      }
    }
  }

  const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')

    const rawData = window.atob(base64)
    const outputArray = new Uint8Array(rawData.length)

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i)
    }
    return outputArray
  }

  const registerDevice = async (deviceType: 'mobile' | 'desktop' | 'tablet' = 'desktop'): Promise<boolean> => {
    if (!checkSupport()) {
      error.value = t('error.unexpected')
      return false
    }

    if (permission.value !== 'granted') {
      const result = await requestPermission()
      if (result !== 'granted') {
        return false
      }
    }

    isLoading.value = true
    error.value = null

    const isElectron = isElectronEnv()

    // 1. Electron environment: use native desktop notification channel directly
    if (isElectron) {
      try {
        let desktopEndpoint = ''
        try {
          desktopEndpoint = localStorage.getItem(`desktop_endpoint_${appId}`) || ''
        } catch {
          // ignore
        }
        if (!desktopEndpoint) {
          desktopEndpoint = `desktop://electron_${Math.random().toString(36).slice(2, 10)}`
          try {
            localStorage.setItem(`desktop_endpoint_${appId}`, desktopEndpoint)
          } catch {
            // ignore
          }
        }

        await hubFetch(`/api/v1/apps/${appId}/notifications/subscribe`, {
          method: 'POST',
          body: {
            endpoint: desktopEndpoint,
            deviceType: 'desktop'
          }
        }).catch((hubErr) => {
          console.warn('[WebPush] Hub subscription sync warning:', hubErr)
        })

        try {
          localStorage.setItem(`desktop_notifications_${appId}`, 'true')
        } catch {
          // ignore
        }

        isSubscribed.value = true
        showNativeNotification(
          t('settings.desktop', 'Desktop'),
          t('settings.desktopNotifDesc', 'Receive desktop notifications.')
        )
        return true
      } catch (err) {
        console.error('[WebPush] Error registering desktop device:', err)
        error.value = getErrorMessage(err, key => t(key))
        return false
      } finally {
        isLoading.value = false
      }
    }

    // 2. Standard Web Browser environment (Chrome, Edge, Firefox, Brave)
    try {
      const resConfig = await hubFetch<{ success: boolean, data?: Record<string, unknown> }>(`/api/v1/apps/${appId}/configs/public`)
      const configValues = resConfig?.data?.values
      const sysConfig = (configValues ?? resConfig?.data ?? {}) as Record<string, string>

      let registration: ServiceWorkerRegistration | null = null
      try {
        registration = await navigator.serviceWorker.ready
      } catch {
        // serviceWorker not ready
      }

      let subscriptionData: Record<string, unknown> = {}
      const provider = sysConfig.NOTIFICATION_PROVIDER || 'firebase'
      const hasFirebaseConfig = !!(sysConfig.FIREBASE_API_KEY && sysConfig.FIREBASE_PROJECT_ID)

      let fcmToken: string | null = null
      if (registration && provider === 'firebase' && hasFirebaseConfig) {
        try {
          const firebaseConfig = {
            apiKey: sysConfig.FIREBASE_API_KEY,
            authDomain: sysConfig.FIREBASE_AUTH_DOMAIN || `${sysConfig.FIREBASE_PROJECT_ID}.firebaseapp.com`,
            projectId: sysConfig.FIREBASE_PROJECT_ID,
            storageBucket: sysConfig.FIREBASE_STORAGE_BUCKET || `${sysConfig.FIREBASE_PROJECT_ID}.firebasestorage.app`,
            messagingSenderId: sysConfig.FIREBASE_MESSAGING_SENDER_ID || '',
            appId: sysConfig.FIREBASE_APP_ID || '',
            measurementId: sysConfig.FIREBASE_MEASUREMENT_ID || ''
          }

          const { initializeApp, getApps, getApp } = await import('firebase/app')
          const { getMessaging, getToken } = await import('firebase/messaging')

          const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp()
          const messaging = getMessaging(app)

          if (registration.active) {
            registration.active.postMessage({
              type: 'SET_FIREBASE_CONFIG',
              config: firebaseConfig
            })
          }

          fcmToken = await getToken(messaging, {
            serviceWorkerRegistration: registration,
            vapidKey: sysConfig.FIREBASE_VAPID_KEY || sysConfig.WEB_PUSH_PUBLIC_KEY
          })

          if (fcmToken) {
            currentFcmToken.value = fcmToken
            try {
              await $fetch('/api/push/fcm-token', {
                method: 'POST',
                body: { fcmToken }
              })
            } catch (cookieErr) {
              console.warn('[WebPush] Could not persist FCM token in HttpOnly cookie:', cookieErr)
            }
            subscriptionData = { fcmToken }
          }
        } catch (fcmErr) {
          console.warn('[FirebasePush] FCM registration failed, falling back to standard VAPID Web Push:', fcmErr)
        }
      }

      // Fallback to standard VAPID Web Push
      if (!subscriptionData.fcmToken && registration) {
        const vapidPublicKey = sysConfig.WEB_PUSH_PUBLIC_KEY
        if (vapidPublicKey) {
          try {
            const pushSubscription = await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource
            })

            const json = pushSubscription.toJSON()
            subscriptionData = {
              endpoint: pushSubscription.endpoint,
              keys: {
                p256dh: json.keys?.p256dh,
                auth: json.keys?.auth
              }
            }
            subscription.value = pushSubscription
          } catch (pushErr) {
            const pushErrInfo = pushErr as { message?: string, name?: string }
            const msg = String(pushErrInfo?.message || pushErr)
            if (msg.includes('push service not available') || pushErrInfo?.name === 'AbortError') {
              console.warn('[WebPush] Push service not available in browser. Falling back to local desktop notifications.')
            } else {
              throw pushErr
            }
          }
        }
      }

      // If push service was unavailable or rejected, fall back to desktop notification endpoint
      if (!subscriptionData.endpoint && !subscriptionData.fcmToken) {
        let desktopEndpoint = ''
        try {
          desktopEndpoint = localStorage.getItem(`desktop_endpoint_${appId}`) || ''
        } catch {
          // ignore
        }
        if (!desktopEndpoint) {
          desktopEndpoint = `desktop://browser_${Math.random().toString(36).slice(2, 10)}`
          try {
            localStorage.setItem(`desktop_endpoint_${appId}`, desktopEndpoint)
          } catch {
            // ignore
          }
        }
        subscriptionData = { endpoint: desktopEndpoint }
      }

      await hubFetch(`/api/v1/apps/${appId}/notifications/subscribe`, {
        method: 'POST',
        body: {
          ...subscriptionData,
          deviceType
        }
      })

      try {
        localStorage.setItem(`desktop_notifications_${appId}`, 'true')
      } catch {
        // ignore
      }

      isSubscribed.value = true
      showNativeNotification(
        t('settings.desktop', 'Desktop'),
        t('settings.desktopNotifDesc', 'Receive desktop notifications.')
      )
      return true
    } catch (err) {
      const errInfo = err as { message?: string, name?: string }
      const msg = String(errInfo?.message || err)
      if (msg.includes('push service not available') || errInfo?.name === 'AbortError') {
        try {
          let desktopEndpoint = ''
          try {
            desktopEndpoint = localStorage.getItem(`desktop_endpoint_${appId}`) || ''
          } catch {
            // ignore
          }
          if (!desktopEndpoint) {
            desktopEndpoint = `desktop://browser_${Math.random().toString(36).slice(2, 10)}`
            try {
              localStorage.setItem(`desktop_endpoint_${appId}`, desktopEndpoint)
            } catch {
              // ignore
            }
          }

          await hubFetch(`/api/v1/apps/${appId}/notifications/subscribe`, {
            method: 'POST',
            body: {
              endpoint: desktopEndpoint,
              deviceType
            }
          }).catch(() => {})

          try {
            localStorage.setItem(`desktop_notifications_${appId}`, 'true')
          } catch {
            // ignore
          }

          isSubscribed.value = true
          showNativeNotification(
            t('settings.desktop', 'Desktop'),
            t('settings.desktopNotifDesc', 'Receive desktop notifications.')
          )
          return true
        } catch {
          // ignore
        }
      }

      console.error('[WebPush] Error registering device:', err)
      error.value = getErrorMessage(err, key => t(key))
      return false
    } finally {
      isLoading.value = false
    }
  }

  const unregisterDevice = async (): Promise<boolean> => {
    isLoading.value = true
    error.value = null

    try {
      let identifier = ''
      if ('serviceWorker' in navigator && !isElectronEnv()) {
        try {
          const registration = await navigator.serviceWorker.ready
          const pushSub = await registration.pushManager.getSubscription()
          if (pushSub) {
            identifier = pushSub.endpoint
            await pushSub.unsubscribe()
          }
        } catch {
          // ignore
        }
      }

      let storedDesktopEndpoint = ''
      try {
        storedDesktopEndpoint = localStorage.getItem(`desktop_endpoint_${appId}`) || ''
      } catch {
        // ignore
      }

      const endpointToUnsub = identifier || storedDesktopEndpoint

      // The FCM token lives in an HttpOnly cookie, so the server forwards the
      // hub unsubscribe on our behalf.
      await $fetch('/api/push/fcm-token', {
        method: 'DELETE',
        body: { endpoint: endpointToUnsub || undefined }
      }).catch(() => {})

      try {
        localStorage.removeItem(`fcm_token_${appId}`)
        localStorage.removeItem(`desktop_notifications_${appId}`)
        localStorage.removeItem(`desktop_endpoint_${appId}`)
      } catch {
        // ignore
      }

      subscription.value = null
      currentFcmToken.value = null
      isSubscribed.value = false
      return true
    } catch (err) {
      console.error('[WebPush] Error unregistering device:', err)
      error.value = getErrorMessage(err, key => t(key))
      return false
    } finally {
      isLoading.value = false
    }
  }

  // Moves a legacy localStorage FCM token into the HttpOnly cookie, then
  // reports whether the server currently holds one. The token value never
  // travels back to page scripts.
  const syncFcmTokenCookie = async (): Promise<boolean> => {
    let legacyToken: string | null = null
    try {
      legacyToken = localStorage.getItem(`fcm_token_${appId}`)
    } catch {
      // ignore
    }

    if (legacyToken) {
      try {
        await $fetch('/api/push/fcm-token', { method: 'POST', body: { fcmToken: legacyToken } })
        try {
          localStorage.removeItem(`fcm_token_${appId}`)
        } catch {
          // ignore
        }
      } catch {
        // Unauthenticated or offline: keep the legacy key for the next run
      }
    }

    try {
      const res = await $fetch<{ success: boolean, data: { exists: boolean } }>('/api/push/fcm-token')
      return !!res?.data?.exists
    } catch {
      return false
    }
  }

  const checkSubscription = async (): Promise<boolean> => {
    if (!checkSupport()) return false

    try {
      // 1. Check local desktop notification setting
      let isDesktopSaved = false
      try {
        isDesktopSaved = localStorage.getItem(`desktop_notifications_${appId}`) === 'true'
      } catch {
        // ignore
      }

      if (isDesktopSaved && Notification.permission === 'granted') {
        isSubscribed.value = true
        return true
      }

      // 2. Check service worker push subscription for standard browsers
      if ('serviceWorker' in navigator && !isElectronEnv()) {
        let registration = await navigator.serviceWorker.getRegistration()
        if (!registration) {
          try {
            registration = await Promise.race([
              navigator.serviceWorker.ready,
              new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 1200))
            ])
          } catch {
            // ignore
          }
        }

        if (registration) {
          try {
            const pushSubscription = await registration.pushManager.getSubscription()
            const hasServerToken = await syncFcmTokenCookie()

            if (pushSubscription || hasServerToken) {
              if (pushSubscription) subscription.value = pushSubscription
              isSubscribed.value = true
              return true
            }
          } catch {
            // pushManager might throw in restricted environments
          }
        }
      }

      isSubscribed.value = false
      return false
    } catch (err) {
      console.error('Error checking subscription:', err)
      return false
    }
  }

  if (import.meta.client) {
    checkSupport()
    checkSubscription()
  }

  return {
    isSupported,
    isSubscribed,
    permission,
    subscription,
    currentFcmToken,
    isLoading,
    error,
    checkSupport,
    requestPermission,
    registerDevice,
    unregisterDevice,
    checkSubscription,
    showNativeNotification
  }
}
