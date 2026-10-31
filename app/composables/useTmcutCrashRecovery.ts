// =============================================================================
//  Crash recovery & support diagnostics driver (roadmap v3 §26 Phase 10)
//
//  Wraps core crashRecovery for the recovery UI (startup banner) and
//  the "Support" section in Settings.
// =============================================================================

import { ref, computed } from 'vue'
import {
  checkpointRecovery,
  clearRecoveryCheckpoint,
  recordCrash,
  getCrashLog,
  clearCrashLog,
  runHealthChecks as runCoreHealthChecks,
  generateSupportBundle as buildSupportBundle,
  getRecoveryManifest
} from '@tmcut-core'

export interface RecoveryManifest {
  hasCheckpoint: boolean
  canRecover: boolean
  projectName: string | null
  projectId: string | null
  canvas: { width: number, height: number, fps: number } | null
  timelineDurationMs: number
  clipCount: number
  unsavedChanges: boolean
  lastAction: string | null
  ageMinutes: number
}

export function useTmcutCrashRecovery() {
  const manifest = ref<RecoveryManifest | null>(null)
  const crashLog = ref<Array<{ timestamp: number, version: string, message: string, stack: string | null }>>([])
  const healthChecks = ref<Array<{ name: string, status: 'ok' | 'warn' | 'fail', detail: string }>>([])
  const healthSummary = ref<{ ok: number, warn: number, fail: number, overall: 'ok' | 'warn' | 'fail' } | null>(null)
  const checking = ref(false)

  // Computed list so template v-for has a clean array type (avoids v-if narrowing issues)
  const healthChecksList = computed(() => healthChecks.value)

  function refreshManifest() {
    manifest.value = getRecoveryManifest()
  }

  function refreshCrashLog() {
    crashLog.value = getCrashLog()
  }

  async function runHealthChecks(): Promise<void> {
    checking.value = true
    try {
      const result = await runCoreHealthChecks()
      healthChecks.value = result.checks
      healthSummary.value = result.summary
    } finally {
      checking.value = false
    }
  }

  function clearCheckpoint() {
    clearRecoveryCheckpoint()
    refreshManifest()
  }

  function clearCrashes() {
    clearCrashLog()
    refreshCrashLog()
  }

  function generateSupportBundle(appVersion: string) {
    return buildSupportBundle(appVersion)
  }

  // Called periodically by the editor to checkpoint state
  function checkpoint(state: Record<string, unknown>) {
    checkpointRecovery(state)
    refreshManifest()
  }

  // Called by main process on uncaught exception (via IPC)
  function logCrash(error: Error, context?: Record<string, unknown>) {
    recordCrash(error, context)
    refreshCrashLog()
  }

  // Initial load
  refreshManifest()
  refreshCrashLog()

  return {
    manifest,
    crashLog,
    healthChecks,
    healthChecksList,
    healthSummary,
    checking,
    refreshManifest,
    refreshCrashLog,
    runHealthChecks,
    clearCheckpoint,
    clearCrashes,
    generateSupportBundle,
    checkpoint,
    logCrash
  }
}
