// =============================================================================
//  @tmcut/core — recovery
//  Ported from app/utils/tmcut/recovery.ts. Decides whether an autosaved
//  recovery file should be offered or force-applied (docs section 50).
// =============================================================================

/**
 * @returns 'none' | 'suggest' | 'force'
 */
export function decideRecovery(input) {
  if (!input.hasRecovery || input.recoveryUpdatedAtMs === null) return 'none'
  if (Number.isNaN(input.recoveryUpdatedAtMs)) return 'none'
  if (!input.hasProject) return 'force'
  if (!Number.isFinite(input.projectMtimeMs)) return 'suggest'
  return input.recoveryUpdatedAtMs > input.projectMtimeMs ? 'suggest' : 'none'
}
