<script setup lang="ts">
const { t } = useI18n()
const auth = useAuth()
const { isNotificationsSlideoverOpen } = useDashboard()
const { unreadCount } = useNotify()
</script>

<template>
  <UChip
    :text="unreadCount > 99 ? '99+' : String(unreadCount)"
    :show="unreadCount > 0"
    size="2xl"
    color="error"
    :ui="{ base: 'text-[9px] text-white font-medium w-[12px] h-[12px] p-1.5' }"
  >
    <UButton
      v-if="auth.isAuthenticated.value"
      icon="i-lucide-bell"
      color="neutral"
      variant="ghost"
      square
      :aria-label="t('home.notifications')"
      :ui="{ leadingIcon: 'text-dimmed' }"
      @click="isNotificationsSlideoverOpen = !isNotificationsSlideoverOpen"
    />
  </UChip>
</template>
