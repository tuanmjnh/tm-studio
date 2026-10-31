<script setup lang="ts">
const { t } = useI18n()
const updater = useAppUpdater()

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`
}

function formatSpeed(bytesPerSecond: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return '0 KB/s'
  return `${formatBytes(bytesPerSecond)}/s`
}
</script>

<template>
  <BaseResponsiveModal
    v-model:open="updater.isUpdateModalOpen.value"
    :title="t('appUpdate.title')"
    :description="t('appUpdate.description')"
    icon="i-lucide-arrow-up-circle"
  >
    <template #body>
      <div class="space-y-4 text-xs">
        <!-- Version Info Card -->
        <div
          class="p-3.5 rounded-xl border border-neutral-200/80 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-900/40 flex items-center justify-between"
        >
          <div class="flex items-center gap-3">
            <div class="p-2 rounded-lg bg-primary/10 text-primary">
              <UIcon name="i-lucide-sparkles" class="size-5 shrink-0" />
            </div>
            <div>
              <p class="text-xs text-muted">
                {{ t('appUpdate.currentVersion') }}
              </p>
              <p class="font-mono font-semibold text-sm">
                v{{ updater.currentVersion.value || '1.0.0' }}
              </p>
            </div>
          </div>

          <UIcon name="i-lucide-arrow-right" class="size-4 text-muted" />

          <div class="text-right">
            <p class="text-xs text-muted">
              {{ t('appUpdate.latestVersion') }}
            </p>
            <UBadge
              color="primary"
              variant="subtle"
              size="sm"
              class="font-mono font-semibold"
            >
              v{{ updater.updateInfo.value?.version || updater.currentVersion.value || '1.0.0' }}
            </UBadge>
          </div>
        </div>

        <!-- Release Notes Section -->
        <div v-if="updater.updateInfo.value?.releaseNotes" class="space-y-1.5">
          <div class="flex items-center gap-1.5 font-semibold text-neutral-700 dark:text-neutral-300">
            <UIcon name="i-lucide-file-text" class="size-3.5 text-primary" />
            <span>{{ t('appUpdate.changelog') }}</span>
          </div>
          <div
            class="max-h-48 overflow-y-auto p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white/60 dark:bg-neutral-900/60 font-mono text-[11px] leading-relaxed whitespace-pre-wrap select-text"
          >
            {{ updater.updateInfo.value.releaseNotes }}
          </div>
        </div>

        <!-- Progress Section (When Downloading) -->
        <div
          v-if="updater.downloading.value"
          class="p-3.5 rounded-xl border border-primary/30 bg-primary/5 dark:bg-primary/10 space-y-2.5"
        >
          <div class="flex items-center justify-between">
            <span class="text-primary font-medium flex items-center gap-1.5">
              <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
              {{ t('appUpdate.downloading') }}
            </span>
            <span class="font-mono font-semibold text-primary">
              {{ updater.progress.value.percent }}%
            </span>
          </div>
          <UProgress :model-value="updater.progress.value.percent" color="primary" size="sm" />
          <div class="flex items-center justify-between text-[11px] text-muted font-mono">
            <span>{{ formatSpeed(updater.progress.value.bytesPerSecond) }}</span>
            <span v-if="updater.progress.value.total > 0">
              {{ formatBytes(updater.progress.value.transferred) }} / {{ formatBytes(updater.progress.value.total) }}
            </span>
          </div>
        </div>

        <!-- Downloaded Success Alert -->
        <div
          v-if="updater.downloaded.value"
          class="p-3.5 rounded-xl border border-success/30 bg-success/5 dark:bg-success/10 flex items-start gap-3"
        >
          <UIcon name="i-lucide-check-circle" class="size-5 text-success shrink-0 mt-0.5" />
          <div class="space-y-1">
            <p class="font-semibold text-success">
              {{ t('appUpdate.downloadCompleted') }}
            </p>
            <p class="text-xs text-neutral-600 dark:text-neutral-300">
              {{ t('appUpdate.readyToInstallDesc') }}
            </p>
          </div>
        </div>

        <!-- Error Alert -->
        <div
          v-if="updater.error.value"
          class="p-3 rounded-lg border border-error/30 bg-error/5 dark:bg-error/10 flex items-start gap-2.5 text-error"
        >
          <UIcon name="i-lucide-alert-triangle" class="size-4 shrink-0 mt-0.5" />
          <span class="break-all">{{ updater.error.value }}</span>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center justify-between w-full gap-2">
        <UButton
          variant="ghost"
          color="neutral"
          :label="t('global.cancel')"
          @click="updater.closeModal()"
        />

        <div class="flex items-center gap-2">
          <!-- Download button -->
          <UButton
            v-if="updater.status.value === 'available'"
            icon="i-lucide-download-cloud"
            color="primary"
            variant="solid"
            :label="t('appUpdate.downloadNow')"
            @click="updater.startDownload()"
          />

          <!-- Downloading button (loading state) -->
          <UButton
            v-else-if="updater.downloading.value"
            loading
            disabled
            color="primary"
            variant="soft"
            :label="`${t('appUpdate.downloading')} (${updater.progress.value.percent}%)`"
          />

          <!-- Restart and install button -->
          <UButton
            v-else-if="updater.downloaded.value"
            icon="i-lucide-rotate-cw"
            color="success"
            variant="solid"
            :label="t('appUpdate.restartAndInstall')"
            @click="updater.quitAndInstall()"
          />

          <!-- Re-check button for other states -->
          <UButton
            v-else
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="soft"
            :loading="updater.checking.value"
            :label="t('tools.refresh')"
            @click="updater.checkForUpdates(false)"
          />
        </div>
      </div>
    </template>
  </BaseResponsiveModal>
</template>
