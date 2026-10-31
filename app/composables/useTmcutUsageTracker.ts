// =============================================================================
//  Usage limits & cost tracking driver (roadmap v3 §26 Phase 10)
//
//  Thin wrapper around core usageTracker. Provides reactive state for the
//  settings UI and a "check before action" helper for AI/generation calls.
// =============================================================================

import { ref, computed } from 'vue'
import {
  recordAiUsage,
  recordGenerationCost,
  recordAssetDownload,
  recordExport,
  getUsageSummary,
  checkLimit,
  resetUsageStore,
  exportUsageData
} from '@tmcut-core'

export interface UsageLimits {
  aiTokensMonthly: number
  generationCostMonthlyUsd: number
  assetDownloadGbMonthly: number
}

const DEFAULT_LIMITS: UsageLimits = {
  aiTokensMonthly: 1_000_000,
  generationCostMonthlyUsd: 10,
  assetDownloadGbMonthly: 5
}

const STORAGE_KEY = 'tmcut.usage.limits.v1'

function loadLimits(): UsageLimits {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_LIMITS, ...JSON.parse(raw) }
  } catch {
    // corrupted limits JSON — fall back to defaults
  }
  return { ...DEFAULT_LIMITS }
}

function saveLimits(limits: UsageLimits) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(limits))
  } catch {
    // ignore quota/localStorage errors
  }
}

export function useTmcutUsageTracker() {
  const limits = ref<UsageLimits>(loadLimits())
  const summary = ref<ReturnType<typeof getUsageSummary> | null>(null)

  function refresh() {
    summary.value = getUsageSummary(limits.value)
  }

  refresh()

  // Reactive limit checks for UI
  const aiTokensPct = computed(() => summary.value?.aiTokensPct ?? 0)
  const generationCostPct = computed(() => summary.value?.generationCostPct ?? 0)
  const assetDownloadPct = computed(() => summary.value?.assetDownloadPct ?? 0)

  const nearAiLimit = computed(() => aiTokensPct.value >= 90)
  const nearGenerationLimit = computed(() => generationCostPct.value >= 90)
  const nearAssetLimit = computed(() => assetDownloadPct.value >= 90)

  const anyNearLimit = computed(() => nearAiLimit.value || nearGenerationLimit.value || nearAssetLimit.value)

  function updateLimits(newLimits: Partial<UsageLimits>) {
    limits.value = { ...limits.value, ...newLimits }
    saveLimits(limits.value)
    refresh()
  }

  function reset() {
    resetUsageStore()
    refresh()
  }

  // Recording helpers (called from AI Editor, AutoCut, Asset Center, etc.)
  function trackAiTokens(tokens: number, meta?: { provider?: string, model?: string }) {
    recordAiUsage(tokens, meta)
    refresh()
  }

  function trackGenerationCost(costUsd: number, meta?: { provider?: string }) {
    recordGenerationCost(costUsd, meta)
    refresh()
  }

  function trackAssetDownload(bytes: number) {
    recordAssetDownload(bytes)
    refresh()
  }

  function trackExport(meta?: { durationSec?: number }) {
    recordExport(meta)
    refresh()
  }

  // Pre-action checks (call before expensive operations)
  function canUseAi(tokensEstimate = 0) {
    const check = checkLimit('ai-tokens', limits.value)
    // Token spend can't be predicted exactly — block near the cap (90%)
    // and also when this estimate would push us over it.
    const projected = (summary.value?.aiTokens ?? 0) + Math.max(0, tokensEstimate)
    const wouldExceed = projected > limits.value.aiTokensMonthly
    return { allowed: check.allowed && !wouldExceed, reason: wouldExceed ? 'ai-tokens-limit' : check.reason, current: summary.value?.aiTokens ?? 0, limit: limits.value.aiTokensMonthly }
  }

  function canGenerate(costEstimateUsd = 0) {
    const check = checkLimit('generation-cost', limits.value)
    // Also check if this specific action would exceed
    const projected = (summary.value?.generationCostUsd ?? 0) + costEstimateUsd
    const wouldExceed = projected > limits.value.generationCostMonthlyUsd
    return { allowed: check.allowed && !wouldExceed, reason: wouldExceed ? 'generation-cost-limit' : check.reason, current: summary.value?.generationCostUsd ?? 0, limit: limits.value.generationCostMonthlyUsd }
  }

  function canDownloadAsset(bytesEstimate = 0) {
    const check = checkLimit('asset-download', limits.value)
    const projectedGb = ((summary.value?.assetDownloadGb ?? 0) * 1e9 + bytesEstimate) / 1e9
    const wouldExceed = projectedGb > limits.value.assetDownloadGbMonthly
    return { allowed: check.allowed && !wouldExceed, reason: wouldExceed ? 'asset-download-limit' : check.reason, current: summary.value?.assetDownloadGb ?? 0, limit: limits.value.assetDownloadGbMonthly }
  }

  return {
    limits,
    summary,
    refresh,
    updateLimits,
    reset,
    trackAiTokens,
    trackGenerationCost,
    trackAssetDownload,
    trackExport,
    canUseAi,
    canGenerate,
    canDownloadAsset,
    aiTokensPct,
    generationCostPct,
    assetDownloadPct,
    nearAiLimit,
    nearGenerationLimit,
    nearAssetLimit,
    anyNearLimit,
    exportUsageData
  }
}
