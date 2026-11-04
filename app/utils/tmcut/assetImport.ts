/**
 * Asset import states (zero-FFmpeg slice C).
 *
 * Two axes, kept apart on purpose: `status` answers "are these bytes here" and
 * `importStatus` answers "what did the last probe learn". A file that comes
 * back from a moved folder is a byte fact (`checkMissing` restores it); it is
 * not a re-read, so merging the two would either hide a probe that never
 * succeeded or re-probe every asset that only went missing.
 *
 * The six names are core's (`TmcutImportStatus`): `classifyImportStatus` already
 * hands out ready / partial / unsupported / error, so only the two in-flight
 * states are produced here, plus the one table mapping a verdict onto `status`.
 */
import { cacheKeyForPath } from 'tmcut-core'
import type { TmcutAssetKind, TmcutImportStatus } from 'tmcut-core'
import type { TmcutAsset, TmcutAssetStatus } from '~/types/tmcut'
import { createEmptyTmcutAssetMeta } from '~/types/tmcut'
import { mediaFileName, normalizeMediaPath } from '~/utils/tmcut/media'

/** Every verdict the pipeline can hold, in the order it walks them. */
export const TMCUT_IMPORT_STATES: readonly TmcutImportStatus[] = [
  'queued',
  'probing',
  'ready',
  'partial',
  'unsupported',
  'error'
]

/**
 * `partial` is a usable clip with a disclosed warning (estimated duration,
 * variable frame rate), so it stays on the same side of the line as `ready`;
 * `unsupported` means this runtime cannot take the bytes apart, which is the
 * same thing the coarse field already calls `error`.
 */
export function assetStatusForImport(importStatus: TmcutImportStatus): TmcutAssetStatus {
  if (importStatus === 'queued' || importStatus === 'probing') return 'analyzing'
  if (importStatus === 'ready' || importStatus === 'partial') return 'ready'
  return 'error'
}

/**
 * The core cache key for one revision of one file. Derived artifacts (cover,
 * filmstrip, waveform, proxy and the local byte copies that follow) are named
 * after it, so the same bytes always find the same artifacts and an edited file
 * misses them.
 */
export function assetFingerprint(path: string, meta: { mtimeMs: number, fileSize: number }): string {
  return cacheKeyForPath(path, { mtimeMs: meta.mtimeMs, size: meta.fileSize })
}

export interface TmcutAssetDraft {
  path: string
  kind: TmcutAssetKind
  projectId?: string | null
  folderId?: string | null
  /** One clock for the id and `addedAt`; a caller that wants it injected passes it. */
  now?: number
  nonce?: string
}

/**
 * The record a fresh import starts with — every field a JSON round-trip
 * preserves, so nothing picked from a file dialog (a `File`, a `Blob`, an
 * object URL) can reach the persisted library through here.
 */
export function buildAssetRecord(draft: TmcutAssetDraft): TmcutAsset {
  const path = normalizeMediaPath(draft.path)
  const now = draft.now ?? Date.now()
  const asset: TmcutAsset = {
    id: `asset_${now}_${draft.nonce ?? Math.random().toString(36).slice(2, 8)}`,
    kind: draft.kind,
    name: mediaFileName(path),
    path,
    usedBy: draft.projectId ? [draft.projectId] : [],
    status: 'analyzing',
    importStatus: 'queued',
    fingerprint: null,
    meta: createEmptyTmcutAssetMeta(),
    thumbPath: null,
    filmstripPath: null,
    waveformPath: null,
    proxyPath: null,
    proxyStatus: 'none',
    folderId: draft.folderId ?? null,
    addedAt: new Date(now).toISOString()
  }
  if (draft.folderId && draft.projectId) {
    asset.folderByProject = { [draft.projectId]: draft.folderId }
  }
  return asset
}
