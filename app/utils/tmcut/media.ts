// Strangler (roadmap Phase 1): canonical implementations live in @tmcut/core
// (pure, unit-tested, 32 tests). This module preserves existing import paths.
export {
  normalizeMediaPath,
  mediaFileKey,
  mediaFileName,
  extensionOf,
  classifyAssetKind,
  formatDurationSec,
  formatFileSize
} from '@tmcut-core'
