<script setup lang="ts">
import { PasswordInput as TmPasswordInput } from '@tuanmjnh/tm-ui'

defineOptions({ inheritAttrs: false })

const model = defineModel<string>({ default: '' })

withDefaults(defineProps<{
  placeholder?: string
  size?: 'sm' | 'md' | 'lg'
  ariaLabel?: string
  autocomplete?: string
}>(), {
  placeholder: '',
  size: 'md',
  ariaLabel: '',
  autocomplete: undefined
})

const { t } = useI18n()
</script>

<template>
  <TmPasswordInput v-model="model" :placeholder="placeholder" :size="size" :aria-label="ariaLabel"
    :autocomplete="autocomplete" :show-label="t('auth.showPassword')" :hide-label="t('auth.hidePassword')"
    v-bind="$attrs" />
</template>
