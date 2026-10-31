import { INDUSTRY_CATALOG } from '@tmcut-core'

/**
 * Industry labels for the template library. The catalog (ids, English
 * labels, icons) lives in @tmcut-core; translated labels live in i18n under
 * `tmcut.templateLibrary.industries.<id>` and fall back to the catalog label
 * when a locale has not caught up yet.
 */
export function useTmcutIndustries() {
  const { t, te } = useI18n()

  function industryLabel(id?: string): string {
    if (!id) return ''
    const key = `tmcut.templateLibrary.industries.${id}`
    if (te(key)) return t(key)
    return INDUSTRY_CATALOG.find(meta => meta.id === id)?.label || id
  }

  function industryIcon(id?: string): string {
    return INDUSTRY_CATALOG.find(meta => meta.id === id)?.icon || 'i-lucide-tag'
  }

  return { industries: INDUSTRY_CATALOG, industryLabel, industryIcon }
}
