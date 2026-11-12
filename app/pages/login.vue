<script setup lang="ts">
import { z } from 'zod'
import type { LoginRequest, TotpChallenge } from '#shared/types/auth'
import { getErrorMessage } from '~/shared/utils/errors'
import { readStored, writeStored, removeStored } from '~/utils/tmcut/localStore'

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
    const saved = readStored('remembered_login')
    if (saved) {
      try {
        const data = JSON.parse(saved)
        state.email = data.username || ''
        state.password = data.password || ''
        remember.value = Boolean(data.username)
      } catch {
        removeStored('remembered_login')
      }
    }
  }
}

function saveCredentials() {
  if (remember.value && state.email) {
    writeStored('remembered_login', JSON.stringify({ username: state.email, password: state.password }))
  } else {
    removeStored('remembered_login')
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
  <div class="relative flex min-h-screen flex-col overflow-hidden px-4 py-8">
    <!-- Aurora mesh + glowing orbs + isometric grid showcase -->
    <StudioAmbientBackdrop grid />

    <div class="absolute top-4 right-4 z-10 flex items-center gap-2">
      <UColorModeButton color="neutral" variant="ghost" size="sm" />
      <UTooltip :text="t('settings.title')">
        <UButton icon="i-lucide-settings" color="neutral" variant="ghost" square size="sm"
          :aria-label="t('settings.title')" :ui="{ leadingIcon: 'text-dimmed' }"
          @click="isSettingsSlideoverOpen = true" />
      </UTooltip>
    </div>

    <div class="relative mx-auto flex w-full max-w-6xl flex-1 items-center py-6">
      <div
        class="grid w-full items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] lg:justify-between lg:gap-16">
        <!-- Surface showcase -->
        <section class="hidden lg:flex lg:flex-col lg:gap-8">
          <div class="flex items-center gap-3">
            <div class="grid size-11 place-items-center rounded-2xl border border-default/70 bg-elevated/50">
              <MediaVisual src="/logo.svg" size="size-7" />
            </div>
            <div class="flex flex-col leading-tight">
              <span class="text-sm font-semibold tracking-tight text-highlighted">TMCut Studio</span>
              <span class="text-[10px] uppercase tracking-[0.16em] text-dimmed">{{ t('auth.controlPlane') }}</span>
            </div>
          </div>

          <div class="space-y-3">
            <h1 class="max-w-md text-[2.5rem] leading-[1.08] font-semibold tracking-[-0.03em] text-highlighted">
              {{ t('auth.heroTitle') }}
            </h1>
            <p class="max-w-md text-sm leading-relaxed text-toned">{{ t('auth.heroSubtitle') }}</p>
          </div>
        </section>

        <!-- Auth card -->
        <div class="glass-panel glass-blur refract w-full p-6">
          <div class="mb-5 text-center">
            <div
              class="mx-auto mb-3 inline-flex size-11 items-center justify-center rounded-2xl border border-default/70 bg-primary/10 text-primary">
              <UIcon v-if="totpChallenge" name="i-lucide-shield-check" class="size-5" />
              <MediaVisual v-else src="/logo.svg" size="size-6" />
            </div>
            <h2 class="text-lg font-semibold tracking-tight text-highlighted">
              {{ totpChallenge ? $t('auth.totpTitle') : $t('auth.welcomeBack') }}
            </h2>
            <p class="mt-1 text-xs text-muted">
              {{ totpChallenge ? $t('auth.totpSubtitle', { email: totpChallenge.user.email }) :
                $t('auth.signInToAccount') }}
            </p>
          </div>

          <UForm v-if="!totpChallenge" :schema="schema" :state="state" class="space-y-4" @submit="onSubmit">
            <UFormField :label="$t('auth.emailOrUsername')" name="email">
              <UInput v-model="state.email" type="text" :placeholder="$t('auth.emailPlaceholder')" class="w-full" />
            </UFormField>

            <UFormField :label="$t('auth.password')" name="password">
              <BasePasswordInput v-model="state.password" :placeholder="$t('auth.passwordPlaceholder')"
                class="w-full" />
            </UFormField>

            <div class="flex items-center justify-between text-xs">
              <UCheckbox v-model="remember" :label="$t('auth.rememberMe')" />
              <NuxtLink to="/forgot-password" class="text-primary hover:underline">
                {{ $t('auth.forgotPassword') }}
              </NuxtLink>
            </div>

            <UButton type="submit" color="primary" variant="soft" block :loading="auth.loading.value"
              :disabled="auth.loading.value">
              {{ $t('auth.signIn') }}
            </UButton>
          </UForm>

          <div v-if="!totpChallenge" class="mt-4 flex items-center gap-3">
            <USeparator class="flex-1" />
            <span class="text-[10px] uppercase tracking-[0.16em] text-dimmed">{{ $t('common.or') }}</span>
            <USeparator class="flex-1" />
          </div>

          <UButton v-if="!totpChallenge" class="mt-4" icon="i-lucide-fingerprint" variant="outline" block
            :loading="passkeyLoading" :disabled="auth.loading.value" @click="onPasskeyLogin">
            {{ $t('auth.passkeySignIn') }}
          </UButton>

          <form v-else class="space-y-4" @submit.prevent="onVerifyTotp">
            <UFormField :label="$t('auth.totpCodeLabel')" name="code" required>
              <UInput v-model="totpCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6"
                :placeholder="$t('auth.totpCodePlaceholder')" class="w-full text-center tracking-[0.5em]" size="lg" />
            </UFormField>
            <UButton type="submit" color="primary" variant="solid" block :loading="auth.loading.value"
              :disabled="auth.loading.value || totpCode.trim().length < 6">
              {{ $t('auth.totpVerify') }}
            </UButton>
            <UButton type="button" color="neutral" variant="ghost" block @click="resetTotp">
              {{ $t('auth.totpBack') }}
            </UButton>
          </form>
        </div>
      </div>
    </div>

    <LazyDashboardSettingsSlideover />
  </div>
</template>
