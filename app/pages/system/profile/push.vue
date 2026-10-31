<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

definePageMeta({
  alias: ['/profile/push', '/system/notifications', '/settings/notifications']
})

const { t } = useI18n()
const {
  isSupported: pushSupported,
  isSubscribed: pushSubscribed,
  permission: pushPermission,
  isLoading: pushLoading,
  checkSupport,
  requestPermission,
  registerDevice,
  unregisterDevice,
  checkSubscription
} = useWebPush()

onMounted(async () => {
  checkSupport()
  await checkSubscription()
})

const isPushConfirmOpen = ref(false)
const pushAction = ref<'enable' | 'disable'>('enable')

const requestPushToggle = (action: 'enable' | 'disable') => {
  pushAction.value = action
  isPushConfirmOpen.value = true
}

const onPushSwitch = (value: boolean) => {
  requestPushToggle(value ? 'enable' : 'disable')
}

const confirmPush = async () => {
  isPushConfirmOpen.value = false
  if (pushAction.value === 'enable') {
    if (!pushSupported.value) return
    if (pushPermission.value !== 'granted') {
      const result = await requestPermission()
      if (result !== 'granted') return
    }
    await registerDevice('desktop')
  } else {
    await unregisterDevice()
  }
  await checkSubscription()
}

const navItems = computed<NavigationMenuItem[]>(() => [
  { label: t('profile.info'), icon: 'i-lucide-user', to: '/system/profile' },
  { label: t('profile.security'), icon: 'i-lucide-shield', to: '/system/profile/security' },
  { label: t('profile.sessions'), icon: 'i-lucide-monitor-smartphone', to: '/system/profile/sessions' },
  { label: t('notifications.pushTitle'), icon: 'i-lucide-radio-tower', to: '/system/profile/push' }
])

useHead({ title: computed(() => t('notifications.pushTitle')) })
</script>

<template>
  <BasePage id="profile" :title="t('notifications.pushTitle')" :description="t('notifications.pushDesc')">
    <BaseSectionNav :items="navItems">
      <UCard>
        <div class="flex items-center justify-between gap-4 rounded-xl border border-default bg-elevated/50 p-4">
          <div class="flex items-center gap-3 min-w-0">
            <span
              class="inline-flex shrink-0 items-center justify-center rounded-lg p-2.5"
              :class="pushSubscribed ? 'bg-success/10 text-success' : 'bg-muted text-muted'"
            >
              <UIcon :name="pushSubscribed ? 'i-lucide-bell-ring' : 'i-lucide-bell-off'" class="size-5" />
            </span>
            <div class="min-w-0">
              <p class="text-sm font-medium text-highlighted">
                {{ pushSubscribed ? t('common.subscribed') : t('common.unsubscribed') }}
              </p>
              <p v-if="!pushSupported" class="text-xs text-warning mt-0.5">
                {{ t('notifications.pushUnsupported') }}
              </p>
            </div>
          </div>
          <USwitch
            :model-value="pushSubscribed"
            :loading="pushLoading"
            :disabled="!pushSupported"
            size="lg"
            :aria-label="t('notifications.pushTitle')"
            @update:model-value="onPushSwitch"
          />
        </div>
      </UCard>
    </BaseSectionNav>

    <BaseConfirmModal
      v-model:open="isPushConfirmOpen"
      :title="pushAction === 'enable' ? t('notifications.enablePushTitle') : t('notifications.disablePushTitle')"
      :description="pushAction === 'enable' ? t('notifications.enablePushDesc') : t('notifications.disablePushDesc')"
      :confirm-label="pushAction === 'enable' ? t('notifications.enablePush') : t('notifications.disablePush')"
      :cancel-label="t('common.cancel')"
      :color="pushAction === 'enable' ? 'primary' : 'warning'"
      :icon="pushAction === 'enable' ? 'i-lucide-bell-ring' : 'i-lucide-bell-off'"
      :loading="pushLoading"
      @confirm="confirmPush"
    />
  </BasePage>
</template>
