import { ref, watch } from 'vue'
import { readStoredFlag, writeStored } from '~/utils/tmcut/localStore'

// Session-level TMCut UI preferences, persisted in localStorage so the
// choice survives reloads (single editor instance — module-level state
// mirrors the pattern used by useTmcutPlayback).
const STORAGE_KEY = 'tmcut.shortcutTips'
const SNAP_STORAGE_KEY = 'tmcut.magnet'
const shortcutTips = ref(true)
// Shared shortcuts-help modal state: opened from the timeline toolbar,
// the editor header button, or Ctrl+K / ? — one instance everywhere.
const shortcutsOpen = ref(false)
// Magnetic snap toggle (Magnet toolbar button / N key) — default on so
// behavior matches the always-snap editor shipped before the toggle.
const snapOn = ref(true)

if (import.meta.client && typeof window !== 'undefined') {
  shortcutTips.value = readStoredFlag(STORAGE_KEY, true)
  snapOn.value = readStoredFlag(SNAP_STORAGE_KEY, true)

  watch(shortcutTips, (value) => {
    writeStored(STORAGE_KEY, value ? '1' : '0')
  })
  watch(snapOn, (value) => {
    writeStored(SNAP_STORAGE_KEY, value ? '1' : '0')
  })
}

export function useTmcutUiPrefs() {
  // Appends "(Keys)" to a toolbar tooltip when shortcut tips are enabled.
  function tip(label: string, keys: string): string {
    return shortcutTips.value ? `${label} (${keys})` : label
  }

  return { shortcutTips, shortcutsOpen, snapOn, tip }
}
