export const PAGE_SIZE = {
  admin: 50,
  lookup: 100,
  default: 30,
  compact: 20,
  sessions: 12,
  mediaLibrary: 32,
  users: 10,
  exportPreview: 10
} as const

export const POLLING = {
  uiResetMs: 1500,
  oauth: {
    intervalMs: 1500,
    maxAttempts: 120
  },
  debounceMs: {
    search: 500,
    path: 800,
    url: 300,
    link: 200
  }
} as const
