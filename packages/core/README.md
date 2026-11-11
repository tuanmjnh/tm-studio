# tmcut-core

The pure editing engine behind TMCut. Zero dependencies, plain ESM, runs on bare Node.

`packages/core` is the only workspace package in this repository. It owns every **decision** the
editor and the exporter make about a project, and none of the **IO** used to carry those
decisions out. That split is why the same timeline renders the same way in a browser tab and in
the Electron window: both ask this package, and neither keeps a second copy of the answer.

```text
core decides  →  app/ and electron/ execute
```

`app/` reads this package through the Nuxt alias `tmcut-core`, which resolves to
`packages/core/src/index.mjs` (`nuxt.config.ts:21,107`). The Electron main process reads the same
source tree by relative path. `dist/` exists only for npm and is never a source dependency.

---

## 1. What is in the package

| Path | Contents | Notes |
|---|---|---|
| `src/` | 63 `.mjs` modules on disk; the barrel (`src/index.mjs`) re-exports 62 of them in 64 lines, because two are re-exported twice | what every host loads |
| `types/` | DSL v3 type surface: `dsl.ts`, `media.ts`, `mediaInfo.ts`, `pixels.ts`, `platform.ts`, `runtime.ts`, `editor-api.ts`, `edl.ts`, `history.ts` | type-only; no runtime code |
| `src/index.d.ts` | binds the type surface to the runtime API | checked against `types/` by `pnpm typecheck:core` |
| `test/` | 66 `node:test` files, **919 tests across 136 suites** | no bundler, no DOM, no Electron |
| `tools/check-boundaries.mjs` | forbidden-import scan | `pnpm check:core` |
| `scripts/prepare-dist.mjs` | copies `types/` into `dist/` after the tsup build | publish only |

432 named exports come out of the barrel. They are grouped by domain in section 3.

---

## 2. Time model

`TICKS_PER_SECOND = 120000` (`src/time.mjs:9`).

- Ticks are plain `number`, never `bigint`, so a project stays JSON-serializable for localStorage,
  a project file, and IPC.
- At 120 000 ticks per second, a `number` stays exact far beyond any editable duration.
- `FrameRate` is rational (`{ numerator, denominator }`), so 29.97 fps is `30000/1001`, not a
  rounded float.
- Clip windows are **half-open**: `[start, end)`. The end instant belongs to no clip; ADR-018.

Anything that converts between seconds and ticks is in `src/time.mjs`; nothing else in the package
does that arithmetic by hand.

---

## 3. Public API domains

### 3.1 Time and scheduling

| Symbol | Module | Job |
|---|---|---|
| `TICKS_PER_SECOND`, `secToTicks`, `ticksToSec` | `time.mjs` | the only conversion pair |
| `KNOWN_FRAME_RATES`, `rationalToFloat` | `time.mjs` | rational rate handling |
| `createClock` | `clock.mjs` | frame grid arithmetic |
| `createFramePace` | `pace.mjs` | playhead pacing from the grid |
| `createFrameScheduler` | `scheduler.mjs:65` | deterministic frame-index scheduler |
| `planPlaybackFollow` | `playback.mjs:56` | when the preview may write `currentTime`, and where the playhead stands while the picture is not presenting |

### 3.2 Timeline and evaluation

| Symbol | Module | Job |
|---|---|---|
| `evaluateTimeline` | `evaluate.mjs:348` | what is live at a tick |
| `evaluateClip`, `clipSourceRange`, `textAnimationAt` | `evaluate.mjs` | per-clip evaluation |
| `renderAt` | `renderAt.mjs:51` | the public "paint this timestamp" contract: frame snap, end step-back, boundary laws |
| `projectTracks` | `evaluate.mjs` | row projection both hosts share |

### 3.3 Composition plans

| Symbol | Module | Job |
|---|---|---|
| `selectPaintRows`, `paintStackAt`, `selectFileRows` | `paintStack.mjs` | which row paints, in what order |
| `compositePlan` | `composite.mjs:53` | the per-layer plan the preview and the exporter both read |
| `blendModeOf`, `BLEND_MODES` | `blend.mjs` | the legal blend set |

### 3.4 Effects, transitions, motion

| Symbol | Module | Job |
|---|---|---|
| `EFFECT_REGISTRY` | `effects.mjs:31` | 29 effect definitions: params, bounds, capability |
| `validateEffect`, `normalizeEffects`, `clampEffectParam`, `fxCapabilities` | `effects.mjs` | legality and clamping |
| `lutGrade` | `effects.mjs:532` | semantic grade ops (balance, eq, curves, desaturate, sepia, grain) — not an FFmpeg filter string |
| `KNOWN_TRANSITIONS` | `transitions.mjs:29` | 45 named transitions |
| `previewTransitionRamp`, `transitionWindows`, `XFADE_PREVIEW`, `XFADE_POSITION_LAWS` | `transitions.mjs` | preview geometry and legality |
| `canApplyTransition`, `applyTransition`, `clearTransition` | `transitions.mjs` | timeline mutation |
| `evalKeyframe`, `keyframeAt`, `setKeyframe`, `removeKeyframe`, `propsWithKeyframes`, `keyframeTimes` | `keyframes.mjs` | five easings, tick-exact |
| `mask` helpers, `retime` helpers | `mask.mjs`, `retime.mjs` | mask geometry and speed ramps |

### 3.5 Project, timeline and editing

| Symbol | Module | Job |
|---|---|---|
| `createProject`, `defaultCanvas`, `defaultTimeline`, `migrateV1ToV3` | `project.mjs` | project construction and migration |
| `addClip`, `removeClip`, `splitClip`, `moveClip`, `addTrack`, `removeTrack`, `ensureTrack`, `clipSpan`, `totalDurationTicks` | `timeline.mjs` | timeline structure |
| `moveClips`, `duplicateClips`, `copyClips`, `pasteClips`, `rippleDelete`, `insertClipRipple`, `closeGaps`, `snapTime`, `snapTimeDetailed` | `editing.mjs` | editing operations |
| `createSelection`, `toggleSelected`, `groupClips`, `ungroupClips`, `expandRelated` | `selection.mjs` | selection and groups |
| `createHistory`, `pushBatch`, `coalesce` | `history.mjs` | undo/redo with one-gesture coalescing |
| markers | `markers.mjs` | timeline markers |
| `migrateV1ToV3` | `project.mjs:110` | legacy file migration |

### 3.6 Media facts and cache law

| Symbol | Module | Job |
|---|---|---|
| `buildMediaInfo`, `buildCompatibility`, `pickDuration`, `buildFrameRate`, `classifyImportStatus`, `mediaInfoToMetadata`, `buildMediaCapabilities` | `mediaInfo.mjs` | what a file is, and what is unknown about it |
| `classifyAssetKind`, `mediaFileName`, `extensionOf`, `normalizeMediaPath` | `media.mjs` | path and kind rules |
| `registerAsset`, `relinkAsset`, `attachMetadata`, `listAssets` | `assets.mjs` | asset registry |
| `fnv1aHex`, `cacheKeyForPath`, `cachePathFor` | `cache.mjs` | cache key derivation |
| `byteCacheBudgetBytes`, `byteCacheFits`, `planByteCacheEviction`, `planPlaybackByteSource`, `planBlobUrlLifecycle`, key parsers | `byteCache.mjs` | the client byte cache's law |
| `frameRequestKey`, `planFrameCacheEviction`, `createFrameSlotLedger`, `filmstripTimes`, `frameTimesForSegments`, concurrency and cache constants | `frames.mjs` | frame request identity and lifecycle |
| waveform law | `waveform.mjs` | float peaks, stamped payload, derived key |
| `parseSrt`, `serializeSrt`, `cuesToCaptionClips` | `caption.mjs` | subtitles |
| text style law | `textStyle.mjs` | the DOM renderer's text model |

### 3.7 Audio

| Symbol | Module | Job |
|---|---|---|
| `audioMixAt` | `audioMix.mjs` | what sounds at a tick |
| `gainAt` | `audio.mjs` | per-clip gain, keyframed |
| `pcmHeadTrim` | `detection.mjs` | trims a PCM window to the head the analysis asked for |
| audio orchestration plan | `audioOrchestration.mjs` | multi-source arrangement |

### 3.8 Export planning

| Symbol | Module | Job |
|---|---|---|
| `planEncodeContent` | `exportContent.mjs:253` | may this project be painted at all, and what blocks it |
| `EXPORT_BAKED_EFFECTS` | `exportContent.mjs:97` | the seven effect types a file can carry |
| `exportBakesEffect`, `exportBakesEffectInstance`, `refusedEffectName` | `exportContent.mjs:120,142,172` | per-type and per-instance bake decisions, plus the name shown to the user |
| `planEncodePlate`, `encodeCanvasFill` | `exportContent.mjs` | where a plate lands on the canvas |
| `planEncodePresets`, `planEncodeConfig`, `planEncodeSample`, `planEncodeChunk`, `planEncodeQueue`, `planEncodeFinish`, `planEncodeProgress`, `planEncodePacketMeta`, `planEncodeAudioSample`, `planEncodeAudioPadding`, `encodeAudioPacketCount`, `encodeAudioHandCount`, `encodeAudioSampleCount` | `exportEncode.mjs` | the whole encode contract: capability ladder, timestamps, backpressure, mux order |
| `planExportMixPacket`, `EXPORT_MIX_REFUSALS` | `exportMix.mjs:147` | packet position, rate, resample, gain, sum |

The split that matters: **the painter is not in this package.** `ctx.filter` calls, `drawImage`
calls, and the canvas itself belong to `app/utils/tmcut/exportEncodeSession.ts`. Core says which
effect is bakeable and what the picture should contain; the app draws it.

### 3.9 HTML/CSS video

| Symbol | Module | Job |
|---|---|---|
| `validateHtmlVideoSpec`, `HTML_VIDEO_LIMITS`, `HTML_VIDEO_PRESETS`, `frameTimes`, `frameCountFor` | `htmlVideo.mjs` | the deterministic `seek(t)` composition contract |
| `lintHtmlVideo`, `collectHtmlTokens`, `replaceHtmlTokens`, `unresolvedHtmlTokens` | `htmlVideo.mjs` | composition linting and token substitution |

### 3.10 Product plans

| Symbol | Module | Job |
|---|---|---|
| `routeScene`, `routeStoryboard`, `canServe`, `isProviderHealthy`, `buildCapabilityMatrix` | `providerRouting.mjs` | which provider serves which scene |
| generation and provider adapter registries | `generationAdapter.mjs`, `providerAdapter.mjs` | the Electron adapters register into these |
| AI plan builders | `aiPlan.mjs` | script and scene plans |
| template plan builders, `templates.mjs` | `templatePlan.mjs`, `templates.mjs` | versioned template law and starter set |
| AutoCut plan | `autocutPlan.mjs` | cut decision from scene and silence input |
| asset center, marketplace, takedown, catalogue publish | `assetCenter.mjs`, `marketplaceCatalog.mjs`, `takedown.mjs`, `catalogPublish.mjs` | asset lifecycle |
| `buildAssemblyPlan`-style row planning | `generationToAssetCenter.mjs` | generated output to editable rows |
| usage tracking, telemetry, crash recovery | `usageTracker.mjs`, `telemetry.mjs`, `crashRecovery.mjs` | local-only diagnostics |

---

## 4. Project schema v3

Two shapes exist, both real, both guarded by `tests/unit/tmcut_project_schema_v3.spec.ts`:

| Shape | Produced by | Fields |
|---|---|---|
| App file | `useTmcutProject` → localStorage or the Electron JSON file | `schemaVersion: 3`, flat `timeline { version, tracks, durationMs, markers }` |
| Core normalized | `createProject()` | `version: 3`, DSL `timeline { version: 3, tracks, markers }` |

A third shape (`TMCutProject { schemaVersion, tracks, sequences }`) exists in no shipped file and
was ruled out by the owner: turning `timeline.tracks` into `tracks` plus `sequences` is a
migration, not a rename, and it would invalidate every project on disk.

`migrateV1ToV3` (`src/project.mjs:110`) handles the legacy seconds-based file: values are scaled
once and re-stamped, and are never scaled twice.

---

## 5. Type surface

`types/` holds the runtime-independent types and `src/index.d.ts` binds them to the API.

- `MediaTime` is an integer tick count. `FrameRate` is rational.
- Clips reference `assetId`; `locator` is the transitional bridge for path-based projects.
- `types/platform.ts` declares the host interfaces (`TmcutPlatformAdapter`, media, capture) and
  `types/runtime.ts` declares the capability flags. **The interfaces live here; the
  implementations do not.** `app/composables/useTmcutPlatform.ts` builds the one `PlatformInfo`
  the app reads, and both hosts report `webGPU: false` today because no GPU renderer exists.
- Consistency between `.d.ts` and `types/` is a gate: `pnpm typecheck:core`.

---

## 6. Boundaries

`tools/check-boundaries.mjs` fails the build on any of these in `src/*.mjs`:

```text
vue · nuxt · electron · node: · window. · document. · localStorage
ipcRenderer · ipcMain · @nuxt/ · ~/
```

Run it with `pnpm check:core`. Current result: exit 0, "core imports nothing platform-specific".

Two probes are legal under that rule and worth knowing about, because a stricter boundary would
have to split them: `crashRecovery.mjs:191` obtains `fs/promises` via `process.getBuiltinModule`
and `crashRecovery.mjs:219` reads a WebGL context from `globalThis.document` when one exists.
Both are capability checks inside a function that receives the host objects as parameters, not
module-scope imports.

The package also must never be imported by name into the Electron main process and must never be
read from `dist/`. Both are pinned by `tests/unit/tmcut_core_source.spec.ts`.

---

## 7. Build, test, publish

| Command | What it does |
|---|---|
| `pnpm --dir packages/core test` | `node --test "test/*.test.mjs"` — 919 tests, 136 suites |
| `pnpm --dir packages/core check` | boundary scan |
| `pnpm --dir packages/core typecheck` | `tsc --noEmit` over the package's own config |
| `pnpm --dir packages/core build` | `tsup` to `dist/`, then `prepare-dist.mjs` copies `types/` |
| `pnpm build:core` (from the repo root) | the same build |

`dist/` is gitignored and is **not** shipped in the desktop app. `electron-builder.yml` lists
`packages/core/src/**/*` instead, and
`tests/unit/tmcut_core_source.spec.ts:252` proves the whole transitive closure the main process
loads is inside that list.

Publishing is a separate deliberate act (`npm publish ./dist` inside the package). It is not part
of any build script the repository runs.

---

## 8. How the app consumes this package

```ts
import { TICKS_PER_SECOND, evaluateTimeline, renderAt } from 'tmcut-core'
```

- **One name.** The Nuxt alias equals the package name, `tmcut-core` (`nuxt.config.ts:21,107`).
  `tsconfig.test.json` maps the same name to the same file for the node spec runner.
- **Bare imports only.** A subpath such as `tmcut-core/generationAdapter` cannot work: Vite treats
  a string alias as a prefix and would rewrite it onto `packages/core/src/index.mjs`, which is a
  file. `tests/unit/tmcut_core_source.spec.ts:261` fails the suite if a subpath import appears.
- **`src`, not `dist`.** Reading the built artifact is the bug G13 measured: one process can end
  up holding two copies of one engine, at two different versions.
- **Electron reads by relative path.** The alias belongs to Vite, so the main process uses
  `../../../packages/core/src/...` (`electron/tools/video-generation/controller.mjs:25,30`).

---

## 9. What is deliberately not here

| Not in core | Where it lives | Why |
|---|---|---|
| decoding a frame, decoding PCM, probing a container | `app/utils/tmcut/frameDecode.ts`, `audioDecode.ts`, `mediaProbe.ts` | needs `mediabunny` and a browser or a file path |
| encoding and muxing | `app/utils/tmcut/exportEncodeSession.ts`, `webCodecsExport.ts` | needs WebCodecs and the muxer |
| painting pixels | `TmcutPreviewPlayer.vue`, `exportEncodeSession.ts` | needs DOM, CSS, and a canvas |
| the Web Audio graph | `app/utils/tmcut/audioMixer.ts` | needs `AudioContext` |
| OPFS and IndexedDB | `app/utils/tmcut/byteStore.ts` | needs browser storage |
| host capability detection at runtime | `app/composables/useTmcutPlatform.ts` | needs to know which bridge is present |
| IPC, windows, dialogs, the updater | `electron/` | host lifecycle |

If a change makes core want any of those, the change belongs in the calling seam instead. That
rule is what keeps 919 tests runnable under plain `node --test`.

---

## 10. Reading order for a newcomer

1. `src/time.mjs`, then `src/clock.mjs` — the unit of time everything else uses.
2. `src/evaluate.mjs`, then `src/scheduler.mjs`, then `src/renderAt.mjs` — how a tick becomes a
   frame and a frame becomes a list of layers.
3. `src/paintStack.mjs`, then `src/composite.mjs` — the plan a painter consumes.
4. `src/exportContent.mjs` — what a file may contain, and what is refused by name.
5. `src/exportEncode.mjs` — the encode contract, if you are touching the exporter.

Repository-wide context: [root README](file:///D:/Applications/tm-studio/README.md) and
[package boundaries](file:///D:/Applications/tm-studio/docs/architecture/package-boundaries.md).
