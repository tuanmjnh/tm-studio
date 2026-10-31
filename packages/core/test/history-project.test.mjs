// @tmcut/core — history + project tests. Run: node --test test/
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHistory, pushBatch, coalesce } from '../src/history.mjs'
import {
  createProject,
  defaultCanvas,
  defaultTimeline,
  migrateV1ToV3,
  assetIdForPath
} from '../src/project.mjs'
import { addClip } from '../src/timeline.mjs'
import { secToTicks, TICKS_PER_SECOND } from '../src/time.mjs'

describe('history', () => {
  it('undoes and redoes committed commands', () => {
    const history = createHistory(10)
    assert.equal(history.canUndo, false)
    const before = defaultTimeline()
    const after = defaultTimeline()
    addClip(after, 'video', { source: { in: 0, out: secToTicks(3) } })
    history.commit({ name: 'add-clip', label: 'Add clip', before, after })
    assert.equal(history.canUndo, true)
    const restored = history.undo()
    assert.equal(restored.tracks[1].items.length, 0)
    assert.equal(history.canRedo, true)
    const redone = history.redo()
    assert.equal(redone.tracks[1].items.length, 1)
  })

  it('clears redo on new commits and caps depth', () => {
    const history = createHistory(2)
    const blank = () => defaultTimeline()
    history.commit({ name: 'a', before: blank(), after: blank() })
    history.commit({ name: 'b', before: blank(), after: blank() })
    history.commit({ name: 'c', before: blank(), after: blank() })
    assert.equal(history.depth, 2)
    history.undo()
    history.commit({ name: 'd', before: blank(), after: blank() })
    assert.equal(history.canRedo, false)
  })

  it('returns null on empty stacks and rejects bad commands', () => {
    const history = createHistory()
    assert.equal(history.undo(), null)
    assert.equal(history.redo(), null)
    assert.throws(() => history.commit({ name: 'x' }), /requires/)
  })

  it('batches many entries into one undo (C15 pushBatch)', () => {
    const history = createHistory(10)
    const first = defaultTimeline()
    const middle = defaultTimeline()
    const last = defaultTimeline()
    addClip(last, 'video', { source: { in: 0, out: secToTicks(3) } })
    history.commit({ name: 'seed', before: defaultTimeline(), after: defaultTimeline() })
    pushBatch(history, [
      { name: 'a', before: first, after: middle },
      { name: 'b', before: middle, after: last }
    ], 'Paste 2 clips')
    assert.equal(history.depth, 2) // seed + one batched entry
    const restored = history.undo()
    assert.equal(restored.tracks[1].items.length, 0) // back to first.before
    const redone = history.redo()
    assert.equal(redone.tracks[1].items.length, 1) // forward to last.after
    // Empty batches are a no-op.
    pushBatch(history, [])
    assert.equal(history.depth, 2)
  })

  it('coalesces same-name bursts into one entry (C15)', () => {
    const history = createHistory(10)
    const start = defaultTimeline()
    const typed1 = defaultTimeline()
    const typed2 = defaultTimeline()
    addClip(typed2, 'text', { source: { in: 0, out: secToTicks(1) } })
    // Empty stack → regular commit.
    assert.equal(coalesce(history, { name: 'edit-text', before: start, after: typed1 }, 800), false)
    assert.equal(history.depth, 1)
    // Same name, just now → merged; the burst keeps ONE undo entry.
    assert.equal(coalesce(history, { name: 'edit-text', before: typed1, after: typed2 }, 800), true)
    assert.equal(history.depth, 1)
    const restored = history.undo()
    assert.equal(restored.tracks[1].items.length, 0) // whole burst undone at once
    // A different name never merges.
    assert.equal(coalesce(history, { name: 'other', before: start, after: typed1 }, 800), false)
    assert.equal(history.depth, 1)
  })

  it('stays outside the window and invalidates redo when merging (C15)', () => {
    const history = createHistory(10)
    const blank = () => defaultTimeline()
    coalesce(history, { name: 'edit-text', before: blank(), after: blank() }, 800)
    // Age the top entry beyond the window — deterministic clock control.
    history._top().createdAt = new Date(Date.now() - 5000).toISOString()
    assert.equal(coalesce(history, { name: 'edit-text', before: blank(), after: blank() }, 1000), false)
    assert.equal(history.depth, 2)
    // Merging clears a pending redo, exactly like commit does.
    history.undo()
    assert.equal(history.canRedo, true)
    history._top().createdAt = new Date(Date.now() - 5000).toISOString()
    assert.equal(coalesce(history, { name: 'edit-text', before: blank(), after: blank() }, 1000), false)
    assert.equal(history.canRedo, false)
  })
})

describe('project', () => {
  it('creates v3 projects with default tracks', () => {
    const project = createProject('Demo')
    assert.equal(project.version, 3)
    assert.equal(project.timeline.version, 3)
    assert.deepEqual(project.timeline.tracks.map(t => t.type), ['text', 'video', 'audio'])
    assert.deepEqual(project.canvas.fps, { numerator: 30, denominator: 1 })
  })

  it('derives deterministic asset ids from paths', () => {
    const first = assetIdForPath('D:/Videos/a.mp4')
    const second = assetIdForPath('D:/Videos/a.mp4')
    assert.ok(first.startsWith('asset_'))
    assert.equal(first.split('_')[1], second.split('_')[1])
  })

  it('migrates v1 float-second projects to v3 ticks losslessly', () => {
    const v1 = {
      id: 'p1',
      name: 'Old',
      durationMs: 15000,
      canvas: { width: 1080, height: 1920, fps: 30 },
      timeline: {
        version: 1,
        tracks: [
          {
            id: 't-video-1',
            type: 'video',
            name: 'Video 1',
            items: [
              {
                id: 'clip_1',
                name: 'a.mp4',
                src: 'D:/Videos/a.mp4',
                in: 2,
                out: 12,
                offset: 0,
                speed: 1,
                scale: 100,
                opacity: 80
              }
            ]
          }
        ]
      }
    }
    const v3 = migrateV1ToV3(v1)
    assert.equal(v3.version, 3)
    assert.equal(v3.project.duration, 15 * TICKS_PER_SECOND)
    assert.deepEqual(v3.canvas.fps, { numerator: 30, denominator: 1 })
    const clip = v3.timeline.tracks[0].items[0]
    assert.equal(clip.source.in, secToTicks(2))
    assert.equal(clip.source.out, secToTicks(12))
    assert.equal(clip.timeline.start, 0)
    assert.equal(clip.transform.opacity, 0.8)
    assert.ok(clip.assetId)
    assert.deepEqual(clip.locator, { runtime: 'electron', path: 'D:/Videos/a.mp4' })
  })

  it('maps NTSC frame rates during migration', () => {
    const v3 = migrateV1ToV3({
      id: 'p2',
      canvas: { width: 1920, height: 1080, fps: 29.97 },
      timeline: { version: 1, tracks: [] }
    })
    assert.deepEqual(v3.canvas.fps, { numerator: 30000, denominator: 1001 })
  })

  it('rejects non-objects', () => {
    assert.throws(() => migrateV1ToV3(null), /requires a project object/)
  })

  it('builds canvas defaults', () => {
    const canvas = defaultCanvas(1080, 1920, 60)
    assert.equal(canvas.width, 1080)
    assert.deepEqual(canvas.fps, { numerator: 60, denominator: 1 })
  })
})
