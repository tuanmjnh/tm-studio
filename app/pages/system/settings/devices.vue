<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { HubDeviceView } from '#shared/types/device'
import type { DeviceStatus } from '#shared/types/electron'
import { browserDeviceInfo } from '~/shared/utils/deviceIdentity'
import { hubAuthBridge } from '~/utils/tmcut/hostBridge'
import { getErrorMessage } from '~/shared/utils/errors'
import { formatDate } from '~/shared/utils/helper'

const { t } = useI18n()
const notify = useNotify()
const { hubFetch } = useHub()
const runtimeConfig = useRuntimeConfig()

const devices = ref<HubDeviceView[]>([])
const loading = ref(true)
const busyId = ref('')
const currentDeviceId = ref('')

// The credential this install holds locally. Distinct from the Hub registry
// list below: the registry is the server's view, this is what this machine
// would present on its next call.
const credential = ref<DeviceStatus | null>(null)
const forgetting = ref(false)
const forgetOpen = ref(false)

async function loadCredential() {
  const broker = hubAuthBridge()
  if (!broker?.credentialStatus) {
    credential.value = null
    return
  }
  try {
    credential.value = await broker.credentialStatus()
  } catch {
    credential.value = null
  }
}

// The current identity comes from the source that authenticated this session:
// Main in Electron, the localStorage UUID on the web.
async function resolveCurrentDeviceId(): Promise<string> {
  const broker = hubAuthBridge()
  if (broker) {
    const info = await broker.info()
    return info?.deviceId || ''
  }
  return import.meta.client ? browserDeviceInfo().deviceId : ''
}

async function load() {
  loading.value = true
  try {
    currentDeviceId.value = await resolveCurrentDeviceId()
    await loadCredential()
    const res = await hubFetch<{ success: boolean, data: HubDeviceView[] }>('/api/v1/auth/user-devices', {
      query: currentDeviceId.value ? { currentDeviceId: currentDeviceId.value } : undefined
    })
    devices.value = res.data || []
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    loading.value = false
  }
}

onMounted(load)

/**
 * The stored credential belongs to one Hub. When this build points somewhere
 * else, the credential is kept but never sent: the fix is to sign in against
 * the current Hub, not to debug a session that was never valid here.
 */
const credentialHubOrigin = computed(() => String(credential.value?.hubOrigin || ''))
const credentialForeign = computed(() => {
  if (!credential.value?.enrolled || !credentialHubOrigin.value) return false
  return normalizeHubUrl(credentialHubOrigin.value) !== normalizeHubUrl(credential.value.hubUrl || String(runtimeConfig.public.hubUrl || ''))
})

/**
 * A credential enrolled before origins were recorded cannot be proven to belong
 * to any Hub, so the server refuses to send it. It is not deleted — signing in
 * again binds it to the Hub this build points at.
 */
const credentialUnbound = computed(() => Boolean(credential.value?.enrolled) && !credentialHubOrigin.value)

function normalizeHubUrl(value: string): string {
  return String(value || '').trim().replace(/\/+$/, '').toLowerCase()
}

/**
 * Forget the local copy only. Anyone signed in on this device may do it; the
 * Hub record is untouched, because revoking it is a root action on the Hub.
 */
async function forgetLocalCredential() {
  const broker = hubAuthBridge()
  if (!broker?.forgetCredential || forgetting.value) return
  forgetting.value = true
  try {
    const result = await broker.forgetCredential()
    if (!result.success) {
      notify.error(t('devices.forgetFailed'), '')
      return
    }
    forgetOpen.value = false
    await loadCredential()
    notify.success(t('devices.forgotten'), '')
  } catch (err) {
    notify.error(t('devices.forgetFailed'), err instanceof Error ? err.message : '')
  } finally {
    forgetting.value = false
  }
}

const isRenameOpen = ref(false)
const renameTarget = ref<HubDeviceView | null>(null)
const renameValue = ref('')
const renaming = ref(false)

function openRename(device: HubDeviceView) {
  renameTarget.value = device
  renameValue.value = device.deviceName || ''
  isRenameOpen.value = true
}

async function confirmRename() {
  if (!renameTarget.value) return
  const name = renameValue.value.trim()
  if (!name) return
  renaming.value = true
  try {
    await hubFetch(`/api/v1/auth/user-devices/${encodeURIComponent(renameTarget.value.deviceId)}`, {
      method: 'PATCH',
      body: { deviceName: name }
    })
    renameTarget.value.deviceName = name
    notify.success(t('devices.renamedToast'))
    isRenameOpen.value = false
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    renaming.value = false
  }
}

const isRevokeOpen = ref(false)
const revokeTarget = ref<HubDeviceView | null>(null)
const revoking = ref(false)

function openRevoke(device: HubDeviceView) {
  revokeTarget.value = device
  isRevokeOpen.value = true
}

async function confirmRevoke() {
  if (!revokeTarget.value) return
  const target = revokeTarget.value
  revoking.value = true
  try {
    await hubFetch(`/api/v1/auth/user-devices/${encodeURIComponent(target.deviceId)}`, { method: 'DELETE' })
    devices.value = devices.value.filter(d => d.id !== target.id)
    isRevokeOpen.value = false
    notify.success(t('devices.revokedToast'))

    // Revoking this device kills its sessions too, so a current-device revoke
    // cannot leave a live workspace behind.
    if (target.isCurrent) {
      const auth = useAuth()
      await auth.logout({ redirect: false })
      await navigateTo('/login')
    }
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    revoking.value = false
  }
}

const statusColor = (status: HubDeviceView['status']) => {
  if (status === 'active') return 'success' as const
  if (status === 'pending') return 'warning' as const
  if (status === 'blocked') return 'error' as const
  return 'neutral' as const
}

const deviceActions = (device: HubDeviceView): DropdownMenuItem[] => [
  {
    label: t('devices.rename'),
    icon: 'i-lucide-pencil',
    onSelect: () => openRename(device)
  },
  {
    label: t('devices.forget'),
    icon: 'i-lucide-unplug',
    color: 'error' as const,
    onSelect: () => openRevoke(device)
  }
]

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: () => load() }
]))
mobileBar.registerInfo(computed(() => ({ count: devices.value.length, loading: loading.value })))

useHead({ title: computed(() => t('devices.myTitle')) })

const describe = (device: HubDeviceView): string =>
  [device.osPlatform, device.arch, device.appVersion].filter(Boolean).join(' · ')
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-xs text-muted">
        {{ t('devices.myDescription') }}
      </p>
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="soft"
        size="sm"
        square
        :loading="loading"
        :aria-label="t('common.refresh')"
        @click="load"
      />
    </div>

    <UCard v-if="credential?.enrolled" class="mb-24 lg:mb-0">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-laptop-minimal-check" class="size-4 text-primary" />
          <h3 class="text-sm font-semibold">
            {{ t('devices.localTitle') }}
          </h3>
        </div>
      </template>

      <div class="space-y-4">
        <p class="text-xs text-muted">
          {{ t('devices.localDescription') }}
        </p>

        <dl class="grid gap-3 sm:grid-cols-3">
          <div class="panel-flat rounded-lg p-3">
            <dt class="text-xs text-muted">
              {{ t('devices.deviceId') }}
            </dt>
            <dd class="mt-1 truncate font-mono text-xs text-highlighted" :title="credential.deviceId">
              {{ credential.deviceId.slice(0, 24) }}
            </dd>
          </div>
          <div class="panel-flat rounded-lg p-3">
            <dt class="text-xs text-muted">
              {{ t('devices.scopes') }}
            </dt>
            <dd class="mt-1 truncate text-sm font-semibold text-highlighted">
              {{ credential.scopes.join(', ') || '—' }}
            </dd>
          </div>
          <div class="panel-flat rounded-lg p-3">
            <dt class="text-xs text-muted">
              {{ t('devices.expires') }}
            </dt>
            <dd class="mt-1 text-sm font-semibold text-highlighted">
              {{ credential.expiresAt ? formatDate(credential.expiresAt) : '—' }}
            </dd>
          </div>
        </dl>

        <UAlert
          v-if="credentialForeign"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="t('devices.credentialWrongHub')"
          :description="`${t('devices.credentialWrongHubDesc')} ${credentialHubOrigin}`"
        >
          <template #actions>
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-log-in"
              :label="t('devices.reEnroll')"
              to="/login"
            />
          </template>
        </UAlert>

        <UAlert
          v-else-if="credentialUnbound"
          color="info"
          variant="subtle"
          icon="i-lucide-info"
          :title="t('devices.credentialUnbound')"
          :description="t('devices.credentialUnboundDesc')"
        >
          <template #actions>
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-log-in"
              :label="t('devices.reEnroll')"
              to="/login"
            />
          </template>
        </UAlert>
      </div>

      <template #footer>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="text-xs text-muted">
            {{ t('devices.localHint') }}
          </p>
          <UButton
            color="error"
            variant="soft"
            icon="i-lucide-unplug"
            :label="t('devices.forgetLocal')"
            @click="forgetOpen = true"
          />
        </div>
      </template>
    </UCard>

    <UCard class="mb-24 lg:mb-0">
      <div v-if="loading && devices.length === 0" class="space-y-3">
        <USkeleton v-for="i in 3" :key="i" class="h-16 w-full rounded-lg" />
      </div>

      <UEmpty
        v-else-if="devices.length === 0"
        icon="i-lucide-laptop-minimal"
        size="sm"
        :title="t('devices.myEmpty')"
      />

      <ul v-else class="divide-y divide-default">
        <li v-for="device in devices" :key="device.id" class="flex items-start gap-3 py-3.5 first:pt-0 last:pb-0">
          <span
            class="inline-flex shrink-0 items-center justify-center rounded-lg p-2"
            :class="device.isCurrent ? 'bg-primary/10 text-primary' : 'bg-elevated text-muted'"
          >
            <UIcon
              :name="device.deviceType === 'desktop' ? 'i-lucide-monitor' : 'i-lucide-smartphone'"
              class="size-5"
            />
          </span>

          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="truncate text-sm font-medium text-highlighted">
                {{ device.deviceName || device.deviceId.slice(0, 12) }}
              </span>
              <UBadge
                v-if="device.isCurrent"
                :label="t('devices.current')"
                color="primary"
                variant="subtle"
                size="xs"
              />
              <UBadge
                :label="t(`devices.status.${device.status}`)"
                :color="statusColor(device.status)"
                variant="subtle"
                size="xs"
              />
            </div>
            <p v-if="describe(device)" class="truncate text-xs text-muted">
              {{ describe(device) }}
            </p>
            <p class="truncate font-mono text-[11px] text-dimmed" :title="device.deviceId">
              {{ device.deviceId.slice(0, 24) }} ·
              {{ t('devices.lastSeen') }} {{ formatDate(device.lastSeenAt) }}
              <template v-if="device.lastIp">
                · {{ device.lastIp }}
              </template>
            </p>
          </div>

          <UDropdownMenu :items="deviceActions(device)" :content="{ align: 'end' }">
            <UButton
              icon="i-lucide-ellipsis-vertical"
              color="neutral"
              variant="ghost"
              size="xs"
              :disabled="busyId === device.id"
              :aria-label="t('common.actions')"
            />
          </UDropdownMenu>
        </li>
      </ul>
    </UCard>

    <UModal v-model:open="isRenameOpen" :title="t('devices.renameTitle')">
      <template #body>
        <UFormField :label="t('devices.name')">
          <UInput v-model="renameValue" :maxlength="120" autofocus />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :label="t('common.cancel')"
            @click="isRenameOpen = false"
          />
          <UButton
            :label="t('common.save')"
            :loading="renaming"
            :disabled="!renameValue.trim()"
            @click="confirmRename"
          />
        </div>
      </template>
    </UModal>

    <BaseConfirmModal
      v-model:open="isRevokeOpen"
      :title="t('devices.revokeTitle')"
      :description="t('devices.revokeDesc')"
      :confirm-label="t('devices.forget')"
      :cancel-label="t('common.cancel')"
      color="error"
      icon="i-lucide-unplug"
      :loading="revoking"
      @confirm="confirmRevoke"
    />

    <BaseConfirmModal
      v-model:open="forgetOpen"
      :title="t('devices.forgetLocalTitle')"
      :description="t('devices.forgetLocalDesc')"
      :confirm-label="t('devices.forgetLocal')"
      :cancel-label="t('common.cancel')"
      color="error"
      icon="i-lucide-unplug"
      :loading="forgetting"
      @confirm="forgetLocalCredential"
    />
  </div>
</template>
