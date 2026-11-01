<script setup lang="ts">
import type { HubDocsContent } from '#shared/docs/content'
import type { DocsArticle } from '~/types/docs'

const props = defineProps<{
  article: DocsArticle
  appBaseName: string
  appDisplayId: string
}>()

const { t } = useI18n()

function isHubDocsContent(data: unknown): data is HubDocsContent {
  if (!data || typeof data !== 'object') return false
  const en = (data as { en?: Record<string, unknown> }).en
  return !!en && Array.isArray(en.apis) && Array.isArray(en.architecture)
}

const reference = computed(() => (isHubDocsContent(props.article.data) ? props.article.data : null))
const markdownSource = computed(() => (props.article.contentType === 'markdown' ? String(props.article.data ?? '') : ''))
const htmlSource = computed(() => (props.article.contentType === 'html' ? String(props.article.data ?? '') : ''))
const textSource = computed(() => (props.article.contentType === 'text' ? String(props.article.data ?? '') : ''))
const jsonSource = computed(() => (props.article.contentType === 'json' && !reference.value
  ? JSON.stringify(props.article.data ?? null, null, 2)
  : ''))
</script>

<template>
  <DocsSystemReference
    v-if="reference"
    :content="reference"
    :app-base-name="appBaseName"
    :app-display-id="appDisplayId"
  />

  <DocsMarkdown
    v-else-if="article.contentType === 'markdown'"
    :source="markdownSource"
  />

  <!-- Hub articles are authored by admins, but a sandboxed frame keeps a pasted
       <script> from running inside the studio origin. -->
  <iframe
    v-else-if="article.contentType === 'html'"
    :srcdoc="htmlSource"
    sandbox=""
    :title="article.title"
    class="w-full min-h-[70vh] rounded-lg border border-default bg-default"
  />

  <pre
    v-else-if="textSource"
    class="whitespace-pre-wrap break-words rounded-lg border border-default bg-elevated p-4 text-xs leading-relaxed text-toned"
  >{{ textSource }}</pre>

  <pre
    v-else
    class="overflow-x-auto rounded-lg border border-default bg-elevated p-4 text-xs leading-relaxed text-toned"
  >{{ jsonSource || t('docs.emptyArticle') }}</pre>
</template>
