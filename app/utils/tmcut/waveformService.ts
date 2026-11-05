// The waveform both hosts produce and re-read (zero-FFmpeg slice G2, ADR-033).
//
// One question — "what do the bars of this revision look like" — has one answer
// path here: the client byte cache is asked for the artifact slice G1 named, the
// PCM seam (`audioDecode.ts`) is called once if it had nothing, core reduces the
// samples and stamps the record, and the record is written back for the next
// page. `frameStore.ts` does the same for pixels and `autocutDetect.ts` for
// silence; this is the third reader, which is the evidence ADR-033 waits for.
//
// What the file refuses to do:
//  - decode twice for one revision. A media panel and a timeline clip ask in the
//    same tick, so the job is claimed before anything is awaited;
//  - store a waveform that is not one. A decoder that answers nothing leaves the
//    cache empty, so the next ask tries again — the FFmpeg controller stored
//    `ok:true` with zero bars instead, and the panel drew silence for a file it
//    had never opened;
//  - draw bars it cannot identify. A record from an algorithm this app does not
//    know is re-made, not trusted;
//  - take a shortcut when the caller has no revision. Without a fingerprint there
//    is nothing to cache the answer under, so there is no answer.

import { buildWaveformPayload, floatPeakBuckets, readWaveformPayload, waveformCacheKey } from 'tmcut-core'
import type { TmcutPcmAsk } from './audioDecode'
import { putCachedBytes, readCachedBytes } from './byteStore'

type PcmAnswer = { sampleRate: number, channels: Float32Array[] } | null
type PcmDecode = (ask: TmcutPcmAsk) => Promise<PcmAnswer>

/** The bars of one revision, plus what the caller can read them against. */
export interface TmcutWaveformAsk {
  /** The C1 revision fingerprint; anything else is a refusal, not a seek. */
  fingerprint: string | null | undefined
  /** Where to read when the client cache holds no copy of the media. */
  src?: string | null
  /** Length the probe learned; a file of unknown length has no waveform. */
  durationSec?: number | null
}

export interface TmcutWaveformService {
  /** Bars in 0..1, or null when there is nothing to draw. */
  load(ask: TmcutWaveformAsk): Promise<number[] | null>
  /** Revisions being read or decoded right now. */
  inFlight(): number
}

/**
 * The service. `decode` is a parameter rather than an import inside the law:
 * PCM needs WebCodecs, which plain Node does not have, so every rule around it
 * — what is cached, what is coalesced, what is refused — is testable without a
 * decoder, and only the last lines of this file need a browser.
 *
 * `liveKeys` is not optional, and it is the media library's own answer. A write
 * runs the eviction law, which frees everything the library no longer names: a
 * service that passed a narrower set would delete the cache it was adding to.
 */
export function createWaveformService(
  decode: PcmDecode,
  liveKeys: () => Set<string>
): TmcutWaveformService {
  const jobs = new Map<string, Promise<number[] | null>>()

  async function run(key: string, fingerprint: string, src: string | null, durationSec: number): Promise<number[] | null> {
    const cached = await readCachedBytes(key)
    if (cached) {
      try {
        const record = readWaveformPayload(JSON.parse(await cached.text()))
        if (record) return record.peaks
      } catch {
        // Unreadable bytes are not a waveform: fall through and make one.
      }
    }

    const media = await readCachedBytes(fingerprint)
    if (!media && !src) return null
    const pcm = await decode({
      bytes: media ?? null,
      src: media ? null : String(src),
      inSec: 0,
      outSec: durationSec,
      signal: new AbortController().signal
    })
    if (!pcm || pcm.channels.length === 0) return null

    const payload = buildWaveformPayload({
      peaks: floatPeakBuckets(pcm.channels),
      durationSec,
      sampleRate: pcm.sampleRate,
      channelCount: pcm.channels.length
    })
    if (payload === null) return null

    const live = new Set(liveKeys())
    // Somebody is asking for this revision right now, which is why it is being
    // written; the library's own prune pass decides afterwards.
    live.add(fingerprint)
    await putCachedBytes(key, new Blob([JSON.stringify(payload)], { type: 'application/json' }), live)
    return payload.peaks
  }

  function load(ask: TmcutWaveformAsk): Promise<number[] | null> {
    const key = waveformCacheKey(ask.fingerprint)
    const durationSec = Number(ask.durationSec)
    if (key === null) return Promise.resolve(null)
    if (!Number.isFinite(durationSec) || durationSec <= 0) return Promise.resolve(null)

    const running = jobs.get(key)
    if (running) return running
    const job = run(key, String(ask.fingerprint), ask.src ? String(ask.src) : null, durationSec)
      .finally(() => {
        if (jobs.get(key) === job) jobs.delete(key)
      })
    jobs.set(key, job)
    return job
  }

  return { load, inFlight: () => jobs.size }
}
