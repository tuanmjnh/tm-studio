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

  // Creative tools open dark first; the toggle still lets users choose light.
  colorMode: {
    preference: 'dark',
    fallback: 'dark'
  },
  spaLoadingTemplate: 'spa-loading-template.html',

  runtimeConfig: {
    // Private server-only: app secret for the server-to-server TM Hub AI relay.
    // Declared EMPTY on purpose. Nuxt serializes whatever it sees here at build
    // time into the server bundle, and that bundle ships inside the installer —
    // reading `process.env.NUXT_HUB_APP_SECRET` here baked the literal secret
    // into `.output/server/chunks/_/nitro.mjs`. The relay routes read the
    // environment per request instead (`server/utils/hubAppSecret.ts`).
    hubAppSecret: '',
    public: {
      hubUrl: process.env.NUXT_PUBLIC_HUB_URL || 'http://localhost:4000',
      hubAppId: process.env.NUXT_PUBLIC_HUB_APP_ID || 'tm-studio_749app'
    }
  },

  alias: {
    'tmcut-core': fileURLToPath(new URL('./packages/core/src/index.mjs', import.meta.url))
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
    server: {
      fs: {
        // packages/core is a workspace package consumed via source alias;
        // allow Vite dev to serve it directly.
        allow: [fileURLToPath(new URL('./packages/core', import.meta.url))]
      }
    },
    optimizeDeps: {
      include: [
        'tm-hub-client',
        'zod'
      ]
    },
    resolve: {
      alias: {
        'tmcut-core': fileURLToPath(new URL('./packages/core/src/index.mjs', import.meta.url)),
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

  // Include TypeScript icon maps so local controls do not depend on runtime API requests.
  icon: {
    clientBundle: {
      scan: {
        globInclude: ['app/**/*.{vue,ts,jsx,tsx,md,json}', 'shared/**/*.ts']
      }
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
