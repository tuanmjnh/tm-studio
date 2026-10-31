<script setup lang="ts">
import { formatTimeAgo } from '@vueuse/core'

const { t } = useI18n()
const { isNotificationsSlideoverOpen } = useDashboard()
const { notify, unreadCount, markAsRead, markAllAsRead } = useNotify()

const onNotificationClick = (notificationId: string) => {
  markAsRead(notificationId)
  isNotificationsSlideoverOpen.value = false
}

const onMarkAll = async () => {
  await markAllAsRead()
}

const getAvatarSrc = (sender?: { avatar?: string | { src: string } } | null): string => {
  if (!sender) return 'https://api.dicebear.com/7.x/bottts/svg'
  if (typeof sender.avatar === 'string') return sender.avatar
  if (sender.avatar && typeof sender.avatar === 'object') return sender.avatar.src || 'https://api.dicebear.com/7.x/bottts/svg'
  return 'https://api.dicebear.com/7.x/bottts/svg'
}
</script>

<template>
  <USlideover v-model:open="isNotificationsSlideoverOpen" :title="t('home.notifications')">
    <template #body>
      <div class="space-y-4 h-full flex flex-col">
        <!-- Actions header -->
        <div class="flex items-center justify-between pb-2 border-b border-default">
          <span class="text-xs text-muted font-medium">
            {{ unreadCount }} {{ t('common.unread') || 'unread' }}
          </span>
          <UButton
            v-if="unreadCount > 0"
            color="primary"
            variant="link"
            size="xs"
            icon="i-lucide-check-check"
            label="Mark all as read"
            @click="onMarkAll"
          />
        </div>

        <!-- Notification List -->
        <div class="flex-1 overflow-y-auto space-y-3 custom-scrollbar">
          <div v-if="notify.length === 0" class="flex flex-col items-center justify-center py-12 text-center text-dimmed space-y-2">
            <UIcon name="i-lucide-bell-off" class="size-8 text-muted/60" />
            <p class="text-sm">
              {{ t('common.no_notifications') || 'No notifications yet' }}
            </p>
          </div>

          <NuxtLink
            v-for="notification in notify"
            v-slot="{ href, navigate }"
            :key="notification.id"
            :to="`/inbox?id=${notification.id}`"
            custom
          >
            <a
              :href="href || undefined"
              class="p-3 rounded-lg hover:bg-elevated/50 flex items-start gap-3 relative border border-default transition-colors duration-150"
              @click="e => { e.preventDefault(); onNotificationClick(notification.id); navigate(e); }"
            >
              <UChip color="error" :show="notification.unread" inset>
                <UAvatar
                  :src="getAvatarSrc(notification.sender)"
                  :alt="notification.sender?.name || 'System'"
                  size="md"
                />
              </UChip>
              <div class="text-sm flex-1 min-w-0">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-highlighted font-semibold truncate">{{ notification.sender?.name || 'System' }}</span>
                  <time :datetime="notification.date" class="text-muted text-xs shrink-0" v-text="formatTimeAgo(new Date(notification.date))" />
                </div>
                <p class="text-dimmed mt-0.5 line-clamp-2 text-xs leading-relaxed">{{ notification.body }}</p>
              </div>
            </a>
          </NuxtLink>
        </div>
      </div>
    </template>
  </USlideover>
</template>
