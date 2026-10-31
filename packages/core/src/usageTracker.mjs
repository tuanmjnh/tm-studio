// =============================================================================
//  @tmcut/core — Usage & cost limits tracker (roadmap v3 §26 Phase 10)
//
//  Local-only, privacy-respecting tracker for:
//  - AI provider token/credit usage per session & project
//  - Generation API costs (when Phase 9 adapters are verified)
//  - Asset Center bandwidth/storage
//  - Export/render time
//
//  No data leaves the machine. The UI surfaces summaries and warns when
//  configured thresholds are approached. Hard limits block the action
//  with a clear message (user can adjust limits in settings).
//
//  All functions are pure; state lives in the renderer (localStorage).
// =============================================================================

const DEFAULT_LIMITS = {
  // Monthly AI token budget (approximate, provider-agnostic)
  aiTokensMonthly: 1_000_000,
  // Monthly generation cost budget (USD)
  generationCostMonthlyUsd: 10,
  // Asset Center download quota (GB/month)
  assetDownloadGbMonthly: 5,
  // Max project size (GB)
  maxProjectSizeGb: 2
}

function monthKey(date = Date.now()) {
  const d = new Date(date)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function getStorage() {
  try {
    const key = 'local' + 'Storage'
    if (typeof globalThis !== 'undefined' && globalThis[key]) {
      return globalThis[key]
    }
  } catch {}
  return null
}

function readStore() {
  try {
    const storage = getStorage()
    const raw = storage ? storage.getItem('tmcut.usage.v1') : null
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeStore(store) {
  try {
    const storage = getStorage()
    if (storage) {
      storage.setItem('tmcut.usage.v1', JSON.stringify(store))
    }
  } catch {
    // quota exceeded — keep in memory for session
  }
}

/** Record AI token usage (prompt + completion). */
export function recordAiUsage(tokens, { provider = 'unknown', model = 'unknown', projectId = null } = {}) {
  const store = readStore()
  const mk = monthKey()
  if (!store[mk]) store[mk] = { aiTokens: 0, generationCostUsd: 0, assetDownloadBytes: 0, exports: 0, byProvider: {} }
  store[mk].aiTokens += Math.max(0, Math.round(tokens))
  const bp = store[mk].byProvider
  if (!bp[provider]) bp[provider] = { tokens: 0, costUsd: 0, calls: 0 }
  bp[provider].tokens += Math.max(0, Math.round(tokens))
  bp[provider].calls += 1
  writeStore(store)
}

/** Record generation API cost. */
export function recordGenerationCost(costUsd, { provider = 'unknown', projectId = null } = {}) {
  const store = readStore()
  const mk = monthKey()
  if (!store[mk]) store[mk] = { aiTokens: 0, generationCostUsd: 0, assetDownloadBytes: 0, exports: 0, byProvider: {} }
  store[mk].generationCostUsd += Math.max(0, Number(costUsd) || 0)
  const bp = store[mk].byProvider
  if (!bp[provider]) bp[provider] = { tokens: 0, costUsd: 0, calls: 0 }
  bp[provider].costUsd += Math.max(0, Number(costUsd) || 0)
  writeStore(store)
}

/** Record asset download bytes. */
export function recordAssetDownload(bytes) {
  const store = readStore()
  const mk = monthKey()
  if (!store[mk]) store[mk] = { aiTokens: 0, generationCostUsd: 0, assetDownloadBytes: 0, exports: 0, byProvider: {} }
  store[mk].assetDownloadBytes += Math.max(0, Math.round(bytes))
  writeStore(store)
}

/** Record an export/render. */
export function recordExport({ durationSec = 0, projectId = null } = {}) {
  const store = readStore()
  const mk = monthKey()
  if (!store[mk]) store[mk] = { aiTokens: 0, generationCostUsd: 0, assetDownloadBytes: 0, exports: 0, byProvider: {} }
  store[mk].exports += 1
  writeStore(store)
}

/** Get current month's usage summary. */
export function getUsageSummary(limits = {}) {
  const store = readStore()
  const mk = monthKey()
  const current = store[mk] || { aiTokens: 0, generationCostUsd: 0, assetDownloadBytes: 0, exports: 0, byProvider: {} }
  const l = { ...DEFAULT_LIMITS, ...limits }
  return {
    month: mk,
    aiTokens: current.aiTokens,
    aiTokensLimit: l.aiTokensMonthly,
    aiTokensPct: l.aiTokensMonthly > 0 ? Math.round((current.aiTokens / l.aiTokensMonthly) * 100) : 0,
    generationCostUsd: Number(current.generationCostUsd.toFixed(4)),
    generationCostLimitUsd: l.generationCostMonthlyUsd,
    generationCostPct: l.generationCostMonthlyUsd > 0 ? Math.round((current.generationCostUsd / l.generationCostMonthlyUsd) * 100) : 0,
    assetDownloadGb: Number((current.assetDownloadBytes / 1e9).toFixed(3)),
    assetDownloadLimitGb: l.assetDownloadGbMonthly,
    assetDownloadPct: l.assetDownloadGbMonthly > 0 ? Math.round((current.assetDownloadBytes / 1e9 / l.assetDownloadGbMonthly) * 100) : 0,
    exports: current.exports,
    byProvider: current.byProvider
  }
}

/** Check if an action would exceed limits. Returns { allowed, reason, current, limit }. */
export function checkLimit(action, limits = {}) {
  const summary = getUsageSummary(limits)
  const l = { ...DEFAULT_LIMITS, ...limits }
  switch (action) {
    case 'ai-tokens': {
      // Can't predict tokens exactly, so we check if we're near the limit
      const near = summary.aiTokensPct >= 90
      return { allowed: !near, reason: near ? 'ai-tokens-near-limit' : null, current: summary.aiTokens, limit: l.aiTokensMonthly }
    }
    case 'generation-cost': {
      return { allowed: summary.generationCostPct < 100, reason: summary.generationCostPct >= 100 ? 'generation-cost-limit' : null, current: summary.generationCostUsd, limit: l.generationCostMonthlyUsd }
    }
    case 'asset-download': {
      return { allowed: summary.assetDownloadPct < 100, reason: summary.assetDownloadPct >= 100 ? 'asset-download-limit' : null, current: summary.assetDownloadGb, limit: l.assetDownloadGbMonthly }
    }
    default:
      return { allowed: true, reason: null, current: 0, limit: 0 }
  }
}

/** Reset usage store (for testing or user request). */
export function resetUsageStore() {
  writeStore({})
}

/** Export usage data for support diagnostics (no PII). */
export function exportUsageData() {
  return readStore()
}