<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { getErrorMessage } from '~/shared/utils/errors'

const { t } = useI18n()
const notify = useNotify()
const auth = useAuth()
const { hubFetch } = useHub()

const saving = ref(false)

const profileForm = reactive({
  name: '',
  avatarUrl: ''
})

watch(() => auth.user.value, (u) => {
  if (u) {
    profileForm.name = u.name || ''
    profileForm.avatarUrl = (u as any).avatarUrl || ''
  }
}, { immediate: true })

const isAvatarPickerOpen = ref(false)
const tempAvatarUrl = ref('')

const openAvatarPicker = () => {
  tempAvatarUrl.value = profileForm.avatarUrl
  isAvatarPickerOpen.value = true
}

const onAvatarPicked = (val: Cloudinary.IFileAttach | Cloudinary.IFileAttach[] | null) => {
  if (Array.isArray(val)) {
    if (val[0]) tempAvatarUrl.value = val[0].url || val[0].secure_url || ''
    return
  }
  tempAvatarUrl.value = val?.url || val?.secure_url || ''
}

const applyAvatar = () => {
  profileForm.avatarUrl = tempAvatarUrl.value
  isAvatarPickerOpen.value = false
}

const saveProfile = async () => {
  saving.value = true
  try {
    await hubFetch('/api/v1/auth/me', {
      method: 'PUT',
      body: { name: profileForm.name, avatarUrl: profileForm.avatarUrl }
    })
    await auth.fetchUser()
    notify.success(t('settings.profileUpdated'))
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    saving.value = false
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
    icon: 'i-lucide-save',
    label: t('settings.saveChanges'),
    color: 'primary' as const,
    disabled: saving.value,
    onSelect: saveProfile
  }
]))

useHead({ title: computed(() => t('profile.title')) })
</script>

<template>
  <BasePage id="profile" :title="t('profile.title')" :description="t('profile.description')">
    <template #right>
      <UButton
        icon="i-lucide-save"
        :label="t('settings.saveChanges')"
        color="primary"
        :loading="saving"
        variant="soft"
        :ui="{ label: 'hidden md:block' }"
        @click="saveProfile"
      />
    </template>

    <BaseSectionNav :items="navItems">
      <UCard>
        <template #header>
          <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex items-center gap-4 min-w-0">
              <button
                type="button"
                class="relative group/avatar shrink-0 cursor-pointer rounded-full"
                :aria-label="t('settings.avatar')"
                @click="openAvatarPicker"
              >
                <UAvatar :src="profileForm.avatarUrl || undefined" :alt="profileForm.name" size="xl" />
                <span
                  class="absolute inset-0 flex items-center justify-center bg-primary/60 rounded-full opacity-0 group-hover/avatar:opacity-100 transition-all duration-300 backdrop-blur-sm"
                >
                  <UIcon
                    name="i-lucide-camera"
                    class="size-5 text-white scale-75 group-hover/avatar:scale-100 transition-transform duration-300"
                  />
                </span>
              </button>
              <div class="min-w-0">
                <p class="font-semibold text-highlighted truncate">
                  {{ profileForm.name || auth.user.value?.name }}
                </p>
                <p class="text-sm text-muted truncate">
                  {{ auth.user.value?.email }}
                </p>
                <UBadge
                  :label="auth.user.value?.role"
                  variant="subtle"
                  size="xs"
                  class="mt-1.5"
                />
              </div>
            </div>
            <UButton
              icon="i-lucide-camera"
              :label="t('settings.avatar')"
              color="neutral"
              variant="soft"
              size="sm"
              class="hidden sm:flex"
              @click="openAvatarPicker"
            />
          </div>
        </template>

        <UForm :state="profileForm" class="space-y-5" @submit="saveProfile">
          <UFormField
            name="name"
            :label="t('common.name')"
            :description="t('settings.nameDesc')"
            required
          >
            <UInput v-model="profileForm.name" size="lg" class="w-full" />
          </UFormField>
          <UFormField name="email" :label="t('settings.email')" :description="t('settings.emailDesc')">
            <UInput
              :model-value="auth.user.value?.email || ''"
              size="lg"
              class="w-full"
              disabled
            />
          </UFormField>
        </UForm>
      </UCard>
    </BaseSectionNav>

    <LazyBaseResponsiveModal
      v-model:open="isAvatarPickerOpen"
      :title="t('settings.avatar')"
      :description="t('settings.avatarDesc')"
      :ui="{ body: 'min-h-[300px]', footer: 'justify-end' }"
    >
      <template #body>
        <LazyMediaGallery
          :model-value="tempAvatarUrl || null"
          :multiple="false"
          size="200px"
          accept="image/*"
          folder="avatars"
          @update:model-value="onAvatarPicked"
        />
      </template>
      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          :label="t('common.cancel')"
          @click="isAvatarPickerOpen = false"
        />
        <UButton color="primary" :label="t('common.update')" @click="applyAvatar" />
      </template>
    </LazyBaseResponsiveModal>
  </BasePage>
</template>
