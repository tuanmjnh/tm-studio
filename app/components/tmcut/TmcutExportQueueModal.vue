<script setup lang="ts">
import { useTmcutExportQueue } from '~/composables/useTmcutExportQueue'
import type { TmcutExportJob } from '~/composables/useTmcutExportQueue'

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const {
  queue,
  isProcessing,
  isQueuePaused,
  waitingJobs,
  doneJobs,
  activeJobsCount,
  cancelJob,
  retryJob,
  removeJob,
  clearDoneJobs,
  startQueue,
  pauseQueue,
  resumeQueue
} = useTmcutExportQueue()

function openFile(path: string) {
  if (path && window.electronAPI?.openPath) {
    window.electronAPI.openPath(path)
  }
}

function openFolder(path: string) {
  if (path && window.electronAPI?.showItemInFolder) {
    window.electronAPI.showItemInFolder(path)
  }
}

function statusColor(status: TmcutExportJob['status']): 'info' | 'success' | 'error' | 'neutral' | 'warning' {
  switch (status) {
    case 'running': return 'info'
    case 'done': return 'success'
    case 'failed': return 'error'
    case 'waiting': return 'neutral'
    case 'cancelled': return 'warning'
    default: return 'neutral'
  }
}

function statusIcon(status: TmcutExportJob['status']): string {
  switch (status) {
    case 'running': return 'i-lucide-loader-circle'
    case 'done': return 'i-lucide-circle-check'
    case 'failed': return 'i-lucide-circle-alert'
    case 'waiting': return 'i-lucide-clock'
    case 'cancelled': return 'i-lucide-ban'
    default: return 'i-lucide-clock'
  }
}

function statusText(status: TmcutExportJob['status']): string {
  switch (status) {
    case 'running': return t('tmcut.queue.statusRunning')
    case 'done': return t('tmcut.queue.statusDone')
    case 'failed': return t('tmcut.queue.statusFailed')
    case 'waiting': return t('tmcut.queue.statusWaiting')
    case 'cancelled': return t('tmcut.queue.statusCancelled')
    default: return status
  }
}

function modeIcon(mode: TmcutExportJob['mode']): string {
  switch (mode) {
    case 'audio': return 'i-lucide-music'
    case 'gif': return 'i-lucide-image'
    default: return 'i-lucide-film'
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :ui="{ content: 'w-[calc(100%-2rem)] max-w-3xl' }"
  >
    <template #content>
      <div class="flex flex-col max-h-[85vh] overflow-hidden rounded-xl bg-neutral-100 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-800 shadow-2xl">
        <!-- HEADER -->
        <div class="px-5 py-4 bg-neutral-100 dark:bg-neutral-900 border-b border-neutral-300 dark:border-neutral-800 flex items-center justify-between gap-3 shrink-0">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
              <UIcon name="i-lucide-list-checks" class="size-4.5 text-primary" />
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h2 class="text-base font-semibold text-neutral-800 dark:text-neutral-100">
                  {{ t('tmcut.queue.title') }}
                </h2>
                <UBadge
                  v-if="activeJobsCount > 0"
                  color="primary"
                  variant="subtle"
                  size="xs"
                >
                  {{ activeJobsCount }}
                </UBadge>
              </div>
              <p class="text-xs text-neutral-500 dark:text-neutral-400">
                {{ t('tmcut.queue.subtitle') }}
              </p>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <UButton
              v-if="!isProcessing && waitingJobs.length > 0"
              icon="i-lucide-play"
              size="xs"
              color="primary"
              variant="solid"
              :label="t('tmcut.queue.startQueue')"
              @click="startQueue"
            />
            <UButton
              v-if="isProcessing && !isQueuePaused"
              icon="i-lucide-pause"
              size="xs"
              color="warning"
              variant="soft"
              :label="t('tmcut.queue.pauseQueue')"
              @click="pauseQueue"
            />
            <UButton
              v-if="isProcessing && isQueuePaused"
              icon="i-lucide-play"
              size="xs"
              color="primary"
              variant="solid"
              :label="t('tmcut.queue.resumeQueue')"
              @click="resumeQueue"
            />
            <UButton
              v-if="doneJobs.length > 0"
              icon="i-lucide-trash"
              size="xs"
              color="neutral"
              variant="ghost"
              :label="t('tmcut.queue.clearDone')"
              @click="clearDoneJobs"
            />
            <UButton
              icon="i-lucide-x"
              size="xs"
              color="neutral"
              variant="ghost"
              @click="open = false"
            />
          </div>
        </div>

        <!-- BODY / LIST -->
        <div class="flex-1 overflow-y-auto p-5 space-y-3">
          <!-- Empty State -->
          <div
            v-if="queue.length === 0"
            class="py-12 flex flex-col items-center justify-center text-center gap-3 text-neutral-500 dark:text-neutral-400"
          >
            <div class="w-12 h-12 rounded-full bg-neutral-100 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-800 flex items-center justify-center">
              <UIcon name="i-lucide-list-checks" class="size-6 text-neutral-500" />
            </div>
            <div>
              <p class="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                {{ t('tmcut.queue.empty') }}
              </p>
              <p class="text-xs text-neutral-500 max-w-sm mt-1">
                {{ t('tmcut.queue.emptyDesc') }}
              </p>
            </div>
          </div>

          <!-- Job Cards -->
          <div
            v-for="job in queue"
            :key="job.id"
            class="rounded-lg border border-neutral-300 dark:border-neutral-800 bg-neutral-100/60 dark:bg-neutral-900/60 p-4 space-y-2.5 transition-colors hover:border-neutral-400 dark:hover:border-neutral-700"
          >
            <!-- Top line: Title, mode, specs, status badge -->
            <div class="flex items-start justify-between gap-3">
              <div class="flex items-center gap-2.5 min-w-0">
                <div class="w-7 h-7 rounded bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center shrink-0">
                  <UIcon :name="modeIcon(job.mode)" class="size-3.5 text-neutral-600 dark:text-neutral-300" />
                </div>
                <div class="min-w-0">
                  <h3 class="text-sm font-medium text-neutral-800 dark:text-neutral-100 truncate" :title="job.projectName">
                    {{ job.projectName }}
                  </h3>
                  <div class="flex items-center gap-2 text-[11px] text-neutral-500 dark:text-neutral-400 font-mono">
                    <span class="truncate">{{ job.specs }}</span>
                  </div>
                </div>
              </div>

              <!-- Status Badge -->
              <UBadge
                :color="statusColor(job.status)"
                variant="subtle"
                size="sm"
                class="shrink-0 flex items-center gap-1"
              >
                <UIcon
                  :name="statusIcon(job.status)"
                  class="size-3"
                  :class="job.status === 'running' ? 'animate-spin' : ''"
                />
                {{ statusText(job.status) }}
              </UBadge>
            </div>

            <!-- Path line -->
            <div class="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400 font-mono truncate" :title="job.outputPath">
              <UIcon name="i-lucide-folder-open" class="size-3.5 text-neutral-500 shrink-0" />
              <span class="truncate">{{ job.outputPath }}</span>
            </div>

            <!-- Progress bar (when running) -->
            <div v-if="job.status === 'running'" class="space-y-1 pt-1">
              <div class="flex items-center justify-between text-[11px] font-mono text-neutral-500 dark:text-neutral-400">
                <span class="text-primary font-medium">{{ job.progress.toFixed(1) }}%</span>
                <span>{{ job.speed || '1.0x' }}</span>
              </div>
              <UProgress :model-value="job.progress" color="primary" size="sm" />
            </div>

            <!-- Error Banner (when failed) -->
            <div
              v-if="job.status === 'failed' && job.error"
              class="rounded bg-red-950/40 border border-red-800/40 px-3 py-1.5 text-xs text-red-300 flex items-start gap-2"
            >
              <UIcon name="i-lucide-circle-alert" class="size-3.5 text-red-400 shrink-0 mt-0.5" />
              <span class="truncate" :title="job.error">{{ job.error }}</span>
            </div>

            <!-- Bottom Action Row -->
            <div class="flex items-center justify-between pt-1 border-t border-neutral-300/60 dark:border-neutral-800/60 text-xs">
              <span class="text-[11px] text-neutral-500">
                {{ new Date(job.createdAt).toLocaleTimeString() }}
              </span>

              <div class="flex items-center gap-1.5">
                <!-- If completed: Reveal in folder + Play -->
                <template v-if="job.status === 'done'">
                  <UButton
                    icon="i-lucide-folder-open"
                    size="xs"
                    color="neutral"
                    variant="soft"
                    :title="t('tmcut.queue.openFolder')"
                    @click="openFolder(job.outputPath)"
                  />
                  <UButton
                    icon="i-lucide-play"
                    size="xs"
                    color="neutral"
                    variant="soft"
                    :title="t('tmcut.queue.openResult')"
                    @click="openFile(job.outputPath)"
                  />
                </template>

                <!-- If failed: Retry -->
                <UButton
                  v-if="job.status === 'failed'"
                  icon="i-lucide-rotate-ccw"
                  size="xs"
                  color="neutral"
                  variant="soft"
                  :title="t('tmcut.queue.retryJob')"
                  @click="retryJob(job.id)"
                />

                <!-- If running: Cancel -->
                <UButton
                  v-if="job.status === 'running'"
                  icon="i-lucide-x"
                  size="xs"
                  color="error"
                  variant="soft"
                  :title="t('tmcut.queue.cancelJob')"
                  @click="cancelJob(job.id)"
                />

                <!-- If not running: Remove from queue -->
                <UButton
                  v-if="job.status !== 'running'"
                  icon="i-lucide-trash"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  :title="t('tmcut.queue.removeJob')"
                  @click="removeJob(job.id)"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- FOOTER -->
        <div class="px-5 py-3 bg-neutral-100 dark:bg-neutral-900 border-t border-neutral-300 dark:border-neutral-800 flex items-center justify-between gap-3 text-xs text-neutral-500 dark:text-neutral-400 shrink-0">
          <div>
            <span>{{ t('tmcut.queue.activeTasks', { n: activeJobsCount }) }}</span>
            <span class="mx-2 text-neutral-600 dark:text-neutral-700">·</span>
            <span>{{ t('tmcut.queue.completedTasks', { n: doneJobs.length }) }}</span>
          </div>
          <UButton
            variant="soft"
            color="neutral"
            size="sm"
            @click="open = false"
          >
            {{ t('tmcut.export.close') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
