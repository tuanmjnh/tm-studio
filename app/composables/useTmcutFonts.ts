/**
 * System font enumeration (roadmap C-1, extended in C-2): one IPC call
 * pulls every font face (family + file path) from the main process, which
 * loads the bundled font-scanner addon. The renderer keeps ONE choice per
 * family with the best file per style quadrant (regular/bold/italic/
 * bold-italic) — the preview applies the CSS family + style flags while
 * export maps the paired file to drawtext fontfile=, so both ends render
 * the same face. drawtext has NO faux bold (it rasterizes one file), so
 * bold/italic exports MUST point at the real face.
 *
 * Web sessions have no IPC: `choices` stays empty and the picker hides
 * instead of offering fonts it could neither enumerate nor export.
 */

import type { TmcutFontEntry } from '#shared/types/electron'

function tmcutIpc() {
  return typeof window !== 'undefined' ? window.electronAPI?.tmcut : undefined
}

export interface TmcutFontChoice {
  family: string
  /** Preferred regular upright face — pairs with the family. */
  file: string
  /** Matching faces per style quadrant (roadmap C-2). */
  boldFile?: string
  italicFile?: string
  boldItalicFile?: string
}

// Session-level single flight: every Inspector mount reuses one IPC call.
let facesPromise: Promise<TmcutFontEntry[]> | null = null

/** Best face for ONE style quadrant: closest weight to the target wins,
    upright Regular style breaks ties (same spirit as the C-1 pick). */
function pickFace(faces: TmcutFontEntry[], italic: boolean, bold: boolean): string | undefined {
  const target = bold ? 700 : 400
  let best: TmcutFontEntry | null = null
  let bestRank = Number.POSITIVE_INFINITY
  for (const f of faces) {
    if (!!f.italic !== italic || !f.path) continue
    if ((f.weight >= 700) !== bold) continue
    const rank = Math.abs(f.weight - target) * 2 + (f.style !== 'Regular' ? 1 : 0)
    if (rank < bestRank) {
      best = f
      bestRank = rank
    }
  }
  return best?.path
}

function pickFamilies(faces: TmcutFontEntry[]): TmcutFontChoice[] {
  const byFamily = new Map<string, TmcutFontEntry[]>()
  for (const f of faces) {
    if (!f.family) continue
    const bucket = byFamily.get(f.family)
    if (bucket) bucket.push(f)
    else byFamily.set(f.family, [f])
  }
  const choices: TmcutFontChoice[] = []
  for (const [family, bucket] of byFamily) {
    const file = pickFace(bucket, false, false)
    // A family without a usable regular face is no choice at all.
    if (!file) continue
    choices.push({
      family,
      file,
      boldFile: pickFace(bucket, false, true),
      italicFile: pickFace(bucket, true, false),
      boldItalicFile: pickFace(bucket, true, true)
    })
  }
  return choices.sort((a, b) => a.family.localeCompare(b.family))
}

/** File drawtext must use for the given style flags. Falls back along
    boldItalic→bold→italic→regular so a family missing one face still
    exports its closest REAL glyphs (known limitation, §121: preview may
    show the browser's synthesized face for those rare families). */
export function faceFileFor(choice: TmcutFontChoice, bold?: boolean, italic?: boolean): string {
  if (bold && italic) return choice.boldItalicFile || choice.boldFile || choice.italicFile || choice.file
  if (bold) return choice.boldFile || choice.file
  if (italic) return choice.italicFile || choice.file
  return choice.file
}

export function useTmcutFonts() {
  const available = computed(() => !!tmcutIpc())
  const choices = ref<TmcutFontChoice[]>([])
  const loaded = ref(false)

  /** Idempotent: concurrent mounts share one promise; failures cache as []. */
  async function ensureFonts(): Promise<void> {
    const ipc = tmcutIpc()
    if (!ipc || loaded.value) return
    facesPromise ??= ipc.listFonts().catch(() => [] as TmcutFontEntry[])
    try {
      const faces = await facesPromise
      choices.value = pickFamilies(faces)
    } catch {
      choices.value = []
    } finally {
      loaded.value = true
    }
  }

  /**
   * Resolve { family, file } for style flags (roadmap C-2): the family
   * already on the clip wins; otherwise a well-known desktop default.
   * Web (no IPC / no faces) returns null — callers keep preview-only flags.
   */
  async function resolveFace(
    bold?: boolean,
    italic?: boolean,
    currentFamily?: string | null
  ): Promise<{ family: string, file: string } | null> {
    await ensureFonts()
    const list = choices.value
    if (list.length === 0) return null
    const current = currentFamily ? list.find(c => c.family === currentFamily) : undefined
    if (current) return { family: current.family, file: faceFileFor(current, bold, italic) }
    const preferred = list.find(c => c.family === 'Segoe UI')
      || list.find(c => !!(bold ? (italic ? c.boldItalicFile : c.boldFile) : italic ? c.italicFile : true))
    if (!preferred) return null
    return { family: preferred.family, file: faceFileFor(preferred, bold, italic) }
  }

  return { available, choices, loaded, ensureFonts, resolveFace }
}
