<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const { t } = useI18n()
const toast = useToast()

// reactive() so the template auto-unwraps the nested refs of each driver
// (a plain object of refs is NOT unwrapped in templates).
const usage = reactive(useTmcutUsageTracker())
const telemetry = reactive(useTmcutTelemetry())
const recovery = reactive(useTmcutCrashRecovery())

const limitsDraft = ref({
  aiTokensMonthly: 1_000_000,
  generationCostMonthlyUsd: 10,
  assetDownloadGbMonthly: 5
})

onMounted(() => {
  limitsDraft.value = {
    aiTokensMonthly: usage.limits.aiTokensMonthly,
    generationCostMonthlyUsd: usage.limits.generationCostMonthlyUsd,
    assetDownloadGbMonthly: usage.limits.assetDownloadGbMonthly
  }
  void recovery.runHealthChecks()
})

const saveLimits = () => {
  usage.updateLimits(limitsDraft.value)
  toast.add({ title: t('settings.saved'), color: 'success' })
}

const resetCounters = () => {
  usage.reset()
  toast.add({ title: t('settings.usageResetCounters'), color: 'info' })
}

const clearTelemetry = () => {
  telemetry.clear()
  toast.add({ title: t('settings.telemetryClearEvents'), color: 'info' })
}

const clearCrashLog = () => {
  recovery.clearCrashes()
  toast.add({ title: t('settings.crashRecoveryClearLog'), color: 'info' })
}

const downloadSupportBundle = () => {
  const bundle = recovery.generateSupportBundle('tm-tools')
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `tmcut-support-bundle-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  toast.add({ title: t('settings.supportBundleGenerated'), color: 'success' })
}

const fmtBytes = (gb: number) => `${gb} GB`
const fmtUsd = (usd: number) => `$${usd.toFixed(2)}`

const navItems = computed<NavigationMenuItem[]>(() => [
  { label: t('settings.appearance'), icon: 'i-lucide-palette', to: '/system/settings' },
  { label: t('settings.production'), icon: 'i-lucide-shield-check', to: '/system/settings/production' },
  { label: t('nav.system'), icon: 'i-lucide-cpu', to: '/system/settings/system' }
])

useHead({ title: computed(() => t('settings.production')) })
</script>

<template>
  <BasePage id="settings-production" :title="t('settings.production')" :description="t('settings.usageDesc')">
    <BaseSectionNav :items="navItems">
      <div class="space-y-6">
        <!-- ===== Usage & Limits ===== -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-gauge" class="size-5 text-primary" />
              <span>{{ t('settings.usage') }}</span>
            </div>
          </template>

          <p class="text-sm text-muted mb-4">
            {{ t('settings.usageDesc') }}
          </p>

          <div v-if="usage.summary" class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <!-- AI Tokens -->
            <div class="rounded-xl border border-default bg-elevated/40 p-4">
              <div class="flex items-center justify-between mb-1">
                <p class="text-xs font-medium text-muted">
                  {{ t('settings.usageAiTokens') }}
                </p>
                <UBadge
                  v-if="usage.nearAiLimit"
                  :label="t('settings.usageNearLimit', { pct: usage.aiTokensPct })"
                  :color="usage.aiTokensPct >= 100 ? 'error' : 'warning'"
                  size="sm"
                />
              </div>
              <p class="text-sm font-semibold text-highlighted font-mono">
                {{ usage.summary.aiTokens.toLocaleString() }}
                <span class="text-xs font-normal text-muted">/ {{ usage.summary.aiTokensLimit.toLocaleString() }}</span>
              </p>
              <div class="mt-2 h-1.5 rounded-full bg-default overflow-hidden">
                <div
                  class="h-full rounded-full transition-all"
                  :class="usage.aiTokensPct >= 100 ? 'bg-error' : usage.aiTokensPct >= 90 ? 'bg-warning' : 'bg-primary'"
                  :style="{ width: `${Math.min(usage.aiTokensPct, 100)}%` }"
                />
              </div>
            </div>

            <!-- Generation Cost -->
            <div class="rounded-xl border border-default bg-elevated/40 p-4">
              <div class="flex items-center justify-between mb-1">
                <p class="text-xs font-medium text-muted">
                  {{ t('settings.usageGenerationCost') }}
                </p>
                <UBadge
                  v-if="usage.nearGenerationLimit"
                  :label="t('settings.usageNearLimit', { pct: usage.generationCostPct })"
                  :color="usage.generationCostPct >= 100 ? 'error' : 'warning'"
                  size="sm"
                />
              </div>
              <p class="text-sm font-semibold text-highlighted font-mono">
                {{ fmtUsd(usage.summary.generationCostUsd) }}
                <span class="text-xs font-normal text-muted">/ {{ fmtUsd(usage.summary.generationCostLimitUsd) }}</span>
              </p>
              <div class="mt-2 h-1.5 rounded-full bg-default overflow-hidden">
                <div
                  class="h-full rounded-full transition-all"
                  :class="usage.generationCostPct >= 100 ? 'bg-error' : usage.generationCostPct >= 90 ? 'bg-warning' : 'bg-primary'"
                  :style="{ width: `${Math.min(usage.generationCostPct, 100)}%` }"
                />
              </div>
            </div>

            <!-- Asset Downloads -->
            <div class="rounded-xl border border-default bg-elevated/40 p-4">
              <div class="flex items-center justify-between mb-1">
                <p class="text-xs font-medium text-muted">
                  {{ t('settings.usageAssetDownload') }}
                </p>
                <UBadge
                  v-if="usage.nearAssetLimit"
                  :label="t('settings.usageNearLimit', { pct: usage.assetDownloadPct })"
                  :color="usage.assetDownloadPct >= 100 ? 'error' : 'warning'"
                  size="sm"
                />
              </div>
              <p class="text-sm font-semibold text-highlighted font-mono">
                {{ fmtBytes(usage.summary.assetDownloadGb) }}
                <span class="text-xs font-normal text-muted">/ {{ fmtBytes(usage.summary.assetDownloadLimitGb) }}</span>
              </p>
              <div class="mt-2 h-1.5 rounded-full bg-default overflow-hidden">
                <div
                  class="h-full rounded-full transition-all"
                  :class="usage.assetDownloadPct >= 100 ? 'bg-error' : usage.assetDownloadPct >= 90 ? 'bg-warning' : 'bg-primary'"
                  :style="{ width: `${Math.min(usage.assetDownloadPct, 100)}%` }"
                />
              </div>
            </div>
          </div>

          <!-- Custom limits -->
          <USeparator class="my-4" />

          <p class="text-sm font-medium text-highlighted mb-3">
            {{ t('settings.usageSetLimits') }}
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <UFormField :label="t('settings.usageAiTokensMonthly')">
              <UInput
                v-model.number="limitsDraft.aiTokensMonthly"
                type="number"
                min="0"
                size="sm"
              />
            </UFormField>
            <UFormField :label="t('settings.usageGenerationCostMonthly')">
              <UInput
                v-model.number="limitsDraft.generationCostMonthlyUsd"
                type="number"
                min="0"
                step="0.5"
                size="sm"
              />
            </UFormField>
            <UFormField :label="t('settings.usageAssetDownloadMonthly')">
              <UInput
                v-model.number="limitsDraft.assetDownloadGbMonthly"
                type="number"
                min="0"
                step="0.5"
                size="sm"
              />
            </UFormField>
          </div>

          <template #footer>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <UButton
                color="neutral"
                variant="soft"
                icon="i-lucide-rotate-ccw"
                size="sm"
                :label="t('settings.usageResetCounters')"
                @click="resetCounters"
              />
              <UButton
                color="primary"
                variant="soft"
                icon="i-lucide-save"
                size="sm"
                :label="t('settings.usageSaveLimits')"
                @click="saveLimits"
              />
            </div>
          </template>
        </UCard>

        <!-- ===== Telemetry ===== -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-signal" class="size-5 text-primary" />
              <span>{{ t('settings.telemetry') }}</span>
            </div>
          </template>

          <p class="text-sm text-muted mb-4">
            {{ t('settings.telemetryDesc') }}
          </p>

          <div class="flex items-start gap-3">
            <USwitch v-model="telemetry.enabled" class="mt-0.5" @update:model-value="telemetry.setEnabled" />
            <div>
              <p class="text-sm font-medium text-highlighted">
                {{ t('settings.telemetryEnabled') }}
              </p>
              <p class="text-xs text-muted mt-1">
                {{ t('settings.telemetryPrivacyNote') }}
              </p>
            </div>
          </div>

          <div class="mt-4 flex items-center justify-between rounded-xl border border-default bg-elevated/40 px-4 py-3">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-bar-chart-3" class="size-4 text-muted" />
              <span class="text-sm text-muted">
                {{ t('settings.telemetryEventsRecorded') }}
              </span>
            </div>
            <span class="text-sm font-mono font-semibold text-highlighted">
              {{ telemetry.eventCount }}
            </span>
          </div>

          <template #footer>
            <div class="flex items-center justify-start">
              <UButton
                color="neutral"
                variant="soft"
                icon="i-lucide-trash"
                size="sm"
                :label="t('settings.telemetryClearEvents')"
                :disabled="telemetry.eventCount === 0"
                @click="clearTelemetry"
              />
            </div>
          </template>
        </UCard>

        <!-- ===== Crash Recovery & Support ===== -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-life-buoy" class="size-5 text-primary" />
              <span>{{ t('settings.crashRecovery') }}</span>
            </div>
          </template>

          <p class="text-sm text-muted mb-4">
            {{ t('settings.crashRecoveryDesc') }}
          </p>

          <!-- Recovery checkpoint -->
          <div
            v-if="recovery.manifest?.hasCheckpoint && recovery.manifest.canRecover"
            class="rounded-xl border border-warning/40 bg-warning/10 p-4"
          >
            <div class="flex items-start gap-3">
              <UIcon name="i-lucide-alert-triangle" class="size-5 text-warning mt-0.5" />
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-highlighted">
                  {{ t('settings.crashRecoveryCheckpointFound') }}
                </p>
                <p class="text-xs text-muted mt-1">
                  {{ t('settings.crashRecoveryProjectName', { name: recovery.manifest.projectName || '—' }) }}
                  · {{ t('settings.crashRecoveryAge', { minutes: recovery.manifest.ageMinutes }) }}
                  <span v-if="recovery.manifest.unsavedChanges" class="text-warning">
                    · {{ t('settings.crashRecoveryUnsavedChanges') }}
                  </span>
                </p>
              </div>
              <UButton
                color="neutral"
                variant="soft"
                size="sm"
                icon="i-lucide-x"
                square
                :aria-label="t('settings.crashRecoveryDismiss')"
                @click="recovery.clearCheckpoint()"
              />
            </div>
          </div>
          <p v-else class="text-sm text-muted rounded-xl border border-default bg-elevated/40 p-4">
            {{ t('settings.crashRecoveryNoCheckpoint') }}
          </p>

          <!-- Crash log -->
          <div class="mt-4">
            <div class="flex items-center justify-between mb-2">
              <p class="text-sm font-medium text-highlighted">
                {{ t('settings.crashRecoveryCrashLog') }}
              </p>
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-trash"
                :label="t('settings.crashRecoveryClearLog')"
                :disabled="recovery.crashLog.length === 0"
                @click="clearCrashLog"
              />
            </div>
            <div v-if="recovery.crashLog.length === 0" class="rounded-xl border border-default bg-elevated/40 p-3 text-xs text-muted">
              {{ t('settings.crashRecoveryNoCrashes') }}
            </div>
            <ul v-else class="space-y-2">
              <li
                v-for="(crash, index) in recovery.crashLog.slice(-5)"
                :key="`${crash.timestamp}-${index}`"
                class="rounded-xl border border-default bg-elevated/40 p-3"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="text-xs font-medium text-error truncate">{{ crash.message }}</span>
                  <span class="text-[11px] font-mono text-muted shrink-0">
                    {{ new Date(crash.timestamp).toLocaleString() }}
                  </span>
                </div>
              </li>
            </ul>
          </div>

          <!-- Health checks -->
          <div class="mt-4">
            <div class="flex items-center justify-between mb-2">
              <p class="text-sm font-medium text-highlighted">
                {{ t('settings.crashRecoveryHealthChecks') }}
              </p>
              <UButton
                color="neutral"
                variant="soft"
                size="xs"
                icon="i-lucide-stethoscope"
                :loading="recovery.checking"
                :label="t('settings.crashRecoveryRunChecks')"
                @click="recovery.runHealthChecks()"
              />
            </div>
            <div
              v-if="recovery.healthSummary"
              class="rounded-xl border border-default bg-elevated/40 p-3"
            >
              <div class="flex flex-wrap gap-2">
                <UBadge
                  v-for="check in recovery.healthChecksList"
                  :key="check.name"
                  :label="`${check.name}: ${check.status}`"
                  :color="check.status === 'ok' ? 'success' : check.status === 'warn' ? 'warning' : 'error'"
                  size="sm"
                  :title="check.detail"
                />
              </div>
            </div>
          </div>

          <template #footer>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="min-w-0">
                <p class="text-xs text-muted">
                  {{ t('settings.crashRecoveryBundleDesc') }}
                </p>
              </div>
              <UButton
                color="primary"
                variant="soft"
                icon="i-lucide-file-down"
                size="sm"
                :label="t('settings.crashRecoveryGenerateBundle')"
                @click="downloadSupportBundle"
              />
            </div>
          </template>
        </UCard>
      </div>
    </BaseSectionNav>
  </BasePage>
</template>
