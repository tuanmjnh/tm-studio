<script setup lang="ts">
import type { DropdownMenuItem, NavigationMenuItem } from '@nuxt/ui'
import type { UserSession } from '#shared/types/auth'
import { getErrorMessage } from '~/shared/utils/errors'
import { formatDate } from '~/shared/utils/helper'

const { t } = useI18n()
const notify = useNotify()
const { hubFetch } = useHub()

const sessionPager = useCursorPagination<UserSession>({
  limit: 12,
  fetch: async (cursor, limit) => {
    const res = await hubFetch<{ success: boolean, data: UserSession[], nextCursor: string | number | null }>(
      '/api/v1/auth/sessions',
      { query: { limit, cursor: cursor ? String(cursor) : undefined } }
    )
    return {
      items: res.data || [],
      nextCursor: res.nextCursor ?? null,
      hasMore: Boolean(res.nextCursor)
    }
  }
})
const sessions = computed(() => sessionPager.items.value)
const sessionsLoading = computed(() => sessionPager.loading.value)

onMounted(() => sessionPager.refresh())

const isRevokeOpen = ref(false)
const revokeTargetId = ref('')
const isRevokeAllOpen = ref(false)
const revokeLoading = ref(false)

const openRevoke = (id: string) => {
  revokeTargetId.value = id
  isRevokeOpen.value = true
}

const confirmRevoke = async () => {
  if (!revokeTargetId.value) return
  revokeLoading.value = true
  try {
    await hubFetch('/api/v1/auth/sessions', { method: 'DELETE', query: { id: revokeTargetId.value } })
    sessionPager.items.value = sessionPager.items.value.filter(s => s.id !== revokeTargetId.value)
    notify.success(t('profile.sessionRevoked'))
    isRevokeOpen.value = false
    revokeTargetId.value = ''
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    revokeLoading.value = false
  }
}

const confirmRevokeAll = async () => {
  revokeLoading.value = true
  try {
    await hubFetch('/api/v1/auth/sessions', { method: 'DELETE', query: { all: 'true' } })
    isRevokeAllOpen.value = false
    const auth = useAuth()
    await auth.logout()
    await navigateTo('/login')
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
    revokeLoading.value = false
  }
}

const sessionActions = (session: UserSession): DropdownMenuItem[] => [
  {
    label: t('profile.revoke'),
    icon: 'i-lucide-log-out',
    color: 'error' as const,
    disabled: session.isCurrent,
    onSelect: () => openRevoke(session.id)
  }
]

const navItems = computed<NavigationMenuItem[]>(() => [
  { label: t('profile.info'), icon: 'i-lucide-user', to: '/system/profile' },
  { label: t('profile.security'), icon: 'i-lucide-shield', to: '/system/profile/security' },
  { label: t('profile.sessions'), icon: 'i-lucide-monitor-smartphone', to: '/system/profile/sessions' },
  { label: t('notifications.pushTitle'), icon: 'i-lucide-radio-tower', to: '/system/profile/push' }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  ...(sessionPager.hasMore.value
    ? [{
        icon: 'i-lucide-chevron-down',
        label: t('common.loadMore'),
        disabled: sessionsLoading.value,
        onSelect: () => sessionPager.loadMore()
      }]
    : []),
  {
    icon: 'i-lucide-log-out',
    label: t('profile.revokeAll'),
    color: 'error' as const,
    onSelect: () => { isRevokeAllOpen.value = true }
  },
  {
    icon: 'i-lucide-refresh-cw',
    label: t('common.refresh'),
    onSelect: () => sessionPager.refresh()
  }
]))
mobileBar.registerInfo(computed(() => ({
  count: sessions.value.length,
  hasMore: sessionPager.hasMore.value,
  loading: sessionsLoading.value
})))

useHead({ title: computed(() => t('profile.sessions')) })
</script>

<template>
  <BasePage id="profile" :title="t('profile.sessions')" :description="t('profile.sessionsDesc')">
    <template #right>
      <UButton
        color="error"
        variant="soft"
        size="sm"
        icon="i-lucide-log-out"
        :label="t('profile.revokeAll')"
        :ui="{ label: 'hidden md:block' }"
        @click="isRevokeAllOpen = true"
      />
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="soft"
        size="sm"
        square
        :loading="sessionsLoading"
        :aria-label="t('common.refresh')"
        @click="sessionPager.refresh()"
      />
    </template>

    <template #footer>
      <SharedListFooter :count="sessions.length" :has-more="sessionPager.hasMore.value" :loading="sessionsLoading">
        <template #right>
          <UButton
            v-if="sessionPager.hasMore.value"
            size="xs"
            variant="soft"
            color="neutral"
            icon="i-lucide-chevron-down"
            :label="t('common.loadMore')"
            :loading="sessionsLoading"
            @click="sessionPager.loadMore()"
          />
        </template>
      </SharedListFooter>
    </template>

    <BaseSectionNav :items="navItems">
      <UCard class="mb-24 lg:mb-0">
        <div v-if="sessionsLoading && sessions.length === 0" class="space-y-3">
          <USkeleton v-for="i in 3" :key="i" class="h-14 w-full rounded-lg" />
        </div>

        <UEmpty
          v-else-if="sessions.length === 0"
          icon="i-lucide-monitor-x"
          size="sm"
          :title="t('profile.noSessions')"
        />

        <ul v-else class="divide-y divide-default">
          <li v-for="session in sessions" :key="session.id" class="flex items-center gap-3 py-3.5 first:pt-0 last:pb-0">
            <span
              class="inline-flex shrink-0 items-center justify-center rounded-lg p-2"
              :class="session.isCurrent ? 'bg-primary/10 text-primary' : 'bg-elevated text-muted'"
            >
              <UIcon
                :name="session.platform === 'mobile' ? 'i-lucide-smartphone' : 'i-lucide-monitor'"
                class="size-5"
              />
            </span>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium text-highlighted truncate">
                  {{ session.platform }}
                </span>
                <UBadge
                  v-if="session.isCurrent"
                  :label="t('profile.current')"
                  color="success"
                  variant="subtle"
                  size="xs"
                />
              </div>
              <p class="text-xs text-muted truncate">
                {{ session.userAgent || '—' }}
              </p>
              <p class="text-[11px] text-dimmed font-mono truncate">
                {{ session.lastIp }} · {{ formatDate(session.createdAt) }}
              </p>
            </div>
            <UDropdownMenu :items="sessionActions(session)" :content="{ align: 'end' }">
              <UButton
                icon="i-lucide-ellipsis-vertical"
                color="neutral"
                variant="ghost"
                size="xs"
                :aria-label="t('common.actions')"
              />
            </UDropdownMenu>
          </li>
        </ul>
      </UCard>
    </BaseSectionNav>

    <BaseConfirmModal
      v-model:open="isRevokeOpen"
      :title="t('settings.revokeSessionTitle')"
      :description="t('settings.revokeSessionDesc')"
      :confirm-label="t('profile.revoke')"
      :cancel-label="t('common.cancel')"
      color="error"
      icon="i-lucide-log-out"
      :loading="revokeLoading"
      @confirm="confirmRevoke"
    />

    <BaseConfirmModal
      v-model:open="isRevokeAllOpen"
      :title="t('settings.revokeAllTitle')"
      :description="t('settings.revokeAllDesc')"
      :confirm-label="t('profile.revokeAll')"
      :cancel-label="t('common.cancel')"
      color="error"
      icon="i-lucide-alert-triangle"
      :loading="revokeLoading"
      @confirm="confirmRevokeAll"
    />
  </BasePage>
</template>
