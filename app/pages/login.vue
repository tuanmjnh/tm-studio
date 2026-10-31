<script setup lang="ts">
import { z } from 'zod'
import type { LoginRequest, TotpChallenge } from '#shared/types/auth'
import { getErrorMessage } from '~/shared/utils/errors'

definePageMeta({ layout: false })

const auth = useAuth()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const remember = ref(false)
const { t } = useI18n()
const { isSettingsSlideoverOpen } = useDashboard()

function getRedirectTarget(): string {
  const r = route.query.redirect
  if (typeof r === 'string' && r.startsWith('/') && !r.startsWith('//')) {
    return r
  }
  return '/'
}

useHead(() => ({
  title: t('auth.signIn')
}))

const totpChallenge = ref<TotpChallenge | null>(null)
const totpCode = ref('')
const passkeyLoading = ref(false)

const schema = z.object({
  email: z.string().min(1, 'Email or username is required'),
  password: z.string().min(6, 'Password must be at least 6 characters')
})

const state = reactive({
  email: '',
  password: ''
})

function loadSaved() {
  if (import.meta.client) {
    const saved = localStorage.getItem('remembered_login')
    if (saved) {
      try {
        const data = JSON.parse(saved)
        state.email = data.username || ''
        state.password = data.password || ''
        remember.value = true
      } catch (e) {
        void e
      }
    }
  }
}

function saveCredentials() {
  if (remember.value) {
    localStorage.setItem('remembered_login', JSON.stringify({ username: state.email, password: state.password }))
  } else {
    localStorage.removeItem('remembered_login')
  }
}

onMounted(loadSaved)

async function onSubmit() {
  try {
    const input: LoginRequest = { email: state.email, password: state.password }
    const result = await auth.login(input)
    saveCredentials()
    if ('totpRequired' in result && result.totpRequired) {
      totpChallenge.value = result
      totpCode.value = ''
      return
    }
    await router.push(getRedirectTarget())
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  }
}

async function onPasskeyLogin() {
  if (passkeyLoading.value) return
  passkeyLoading.value = true
  try {
    await auth.passkeyLogin()
    await router.push(getRedirectTarget())
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name
    if (name === 'NotAllowedError') toast.add({ title: t('auth.passkeyCancelled'), color: 'neutral' })
    else toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  } finally {
    passkeyLoading.value = false
  }
}

async function onVerifyTotp() {
  if (!totpChallenge.value) return
  try {
    await auth.verifyTotp(totpCode.value.trim(), totpChallenge.value.pendingTotpToken)
    await router.push(getRedirectTarget())
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
    totpCode.value = ''
  }
}

function resetTotp() {
  totpChallenge.value = null
  totpCode.value = ''
}

useHead({ title: computed(() => t('auth.signIn')) })
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
    <div class="absolute top-4 right-4 flex items-center gap-2">
      <UTooltip :text="t('settings.title')">
        <UButton
          icon="i-lucide-settings"
          color="neutral"
          variant="soft"
          size="sm"
          :aria-label="t('settings.title')"
          @click="isSettingsSlideoverOpen = true"
        />
      </UTooltip>
    </div>

    <UCard class="w-full max-w-md">
      <template #header>
        <div class="text-center">
          <div
            class="inline-flex items-center justify-center size-12 rounded-xl bg-primary/10 text-primary mb-3 mx-auto"
          >
            <UIcon v-if="totpChallenge" name="i-lucide-shield-check" class="size-6" />
            <MediaVisual v-else src="/logo.svg" size="size-7" />
          </div>
          <h1 class="text-2xl font-bold mt-1">
            {{ totpChallenge ? $t('auth.totpTitle') : $t('auth.welcomeBack') }}
          </h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {{ totpChallenge ? $t('auth.totpSubtitle', { email: totpChallenge.user.email }) : $t('auth.signInToAccount')
            }}
          </p>
        </div>
      </template>

      <UForm
        v-if="!totpChallenge"
        :schema="schema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField :label="$t('auth.emailOrUsername')" name="email">
          <UInput
            v-model="state.email"
            type="text"
            :placeholder="$t('auth.emailPlaceholder')"
            class="w-full"
          />
        </UFormField>

        <UFormField :label="$t('auth.password')" name="password">
          <BasePasswordInput v-model="state.password" :placeholder="$t('auth.passwordPlaceholder')" class="w-full" />
        </UFormField>

        <div class="flex items-center justify-between text-sm py-1">
          <UCheckbox v-model="remember" :label="$t('auth.rememberMe')" />
          <NuxtLink to="/forgot-password" class="text-primary hover:underline">
            {{ $t('auth.forgotPassword') }}
          </NuxtLink>
        </div>

        <UButton
          type="submit"
          variant="soft"
          block
          :loading="auth.loading.value"
          :disabled="auth.loading.value"
        >
          {{ $t('auth.signIn') }}
        </UButton>
      </UForm>

      <div v-if="!totpChallenge" class="mt-4 flex items-center gap-3">
        <USeparator class="flex-1" />
        <span class="text-xs text-muted">{{ $t('common.or') }}</span>
        <USeparator class="flex-1" />
      </div>

      <UButton
        v-if="!totpChallenge"
        class="mt-4"
        icon="i-lucide-fingerprint"
        variant="outline"
        block
        :loading="passkeyLoading"
        :disabled="auth.loading.value"
        @click="onPasskeyLogin"
      >
        {{ $t('auth.passkeySignIn') }}
      </UButton>

      <form v-else class="space-y-4" @submit.prevent="onVerifyTotp">
        <UFormField :label="$t('auth.totpCodeLabel')" name="code" required>
          <UInput
            v-model="totpCode"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            :placeholder="$t('auth.totpCodePlaceholder')"
            class="w-full text-center tracking-[0.5em]"
            size="lg"
          />
        </UFormField>
        <UButton
          type="submit"
          variant="soft"
          block
          :loading="auth.loading.value"
          :disabled="auth.loading.value || totpCode.trim().length < 6"
        >
          {{ $t('auth.totpVerify') }}
        </UButton>
        <UButton
          type="button"
          color="neutral"
          variant="ghost"
          block
          @click="resetTotp"
        >
          {{ $t('auth.totpBack') }}
        </UButton>
      </form>
      <!-- <template v-if="!totpChallenge" #footer>
        <p class="text-center text-sm text-gray-500 dark:text-gray-400">
          {{ $t("auth.noAccount") || "Chưa có tài khoản?" }}
          <NuxtLink to="/register" class="text-primary font-medium hover:underline ml-1">
            {{ $t("auth.signUp") || $t("auth.register") || "Đăng ký ngay" }}
          </NuxtLink>
        </p>
      </template> -->
    </UCard>
    <LazyDashboardSettingsSlideover />
  </div>
</template>
