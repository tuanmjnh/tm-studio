<script setup lang="ts">
import {
  docsSdkDescriptionFor,
  docsUsageCodeFor,
  type DocsRoadmapStatus,
  type HubDocsContent
} from '#shared/docs/content'

const props = defineProps<{
  content: HubDocsContent
  appBaseName: string
  appDisplayId: string
}>()

const { t, locale } = useI18n()
const { copy } = useClipboard()

const copiedKey = ref('')
const searchQuery = ref('')
const selectedModule = ref('ALL')

const section = computed(() => (locale.value === 'vi' ? props.content.vi : props.content.en))
const apis = computed(() => section.value.apis)

const modulesList = computed(() => {
  const set = new Set(apis.value.map(api => api.module))
  return ['ALL', ...Array.from(set)]
})

const filteredApis = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return apis.value.filter((api) => {
    const matchModule = selectedModule.value === 'ALL' || api.module === selectedModule.value
    const matchQuery = !query
      || api.path.toLowerCase().includes(query)
      || api.desc.toLowerCase().includes(query)
      || api.module.toLowerCase().includes(query)
    return matchModule && matchQuery
  })
})

async function copyCode(key: string, code: string) {
  await copy(code)
  copiedKey.value = key
  setTimeout(() => {
    if (copiedKey.value === key) copiedKey.value = ''
  }, POLLING.uiResetMs)
}

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
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
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

      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div
          v-for="item in section.roadmap.items"
          :key="item.phase"
          class="rounded-lg border border-default p-3 space-y-2"
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

    <UCard v-if="section.setupGuide">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-book-open-check" class="w-4 h-4 text-primary" />
          <h3 class="font-semibold text-sm">
            {{ section.setupGuide.title }}
          </h3>
        </div>
        <p class="text-xs text-muted mt-1">
          {{ section.setupGuide.description }}
        </p>
      </template>

      <div class="space-y-4">
        <div
          v-for="(step, index) in section.setupGuide.steps"
          :key="index"
          class="rounded-lg border border-default p-4 space-y-2"
        >
          <h4 class="text-xs font-semibold text-highlighted flex items-center gap-2">
            <span class="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">{{ index + 1 }}</span>
            {{ step.title }}
          </h4>
          <p class="text-xs text-muted leading-relaxed">
            {{ step.desc }}
          </p>
          <div v-if="step.code" class="overflow-hidden rounded-lg bg-neutral-900 dark:bg-elevated text-dimmed mt-2">
            <div class="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-1">
              <span class="text-[10px] font-semibold uppercase tracking-wider text-dimmed">Config / Shell</span>
              <UButton
                :icon="copiedKey === 'step_' + index ? 'i-lucide-check' : 'i-lucide-copy'"
                color="neutral"
                variant="ghost"
                size="xs"
                class="text-dimmed hover:text-white"
                :aria-label="copiedKey === 'step_' + index ? t('common.copied') : t('common.copy')"
                @click="copyCode('step_' + index, step.code)"
              />
            </div>
            <pre class="p-3 text-xs overflow-x-auto font-mono"><code>{{ step.code }}</code></pre>
          </div>
        </div>
      </div>
    </UCard>

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
        <p class="text-xs text-toned">
          {{ docsSdkDescriptionFor(section.sdk.description, props.appBaseName) }}
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
            class="overflow-hidden rounded-lg bg-neutral-900 dark:bg-elevated text-dimmed"
          >
            <div class="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-1">
              <span class="text-[10px] font-semibold uppercase tracking-wider text-dimmed">
                {{ command.label }}
              </span>
              <UButton
                :icon="copiedKey === command.label ? 'i-lucide-check' : 'i-lucide-copy'"
                color="neutral"
                variant="ghost"
                size="xs"
                class="text-dimmed hover:text-white"
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

        <div class="overflow-hidden rounded-lg bg-neutral-900 dark:bg-elevated text-dimmed">
          <div class="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-1">
            <span class="text-[10px] font-semibold uppercase tracking-wider text-dimmed">TypeScript</span>
            <UButton
              :icon="copiedKey === 'usage' ? 'i-lucide-check' : 'i-lucide-copy'"
              color="neutral"
              variant="ghost"
              size="xs"
              class="text-dimmed hover:text-white"
              :aria-label="copiedKey === 'usage' ? section.sdk.copiedLabel : section.sdk.copyLabel"
              @click="copyCode('usage', docsUsageCodeFor(section.sdk.usageCode, props.appDisplayId, 'NUXT_PUBLIC_HUB_URL'))"
            />
          </div>
          <pre class="p-4 text-xs overflow-x-auto font-mono"><code>{{ docsUsageCodeFor(section.sdk.usageCode, props.appDisplayId, 'NUXT_PUBLIC_HUB_URL') }}</code></pre>
        </div>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-network" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">
                {{ section.api.title }}
              </h3>
            </div>
            <UBadge :label="section.api.prefixLabel" variant="subtle" size="xs" />
          </div>
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
            <UInput
              v-model="searchQuery"
              icon="i-lucide-search"
              :placeholder="t('docs.searchPlaceholder')"
              :aria-label="t('docs.searchPlaceholder')"
              size="sm"
              class="flex-1"
            />
            <USelect
              v-model="selectedModule"
              :items="modulesList.map(module => ({ label: module === 'ALL' ? t('docs.allModules') : module, value: module }))"
              :aria-label="t('docs.moduleFilter')"
              size="sm"
              class="sm:w-44"
            />
            <UBadge
              :label="t('docs.endpointsCount', { filtered: filteredApis.length, total: apis.length })"
              variant="subtle"
              size="sm"
              class="self-start sm:self-auto"
            />
          </div>
        </div>
      </template>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs border-collapse">
          <thead>
            <tr class="border-b border-default text-muted font-medium">
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
          <tbody class="divide-y divide-default">
            <tr
              v-for="api in filteredApis"
              :key="api.path + api.method"
              class="hover:bg-muted/50 transition-colors"
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
            <tr v-if="!filteredApis.length">
              <td colspan="4" class="py-6 text-center text-muted">
                {{ t('docs.noEndpoints') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </div>
</template>
