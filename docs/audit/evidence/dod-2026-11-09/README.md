# Evidence — DoD 24, DoD 25 and Windows packaging (2026-11-09)

Raw reports behind §59 of [zero-ffmpeg-audit.md](../../zero-ffmpeg-audit.md). Every file here was
produced by a run on this machine; none is hand-written.

## DoD 25 — browser capability matrix (§59.6)

One page, 32 probes per runtime. All four files share the same row names, so a difference between
them is a real difference in the runtime.

| File | Runtime |
|---|---|
| `chrome-156-win10.json` | Chrome 156.0.0.0 on Windows 10 — 32/32 Supported |
| `edge-157-win10.json` | Edge 157.0.0.0 (`157.0.4341.42`) — 32/32 Supported |
| `electron-44-win10.json` | The app's own Electron 44.10.0 (Chromium 152.0.7977.169) — 32/32 Supported |
| `firefox-159-win10.json` | Firefox 159.0.1 — 30/32; no AAC audio encode, no WebGPU adapter |

`chrome-headless-note.json` records a separate finding: the DoD 24 page never passes its first
encode stage under headless Chrome, so headless is not a valid harness for the heavy measurements.

### AAC, split into demux / decode / encode (measured 2026-11-11)

The matrix above reports audio AAC as one line per runtime, which hides that demuxing a file,
decoding its samples and encoding new ones are three different capabilities with three different
answers. They are measured separately here by
[`tests/e2e/browser_media_integration.mts`](../../../../tests/e2e/browser_media_integration.mts)
against the committed fixture
[`tests/fixtures/audio/aac-tone-then-silence.m4a`](../../../../tests/fixtures/audio/aac-tone-then-silence.m4a)
(provenance, checksum and generation command: [its README](../../../../tests/fixtures/audio/README.md)).

| Capability | How it is asked | Edge `157.0.4341.46`, Windows 10 | Notes |
|---|---|---|---|
| **AAC demux** | Mediabunny reads the container and reports track codec/rate/channels/duration | **Supported** | One audio track, zero video, `aac`, 48 000 Hz, mono, 1.000 s, `importStatus: ready` |
| **AAC decode** | `AudioDecoder.isConfigSupported` with **the container's own** decoder config (`mp4a.40.2`), then a real decode | **Supported** | 48 128 samples for a 1.0 s ask; tone half peaks 0.513 (authored 0.5), silence half 0.0012 |
| **AAC encode** | `AudioEncoder.isConfigSupported` for both spellings, stereo 48 kHz, 128 kbps | **Supported for `mp4a.40.2`; `aac` rejected** | The two spellings are not synonyms on this runtime, which is why the export ladder asks both |

Two things this table deliberately does not say:

- **It is not the same build, and the older row does not name its config.** The DoD 25 runs above
  were taken on `157.0.4341.42`; this one on `157.0.4341.46`. The `.42` row records `encode audio
  mp4a.40.2: supported=true` without saying how many channels or what rate it asked about, so it
  cannot be compared with the row below — and the encode answer is configuration-scoped (see the
  last paragraph). Recording the build string is the only way to keep a change between builds from
  reading as a regression in the source.
- **Encode support is not an export claim.** The exporter asks before it encodes and refuses
  honestly when the answer is no. Nothing in the app was changed to match this measurement; the
  measurement is what the app would be told if it asked today.

An encode answer is configuration-scoped, not codec-scoped: on `.46`, `mp4a.40.2` is supported at
stereo 44.1/48 kHz and refused at mono 48 kHz, mono 32 kHz and 6-channel 48 kHz. A one-line
"supports AAC encode: yes" would therefore be wrong in both directions.

## DoD 24 — large-file and memory (§59.5)

Generated inside the app's Electron runtime with the shipping encoder path (WebCodecs →
mediabunny `VideoSampleSource` / `Mp4OutputFormat`), then probed, decoded through `CanvasSink`,
cancelled mid-encode, and re-measured.

| File | Workload | Peak process RSS |
|---|---|---|
| `electron-44-dod24.json` | 1280×720, 30 s, 12 fills | 389 MB |
| `electron-44-1080p-dod24.json` | 1920×1080, 60 s, 24 fills | 451 MB |
| `electron-44-full-dod24.json` | 1920×1080, 45 s, 20 fills, plus audio / WebGL churn / OPFS | 523 MB |
| `electron-44-1gib-dod24.json` | **1920×1080, 286.8 s, 1 076 338 175-byte output** written to OPFS through `StreamTarget`; then probed and decoded from mid-file | **602 MB** |

`electron-44-1gib-dod24.json` is the `summary.json` the Electron runner wrote: the page's own report under
`page`, plus an `rss` trace sampled once a second from `app.getAppMetrics()`. The 1 GiB file is deleted at the
end of the run; `page.storage.usageAfterCleanupMB` = 0 confirms it. Rebuilding it needs a profile on the
command line (`--user-data-dir`) — a locked default profile makes `navigator.storage.getDirectory()` throw
`InvalidStateError`, which is an environment fact, not a product defect.

## Packaging (§59.2)

| File | Meaning |
|---|---|
| `packaging-failed-before-integrity-fix.log` | `electron-builder` on the Low-integrity output dir: NSIS stub exit 2, no uninstaller |
| `packaging-26.18.0-success.log` | Same command after `icacls release /setintegritylevel "(OI)(CI)M"`: `PKG_EXIT=0`, 219 173 763-byte installer + blockmap |

## Backup (decision 1, §59.1)

`backup-before.md5` and `backup-after.md5` are byte-identical: 76 files, unchanged, before and after
untracking `backup/ffmpeg-engine-2026-11-03/`.
