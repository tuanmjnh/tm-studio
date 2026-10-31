<script setup lang="ts">
import type { InboxProfile } from '~/types/inbox'

export interface FolderItem {
  id: string
  labelKey: string
  icon: string
  query: string
  color?: string
}

const props = defineProps<{
  profile: InboxProfile | null
  connected: boolean
  activeFolder: string
}>()

const emit = defineEmits<{
  'update:activeFolder': [folderId: string]
  'compose': []
}>()

const { t } = useI18n()

const folders: FolderItem[] = [
  { id: 'inbox', labelKey: 'inbox.folderInbox', icon: 'i-lucide-inbox', query: 'in:inbox' },
  { id: 'starred', labelKey: 'inbox.folderStarred', icon: 'i-lucide-star', query: 'is:starred', color: 'text-amber-500' },
  { id: 'sent', labelKey: 'inbox.folderSent', icon: 'i-lucide-send', query: 'in:sent' },
  { id: 'drafts', labelKey: 'inbox.folderDrafts', icon: 'i-lucide-file-text', query: 'in:draft' },
  { id: 'spam', labelKey: 'inbox.folderSpam', icon: 'i-lucide-alert-circle', query: 'in:spam', color: 'text-orange-500' },
  { id: 'trash', labelKey: 'inbox.folderTrash', icon: 'i-lucide-trash-2', query: 'in:trash', color: 'text-rose-500' }
]

function selectFolder(f: FolderItem) {
  emit('update:activeFolder', f.id)
}
</script>

<template>
  <aside class="flex flex-col h-full bg-default border-r border-default select-none">
    <!-- Top Compose Button -->
    <div class="p-3 border-b border-default shrink-0">
      <UButton
        block
        color="primary"
        variant="soft"
        size="md"
        icon="i-lucide-square-pen"
        :label="t('inbox.compose')"
        :disabled="!connected"
        @click="emit('compose')"
      />
    </div>

    <!-- Folders List -->
    <div class="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
      <div class="px-2 py-1 text-[11px] font-semibold tracking-wider uppercase text-muted">
        {{ t('inbox.folders') }}
      </div>

      <button
        v-for="folder in folders"
        :key="folder.id"
        type="button"
        class="w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all group"
        :class="[
          activeFolder === folder.id
            ? 'bg-primary/10 text-primary font-semibold'
            : 'text-toned hover:text-highlighted hover:bg-elevated/50'
        ]"
        @click="selectFolder(folder)"
      >
        <div class="flex items-center gap-2.5 min-w-0">
          <UIcon
            :name="folder.icon"
            class="size-4 shrink-0 transition-transform group-hover:scale-110"
            :class="[
              activeFolder === folder.id ? 'text-primary' : (folder.color || 'text-muted group-hover:text-highlighted'),
              folder.id === 'starred' && activeFolder === 'starred' ? 'fill-amber-500' : ''
            ]"
          />
          <span class="truncate">{{ t(folder.labelKey) }}</span>
        </div>

        <UBadge
          v-if="folder.id === 'inbox' && profile?.messagesTotal"
          :label="`${profile.messagesTotal}`"
          color="neutral"
          variant="subtle"
          size="xs"
          class="shrink-0"
        />
      </button>
    </div>

    <!-- Account Footer -->
    <div v-if="profile && connected" class="p-3 border-t border-default shrink-0 bg-elevated/20">
      <div class="flex items-center gap-2.5 min-w-0">
        <div
          class="size-7 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center shrink-0"
        >
          <UIcon name="i-lucide-mail" class="size-3.5" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-xs font-semibold text-highlighted truncate">
            {{ profile.email || t('inbox.title') }}
          </p>
          <p class="text-[11px] text-muted truncate">
            {{ t('inbox.threadsTotal', [profile.threadsTotal || 0]) }}
          </p>
        </div>
      </div>
    </div>
  </aside>
</template>
