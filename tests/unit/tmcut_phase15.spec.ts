import assert from 'node:assert/strict'
import {
  classifyAssetKind,
  extensionOf,
  formatDurationSec,
  formatFileSize,
  mediaFileName,
  mediaFileKey,
  normalizeMediaPath
} from '../../app/utils/tmcut/media'
import { clampWaveformPoints, int16ToPeaks } from '../../app/utils/tmcut/waveform'
import { decideRecovery } from '../../app/utils/tmcut/recovery'

let passed = 0

function check(label: string, fn: () => void) {
  fn()
  passed++
  console.log(`   ${label} PASSED`)
}

function main() {
  console.log('=== [TMCut Phase 1.5 Test Suite] Starting tests ===\n')

  check('normalizeMediaPath converts backslashes and trims', () => {
    assert.equal(normalizeMediaPath('  D:\\Users\\x\\a.mp4  '), 'D:/Users/x/a.mp4')
    assert.equal(normalizeMediaPath('/home/u/b.mp3'), '/home/u/b.mp3')
    assert.equal(normalizeMediaPath(''), '')
  })

  check('mediaFileKey is case- and separator-insensitive', () => {
    assert.equal(mediaFileKey('D:\\X\\Video.MP4'), mediaFileKey('d:/x/video.mp4'))
  })

  check('mediaFileName picks last segment', () => {
    assert.equal(mediaFileName('D:/a/b/clip.MP4'), 'clip.MP4')
    assert.equal(mediaFileName('clip.mov'), 'clip.mov')
    assert.equal(mediaFileName(''), '')
  })

  check('extensionOf lowercases and ignores missing dot', () => {
    assert.equal(extensionOf('a/b/My Clip.WEBM'), 'webm')
    assert.equal(extensionOf('noext'), '')
    assert.equal(extensionOf('.hidden'), '')
  })

  check('classifyAssetKind maps extensions to kinds', () => {
    assert.equal(classifyAssetKind('v.mp4'), 'video')
    assert.equal(classifyAssetKind('v.MOV'), 'video')
    assert.equal(classifyAssetKind('v.mkv'), 'video')
    assert.equal(classifyAssetKind('v.webm'), 'video')
    assert.equal(classifyAssetKind('a.mp3'), 'audio')
    assert.equal(classifyAssetKind('a.wav'), 'audio')
    assert.equal(classifyAssetKind('a.m4a'), 'audio')
    assert.equal(classifyAssetKind('p.png'), 'image')
    assert.equal(classifyAssetKind('p.JPEG'), 'image')
    assert.equal(classifyAssetKind('p.gif'), 'image')
    assert.equal(classifyAssetKind('doc.txt'), null)
    assert.equal(classifyAssetKind(''), null)
  })

  check('formatDurationSec formats minutes:seconds', () => {
    assert.equal(formatDurationSec(0), '0:00')
    assert.equal(formatDurationSec(5), '0:05')
    assert.equal(formatDurationSec(61), '1:01')
    assert.equal(formatDurationSec(3671), '61:11')
    assert.equal(formatDurationSec(NaN), '0:00')
    assert.equal(formatDurationSec(-3), '0:00')
  })

  check('formatFileSize formats byte sizes', () => {
    assert.equal(formatFileSize(0), '0 B')
    assert.equal(formatFileSize(512), '512 B')
    assert.equal(formatFileSize(2048), '2.0 KB')
    assert.equal(formatFileSize(5 * 1024 * 1024), '5.0 MB')
    assert.equal(formatFileSize(2 * 1024 * 1024 * 1024), '2.0 GB')
    assert.equal(formatFileSize(1536), '1.5 KB')
  })

  check('int16ToPeaks computes per-bucket peak amplitude', () => {
    const samples = Int16Array.from([0, 32767, -32768, 0, 16384, -16384, 0, 0])
    const peaks = int16ToPeaks(samples, 4)
    assert.equal(peaks.length, 4)
    assert.ok(peaks[0]! > 0.99, `bucket0 expected ~1, got ${peaks[0]}`)
    assert.equal(peaks[1], 1)
    assert.ok(Math.abs(peaks[2]! - 0.5) < 0.01, `bucket2 expected 0.5, got ${peaks[2]}`)
    assert.equal(peaks[3], 0)
  })

  check('int16ToPeaks handles empty and uneven buffers', () => {
    assert.deepEqual(int16ToPeaks(Int16Array.from([]), 4), [0, 0, 0, 0])
    const three = int16ToPeaks(Int16Array.from([100, -100, 200]), 4)
    assert.equal(three.length, 4)
    assert.ok(three.every(v => v >= 0 && v <= 1))
    assert.ok(Math.abs(three[1]! - 100 / 32768) < 1e-9)
    assert.ok(Math.abs(three[2]! - 100 / 32768) < 1e-9)
    assert.ok(Math.abs(three[3]! - 200 / 32768) < 1e-9)
  })

  check('clampWaveformPoints clamps into [0,1] and drops invalid input', () => {
    assert.deepEqual(clampWaveformPoints([0.5, -0.2, 1.4, NaN]), [0.5, 0, 1, 0])
    assert.deepEqual(clampWaveformPoints(null), [])
    assert.deepEqual(clampWaveformPoints([]), [])
  })

  check('decideRecovery returns none without recovery file', () => {
    assert.equal(decideRecovery({ hasRecovery: false, recoveryUpdatedAtMs: null, hasProject: true, projectMtimeMs: 1000 }), 'none')
  })

  check('decideRecovery forces when project file is gone', () => {
    assert.equal(decideRecovery({ hasRecovery: true, recoveryUpdatedAtMs: 2000, hasProject: false, projectMtimeMs: 0 }), 'force')
  })

  check('decideRecovery suggests when recovery is newer than saved file', () => {
    assert.equal(decideRecovery({ hasRecovery: true, recoveryUpdatedAtMs: 5000, hasProject: true, projectMtimeMs: 4000 }), 'suggest')
  })

  check('decideRecovery ignores stale recovery', () => {
    assert.equal(decideRecovery({ hasRecovery: true, recoveryUpdatedAtMs: 1000, hasProject: true, projectMtimeMs: 4000 }), 'none')
  })

  console.log(`\n=== [TMCut Phase 1.5 Test Suite] ${passed} checks passed ===`)
}

main()
