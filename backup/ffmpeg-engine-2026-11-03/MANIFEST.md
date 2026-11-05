# Backup: the FFmpeg engine (2026-11-03)

Snapshot of every file the FFmpeg-removal plan touches, mirrored under this
directory at its original repo path, so each one can be opened and compared
without digging through git.

- Source commit: `92a481837887d038ff102c80252c352c2e45e929` (this is also the recovery point: `git show 92a481837887d038ff102c80252c352c2e45e929:<path>`
  returns any file here byte-for-byte, and full history stays in git).
- Files copied: **75** of 75.
- Missing at snapshot time (never in this repo): none.
- **Not copied on purpose:** `resources/ffmpeg.exe`, `resources/ffprobe.exe`,
  `resources/ffplay.exe` (164 MB / 164 MB / 166 MB = **494 MB**, re-downloadable from
  gyan.dev by `electron/tools/updater.cjs`, and git-ignored). If they must survive a
  removal, move them aside manually rather than copying them here.

## What each file was for, and what the plan intends to do with it

| Path | Role in the FFmpeg path | Planned |
|---|---|---|
| `app/utils/tmcut/render/audio.ts` | FFmpeg amix/apad chain | remove |
| `app/utils/tmcut/render/clip.ts` | selectExportTracks + toRenderClip (FFmpeg-shaped clip model) | remove |
| `app/utils/tmcut/render/encoder.ts` | encoder/codec arg selection | remove |
| `app/utils/tmcut/render/graph.ts` | RenderGraph label emitter | remove |
| `app/utils/tmcut/render/index.ts` | compileVideoPipeline: whole-file graph, pads, paint-stack overlay, LUT, caption tail | remove |
| `app/utils/tmcut/render/text.ts` | drawtext windows + float duration math | remove |
| `app/utils/tmcut/render/types.ts` | RenderClip/pipeline types | remove |
| `app/utils/tmcut/render/video.ts` | compileVideoPipeline per-row chain, xfade fold, overlay compositor | remove |
| `app/utils/tmcut/compiler.ts` | facade re-exporting compileTimelineToFfmpeg | remove |
| `app/utils/ffmpegHelper.ts` | desktop ffmpeg arg builder + label/text render helpers (1306 lines) | remove |
| `app/components/tmcut/TmcutExportModal.vue` | export surface: parallelTracksWarning + ffmpeg availability gate | edit |
| `app/composables/useTmcutExportQueue.ts` | job queue driving the ffmpeg render channel | edit |
| `app/composables/useToolTaskManager.ts` | task manager for tools:ffmpeg IPC | edit |
| `app/composables/useTmcutPlatform.ts` | platform adapter: ffmpeg/ffprobe sniff per host | edit |
| `app/composables/useMcpRendererBridge.ts` | MCP bridge exposing ffmpeg render | edit |
| `app/composables/useTmcutMedia.ts` | media probe consumer | edit |
| `app/composables/useTmcutProject.ts` | project store: probe-derived durations | edit |
| `app/components/tools/VideoPreviewModal.vue` | tools preview via ffmpeg frames | edit |
| `app/pages/tmcut/autocut.vue` | autocut analyze consumer | edit |
| `app/utils/tmcut/canvas.ts` | canvas fit helpers mirroring ffmpeg filters | edit |
| `app/utils/tmcut/fxCatalog.ts` | FFMPEG_XFADE_NAMES list (owner-modified file: read-only here) | edit |
| `app/components/tmcut/TmcutInspector.vue` | inspector copy about ffmpeg support | edit |
| `app/components/tmcut/TmcutEditorWorkspace.vue` | editor workspace export affordance | edit |
| `app/components/tmcut/TmcutMediaPanel.vue` | media panel probe/proxy affordance | edit |
| `server/api/v1/media/render.post.ts` | web runtime: spawn compiled ffmpeg args, job progress | remove |
| `server/api/v1/media/analyze.post.ts` | ffprobe analyze | remove |
| `server/api/v1/media/proxy.post.ts` | ffmpeg 540p proxy generation | remove |
| `server/utils/htmlVideoRender.ts` | DOM capture + ffmpeg encodeFrames (only encoder the HTML engine has) | edit |
| `server/utils/renderJobs.ts` | job registry behind the ffmpeg endpoints | edit |
| `server/config/index.ts` | tools.ffmpegPath / ffprobePath config | edit |
| `electron/tools/ffmpeg.controller.cjs` | desktop media toolbox: encoders, HW accel, batch, labels (1598 lines) | remove |
| `electron/tools/updater.cjs` | downloads ffmpeg builds from gyan.dev (+ yt-dlp) | edit |
| `electron/tools/sqlite.cjs` | ffmpeg_configs / ffmpeg_batch_configs / ffmpeg_history tables | edit |
| `electron/tools/paths.cjs` | resolveExecutable().ffmpeg/ffprobe | edit |
| `electron/tools/tmcut.controller.cjs` | runFfmpeg + ffprobe handlers for tmcut IPC | edit |
| `electron/tools/video-generation/video-probe.mjs` | ffprobe-based probe | edit |
| `electron/preload.cjs` | ffmpeg IPC surface exposed to the renderer | edit |
| `electron/main.cjs` | registers the ffmpeg controller | edit |
| `electron/ipcPolicy.cjs` | allow-list for ffmpeg channels | edit |
| `shared/types/electron.ts` | FfmpegLabel / FfmpegRenderResponse IPC contracts | edit |
| `packages/core/src/canvas.mjs` | buildFfmpegFitFilters / buildFfmpegTransform / stillImageInputFlags | edit |
| `packages/core/src/effects.mjs` | FFmpeg effect + xfade name laws | edit |
| `packages/core/src/platform.mjs` | adapter contract: ffmpeg availability | edit |
| `packages/core/src/crashRecovery.mjs` | recovers ffmpeg job state | edit |
| `packages/core/src/index.d.ts` | public core types carrying ffmpeg shapes | edit |
| `packages/core/types/runtime.ts` | runtime types mentioning ffmpeg | edit |
| `packages/core/test/canvas.test.mjs` | tests the ffmpeg filter builders | edit |
| `packages/core/test/effects.test.mjs` | tests ffmpeg effect names | edit |
| `packages/core/test/platform.test.mjs` | tests ffmpeg sniff | edit |
| `packages/core/test/mask.test.mjs` | ffmpeg mask filter expectations | edit |
| `packages/core/test/stabilize.test.mjs` | vidstab ffmpeg expectations | edit |
| `packages/core/test/assets-probe-cache.test.mjs` | ffprobe cache expectations | edit |
| `tests/unit/tmcut_render_smoke.spec.ts` | real ffmpeg render of a timeline | remove |
| `tests/unit/tmcut_render_graph.spec.ts` | literal ffmpeg arg-string witness | remove |
| `tests/unit/tmcut_render_parity.spec.ts` | preview-vs-file through the ffmpeg compiler | remove |
| `tests/unit/tmcut_export_paint_stack.spec.ts` | slice #95 pixel gate through ffmpeg | remove |
| `tests/unit/tmcut_export_gap_placement.spec.ts` | slice #94 gap pads through ffmpeg | remove |
| `tests/unit/tmcut_export_track_parity.spec.ts` | slice #87 caption-window parity vs ffmpeg graph | remove |
| `tests/unit/tmcut_text_pixel.spec.ts` | drawtext pixel gate | remove |
| `tests/unit/tmcut_svg_still.spec.ts` | svg-as-still ffmpeg flags | remove |
| `tests/unit/tmcut_golden_frame.spec.ts` | golden frames rendered by ffmpeg | remove |
| `tests/unit/tmcut_fx_catalog.spec.ts` | catalog names must exist in the ffmpeg binary | remove |
| `tests/unit/tmcut_detect_smoke.spec.ts` | encoder detection via ffmpeg | remove |
| `tests/unit/tmcut_platform_adapter.spec.ts` | adapter ffmpeg/encoder legs | remove |
| `tests/unit/tmcut_phase2.spec.ts` | ffmpeg fit filter checks | edit |
| `tests/unit/tmcut_shared_model.spec.ts` | shared model vs ffmpeg expectations | edit |
| `tests/unit/tmcut_footage_row_rule.spec.ts` | row rule copy mentions the ffmpeg file | edit |
| `tests/unit/tmcut_transition_preview.spec.ts` | xfade parity with ffmpeg | edit |
| `tests/unit/tmcut_ipc_policy.spec.ts` | ffmpeg channel in allow-list checks | edit |
| `tests/unit/tmcut_doc_citations.spec.ts` | cites ffmpeg docs | edit |
| `tests/unit/tmcut_text_style.spec.ts` | drawtext counterpart of the CSS law | edit |
| `tests/unit/tmcut_time_domain.spec.ts` | mentions ffmpeg rounding | edit |
| `tests/unit/tmcut_preview_boundary.spec.ts` | boundary measured against ffmpeg output | edit |
| `tests/unit/tmcut_fx_preview.spec.ts` | fx preview-vs-ffmpeg copy | edit |
| `tests/unit/tmcut_web_upload.spec.ts` | mentions the ffmpeg render endpoint | edit |

## Deliberate exclusions

- `docs/v4-phase-0-audit.md`, `docs/tmcut-v4-universal-rendering-multiplatform-roadmap.md`,
  `docs/extraction-plan.md` are not copied here: they are being restructured, not
  deleted, and the restructure keeps its own archive step.
- `tests/scratch-debug.*` is the owner's file and was never touched.
