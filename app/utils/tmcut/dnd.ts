// Shared drag-and-drop protocol between the media grid (editor.vue) and
// the timeline drop target (TmcutTimeline.vue). HTML5 DnD only carries
// plain strings, so the payload travels as JSON under one custom MIME
// type — single source of truth so both sides cannot drift apart.

/** Custom MIME type carrying a TmcutAssetDragPayload as JSON. */
export const TMCUT_ASSET_MIME = 'application/x-tmcut-asset'

export interface TmcutAssetDragPayload {
  /** TmcutAsset.id — resolved by useTmcutMedia.addAssetToTimeline on drop. */
  id: string
  /** Asset kind decides the target track type (audio → audio track). */
  kind: 'video' | 'audio' | 'image'
}
