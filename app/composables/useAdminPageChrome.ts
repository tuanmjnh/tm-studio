export function useAdminPageChrome(options: {
  titleKey: string
  descKey?: string
  params?: Record<string, unknown>
}) {
  const { t } = useI18n()

  const title = computed(() => (options.params ? t(options.titleKey, options.params) : t(options.titleKey)))
  const description = computed(() =>
    options.descKey ? (options.params ? t(options.descKey, options.params) : t(options.descKey)) : undefined
  )

  /** Current status label: active unless explicitly false. */
  const statusLabel = (active: boolean | null | undefined) =>
    active === false ? t('common.inactive') : t('common.active')

  /** Target status label for toggle actions (shows what clicking will set). */
  const toggleStatusLabel = (active: boolean | null | undefined) =>
    active === false ? t('common.active') : t('common.inactive')

  return { title, description, statusLabel, toggleStatusLabel }
}
