# TMCut V4 — Phase 0 Audit & Contract Freeze

> **Trạng thái:** PASS (2026-11-01) — deliverable của Phase 0 trong [tmcut-v4-universal-rendering-multiplatform-roadmap.md](file:///D:/Applications/tm-studio/docs/tmcut-v4-universal-rendering-multiplatform-roadmap.md)
> **Nguồn sự thật:** code trong repo tại commit `6e8ef99`; mọi con số dưới đây đo trực tiếp, không lấy từ blueprint.
> **Quy ước:** `ticks` = `TICKS_PER_SECOND = 120_000` ([time.mjs:9](file:///D:/Applications/tm-studio/packages/core/src/time.mjs#L9)).

---

## 1. Kết luận nhanh

1. **Hiện tại chỉ có MỘT renderer thật: FFmpeg.** Preview là `<video>`/`<img>` + overlay DOM, export là filter graph FFmpeg. V4 muốn "preview và export dùng cùng một logic", nhưng hôm nay chúng là hai hiện thực song song: DOM (CSS) và `-filter_complex`.
2. **Chưa có `renderAt(timestamp)`** trong `@tmcut-core`. Core có 47 module toán (timeline, keyframes, mask, transitions, retime…) nhưng không có bộ đánh giá trạng thái tại thời điểm `t`; FFmpeg tự làm việc đó qua filter graph.
3. **Hai model project cùng tồn tại** và cùng gọi là "v3": model app phẳng (`in/out/offset` ticks) trong [useTmcutProject.ts:177](file:///D:/Applications/tm-studio/app/composables/useTmcutProject.ts#L177) và DSL lồng (`source`/`timeline`) trong [dsl.ts:73](file:///D:/Applications/tm-studio/packages/core/types/dsl.ts#L73). Ranh giới duy nhất là [`toRenderClip`](file:///D:/Applications/tm-studio/app/utils/tmcut/render/clip.ts#L6). Đây là contract phải đóng băng trước Phase 2.
4. **FFmpeg là phụ thuộc cứng ở cả hai runtime.** Desktop spawn ffmpeg đóng gói; web gửi **cùng** mảng args đã compile lên Nitro để chạy ffmpeg hệ thống. Không có nhánh WebCodecs/MediaRecorder cho export.
5. **HTML/CSS video đã là renderer "deterministic theo timestamp"** nhưng chỉ cho composition HTML, và có hai stack capture khác nhau (Electron `capturePage`, web `playwright-core`). Đây là mẫu tốt để nhân ra timeline renderer ở Phase 2.

---

## 2. Bản đồ kiến trúc hiện tại

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Nuxt 4 UI (ssr:false)                                                    │
│  pages/tmcut/* (8) · components/tmcut/* (47) · composables/useTmcut*     │
│  Preview: 2× <video> (crossfade) + <img> (still) + text DOM overlay       │
└───────────────┬──────────────────────────────────────────────────────────┘
                │ app model (ticks, schemaVersion 3)
┌───────────────▼──────────────────────────────────────────────────────────┐
│ App store     app/composables/useTmcutProject.ts (1,880 dòng)            │
│  edit ops · history · persist: localStorage mirror + JSON file + recovery│
│  snapshots + revision counter                                            │
└───────┬───────────────────────────────┬──────────────────────────────────┘
        │ pure math (import alias)      │ canonical decode
┌───────▼─────────────────┐   ┌─────────▼──────────────────────────────────┐
│ @tmcut-core             │   │ Render compiler app/utils/tmcut/render/*   │
│ packages/core (47 file) │   │  RenderGraph → -filter_complex (FFmpeg)    │
│ zero deps · 390 tests   │   │  drawtext · xfade · overlay/blend · audio  │
│ NO renderAt / evaluator │   │  codecs · gif · LUT · denoise              │
└─────────────────────────┘   └─────────┬──────────────────────────────────┘
                                        │ args[]
        ┌───────────────────────────────┴──────────────────────────────┐
┌───────▼─────────────────────────────┐   ┌────────────────────────────▼──┐
│ Desktop: Electron task manager      │   │ Web: POST /api/v1/media/render│
│  bundled ffmpeg · 30 IPC handles    │   │  Nitro spawns system ffmpeg   │
│  progress via -progress pipe:1      │   │  uploads-only · 400 args max  │
└─────────────────────────────────────┘   └───────────────────────────────┘

HTML/CSS video (composition, không phải timeline):
  Desktop: BrowserWindow + window.__tmcutSeek(t) + capturePage → ffmpeg rawvideo
  Web:     playwright-core + Chrome + cùng contract seek(t) → capture → ffmpeg
```

**Bằng chứng chính**

| Lớp | Tệp | Ghi chú |
|---|---|---|
| Preview | [useTmcutPreviewEngine.ts:4](file:///D:/Applications/tm-studio/app/composables/useTmcutPreviewEngine.ts#L4) | "The preview never calls FFmpeg — playback is HTMLVideoElement + blobs on both runtimes" |
| Preview composite | [TmcutPreviewPlayer.vue:51](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L51) | layer `<video>` thứ hai cho crossfade; [text overlay CSS](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L823) là bản sao của `drawtext` |
| App store | [useTmcutProject.ts:175](file:///D:/Applications/tm-studio/app/composables/useTmcutProject.ts#L175) | `TMCUT_PROJECT_SCHEMA_VERSION = 3` |
| Core | [packages/core/src/index.mjs](file:///D:/Applications/tm-studio/packages/core/src/index.mjs) | barrel thuần ESM, không renderer |
| Core trong app | [nuxt.config.ts:21](file:///D:/Applications/tm-studio/nuxt.config.ts#L21) | alias `@tmcut-core` trỏ thẳng `src/index.mjs` (cùng code cho browser + Node test) |
| Compiler | [render/index.ts:31](file:///D:/Applications/tm-studio/app/utils/tmcut/render/index.ts#L31) | `compileTimelineToFfmpeg(project, outputPath, options)` |
| Graph | [render/graph.ts:5](file:///D:/Applications/tm-studio/app/utils/tmcut/render/graph.ts#L5) | `RenderGraph` giữ input + filter chain, sinh args |
| Desktop export | [ffmpeg.controller.cjs:1442](file:///D:/Applications/tm-studio/electron/tools/ffmpeg.controller.cjs#L1442) | 30 `ipcMain.handle` (probe, scan, task manager, configs) |
| Web export | [render.post.ts:55](file:///D:/Applications/tm-studio/server/api/v1/media/render.post.ts#L55) | chạy **đã compile args** trên Nitro; `MAX_ARGS = 400`, timeout 20 phút |
| Desktop HTML video | [html-video-renderer.cjs:161](file:///D:/Applications/tm-studio/electron/tools/html-video-renderer.cjs#L161) | `__tmcutSeek(at)` → `capturePage` từng frame |
| Web HTML video | [htmlVideoRender.ts:15](file:///D:/Applications/tm-studio/server/utils/htmlVideoRender.ts#L15) | hợp đồng HyperFrames (`__hf.seek(t)`), chrome qua `playwright-core` |

---

## 3. Kiểm kê tính năng (feature inventory)

Phân loại theo yêu cầu Phase 0: **editor** (thao tác dữ liệu, không render), **renderer** (sinh hình), **export** (đóng gói file), **tooling** (phân tích media), **native** (quyền hệ điều hành).

| # | Tính năng | Hiện thực hôm nay | Desktop | Web | FFmpeg | Phase V4 đích |
|---|---|---|---|---|---|---|
| 1 | Timeline edit (split/trim/ripple/group/link/marker) | `@tmcut-core` timeline/editing/selection/markers | ✅ | ✅ | — | 1 (đã có) |
| 2 | Keyframe, retime, mask, transition math | core `keyframes`/`retime`/`mask`/`transitions` | ✅ | ✅ | — | 1 (đã có) |
| 3 | Preview playback | `<video>` + `<img>` + DOM text/effect overlay | ✅ | ✅ | ❌ | 2 (thay bằng compositor) |
| 4 | Export video (mp4 h264/h265, mov prores, webm vp9) | `compileTimelineToFfmpeg` → ffmpeg | ✅ | ✅ (Nitro) | **bắt buộc** | 3 + 5 |
| 5 | Export audio (m4a/mp3/wav) | cùng compiler, `mode: 'audio'` | ✅ | ✅ | **bắt buộc** | 5 |
| 6 | Export GIF | `buildGifPipeline` (15fps, ≤1280px) | ✅ | ✅ | **bắt buộc** | 5 |
| 7 | Transform/crop/fit/opacity/blend/keyframe | filter `scale`/`crop`/`overlay`/`blend`/`geq` | ✅ | ✅ | **bắt buộc** | 3 |
| 8 | Text overlay (drawtext + anim in/out) | `render/text.ts` → `drawtext` | ✅ | ✅ | **bắt buộc** | 2 (DOM) / 3 |
| 9 | Audio mix, fade, denoise (`afftdn`), pan | `render/audio.ts` | ✅ | ✅ | **bắt buộc** | 4 |
| 10 | Color LUT (.cube) | `lut3d` sau footage, trước drawtext | ✅ | ✅ | **bắt buộc** | 3 |
| 11 | Proxy 540p | ffmpeg scale (desktop job / API proxy) | ✅ | ✅ (server) | **bắt buộc** | 4 |
| 12 | Stabilize (vidstab) | Electron ffmpeg job | ✅ | ❌ | **bắt buộc** | 4 |
| 13 | Silence / scene analysis (autocut) | ffmpeg `silencedetect` / scene detect | ✅ | ✅ (API analyze) | **bắt buộc** | 4 |
| 14 | Thumbnail / filmstrip / waveform | ffmpeg extract + core `int16ToPeaks` | ✅ | ⚠️ (thumbnail qua API) | **bắt buộc** | 4 |
| 15 | HTML/CSS video | Electron `capturePage` · web `playwright-core` | ✅ | ✅ | **bắt buộc** (encode) | 2/7 (hợp nhất) |
| 16 | Voice/TTS + thu âm | hub AI relay + local synth + `MediaRecorder` → `saveRecording` | ✅ | ⚠️ (TTS API) | ⚠️ (chuẩn hoá audio) | 4 |
| 17 | Stock search / tải asset | stock proxy + HTTP(S) stream download | ✅ | ✅ (proxy) | ❌ | 7 |
| 18 | yt-dlp | chỉ resolve binary + updater, **không có lệnh tải nào trong repo** | — | — | — | 6 (Local Agent) |
| 19 | Factory / batch export | queue Job → cùng compiler | ✅ | ⚠️ (1 job/lúc) | **bắt buộc** | 8 |
| 20 | MCP renderer bridge | `useMcpRendererBridge` → IPC | ✅ | ❌ | ⚠️ | 6 |

⚠️ = có nhưng giới hạn theo runtime; mọi ô "FFmpeg bắt buộc" là nợ kỹ thuật mà V4 Phase 5 (WebCodecs) phải trả.

---

## 4. Đóng băng contract Project (schema specification)

### 4.1 Model app — `TmcutProject`

Khai báo tại [useTmcutProject.ts:177](file:///D:/Applications/tm-studio/app/composables/useTmcutProject.ts#L177).

| Trường | Kiểu | Đơn vị / quy ước |
|---|---|---|
| `id`, `name`, `cover` | string | `cover` là data/path của ảnh bìa |
| `durationMs` | number | **ms**, chỉ để hiển thị danh sách; độ dài thật tính từ clip |
| `canvas` | `TmcutCanvas` | `width/height` px, `fps` là `FrameRate` hữu tỉ, `aspectRatio`, `background` |
| `timeline.version` | number | hiện `1` cho project mới, chỉ là nhãn cũ; **không** phải DSL version |
| `timeline.durationMs` | number | ms, phần đệm ruler — **không** phải nội dung |
| `timeline.tracks[]` | `TmcutTrack` | `type` ∈ video/text/audio; `volume` 0–100, `pan` −100..100 |
| `timeline.markers[]` | `{id, at, label?, color?}` | `at` **ticks** |
| `items[].in/out/offset` | number | **ticks** (C16-R3) — đọc qua `~/utils/tmcut/clipTime` |
| `items[].speed` | number | hệ số, `> 0` |
| `items[].opacity/scale/volume` | number | **phần trăm** 0–100 (di sản v1) |
| `items[].x/y/rotation` | number | x/y là **px canvas**; rotation độ |
| `items[].fade`, `keyframes[].t`, `transitionIn.duration` | number | **ticks** |
| `items[].keyframes[].easing` | enum | linear / ease-in / ease-out / ease-in-out / step |
| `settings` | `{resolution, fps, format, bitrate}` | bitrate bps |
| `schemaVersion` | number | hiện **3**; vắng mặt = file cũ |
| `revision` | number | bộ đếm ghi, chỉ tăng khi save; dùng phát hiện ghi đè ngoài phiên |
| `source`, `created_at`, `updated_at`, `lastOpenedAt`, `pinned` | — | metadata UI |

### 4.2 Model core — Timeline DSL v3

Khai báo tại [dsl.ts](file:///D:/Applications/tm-studio/packages/core/types/dsl.ts). Khác biệt có chủ đích với model app:

| Khía cạnh | App model | DSL v3 |
|---|---|---|
| Vị trí clip | phẳng `in/out/offset` | lồng `source.{in,out}`, `timeline.{start,duration}` |
| Đơn vị | ticks (sau C16-R3) | ticks |
| Tỉ lệ khung hình | `FrameRate` hữu tỉ | `FrameRate` hữu tỉ |
| Thư viện media | `src` path/URL trực tiếp | `assetId` + `locator {runtime, path}` (cầu chuyển tiếp) |
| Transform | `x/y/scale/opacity/rotation` phần trăm | `transform {x,y,scaleX,scaleY,rotation,opacity}` chuẩn hoá 0..1 |
| Nhãn version | `schemaVersion: 3` | `version: 3` (literal) |
| Markers | optional trên timeline | bắt buộc `markers[]` |

**Ranh giới chuyển đổi:** [`toRenderClip`](file:///D:/Applications/tm-studio/app/utils/tmcut/render/clip.ts#L6) là **điểm decode duy nhất**: ticks → `inSec/outSec/offsetSec` cho FFmpeg, giữ `durationTicks` nguyên cho builder âm thanh v3. Mọi builder hạ nguồn nhận `RenderClip`, không nhận item thô.

### 4.3 Chuỗi migration

| Từ | Sang | Quy tắc | Test |
|---|---|---|---|
| v1 (fps số thực, seconds) | v2 (FPS hữu tỉ) | `fpsToRational` | core `v1compat.test.mjs` |
| v2 (items seconds) | v3 (items ticks) | `applyProjectMigration` ([useTmcutProject.ts:327](file:///D:/Applications/tm-studio/app/composables/useTmcutProject.ts#L327)) scale **một lần**, oracle là `schemaVersion` — không đoán theo độ lớn | [tmcut_store_behaviour.spec.ts:212](file:///D:/Applications/tm-studio/tests/unit/tmcut_store_behaviour.spec.ts#L212), [tmcut_time_domain.spec.ts:110](file:///D:/Applications/tm-studio/tests/unit/tmcut_time_domain.spec.ts#L110) |
| v3 | v3 | mở lại không scale lần hai; file được stamp lại `schemaVersion: 3` | cùng spec, dòng 209 |

### 4.4 Lưu trữ & đồng bộ

- **localStorage** `tmcut_project_<id>` là bản mirror để web sống sót reload ([saveProject:615](file:///D:/Applications/tm-studio/app/composables/useTmcutProject.ts#L615)).
- **Electron**: JSON file qua `tmcut:writeProject` ([tmcut.controller.cjs:996](file:///D:/Applications/tm-studio/electron/tools/tmcut.controller.cjs#L996)), kèm recovery file, snapshot theo `ts`, và `revision` chống ghi đè.
- **Export queue**: `tmcut:export-queue` trong localStorage, tối đa 50 job ([useTmcutExportQueue.ts:12](file:///D:/Applications/tm-studio/app/composables/useTmcutExportQueue.ts#L12)).
- **Web không có IPC**: mọi thứ phải đi qua localStorage + Nitro API; đây là lý do contract project không được phép phụ thuộc Electron.

### 4.5 Contract đóng băng (không đổi trong V4 nếu không có ADR + migration)

1. `TICKS_PER_SECOND = 120_000`, ticks là `number` (JSON-safe).
2. `FrameRate` hữu tỉ; fps lưu dạng `{numerator, denominator}`.
3. Ý nghĩa đơn vị ở §4.1 — đặc biệt `opacity/scale/volume` là **phần trăm**, `x/y` là **px canvas**.
4. `schemaVersion` là oracle duy nhất của migration; cấm suy đoán theo độ lớn giá trị.
5. `toRenderClip` là cửa decode duy nhất app → render.
6. Khoá localStorage/queue giữ nguyên tên.

### 4.6 Được phép thay đổi (có test)

- Thêm trường optional (clip/track/project) với default = hành vi cũ.
- Thêm `assetId`/`locator` theo DSL (đã có kiểu, chưa dùng hết).
- Đổi renderer bên dưới `toRenderClip`, miễn đầu ra giữ nguyên ngữ nghĩa.
- Thêm loại hiệu ứng/transition vào registry (`fxCatalog` + core `effects`).

---

## 5. Khoảng trống so với V4

| # | Gap | Bằng chứng | Hệ quả |
|---|---|---|---|
| G1 | ~~Không có `renderAt(timestamp)` / timeline evaluator~~ **Đã xử lý ở M1 (2026-11-01)** | [evaluate.mjs](file:///D:/Applications/tm-studio/packages/core/src/evaluate.mjs) export `evaluateTimeline` + `evaluateClip`; source position đi qua cả speed ramp (`rampTimelineToSource`), text có `textAnimationAt`; `clipSpan` cho phép cả shape DSL v3 lẫn shape phẳng của app store; 35 test trong [evaluate.test.mjs](file:///D:/Applications/tm-studio/packages/core/test/evaluate.test.mjs) | Preview/export đã có một nguồn resolve chung; preview đọc evaluator cho layer/transition (M2 bước 3) |
| G2 | Preview ≠ export | preview CSS ([TmcutPreviewPlayer.vue:702](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L702)) vs `drawtext` ([text.ts:125](file:///D:/Applications/tm-studio/app/utils/tmcut/render/text.ts#L125)) | transform/opacity lấy từ `evaluateClip`, animation chữ in/out lấy từ `textAnimationAt`, chọn clip/crossfade từ `evaluateTimeline` (M2 bước 1–3); [tmcut_render_parity.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_render_parity.spec.ts) render FFmpeg thật và so pixel với geometry evaluator (scale/x/y/opacity + speed→source, M2 bước 4); font/shadow/mask vẫn do renderer riêng tính, golden chữ chưa có |
| G3 | ~~Không có interface Platform Adapter~~ **Contract đã có (M1), Electron cài đặt một phần (M1c, 2026-11-01)** | Trước M1 chỉ có `TmcutPreviewEngine` (2 capability, [useTmcutPreviewEngine.ts:26](file:///D:/Applications/tm-studio/app/composables/useTmcutPreviewEngine.ts#L26)). Nay [types/platform.ts](file:///D:/Applications/tm-studio/packages/core/types/platform.ts) định nghĩa `TmcutPlatformAdapter` (info/media/capture/encoder) và [html-video-renderer.cjs:109](file:///D:/Applications/tm-studio/electron/tools/html-video-renderer.cjs#L109) `openCaptureSession` + `createElectronPlatformCapture` là host đầu tiên implement `TmcutCaptureSession`/`TmcutPlatformCapture` | Host web chưa khai báo capture (browser tab không screenshot offscreen theo frame); `media`/`encoder` chưa wire vì consumer thật (`resolveMediaSrc` ở renderer, export queue) chưa đọc adapter |
| G4 | Export phụ thuộc FFmpeg ở cả 2 runtime | desktop spawn; web Nitro spawn | không chạy được trên Vercel serverless (Phase 7 chặn) |
| G5 | Hai model project | §4.1 vs §4.2 | nguy cơ trôi schema; cần chốt model nào là canonical |
| G6 | Hai stack HTML capture | Electron `capturePage` vs `playwright-core` | kết quả có thể lệch pixel giữa runtime. Từ M1c, phía Electron đi qua đúng một cửa ([html-video-renderer.cjs:109](file:///D:/Applications/tm-studio/electron/tools/html-video-renderer.cjs#L109) `openCaptureSession`), và loop render thật dùng cửa đó — nhưng M4 (một engine cho cả hai runtime, "cùng composition → cùng frame") vẫn chưa có bằng chứng |
| G7 | ~~Không có golden-frame test~~ **Đã xử lý (M2, 2026-11-01)** | [pixels.mjs](file:///D:/Applications/tm-studio/packages/core/src/pixels.mjs) `compareFrames` (MAE + tỉ lệ pixel lệch, ADR-016) + 7 test; [tmcut_golden_frame.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_golden_frame.spec.ts) render canvas bằng FFmpeg thật rồi so với PNG golden; [tmcut_render_parity.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_render_parity.spec.ts) render clip thật và kiểm pixel theo geometry/source mà `evaluateTimeline` trả | Còn golden có chữ cần font ghim (chưa có font đóng gói); chưa có frame preview để so DOM ↔ FFmpeg |
| G8 | Không có WebCodecs/muxer | `grep VideoEncoder/mediabunny` = 0 | Phase 5 làm mới hoàn toàn |
| G9 | Downloader (yt-dlp) chưa tồn tại trong repo | chỉ resolve binary + updater, không có lệnh tải | Phase 6 |
| G10 | `@tmcut-core` alias ≠ tên package (`tmcut-core`) | [nuxt.config.ts:21](file:///D:/Applications/tm-studio/nuxt.config.ts#L21) vs [packages/core/package.json](file:///D:/Applications/tm-studio/packages/core/package.json) | dễ nhầm khi publish/đóng gói |

**Chấm Phase 1 acceptance của V4 (đo hôm nay)**

| Tiêu chí | Kết quả | Ghi chú |
|---|---|---|
| Core chạy trong browser và Node test | **PASS** | alias trỏ source; 449/449 node tests (sau M2 bước 3) |
| Project serialize/deserialize không phụ thuộc Electron | **PASS** | localStorage + JSON thuần; IPC là optional |
| Timeline evaluation có unit tests | **PASS** | `evaluateTimeline` + 19 test thuần Node (M1); idempotent theo `t`, không đọc `Date.now()` |
| Migration project cũ có test | **PASS** | 2 spec app + `v1compat` core |

---

## 6. Kế hoạch migration V4 (đề xuất, cập nhật roadmap §15)

| Mốc | Nội dung | Deliverable | Gate |
|---|---|---|---|
| **M0 — Contract freeze** (xong) | Audit này + chốt §4.5 | `docs/v4-phase-0-audit.md` | Review xong; không đổi code |
| **M1 — Adapter + evaluator skeleton** (xong 2026-11-01) | `PlatformAdapter` (media/capture/encode) + `evaluateTimeline(timeline, t)` + `createClock` + `createPlatformInfo` | `evaluate.mjs`, `clock.mjs`, `platform.mjs`, `types/platform.ts` + 3 bộ test | evaluator idempotent theo `t`, không đọc `Date.now()` — **PASS**; host capture phía Electron đã implement ở M1c (2026-11-01), còn `media`/`encoder` và host web |
| **M2 — DOM renderer dùng evaluator** (đang làm 2026-11-01) | Preview đọc layer từ evaluator thay vì tự tính CSS; export FFmpeg vẫn nguyên. Bước 1–4 xong: `evaluateClip` là nguồn duy nhất cho transform/opacity mỗi clip ([TmcutPreviewPlayer.vue:702](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L702)), `textAnimationAt` cho animation chữ in/out ([TmcutPreviewPlayer.vue:866](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L866)), và `evaluateTimeline` chọn clip đang phát + cặp crossfade ([useTmcutPlayback.ts](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts)); bước 4 thêm [tmcut_render_parity.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_render_parity.spec.ts) khoá export FFmpeg vào geometry/source của evaluator | preview giữ pixel tương đương hiện tại | `compareFrames` + golden PNG (canvas) + render-parity transform/speed (bước 4) đã có; evaluator nhận cả shape phẳng của app; capture host Electron đã có (M1c); còn golden chữ (font ghim), wire `media`/`encoder` + host web vào adapter, `activeTextClips` qua evaluator, và QA trực quan sâu hơn `/tmcut/editor` |
| **M3 — Chuyển transform/mask/transition sang model chung** | `toRenderClip` trả layer trung gian; builder FFmpeg và DOM cùng đọc | một nguồn nghĩa | so ảnh preview vs frame FFmpeg với tolerance |
| **M4 — Hợp nhất HTML capture** | Một engine capture (chọn `playwright-core` hoặc WebContents) cho cả hai runtime | 1 contract, 2 transport | cùng composition → cùng hash frame |
| **M5 — WebCodecs export (song song FFmpeg)** | Encoder + muxer cho mp4/webm ở web | feature flag `renderer: 'webcodecs' \| 'ffmpeg'` | bitrate/quality report; fallback FFmpeg |
| **M6 — Local Agent/downloader** | Tách yt-dlp ra agent có kiểm soát (Phase 6 blueprint) | API + permission model | không mở quyền ngoài thư mục cho phép |

Nguyên tắc xuyên suốt: **mỗi mốc phải giữ hành vi người dùng hiện tại** (D2 lift & shift), và không mốc nào được đổi §4.5 nếu không có ADR + test migration.

---

## 7. Quyết định cần chốt trước khi code Phase 1

| ID | Câu hỏi | Đề xuất |
|---|---|---|
| ADR-013 | Model nào là canonical cho V4? | **DSL v3 trong `@tmcut-core`** là canonical; app model là view + migration. `toRenderClip` đổi chiều thành `fromAppModel` một lần khi load. |
| ADR-014 | Tên & phạm vi `PlatformAdapter` | 4 nhóm: `MediaSource` (decode/proxy), `Capture` (frame), `Encoder` (mux), `Clock` (tick→frame). Không gộp UI. |
| ADR-015 | FFmpeg giữ vai trò gì? | Giữ làm backend "compat" desktop + server; WebCodecs là backend web mặc định khi đủ codec. Cả hai sau cùng một `Encoder` interface. |
| ADR-016 | Golden-frame lưu ở đâu? | PNG nhỏ (≤ 512×288) trong `tests/fixtures/golden/`, so bằng sai số trung bình + ngưỡng pixel lệch; không so hash tuyệt đối. |
| ADR-017 | Đồng bộ package name | Đổi alias `@tmcut-core` → package `tmcut-core`, hoặc đổi tên package; chọn một, ghi vào Phase 1. |

---

## 8. Phụ lục — số liệu đo được

| Hạng mục | Giá trị | Cách đo |
|---|---|---|
| `packages/core/src` | 50 file `.mjs` (+ `index.d.ts`) | `ls packages/core/src \| wc -l` |
| Core test | **449 pass / 0 fail / 60 suite / 39 file** | `node --test "test/*.test.mjs"` trong `packages/core` |
| Unit app | 76 spec file, **73 spec chạy** (3 smoke opt-in) | `npx tsx tests/unit/run-all.mts` |
| Electron tools test | **70 pass / 0 fail / 5 file** | `node --test "electron/tools/*.test.mjs"` |
| Render compiler | 8 module | `ls app/utils/tmcut/render` |
| Trang TMCut | 8 | `ls app/pages/tmcut` |
| Component TMCut | 47 | `ls app/components/tmcut` |
| IPC ffmpeg | 30 handler | `grep -c ipcMain.handle electron/tools/ffmpeg.controller.cjs` |
| IPC tmcut | 38 handler | `grep -c ipcMain.handle electron/tools/tmcut.controller.cjs` |
| Endpoint media/stock/process | 12 route | `server/api/v1/{media,stock,process}` |
| Giới hạn HTML video | ≤3840×3840, 1–60 fps, ≤120 s, ≤3600 frame | [htmlVideo.mjs:16](file:///D:/Applications/tm-studio/packages/core/src/htmlVideo.mjs#L16) |
| Giới hạn web render | 400 args, 20000 ký tự/arg, 20 phút | [render.post.ts:55](file:///D:/Applications/tm-studio/server/api/v1/media/render.post.ts#L55) |
