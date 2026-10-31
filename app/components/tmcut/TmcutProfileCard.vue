<script setup lang="ts">
import { TmcutBadge } from '#components'

interface Props {
  profile: {
    id: string
    name: string
    desc: string
    icon: string
  }
  selected: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{ select: [id: string] }>()
</script>

<template>
  <div
    class="relative group cursor-pointer transition-all duration-200 rounded-2xl p-5 flex flex-col justify-between"
    :class="[
      'border-2 rounded-xl p-5 cursor-pointer transition-all duration-200 flex flex-col justify-between',
      props.selected
        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 shadow-lg shadow-primary-500/10'
        : 'border-neutral-200 dark:border-neutral-700 hover:border-primary-300 dark:hover:border-primary-700 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm'
    ]"
    @click="emit('select', props.profile.id)"
  >
    <div class="space-y-3">
      <UIcon :name="props.profile.icon" class="w-7 h-7 text-primary-500" />
      <h4 class="font-semibold text-sm text-neutral-900 dark:text-neutral-100">{{ props.profile.name }}</h4>
      <p class="text-xs text-neutral-500">{{ props.profile.desc }}</p>
    </div>
    <TmcutBadge v-if="props.selected" variant="primary" size="xs" class="mt-4 self-start flex items-center gap-1">
      <UIcon name="i-lucide-check" class="w-3 h-3" />
      {{ $t('tmcut.autocutV2.profileSelected') }}
    </TmcutBadge>
  </div>
</template>