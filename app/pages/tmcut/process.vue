<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '#imports'
import type { ProcessArtifact, ProcessStageStatus } from '~/types/productionProcess'

// =============================================================================
//  Production process — the stage board.
//
//  Everything here is driven by the profile in utils/process/definition.ts:
//  the page never decides what a stage needs or what it produces, it only
//  offers the actions the engine will accept. Artifacts are real files
//  (desktop main process / Nitro), and the gate buttons are the SOP's human
//  checkpoints — an AI answer can fill a stage, it can never approve one.
// =============================================================================

const { t } = useI18n()
const toast = useToast()

const {
  definition,
  runs,
  currentRun,
  artifactContents,
  loading,
  busyStage,
  lastError,
  storage,
  validationIssues,
  progress,
  stale,
  openRun,
  refreshRuns,
  createRun,
  createDemoRun,
  startStage,
  completeStage,
  decideGate,
  writeArtifact,
  loadArtifact,
  runAutomation,
  openStorageFolder
} = useTmcutProcess()

const newRunId = ref('')
const selectedArtifact = ref('')
const artifactDraft = ref('')
const gateNote = ref('')

const statusColor: Record<string, 'neutral' | 'info' | 'warning' | 'success' | 'error'> = {
  draft: 'neutral',
  running: 'info',
  waiting_gate: 'warning',
  needs_revision: 'warning',
  blocked: 'error',
  done: 'success'
}

const stageStatusColor: Record<ProcessStageStatus, 'neutral' | 'info' | 'warning' | 'success' | 'error'> = {
  pending: 'neutral',
  ready: 'info',
  running: 'info',
  waiting_gate: 'warning',
  approved: 'success',
  needs_revision: 'error'
}

const stageStatusLabelKey: Record<ProcessStageStatus, string> = {
  pending: 'tmcut.process.stageStatus.pending',
  ready: 'tmcut.process.stageStatus.ready',
  running: 'tmcut.process.stageStatus.running',
  waiting_gate: 'tmcut.process.stageStatus.waitingGate',
  approved: 'tmcut.process.stageStatus.approved',
  needs_revision: 'tmcut.process.stageStatus.needsRevision'
}

const kindIcon: Record<string, string> = {
  manual: 'i-lucide-pen-line',
  ai: 'i-lucide-sparkles',
  compute: 'i-lucide-calculator',
  render: 'i-lucide-cpu',
  review: 'i-lucide-eye'
}

/** Latest version per artifact name, newest first. */
const artifactRows = computed<ProcessArtifact[]>(() => {
  const run = currentRun.value
  if (!run) return []
  const latest = new Map<string, ProcessArtifact>()
  for (const artifact of run.artifacts) {
    const current = latest.get(artifact.name)
    if (!current || artifact.version > current.version) latest.set(artifact.name, artifact)
  }
  return [...latest.values()].sort((a, b) => a.name.localeCompare(b.name))
})

const isCurrent = (stageId: string) => currentRun.value?.currentStage === stageId
const stageOf = (id: string) => currentRun.value?.stages.find(stage => stage.id === id)
const definitionOf = (id: string) => definition.value.stages.find(stage => stage.id === id)

const canStart = (id: string) => {
  const state = stageOf(id)
  return isCurrent(id) && (state?.status === 'ready' || state?.status === 'needs_revision')
}
const canComplete = (id: string) => isCurrent(id) && stageOf(id)?.status === 'running'
const canDecide = (id: string) => stageOf(id)?.status === 'waiting_gate'
const canAutomate = (id: string) => {
  const def = definitionOf(id)
  const state = stageOf(id)
  if (!def?.automation) return false
  return isCurrent(id)
    && (state?.status === 'ready' || state?.status === 'needs_revision' || state?.status === 'running')
}

const selectedArtifactMeta = computed(() =>
  artifactRows.value.find(artifact => artifact.name === selectedArtifact.value) || null
)

onMounted(async () => {
  await refreshRuns()
  const first = runs.value[0]
  if (first) await openRun(first.runId)
})

async function handleCreateRun() {
  const id = newRunId.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
  if (!id) return
  const ok = await createRun({ runId: id })
  if (ok) {
    newRunId.value = ''
    selectedArtifact.value = ''
    toast.add({ title: t('tmcut.process.toast.runCreated'), color: 'success' })
  }
}

async function handleDemo() {
  const ok = await createDemoRun()
  if (ok) {
    selectedArtifact.value = 'episode-brief.md'
    await loadArtifact('episode-brief.md')
    toast.add({ title: t('tmcut.process.toast.demoReady'), color: 'success' })
  }
}

async function handleSelectArtifact(name: string) {
  selectedArtifact.value = name
  const cached = artifactContents.value[name]
  artifactDraft.value = cached ?? ''
  if (!cached) await loadArtifact(name)
  artifactDraft.value = artifactContents.value[name] ?? ''
}

async function handleSaveArtifact() {
  if (!selectedArtifact.value) return
  const ok = await writeArtifact(selectedArtifact.value, artifactDraft.value)
  if (ok) toast.add({ title: t('tmcut.process.toast.artifactSaved'), color: 'success' })
}

async function handleStart(id: string) {
  await startStage(id)
}

async function handleComplete(id: string) {
  await completeStage(id)
}

async function handleAutomate(id: string) {
  const ok = await runAutomation(id)
  if (!ok) return
  const def = definitionOf(id)
  const produced = def?.produces[0]
  if (produced) {
    selectedArtifact.value = produced
    artifactDraft.value = artifactContents.value[produced] ?? ''
  }
  toast.add({ title: t('tmcut.process.toast.aiDone'), color: 'success' })
}

async function handleDecision(id: string, decision: 'approved' | 'revise' | 'rejected') {
  const ok = await decideGate(id, decision, gateNote.value)
  if (!ok) return
  gateNote.value = ''
  toast.add({ title: t('tmcut.process.toast.gateSaved'), color: 'success' })
}
</script>

<template>
  <BasePage
    id="tmcut-process"
    :title="t('tmcut.process.title')"
    :description="t(definition.descriptionKey)"
  >
    <template #right>
      <UButton
        color="neutral"
        variant="soft"
        size="sm"
        icon="i-lucide-refresh-cw"
        :loading="loading"
        :label="t('tmcut.process.refresh')"
        @click="refreshRuns()"
      />
      <UButton
        v-if="storage === 'desktop'"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-folder-open"
        :label="t('tmcut.process.openFolder')"
        @click="openStorageFolder()"
      />
      <UButton
        color="primary"
        variant="soft"
        size="sm"
        icon="i-lucide-clapperboard"
        :label="t('tmcut.process.demo')"
        @click="handleDemo"
      />
    </template>

    <div class="flex-1 min-h-0 overflow-hidden p-4 grid gap-4 lg:grid-cols-[16rem_1fr_22rem]">
      <!-- Runs -->
      <section class="min-h-0 flex flex-col gap-3">
        <div class="rounded-xl border border-default p-3 space-y-2">
          <p class="text-[10px] uppercase tracking-wider font-semibold text-muted">
            {{ t('tmcut.process.newRun') }}
          </p>
          <UInput
            v-model="newRunId"
            class="w-full"
            size="sm"
            :placeholder="t('tmcut.process.runIdPlaceholder')"
            @keydown.enter="handleCreateRun"
          />
          <UButton
            block
            size="sm"
            color="primary"
            variant="soft"
            icon="i-lucide-plus"
            :label="t('tmcut.process.create')"
            :disabled="!newRunId.trim()"
            @click="handleCreateRun"
          />
          <p class="text-[10px] text-muted leading-relaxed">
            {{ t('tmcut.process.storageHint', { mode: t(`tmcut.process.storage.${storage}`) }) }}
          </p>
        </div>

        <div class="min-h-0 flex-1 overflow-auto space-y-2 pr-1">
          <p v-if="runs.length === 0" class="text-xs text-muted px-1">
            {{ t('tmcut.process.emptyRuns') }}
          </p>
          <button
            v-for="row in runs"
            :key="row.runId"
            type="button"
            class="w-full text-left rounded-lg border p-2.5 transition-colors"
            :class="currentRun?.runId === row.runId
              ? 'border-primary/60 bg-primary/5'
              : 'border-default hover:bg-elevated/60'"
            @click="openRun(row.runId)"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-semibold truncate">{{ row.runId }}</span>
              <UBadge :color="statusColor[row.status] || 'neutral'" variant="subtle" size="xs">
                {{ t(`tmcut.process.runStatus.${row.status}`) }}
              </UBadge>
            </div>
            <p class="text-[11px] text-muted truncate">
              {{ row.title }}
            </p>
            <p class="text-[10px] text-muted">
              {{ t('tmcut.process.currentStageLabel') }}: {{ row.currentStage }}
            </p>
          </button>
        </div>
      </section>

      <!-- Stage board -->
      <section class="min-h-0 flex flex-col gap-3 overflow-hidden">
        <div v-if="currentRun" class="rounded-xl border border-default p-3 space-y-2">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <p class="text-sm font-semibold truncate">
                {{ currentRun.title }}
              </p>
              <p class="text-[11px] text-muted">
                {{ currentRun.processId }} v{{ currentRun.processVersion }} ·
                {{ t('tmcut.process.stageCount', { done: currentRun.stages.filter(s => s.status === 'approved').length, total: currentRun.stages.length }) }}
              </p>
            </div>
            <UBadge :color="statusColor[currentRun.status] || 'neutral'" variant="soft">
              {{ t(`tmcut.process.runStatus.${currentRun.status}`) }}
            </UBadge>
          </div>
          <UProgress :model-value="progress" size="sm" />
          <p v-if="stale.length > 0" class="text-[11px] text-amber-600 dark:text-amber-400">
            {{ t('tmcut.process.staleBanner', { names: stale.join(', ') }) }}
          </p>
        </div>

        <div class="min-h-0 flex-1 overflow-auto space-y-2 pr-1">
          <div
            v-for="(stage, index) in definition.stages"
            :key="stage.id"
            class="rounded-xl border p-3 space-y-2"
            :class="isCurrent(stage.id) ? 'border-primary/50 bg-primary/5' : 'border-default'"
          >
            <div class="flex items-start gap-2">
              <span class="mt-0.5 text-[10px] font-mono text-muted w-5 shrink-0">{{ index + 1 }}</span>
              <UIcon :name="kindIcon[stage.kind] || 'i-lucide-circle'" class="size-4 mt-0.5 text-muted shrink-0" />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-xs font-semibold">{{ t(stage.titleKey) }}</span>
                  <UBadge
                    v-if="stageOf(stage.id)"
                    :color="stageStatusColor[stageOf(stage.id)!.status]"
                    variant="subtle"
                    size="xs"
                  >
                    {{ t(stageStatusLabelKey[stageOf(stage.id)!.status]) }}
                  </UBadge>
                  <UBadge
                    v-if="stage.gate === 'human'"
                    color="neutral"
                    variant="outline"
                    size="xs"
                  >
                    {{ t('tmcut.process.humanGate') }}
                  </UBadge>
                </div>
                <p v-if="stage.hintKey" class="text-[11px] text-muted mt-1">
                  {{ t(stage.hintKey) }}
                </p>
                <p class="text-[10px] text-muted mt-1 font-mono truncate">
                  {{ t('tmcut.process.reads') }}: {{ stage.requires.length ? stage.requires.join(', ') : '—' }}
                  → {{ t('tmcut.process.writes') }}: {{ stage.produces.join(', ') }}
                </p>
                <p v-if="stageOf(stage.id)?.lastError" class="text-[10px] text-red-600 dark:text-red-400 mt-1">
                  {{ stageOf(stage.id)!.lastError }}
                </p>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2 pl-7">
              <UButton
                v-if="canStart(stage.id)"
                size="xs"
                color="neutral"
                variant="soft"
                icon="i-lucide-play"
                :label="t('tmcut.process.action.start')"
                @click="handleStart(stage.id)"
              />
              <UButton
                v-if="canAutomate(stage.id)"
                size="xs"
                color="primary"
                variant="soft"
                icon="i-lucide-sparkles"
                :loading="busyStage === stage.id"
                :label="t('tmcut.process.action.runAi')"
                @click="handleAutomate(stage.id)"
              />
              <UButton
                v-if="canComplete(stage.id)"
                size="xs"
                color="neutral"
                variant="soft"
                icon="i-lucide-check"
                :label="t('tmcut.process.action.complete')"
                @click="handleComplete(stage.id)"
              />
              <template v-if="canDecide(stage.id)">
                <UButton
                  size="xs"
                  color="success"
                  variant="soft"
                  icon="i-lucide-shield-check"
                  :label="t('tmcut.process.action.approve')"
                  @click="handleDecision(stage.id, 'approved')"
                />
                <UButton
                  size="xs"
                  color="warning"
                  variant="soft"
                  icon="i-lucide-undo-2"
                  :label="t('tmcut.process.action.revise')"
                  @click="handleDecision(stage.id, 'revise')"
                />
                <UButton
                  size="xs"
                  color="error"
                  variant="ghost"
                  icon="i-lucide-ban"
                  :label="t('tmcut.process.action.reject')"
                  @click="handleDecision(stage.id, 'rejected')"
                />
              </template>
            </div>
          </div>
        </div>
      </section>

      <!-- Gate + artifacts + model -->
      <section class="min-h-0 flex flex-col gap-3 overflow-auto pr-1">
        <div v-if="lastError" class="rounded-lg border border-red-500/40 bg-red-500/5 p-2.5">
          <p class="text-[11px] text-red-600 dark:text-red-400 break-words">
            {{ lastError }}
          </p>
        </div>

        <!-- Validator findings for the stage just acted on. CRITICAL blocks the
             gate (engine refuses to complete), warnings are reviewable notes. -->
        <div v-if="validationIssues.length > 0" class="rounded-lg border border-default p-2.5 space-y-1">
          <p class="text-[10px] uppercase tracking-wider font-semibold text-muted">
            {{ t('tmcut.process.validation.title') }}
          </p>
          <p
            v-for="(issue, index) in validationIssues"
            :key="`${issue.code}-${index}`"
            class="text-[11px] break-words"
            :class="issue.level === 'critical' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'"
          >
            <span class="font-semibold">
              {{ issue.level === 'critical' ? t('tmcut.process.validation.critical') : t('tmcut.process.validation.warning') }}
            </span>
            — {{ issue.artifact }}: {{ issue.message }}
          </p>
        </div>

        <TmcutAiModelPicker task="plan" label-key="tmcut.process.modelCaption" />

        <div class="rounded-xl border border-default p-3 space-y-2">
          <p class="text-[10px] uppercase tracking-wider font-semibold text-muted">
            {{ t('tmcut.process.gate.title') }}
          </p>
          <p class="text-[11px] text-muted leading-relaxed">
            {{ t('tmcut.process.gate.hint') }}
          </p>
          <UTextarea
            v-model="gateNote"
            class="w-full"
            :rows="2"
            size="sm"
            :placeholder="t('tmcut.process.gate.notePlaceholder')"
          />
        </div>

        <div class="rounded-xl border border-default p-3 space-y-2">
          <div class="flex items-center justify-between">
            <p class="text-[10px] uppercase tracking-wider font-semibold text-muted">
              {{ t('tmcut.process.artifacts.title') }}
            </p>
            <span class="text-[10px] text-muted">{{ artifactRows.length }}</span>
          </div>
          <p v-if="artifactRows.length === 0" class="text-[11px] text-muted">
            {{ t('tmcut.process.artifacts.empty') }}
          </p>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="artifact in artifactRows"
              :key="artifact.name"
              type="button"
              class="text-[10px] rounded-md border px-2 py-1 font-mono truncate max-w-full"
              :class="selectedArtifact === artifact.name
                ? 'border-primary/60 bg-primary/10 text-primary'
                : 'border-default hover:bg-elevated/60'"
              @click="handleSelectArtifact(artifact.name)"
            >
              {{ artifact.name }}
              <span class="text-muted">v{{ artifact.version }}</span>
              <span v-if="artifact.approvedHash" class="text-emerald-500">✓</span>
            </button>
          </div>
        </div>

        <div v-if="selectedArtifactMeta" class="rounded-xl border border-default p-3 space-y-2">
          <div class="flex items-center justify-between gap-2">
            <p class="text-[11px] font-semibold font-mono truncate">
              {{ selectedArtifactMeta.name }}
            </p>
            <UButton
              size="xs"
              color="primary"
              variant="soft"
              icon="i-lucide-save"
              :label="t('tmcut.process.editor.save')"
              @click="handleSaveArtifact"
            />
          </div>
          <p class="text-[10px] text-muted">
            v{{ selectedArtifactMeta.version }} ·
            {{ selectedArtifactMeta.approvedHash
              ? t('tmcut.process.artifacts.approved')
              : t('tmcut.process.artifacts.unreviewed') }}
          </p>
          <UTextarea
            v-model="artifactDraft"
            :rows="14"
            size="sm"
            :placeholder="t('tmcut.process.editor.placeholder')"
            class="w-full font-mono text-[11px]"
          />
          <p class="text-[10px] text-muted leading-relaxed">
            {{ t('tmcut.process.editor.hint') }}
          </p>
        </div>

        <div class="rounded-xl border border-default p-3 space-y-1">
          <p class="text-[10px] uppercase tracking-wider font-semibold text-muted">
            {{ t('tmcut.process.policyTitle') }}
          </p>
          <p class="text-[11px] text-muted leading-relaxed">
            {{ t('tmcut.process.policyBody') }}
          </p>
        </div>
      </section>
    </div>
  </BasePage>
</template>
