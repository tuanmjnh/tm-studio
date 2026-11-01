import { HUB_DOCS_CONTENT } from '#shared/docs/content'
import userGuideMarkdown from '../../../docs/user-guide.md?raw'
import type { DocsArticle } from '~/types/docs'

/**
 * Shipped documentation that must render even when tm-hub is unreachable.
 * Hub rows with the same `key` replace these entries, so an admin can update
 * the guide from Administration → Content & Docs without shipping a build.
 */
export function bundledDocsArticles(t: (key: string) => string): DocsArticle[] {
  return [
    {
      id: 'bundled:user-guide',
      key: 'user-guide',
      title: t('docs.bundled.guideTitle'),
      description: t('docs.bundled.guideDesc'),
      category: 'guide',
      contentType: 'markdown',
      data: userGuideMarkdown,
      source: 'bundled'
    },
    {
      id: 'bundled:system_docs',
      key: 'system_docs',
      title: t('docs.bundled.referenceTitle'),
      description: t('docs.bundled.referenceDesc'),
      category: 'docs',
      contentType: 'json',
      data: HUB_DOCS_CONTENT,
      source: 'bundled'
    }
  ]
}
