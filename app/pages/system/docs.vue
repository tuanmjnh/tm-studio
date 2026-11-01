<script setup lang="ts">
import { formatTimeAgo } from '@vueuse/core'
import type { DocsArticle, DocsCategory, DocsContentType, HubContentRow } from '~/types/docs'
import { bundledDocsArticles } from '~/utils/docs/bundled'
import { getErrorMessage } from '~/shared/utils/errors'

definePageMeta({
  middleware: () => {
    if (import.meta.client) {
      const auth = useAuth()
      if (!auth.isAuthenticated.value) return navigateTo('/login')
    }
  }
})

const { t } = useI18n()
const notify = useNotify()
const { hubFetch, appId, hubUrl } = useHub()
const { title, description } = useAdminPageChrome({
  titleKey: 'nav.docs',
  descKey: 'docs.description'
})
useHead({ title })

const hubRows = ref<HubContentRow[]>([])
const loading = ref(false)
const loadError = ref('')
const search = ref('')
const category = ref<'all' | DocsCategory>('all')
const selectedId = ref('')

const appBaseName = computed(() => String(appId ?? '').split('_')[0] || 'tm-studio')
const appDisplayId = computed(() => String(appId ?? '') || 'tm-studio')
const hubContentUrl = computed(() => `${hubUrl}/administration/content`)

const CATEGORY_ORDER: Record<DocsCategory, number> = { guide: 0, docs: 1, custom: 2 }
const DOC_CATEGORIES = new Set(['docs', 'guide', 'custom'])

function toArticle(row: HubContentRow): DocsArticle | null {
  if (!row?.key || !row.title || row.isPublished === false) return null
  if (!DOC_CATEGORIES.has(row.category)) return null
  return {
    id: row._id ? `hub:${row._id}` : `hub:${row.key}`,
    key: row.key,
    title: row.title,
    description: row.description,
    category: row.category as DocsCategory,
    contentType: row.contentType,
    data: row.data,
    version: row.version,
    updatedAt: row.updatedAt,
    source: 'hub'
  }
}

// Bundled entries first so the page still has content offline; hub rows win on key.
const articles = computed<DocsArticle[]>(() => {
  const merged = new Map<string, DocsArticle>()
  for (const article of bundledDocsArticles(t)) merged.set(article.key, article)
  for (const article of hubRows.value.map(toArticle)) {
    if (article) merged.set(article.key, article)
  }
  return [...merged.values()]
})

function byRecency(a: DocsArticle, b: DocsArticle) {
  const byCategory = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]
  if (byCategory !== 0) return byCategory
  const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0
  const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0
  return bTime - aTime
}

const filtered = computed(() => {
  const query = search.value.trim().toLowerCase()
  return articles.value
    .filter((article) => {
      const inCategory = category.value === 'all' || article.category === category.value
      const inQuery = !query
        || article.title.toLowerCase().includes(query)
        || (article.description ?? '').toLowerCase().includes(query)
        || article.key.toLowerCase().includes(query)
      return inCategory && inQuery
    })
    .sort(byRecency)
})

const activeArticle = computed(() => filtered.value.find(article => article.id === selectedId.value)
  ?? filtered.value[0]
  ?? null)

const categoryOptions = computed(() => [
  { label: t('docs.allCategories'), value: 'all' },
  { label: t('docs.categories.guide'), value: 'guide' },
  { label: t('docs.categories.docs'), value: 'docs' },
  { label: t('docs.categories.custom'), value: 'custom' }
])

const articleOptions = computed(() => filtered.value.map(article => ({ label: article.title, value: article.id })))

function formatLabel(type: DocsContentType) {
  return type.toUpperCase()
}

function categoryIcon(value: DocsCategory) {
  if (value === 'guide') return 'i-lucide-book-open'
  if (value === 'custom') return 'i-lucide-puzzle'
  return 'i-lucide-file-text'
}

function updatedLabel(article: DocsArticle) {
  return article.updatedAt ? formatTimeAgo(new Date(article.updatedAt)) : t('docs.sourceLocal')
}

async function fetchArticles() {
  if (import.meta.server) return
  loading.value = true
  loadError.value = ''
  try {
    const res = await hubFetch<{ success: boolean, data: HubContentRow[] }>(
      `/api/v1/content?appId=${encodeURIComponent(appDisplayId.value)}`
    )
    hubRows.value = Array.isArray(res?.data) ? res.data : []
  } catch (err) {
    loadError.value = getErrorMessage(err, key => t(key))
    notify.error(t('nav.docs'), loadError.value)
  } finally {
    loading.value = false
  }
}

onMounted(fetchArticles)

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  {
    icon: 'i-lucide-refresh-cw',
    label: t('common.refresh'),
    onSelect: fetchArticles
  }
]))
mobileBar.registerInfo(computed(() => ({
  count: filtered.value.length,
  loading: loading.value
})))
</script>

<template>
  <BasePage id="docs" :title="title" :description="description">
    <template #right>
      <div class="flex items-center gap-2">
        <UButton
          :to="hubContentUrl"
          target="_blank"
          rel="noopener noreferrer"
          icon="i-lucide-settings-2"
          variant="soft"
          color="neutral"
          size="sm"
          class="hidden sm:inline-flex"
          :label="t('docs.openInHub')"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="soft"
          color="neutral"
          size="sm"
          :aria-label="t('common.refresh')"
          :loading="loading"
          @click="fetchArticles"
        />
      </div>
    </template>

    <template #toolbar>
      <UDashboardToolbar>
        <template #left>
          <div class="flex items-center gap-2 w-full min-w-0 sm:w-auto">
            <UInput
              v-model="search"
              icon="i-lucide-search"
              :aria-label="t('docs.searchArticles')"
              :placeholder="t('docs.searchArticles')"
              size="sm"
              class="flex-1 min-w-0 sm:w-64"
            />
            <USelect
              v-model="category"
              :items="categoryOptions"
              size="sm"
              class="w-32 shrink-0 sm:w-40"
              :aria-label="t('docs.allCategories')"
            />
          </div>
        </template>
        <template #right>
          <UBadge
            :label="t('docs.articlesCount', { filtered: filtered.length, total: articles.length })"
            variant="subtle"
            size="sm"
          />
        </template>
      </UDashboardToolbar>
    </template>

    <template #footer>
      <SharedListFooter :count="filtered.length" :has-more="false" :loading="loading" />
    </template>

    <div class="flex flex-col gap-4 w-full h-full min-h-0 pb-24 lg:pb-6">
      <UAlert
        v-if="loadError"
        color="warning"
        variant="subtle"
        icon="i-lucide-wifi-off"
        :title="t('docs.offlineTitle')"
        :description="loadError"
      />

      <div v-if="articleOptions.length" class="lg:hidden">
        <USelect
          v-model="selectedId"
          :items="articleOptions"
          :placeholder="activeArticle?.title || t('docs.selectArticle')"
          :aria-label="t('docs.selectArticle')"
          size="sm"
          class="w-full"
        />
      </div>

      <div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(240px,300px)_1fr]">
        <aside class="hidden lg:flex lg:flex-col lg:sticky lg:top-4 gap-1.5">
          <button
            v-for="article in filtered"
            :key="article.id"
            type="button"
            class="w-full rounded-lg border px-3 py-2.5 text-left transition-colors"
            :class="activeArticle?.id === article.id
              ? 'border-primary/40 bg-primary/5'
              : 'border-default hover:bg-muted/50'"
            :aria-current="activeArticle?.id === article.id ? 'page' : undefined"
            @click="selectedId = article.id"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="truncate text-xs font-semibold text-highlighted">{{ article.title }}</span>
              <UIcon :name="categoryIcon(article.category)" class="size-3.5 shrink-0 text-muted" />
            </div>
            <p v-if="article.description" class="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted">
              {{ article.description }}
            </p>
            <div class="mt-1.5 flex items-center gap-2">
              <UBadge
                :label="formatLabel(article.contentType)"
                variant="subtle"
                color="neutral"
                size="xs"
              />
              <span class="text-[10px] text-dimmed">{{ updatedLabel(article) }}</span>
            </div>
          </button>
        </aside>

        <section class="min-w-0">
          <UCard v-if="activeArticle">
            <template #header>
              <div class="flex flex-col gap-2">
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="text-sm font-semibold text-highlighted">
                    {{ activeArticle.title }}
                  </h2>
                  <UBadge
                    :label="formatLabel(activeArticle.contentType)"
                    variant="subtle"
                    color="neutral"
                    size="xs"
                  />
                  <UBadge
                    :label="activeArticle.source === 'hub' ? t('docs.sourceHub') : t('docs.sourceLocal')"
                    :color="activeArticle.source === 'hub' ? 'success' : 'neutral'"
                    variant="subtle"
                    size="xs"
                  />
                  <span v-if="activeArticle.updatedAt" class="text-[11px] text-dimmed">
                    {{ t('docs.updatedAt', { date: formatTimeAgo(new Date(activeArticle.updatedAt)) }) }}
                  </span>
                </div>
                <p v-if="activeArticle.description" class="text-xs leading-relaxed text-muted">
                  {{ activeArticle.description }}
                </p>
              </div>
            </template>

            <DocsArticleView
              :article="activeArticle"
              :app-base-name="appBaseName"
              :app-display-id="appDisplayId"
            />
          </UCard>

          <UEmpty
            v-else
            size="xl"
            icon="i-lucide-library-big"
            :title="t('docs.noArticlesTitle')"
            :description="t('docs.noArticlesDesc')"
            :actions="[{ label: t('common.refresh'), onClick: fetchArticles, variant: 'soft' }]"
          />
        </section>
      </div>
    </div>
  </BasePage>
</template>
