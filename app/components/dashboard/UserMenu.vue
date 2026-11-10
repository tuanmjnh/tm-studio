<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

defineProps<{ collapsed?: boolean }>()

const colorMode = useColorMode()
const appConfig = useAppConfig()
const auth = useAuth()
const router = useRouter()
const { t, locale, setLocale } = useI18n()
const { isSettingsSlideoverOpen } = useDashboard()
const appUpdater = useAppUpdater()

const isFeedbackModalOpen = ref(false)
const isHelpModalOpen = ref(false)

const colors = ['red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose']
const neutrals = ['slate', 'gray', 'zinc', 'neutral', 'stone', 'taupe', 'mauve', 'mist', 'olive']

// Three steps, in order: the account's own picture, an image this install
// ships, then initials. The middle step exists so a fresh install with no
// uploaded avatar still shows a face — and so the fallback never points at
// another site (the old one was a stranger's GitHub photo, and Chromium
// blocked it with CORB on every page carrying this menu).
const DEFAULT_AVATAR_URL = '/avatar-default.svg'

const displayName = computed(() => auth.user.value?.name || auth.user.value?.email || t('common.guest'))

const initials = computed(() => {
  const source = displayName.value.trim()
  if (!source) return ''
  const words = source.split(/\s+/).filter(Boolean)
  // A single word (a username, an email local part) gives two letters; a name
  // gives the first letter of each of its first two words.
  return (words.length === 1 ? words[0]!.slice(0, 2) : `${words[0]![0] ?? ''}${words[1]![0] ?? ''}`).toUpperCase()
})

const avatar = computed(() => ({
  src: auth.user.value?.avatarUrl || DEFAULT_AVATAR_URL,
  // `text` is what UAvatar draws once src is missing or the image errors, so
  // the initials are the last resort rather than an accidental `alt` split.
  text: initials.value,
  alt: displayName.value
}))

const items = computed<DropdownMenuItem[][]>(() => [
  [
    {
      type: 'label',
      label: auth.user.value?.name || t('common.guest'),
      avatar: avatar.value
    }
  ],
  [
    {
      label: t('common.settings'),
      icon: 'i-lucide-settings',
      onSelect: () => { isSettingsSlideoverOpen.value = true }
    }
    // {
    //   label: t('common.profile'),
    //   icon: 'i-lucide-user',
    //   to: '/system/settings/profile'
    // }
  ],
  [
    {
      label: t('common.language'),
      icon: 'i-lucide-languages',
      children: [{
        label: t('common.english'),
        type: 'checkbox' as const,
        checked: locale.value === 'en',
        onSelect: () => setLocale('en')
      }, {
        label: t('common.vietnamese'),
        type: 'checkbox' as const,
        checked: locale.value === 'vi',
        onSelect: () => setLocale('vi')
      }]
    },
    {
      label: t('common.appearance'),
      icon: 'i-lucide-sun-moon',
      children: [{
        label: t('common.light'),
        icon: 'i-lucide-sun',
        type: 'checkbox' as const,
        checked: colorMode.value === 'light',
        onSelect: (e: Event) => {
          e.preventDefault()
          colorMode.preference = 'light'
        }
      }, {
        label: t('common.dark'),
        icon: 'i-lucide-moon',
        type: 'checkbox' as const,
        checked: colorMode.value === 'dark',
        onSelect: (e: Event) => {
          e.preventDefault()
          colorMode.preference = 'dark'
        }
      }]
    },
    {
      label: t('common.theme'),
      icon: 'i-lucide-palette',
      children: [{
        label: t('common.primary'),
        slot: 'chip' as const,
        chip: appConfig.ui.colors.primary,
        content: { align: 'center', collisionPadding: 16 },
        children: colors.map(color => ({
          label: color,
          chip: color,
          slot: 'chip' as const,
          checked: appConfig.ui.colors.primary === color,
          type: 'checkbox' as const,
          onSelect: (e: Event) => {
            e.preventDefault()
            appConfig.ui.colors.primary = color
          }
        }))
      },
      {
        label: t('common.neutral'),
        slot: 'chip' as const,
        chip: appConfig.ui.colors.neutral === 'neutral' ? 'old-neutral' : appConfig.ui.colors.neutral,
        content: { align: 'end', collisionPadding: 16 },
        children: neutrals.map(color => ({
          label: color,
          chip: color === 'neutral' ? 'old-neutral' : color,
          slot: 'chip' as const,
          type: 'checkbox' as const,
          checked: appConfig.ui.colors.neutral === color,
          onSelect: (e: Event) => {
            e.preventDefault()
            appConfig.ui.colors.neutral = color
          }
        }))
      }]
    }
  ],
  [{
    label: t('nav.feedback'),
    icon: 'i-lucide-message-circle',
    onSelect: () => { isFeedbackModalOpen.value = true }
  },
  {
    label: t('nav.help'),
    icon: 'i-lucide-info',
    onSelect: () => { isHelpModalOpen.value = true }
  },
  ...(appUpdater.isElectron.value
    ? [{
        label: t('global.update'),
        icon: 'i-lucide-arrow-up-circle',
        onSelect: () => {
          appUpdater.openModal()
          appUpdater.checkForUpdates(false)
        }
      }]
    : [])
  ],
  [{
    label: t('common.signOut'),
    icon: 'i-lucide-log-out',
    onSelect() {
      auth.logout().then(() => router.push('/login'))
    }
  }]
])
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: 'center', collisionPadding: 12 }"
    :ui="{ content: collapsed ? 'w-48' : 'w-(--reka-dropdown-menu-trigger-width)' }"
  >
    <UButton
      v-bind="{
        avatar,
        label: collapsed ? undefined : (auth.user.value?.name || t('common.guest')),
        trailingIcon: collapsed ? undefined : 'i-lucide-chevrons-up-down'
      }"
      color="neutral"
      variant="ghost"
      block
      :square="collapsed"
      :aria-label="collapsed ? (auth.user.value?.name || t('common.guest')) : undefined"
      class="data-[state=open]:bg-elevated"
      :ui="{ trailingIcon: 'text-dimmed' }"
    />

    <template #chip-leading="{ item }">
      <div class="inline-flex items-center justify-center shrink-0 size-5">
        <span
          class="rounded-full ring ring-bg bg-(--chip-light) dark:bg-(--chip-dark) size-2"
          :style="{
            '--chip-light': `var(--color-${(item as any).chip}-500)`,
            '--chip-dark': `var(--color-${(item as any).chip}-400)`
          }"
        />
      </div>
    </template>
  </UDropdownMenu>

  <LazyDashboardFeedbackModal v-model:open="isFeedbackModalOpen" />
  <LazyDashboardHelpModal v-model:open="isHelpModalOpen" />
</template>
