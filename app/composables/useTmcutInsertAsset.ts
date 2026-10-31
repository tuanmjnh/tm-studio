import { mediaFileKey } from '@tmcut-core'
import { useTmcutMedia } from '~/composables/useTmcutMedia'
import { useTmcutProject } from '~/composables/useTmcutProject'
import { clipEndSec } from '~/utils/tmcut/clipTime'

/**
 * Take a media path that already lives on the server (/uploads/**) or on disk
 * and make it usable by the editor: import it into the library and, when a
 * project is open, append it to the end of its own track.
 *
 * Generated media (voiceovers, HTML/CSS renders) arrives with no project on the
 * standalone studio pages — it must still land in the library instead of
 * failing, and the caller reports which of the two happened.
 */
export function useTmcutInsertAsset() {
  const { assets, loadLibrary, importFiles, addAssetToTimeline } = useTmcutMedia()
  const { currentProject } = useTmcutProject()

  async function insertAsset(path: string): Promise<{ placed: boolean, offsetSec: number, assetName: string }> {
    await loadLibrary()
    await importFiles([path])
    const key = mediaFileKey(path)
    const asset = assets.value.find(item => mediaFileKey(item.path) === key)
    if (!asset) throw new Error('import failed')

    const project = currentProject.value
    if (!project) return { placed: false, offsetSec: 0, assetName: asset.name }

    const trackType = asset.kind === 'audio' ? 'audio' : 'video'
    const tracks = project.timeline?.tracks || []
    const offsetSec = Math.max(0, ...tracks
      .filter(track => track.type === trackType)
      .flatMap(track => (track.items || []).map(clipEndSec)))
    const placed = addAssetToTimeline(asset.id, { offset: offsetSec })
    return { placed, offsetSec, assetName: asset.name }
  }

  return { insertAsset }
}
