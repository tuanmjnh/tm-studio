import assert from 'node:assert/strict'
import {
  durationToSeconds,
  CURATED_SCRIPT_PRESETS,
  exportScriptMarkdown,
  type TmcutAiScript
} from '../../app/utils/tmcut/aiScript'

let passed = 0

function check(label: string, fn: () => void) {
  fn()
  passed++
  console.log(`   ${label} PASSED`)
}

function main() {
  console.log('=== [TMCut AI Script (Round 71 / H-2) Test Suite] Starting tests ===\n')

  check('durationToSeconds accurately converts duration presets to seconds', () => {
    assert.equal(durationToSeconds('15s'), 15)
    assert.equal(durationToSeconds('30s'), 30)
    assert.equal(durationToSeconds('60s'), 60)
    assert.equal(durationToSeconds('120s'), 120)
  })

  check('CURATED_SCRIPT_PRESETS contain valid structure and scene timing', () => {
    assert.ok(CURATED_SCRIPT_PRESETS.length >= 2, 'Must provide at least 2 presets')
    for (const preset of CURATED_SCRIPT_PRESETS) {
      assert.ok(preset.title.length > 0, 'Preset must have title')
      assert.ok(preset.synopsis.length > 0, 'Preset must have synopsis')
      assert.ok(preset.scenes.length >= 3, 'Preset should have at least 3 scenes')
      const totalDur = preset.scenes.reduce((acc, s) => acc + s.durationSec, 0)
      assert.ok(Math.abs(totalDur - preset.targetDurationSec) <= 5, 'Scene durations should match targetDurationSec')
      for (const scene of preset.scenes) {
        assert.ok(scene.title.length > 0)
        assert.ok(scene.durationSec > 0)
        assert.ok(scene.voiceover.length > 0)
        assert.ok(scene.onScreenText.length > 0)
      }
    }
  })

  check('exportScriptMarkdown formats storyboard cleanly for copy & export', () => {
    const dummyScript: TmcutAiScript = {
      title: 'Top 3 Mẹo Lập Trình',
      synopsis: 'Mẹo code sạch cho lập trình viên mới bắt đầu.',
      platform: 'tiktok-shorts',
      targetDurationSec: 30,
      createdAt: '2026-10-12T00:00:00.000Z',
      scenes: [
        {
          id: 's1',
          order: 1,
          title: 'Hook',
          durationSec: 5,
          visualPrompt: 'Màn hình code IDE lấp lánh',
          voiceover: 'Bạn có đang viết code kiểu này?',
          onScreenText: '3 MẸO CODE SẠCH'
        },
        {
          id: 's2',
          order: 2,
          title: 'Mẹo 1',
          durationSec: 10,
          visualPrompt: 'Đổi tên biến có nghĩa',
          voiceover: 'Đặt tên biến rõ ràng thay vì x hay y.',
          onScreenText: '1. Đặt Tên Biến Rõ Ràng'
        }
      ]
    }

    const md = exportScriptMarkdown(dummyScript)

    assert.ok(md.includes('# Top 3 Mẹo Lập Trình'))
    assert.ok(md.includes('### Cảnh 1: Hook (5s)'))
    assert.ok(md.includes('- **Chữ trên màn hình:** [3 MẸO CODE SẠCH]'))
    assert.ok(md.includes('### Cảnh 2: Mẹo 1 (10s)'))
  })

  console.log(`\n=== All ${passed} tests passed successfully! ===`)
}

main()
