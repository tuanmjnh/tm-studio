export default defineNuxtPlugin(() => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/push-sw.js')
      .catch((error) => {
        console.error('Service Worker registration failed:', error)
      })
  }
})
