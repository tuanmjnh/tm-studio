# TMCut: preview buffering and export gating — Phase 0 audit (2026-11-11)

Two reports, one session:

- **A — preview buffering.** After importing a video (the library shows *Ready* with a thumbnail and
  duration), dragging it to the timeline and pressing Play leaves the monitor on `Buffering…`,
  stuttering and freezing instead of playing.
- **B — export gating.** A project whose only effect is the Filter preset **Cool** is refused by the
  exporter, yet *Start Export* stays enabled and the refusal only appears as a toast.

Both were reproduced before anything was changed. Nothing here is inferred from a screenshot.

---

## 1. Method and fixtures

| Piece | Value |
|---|---|
| Dev server | `http://localhost:4003` (`nuxt dev`) |
| Fixture | `node_modules/.cache/tmcut-gates/fixtures/playback-1080p30.mp4` — H.264 1920×1080, 30 fps, 24.13 s, 17 866 685 B |
| Served copy | `/uploads/probe-playback-1080p30.mp4` (web uploads route, Range-capable) |
| Browser | Chrome via chrome-devtools MCP, real editor at `/tmcut/editor` |
| Real app path | `useTmcutProject` + `useTmcutPlayback` + `useTmcutMedia` + `useTmcutPlaybackBytes`, driven inside the running Nuxt app (`nuxt.runWithContext`) |
| Slow-origin harness | Local stub on `127.0.0.1:4010` streaming the same fixture at ≈256 KB/s with Range support |

The editor was reached without credentials: the Hub endpoints were answered by the stub in
`node_modules/.cache/tmcut-gates/stub-hub.mjs`, and a real media-library record was written for the
fixture so the byte ledger performs its normal `stream → blob:` read. No account was used and no
signed URL, auth header or private data was logged.

Range support on both origins was checked first, so a 206 that never arrives is not mistaken for a
decoder fault:

```
full=200 size=17866685 type=video/mp4
range=206 size=1024
```

---

## 2. Pipeline as it actually runs

| Stage | File | What it does |
|---|---|---|
| Import (web) | `app/composables/useTmcutMedia.ts:612` `importWebFiles` | uploads the picked file, probes the picked bytes, captures a cover |
| Upload route | `server/routes/uploads/[...path].get.ts` | streams `/uploads/*` with `Accept-Ranges` and 206 |
| Byte cache | `app/utils/tmcut/byteStore.ts` | OPFS → IndexedDB copy of the revision, keyed by fingerprint |
| Playback bytes | `app/utils/tmcut/playbackBytes.ts` + `useTmcutPlaybackBytes.ts` | turns a cached revision into a `blob:` URL in a `shallowRef` ledger |
| Engine seam | `app/composables/useTmcutPreviewEngine.ts` | stored path → playable URL (`/uploads/…` on web, `media://local` on desktop) |
| Element | `app/components/tmcut/TmcutPreviewPlayer.vue:1801` | one `<video preload="auto" playsinline>` for the bottom row |
| Control law | `app/composables/useTmcutPlayback.ts:371` `step()` | rAF loop: core's pace → `playhead`, then drift-correct the element |
| Buffering flag | `TmcutPreviewPlayer.vue:439` | one boolean from `waiting` / `playing` / `canplay` |

There is **no WebGPU and no WebGL2 renderer** in `app/`. The only graphics contexts are Canvas 2D
(thumbnail capture at `useTmcutMedia.ts:546`, frame decode at `frameDecode.ts:332`, export at
`webExportHost.ts:109`). Preview painting is DOM: `<video>`, `<img>`, CSS filters and CSS overlay
plates.

### 2.1 The two engine labels are one layer, and one of them is not running

| Label | Source | Truth |
|---|---|---|
| `HTML5 Preview Engine` | `i18n/locales/en.json:822` `tmcut.player.engineBadge`, painted at `TmcutPreviewPlayer.vue:1596` | Accurate. The preview is `<video>` + DOM. |
| `WebGPU · WebCodecs` / `WebGL · WebCodecs` | `TmcutEditorWorkspace.vue:33` `hardwareLabel`, painted by `TmcutEditorStatusBar.vue:26` | Misleading. It is computed from `'gpu' in navigator` alone (`TmcutEditorWorkspace.vue:63`); `WebCodecs` is real (export only), `WebGPU`/`WebGL` name a renderer that does not exist anywhere in the app. |

So this is **not** a second engine silently failing. It is one engine, reported twice, and the
footer advertises a render backend that never runs. The fix is to report what is running.

---

## 3. Measurements

### 3.1 The file, the codec and the transport are healthy

A bare `<video>` on the fixture, sampled every 250 ms for 6 s:

| Sample | `currentTime` | `readyState` | buffered end | frames |
|---|---|---|---|---|
| 0.5 s | 0.215 | 4 | 14.16 | 8 |
| 3.0 s | 2.988 | 4 | 17.0 | 88 |
| 6.2 s | 6.007 | 4 | 19.83 | 181 |

Totals: `totalVideoFrames = 181`, `droppedVideoFrames = 0`. The element decodes the file at 30 fps
with zero drops. Codec, container, Range serving and decode are ruled out.

### 3.2 The real editor, healthy source, plays correctly

With the real project + real playback composable + the byte ledger's `blob:` source, the monitor
element tracked the playhead with 0 corrective seeks and 0 dropped frames:

```
ph 0.73 / ct 0.71   ph 3.50 / ct 3.47   ph 6.00 / ct 5.98   seeks=0  frames=183  dropped=0
```

The same is true of the mounted editor driven by the UI Play button (playhead 00:10 → 00:24.03,
`seeks = 0`, `dropped = 0`).

**Conclusion:** on a fast local origin the current control law is fine. The defect is not "preview
never plays"; it is what the law does once the element falls behind.

### 3.3 The control law turns a transient underrun into a permanent stall

Same fixture, served at ≈256 KB/s so the element genuinely cannot keep up. Two runs, identical except
for the drift law.

**With the app's law** (`useTmcutPlayback.ts:462`: `if (Math.abs(currentTime - targetTime) > 0.3) currentTime = targetTime`):

| t | playhead | `currentTime` | `readyState` | buffered end | seeks |
|---|---|---|---|---|---|
| 1.0 s | 0.93 | 0.83 | 1 | 0.5 | 3 |
| 3.0 s | 2.97 | 2.93 | 1 | 0.8 | 10 |
| 6.0 s | 6.00 | 5.93 | 1 | 0.8 | 20 |
| 9.0 s | 9.07 | 8.93 | 1 | 0.8 | 30 |
| 12.0 s | 12.07 | 11.93 | 1 | 0.8 | 40 |

`seeking` fired 40 times, `seeked` once. `readyState` never left 1 (`HAVE_METADATA`) for the whole
run: the element never had enough data to present a frame.

**Without the drift law**, same source, same element:

| t | `currentTime` | `readyState` | buffered end |
|---|---|---|---|
| 3.0 s | 2.96 | 3 | 3.6 |
| 6.0 s | 4.53 | 2 | 4.8 |
| 12.0 s | 5.57 | 2 | 6.7 |

No seeks. The buffer grows 3.0 → 6.7 s and the element recovers from each underrun by itself.

**Cause, stated precisely.** Every `currentTime` write aborts the media element's in-flight range
load and restarts it at the new position. When the source is slower than real time, the element is
*always* more than 0.3 s behind the wall clock, so the loop seeks on essentially every tick. Each
seek cancels the fetch that was about to fill the buffer, so the buffer never grows, so the element
stays behind, so the loop seeks again. On the fast local origin the element keeps up and the
threshold is never crossed — which is why the bug looks intermittent and why it is not visible in a
casual test.

**Two amplifiers make it worse in the real app:**

1. The playhead is driven by wall clock, not by the picture. While the element is stalled at
   `readyState < 3`, `playhead` keeps advancing, so the drift the law measures grows without bound
   and the seek targets move further away from where the decoder actually is.
2. The same `> 0.3 s` law is applied to the crossfade partner and every stacked row
   (`useTmcutPlayback.ts:281`), so a multi-row timeline seeks several elements per frame.

Ruled out along the way (each measured, not assumed):

| Candidate | Evidence |
|---|---|
| Codec / container / extradata | bare element: 181 frames, 0 drops |
| Range serving | 206 on both origins |
| Object-URL lifetime | blob URL alive for the whole run; element kept reading |
| Mid-play `stream → blob:` swap | swap alone loses ~0.05 s and regenerates `canplay`; no stall |
| `seeking` thrash without a slow source | 0 corrective seeks on local origin |
| A second (WebGPU/WebGL) renderer failing | no such context exists in `app/` |
| Audio graph blocking video | no audio track on the fixture; mixer attached nothing |

### 3.4 The buffering indicator cannot tell the truth

`isBuffering` is set by `waiting` and cleared by `playing` / `canplay` only
(`TmcutPreviewPlayer.vue:440-445`). There is no `seeking`, `stalled`, `error` or timeout input, and
no relationship to `readyState`. Consequences:

- A decoder or network failure that never fires `playing` leaves the spinner on forever — exactly the
  reported "Buffering…" with no error.
- A seek-storm, which fires `waiting` once and then `seeking` repeatedly, pins the spinner on while
  the element is in fact not going to recover.

The state machine the report asked for does not exist: there is one boolean, not
`loading-source → initializing-decoder → decoding → waiting-for-frame → rendering → playing` and the
rest.

---

## 4. Bug B — the export refuses a preset it could paint

### 4.1 What the refusal is keyed on

`planEncodeContent` (`packages/core/src/exportContent.mjs:197`) collects every clip effect whose bare
`type` is not in `EXPORT_BAKED_EFFECTS`:

```js
if (Array.isArray(clip.effects) && clip.effects.length > 0) {
  const unbaked = clip.effects
    .map(effect => effect?.type)
    .filter(type => typeof type === 'string' && !exportBakesEffect(type))
  if (unbaked.length > 0) { reasons.add('effects'); ... }
}
```

`EXPORT_BAKED_EFFECTS` is `['blur','mono','negate','sepia','sharpen','vibrance','vivid']`
(`exportContent.mjs:96`). A Filter preset is stored as `{ type: 'lut3d', params: { lut: 'cool' } }`, so
`lut3d` is never bakeable — for **any** preset, including ones whose entire look is a CSS filter.

### 4.2 What each preset actually needs

`lutGrade` (`packages/core/src/effects.mjs:533`) maps a preset to semantic ops; the preview renders
them through `fxPreview.cssFromGrade` (`app/utils/tmcut/fxPreview.ts:391`). Classifying all 20
presets by (a) the CSS filter they produce and (b) whether they need an overlay plate:

| Preset | Filter | Plate |
|---|---|---|
| neutral | *(identity)* | no |
| warm | `sepia(0.35) saturate(1.175)` | no |
| **cool** | `sepia(0.35) hue-rotate(180deg) saturate(1.14)` | no |
| cinematic | `contrast(1.25) saturate(1.2) hue-rotate(-10deg) contrast(1.1) saturate(1.15)` | no |
| vintage, vivid, fade, mono, sepia, noir, bleach, teal-orange, sunset, moonlight, forest, rose, cyberpunk, honey, arctic | pure filter chains | no |
| **film** | `contrast(1.18) brightness(1.01) saturate(0.92)` | **yes** — grain 0.16 |

**19 of 20 presets need no plate at all.** Only `film` carries `grain`, which is a time-varying
overlay. So "is `lut3d` bakeable" is the wrong question: the correct one is "is *this instance's*
grade plate-free", which the effect's own params answer.

### 4.3 The button that lies

`TmcutExportModal.vue:429` renders a warning banner from `exportBlockers`, but the Start Export button
(`TmcutExportModal.vue:701-710`) has **no `:disabled` binding**:

```vue
<UButton v-if="!isExporting && !exportDone" color="primary" variant="solid"
         icon="i-lucide-download" size="sm" @click="startExport">
```

`runWebExport` then throws the refusal (`TmcutExportModal.vue:277-281`) and the catch turns it into a
toast/`exportError`. A control that can only be refused is still offered, and the reason lives in the
wrong place.

---

## 5. Defect list

| # | Defect | File | Severity |
|---|---|---|---|
| A1 | Corrective seek fires while the element cannot present, cancelling the fetch that would fill the buffer → permanent stall | `useTmcutPlayback.ts:462` (and `:281` for secondary elements, `:404`, `:447`) | Critical |
| A2 | Playhead is wall-clock only; it advances through a frozen picture, unbounded | `useTmcutPlayback.ts:377` | Critical |
| A3 | Buffering is one boolean from `waiting`/`playing`/`canplay`; no `seeking`/`stalled`/`error`/timeout, so a dead decoder shows an endless spinner | `TmcutPreviewPlayer.vue:439-445` | High |
| A4 | Footer reports `WebGPU`/`WebGL · WebCodecs` while no GPU renderer exists | `TmcutEditorWorkspace.vue:33` | Medium |
| B1 | Export eligibility keyed on bare `type`, so every `lut3d` is refused although 19/20 presets are pure CSS filters | `packages/core/src/exportContent.mjs:236` | Critical |
| B2 | Start Export is not disabled while blockers exist | `TmcutExportModal.vue:701` | High |

## 6. Fix plan

1. **A1/A2** — before writing `currentTime`, require the element to be presenting
   (`readyState >= HAVE_FUTURE_DATA`, not `seeking`, buffered range covering the target). While it is
   not, hold the playhead where the picture is instead of letting wall clock run away, so the
   timeline and the monitor cannot diverge and the law can never spiral.
2. **A3** — a real buffering state: derive it from `readyState`/`seeking`/`waiting`/`stalled`, clear
   it when data is present, and turn a stall longer than the bounded budget into a visible error
   rather than an endless spinner.
3. **A4** — report the engine that runs (`HTML5 <video>` + `WebCodecs`), and stop advertising a GPU
   renderer that does not exist.
4. **B1** — make the bake question per-instance: `exportBakesEffect` accepts `lut3d` when the
   preset's grade needs no plate; publish that decision as data and hold the painter to it.
5. **B2** — disable Start Export while `exportBlockers` is non-empty, and keep the reason next to the
   button.

## 7. What this audit does not claim

- Only Chrome on this machine was measured. Firefox/Safari element behaviour, and the packaged
  Electron shell, are not covered here.
- The ≈256 KB/s harness is a reproduction of the *class* (source slower than real time), not a
  measurement of the reporter's network.
- `film`'s grain plate stays refused after this work; it needs an overlay leg and a pixel gate.
- Frame delivery rate, render FPS and time-to-first-frame under the fixed law are measured in the
  verification phase, not here.

## 8. Fix shipped (2026-11-11)

Each defect above is closed by a law that lives in core, plus the component that applies it. What
changed, and the check that holds it:

| Defect | Law | Applied in | Held by |
|---|---|---|---|
| A1, A2 | `planPlaybackFollow` (`packages/core/src/playback.mjs`): a corrective seek is legal only while the element is presenting and not seeking; a frozen picture past `TMCUT_PLAYBACK_STALL_LIMIT_MS` is a stall, and while the element cannot present the playhead rides the picture instead of the wall clock | `useTmcutPlayback.ts` `followElement()`, used by the main picture and every secondary/stacked element | `tests/unit/tmcut_playback_follow.spec.ts` |
| A3 | the stall is a second state: `playing` alone no longer clears buffering — data present (`readyState >= HAVE_FUTURE_DATA`, not seeking) does — and a stall past the budget replaces the spinner | `TmcutPreviewPlayer.vue` `onVideoProgress` + the `playbackStalled` alert pill | manual + `tmcut_component_hygiene.spec.ts` |
| A4 | the footer names the engines that run (`tmcut.workspace.engineLabel`), not a capability sniff | `TmcutEditorWorkspace.vue` `hardwareLabel` | `tmcut_capability_honesty.spec.ts` |
| B1 | `exportBakesEffectInstance(effect)` asks per INSTANCE: a `lut3d` is baked when its registered preset's grade carries no plate; `blockedEffects` names the instance (`lut3d:film`) | `packages/core/src/exportContent.mjs`; painter in `app/utils/tmcut/exportEffectPaint.ts` | `packages/core/test/export-content-eligibility.test.mjs`, `tmcut_export_effect_paint.spec.ts` |
| B2 | Start Export is `:disabled="exportBlocked"`, `startExport` refuses in the same place, and a refused preset is named by its library name | `TmcutExportModal.vue` | `tmcut_export_modal_gate.spec.ts` |

The "Cool" preset from the report now exports: its grade is a pure colour/filter chain and the painter
emits the monitor's exact `filter` string. `film` stays refused and is named: its grade ends in a grain
op the canvas painter has no plate for.
