<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
    <UCard class="w-full max-w-md">
      <template #header>
        <div class="text-center">
          <div
            class="inline-flex items-center justify-center size-12 rounded-xl bg-primary/10 text-primary mb-3 mx-auto"
          >
            <UIcon name="i-lucide-key" class="size-6" />
          </div>
          <h1 class="text-2xl font-bold">
            {{ $t('auth.resetPassword') }}
          </h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {{ $t('auth.enterNewPassword') }}
          </p>
        </div>
      </template>

      <UForm
        :schema="schema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField :label="$t('auth.newPassword')" name="password">
          <BasePasswordInput
            v-model="state.password"
            :placeholder="$t('auth.newPasswordPlaceholder')"
            class="w-full"
            size="lg"
          />
        </UFormField>

        <UFormField :label="$t('auth.confirmPassword')" name="confirmPassword">
          <BasePasswordInput
            v-model="state.confirmPassword"
            :placeholder="$t('auth.confirmPasswordPlaceholder')"
            class="w-full"
            size="lg"
          />
        </UFormField>

        <UButton
          type="submit"
          variant="soft"
          block
          size="lg"
          :loading="auth.loading.value"
          :disabled="auth.loading.value"
        >
          {{ $t('auth.resetPassword') }}
        </UButton>
      </UForm>

      <template #footer>
        <p class="text-center text-sm text-gray-500 dark:text-gray-400">
          {{ $t('auth.rememberPassword') }}
          <NuxtLink to="/login" class="text-primary font-medium hover:underline ml-1">
            {{ $t('auth.signIn') }}
          </NuxtLink>
        </p>
      </template>
    </UCard>
  </div>
</template>

<script setup lang="ts">
import { z } from 'zod'
import { getErrorMessage } from '~/shared/utils/errors'

definePageMeta({ layout: false })

const auth = useAuth()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { t } = useI18n()

useHead({ title: computed(() => t('auth.resetPassword')) })

const token = computed(() => (route.query.token as string) || '')
const email = computed(() => (route.query.email as string) || '')
const appId = computed(() => (route.query.appId as string) || '')

const schema = z.object({
  password: z.string().min(6, t('auth.passwordMin')),
  confirmPassword: z.string().min(6, t('auth.passwordMin'))
}).refine(data => data.password === data.confirmPassword, {
  message: t('auth.passwordsNotMatch'),
  path: ['confirmPassword']
})

const state = reactive({
  password: '',
  confirmPassword: ''
})

async function onSubmit() {
  if (!token.value || !email.value) {
    toast.add({ title: t('auth.invalidResetLink'), color: 'error' })
    await router.push('/forgot-password')
    return
  }

  try {
    await auth.resetPassword({
      email: email.value,
      token: token.value,
      password: state.password,
      appId: appId.value || undefined
    })
    toast.add({ title: t('auth.passwordResetSuccess'), color: 'success' })
    await router.push('/login')
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  }
}
</script>
