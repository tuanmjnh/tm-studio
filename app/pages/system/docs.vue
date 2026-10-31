<script setup lang="ts">
import { docsSdkDescriptionFor, docsUsageCodeFor, HUB_DOCS_CONTENT, type HubDocsContent, type DocsRoadmapStatus } from '#shared/docs/content'
import { getErrorMessage } from '~/shared/utils/errors'

const { t, locale } = useI18n()
const notify = useNotify()

const { title, description } = useAdminPageChrome({
  titleKey: 'nav.docs',
  descKey: 'docs.description'
})

useHead({ title })

// Single source of truth lives in tm-hub (`shared/docs/content.ts`), served by
// GET /api/v1/apps/:appId/docs. This frozen copy is only used while the hub is
// unreachable so the page still renders when offline.
const content = ref<HubDocsContent>(HUB_DOCS_CONTENT)
const reloading = ref(false)
const { hubFetch, appId } = useHub()

const appBaseName = computed(() => String(appId ?? '').split('_')[0] || 'tm-tools')
const appDisplayId = computed(() => String(appId ?? '') || 'tm-tools')

async function fetchDocsContent() {
  if (import.meta.server) return
  reloading.value = true
  try {
    const res = await hubFetch<{ success: boolean, data: HubDocsContent }>(
      `/api/v1/apps/${encodeURIComponent(appDisplayId.value)}/docs`
    )
    if (res.success && res.data) content.value = res.data
  } catch (err) {
    // Fallback copy keeps the page usable when tm-hub is unreachable.
    notify.error(t('nav.docs'), getErrorMessage(err, key => t(key)))
  } finally {
    reloading.value = false
  }
}

const section = computed(() => (locale.value === 'vi' ? content.value.vi : content.value.en))

const { copy } = useClipboard()
const copiedKey = ref('')

async function copyCode(key: string, code: string) {
  await copy(code)
  copiedKey.value = key
  setTimeout(() => {
    if (copiedKey.value === key) copiedKey.value = ''
  }, 1500)
}

const apis = computed(() => section.value.apis)

const searchQuery = ref('')
const selectedModule = ref('ALL')

const modulesList = computed(() => {
  const set = new Set(apis.value.map(a => a.module))
  return ['ALL', ...Array.from(set)]
})

const filteredApis = computed(() => {
  return apis.value.filter((api) => {
    const matchModule = selectedModule.value === 'ALL' || api.module === selectedModule.value
    const q = searchQuery.value.trim().toLowerCase()
    const matchQuery = !q
      || api.path.toLowerCase().includes(q)
      || api.desc.toLowerCase().includes(q)
      || api.module.toLowerCase().includes(q)
    return matchModule && matchQuery
  })
})

function getMethodBadgeColor(method: string) {
  switch (method) {
    case 'GET': return 'success'
    case 'POST': return 'primary'
    case 'PUT':
    case 'PATCH': return 'warning'
    case 'DELETE': return 'error'
    default: return 'neutral'
  }
}

function roadmapColor(status: DocsRoadmapStatus): 'success' | 'warning' | 'neutral' {
  if (status === 'shipped') return 'success'
  if (status === 'in_progress') return 'warning'
  return 'neutral'
}

onMounted(fetchDocsContent)

const mobileBar = useMobileBar()
mobileBar.registerInfo(computed(() => ({
  count: filteredApis.value.length
})))
</script>

<template>
  <BasePage id="docs" :title="title" :description="description">
    <template #right>
      <div class="flex items-center gap-2">
        <UButton
          to="/system/hub-integration"
          icon="i-lucide-radio-tower"
          color="primary"
          variant="soft"
          size="sm"
          :label="t('nav.hub_integration', 'Kết Nối Hub')"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="ghost"
          size="sm"
          :loading="reloading"
          @click="fetchDocsContent"
        />
      </div>
    </template>

    <template #toolbar>
      <UDashboardToolbar>
        <template #left>
          <div class="flex items-center gap-2 w-full min-w-0 sm:w-auto">
            <UInput
              v-model="searchQuery"
              icon="i-lucide-search"
              :placeholder="t('docs.searchPlaceholder')"
              size="sm"
              class="flex-1 min-w-0 sm:flex-none sm:w-64"
            />
            <USelect
              v-model="selectedModule"
              :items="modulesList.map(m => ({ label: m === 'ALL' ? t('docs.allModules') : m, value: m }))"
              size="sm"
              class="w-36 shrink-0 sm:w-40"
            />
          </div>
        </template>
        <template #right>
          <div class="hidden sm:flex">
            <UBadge
              :label="t('docs.endpointsCount', { filtered: filteredApis.length, total: apis.length })"
              variant="subtle"
              size="sm"
            />
          </div>
        </template>
      </UDashboardToolbar>
    </template>

    <template #footer>
      <SharedListFooter :count="filteredApis.length" />
    </template>

    <div class="flex flex-col gap-6 w-full pb-24 lg:pb-6">
      <!-- 1. Core Architecture Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <UCard v-for="card in section.architecture" :key="card.title" :class="[card.hoverClass, 'transition-colors']">
          <div class="flex items-center gap-3">
            <div class="p-2.5 rounded-lg shrink-0" :class="card.iconClass">
              <UIcon :name="card.icon" class="flex w-5 h-5" />
            </div>
            <div class="space-y-1 min-w-0">
              <h3 class="font-semibold text-sm truncate">
                {{ card.title }}
              </h3>
              <p class="text-xs text-muted leading-relaxed line-clamp-3">
                {{ card.desc }}
              </p>
            </div>
          </div>
        </UCard>
      </div>

      <!-- 2. Provider & Connections Roadmap -->
      <UCard>
        <template #header>
          <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-map" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">
                {{ section.roadmap.title }}
              </h3>
            </div>
            <UBadge :label="section.roadmap.updatedLabel" variant="subtle" size="xs" />
          </div>
          <p class="text-xs text-muted mt-1">
            {{ section.roadmap.description }}
          </p>
        </template>

        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          <div
            v-for="item in section.roadmap.items"
            :key="item.phase"
            class="rounded-lg border border-neutral-200 dark:border-neutral-800 p-3 space-y-2"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="text-[11px] font-mono font-semibold text-muted">Phase {{ item.phase }}</span>
              <UBadge
                :label="item.statusLabel"
                :color="roadmapColor(item.status)"
                variant="subtle"
                size="xs"
              />
            </div>
            <p class="text-xs font-medium text-highlighted">
              {{ item.title }}
            </p>
            <p class="text-[11px] text-muted leading-relaxed">
              {{ item.desc }}
            </p>
          </div>
        </div>
      </UCard>

      <!-- 2.5 Setup & Configuration Guide -->
      <UCard v-if="section.setupGuide">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-book-open-check" class="w-4 h-4 text-primary" />
            <h3 class="font-semibold text-sm">{{ section.setupGuide.title }}</h3>
          </div>
          <p class="text-xs text-muted mt-1">{{ section.setupGuide.description }}</p>
        </template>

        <div class="space-y-4">
          <div v-for="(step, idx) in section.setupGuide.steps" :key="idx"
            class="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 space-y-2">
            <h4 class="text-xs font-semibold text-highlighted flex items-center gap-2">
              <span class="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">{{ idx + 1 }}</span>
              {{ step.title }}
            </h4>
            <p class="text-xs text-muted leading-relaxed">{{ step.desc }}</p>
            <div v-if="step.code" class="overflow-hidden rounded-lg bg-neutral-900 dark:bg-neutral-800 text-neutral-100 mt-2">
              <div class="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-1">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Config / Shell</span>
                <UButton :icon="copiedKey === 'step_' + idx ? 'i-lucide-check' : 'i-lucide-copy'" color="neutral"
                  variant="ghost" size="xs" class="text-neutral-400 hover:text-white"
                  @click="copyCode('step_' + idx, step.code)" />
              </div>
              <pre class="p-3 text-xs overflow-x-auto font-mono"><code>{{ step.code }}</code></pre>
            </div>
          </div>
        </div>
      </UCard>

      <!-- 3. Client SDK Usage -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-terminal" class="w-4 h-4 text-primary" />
            <h3 class="font-semibold text-sm">
              {{ section.sdk.title }}
            </h3>
          </div>
        </template>

        <div class="space-y-3">
          <p class="text-xs text-neutral-600 dark:text-neutral-300">
            {{ docsSdkDescriptionFor(section.sdk.description, appBaseName) }}
          </p>

          <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div class="space-y-0.5">
              <p class="text-xs font-medium text-highlighted">
                {{ section.sdk.install }}
              </p>
              <p class="text-[11px] text-muted">
                {{ section.sdk.installHint }}
              </p>
            </div>
            <UButton
              :to="section.sdk.githubUrl"
              target="_blank"
              rel="noopener noreferrer"
              icon="i-lucide-github"
              :label="section.sdk.githubLabel"
              variant="soft"
              color="neutral"
              size="xs"
            />
          </div>

          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div
              v-for="command in section.sdk.installCommands"
              :key="command.label"
              class="overflow-hidden rounded-lg bg-neutral-900 dark:bg-neutral-800 text-neutral-100"
            >
              <div class="flex items-center justify-between gap-2 border-b border-white/10 dark:border-white/10 px-4 py-1">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  {{ command.label }}
                </span>
                <UButton
                  :icon="copiedKey === command.label ? 'i-lucide-check' : 'i-lucide-copy'"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  class="text-neutral-400 hover:text-white"
                  :title="copiedKey === command.label ? section.sdk.copiedLabel : section.sdk.copyLabel"
                  :aria-label="copiedKey === command.label ? section.sdk.copiedLabel : section.sdk.copyLabel"
                  @click="copyCode(command.label, command.code)"
                />
              </div>
              <pre class="p-4 text-xs overflow-x-auto font-mono"><code>{{ command.code }}</code></pre>
            </div>
          </div>

          <div class="flex items-center justify-between gap-2 pt-1">
            <p class="text-xs font-medium text-highlighted">
              {{ section.sdk.usage }}
            </p>
          </div>

          <div class="overflow-hidden rounded-lg bg-neutral-900 dark:bg-neutral-800 text-neutral-100">
            <div class="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-1">
              <span class="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">TypeScript</span>
              <UButton
                :icon="copiedKey === 'usage' ? 'i-lucide-check' : 'i-lucide-copy'"
                color="neutral"
                variant="ghost"
                size="xs"
                class="text-neutral-400 hover:text-white"
                :title="copiedKey === 'usage' ? section.sdk.copiedLabel : section.sdk.copyLabel"
                :aria-label="copiedKey === 'usage' ? section.sdk.copiedLabel : section.sdk.copyLabel"
                @click="copyCode('usage', docsUsageCodeFor(section.sdk.usageCode, appDisplayId, 'NUXT_PUBLIC_HUB_URL'))"
              />
            </div>
            <pre class="p-4 text-xs overflow-x-auto font-mono"><code>{{ docsUsageCodeFor(section.sdk.usageCode, appDisplayId, 'NUXT_PUBLIC_HUB_URL') }}</code></pre>
          </div>
        </div>
      </UCard>

      <!-- 4. REST API Specifications -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-network" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">
                {{ section.api.title }}
              </h3>
            </div>
            <UBadge :label="section.api.prefixLabel" variant="subtle" size="xs" />
          </div>
        </template>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs border-collapse">
            <thead>
              <tr class="border-b border-neutral-200 dark:border-neutral-800 text-muted font-medium">
                <th class="py-2.5 px-3">
                  {{ section.api.headers.module }}
                </th>
                <th class="py-2.5 px-3">
                  {{ section.api.headers.method }}
                </th>
                <th class="py-2.5 px-3 font-mono">
                  {{ section.api.headers.endpoint }}
                </th>
                <th class="py-2.5 px-3">
                  {{ section.api.headers.description }}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-neutral-100 dark:divide-neutral-800/60">
              <tr
                v-for="api in filteredApis"
                :key="api.path + api.method"
                class="hover:bg-neutral-50/50 dark:hover:bg-neutral-900/50 transition-colors"
              >
                <td class="py-2.5 px-3 font-medium whitespace-nowrap text-highlighted">
                  {{ api.module }}
                </td>
                <td class="py-2.5 px-3 whitespace-nowrap">
                  <UBadge :color="getMethodBadgeColor(api.method)" variant="subtle" size="xs">
                    {{ api.method }}
                  </UBadge>
                </td>
                <td class="py-2.5 px-3 font-mono text-primary font-medium whitespace-nowrap">
                  {{ api.path }}
                </td>
                <td class="py-2.5 px-3 text-muted">
                  {{ api.desc }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>
    </div>
  </BasePage>
</template>
