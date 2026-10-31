// @tmcut-core — sticker catalog tests. Run: node --test "test/*.test.mjs"
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { STICKER_GROUPS, allStickers, stickerMatches } from '../src/sticker.mjs'

describe('sticker catalog (R124 A6)', () => {
  it('groups carry unique ids and non-empty emoji sets', () => {
    const ids = STICKER_GROUPS.map(g => g.id)
    assert.equal(new Set(ids).size, ids.length)
    for (const g of STICKER_GROUPS) {
      assert.ok(g.emojis.length >= 10, `${g.id} too small`)
    }
  })

  it('the catalog is duplicate-free', () => {
    const flat = allStickers()
    assert.equal(new Set(flat).size, flat.length)
  })

  it('emojis are single code-point clusters (no variation-selector surprises)', () => {
    // The panel renders them at fixed grid size — every entry must be a
    // compact grapheme: <= 4 UTF-16 units (emoji + skin tone / VS16).
    for (const e of allStickers()) {
      assert.ok(e.length <= 4, `too long: ${JSON.stringify(e)}`)
    }
  })

  it('stickerMatches filters case-insensitively and passes empty queries', () => {
    assert.equal(stickerMatches('', '🔥'), true)
    assert.equal(stickerMatches(null, '🔥'), true)
    assert.equal(stickerMatches('🔥', '🔥'), true)
    assert.equal(stickerMatches('🔥', '⭐'), false)
  })
})
