// =============================================================================
//  Telemetry opt-in driver (roadmap v3 §26 Phase 10)
//
//  Wraps core telemetry with reactive state for settings UI.
//  User must explicitly enable; events only recorded when enabled.
// =============================================================================

import { ref } from 'vue'
import {
  isTelemetryEnabled,
  setTelemetryEnabled,
  recordTelemetryEvent,
  getTelemetryEvents,
  clearTelemetryEvents,
  generateTelemetryReport,
  TELEMETRY_CATEGORIES,
  TELEMETRY_ACTIONS
} from '@tmcut-core'

export function useTmcutTelemetry() {
  const enabled = ref(isTelemetryEnabled())
  const eventCount = ref(0)

  function refreshCount() {
    eventCount.value = getTelemetryEvents().length
  }

  refreshCount()

  function setEnabled(value: boolean) {
    enabled.value = value
    setTelemetryEnabled(value)
  }

  function record(category: keyof typeof TELEMETRY_CATEGORIES, action: string, metadata?: Record<string, unknown>) {
    if (!enabled.value) return
    recordTelemetryEvent(category, action, metadata)
    refreshCount()
  }

  function clear() {
    clearTelemetryEvents()
    refreshCount()
  }

  function generateReport(appVersion: string) {
    return generateTelemetryReport(appVersion)
  }

  // Convenience methods for common events
  function trackEditor(action: string, metadata?: Record<string, unknown>) {
    record('editor', action, metadata)
  }

  function trackExport(action: string, metadata?: Record<string, unknown>) {
    record('export', action, metadata)
  }

  function trackAi(action: string, metadata?: Record<string, unknown>) {
    record('ai', action, metadata)
  }

  function trackAutocut(action: string, metadata?: Record<string, unknown>) {
    record('autocut', action, metadata)
  }

  function trackAssetCenter(action: string, metadata?: Record<string, unknown>) {
    record('assetCenter', action, metadata)
  }

  function trackTemplates(action: string, metadata?: Record<string, unknown>) {
    record('templates', action, metadata)
  }

  function trackAudio(action: string, metadata?: Record<string, unknown>) {
    record('audio', action, metadata)
  }

  function trackProject(action: string, metadata?: Record<string, unknown>) {
    record('project', action, metadata)
  }

  function trackSettings(action: string, metadata?: Record<string, unknown>) {
    record('settings', action, metadata)
  }

  function trackError(action: string, metadata?: Record<string, unknown>) {
    record('error', action, metadata)
  }

  return {
    enabled,
    eventCount,
    setEnabled,
    record,
    clear,
    generateReport,
    trackEditor,
    trackExport,
    trackAi,
    trackAutocut,
    trackAssetCenter,
    trackTemplates,
    trackAudio,
    trackProject,
    trackSettings,
    trackError,
    categories: TELEMETRY_CATEGORIES,
    actions: TELEMETRY_ACTIONS
  }
}
