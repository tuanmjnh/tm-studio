<script setup lang="ts">
const { t } = useI18n()
const open = defineModel<boolean>('open', { default: false })

const electronVersions = computed(() => window.electronAPI?.versions || { node: '', chrome: '', electron: '' })
const isElectron = computed(() => !!window.electronAPI?.isElectron)

const faqItems = computed(() => [
  {
    q: t('help.faq_q1'),
    a: t('help.faq_a1')
  },
  {
    q: t('help.faq_q2'),
    a: t('help.faq_a2')
  },
  {
    q: t('help.faq_q3'),
    a: t('help.faq_a3')
  }
])

const shortcuts = computed(() => [
  { keys: ['Ctrl', 'K'], desc: t('help.shortcut_search') },
  { keys: ['Ctrl', 'S'], desc: t('help.shortcut_settings') },
  { keys: ['Ctrl', 'H'], desc: t('help.shortcut_help') }
])
</script>

<template>
  <BaseResponsiveModal
    v-model:open="open"
    :title="t('help.title')"
    :description="t('help.desc')"
    class="sm:max-w-xl"
  >
    <template #body>
      <div class="space-y-6 overflow-y-auto max-h-[70vh] px-1 custom-scrollbar">
        <!-- FAQ Section -->
        <div class="space-y-3">
          <h4 class="text-xs font-semibold uppercase tracking-wider text-primary">
            {{ t('help.faq') }}
          </h4>
          <div class="divide-y divide-default border-y border-default">
            <details v-for="(item, idx) in faqItems" :key="idx" class="group py-3">
              <summary
                class="flex justify-between items-center cursor-pointer list-none outline-none text-highlighted font-medium hover:text-primary transition-colors duration-150"
              >
                <span>{{ item.q }}</span>
                <UIcon
                  name="i-lucide-chevron-down"
                  class="size-4 text-muted group-open:rotate-180 transition-transform duration-200"
                />
              </summary>
              <p class="mt-2 text-sm text-muted leading-relaxed pl-1">
                {{ item.a }}
              </p>
            </details>
          </div>
        </div>

        <!-- Shortcuts Section -->
        <div class="space-y-3">
          <h4 class="text-xs font-semibold uppercase tracking-wider text-primary">
            {{ t('help.shortcuts') }}
          </h4>
          <div class="grid grid-cols-1 gap-2">
            <div
              v-for="(sc, idx) in shortcuts"
              :key="idx"
              class="flex items-center justify-between py-1.5 border-b border-default last:border-b-0 text-sm"
            >
              <span class="text-muted">{{ sc.desc }}</span>
              <div class="flex items-center gap-1">
                <kbd
                  v-for="k in sc.keys"
                  :key="k"
                  class="px-1.5 py-0.5 text-xs font-mono font-semibold rounded bg-muted text-highlighted border border-default shadow-[0_1px_0_0px_rgba(0,0,0,0.1)]"
                >
                  {{ k }}
                </kbd>
              </div>
            </div>
          </div>
        </div>

        <!-- Diagnostics Section -->
        <div class="space-y-3">
          <h4 class="text-xs font-semibold uppercase tracking-wider text-primary">
            {{ t('help.diagnostics') }}
          </h4>
          <div class="p-3.5 rounded-lg border border-default bg-muted/10 font-mono text-xs space-y-1.5">
            <div class="flex justify-between">
              <span class="text-muted">Application:</span>
              <span class="text-highlighted">TM Tools v1.0.0</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted">Runtime:</span>
              <span class="text-highlighted">{{ isElectron ? 'Electron Desktop' : 'Web Browser' }}</span>
            </div>
            <div v-if="isElectron" class="flex justify-between">
              <span class="text-muted">Electron Version:</span>
              <span class="text-highlighted">{{ electronVersions.electron }}</span>
            </div>
            <div v-if="isElectron" class="flex justify-between">
              <span class="text-muted">Chrome Version:</span>
              <span class="text-highlighted">{{ electronVersions.chrome }}</span>
            </div>
            <div v-if="isElectron" class="flex justify-between">
              <span class="text-muted">Node.js Version:</span>
              <span class="text-highlighted">{{ electronVersions.node }}</span>
            </div>
          </div>
        </div>

        <!-- External Link -->
        <div class="pt-2 flex justify-center">
          <UButton
            to="https://github.com/nuxt-ui-templates/dashboard"
            target="_blank"
            icon="i-lucide-external-link"
            variant="link"
            color="neutral"
            size="sm"
            :label="t('help.doc_link')"
          />
        </div>
      </div>
    </template>
  </BaseResponsiveModal>
</template>
