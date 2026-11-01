import { ref } from 'vue'
import { useTmcutProject } from '~/composables/useTmcutProject'

// Module scope on purpose: the editor page opens these dialogs from the
// toolbar, the canvas menu, the timeline and keyboard shortcuts, while
// TmcutEditorOverlays renders them. One set of refs keeps both sides in sync
// without prop drilling (same pattern as useTmcutEditorLayout and
// useTmcutExportQueue).
const showExportModal = ref(false)
const voiceStudioOpen = ref(false)
const showSnapshotModal = ref(false)
const showCustomCanvasModal = ref(false)
const aiScriptModalOpen = ref(false)
const aiEditorModalOpen = ref(false)
const agentPanelOpen = ref(false)
const audioOrchestrationOpen = ref(false)
const customCanvas = ref({ width: 1080, height: 1080, fps: 30 })

const dialogs = [
  showExportModal,
  voiceStudioOpen,
  showSnapshotModal,
  showCustomCanvasModal,
  aiScriptModalOpen,
  aiEditorModalOpen,
  agentPanelOpen,
  audioOrchestrationOpen
]

function closeAllDialogs() {
  for (const open of dialogs) open.value = false
}

export function useTmcutEditorDialogs() {
  const { t } = useI18n()
  const toast = useToast()
  const { createSnapshot } = useTmcutProject()

  // The overflow menu creates a snapshot without opening the history dialog,
  // so the save path is shared instead of living in the overlays component.
  function saveSnapshot() {
    void createSnapshot()
    toast.add({ title: t('tmcut.snapshot.saved'), color: 'success' })
  }

  return {
    showExportModal,
    voiceStudioOpen,
    showSnapshotModal,
    showCustomCanvasModal,
    aiScriptModalOpen,
    aiEditorModalOpen,
    agentPanelOpen,
    audioOrchestrationOpen,
    customCanvas,
    closeAllDialogs,
    saveSnapshot
  }
}
