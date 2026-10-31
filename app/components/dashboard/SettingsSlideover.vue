<script setup lang="ts">
const { locale, setLocale: setI18nLocale, t } = useI18n()
const { isSettingsSlideoverOpen } = useDashboard()
const router = useRouter()

const isStorageModalOpen = ref(false)

// R144: Electron-only nav (the vault page needs safeStorage/IPC). Set
// after mount, never during SSR — a true-at-render flag here would
// hydrate differently on server vs desktop and warn.
const isElectron = ref(false)
onMounted(() => {
  isElectron.value = !!window.electronAPI?.isElectron
})

const locales: Array<{ code: 'en' | 'vi', name: string, language: string, dir: 'ltr' | 'rtl', messages: Record<string, unknown> }> = [
  { code: 'en', name: t('common.english'), language: 'English', dir: 'ltr', messages: {} },
  { code: 'vi', name: t('common.vietnamese'), language: 'Tiếng Việt', dir: 'ltr', messages: {} }
]

const uiLocale = computed({
  get: () => locale.value,
  set: (val: unknown) => {
    const code = (val && typeof val === 'object') ? ((val as { code?: string, value?: string }).code || (val as { code?: string, value?: string }).value) : val
    if (code === 'en' || code === 'vi') {
      setI18nLocale(code)
    }
  }
})

function navigateAndClose(to: string) {
  isSettingsSlideoverOpen.value = false
  router.push(to)
}
</script>

<template>
  <BaseResponsiveSlideover
    v-model:open="isSettingsSlideoverOpen"
    :title="$t('settings.title')"
    :description="$t('settings.slideoverDesc')"
    icon="i-lucide-settings"
    side="right"
  >
    <template #body>
      <div class="space-y-6">
        <!-- Editor Type -->
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <div class="text-sm font-medium text-highlighted">
              {{ $t('settings.editorType') }}
            </div>
            <LazySharedEditorTypeSwitch />
          </div>
        </div>

        <!-- Language -->
        <div class="space-y-3">
          <div class="text-sm font-medium text-highlighted">
            {{ $t('settings.language') }}
          </div>
          <ULocaleSelect v-model="uiLocale" :locales="locales" class="w-full" />
        </div>

        <!-- Desktop Environment & Runtime Links -->
        <div class="space-y-3">
          <div class="text-sm font-medium text-highlighted">
            {{ $t('settings.appSettings') }}
          </div>
          <div class="space-y-2">
            <UButton
              icon="i-lucide-globe"
              variant="outline"
              color="neutral"
              block
              class="justify-start text-xs rounded-xl"
              @click="navigateAndClose('/system/browsers')"
            >
              {{ $t('settings.openBrowserSettings') }}
            </UButton>
            <UButton
              icon="i-lucide-wrench"
              variant="outline"
              color="neutral"
              block
              class="justify-start text-xs rounded-xl"
              @click="navigateAndClose('/system/tools')"
            >
              {{ $t('settings.openToolsSettings') }}
            </UButton>
            <!-- R144: the vault page is Electron-only (safeStorage/IPC) —
                 the link appears exactly where the page works (honesty
                 rule: never promise a desktop-only page to web users). -->
            <UButton
              v-if="isElectron"
              icon="i-lucide-key"
              variant="outline"
              color="neutral"
              block
              class="justify-start text-xs rounded-xl"
              @click="navigateAndClose('/system/ai-keys')"
            >
              {{ $t('settings.openAiKeyVault') }}
            </UButton>
          </div>
        </div>

        <!-- Storage Management -->
        <div class="space-y-3">
          <div class="text-sm font-medium text-highlighted">
            {{ $t('settings.storage.storage_management') }}
          </div>
          <UButton
            icon="i-lucide-database"
            variant="outline"
            color="neutral"
            block
            class="justify-start text-xs rounded-xl"
            @click="isStorageModalOpen = true"
          >
            {{ $t('settings.storage.storage_management') }}
          </UButton>
        </div>

        <!-- Full Settings Link -->
        <div class="pt-2 border-t border-gray-200 dark:border-gray-800">
          <UButton
            icon="i-lucide-external-link"
            variant="subtle"
            color="primary"
            block
            class="justify-start text-xs rounded-xl"
            @click="navigateAndClose('/system')"
          >
            {{ $t('settings.openFullSettings') }}
          </UButton>
        </div>
      </div>

      <LazyDashboardStorageSettingsModal v-model:open="isStorageModalOpen" />
    </template>
  </BaseResponsiveSlideover>
</template>
