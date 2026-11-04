import { useTmcutMedia } from '~/composables/useTmcutMedia'
import { useFileSystem } from '~/composables/useFileSystem'
import { TMCUT_MEDIA_FILTERS } from '~/composables/useTmcutMediaImport'
import type { TmcutAsset } from '~/types/tmcut'

/**
 * The one relink flow (zero-FFmpeg slice C2, Q6).
 *
 * A dead path is repaired by pointing the asset at new bytes, and only the
 * picker can supply them — so this is the single place that asks. It lives here
 * rather than in the media panel because the offline surface exists on three
 * screens (library card, timeline clip, preview) and each would otherwise
 * re-implement pick → store → relink → cover, which is the same drift slice C1
 * removed from `analyzeAsset`.
 *
 * Two rules the callers depend on: nothing opens unless the user asked, since
 * this is only ever reached from a button, and a cancelled pick changes nothing
 * and says nothing — the asset, its project links and its clips keep their
 * reference either way.
 */
export function useTmcutRelink() {
  const { t } = useI18n()
  const toast = useToast()
  const { isDesktop, relink, uploadWebFile, uploadVideoThumb, captureVideoThumb, persistLibrary, importError } = useTmcutMedia()
  const { pickFile, pickWebFiles } = useFileSystem()

  function filterFor(asset: TmcutAsset) {
    if (asset.kind === 'video') return TMCUT_MEDIA_FILTERS[0]!
    if (asset.kind === 'audio') return TMCUT_MEDIA_FILTERS[1]!
    return TMCUT_MEDIA_FILTERS[2]!
  }

  async function relinkWebAsset(asset: TmcutAsset): Promise<boolean | null> {
    const files = await pickWebFiles(filterFor(asset).extensions, false)
    const file = files[0]
    // Null is "the user closed the dialog"; false is "a file was chosen and the
    // editor still could not use it". Only the second one deserves a warning.
    if (!file) return null
    // R152: the replacement is stored like a fresh import, so relink() re-learns
    // the file from its stored bytes. The blob: URL below only drives the cover
    // frame and is revoked as soon as that frame is taken.
    const blobUrl = URL.createObjectURL(file)
    try {
      const uploaded = await uploadWebFile(file, file.name)
      const ok = await relink(asset.id, uploaded.url, { name: file.name, size: uploaded.size })
      if (ok && asset.kind === 'video') {
        const thumb = await captureVideoThumb(blobUrl)
        if (thumb) {
          asset.thumbPath = await uploadVideoThumb(file, thumb)
          // relink() persisted its own snapshot before the cover landed.
          persistLibrary()
        }
      }
      return ok
    } catch (error) {
      console.error('Web relink upload failed:', error)
      importError.value = error instanceof Error ? error.message : 'upload failed'
      return false
    } finally {
      URL.revokeObjectURL(blobUrl)
    }
  }

  async function relinkDesktopAsset(asset: TmcutAsset): Promise<boolean | null> {
    const picked = await pickFile({ title: t('tmcut.media.relink'), filters: [filterFor(asset)] })
    const filePath = Array.isArray(picked) ? picked[0] : picked
    if (!filePath) return null
    return relink(asset.id, filePath)
  }

  /**
   * Point one asset at new bytes chosen by the user. Resolves true when the
   * re-learn succeeded, false when a file was picked and refused, and stays
   * silent when the pick was cancelled.
   */
  async function relinkWithPicker(asset: TmcutAsset): Promise<boolean> {
    const result = isDesktop.value
      ? await relinkDesktopAsset(asset)
      : await relinkWebAsset(asset)
    if (result === null) return false
    toast.add({
      title: t(result ? 'tmcut.media.relinked' : 'tmcut.media.relinkFailed'),
      color: result ? 'success' : 'warning'
    })
    return result
  }

  return { relinkWithPicker }
}
