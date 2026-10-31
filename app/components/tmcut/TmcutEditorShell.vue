<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

// Navigation items for TMCut
const navItems = ref([
  { label: t('nav.tmcut_editor'), icon: 'i-lucide-film', to: '/tmcut/editor' },
  { label: t('nav.tmcut_templates'), icon: 'i-lucide-layout-template', to: '/tmcut/templates' },
  { label: t('nav.tmcut_factory'), icon: 'i-lucide-factory', to: '/tmcut/factory' },
  { label: t('nav.tmcut_html_video'), icon: 'i-lucide-code-2', to: '/tmcut/html-video' },
  { label: t('nav.tmcut_voice'), icon: 'i-lucide-audio-lines', to: '/tmcut/voice' },
  { label: t('nav.tmcut_autocut'), icon: 'i-lucide-scissors', to: '/tmcut/autocut' }
])
</script>

<template>
  <div class="flex h-screen w-full bg-neutral-50 dark:bg-neutral-950">
    <!-- Sidebar -->
    <aside class="w-64 border-r border-neutral-200 dark:border-neutral-800 flex flex-col p-4 bg-white dark:bg-neutral-900">
      <div class="flex items-center gap-2 mb-6">
        <UIcon name="i-lucide-clapperboard" class="w-6 h-6 text-primary" />
        <div>
          <h2 class="font-bold text-lg leading-tight">
            {{ t('nav.tmcut') }}
          </h2>
          <p class="text-[10px] text-neutral-500 dark:text-neutral-400 uppercase tracking-widest font-semibold">
            {{ t('tmcut.editor') }}
          </p>
        </div>
      </div>

      <nav class="flex-1">
        <ul class="flex flex-col space-y-1">
          <li v-for="(item, idx) in navItems" :key="idx">
            <NuxtLink :to="item.to" class="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:text-neutral-100 dark:hover:bg-neutral-800">
              <UIcon :name="item.icon" class="w-4 h-4" />
              <span>{{ item.label }}</span>
            </NuxtLink>
          </li>
        </ul>
      </nav>

      <div class="mt-4 pt-3 border-t border-neutral-100 dark:border-neutral-800 text-xs text-neutral-500 dark:text-neutral-400">
        TM Tools Desktop
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 overflow-y-auto p-6">
      <div class="max-w-5xl mx-auto">
        <div class="card mb-6">
          <div class="flex items-center justify-between pb-4 border-b border-neutral-200 dark:border-neutral-800">
            <div>
              <h3 class="font-medium text-lg">
                {{ t('tmcut.project') }}
              </h3>
              <p class="text-sm text-neutral-500">
                Video Editor
              </p>
            </div>
            <div class="flex items-center gap-2">
              <UButton icon="i-lucide-plus" size="sm" />
              <UButton icon="i-lucide-folder-open" size="sm" variant="ghost" />
            </div>
          </div>

          <p class="text-neutral-500 dark:text-neutral-400 text-sm mt-3">
            Create or import a project to start editing.
          </p>
        </div>

        <!-- Editor Layout -->
        <div class="grid lg:grid-cols-2 gap-6">
          <!-- Preview -->
          <div>
            <UCard>
              <template #header>
                <h3 class="font-medium">
                  {{ t('tmcut.preview') }}
                </h3>
              </template>
              <TmcutPreviewPlayer />
            </UCard>
          </div>

          <!-- Timeline -->
          <div>
            <UCard>
              <template #header>
                <h3 class="font-medium">
                  {{ t('tmcut.timeline') }}
                </h3>
              </template>
              <TmcutTimeline />
            </UCard>
          </div>
        </div>

        <!-- Inspector -->
        <div class="w-full mt-6">
          <UCard class="h-fit">
            <template #header>
              <h3 class="font-medium">
                {{ t('tmcut.inspector') }}
              </h3>
            </template>
            <p class="text-neutral-500 text-sm">
              Select a clip on the timeline to inspect and edit properties.
            </p>
          </UCard>
        </div>
      </div>
    </main>
  </div>
</template>
