import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createFolder,
  renameFolder,
  updateFolderColor,
  removeFolder,
  getFolder,
  setAssetFolder,
  getAssetFolder,
  filterAssetsByFolder,
  getFolderCounts,
  FOLDER_TAG_COLORS
} from '../src/folders.mjs'

describe('folders (Roadmap G-3)', () => {
  it('creates folders with defaults and custom options', () => {
    const folders = []
    const f1 = createFolder(folders)
    assert.ok(f1.id.startsWith('folder_'))
    assert.equal(f1.name, 'New Folder')
    assert.equal(f1.color, FOLDER_TAG_COLORS[0])
    assert.equal(f1.projectId, null)
    assert.equal(folders.length, 1)

    const f2 = createFolder(folders, {
      name: 'B-Roll Footage',
      color: '#10b981',
      projectId: 'proj_123'
    })
    assert.equal(f2.name, 'B-Roll Footage')
    assert.equal(f2.color, '#10b981')
    assert.equal(f2.projectId, 'proj_123')
    assert.equal(folders.length, 2)
  })

  it('renames folders safely', () => {
    const folders = []
    const f = createFolder(folders, { name: 'Audio FX' })
    assert.equal(renameFolder(folders, f.id, 'Sound Effects'), true)
    assert.equal(f.name, 'Sound Effects')

    // Trims whitespace
    assert.equal(renameFolder(folders, f.id, '  Ambience  '), true)
    assert.equal(f.name, 'Ambience')

    // Rejects empty or invalid
    assert.equal(renameFolder(folders, f.id, '   '), false)
    assert.equal(renameFolder(folders, 'nonexistent', 'Valid'), false)
  })

  it('updates folder color', () => {
    const folders = []
    const f = createFolder(folders)
    assert.equal(updateFolderColor(folders, f.id, '#ef4444'), true)
    assert.equal(f.color, '#ef4444')
    assert.equal(updateFolderColor(folders, 'missing', '#ef4444'), false)
  })

  it('removes folder by id', () => {
    const folders = []
    const f1 = createFolder(folders, { name: 'Folder 1' })
    const f2 = createFolder(folders, { name: 'Folder 2' })
    assert.equal(removeFolder(folders, f1.id), true)
    assert.equal(folders.length, 1)
    assert.equal(folders[0].id, f2.id)
    assert.equal(removeFolder(folders, 'not_found'), false)
  })

  it('finds folder by id', () => {
    const folders = []
    const f = createFolder(folders, { name: 'Interviews' })
    assert.equal(getFolder(folders, f.id)?.name, 'Interviews')
    assert.equal(getFolder(folders, 'unknown'), null)
  })

  it('assigns and retrieves asset folders with project scope support', () => {
    const asset = { id: 'asset_1', name: 'clip.mp4' }

    // Direct assignment
    setAssetFolder(asset, 'f_broll')
    assert.equal(asset.folderId, 'f_broll')
    assert.equal(getAssetFolder(asset), 'f_broll')

    // Project-scoped assignment
    setAssetFolder(asset, 'f_project_specific', 'proj_abc')
    assert.equal(getAssetFolder(asset, 'proj_abc'), 'f_project_specific')
    // Fallback when requesting another project
    assert.equal(getAssetFolder(asset, 'proj_other'), 'f_broll')

    // Unassign in project scope
    setAssetFolder(asset, null, 'proj_abc')
    assert.equal(getAssetFolder(asset, 'proj_abc'), null)
  })

  it('filters assets by folder including unassigned', () => {
    const assets = [
      { id: 'a1', folderId: 'f1' },
      { id: 'a2', folderId: 'f1' },
      { id: 'a3', folderId: 'f2' },
      { id: 'a4', folderId: null }
    ]

    // All
    assert.equal(filterAssetsByFolder(assets, null).length, 4)
    // Specific folder
    const inF1 = filterAssetsByFolder(assets, 'f1')
    assert.equal(inF1.length, 2)
    assert.deepEqual(inF1.map(a => a.id), ['a1', 'a2'])

    // Unassigned
    const unassigned = filterAssetsByFolder(assets, '__unassigned__')
    assert.equal(unassigned.length, 1)
    assert.equal(unassigned[0].id, 'a4')
  })

  it('calculates folder counts correctly', () => {
    const folders = [
      { id: 'f1', name: 'Video' },
      { id: 'f2', name: 'Audio' },
      { id: 'f3', name: 'Empty' }
    ]
    const assets = [
      { id: 'a1', folderId: 'f1' },
      { id: 'a2', folderId: 'f1' },
      { id: 'a3', folderId: 'f2' },
      { id: 'a4', folderId: null },
      { id: 'a5' }
    ]

    const counts = getFolderCounts(folders, assets)
    assert.equal(counts.total, 5)
    assert.equal(counts.unassigned, 2)
    assert.equal(counts.f1, 2)
    assert.equal(counts.f2, 1)
    assert.equal(counts.f3, 0)
  })
})
