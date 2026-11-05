// Strangler (roadmap Phase 1): canonical implementations live in tmcut-core
// (pure, unit-tested). This module preserves existing import paths.
export {
  TMCUT_WAVEFORM_ALGORITHM,
  TMCUT_WAVEFORM_PEAK_PRECISION,
  buildWaveformPayload,
  clampWaveformPoints,
  floatPeakBuckets,
  int16ToPeaks,
  readWaveformPayload
} from 'tmcut-core'
