export type EditorType = 'tiptap' | 'tinymce'

const STORAGE_KEY = 'editor:type'

export const useEditorType = () => {
  const editorType = useState<EditorType>('editor:type', () => {
    if (import.meta.client) {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'tiptap' || stored === 'tinymce') return stored
    }
    return 'tiptap'
  })

  function setEditorType(type: EditorType) {
    editorType.value = type
    if (import.meta.client) {
      localStorage.setItem(STORAGE_KEY, type)
    }
  }

  return {
    editorType: readonly(editorType),
    setEditorType
  }
}
