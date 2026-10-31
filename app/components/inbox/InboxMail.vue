<script setup lang="ts">
import { format } from 'date-fns'
import type { InboxDetail } from '~/types/inbox'
import { parseAddress, sanitizeEmailHtml, formatBytes, getInitials, getAttachmentIcon } from '~/utils/inboxHtml'

const { t } = useI18n()

const props = defineProps<{
  thread: InboxDetail[]
  loading?: boolean
}>()

const emit = defineEmits<{
  back: []
  reply: [body: string]
  toggleUnread: [message: InboxDetail]
  toggleStar: [message: InboxDetail]
  trash: [message: InboxDetail]
  download: [message: InboxDetail, attachmentId: string, filename: string, mimeType: string]
}>()

const subject = computed(() => props.thread[0]?.subject || t('inbox.noSubject'))
const firstMessage = computed(() => props.thread[0])
const lastMessage = computed(() => props.thread[props.thread.length - 1] || null)

const reply = ref('')
const sending = ref(false)

function onReply() {
  const body = reply.value.trim()
  if (!body || sending.value) return
  sending.value = true
  emit('reply', body)
  reply.value = ''
  setTimeout(() => { sending.value = false }, 1500)
}

function onTextareaKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    onReply()
  }
}

function senderOf(msg: InboxDetail) {
  const parsed = parseAddress(msg.from)
  return { name: parsed.name || parsed.email, email: parsed.email }
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return ''
  try {
    return format(new Date(dateStr), 'dd MMM yyyy, HH:mm')
  } catch {
    return dateStr
  }
}
</script>

<template>
  <div class="flex flex-col h-full min-h-0 bg-default">
    <!-- Header Bar -->
    <div class="flex items-center gap-2 px-4 py-3 border-b border-default shrink-0 bg-elevated/20">
      <UButton
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        size="sm"
        class="lg:hidden -ms-1.5"
        @click="emit('back')"
      />

      <div class="flex-1 min-w-0 flex items-center gap-2">
        <h2 class="font-semibold text-highlighted text-sm sm:text-base truncate">
          {{ subject }}
        </h2>
        <UBadge
          v-if="thread.length > 1"
          :label="`${thread.length}`"
          color="neutral"
          variant="subtle"
          size="xs"
        />
      </div>

      <!-- Action buttons -->
      <div v-if="firstMessage" class="flex items-center gap-1 shrink-0">
        <UTooltip :text="firstMessage.starred ? t('inbox.unstar') : t('inbox.star')">
          <UButton
            :icon="firstMessage.starred ? 'i-lucide-star' : 'i-lucide-star'"
            :color="firstMessage.starred ? 'warning' : 'neutral'"
            :class="firstMessage.starred ? 'text-amber-500 fill-amber-500' : ''"
            variant="ghost"
            size="xs"
            @click="emit('toggleStar', firstMessage)"
          />
        </UTooltip>

        <UTooltip :text="firstMessage.unread ? t('inbox.markRead') : t('inbox.markUnread')">
          <UButton
            :icon="firstMessage.unread ? 'i-lucide-mail-open' : 'i-lucide-mail'"
            color="neutral"
            variant="ghost"
            size="xs"
            @click="emit('toggleUnread', firstMessage)"
          />
        </UTooltip>

        <UTooltip :text="t('inbox.batchTrash')">
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            size="xs"
            @click="emit('trash', firstMessage)"
          />
        </UTooltip>
      </div>
    </div>

    <!-- Messages Body Stream -->
    <div class="flex-1 min-h-0 overflow-y-auto">
      <div v-if="loading && !thread.length" class="p-6 space-y-4">
        <div class="flex items-center gap-3">
          <USkeleton class="size-10 rounded-full" />
          <div class="space-y-1.5 flex-1">
            <USkeleton class="h-4 w-1/4" />
            <USkeleton class="h-3 w-1/3" />
          </div>
        </div>
        <USkeleton class="h-32 w-full rounded-lg" />
      </div>

      <article
        v-for="(msg, idx) in thread"
        :key="msg.id"
        class="border-b border-default p-4 sm:p-6"
        :class="[idx > 0 && 'bg-elevated/10']"
      >
        <!-- Message Header -->
        <header class="flex items-start justify-between gap-3 mb-4">
          <div class="flex items-center gap-3 min-w-0">
            <div
              class="size-9 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center shrink-0 border border-primary/20"
            >
              {{ getInitials(senderOf(msg).name) }}
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-sm font-semibold text-highlighted truncate">
                  {{ senderOf(msg).name }}
                </span>
                <span class="text-xs text-muted font-normal truncate hidden sm:inline">
                  &lt;{{ senderOf(msg).email }}&gt;
                </span>
              </div>
              <p class="text-xs text-muted truncate">
                <span class="sm:hidden">{{ senderOf(msg).email }} · </span>
                <span>{{ t('inbox.to') }}: {{ msg.to || t('inbox.me') }}</span>
              </p>
            </div>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <time v-if="msg.date" :datetime="msg.date" class="text-xs text-muted">
              {{ formatDate(msg.date) }}
            </time>
            <UTooltip :text="msg.starred ? t('inbox.unstar') : t('inbox.star')">
              <UButton
                icon="i-lucide-star"
                :color="msg.starred ? 'warning' : 'neutral'"
                :class="msg.starred ? 'text-amber-500 fill-amber-500' : ''"
                variant="ghost"
                size="xs"
                @click="emit('toggleStar', msg)"
              />
            </UTooltip>
          </div>
        </header>

        <!-- Message HTML / Text Content -->
        <div
          v-if="msg.bodyHtml"
          class="text-sm text-default leading-relaxed email-body overflow-x-auto"
          v-html="sanitizeEmailHtml(msg.bodyHtml)"
        />
        <p v-else class="text-sm text-default leading-relaxed whitespace-pre-wrap font-sans">
          {{ msg.bodyText }}
        </p>

        <!-- Attachments Section -->
        <div v-if="msg.attachments.length" class="mt-5 pt-4 border-t border-default space-y-2">
          <div class="text-xs font-semibold text-muted flex items-center gap-1.5">
            <UIcon name="i-lucide-paperclip" class="size-3.5" />
            <span>{{ t('inbox.attachments') }} ({{ msg.attachments.length }})</span>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            <div
              v-for="att in msg.attachments"
              :key="att.filename + (att.id || '')"
              class="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-default bg-elevated/40 hover:bg-elevated transition-colors text-xs"
            >
              <div class="flex items-center gap-2 min-w-0">
                <UIcon
                  :name="getAttachmentIcon(att.mimeType, att.filename).icon"
                  :class="['size-5 shrink-0', getAttachmentIcon(att.mimeType, att.filename).color]"
                />
                <div class="min-w-0">
                  <p class="font-medium text-highlighted truncate" :title="att.filename">
                    {{ att.filename }}
                  </p>
                  <p class="text-[11px] text-muted">
                    {{ formatBytes(att.size) }}
                  </p>
                </div>
              </div>

              <UButton
                icon="i-lucide-download"
                color="neutral"
                variant="ghost"
                size="xs"
                :disabled="!att.id"
                :aria-label="t('inbox.download')"
                @click="att.id && emit('download', msg, att.id, att.filename, att.mimeType)"
              />
            </div>
          </div>
        </div>
      </article>

      <div v-if="!loading && !thread.length" class="p-8 text-center text-sm text-muted">
        {{ t('inbox.emptyThread') }}
      </div>
    </div>

    <!-- Reply Box -->
    <div class="p-3 sm:p-4 border-t border-default shrink-0 bg-elevated/30">
      <div
        class="rounded-lg border border-default bg-default p-3 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all"
      >
        <div class="flex items-center gap-1.5 text-xs text-muted mb-2">
          <UIcon name="i-lucide-reply" class="size-3.5 text-primary" />
          <span class="truncate">
            {{ t('inbox.replyTo', [lastMessage ? senderOf(lastMessage).email : '']) }}
          </span>
        </div>

        <form @submit.prevent="onReply">
          <UTextarea
            v-model="reply"
            color="neutral"
            variant="none"
            required
            autoresize
            :placeholder="t('inbox.replyPlaceholder')"
            :rows="3"
            :disabled="sending || !thread.length"
            class="w-full text-xs sm:text-sm"
            :ui="{ base: 'p-0 resize-none' }"
            @keydown="onTextareaKeydown"
          />

          <div class="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-default">
            <span class="text-[11px] text-muted hidden sm:inline">
              {{ t('inbox.replyHint') }}
            </span>
            <div class="flex items-center gap-2 ms-auto">
              <UButton
                type="submit"
                color="primary"
                variant="soft"
                size="xs"
                :loading="sending"
                :disabled="!thread.length || !reply.trim()"
                :label="t('inbox.send')"
                icon="i-lucide-send"
              />
            </div>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.email-body :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 0.5rem;
}

.email-body :deep(a) {
  color: var(--ui-primary);
  text-decoration: underline;
}

.email-body :deep(table) {
  max-width: 100%;
  border-collapse: collapse;
}

.email-body :deep(td),
.email-body :deep(th) {
  padding: 0.25rem 0.5rem;
}

.email-body :deep(blockquote) {
  border-left: 3px solid var(--ui-border);
  padding-left: 0.75rem;
  margin-left: 0;
  color: var(--ui-text-muted);
}
</style>
