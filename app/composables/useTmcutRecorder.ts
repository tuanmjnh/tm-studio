/**
 * Voiceover recording (roadmap D-4): getUserMedia + MediaRecorder in the
 * renderer — works on web AND desktop (mic permission either way).
 * Desktop writes the blob to disk via IPC (`tmcut:saveRecording`, FFmpeg
 * export needs real paths) and reuses the normal import pipeline
 * (analysis, waveform, registry); web wraps the blob in a File and lands
 * in the durable web library (the File goes through importWebFiles, which
 * streams it to the local server — same rule as a picked file).
 *
 * Takes shorter than MIN_RECORDING_SEC are discarded BEFORE anything is
 * written — no junk files, no junk assets.
 */

import { ref, onUnmounted } from 'vue'

const MIN_RECORDING_SEC = 0.5

/** Chromium supports webm/opus everywhere; mp4/aac is the fallback. */
function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || ''
}

export interface VoiceoverResult {
  seconds: number
  added: number
  failed: number
  discarded: boolean
  /** Absolute path of the saved take (desktop only — web has no disk). */
  path?: string
}

export interface StopRecordingOptions {
  /**
   * Voiceover capture imports the take into the media library (default).
   * Command capture passes false: the file exists only to be transcribed.
   */
  importToLibrary?: boolean
  /** File-name prefix in <base>/recordings/ (default `voiceover`). */
  prefix?: string
}

export function useTmcutRecorder() {
  const { importFiles, importWebFiles } = useTmcutMedia()

  const recording = ref(false)
  const saving = ref(false)
  const elapsedSec = ref(0)

  let mediaRecorder: MediaRecorder | null = null
  let mediaStream: MediaStream | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let startedAt = 0
  let chunks: BlobPart[] = []

  function releaseMic() {
    // Stop every track so the OS mic indicator turns off immediately.
    mediaStream?.getTracks().forEach(track => track.stop())
    mediaStream = null
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  /** Ask for the mic and start rolling. False = permission denied/busy. */
  async function start(): Promise<boolean> {
    if (recording.value || saving.value) return false
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      console.error('Voiceover: microphone access failed:', error)
      return false
    }
    const mimeType = pickMimeType()
    const recorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined)
    chunks = []
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    // Small slices: a crash or tab close keeps at most 250ms lost.
    recorder.start(250)
    mediaRecorder = recorder
    startedAt = Date.now()
    elapsedSec.value = 0
    timer = setInterval(() => {
      elapsedSec.value = (Date.now() - startedAt) / 1000
    }, 250)
    recording.value = true
    return true
  }

  /** Stop the take; import it to the library unless told otherwise. */
  async function stop(options: StopRecordingOptions = {}): Promise<VoiceoverResult> {
    const importToLibrary = options.importToLibrary !== false
    const recorder = mediaRecorder
    if (!recorder || !recording.value) return { seconds: 0, added: 0, failed: 0, discarded: true }
    recording.value = false
    const seconds = (Date.now() - startedAt) / 1000
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
      try {
        recorder.stop()
      } catch {
        resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
      }
    })
    releaseMic()
    mediaRecorder = null
    if (seconds < MIN_RECORDING_SEC) return { seconds, added: 0, failed: 0, discarded: true }
    saving.value = true
    try {
      const ext = blob.type.includes('mp4') ? 'm4a' : 'webm'
      const ipc = typeof window !== 'undefined' ? window.electronAPI?.tmcut : undefined
      if (ipc) {
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const saved = await ipc.saveRecording({ data: bytes, ext, prefix: options.prefix })
        if (!saved.ok || !saved.path) throw new Error(saved.error || 'Recording save failed')
        if (!importToLibrary) {
          return { seconds, added: 0, failed: 0, discarded: false, path: saved.path }
        }
        const result = await importFiles([saved.path])
        return { seconds, added: result.added, failed: result.failed, discarded: false, path: saved.path }
      }
      if (!importToLibrary) {
        // No disk in the browser build: the speech gateway needs a real path,
        // so command capture simply reports that it was not persisted.
        return { seconds, added: 0, failed: 0, discarded: false }
      }
      const file = new File([blob], `voiceover-${Date.now()}.${ext}`, { type: blob.type })
      const created = await importWebFiles([file])
      return { seconds, added: created.length, failed: created.length > 0 ? 0 : 1, discarded: false }
    } catch (error) {
      console.error('Voiceover: import failed:', error)
      return { seconds, added: 0, failed: 1, discarded: false }
    } finally {
      saving.value = false
    }
  }

  onUnmounted(() => {
    // Leaving the editor mid-take must not leave the mic hot.
    if (mediaRecorder) {
      try {
        mediaRecorder.stop()
      } catch {
        // already stopped
      }
      mediaRecorder = null
    }
    releaseMic()
  })

  return { recording, saving, elapsedSec, start, stop }
}
