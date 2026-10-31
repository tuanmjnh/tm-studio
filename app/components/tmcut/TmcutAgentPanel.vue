<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTmcutAgentTools, type AgentProposalOperation } from '~/composables/useTmcutAgentTools'
import { useTmcutVoiceCommands, type VoiceResult } from '~/composables/useTmcutVoiceCommands'
import { useTmcutProject } from '~/composables/useTmcutProject'
import { useTmcutRecorder } from '~/composables/useTmcutRecorder'

// Agent / voice command surface (Roadmap v1 §4, P1+P2).
//
// One pipeline for typed and dictated commands: STT or text → intent → the
// SAME agent tools the AI agent and MCP bridge use → a reviewed draft →
// apply as ONE undo group. Nothing here owns project state; the draft lives
// in useTmcutAgentTools and the panel only renders it.
const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const toast = useToast()
const project = useTmcutProject()
const agent = useTmcutAgentTools()
const voice = useTmcutVoiceCommands()
// Command capture rides the same recorder as voiceover, but the take is only
// a speech-to-text input: it is NOT imported into the media library.
const {
  recording: micRecording,
  saving: micSaving,
  elapsedSec: micElapsed,
  start: micStart,
  stop: micStop
} = useTmcutRecorder()

const command = ref('')
const language = ref<'vi' | 'en'>('vi')
const running = ref(false)
const lastMessage = ref<string | null>(null)
const lastResult = ref<unknown>(null)
const lastError = ref<string | null>(null)
const transcript = ref('')

const languageItems = computed(() => [
  { label: t('tmcut.agent.langVi'), value: 'vi' },
  { label: t('tmcut.agent.langEn'), value: 'en' }
])

const draft = computed(() => voice.pendingProposal.value)
const draftCount = computed(() => draft.value?.operations.length ?? 0)

// Re-runs on every draft/timeline change: a clip deleted in the meantime
// surfaces here before the user can press Apply.
const draftIssues = computed(() => {
  if (draftCount.value === 0) return []
  return agent.validateProposal().data?.issues ?? []
})

const canApply = computed(() => draftCount.value > 0 && draftIssues.value.length === 0)

function fmt(value: unknown, fallback = 0): string {
  const n = Number(value ?? fallback)
  if (!Number.isFinite(n)) return String(fallback)
  return String(Math.round(n * 100) / 100)
}

function clipLabel(raw: unknown): string {
  const id = !raw || raw === 'selected' ? project.selectedClipId.value : String(raw)
  if (!id) return '—'
  for (const track of project.currentProject.value?.timeline?.tracks || []) {
    const item = (track.items || []).find(i => i.id === id)
    if (item) return item.name || item.text || item.id
  }
  return id
}

function trackLabel(raw: unknown): string {
  const id = !raw || raw === 'selected' ? null : String(raw)
  const tracks = project.currentProject.value?.timeline?.tracks || []
  if (!id) {
    const selected = project.selectedClipId.value
    const found = tracks.find(track => (track.items || []).some(i => i.id === selected))
    return found?.name || found?.type || '—'
  }
  const found = tracks.find(track => track.id === id)
  return found?.name || found?.type || id
}

function sourceLabel(source: string): string {
  return t(`tmcut.agent.source.${source}`)
}

function describeOperation(op: AgentProposalOperation): string {
  const args = op.args || {}
  switch (op.tool) {
    case 'timeline.add_clip':
      return t('tmcut.agent.ops.addClip', {
        type: String(args.trackType || 'text'),
        name: String(args.name || args.text || 'Clip'),
        offset: fmt(args.offsetSec),
        duration: fmt(args.durationSec, 4)
      })
    case 'timeline.move_clip':
      return t('tmcut.agent.ops.moveClip', { clip: clipLabel(args.clipId), start: fmt(args.startSec) })
    case 'timeline.trim_clip':
      return t('tmcut.agent.ops.trimClip', { clip: clipLabel(args.clipId), edge: String(args.edge || 'out'), at: fmt(args.atSec) })
    case 'timeline.remove_clip':
      return t('tmcut.agent.ops.removeClip', { clip: clipLabel(args.clipId) })
    case 'timeline.split_clip':
      return t('tmcut.agent.ops.splitClip', { clip: clipLabel(args.clipId), at: fmt(args.atSec) })
    case 'timeline.set_volume':
      return t('tmcut.agent.ops.setVolume', { track: trackLabel(args.trackId), volume: fmt(args.volume) })
    case 'timeline.add_caption':
      return t('tmcut.agent.ops.addCaption', { text: String(args.text || ''), at: fmt(args.atSec), duration: fmt(args.durationSec, 3) })
    case 'timeline.set_transition':
      return t('tmcut.agent.ops.setTransition', { type: String(args.type || ''), clip: clipLabel(args.clipId), duration: fmt(args.durationSec, 0.5) })
    case 'timeline.set_effect':
      return t('tmcut.agent.ops.setEffect', {
        count: Array.isArray(args.effects) ? args.effects.length : 0,
        clip: clipLabel(args.clipId)
      })
    default:
      return t('tmcut.agent.ops.unknown', { tool: op.tool })
  }
}

function formatElapsed(sec: number): string {
  const total = Math.max(0, Math.floor(sec))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

const micTime = computed(() => formatElapsed(micElapsed.value))

function resetFeedback() {
  lastMessage.value = null
  lastError.value = null
  lastResult.value = null
  transcript.value = ''
}

/** Shared outcome handling for typed AND dictated commands. */
function applyResult(res: VoiceResult) {
  if (!res.ok) {
    lastError.value = res.error?.message || t('tmcut.agent.errorTitle')
    toast.add({ title: t('tmcut.agent.errorTitle'), description: lastError.value ?? '', color: 'error' })
    return
  }
  if (res.blocked === 'proposal-pending') {
    lastMessage.value = t('tmcut.agent.pendingDraftHint', { count: res.queued ?? 0 })
    return
  }
  if (res.staged) {
    lastMessage.value = res.confirmationMessage ?? null
    toast.add({
      title: t('tmcut.agent.queuedTitle'),
      description: t('tmcut.agent.queuedDesc', { count: res.queued ?? 0 }),
      color: 'info'
    })
    return
  }
  if (res.needsConfirmation) {
    lastMessage.value = res.confirmationMessage ?? null
    return
  }
  lastResult.value = res.result
}

async function handleRun() {
  const text = command.value.trim()
  if (!text || running.value) return
  running.value = true
  resetFeedback()
  try {
    const res = await voice.runTextCommand(text, { language: language.value })
    applyResult(res)
    if (res.ok) command.value = ''
  } finally {
    running.value = false
  }
}

async function runVoiceFile(path: string) {
  running.value = true
  try {
    const res = await voice.runVoiceCommand(path, { language: language.value })
    transcript.value = res.transcript ?? ''
    applyResult(res)
  } finally {
    running.value = false
  }
}

async function handleMicToggle() {
  if (micRecording.value) {
    const result = await micStop({ importToLibrary: false, prefix: 'command' })
    if (result.discarded) {
      toast.add({ title: t('tmcut.agent.micTooShort'), color: 'warning' })
      return
    }
    if (!result.path) {
      toast.add({ title: t('tmcut.agent.micDesktopOnly'), color: 'warning' })
      return
    }
    await runVoiceFile(result.path)
    return
  }
  resetFeedback()
  const started = await micStart()
  if (!started) {
    toast.add({ title: t('tmcut.agent.micDenied'), color: 'warning' })
  }
}

async function handleApply() {
  const res = await voice.confirmStaged()
  const report = res.result as { applied?: number, failed?: Array<unknown> } | undefined
  const applied = report?.applied ?? 0
  const failed = report?.failed?.length ?? 0
  lastMessage.value = null
  resetFeedback()
  if (res.ok) {
    toast.add({
      title: t('tmcut.agent.appliedTitle'),
      description: t('tmcut.agent.appliedDesc', { applied }),
      color: 'success'
    })
  } else {
    toast.add({
      title: t('tmcut.agent.partialTitle'),
      description: t('tmcut.agent.appliedDesc', { applied }),
      color: failed > 0 ? 'warning' : 'error'
    })
  }
}

function handleDiscard() {
  voice.discardStaged()
  resetFeedback()
  toast.add({ title: t('tmcut.agent.discardedTitle'), color: 'neutral' })
}

function closeModal() {
  resetFeedback()
  open.value = false
}
</script>

<template>
  <UModal
    v-model:open="open"
    :ui="{ content: 'max-w-4xl' }"
  >
    <template #content>
      <div class="px-6 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg bg-primary-500/10 dark:bg-primary-400/10 flex items-center justify-center text-primary-500">
            <UIcon name="i-lucide-terminal" class="w-5 h-5" />
          </div>
          <div>
            <h3 class="text-base font-semibold text-neutral-900 dark:text-white">
              {{ t('tmcut.agent.title') }}
            </h3>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              {{ t('tmcut.agent.subtitle') }}
            </p>
          </div>
        </div>
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-x"
          size="sm"
          @click="closeModal"
        />
      </div>

      <div class="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 max-h-[75vh] overflow-y-auto">
        <!-- Left: command entry -->
        <div class="lg:col-span-5 flex flex-col gap-3">
          <div>
            <label for="tmcut-agentpanel-command-label" class="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
              {{ t('tmcut.agent.commandLabel') }}
            </label>
            <UTextarea
              id="tmcut-agentpanel-command-label"
              v-model="command"
              :rows="4"
              :placeholder="t('tmcut.agent.commandPlaceholder')"
              class="w-full text-sm"
              @keydown.ctrl.enter="handleRun"
              @keydown.meta.enter="handleRun"
            />
          </div>

          <div>
            <span class="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
              {{ t('tmcut.agent.languageLabel') }}
            </span>
            <USelect
              v-model="language"
              :aria-label="t('tmcut.agent.languageLabel')"
              :items="languageItems"
              size="sm"
              class="w-full"
            />
          </div>

          <!-- Action row on its own full-width line so the primary label never
               wraps against the mic button (was a 2-col grid). -->
          <div class="flex items-center gap-2">
            <UButton
              class="flex-1"
              color="primary"
              variant="soft"
              icon="i-lucide-send"
              :loading="running"
              :disabled="!command.trim()"
              @click="handleRun"
            >
              {{ t('tmcut.agent.runButton') }}
            </UButton>
            <UButton
              shrink-0
              :color="micRecording ? 'error' : 'neutral'"
              :variant="micRecording ? 'soft' : 'ghost'"
              :icon="micRecording ? 'i-lucide-square' : 'i-lucide-mic'"
              :loading="micSaving"
              :disabled="running"
              :title="micRecording ? t('tmcut.agent.micStopTitle') : t('tmcut.agent.micStart')"
              @click="handleMicToggle"
            >
              {{ micRecording ? t('tmcut.agent.micStop', { time: micTime }) : t('tmcut.agent.micStart') }}
            </UButton>
          </div>

          <p class="text-[11px] text-neutral-400 dark:text-neutral-500 flex items-start gap-1.5">
            <UIcon name="i-lucide-info" class="size-3 mt-0.5 shrink-0" />
            <span>{{ t('tmcut.agent.hint') }}</span>
          </p>

          <div
            v-if="transcript"
            class="rounded-lg border border-neutral-300 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3"
          >
            <p class="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 mb-1">
              {{ t('tmcut.agent.transcriptLabel') }}
            </p>
            <p class="text-xs text-neutral-700 dark:text-neutral-200">
              {{ transcript }}
            </p>
          </div>

          <div v-if="lastMessage" class="rounded-lg border border-primary-500/40 bg-primary-500/10 p-3 text-xs text-primary-200">
            {{ lastMessage }}
          </div>

          <div v-if="lastError" class="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300 font-mono break-words">
            {{ lastError }}
          </div>

          <div v-if="lastResult" class="rounded-lg border border-neutral-300 dark:border-neutral-800 overflow-hidden">
            <div class="px-3 py-1.5 bg-neutral-100/80 dark:bg-neutral-900/80 border-b border-neutral-300 dark:border-neutral-800">
              <p class="text-[11px] font-semibold text-neutral-600 dark:text-neutral-300">
                {{ t('tmcut.agent.readResultTitle') }}
              </p>
            </div>
            <pre class="p-3 text-[11px] font-mono text-neutral-700 dark:text-neutral-300 max-h-48 overflow-auto whitespace-pre-wrap break-words">{{ JSON.stringify(lastResult, null, 2) }}</pre>
          </div>
        </div>

        <!-- Right: draft review -->
        <div class="lg:col-span-7 flex flex-col gap-3 min-h-0">
          <div
            v-if="draftCount === 0"
            class="border border-dashed border-neutral-300 dark:border-neutral-800 rounded-lg px-6 py-8 text-center"
          >
            <UIcon name="i-lucide-clipboard-list" class="size-8 mx-auto text-neutral-400 mb-2" />
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              {{ t('tmcut.agent.emptyStateTitle') }}
            </p>
            <p class="text-[11px] text-neutral-400 dark:text-neutral-500 mt-1">
              {{ t('tmcut.agent.emptyStateDesc') }}
            </p>
          </div>

          <template v-else>
            <div class="rounded-lg border border-primary-500/40 bg-primary-500/10 p-3">
              <p class="text-xs font-semibold text-primary-200">
                {{ draft?.intent }}
              </p>
              <p class="mt-1 text-[11px] text-primary-200/80">
                {{ t('tmcut.agent.draftMeta', { count: draftCount, source: sourceLabel(draft?.source || 'text') }) }}
              </p>
            </div>

            <div class="rounded-lg border border-neutral-300 dark:border-neutral-800 overflow-hidden flex-1 min-h-0 flex flex-col">
              <div class="px-3 py-1.5 bg-neutral-100/80 dark:bg-neutral-900/80 border-b border-neutral-300 dark:border-neutral-800 flex items-center justify-between">
                <p class="text-[11px] font-semibold text-neutral-600 dark:text-neutral-300">
                  {{ t('tmcut.agent.draftTitle') }}
                </p>
                <UBadge color="neutral" variant="subtle" size="xs">
                  {{ draftCount }}
                </UBadge>
              </div>
              <div class="flex-1 overflow-y-auto max-h-64 p-2 space-y-1">
                <div
                  v-for="op in draft?.operations"
                  :key="op.id"
                  class="flex items-center gap-2 px-2 py-1 rounded-md text-[11px] font-mono bg-neutral-100/70 dark:bg-neutral-900/70 text-neutral-700 dark:text-neutral-300"
                >
                  <UIcon name="i-lucide-check" class="size-3 text-primary-400 shrink-0" />
                  <span class="truncate">{{ describeOperation(op) }}</span>
                </div>
              </div>
            </div>

            <div v-if="draftIssues.length > 0" class="rounded-lg border border-red-500/40 bg-red-500/10 p-3">
              <div class="flex items-center gap-2 mb-1.5">
                <UIcon name="i-lucide-circle-alert" class="size-4 text-red-400" />
                <p class="text-xs font-semibold text-red-300">
                  {{ t('tmcut.agent.validationTitle') }}
                </p>
              </div>
              <ul class="space-y-1 text-[11px] text-red-200/90 font-mono max-h-32 overflow-y-auto">
                <li v-for="issue in draftIssues" :key="issue.operationId">
                  #{{ issue.index + 1 }} · {{ issue.message }}
                </li>
              </ul>
            </div>

            <p v-else class="text-[11px] text-primary-300 flex items-center gap-1.5">
              <UIcon name="i-lucide-undo-2" class="size-3" />
              {{ t('tmcut.agent.validHint') }}
            </p>

            <div class="flex items-center gap-2">
              <UButton
                color="primary"
                variant="soft"
                icon="i-lucide-check"
                :disabled="!canApply"
                @click="handleApply"
              >
                {{ t('tmcut.agent.applyButton') }}
              </UButton>
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-trash-2"
                @click="handleDiscard"
              >
                {{ t('tmcut.agent.discardButton') }}
              </UButton>
            </div>
          </template>
        </div>
      </div>
    </template>
  </UModal>
</template>
