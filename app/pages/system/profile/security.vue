<script setup lang="ts">
import * as z from 'zod'
import type { NavigationMenuItem } from '@nuxt/ui'
import type { PasskeyInfo } from '#shared/types/webauthn'
import { getErrorMessage } from '~/shared/utils/errors'

definePageMeta({
  alias: ['/profile/security', '/system/security', '/settings/security']
})

const { t } = useI18n()
const notify = useNotify()
const { hubFetch, appId } = useHub()
const passkeyApi = usePasskey()

const passwordLoading = ref(false)

const schema = z.object({
  currentPassword: z.string().min(1, t('error.required')),
  newPassword: z.string().min(1, t('error.required')),
  confirmPassword: z.string().min(1, t('error.required'))
})

const passwordForm = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
})

const changePassword = async () => {
  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    notify.error(t('profile.passwordMismatch'))
    return
  }
  passwordLoading.value = true
  try {
    await hubFetch('/api/v1/auth/me/password', {
      method: 'PUT',
      body: { currentPassword: passwordForm.currentPassword, newPassword: passwordForm.newPassword }
    })
    notify.success(t('profile.passwordChanged'))
    Object.assign(passwordForm, { currentPassword: '', newPassword: '', confirmPassword: '' })
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    passwordLoading.value = false
  }
}

interface MeSecurityData {
  userId: string
  totpEnabled?: boolean
  features?: { passkey?: boolean, totp?: boolean }
}

const totpEnabled = ref(false)
const passkeyEnabled = ref(true)
const totpFeatureEnabled = ref(true)
const meLoaded = ref(false)

const loadMe = async () => {
  try {
    const res = await hubFetch<{ success: boolean, data: MeSecurityData }>('/api/v1/auth/me')
    totpEnabled.value = !!res.data?.totpEnabled
    passkeyEnabled.value = res.data?.features?.passkey !== false
    totpFeatureEnabled.value = res.data?.features?.totp !== false
  } catch {
    // keep defaults
  } finally {
    meLoaded.value = true
  }
}

onMounted(loadMe)

const passkeys = ref<PasskeyInfo[]>([])
const passkeyLoading = ref(false)
const passkeyAddLoading = ref(false)
const passkeyDeleteTarget = ref<PasskeyInfo | null>(null)
const passkeyDeleteOpen = ref(false)

const loadPasskeys = async () => {
  if (!passkeyEnabled.value) return
  passkeyLoading.value = true
  try {
    passkeys.value = await passkeyApi.list()
  } catch {
    passkeys.value = []
  } finally {
    passkeyLoading.value = false
  }
}

onMounted(loadPasskeys)

const addPasskey = async () => {
  passkeyAddLoading.value = true
  try {
    await passkeyApi.register()
    notify.success(t('profile.passkeyAdded'))
    await loadPasskeys()
  } catch (err) {
    const name = (err as { name?: string })?.name
    if (name === 'NotAllowedError') notify.error(t('profile.passkeyCancelled'))
    else notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    passkeyAddLoading.value = false
  }
}

const confirmDeletePasskey = async () => {
  if (!passkeyDeleteTarget.value) return
  try {
    await passkeyApi.remove(passkeyDeleteTarget.value.credentialId)
    notify.success(t('profile.passkeyDeleted'))
    passkeys.value = passkeys.value.filter(p => p.id !== passkeyDeleteTarget.value?.id)
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    passkeyDeleteOpen.value = false
    passkeyDeleteTarget.value = null
  }
}

const totpSetupOpen = ref(false)
const totpSetupQr = ref('')
const totpSetupCode = ref('')
const totpSetupLoading = ref(false)
const totpSetupStep = ref<'scan' | 'recovery'>('scan')
const recoveryCodes = ref<string[]>([])

const openTotpSetup = async () => {
  totpSetupLoading.value = true
  try {
    const res = await hubFetch<{ success: boolean, data: { qrDataUrl: string } }>('/api/v1/auth/totp/setup', {
      method: 'POST',
      body: { appId }
    })
    totpSetupQr.value = res.data.qrDataUrl
    totpSetupCode.value = ''
    totpSetupStep.value = 'scan'
    recoveryCodes.value = []
    totpSetupOpen.value = true
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    totpSetupLoading.value = false
  }
}

const verifyTotpSetup = async () => {
  totpSetupLoading.value = true
  try {
    const res = await hubFetch<{ success: boolean, data: { recoveryCodes: string[] } }>('/api/v1/auth/totp/verify', {
      method: 'POST',
      body: { code: totpSetupCode.value.trim() }
    })
    recoveryCodes.value = res.data.recoveryCodes
    totpSetupStep.value = 'recovery'
    totpEnabled.value = true
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    totpSetupLoading.value = false
  }
}

const closeTotpSetup = () => {
  totpSetupOpen.value = false
  totpSetupQr.value = ''
  totpSetupCode.value = ''
  recoveryCodes.value = []
}

const copyRecoveryCodes = async () => {
  try {
    await navigator.clipboard.writeText(recoveryCodes.value.join('\n'))
    notify.success(t('profile.recoveryCopied'))
  } catch {
    notify.error(t('error.unknown'))
  }
}

const totpDisableOpen = ref(false)
const totpDisableCode = ref('')
const totpDisableLoading = ref(false)

const disableTotp = async () => {
  totpDisableLoading.value = true
  try {
    await hubFetch('/api/v1/auth/totp/disable', {
      method: 'POST',
      body: { code: totpDisableCode.value.trim() }
    })
    notify.success(t('profile.totpDisabled'))
    totpEnabled.value = false
    totpDisableOpen.value = false
    totpDisableCode.value = ''
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    totpDisableLoading.value = false
  }
}

const navItems = computed<NavigationMenuItem[]>(() => [
  { label: t('profile.info'), icon: 'i-lucide-user', to: '/system/profile' },
  { label: t('profile.security'), icon: 'i-lucide-shield', to: '/system/profile/security' },
  { label: t('profile.sessions'), icon: 'i-lucide-monitor-smartphone', to: '/system/profile/sessions' },
  { label: t('notifications.pushTitle'), icon: 'i-lucide-radio-tower', to: '/system/profile/push' }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  {
    icon: 'i-lucide-key-round',
    label: t('profile.changePassword'),
    color: 'primary' as const,
    disabled: passwordLoading.value,
    onSelect: () => (document.getElementById('security-form') as HTMLFormElement | null)?.requestSubmit()
  }
]))

useHead({ title: computed(() => t('profile.security')) })
</script>

<template>
  <BasePage id="profile" :title="t('profile.security')" :description="t('settings.passwordDesc')">
    <template #right>
      <UButton
        type="submit"
        form="security-form"
        icon="i-lucide-key-round"
        :label="t('profile.changePassword')"
        color="primary"
        variant="soft"
        :ui="{ label: 'hidden md:block' }"
        :loading="passwordLoading"
      />
    </template>

    <BaseSectionNav :items="navItems">
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-key-round" class="size-5 text-primary" />
            <h3 class="font-semibold">
              {{ t('profile.changePassword') }}
            </h3>
          </div>
        </template>
        <UForm
          id="security-form"
          :schema="schema"
          :state="passwordForm"
          class="space-y-5"
          @submit="changePassword"
        >
          <UFormField name="currentPassword" :label="t('profile.currentPassword')" required>
            <BasePasswordInput v-model="passwordForm.currentPassword" size="lg" class="w-full" />
          </UFormField>
          <div class="grid gap-5 sm:grid-cols-2">
            <UFormField name="newPassword" :label="t('profile.newPassword')" required>
              <BasePasswordInput v-model="passwordForm.newPassword" size="lg" class="w-full" />
            </UFormField>
            <UFormField name="confirmPassword" :label="t('profile.confirmPassword')" required>
              <BasePasswordInput v-model="passwordForm.confirmPassword" size="lg" class="w-full" />
            </UFormField>
          </div>
        </UForm>
      </UCard>

      <UCard v-if="passkeyEnabled && meLoaded">
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-fingerprint" class="size-5 text-primary" />
              <h3 class="font-semibold">
                {{ t('profile.passkeysTitle') }}
              </h3>
            </div>
            <UButton
              icon="i-lucide-plus"
              size="sm"
              color="neutral"
              variant="soft"
              :label="t('profile.passkeyAdd')"
              :loading="passkeyAddLoading"
              @click="addPasskey"
            />
          </div>
        </template>

        <p class="text-sm text-muted mb-4">
          {{ t('profile.passkeysDesc') }}
        </p>

        <div v-if="passkeyLoading" class="flex justify-center py-6">
          <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin text-muted" />
        </div>

        <div v-else-if="!passkeys.length" class="text-sm text-muted py-4">
          {{ t('profile.noPasskeys') }}
        </div>

        <ul v-else class="divide-y divide-default">
          <li v-for="pk in passkeys" :key="pk.id" class="flex items-center justify-between gap-3 py-3">
            <div class="min-w-0">
              <p class="text-sm font-medium truncate">
                {{ pk.deviceName || t('profile.passkeyDefaultName') }}
              </p>
              <p class="text-xs text-muted">
                {{ t('profile.passkeyCreated') }}: {{ new Date(pk.createdAt).toLocaleDateString() }}
                <template v-if="pk.lastUsedAt">
                  · {{ t('profile.passkeyLastUsed') }}: {{ new Date(pk.lastUsedAt).toLocaleDateString() }}
                </template>
              </p>
            </div>
            <UButton
              icon="i-lucide-trash-2"
              size="xs"
              color="error"
              variant="ghost"
              :aria-label="t('profile.passkeyDelete')"
              @click="passkeyDeleteTarget = pk; passkeyDeleteOpen = true"
            />
          </li>
        </ul>
      </UCard>

      <UCard v-if="totpFeatureEnabled && meLoaded">
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-shield-check" class="size-5 text-primary" />
              <h3 class="font-semibold">
                {{ t('profile.totpTitle') }}
              </h3>
              <UBadge :color="totpEnabled ? 'success' : 'neutral'" variant="subtle" size="sm">
                {{ totpEnabled ? t('profile.totpOn') : t('profile.totpOff') }}
              </UBadge>
            </div>
            <UButton
              v-if="!totpEnabled"
              icon="i-lucide-shield"
              size="sm"
              color="primary"
              variant="soft"
              :label="t('profile.totpEnable')"
              :loading="totpSetupLoading"
              @click="openTotpSetup"
            />
            <UButton
              v-else
              icon="i-lucide-shield-off"
              size="sm"
              color="error"
              variant="soft"
              :label="t('profile.totpDisable')"
              @click="totpDisableOpen = true"
            />
          </div>
        </template>

        <p class="text-sm text-muted">
          {{ t('profile.totpDesc') }}
        </p>
      </UCard>
    </BaseSectionNav>

    <UModal v-model:open="passkeyDeleteOpen" :title="t('profile.passkeyDelete')" icon="i-lucide-trash-2">
      <template #body>
        <p class="text-sm text-muted">
          {{ t('profile.passkeyDeleteConfirm') }}
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="soft"
            :label="t('common.cancel')"
            @click="passkeyDeleteOpen = false; passkeyDeleteTarget = null"
          />
          <UButton color="error" :label="t('profile.passkeyDelete')" @click="confirmDeletePasskey" />
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="totpSetupOpen"
      :title="t('profile.totpEnable')"
      icon="i-lucide-shield-check"
      @update:open="v => !v && closeTotpSetup()"
    >
      <template #body>
        <div v-if="totpSetupStep === 'scan'" class="space-y-4">
          <p class="text-sm text-muted">
            {{ t('profile.totpScanDesc') }}
          </p>
          <div class="flex justify-center">
            <img
              v-if="totpSetupQr"
              :src="totpSetupQr"
              :alt="t('profile.totpQrAlt')"
              class="size-48 rounded-lg border border-default"
            >
          </div>
          <UFormField :label="t('profile.totpCodeLabel')" required>
            <UInput
              v-model="totpSetupCode"
              inputmode="numeric"
              maxlength="6"
              :placeholder="t('profile.totpCodePlaceholder')"
              class="w-full text-center tracking-[0.4em]"
              size="lg"
            />
          </UFormField>
        </div>
        <div v-else class="space-y-4">
          <p class="text-sm text-muted">
            {{ t('profile.recoveryDesc') }}
          </p>
          <ul class="grid grid-cols-2 gap-2 rounded-lg bg-default p-3 font-mono text-sm">
            <li v-for="code in recoveryCodes" :key="code">
              {{ code }}
            </li>
          </ul>
          <UButton
            icon="i-lucide-copy"
            color="neutral"
            variant="soft"
            size="sm"
            :label="t('profile.recoveryCopy')"
            @click="copyRecoveryCodes"
          />
          <p class="text-xs text-warning">
            {{ t('profile.recoveryWarning') }}
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="soft"
            :label="t('common.cancel')"
            @click="closeTotpSetup"
          />
          <UButton
            v-if="totpSetupStep === 'scan'"
            color="primary"
            :label="t('profile.totpVerify')"
            :loading="totpSetupLoading"
            :disabled="totpSetupCode.trim().length < 6"
            @click="verifyTotpSetup"
          />
          <UButton
            v-else
            color="primary"
            :label="t('common.done')"
            @click="closeTotpSetup"
          />
        </div>
      </template>
    </UModal>

    <UModal v-model:open="totpDisableOpen" :title="t('profile.totpDisable')" icon="i-lucide-shield-off">
      <template #body>
        <p class="text-sm text-muted mb-4">
          {{ t('profile.totpDisableDesc') }}
        </p>
        <UFormField :label="t('profile.totpCodeLabel')" required>
          <UInput
            v-model="totpDisableCode"
            inputmode="numeric"
            maxlength="6"
            :placeholder="t('profile.totpCodePlaceholder')"
            class="w-full text-center tracking-[0.4em]"
            size="lg"
          />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="soft"
            :label="t('common.cancel')"
            @click="totpDisableOpen = false; totpDisableCode = ''"
          />
          <UButton
            color="error"
            :label="t('profile.totpDisable')"
            :loading="totpDisableLoading"
            :disabled="totpDisableCode.trim().length < 6"
            @click="disableTotp"
          />
        </div>
      </template>
    </UModal>
  </BasePage>
</template>
