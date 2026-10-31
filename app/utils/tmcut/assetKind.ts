import type { TmcutAsset } from '~/types/tmcut'

/**
 * Single source of truth for "what kind of media is this, really?".
 *
 * Some containers are audio-only even though the extension/registry says
 * video (`.webm` recorded without a video stream is the common case). The
 * probe records that fact in `meta.hasVideo`, and every consumer — bin
 * icon, track routing, proxy button — must agree, otherwise an asset is
 * shown as a clip and lands on a track it cannot play on.
 *
 * Only a POSITIVE probe finding (`hasVideo === false`) flips the kind: an
 * asset that has not been probed yet keeps its declared kind, so a normal
 * video is never demoted to audio just because its metadata is missing.
 */
export function effectiveAssetKind(asset: Pick<TmcutAsset, 'kind' | 'meta'>): TmcutAsset['kind'] {
  if (asset.kind === 'video' && asset.meta?.hasVideo === false) return 'audio'
  return asset.kind
}
