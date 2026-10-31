<script setup lang="ts">
const model = defineModel<string>({ default: '' })

const show = ref(false)
const props = withDefaults(defineProps<{
  placeholder?: string
  size?: 'sm' | 'md' | 'lg'
  ariaLabel?: string
}>(), {
  placeholder: '',
  size: 'md',
  ariaLabel: ''
})

const { t } = useI18n()
</script>

<template>
  <UInput
    v-model="model"
    :placeholder="placeholder"
    :size="size"
    :type="show ? 'text' : 'password'"
    :ui="{ trailing: 'pe-1' }"
  >
    <template #trailing>
      <UButton
        color="neutral"
        variant="link"
        size="sm"
        :icon="show ? 'i-lucide-eye-off' : 'i-lucide-eye'"
        :aria-label="ariaLabel || (show ? t('auth.hidePassword') : t('auth.showPassword'))"
        :aria-pressed="show"
        @click="show = !show"
      />
    </template>
  </UInput>
</template>

<style scoped>
::-ms-reveal {
  display: none;
}
</style>
