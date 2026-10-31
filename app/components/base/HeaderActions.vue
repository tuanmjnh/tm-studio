<script setup lang="ts">
export interface HeaderActionChild {
  key?: string
  icon?: string
  label: string
  disabled?: boolean
  onSelect: () => unknown
}

export interface HeaderAction {
  key: string
  icon: string
  label: string
  color?: 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'
  variant?: 'solid' | 'subtle' | 'outline' | 'soft' | 'ghost'
  primary?: boolean
  disabled?: boolean
  visible?: boolean
  /** Always placed in ellipsis dropdown, never inline. */
  overflow?: boolean
  /** Submenu (dropdown children) - automatically overflows. */
  children?: HeaderActionChild[]
  onSelect?: () => unknown
}

const props = withDefaults(defineProps<{
  actions: HeaderAction[]
  maxInline?: number
}>(), {
  maxInline: 3
})

const { t } = useI18n()

const shown = computed(() => props.actions.filter(a => a.visible !== false))

const isOverflow = (action: HeaderAction) => !!action.overflow || !!action.children?.length

const split = computed(() => {
  const primaryCount = shown.value.filter(a => a.primary && !isOverflow(a)).length
  const secondaryBudget = Math.max(0, props.maxInline - primaryCount)
  const inline: HeaderAction[] = []
  const overflow: HeaderAction[] = []
  let secondaryUsed = 0
  for (const action of shown.value) {
    if (isOverflow(action)) {
      overflow.push(action)
    } else if (action.primary) {
      inline.push(action)
    } else if (secondaryUsed < secondaryBudget) {
      inline.push(action)
      secondaryUsed++
    } else {
      overflow.push(action)
    }
  }
  return { inline, overflow }
})

const inline = computed(() => split.value.inline)
const overflow = computed(() => split.value.overflow)

const overflowItems = computed(() => overflow.value.map(action => ({
  label: action.label,
  icon: action.icon,
  disabled: action.disabled,
  children: action.children?.length
    ? action.children.map(child => ({
        label: child.label,
        icon: child.icon,
        disabled: child.disabled,
        onSelect: () => child.onSelect()
      }))
    : undefined,
  onSelect: action.children?.length ? undefined : () => action.onSelect?.()
})))
</script>

<template>
  <div class="flex items-center gap-2">
    <UButton
      v-for="action in inline"
      :key="action.key"
      :icon="action.icon"
      :label="action.label"
      :color="action.color ?? 'neutral'"
      :variant="action.variant ?? 'soft'"
      size="sm"
      :disabled="action.disabled"
      :ui="{ label: 'hidden md:block' }"
      @click="action.onSelect?.()"
    />
    <UDropdownMenu
      v-if="overflow.length"
      :items="overflowItems"
      :content="{ side: 'bottom', align: 'end' }"
    >
      <UButton
        icon="i-lucide-ellipsis-vertical"
        color="neutral"
        variant="soft"
        size="sm"
        :aria-label="t('common.more')"
      />
    </UDropdownMenu>
  </div>
</template>
