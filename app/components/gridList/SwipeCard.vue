<script setup lang="ts">
import { usePointerSwipe, useVibrate, useResizeObserver, onClickOutside, onLongPress } from '@vueuse/core'

const props = defineProps<{
  id: string | number
  openId?: string | number | null
  disabled?: boolean
  item?: any
  contextItems?: any[]
  mobileMode?: 'swipe' | 'dropdown' | 'context'
  draggable?: boolean
}>()

const emits = defineEmits<{
  (e: 'update:openId', id: string | number | null): void
  (e: 'click', item: any): void
  (e: 'long-press', payload: { item: any, clientX: number, clientY: number }): void
}>()

const container = ref<HTMLElement | null>(null)
const content = ref<HTMLElement | null>(null) // Moves
const swipeTarget = ref<HTMLElement | null>(null) // Listens for touches
const actionRef = ref<HTMLElement | null>(null)
const actionWidth = ref(0)
const isOpened = ref(false)

// Measure action width dynamically
useResizeObserver(actionRef, (entries) => {
  const entry = entries[0]
  if (entry) {
    actionWidth.value = entry.contentRect.width
  }
})

// Haptics
const { vibrate, isSupported } = useVibrate({ pattern: [10] })
const triggerHaptic = () => {
  if (isSupported.value) {
    vibrate()
  }
}

// Long Press
onLongPress(swipeTarget, (e) => {
  triggerHaptic()
  const clientX = (e as unknown as TouchEvent).touches?.[0]?.clientX || (e as MouseEvent).clientX
  const clientY = (e as unknown as TouchEvent).touches?.[0]?.clientY || (e as MouseEvent).clientY

  emits('long-press', { item: props.item, clientX, clientY })
}, { delay: 500 })

// Swipe Logic
const { distanceX, isSwiping } = usePointerSwipe(swipeTarget, {
  disableTextSelect: true,
  onSwipeEnd: (e, direction) => {
    if (props.mobileMode !== 'swipe' && props.mobileMode !== undefined) return

    // Threshold to snap open (e.g., 40% of width or fixed amount)
    const triggerThreshold = actionWidth.value * 0.4

    if (distanceX.value > triggerThreshold) {
      open()
    } else {
      close()
    }
  }
})

const offset = computed(() => {
  if (props.disabled) return 0
  if (actionWidth.value === 0) return 0
  // Default to swipe if undefined
  if (props.mobileMode !== 'swipe' && props.mobileMode !== undefined) return 0

  // If actively swiping
  if (isSwiping.value) {
    // distanceX > 0 means swiping LEFT (revealing right actions)
    if (distanceX.value > 0) {
      // Allow elastic drag slightly beyond width
      return -Math.min(distanceX.value, actionWidth.value + 30)
    }
    return 0 // Disable right swipe
  }

  // If not swiping
  return isOpened.value ? -actionWidth.value : 0
})

const open = () => {
  if (isOpened.value) return
  isOpened.value = true
  triggerHaptic()
  emits('update:openId', props.id)
}

const close = () => {
  isOpened.value = false
}

// Watch external openId to close if another card opens
watch(() => props.openId, (newId) => {
  if (newId !== props.id && isOpened.value) {
    close()
  }
})

// Click outside to close
onClickOutside(container, () => {
  if (isOpened.value) close()
})

const handleContentClick = () => {
  // Allow click if not swiping or movement is very small (accidental jitter)
  if (!isSwiping.value || Math.abs(distanceX.value) < 5) {
    emits('click', props.item)
  }
}
</script>

<template>
  <div
    ref="container"
    class="relative overflow-hidden rounded-lg border border-gray-300/50 dark:border-gray-700/50 bg-white/40 dark:bg-gray-800/40 backdrop-blur-sm shadow-xs transition-all duration-200 hover:bg-white/60 dark:hover:bg-gray-800/60 hover:shadow-md hover:border-primary-500/50 touch-pan-y select-none group"
  >
    <!--  -->
    <!-- Action Layer (Background) -->
    <div
      v-show="(mobileMode === 'swipe' || mobileMode === undefined) && (Math.abs(offset) > 1 || isSwiping)"
      ref="actionRef"
      class="swipe-actions absolute inset-y-0 right-0 flex items-center justify-end h-full z-0 pl-16"
    >
      <slot name="actions" :item="item" :close="close" />
    </div>

    <!-- Content Layer (Foreground) -->
    <div
      ref="content"
      class="relative bg-transparent z-10 w-full h-full transition-transform duration-300 ease-[cubic-bezier(0.18,0.89,0.32,1.28)]"
      :class="{ 'cursor-grab': (!mobileMode || mobileMode === 'swipe') && !isSwiping, 'cursor-grabbing': (!mobileMode || mobileMode === 'swipe') && isSwiping }"
      :style="{ transform: `translate3d(${offset}px, 0, 0)` }"
    >
      <div class="flex items-center w-full h-full">
        <!-- Left Slot (Handle) - Outside Swipe Listener -->
        <div v-if="$slots.left || draggable" class="shrink-0 h-full flex items-center pl-2">
          <div
            v-if="draggable"
            style="touch-action: none"
            class="drag-handle w-6 flex cursor-move p-1 text-gray-400 opacity-50 group-hover:opacity-100 touch-none"
            @contextmenu.stop
          >
            <UIcon name="i-lucide-grip-vertical" class="w-4 h-4" />
          </div>
          <slot name="left" :item="item" :is-opened="isOpened" />
        </div>

        <!-- Center & Right (Swipe Target) -->
        <div
          ref="swipeTarget"
          class="active-scale flex-1 min-w-0 h-full flex items-center transition-all duration-200 active:bg-gray-50 dark:active:bg-gray-800/80 rounded-lg"
          @click="handleContentClick"
        >
          <!-- Center (Default) Slot -->
          <div class="flex-1 min-w-0 h-full flex items-center">
            <slot name="default" :item="item" :is-opened="isOpened" />
          </div>

          <!-- Right Slot -->
          <div v-if="$slots.right" class="shrink-0 h-full flex items-center">
            <slot name="right" :item="item" :is-opened="isOpened" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Ensure touch actions don't interfere with vertical scroll of page */
.touch-pan-y {
  touch-action: pan-y;
}

/*
  Apply active scale to the content area only, excluding interactive children.
  We exclude:
  - Inputs, Buttons, Labels
  - Elements with role="button" (like UDropdownMenu triggers)
*/
.active-scale:active:not(:has(input:active)):not(:has(button:active)):not(:has(label:active)):not(:has([role=button]:active)) {
  transform: scale(0.99);
}
</style>
