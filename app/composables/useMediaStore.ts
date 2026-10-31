const linkHistory = useLocalStorage<string[]>('media-link-history', [])

export const useMediaStore = () => {
  const addHistory = (link: string | string[]) => {
    const links = Array.isArray(link) ? link : [link]
    const newHistory = Array.from(new Set([...links, ...linkHistory.value]))
    linkHistory.value = newHistory.slice(0, 50)
  }

  const removeHistory = (link: string) => {
    linkHistory.value = linkHistory.value.filter(l => l !== link)
  }

  const clearHistory = () => {
    linkHistory.value = []
  }

  return {
    linkHistory,
    addHistory,
    removeHistory,
    clearHistory
  }
}
