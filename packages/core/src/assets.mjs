// =============================================================================
//  @tmcut/core — assets
//  Asset registry over plain objects (docs Phase 3, sections 16/48).
//  The registry is runtime-agnostic data; persistence (assets.json,
//  IndexedDB) and probing stay in the runtime adapters.
// =============================================================================

import { assetIdForPath } from './project.mjs'
import { classifyAssetKind, mediaFileKey, mediaFileName } from './media.mjs'

function assertRegistry(registry) {
  if (!Array.isArray(registry)) throw new Error('registry must be an array')
}

/**
 * Register a media source. Returns the record.
 * Id is derived deterministically from the locator path when omitted.
 */
export function registerAsset(registry, input = {}) {
  assertRegistry(registry)
  const locator = input.locator ?? { runtime: 'electron', path: input.path ?? '' }
  const path = locator.path ?? ''
  const kind = input.kind ?? classifyAssetKind(path) ?? 'video'
  const record = {
    id: input.id ?? assetIdForPath(path || input.name || 'unnamed'),
    kind,
    name: input.name ?? mediaFileName(path) ?? 'Untitled',
    status: input.status ?? 'analyzing',
    sourceType: input.sourceType ?? 'local',
    locator,
    durationSec: input.durationSec ?? 0,
    width: input.width ?? 0,
    height: input.height ?? 0,
    fps: input.fps ?? 0,
    fileSize: input.fileSize ?? 0,
    hash: input.hash ?? null
  }
  registry.unshift(record)
  return record
}

/** Find a record by id, or null. */
export function getAsset(registry, id) {
  assertRegistry(registry)
  return registry.find(record => record.id === id) ?? null
}

/** Find a record by media path (normalized, case-insensitive), or null. */
export function findAssetByPath(registry, path) {
  assertRegistry(registry)
  const key = mediaFileKey(path)
  if (!key) return null
  return registry.find(record => mediaFileKey(record.locator?.path ?? '') === key) ?? null
}

/** Merge probe metadata into a record. Returns false when missing. */
export function attachMetadata(registry, id, metadata = {}) {
  const record = getAsset(registry, id)
  if (!record) return false
  const fields = ['durationSec', 'width', 'height', 'fps', 'fileSize', 'hash']
  for (const field of fields) {
    if (metadata[field] !== undefined) record[field] = metadata[field]
  }
  if (record.status === 'analyzing') record.status = 'ready'
  return true
}

/**
 * Re-point a record at a new locator (media relink). Clears derived data
 * so the runtime re-probes; returns the record or null when missing.
 */
export function relinkAsset(registry, id, locator) {
  const record = getAsset(registry, id)
  if (!record || !locator) return null
  const path = locator.path ?? ''
  const kind = classifyAssetKind(path)
  record.locator = locator
  if (path) record.name = mediaFileName(path)
  if (kind && kind !== record.kind) record.kind = kind
  record.hash = null
  record.status = 'analyzing'
  record.durationSec = 0
  record.width = 0
  record.height = 0
  record.fps = 0
  return record
}

/** Remove a record by id. Returns true when removed. */
export function removeAsset(registry, id) {
  assertRegistry(registry)
  const index = registry.findIndex(record => record.id === id)
  if (index === -1) return false
  registry.splice(index, 1)
  return true
}

/** List records, optionally filtered by kind. Returns a copy. */
export function listAssets(registry, kind) {
  assertRegistry(registry)
  const list = kind ? registry.filter(record => record.kind === kind) : registry.slice()
  return list.slice()
}
