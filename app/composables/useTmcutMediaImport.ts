import { useTmcutMedia } from '~/composables/useTmcutMedia'
import { useFileSystem } from '~/composables/useFileSystem'

export interface TmcutMediaFilterGroup {
  name: string
  extensions: string[]
}

/** Picker filters for the media library — one source for the header import,
 *  the drop target and the relink dialog. */
export const TMCUT_MEDIA_FILTERS: TmcutMediaFilterGroup[] = [
  { name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mpg', 'mpeg', 'ts', 'wmv', 'flv'] },
  { name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'wma', 'opus'] },
  { name: 'Image', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'gif'] }
]

export function useTmcutMediaImport() {
  const { t } = useI18n()
  const toast = useToast()
  const { isDesktop, importFiles, importWebFiles, importError } = useTmcutMedia()
  const { pickFile, pickWebFiles } = useFileSystem()

  async function handleImportMedia() {
    if (!isDesktop.value) {
      try {
        const files = await pickWebFiles(TMCUT_MEDIA_FILTERS.flatMap(group => group.extensions), true)
        if (files.length === 0) return
        const added = await importWebFiles(files)
        if (added.length > 0) {
          toast.add({ title: `${t('global.success')}: ${added.length}`, color: 'success' })
        }
        // A rejected upload (server down, size cap, unsupported type) is
        // surfaced even when sibling files succeeded.
        if (importError.value) {
          toast.add({ title: t('tmcut.media.uploadFailed'), color: 'error' })
        }
      } catch (error) {
        console.error('Media import failed:', error)
        toast.add({ title: t('tmcut.media.importFailed'), color: 'error' })
      }
      return
    }
    try {
      const picked = await pickFile({
        title: t('tmcut.media.import'),
        filters: TMCUT_MEDIA_FILTERS,
        multiSelections: true
      })
      const paths = Array.isArray(picked) ? picked : picked ? [picked] : []
      if (paths.length === 0) return
      const result = await importFiles(paths)
      if (result.duplicates > 0) {
        toast.add({ title: t('tmcut.media.alreadyInLibrary'), color: 'info' })
      }
      if (result.failed > 0) {
        toast.add({ title: t('tmcut.media.analysisFailed'), color: 'error' })
      }
    } catch (error) {
      console.error('Media import failed:', error)
      toast.add({ title: t('tmcut.media.importFailed'), color: 'error' })
    }
  }

  return { mediaFilters: TMCUT_MEDIA_FILTERS, handleImportMedia }
}
