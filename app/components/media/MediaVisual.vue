<script setup lang="ts">
const props = defineProps<{
  /**
   * Source of the logo: URL, raw SVG string, or Iconify icon name
   */
  src?: string | undefined
  /**
   * Tailwind class or custom size (e.g. 'size-8', 'w-10 h-10')
   */
  size?: string
  /**
   * Custom style object or string for specific height/width
   */
  customStyle?: Record<string, string> | string
  /**
   * Additional classes for the container
   */
  class?: string
  /**
   * Specific classes for the inner element (image, icon, or svg wrapper)
   */
  innerClass?: string
}>()

const resolvedSrc = computed(() => getImage(props.src))

// Use global helper detectDisplayType (auto-imported)
const displayType = computed(() => detectDisplayType(resolvedSrc.value))

// Provide a cleaned URL for image types
const cleanedSrc = computed(() => {
  if (displayType.value === 'image') {
    return cleanImageUrl(resolvedSrc.value)
  }
  return resolvedSrc.value
})
</script>

<template>
  <div
    v-if="resolvedSrc"
    :class="[
      'flex items-center justify-center shrink-0 overflow-hidden',
      size || 'size-8',
      props.class
    ]"
    :style="customStyle"
  >
    <template v-if="displayType === 'svg'">
      <div
        :class="[
          'w-full h-full flex items-center justify-center text-current [&>svg]:w-full [&>svg]:h-full [&>svg]:block',
          innerClass
        ]"
        v-html="sanitizeSvg(resolvedSrc)"
      />
    </template>

    <template v-else-if="displayType === 'image'">
      <img
        v-if="isSpecialImage(cleanedSrc)"
        :src="ensureForwardSlash(cleanedSrc)"
        :class="['w-full h-full object-contain', innerClass]"
      >
      <NuxtImg v-else :src="cleanedSrc" :class="['w-full h-full object-contain', innerClass]" />
    </template>

    <template v-else>
      <UIcon :name="resolvedSrc" :class="['w-full h-full text-current', innerClass]" />
    </template>
  </div>
</template>
