// TMCut caption / subtitle types — the contract between Whisper
// transcripts, SRT files and caption text clips (Roadmap C11).

/** One subtitle cue. Times are SECONDS (Whisper/SRT native). */
export interface TranscriptCue {
  text: string
  start: number
  end: number
}
