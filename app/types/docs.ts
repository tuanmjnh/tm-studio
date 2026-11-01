export type DocsContentType = 'json' | 'markdown' | 'html' | 'text'

export type DocsCategory = 'docs' | 'guide' | 'custom'

export interface DocsArticle {
  /** Stable key: hub row id when managed, `bundled:<key>` for shipped fallbacks. */
  id: string
  key: string
  title: string
  description?: string
  category: DocsCategory
  contentType: DocsContentType
  data: unknown
  version?: number
  updatedAt?: string
  source: 'hub' | 'bundled'
}

/** Row shape of tm-hub `app_contents` as returned by GET /api/v1/content. */
export interface HubContentRow {
  _id?: string
  appId: string
  key: string
  title: string
  description?: string
  category: string
  contentType: DocsContentType
  data: unknown
  version?: number
  isPublished?: boolean
  updatedAt?: string
}
