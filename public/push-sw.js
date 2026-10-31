/**
 * Service Worker for Web Push & Firebase (FCM)
 * Handles push events, notification interactions, and dynamic configuration
 */

// --- 1. IMPORT SDKs ---
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js')

// Variable to store firebase instance after dynamic initialization
let messaging = null

/**
 * Handle configuration messages from the main app
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SET_FIREBASE_CONFIG') {
    const config = event.data.config
    if (!firebase.apps.length) {
      firebase.initializeApp(config)
      messaging = firebase.messaging()
      console.log('🔥 Firebase initialized in Service Worker via message')
    }
  }
})

/**
 * Listen for Push Events
 */
self.addEventListener('push', (event) => {
  console.log('📨 Push received', event)

  if (!event.data) return

  try {
    const data = event.data.json()

    // --- PAYLOAD NORMALIZATION ---
    const notification = data.notification || data
    const payloadData = data.data || data.payload || {}

    const title = notification.title || 'New Notification'
    const options = {
      body: notification.body || notification.message || 'You have a new system notification',
      icon: notification.icon || '/pwa-192x192.png',
      badge: notification.badge || '/favicon.ico',
      image: notification.image || payloadData.image,
      tag: payloadData.notificationId || `tag-${Date.now()}`,
      renotify: true,
      requireInteraction: notification.requireInteraction || false,
      data: {
        url: payloadData.url || notification.url || '/',
        notificationId: payloadData.notificationId,
        ...payloadData
      },
      vibrate: [200, 100, 200],
      actions: [
        { action: 'open', title: 'View Now' },
        { action: 'close', title: 'Close' }
      ]
    }

    event.waitUntil(
      self.registration.showNotification(title, options)
    )
  } catch (error) {
    console.error('❌ Error parsing push data:', error)
  }
})

/**
 * Handle Notification Click
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  if (event.action === 'close') return

  const urlToOpen = event.notification.data?.url || '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 1. Try to find if window is already open and focus it
      for (const client of clientList) {
        if (client.url === new URL(urlToOpen, self.location.origin).href && 'focus' in client) {
          return client.focus()
        }
      }

      // 2. If no matching window, navigate an existing one if possible
      if (clientList.length > 0) {
        const client = clientList[0]
        if ('focus' in client && 'navigate' in client) {
          client.navigate(urlToOpen)
          return client.focus()
        }
      }

      // 3. Otherwise open new window
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen)
      }
    })
  )
})

/**
 * Cleanup & Lifecycle
 */
self.addEventListener('activate', (event) => {
  console.log('✅ Service Worker activated')
  event.waitUntil(clients.claim())
})

self.addEventListener('install', (event) => {
  self.skipWaiting()
})
