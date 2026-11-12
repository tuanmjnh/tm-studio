<script setup lang="ts">
const { t, locale, setLocale } = useI18n()
const colorMode = useColorMode()
const appConfig = useAppConfig()
// Accent + neutral are a saved preference (utils/uiTheme), not app-config state:
// assigning to appConfig alone recoloured the page and forgot on reload.
const { primaryColors, neutralColors, setPrimary, setNeutral } = useUiTheme()

const languageItems = computed(() => [
  { label: 'Tiếng Việt', value: 'vi', icon: 'i-lucide-languages' },
  { label: 'English', value: 'en', icon: 'i-lucide-languages' }
])

const themeOptions = computed(() => [
  { value: 'light' as const, label: t('settings.light'), icon: 'i-lucide-sun' },
  { value: 'dark' as const, label: t('settings.dark'), icon: 'i-lucide-moon' },
  { value: 'system' as const, label: t('settings.systemTheme'), icon: 'i-lucide-monitor' }
])

const onLanguageChange = (value: unknown) => {
  if (value === 'vi' || value === 'en') setLocale(value)
}

useHead({ title: computed(() => t('settings.appearance')) })
</script>

<template>
  <div class="space-y-6">
    <UCard>
      <div class="space-y-6">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p class="text-sm font-medium text-highlighted">
            {{ t('settings.language') }}
          </p>
          <USelect
            :model-value="locale"
            :items="languageItems"
            size="lg"
            class="w-full sm:w-48"
            :aria-label="t('settings.language')"
            @update:model-value="onLanguageChange"
          />
        </div>

        <USeparator />

        <div class="space-y-3">
          <p class="text-sm font-medium text-highlighted">
            {{ t('settings.theme') }}
          </p>
          <div class="grid grid-cols-3 gap-3">
            <button
              v-for="option in themeOptions"
              :key="option.value"
              type="button"
              class="group flex flex-col gap-2 rounded-lg border p-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              :class="colorMode.preference === option.value
                ? 'border-primary ring ring-primary/30'
                : 'border-default hover:border-accented'"
              :aria-pressed="colorMode.preference === option.value"
              @click="colorMode.preference = option.value"
            >
              <span
                class="flex h-16 overflow-hidden rounded-md border border-default"
                :class="option.value === 'dark'
                  ? 'bg-zinc-950'
                  : option.value === 'system'
                    ? 'bg-linear-to-br from-white via-white to-zinc-950'
                    : 'bg-white'"
              >
                <span
                  class="flex w-[30%] flex-col gap-1.5 border-e p-2"
                  :class="option.value === 'dark'
                    ? 'border-zinc-800 bg-zinc-900'
                    : 'border-zinc-200 bg-zinc-100'"
                >
                  <span
                    class="size-1.5 rounded-full"
                    :class="option.value === 'dark' ? 'bg-blue-400' : 'bg-blue-500'"
                  />
                  <span
                    class="h-1 w-full rounded-full"
                    :class="option.value === 'dark' ? 'bg-zinc-600' : 'bg-zinc-300'"
                  />
                  <span
                    class="h-1 w-3/4 rounded-full"
                    :class="option.value === 'dark' ? 'bg-zinc-700' : 'bg-zinc-300'"
                  />
                </span>
                <span class="flex-1 space-y-1.5 p-2">
                  <span
                    class="block h-1.5 w-1/2 rounded-full"
                    :class="option.value === 'dark' ? 'bg-zinc-500' : 'bg-zinc-300'"
                  />
                  <span
                    class="block h-1 w-full rounded-full"
                    :class="option.value === 'dark' ? 'bg-zinc-700' : 'bg-zinc-200'"
                  />
                  <span
                    class="block h-1 w-4/5 rounded-full"
                    :class="option.value === 'dark' ? 'bg-zinc-700' : 'bg-zinc-200'"
                  />
                </span>
              </span>
              <span class="flex items-center justify-between px-0.5">
                <span
                  class="flex items-center gap-1.5 text-xs font-medium"
                  :class="colorMode.preference === option.value ? 'text-highlighted' : 'text-muted'"
                >
                  <UIcon :name="option.icon" class="size-3.5" />
                  {{ option.label }}
                </span>
                <UIcon
                  v-if="colorMode.preference === option.value"
                  name="i-lucide-check-circle-2"
                  class="size-4 text-primary"
                />
              </span>
            </button>
          </div>
        </div>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-semibold text-highlighted">
          {{ t('settings.colors') }}
        </h2>
      </template>

      <div class="space-y-6">
        <div class="space-y-3">
          <div class="flex items-baseline justify-between gap-3">
            <p class="text-sm font-medium text-highlighted">
              {{ t('settings.primaryColor') }}
            </p>
            <span class="font-mono text-xs text-dimmed">{{ appConfig.ui.colors.primary }}</span>
          </div>
          <div class="flex flex-wrap gap-2.5">
            <button
              v-for="color in primaryColors"
              :key="color"
              type="button"
              class="relative flex size-8 items-center justify-center rounded-full transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              :class="appConfig.ui.colors.primary === color
                ? 'ring-2 ring-primary ring-offset-2 ring-offset-default'
                : ''"
              :style="{ backgroundColor: `var(--color-${color}-500)` }"
              :aria-label="color"
              :aria-pressed="appConfig.ui.colors.primary === color"
              @click="setPrimary(color)"
            >
              <UIcon
                v-if="appConfig.ui.colors.primary === color"
                name="i-lucide-check"
                class="size-4 text-white drop-shadow-sm"
              />
            </button>
          </div>
        </div>

        <USeparator />

        <div class="space-y-3">
          <div class="flex items-baseline justify-between gap-3">
            <p class="text-sm font-medium text-highlighted">
              {{ t('settings.neutralColor') }}
            </p>
            <span class="font-mono text-xs text-dimmed">{{ appConfig.ui.colors.neutral }}</span>
          </div>
          <div class="flex flex-wrap gap-2.5">
            <button
              v-for="color in neutralColors"
              :key="color"
              type="button"
              class="relative flex size-8 items-center justify-center rounded-full ring-1 ring-inset ring-default transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              :class="appConfig.ui.colors.neutral === color
                ? 'ring-2 ring-inset ring-default'
                : ''"
              :style="{ backgroundColor: `var(--color-${color}-500)` }"
              :aria-label="color"
              :aria-pressed="appConfig.ui.colors.neutral === color"
              @click="setNeutral(color)"
            >
              <UIcon
                v-if="appConfig.ui.colors.neutral === color"
                name="i-lucide-check"
                class="size-4 text-white drop-shadow-sm"
              />
            </button>
          </div>
        </div>
      </div>
    </UCard>
  </div>
</template>
