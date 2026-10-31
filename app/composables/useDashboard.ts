import { createSharedComposable } from '@vueuse/core'

const _useDashboard = () => {
  const route = useRoute()
  const router = useRouter()
  const isNotificationsSlideoverOpen = ref(false)
  const isSettingsSlideoverOpen = ref(false)

  defineShortcuts({
    'g-h': () => router.push('/'),
    'g-i': () => router.push('/inbox'),
    'g-s': () => router.push('/system'),
    'n': () => isNotificationsSlideoverOpen.value = !isNotificationsSlideoverOpen.value
  })

  watch(() => route.fullPath, () => {
    isNotificationsSlideoverOpen.value = false
    isSettingsSlideoverOpen.value = false
  })

  return {
    isNotificationsSlideoverOpen,
    isSettingsSlideoverOpen
  }
}

export const useDashboard = createSharedComposable(_useDashboard)
