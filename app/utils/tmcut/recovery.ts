// Strangler (roadmap Phase 1): canonical implementation lives in @tmcut/core
// (pure, unit-tested). Types stay here; existing import paths preserved.
export type TmcutRecoveryDecision = 'none' | 'suggest' | 'force'

export interface TmcutRecoveryInput {
  hasRecovery: boolean
  recoveryUpdatedAtMs: number | null
  hasProject: boolean
  projectMtimeMs: number
}

export { decideRecovery } from '@tmcut-core'
