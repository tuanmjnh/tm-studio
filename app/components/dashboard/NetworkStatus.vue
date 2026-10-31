<script setup lang="ts">
const props = withDefaults(defineProps<{
  collapsed?: boolean
  iconOnly?: boolean
}>(), {
  collapsed: false,
  iconOnly: false
})

const { online, checking, latency } = useNetworkStatus()
const { t } = useI18n()

const onlyIcon = computed(() => props.iconOnly || props.collapsed)

const tooltip = computed(() => {
  if (checking.value) return t('network.checking')
  return `${online.value ? t('network.online') : t('network.offline')}${latency.value !== null ? ` · ${latency.value}ms` : ''}`
})
</script>

<template>
  <UTooltip :text="tooltip" :content="{ side: 'right' }">
    <button
      type="button"
      :aria-label="tooltip"
      class="flex items-center gap-2 rounded-md text-sm text-muted hover:bg-elevated transition-colors"
      :class="onlyIcon ? 'size-7 justify-center' : 'w-full px-2 py-1.5'"
    >
      <span class="relative inline-flex shrink-0">
        <UIcon
          :name="online ? 'i-lucide-wifi' : 'i-lucide-wifi-off'"
          class="size-4"
          :class="online ? 'text-success' : 'text-error'"
        />
        <span v-if="checking" class="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary animate-pulse" />
      </span>
      <template>
        <span class="truncate">{{ online ? t('network.online') : t('network.offline') }}</span>
        <span v-if="online && latency !== null" class="ml-auto text-xs text-dimmed">{{ latency }}ms</span>
      </template>
    </button>
  </UTooltip>
</template>
