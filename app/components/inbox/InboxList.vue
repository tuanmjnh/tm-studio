<script setup lang="ts">
import { format, isToday, isYesterday } from 'date-fns'
import type { InboxItem } from '~/types/inbox'
import { parseAddress, getInitials } from '~/utils/inboxHtml'

const { t } = useI18n()

const props = defineProps<{
  messages: InboxItem[]
  loading?: boolean
  filterTab?: string
  activeQuery?: string
  folderDropdownItems?: unknown[][]
  activeFolderLabel?: string
  activeFolderIcon?: string
}>()

const emit = defineEmits<{
  'update:filterTab': [tab: string]
  'toggleStar': [item: InboxItem]
  'toggleUnread': [item: InboxItem]
  'trash': [item: InboxItem]
  'batchMarkRead': [ids: string[]]
  'batchMarkUnread': [ids: string[]]
  'batchStar': [ids: string[]]
  'batchUnstar': [ids: string[]]
  'batchTrash': [ids: string[]]
  'refresh': []
  'search': []
  'clearSearch': []
  'compose': []
}>()

const selectedId = defineModel<string | null>('selectedId', { default: null })
const search = defineModel<string>('search', { default: '' })

// Multi-select state
const selectedIds = ref<string[]>([])
const itemsRef = ref<Record<string, Element | null>>({})

// When messages change, clean up selection
watch(() => props.messages, (newMessages) => {
  const validIds = new Set(newMessages.map(m => m.id))
  selectedIds.value = selectedIds.value.filter(id => validIds.has(id))
})

const isAllSelected = computed(() => {
  return props.messages.length > 0 && selectedIds.value.length === props.messages.length
})

const isIndeterminate = computed(() => {
  return selectedIds.value.length > 0 && selectedIds.value.length < props.messages.length
})

function toggleSelectAll() {
  if (isAllSelected.value) {
    selectedIds.value = []
  } else {
    selectedIds.value = props.messages.map(m => m.id)
  }
}

function toggleSelectItem(id: string) {
  const index = selectedIds.value.indexOf(id)
  if (index > -1) {
    selectedIds.value.splice(index, 1)
  } else {
    selectedIds.value.push(id)
  }
}

watch(selectedId, () => {
  if (!selectedId.value) return
  const ref = itemsRef.value[selectedId.value]
  if (ref) ref.scrollIntoView({ block: 'nearest' })
})

const senderOf = (mail: InboxItem) => {
  const parsed = parseAddress(mail.from)
  return {
    name: parsed.name || parsed.email || t('inbox.unknownSender'),
    email: parsed.email
  }
}

function formatDateDisplay(dateStr: string | null) {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    if (isToday(d)) return format(d, 'HH:mm')
    if (isYesterday(d)) return 'Yesterday'
    return format(d, 'dd MMM')
  } catch {
    return ''
  }
}

// Quick filter tabs
const filterTabs = [
  { id: 'all', labelKey: 'inbox.all' },
  { id: 'unread', labelKey: 'inbox.unread' },
  { id: 'attachment', labelKey: 'inbox.hasAttachment' }
]

defineShortcuts({
  arrowdown: () => {
    const list = props.messages
    if (!list.length) return
    const index = list.findIndex(m => m.id === selectedId.value)
    if (index === -1) selectedId.value = list[0]?.id || null
    else selectedId.value = list[index + 1]?.id || selectedId.value
  },
  arrowup: () => {
    const list = props.messages
    if (!list.length) return
    const index = list.findIndex(m => m.id === selectedId.value)
    if (index > 0) selectedId.value = list[index - 1]?.id || selectedId.value
  }
})
</script>

<template>
  <div class="flex flex-col h-full min-h-0 bg-default">
    <!-- Top Header: Search & Filter Toolbar -->
    <div class="p-2.5 sm:p-3 border-b border-default shrink-0 bg-elevated/15 space-y-2">
      <!-- Mobile Folder Dropdown + Compose button -->
      <div v-if="folderDropdownItems?.length" class="lg:hidden flex items-center justify-between gap-2">
        <UDropdownMenu :items="folderDropdownItems as any">
          <UButton
            :label="activeFolderLabel"
            :icon="activeFolderIcon"
            color="neutral"
            variant="outline"
            size="xs"
            trailing-icon="i-lucide-chevron-down"
          />
        </UDropdownMenu>

        <UButton
          color="primary"
          variant="soft"
          size="xs"
          icon="i-lucide-square-pen"
          :label="t('inbox.compose')"
          @click="emit('compose')"
        />
      </div>

      <!-- Integrated Search Input -->
      <UInput
        v-model="search"
        icon="i-lucide-search"
        :placeholder="t('inbox.searchPlaceholder')"
        size="sm"
        class="w-full"
        :ui="{ trailing: 'pe-1' }"
        @keydown.enter="emit('search')"
      >
        <template #trailing>
          <UButton
            v-if="search"
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="xs"
            @click="emit('clearSearch')"
          />
          <UButton
            v-else
            icon="i-lucide-arrow-right"
            color="neutral"
            variant="ghost"
            size="xs"
            @click="emit('search')"
          />
        </template>
      </UInput>

      <!-- Active Search Filter Badge -->
      <div v-if="activeQuery" class="flex items-center justify-between gap-1 text-xs pt-0.5">
        <UBadge
          :label="t('inbox.filtered', [activeQuery])"
          color="info"
          variant="subtle"
          size="xs"
        >
          <template #trailing>
            <button type="button" class="cursor-pointer hover:opacity-75 ms-1" @click="emit('clearSearch')">
              <UIcon name="i-lucide-x" class="size-3" />
            </button>
          </template>
        </UBadge>

        <button
          type="button"
          class="text-[11px] text-muted hover:text-highlighted cursor-pointer"
          @click="emit('clearSearch')"
        >
          {{ t('inbox.clearSearch') }}
        </button>
      </div>

      <!-- Batch Actions Bar (when 1+ items selected) -->
      <div v-if="selectedIds.length > 0" class="flex items-center gap-1.5 min-w-0 pt-0.5">
        <UCheckbox
          :model-value="isAllSelected"
          :indeterminate="isIndeterminate"
          @update:model-value="toggleSelectAll"
        />
        <UBadge
          :label="t('inbox.selectedCount', [selectedIds.length])"
          color="primary"
          variant="subtle"
          size="xs"
        />
        <div class="h-3.5 w-px bg-default mx-0.5" />
        <UTooltip :text="t('inbox.batchMarkRead')">
          <UButton
            icon="i-lucide-mail-open"
            color="neutral"
            variant="ghost"
            size="xs"
            @click="emit('batchMarkRead', [...selectedIds])"
          />
        </UTooltip>
        <UTooltip :text="t('inbox.batchMarkUnread')">
          <UButton
            icon="i-lucide-mail"
            color="neutral"
            variant="ghost"
            size="xs"
            @click="emit('batchMarkUnread', [...selectedIds])"
          />
        </UTooltip>
        <UTooltip :text="t('inbox.batchStar')">
          <UButton
            icon="i-lucide-star"
            color="neutral"
            variant="ghost"
            size="xs"
            @click="emit('batchStar', [...selectedIds])"
          />
        </UTooltip>
        <UTooltip :text="t('inbox.batchTrash')">
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            size="xs"
            @click="emit('batchTrash', [...selectedIds])"
          />
        </UTooltip>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          class="ms-auto"
          @click="selectedIds = []"
        />
      </div>

      <!-- Normal Row: Master Checkbox + Quick Filter Tabs + Refresh -->
      <div v-else class="flex items-center justify-between gap-1 pt-0.5">
        <div class="flex items-center gap-1.5 min-w-0">
          <UCheckbox :model-value="false" :disabled="!messages.length" @update:model-value="toggleSelectAll" />
          <div class="flex items-center gap-1">
            <button
              v-for="tab in filterTabs"
              :key="tab.id"
              type="button"
              class="px-2 py-0.5 rounded text-xs font-medium transition-colors cursor-pointer"
              :class="[
                (filterTab || 'all') === tab.id
                  ? 'bg-primary/10 text-primary font-semibold'
                  : 'text-muted hover:text-highlighted hover:bg-elevated/50'
              ]"
              @click="emit('update:filterTab', tab.id)"
            >
              {{ t(tab.labelKey) }}
            </button>
          </div>
        </div>

        <UTooltip :text="t('common.refresh')">
          <UButton
            icon="i-lucide-rotate-cw"
            color="neutral"
            variant="ghost"
            size="xs"
            :loading="loading"
            @click="emit('refresh')"
          />
        </UTooltip>
      </div>
    </div>

    <!-- Messages List Container -->
    <div class="flex-1 min-h-0 overflow-y-auto divide-y divide-default">
      <!-- Loading Skeletons -->
      <div v-if="loading && !messages.length" class="p-3 space-y-3">
        <div v-for="i in 6" :key="i" class="flex gap-3 p-2">
          <USkeleton class="size-8 rounded-full shrink-0" />
          <div class="flex-1 space-y-2">
            <USkeleton class="h-3 w-1/3" />
            <USkeleton class="h-3 w-2/3" />
            <USkeleton class="h-2 w-full" />
          </div>
        </div>
      </div>

      <!-- Messages Loop -->
      <div
        v-for="mail in messages"
        :key="mail.id"
        :ref="(el) => { itemsRef[mail.id] = el as Element | null }"
        class="group relative p-3 sm:p-3.5 text-xs sm:text-sm cursor-pointer border-l-2 transition-all"
        :class="[
          mail.unread ? 'bg-primary/3 text-highlighted' : 'text-toned',
          selectedId === mail.id
            ? 'border-primary bg-primary/10'
            : 'border-transparent hover:border-primary/50 hover:bg-elevated/40'
        ]"
        @click="selectedId = mail.id"
      >
        <div class="flex items-start gap-2.5">
          <!-- Selection Checkbox -->
          <div class="pt-0.5 shrink-0" @click.stop>
            <UCheckbox :model-value="selectedIds.includes(mail.id)" @update:model-value="toggleSelectItem(mail.id)" />
          </div>

          <!-- Star Button -->
          <button
            type="button"
            class="pt-0.5 shrink-0 text-muted hover:text-warning transition-colors cursor-pointer"
            @click.stop="emit('toggleStar', mail)"
          >
            <UIcon
              name="i-lucide-star"
              class="size-4 transition-transform hover:scale-110"
              :class="[mail.starred ? 'text-amber-500 fill-amber-500' : 'text-muted']"
            />
          </button>

          <!-- Avatar / Initials -->
          <div
            class="size-7 rounded-full flex items-center justify-center font-bold text-[11px] shrink-0 border"
            :class="[
              mail.unread
                ? 'bg-primary/15 text-primary border-primary/20'
                : 'bg-elevated text-muted border-default'
            ]"
          >
            {{ getInitials(senderOf(mail).name) }}
          </div>

          <!-- Message Core Info -->
          <div class="flex-1 min-w-0">
            <!-- Sender & Date Row -->
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5 min-w-0">
                <span
                  class="truncate text-xs"
                  :class="[mail.unread ? 'font-bold text-highlighted' : 'font-medium text-toned']"
                >
                  {{ senderOf(mail).name }}
                </span>
                <span v-if="mail.unread" class="size-1.5 rounded-full bg-primary shrink-0" />
              </div>

              <span class="text-[11px] text-muted shrink-0">
                {{ formatDateDisplay(mail.date) }}
              </span>
            </div>

            <!-- Subject Row -->
            <p class="truncate mt-0.5 text-xs" :class="[mail.unread ? 'font-semibold text-highlighted' : 'text-toned']">
              {{ mail.subject || t('inbox.noSubject') }}
            </p>

            <!-- Snippet Preview -->
            <p class="text-muted line-clamp-1 text-[11px] mt-0.5 leading-snug">
              {{ mail.snippet }}
            </p>
          </div>
        </div>

        <!-- Floating Quick Action Buttons on Hover (Desktop) -->
        <div
          class="hidden group-hover:flex absolute right-2 bottom-2 items-center gap-1 bg-elevated/90 backdrop-blur px-1.5 py-0.5 rounded-md border border-default shadow-xs"
          @click.stop
        >
          <UTooltip :text="mail.unread ? t('inbox.markRead') : t('inbox.markUnread')">
            <UButton
              :icon="mail.unread ? 'i-lucide-mail-open' : 'i-lucide-mail'"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="emit('toggleUnread', mail)"
            />
          </UTooltip>
          <UTooltip :text="t('inbox.batchTrash')">
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="xs"
              @click="emit('trash', mail)"
            />
          </UTooltip>
        </div>
      </div>

      <!-- Empty State -->
      <div
        v-if="!loading && !messages.length"
        class="p-8 text-center flex flex-col items-center justify-center space-y-2"
      >
        <div class="size-12 rounded-full bg-elevated flex items-center justify-center text-muted mb-1">
          <UIcon name="i-lucide-inbox" class="size-6" />
        </div>
        <p class="text-sm font-medium text-highlighted">
          {{ t('inbox.emptyList') }}
        </p>
        <p class="text-xs text-muted max-w-xs">
          {{ t('inbox.noMessagesInFolder') }}
        </p>
      </div>
    </div>
  </div>
</template>
