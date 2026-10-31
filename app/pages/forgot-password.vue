<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
    <UCard class="w-full max-w-md">
      <template #header>
        <div class="text-center">
          <div
            class="inline-flex items-center justify-center size-12 rounded-xl bg-primary/10 text-primary mb-3 mx-auto"
          >
            <UIcon name="i-lucide-lock" class="size-6" />
          </div>
          <h1 class="text-2xl font-bold">
            {{ $t('auth.forgotPassword') }}
          </h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {{ $t('auth.enterEmailForReset') }}
          </p>
        </div>
      </template>

      <UForm
        :schema="schema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField :label="$t('auth.email')" name="email">
          <UInput
            v-model="state.email"
            type="email"
            :placeholder="$t('auth.emailPlaceholder')"
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
          {{ $t('auth.sendResetLink') }}
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
const router = useRouter()
const toast = useToast()
const { t } = useI18n()

useHead({ title: computed(() => t('auth.forgotPassword')) })

const schema = z.object({
  email: z.string().email(t('auth.invalidEmail'))
})

const state = reactive({
  email: ''
})

async function onSubmit() {
  try {
    const redirectUrl = import.meta.client ? `${window.location.origin}/reset-password` : undefined
    await auth.forgotPassword({ email: state.email, redirectUrl })
    toast.add({ title: t('auth.resetLinkSent'), color: 'success' })
    await router.push('/login')
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  }
}
</script>
