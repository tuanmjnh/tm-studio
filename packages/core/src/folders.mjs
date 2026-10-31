// =============================================================================
//  @tmcut/core — folders (Roadmap G-3)
//  Pure folder / album operations for media asset management.
//  Zero-dependency, runtime-agnostic (docs Phase G).
// =============================================================================

let folderCounter = 0

function nextFolderId() {
  folderCounter += 1
  return `folder_${Date.now().toString(36)}_${folderCounter.toString(36)}`
}

function assertFolderList(folders) {
  if (!Array.isArray(folders)) {
    throw new Error('folders must be an array')
  }
}

/**
 * Standard palette colors for folder tags.
 */
export const FOLDER_TAG_COLORS = [
  '#3b82f6', // blue / primary
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // rose / red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#64748b' // slate / neutral
]

/**
 * Create a new folder record and append to folder list.
 * Returns the created folder.
 */
export function createFolder(folders, input = {}) {
  assertFolderList(folders)
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : 'New Folder'
  const folder = {
    id: input.id ?? nextFolderId(),
    name,
    color: input.color ?? FOLDER_TAG_COLORS[0],
    projectId: input.projectId ?? null,
    createdAt: input.createdAt ?? Date.now()
  }
  folders.push(folder)
  return folder
}

/**
 * Rename a folder. Returns true if renamed, false if not found.
 */
export function renameFolder(folders, folderId, newName) {
  assertFolderList(folders)
  if (!folderId || typeof newName !== 'string' || !newName.trim()) return false
  const folder = folders.find(f => f.id === folderId)
  if (!folder) return false
  folder.name = newName.trim()
  return true
}

/**
 * Update folder color. Returns true if updated, false if not found.
 */
export function updateFolderColor(folders, folderId, color) {
  assertFolderList(folders)
  if (!folderId || typeof color !== 'string') return false
  const folder = folders.find(f => f.id === folderId)
  if (!folder) return false
  folder.color = color
  return true
}

/**
 * Delete a folder by id.
 * Returns true if removed.
 */
export function removeFolder(folders, folderId) {
  assertFolderList(folders)
  const idx = folders.findIndex(f => f.id === folderId)
  if (idx === -1) return false
  folders.splice(idx, 1)
  return true
}

/**
 * Find folder by id, or null.
 */
export function getFolder(folders, folderId) {
  assertFolderList(folders)
  return folders.find(f => f.id === folderId) ?? null
}

/**
 * Assign an asset to a folder (or unassign when folderId is null).
 * Supports both direct `folderId` and scoped `folderByProject`.
 */
export function setAssetFolder(asset, folderId, projectId) {
  if (!asset || typeof asset !== 'object') return false
  const targetId = folderId ?? null
  if (projectId) {
    if (!asset.folderByProject || typeof asset.folderByProject !== 'object') {
      asset.folderByProject = {}
    }
    asset.folderByProject[projectId] = targetId
  } else {
    asset.folderId = targetId
  }
  return true
}

/**
 * Get folder id of an asset, optionally checking projectId scope first.
 */
export function getAssetFolder(asset, projectId) {
  if (!asset || typeof asset !== 'object') return null
  if (projectId && asset.folderByProject && Object.prototype.hasOwnProperty.call(asset.folderByProject, projectId)) {
    return asset.folderByProject[projectId]
  }
  return asset.folderId ?? null
}

/**
 * Filter assets by folder.
 * `folderId` can be:
 * - null or undefined: all assets (no folder filter)
 * - '__unassigned__': only assets with no folder assigned
 * - specific folder ID string: only assets belonging to that folder
 */
export function filterAssetsByFolder(assets, folderId, projectId) {
  if (!Array.isArray(assets)) return []
  if (!folderId) return assets.slice()
  if (folderId === '__unassigned__') {
    return assets.filter(a => !getAssetFolder(a, projectId))
  }
  return assets.filter(a => getAssetFolder(a, projectId) === folderId)
}

/**
 * Count number of assets in each folder, plus unassigned count and total.
 * Returns an object of folderId -> count.
 */
export function getFolderCounts(folders, assets, projectId) {
  assertFolderList(folders)
  const counts = {
    total: Array.isArray(assets) ? assets.length : 0,
    unassigned: 0
  }
  for (const f of folders) {
    counts[f.id] = 0
  }
  if (!Array.isArray(assets)) return counts

  for (const a of assets) {
    const fid = getAssetFolder(a, projectId)
    if (fid && Object.prototype.hasOwnProperty.call(counts, fid)) {
      counts[fid] += 1
    } else {
      counts.unassigned += 1
    }
  }
  return counts
}
