import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({

  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@vueuse/nuxt',
    '@nuxtjs/i18n',
    '@nuxt/image',
    '@pinia/nuxt'
  ],
  ssr: false,
  imports: {
    dirs: [
      'shared/utils'
    ]
  },

  devtools: {
    enabled: false
  },

  app: {
    head: {
      charset: 'utf-8',
      viewport: 'width=device-width, initial-scale=1',
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
        { rel: 'manifest', href: '/manifest.webmanifest' }
      ]
    }
  },

  css: ['~/assets/css/main.css'],
  spaLoadingTemplate: 'spa-loading-template.html',

  // Include TypeScript icon maps so local controls do not depend on runtime API requests.
  icon: {
    clientBundle: {
      scan: {
        globInclude: ['app/**/*.{vue,ts,jsx,tsx,md,json}', 'shared/**/*.ts']
      }
    }
  },

  runtimeConfig: {
    // Private server-only: app secret for the server-to-server TM Hub AI relay.
    // The browser web runtime never holds it - it calls the local Nitro proxy
    // (/api/v1/ai/relay/*) which proves itself to the hub.
    hubAppSecret: process.env.NUXT_HUB_APP_SECRET || '',
    public: {
      hubUrl: process.env.NUXT_PUBLIC_HUB_URL || 'http://localhost:4000',
      hubAppId: process.env.NUXT_PUBLIC_HUB_APP_ID || 'tm-studio'
    }
  },

  build: {
    transpile: [
      'firebase',
      'firebase/app',
      'shiki',
      '@shikijs/core',
      'sortablejs'
    ]
  },

  routeRules: {
    '/api/**': {
      cors: true
    }
  },

  compatibilityDate: '2026-06-30',

  vite: {
    optimizeDeps: {
      include: [
        'tm-hub-client',
        'zod'
      ]
    },
    resolve: {
      alias: {
        'striptags': 'striptags/src/striptags.js'
      },
      dedupe: [
        'vue'
      ]
    }
  },

  typescript: {
    typeCheck: true,
    strict: true
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  },

  i18n: {
    locales: [
      { code: 'en', language: 'en', name: 'English', file: 'en.json' },
      { code: 'vi', language: 'vi', name: 'Tiếng Việt', file: 'vi.json' }
    ],
    defaultLocale: 'vi',
    strategy: 'no_prefix',
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'i18n_locale',
      redirectOn: 'root'
    }
  },

  image: {
    domains: [
      'res.cloudinary.com',
      'images.unsplash.com',
      'plus.unsplash.com',
      'loremflickr.com',
      'api.dicebear.com',
      'images.pexels.com',
      'cdn.pixabay.com',
      'cdn.stocksnap.io',
      'elements.envato.com'
    ],
    alias: {
      cloudinary: 'https://res.cloudinary.com',
      unsplashPlus: 'https://plus.unsplash.com',
      unsplashImages: 'https://images.unsplash.com',
      loremflickr: 'https://loremflickr.com',
      dicebear: 'https://api.dicebear.com',
      pexels: 'https://images.pexels.com',
      pixabay: 'https://cdn.pixabay.com',
      stocksnap: 'https://cdn.stocksnap.io',
      envato: 'https://elements.envato.com'
    }
  }
})
