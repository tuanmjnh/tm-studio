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
