<script setup lang="ts">
// Small, CSS-only motion preset preview for the inspector. One demo plate and
// one keyframe per preset; the animation describes exactly what the preset
// writes (opacity / scale over the clip), so the card never advertises a move
// the keyframes do not produce.
import type { MediaAnimPreset } from '~/utils/tmcut/fxLibrary'

withDefaults(defineProps<{
  preset: MediaAnimPreset
  active?: boolean
}>(), {
  active: false
})
</script>

<template>
  <div
    class="tmcut-motion-thumb relative aspect-[16/9] w-full overflow-hidden rounded-md bg-neutral-800 ring-1 ring-black/10 dark:ring-white/10"
  >
    <div
      class="absolute inset-0"
      :class="`tmcut-motion-${preset}`"
    >
      <div class="absolute inset-0 bg-gradient-to-b from-sky-300 via-sky-100 to-amber-100" />
      <UIcon
        name="i-lucide-mountain-snow"
        class="absolute left-1/2 top-[58%] size-8 -translate-x-1/2 -translate-y-1/2 text-slate-600/80"
      />
      <span class="absolute bottom-1 right-1 rounded bg-black/50 px-1 text-[8px] font-medium leading-tight text-white/85">
        16:9
      </span>
    </div>
  </div>
</template>

<style>
.tmcut-motion-fade { animation: tmcut-motion-fade 3s ease-in-out infinite; }
.tmcut-motion-fade-in { animation: tmcut-motion-fade-in 2.4s ease-out infinite; }
.tmcut-motion-fade-out { animation: tmcut-motion-fade-out 2.4s ease-in infinite; }
.tmcut-motion-zoom-in { animation: tmcut-motion-zoom-in 2.4s ease-out infinite; }
.tmcut-motion-zoom-out { animation: tmcut-motion-zoom-out 2.4s ease-in infinite; }
.tmcut-motion-reset { opacity: 1; }

@keyframes tmcut-motion-fade {
  0% { opacity: 0 }
  25% { opacity: 1 }
  80% { opacity: 1 }
  100% { opacity: 0 }
}

@keyframes tmcut-motion-fade-in {
  0% { opacity: 0 }
  60% { opacity: 1 }
  100% { opacity: 1 }
}

@keyframes tmcut-motion-fade-out {
  0% { opacity: 1 }
  60% { opacity: 1 }
  100% { opacity: 0 }
}

@keyframes tmcut-motion-zoom-in {
  0% { transform: scale(0.55); opacity: 0 }
  60% { transform: scale(1); opacity: 1 }
  100% { transform: scale(1); opacity: 1 }
}

@keyframes tmcut-motion-zoom-out {
  0% { transform: scale(1.3); opacity: 1 }
  60% { transform: scale(1); opacity: 1 }
  100% { transform: scale(1); opacity: 1 }
}

@media (prefers-reduced-motion: reduce) {
  .tmcut-motion-fade,
  .tmcut-motion-fade-in,
  .tmcut-motion-fade-out,
  .tmcut-motion-zoom-in,
  .tmcut-motion-zoom-out {
    animation: none;
  }
}
</style>
