<script setup lang="ts">
import { getErrorMessage } from '~/shared/utils/errors'
import type { InboxDetail, InboxItem, InboxProfile } from '~/types/inbox'
import type { HeaderAction } from '~/components/base/HeaderActions.vue'
import { parseAddress } from '~/utils/inboxHtml'

definePageMeta({
  alias: ['/inbox']
})

const { t } = useI18n()
const notify = useNotify()
const { hubFetch, appId: hubAppId } = useHub()
const { title, description } = useAdminPageChrome({
  titleKey: 'inbox.title',
  descKey: 'inbox.description'
})
const mobileBar = useMobileBar()

const appId = computed(() => hubAppId)

const profile = ref<InboxProfile | null>(null)
const connected = computed(() => !!profile.value?.connected)

const activeFolder = ref('inbox')
const activeFilterTab = ref('all')

const messages = ref<InboxItem[]>([])
const nextPageToken = ref<string | null>(null)
const listLoading = ref(false)
const threadLoading = ref(false)

const q = ref('')
const searchInput = ref('')

const selectedId = ref<string | null>(null)
const thread = ref<InboxDetail[]>([])

// Modals
const isComposeOpen = ref(false)
const isTrashModalOpen = ref(false)
const trashTargetIds = ref<string[]>([])

const base = computed(() =>
  appId.value ? `/api/v1/apps/${encodeURIComponent(appId.value)}/mail/inbox` : ''
)

function buildQuery(): string {
  const parts: string[] = []

  const folderQueries: Record<string, string> = {
    inbox: 'in:inbox',
    starred: 'is:starred',
    sent: 'in:sent',
    drafts: 'in:draft',
    spam: 'in:spam',
    trash: 'in:trash'
  }
  const fq = folderQueries[activeFolder.value]
  if (fq) parts.push(fq)

  if (activeFilterTab.value === 'unread') {
    parts.push('is:unread')
  } else if (activeFilterTab.value === 'attachment') {
    parts.push('has:attachment')
  }

  if (q.value.trim()) {
    parts.push(q.value.trim())
  }

  return parts.join(' ')
}

async function loadProfile() {
  if (!base.value) return
  try {
    const res = await hubFetch<{ success: boolean, data: InboxProfile }>(`${base.value}/profile`)
    profile.value = res.data
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  }
}

async function loadMessages(reset = true) {
  if (!base.value) return
  listLoading.value = true
  try {
    const query: Record<string, string> = { maxResults: '20' }
    const fullQuery = buildQuery()
    if (fullQuery) query.q = fullQuery
    if (!reset && nextPageToken.value) query.pageToken = nextPageToken.value

    const res = await hubFetch<{ success: boolean, data: { items: InboxItem[], nextPageToken: string | null } }>(
      `${base.value}/messages`,
      { query }
    )
    messages.value = reset ? res.data.items : [...messages.value, ...res.data.items]
    nextPageToken.value = res.data.nextPageToken
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    listLoading.value = false
  }
}

function onSelectFolder(folderId: string) {
  activeFolder.value = folderId
  selectedId.value = null
  thread.value = []
  nextPageToken.value = null
  loadMessages(true)
}

function onSelectFilterTab(tab: string) {
  activeFilterTab.value = tab
  selectedId.value = null
  thread.value = []
  nextPageToken.value = null
  loadMessages(true)
}

function runSearch() {
  q.value = searchInput.value.trim()
  nextPageToken.value = null
  loadMessages(true)
}

function clearSearch() {
  searchInput.value = ''
  q.value = ''
  nextPageToken.value = null
  loadMessages(true)
}

async function openMessage(item: InboxItem) {
  selectedId.value = item.id
  threadLoading.value = true
  thread.value = []
  try {
    const res = await hubFetch<{ success: boolean, data: { id: string, messages: InboxDetail[] } }>(
      `${base.value}/threads/${encodeURIComponent(item.threadId)}`
    )
    thread.value = res.data.messages
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    threadLoading.value = false
  }
}

function backToList() {
  selectedId.value = null
  thread.value = []
}

function syncListItem(id: string, patch: Partial<InboxItem>) {
  const item = messages.value.find(m => m.id === id)
  if (item) Object.assign(item, patch)
}

async function setLabels(messageId: string, add: string[], remove: string[]) {
  const res = await hubFetch<{ success: boolean, data: InboxItem }>(
    `${base.value}/messages/${encodeURIComponent(messageId)}/labels`,
    { method: 'POST', body: { addLabelIds: add, removeLabelIds: remove } }
  )
  return res.data
}

async function toggleUnread(message: InboxItem | InboxDetail) {
  try {
    const add = message.unread ? [] : ['UNREAD']
    const remove = message.unread ? ['UNREAD'] : []
    const updated = await setLabels(message.id, add, remove)
    message.unread = updated.unread
    message.labels = updated.labels
    syncListItem(message.id, { unread: updated.unread, labels: updated.labels })
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  }
}

async function toggleStar(message: InboxItem | InboxDetail) {
  try {
    const add = message.starred ? [] : ['STARRED']
    const remove = message.starred ? ['STARRED'] : []
    const updated = await setLabels(message.id, add, remove)
    message.starred = updated.starred
    message.labels = updated.labels
    syncListItem(message.id, { starred: updated.starred, labels: updated.labels })
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  }
}

// Batch Actions
async function batchMarkRead(ids: string[]) {
  if (!ids.length) return
  try {
    await hubFetch(`${base.value}/messages/${encodeURIComponent(ids.join(','))}/labels`, {
      method: 'POST',
      body: { removeLabelIds: ['UNREAD'] }
    })
    for (const id of ids) {
      syncListItem(id, { unread: false })
    }
    notify.success(t('inbox.batchMarkRead'))
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  }
}

async function batchMarkUnread(ids: string[]) {
  if (!ids.length) return
  try {
    await hubFetch(`${base.value}/messages/${encodeURIComponent(ids.join(','))}/labels`, {
      method: 'POST',
      body: { addLabelIds: ['UNREAD'] }
    })
    for (const id of ids) {
      syncListItem(id, { unread: true })
    }
    notify.success(t('inbox.batchMarkUnread'))
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  }
}

async function batchStar(ids: string[]) {
  if (!ids.length) return
  try {
    await hubFetch(`${base.value}/messages/${encodeURIComponent(ids.join(','))}/labels`, {
      method: 'POST',
      body: { addLabelIds: ['STARRED'] }
    })
    for (const id of ids) {
      syncListItem(id, { starred: true })
    }
    notify.success(t('inbox.batchStar'))
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  }
}

async function batchUnstar(ids: string[]) {
  if (!ids.length) return
  try {
    await hubFetch(`${base.value}/messages/${encodeURIComponent(ids.join(','))}/labels`, {
      method: 'POST',
      body: { removeLabelIds: ['STARRED'] }
    })
    for (const id of ids) {
      syncListItem(id, { starred: false })
    }
    notify.success(t('inbox.batchUnstar'))
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  }
}

function confirmTrashSingle(item: InboxItem | InboxDetail) {
  trashTargetIds.value = [item.id]
  isTrashModalOpen.value = true
}

function confirmTrashBatch(ids: string[]) {
  trashTargetIds.value = ids
  isTrashModalOpen.value = true
}

async function executeTrash() {
  const ids = trashTargetIds.value
  if (!ids.length) return
  try {
    await hubFetch(`${base.value}/messages/${encodeURIComponent(ids.join(','))}/trash`, {
      method: 'POST'
    })
    messages.value = messages.value.filter(m => !ids.includes(m.id))
    if (selectedId.value && ids.includes(selectedId.value)) {
      selectedId.value = null
      thread.value = []
    }
    notify.success(t('inbox.batchTrash'))
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    isTrashModalOpen.value = false
    trashTargetIds.value = []
  }
}

async function sendReply(body: string) {
  const first = thread.value[0]
  if (!first) return
  const subject = /^re:/i.test(first.subject || '') ? first.subject : `Re: ${first.subject || t('inbox.noSubject')}`
  try {
    await hubFetch(`${base.value}/messages/send`, {
      method: 'POST',
      body: {
        to: parseAddress(first.from).email,
        subject,
        body,
        threadId: first.threadId
      }
    })
    notify.success(t('inbox.replySent'))
    await openMessage({ ...first })
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  }
}

async function downloadAttachment(message: InboxDetail, attachmentId: string, filename: string, mimeType: string) {
  try {
    const buffer = await hubFetch<ArrayBuffer>(
      `${base.value}/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(attachmentId)}`,
      { query: { filename, mimeType }, responseType: 'arraybuffer' } as never
    )
    const blob = new Blob([buffer], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  }
}

// Watch selection to load thread
watch(selectedId, (id) => {
  if (!id) return
  const msg = messages.value.find(m => m.id === id)
  if (msg) openMessage(msg)
})

const activeFolderLabel = computed(() => {
  const map: Record<string, string> = {
    inbox: t('inbox.folderInbox'),
    starred: t('inbox.folderStarred'),
    sent: t('inbox.folderSent'),
    drafts: t('inbox.folderDrafts'),
    spam: t('inbox.folderSpam'),
    trash: t('inbox.folderTrash')
  }
  return map[activeFolder.value] || t('inbox.folderInbox')
})

const activeFolderIcon = computed(() => {
  const map: Record<string, string> = {
    inbox: 'i-lucide-inbox',
    starred: 'i-lucide-star',
    sent: 'i-lucide-send',
    drafts: 'i-lucide-file-text',
    spam: 'i-lucide-alert-circle',
    trash: 'i-lucide-trash-2'
  }
  return map[activeFolder.value] || 'i-lucide-inbox'
})

const folderDropdownItems = computed(() => [
  [
    { label: t('inbox.folderInbox'), icon: 'i-lucide-inbox', onSelect: () => onSelectFolder('inbox') },
    { label: t('inbox.folderStarred'), icon: 'i-lucide-star', onSelect: () => onSelectFolder('starred') },
    { label: t('inbox.folderSent'), icon: 'i-lucide-send', onSelect: () => onSelectFolder('sent') },
    { label: t('inbox.folderDrafts'), icon: 'i-lucide-file-text', onSelect: () => onSelectFolder('drafts') },
    { label: t('inbox.folderSpam'), icon: 'i-lucide-alert-circle', onSelect: () => onSelectFolder('spam') },
    { label: t('inbox.folderTrash'), icon: 'i-lucide-trash-2', onSelect: () => onSelectFolder('trash') }
  ]
])

const headerActions = computed<HeaderAction[]>(() => [
  {
    key: 'refresh',
    icon: 'i-lucide-refresh-cw',
    label: t('common.refresh'),
    onSelect: () => { loadProfile(); loadMessages(true) }
  }
])

mobileBar.registerActions(computed(() => [
  ...headerActionsToMobile(headerActions.value)
]))

onMounted(() => {
  loadProfile().then(() => {
    if (connected.value) loadMessages(true)
  })
})

watch(appId, (next) => {
  if (!next) return
  profile.value = null
  messages.value = []
  selectedId.value = null
  thread.value = []
  loadProfile().then(() => {
    if (connected.value) loadMessages(true)
  })
})

useHead({ title })
</script>

<template>
  <BasePage
    id="inbox"
    flush
    :title="title"
    :description="description"
  >
    <template #right>
      <div class="flex items-center gap-2">
        <UBadge
          v-if="profile"
          :label="connected && profile.email ? profile.email : t('inbox.notConnected')"
          :color="connected ? 'success' : 'neutral'"
          variant="subtle"
          size="sm"
          class="max-w-56 truncate"
        />

        <BaseHeaderActions :actions="headerActions" />
      </div>
    </template>

    <div class="flex-1 min-h-0 flex flex-col w-full h-full overflow-hidden">
      <!-- Disconnected State Alert -->
      <div v-if="profile && !connected" class="flex-1 flex items-center justify-center p-6">
        <UAlert
          color="info"
          variant="subtle"
          icon="i-lucide-plug"
          :title="t('inbox.notConnectedTitle')"
          :description="t('inbox.notConnectedDesc')"
          class="max-w-lg shadow-xs"
        >
          <template #actions>
            <UButton
              :label="t('inbox.goToConnections')"
              icon="i-lucide-plug"
              size="sm"
              color="primary"
              variant="soft"
              @click="navigateTo('/resources/connections')"
            />
          </template>
        </UAlert>
      </div>

      <!-- Connected State: 3-column Full Flush Client -->
      <div
        v-else-if="connected"
        class="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[220px_minmax(320px,380px)_1fr] border-t border-default bg-default"
      >
        <!-- 1. Left Folder Sidebar (Desktop) -->
        <div class="hidden lg:block min-h-0">
          <InboxSidebar
            :profile="profile"
            :connected="connected"
            :active-folder="activeFolder"
            @update:active-folder="onSelectFolder"
            @compose="isComposeOpen = true"
          />
        </div>

        <!-- 2. Middle Message List Column -->
        <div
          class="flex flex-col min-h-0 border-b lg:border-b-0 lg:border-r border-default"
          :class="selectedId ? 'hidden lg:flex' : 'flex'"
        >
          <div class="flex-1 min-h-0">
            <InboxList
              v-model:selected-id="selectedId"
              v-model:search="searchInput"
              :messages="messages"
              :loading="listLoading"
              :filter-tab="activeFilterTab"
              :active-query="q"
              :folder-dropdown-items="folderDropdownItems"
              :active-folder-label="activeFolderLabel"
              :active-folder-icon="activeFolderIcon"
              @update:filter-tab="onSelectFilterTab"
              @search="runSearch"
              @clear-search="clearSearch"
              @compose="isComposeOpen = true"
              @toggle-star="toggleStar"
              @toggle-unread="toggleUnread"
              @trash="confirmTrashSingle"
              @batch-mark-read="batchMarkRead"
              @batch-mark-unread="batchMarkUnread"
              @batch-star="batchStar"
              @batch-unstar="batchUnstar"
              @batch-trash="confirmTrashBatch"
              @refresh="() => loadMessages(true)"
            />
          </div>

          <!-- Bottom Pagination / Load More -->
          <div v-if="nextPageToken" class="p-2 border-t border-default flex justify-center shrink-0 bg-elevated/20">
            <UButton
              :label="t('inbox.loadMore')"
              icon="i-lucide-chevron-down"
              color="neutral"
              variant="soft"
              size="xs"
              :loading="listLoading"
              @click="loadMessages(false)"
            />
          </div>
        </div>

        <!-- 3. Right Reading Pane / Message Thread -->
        <div class="min-h-0" :class="selectedId ? 'block' : 'hidden lg:block'">
          <InboxMail
            v-if="selectedId"
            :thread="thread"
            :loading="threadLoading"
            @back="backToList"
            @reply="sendReply"
            @toggle-unread="toggleUnread"
            @toggle-star="toggleStar"
            @trash="confirmTrashSingle"
            @download="(msg, attId, filename, mimeType) => downloadAttachment(msg, attId, filename, mimeType)"
          />

          <!-- Empty Reading Pane State -->
          <div
            v-else
            class="hidden lg:flex flex-col h-full items-center justify-center p-8 text-center bg-elevated/10 space-y-3 select-none"
          >
            <div
              class="size-16 rounded-2xl bg-elevated/80 border border-default flex items-center justify-center text-muted shadow-xs"
            >
              <UIcon name="i-lucide-mail" class="size-8 text-dimmed" />
            </div>
            <div>
              <h3 class="font-semibold text-highlighted text-sm sm:text-base">
                {{ t('inbox.selectPrompt') }}
              </h3>
              <p class="text-xs text-muted max-w-sm mt-1">
                {{ t('inbox.shortcutTip') }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Skeletons while loading initial profile -->
      <div v-else class="flex-1 min-h-60 flex items-center justify-center p-8">
        <USkeleton class="w-full h-full" />
      </div>
    </div>

    <!-- Compose Modal -->
    <InboxComposeModal v-model:open="isComposeOpen" :base="base" @sent="() => loadMessages(true)" />

    <!-- Trash Confirmation Modal -->
    <BaseConfirmModal
      v-model:open="isTrashModalOpen"
      :title="t('inbox.deleteConfirm')"
      :description="t('inbox.deleteConfirmDesc', [trashTargetIds.length])"
      color="error"
      confirm-icon="i-lucide-trash-2"
      :confirm-label="t('inbox.batchTrash')"
      @confirm="executeTrash"
    />
  </BasePage>
</template>
