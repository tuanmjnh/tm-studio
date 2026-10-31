<script setup lang="ts">
const { t } = useI18n()
const { clearLocalStorage, clearSessionStorage, clearCookies, clearPwaData, clearAllStorage, clearSiteData } = useSystemStorage()

const isOpen = defineModel<boolean>('open', { default: false })

const confirmModal = reactive({
  isOpen: false,
  loading: false,
  title: '',
  description: '',
  type: 'local' as 'local' | 'session' | 'cookies' | 'pwa' | 'all' | 'site',
  onConfirm: () => { }
})

const openConfirm = (type: 'local' | 'session' | 'cookies' | 'pwa' | 'all' | 'site') => {
  const mapping = {
    local: 'clear_local_storage',
    session: 'clear_session_storage',
    cookies: 'clear_cookies',
    pwa: 'clear_pwa_data',
    all: 'clear_all',
    site: 'clear_site_data'
  }

  const i18nKey = mapping[type]
  confirmModal.type = type
  confirmModal.title = t(`settings.storage.${i18nKey}_title`)
  confirmModal.description = t(`settings.storage.${i18nKey}_desc`)

  confirmModal.onConfirm = async () => {
    if (confirmModal.loading) return
    confirmModal.loading = true
    try {
      switch (type) {
        case 'local': clearLocalStorage(); break
        case 'session': clearSessionStorage(); break
        case 'cookies': clearCookies(); break
        case 'pwa': await clearPwaData(); break
        case 'all': await clearAllStorage(); break
        case 'site': await clearSiteData(); break
      }
      confirmModal.isOpen = false
    } finally {
      confirmModal.loading = false
    }
  }
  confirmModal.isOpen = true
}
</script>

<template>
  <BaseResponsiveModal
    v-model:open="isOpen"
    :title="$t('settings.storage.storage_management')"
    :description="$t('settings.storage.storage_management_desc')"
  >
    <template #body>
      <div class="grid grid-cols-1 gap-2">
        <UButton
          icon="i-lucide-database"
          variant="outline"
          color="neutral"
          block
          class="justify-start text-xs rounded-xl py-5"
          :label="$t('settings.storage.clear_local_storage')"
          @click="openConfirm('local')"
        />
        <UButton
          icon="i-lucide-clock"
          variant="outline"
          color="neutral"
          block
          class="justify-start text-xs rounded-xl py-5"
          :label="$t('settings.storage.clear_session_storage')"
          @click="openConfirm('session')"
        />
        <UButton
          icon="i-lucide-cookie"
          variant="outline"
          color="neutral"
          block
          class="justify-start text-xs rounded-xl py-5"
          :label="$t('settings.storage.clear_cookies')"
          @click="openConfirm('cookies')"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="outline"
          color="neutral"
          block
          class="justify-start text-xs rounded-xl py-5"
          :label="$t('settings.storage.clear_pwa_data')"
          @click="openConfirm('pwa')"
        />
        <UButton
          icon="i-lucide-layers"
          variant="outline"
          color="neutral"
          block
          class="justify-start text-xs rounded-xl py-5"
          :label="$t('settings.storage.clear_site_data')"
          @click="openConfirm('site')"
        />
      </div>

      <LazyBaseConfirmModal
        v-model:open="confirmModal.isOpen"
        :title="confirmModal.title"
        :description="confirmModal.description"
        :cancel-label="$t('global.cancel')"
        :color="confirmModal.type === 'all' ? 'error' : 'warning'"
        :confirm-label="$t('global.confirm')"
        :loading="confirmModal.loading"
        @confirm="confirmModal.onConfirm"
      />
    </template>
    <template #footer>
      <UButton
        icon="i-lucide-trash-2"
        color="error"
        variant="soft"
        block
        class="justify-start text-xs rounded-xl py-2"
        :label="$t('settings.storage.clear_all')"
        @click="openConfirm('all')"
      />
    </template>
  </BaseResponsiveModal>
</template>
