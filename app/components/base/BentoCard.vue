<script setup lang="ts">
const props = withDefaults(defineProps<{
  /** Column span on the 12-col xl grid. */
  span?: number
  /** Column span on the 6-col sm grid (defaults to full width). */
  spanSm?: number
  title?: string
  icon?: string
  /** Opaque surface for dense data (grids, tables). */
  solid?: boolean
  /** Refracted edge light — hero/bento only, never on list rows. */
  refract?: boolean
  /** Real backdrop blur — at most a couple per viewport. */
  blur?: boolean
  /** Remove the default body padding (component manages its own). */
  flush?: boolean
  bodyClass?: string
}>(), {
  span: 12,
  title: undefined,
  icon: undefined,
  solid: false,
  refract: false,
  blur: false,
  flush: false,
  bodyClass: ''
})

const SPAN_XL: Record<number, string> = {
  1: 'xl:col-span-1',
  2: 'xl:col-span-2',
  3: 'xl:col-span-3',
  4: 'xl:col-span-4',
  5: 'xl:col-span-5',
  6: 'xl:col-span-6',
  7: 'xl:col-span-7',
  8: 'xl:col-span-8',
  9: 'xl:col-span-9',
  10: 'xl:col-span-10',
  11: 'xl:col-span-11',
  12: 'xl:col-span-12'
}

const SPAN_SM: Record<number, string> = {
  1: 'sm:col-span-1',
  2: 'sm:col-span-2',
  3: 'sm:col-span-3',
  4: 'sm:col-span-4',
  5: 'sm:col-span-5',
  6: 'sm:col-span-6'
}

const classes = computed(() => [
  SPAN_XL[props.span] ?? SPAN_XL[12],
  props.spanSm ? (SPAN_SM[props.spanSm] ?? '') : '',
  props.solid ? 'surface-solid' : '',
  props.refract ? 'refract' : '',
  props.blur ? 'glass-blur' : ''
])
</script>

<template>
  <section class="glass-panel flex min-w-0 flex-col overflow-hidden" :class="classes">
    <header
      v-if="title || $slots.header || $slots.action"
      class="flex shrink-0 items-center justify-between gap-2 px-3.5 pt-3 pb-2">
      <div class="flex min-w-0 items-center gap-2">
        <UIcon v-if="icon" :name="icon" class="size-3.5 shrink-0 text-primary" />
        <h2 class="truncate text-[13px] font-semibold tracking-tight text-highlighted">{{ title }}</h2>
        <slot name="header" />
      </div>
      <div class="flex shrink-0 items-center gap-1.5">
        <slot name="action" />
      </div>
    </header>

    <div class="min-h-0 flex-1" :class="flush ? '' : (bodyClass || 'px-3.5 pb-3.5')">
      <slot />
    </div>
  </section>
</template>
