<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
    <UCard class="w-full max-w-md">
      <template #header>
        <div class="text-center">
          <h1 class="text-2xl font-bold">
            {{ $t('auth.createAccount') }}
          </h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {{ $t('auth.getStarted') }}
          </p>
        </div>
      </template>

      <UForm
        :schema="schema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField :label="$t('auth.name')" name="name">
          <UInput v-model="state.name" :placeholder="$t('auth.namePlaceholder')" class="w-full" />
        </UFormField>

        <UFormField :label="$t('auth.email')" name="email">
          <UInput
            v-model="state.email"
            type="email"
            :placeholder="$t('auth.emailRegisterPlaceholder')"
            class="w-full"
          />
        </UFormField>

        <UFormField :label="$t('auth.password')" name="password">
          <BasePasswordInput
            v-model="state.password"
            :placeholder="$t('auth.passwordCreatePlaceholder')"
            class="w-full"
          />
        </UFormField>

        <UButton
          type="submit"
          block
          :loading="auth.loading.value"
          :disabled="auth.loading.value"
        >
          {{ $t('auth.createAccount') }}
        </UButton>
      </UForm>
      <template #footer>
        <p class="text-center text-sm text-gray-500">
          {{ $t('auth.alreadyHaveAccount') }}
          <NuxtLink to="/login" class="text-primary font-medium">{{ $t('auth.signIn') }}</NuxtLink>
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

useHead(() => ({
  title: t('auth.signUp')
}))

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email'),
  password: z.string().min(6, 'Password must be at least 6 characters')
})

const state = reactive({
  name: '',
  email: '',
  password: ''
})

async function onSubmit() {
  try {
    await auth.register(state)
    await router.push('/')
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  }
}
</script>
