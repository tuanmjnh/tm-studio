# Audit Zero-FFmpeg / Zero-FFprobe — Phase 0 của kiến trúc browser-first

**Trạng thái: COMPLETE (audit). Chưa sửa code nào.**

Tài liệu này là deliverable bắt buộc của Phase 0 trong
[docs/tmcut-zero-ffmpeg-zero-ffprobe-browser-first-roadmap.md](file:///D:/Applications/tm-studio/docs/tmcut-zero-ffmpeg-zero-ffprobe-browser-first-roadmap.md):
mục 0.2 ("Tạo `docs/audit/zero-ffmpeg-audit.md`", "Ghi lại build/test baseline trước khi sửa")
và mục 19 Phase 0 ("Exit: không còn khu vực FFmpeg/FFprobe chưa phân loại").

Mọi con số dưới đây đo từ working tree ở commit `92a4818` ngày **2026-11-03**, bằng đúng lệnh ghi ở §1.
Không có số nào chép từ tài liệu cũ, và không có API nào nêu ở §6 mà chưa đọc tài liệu gốc của nó.

---

## 1. Cách đo (tái hiện được)

```bash
cd /d/Applications/tm-studio
git rev-parse --short HEAD
grep -rliE "ffmpeg|ffprobe" app server shared electron packages/core/src packages/core/types \
  packages/core/test tests i18n docs | wc -l
npx tsx tests/unit/run-all.mts
```

| Metric | Giá trị đo được |
|---|---|
| Commit baseline | `92a4818` |
| File khớp `ffmpeg\|ffprobe` (cả repo, tính docs + i18n) | **124** |
| Bỏ docs + i18n, chỉ code và test | **114** |
| Binary trong `resources/` | **494.514.688 byte** (≈471 MiB), 3 file |
| Unit suite (non-smoke) | **90/92 specs passed** |
| Spec FAIL có sẵn | `tmcut_login_remember` (working-tree chủ repo), `tmcut_process` (Node v24) |
| `error TS` của typecheck ở baseline | chưa chạy lại — xem §8 slice A |

Hai FAIL không do slice nào gây ra và nằm ngoài phạm vi audit:
`app/pages/login.vue` trong working tree lại ghi `state.password = data.password \|\| ''` (regression chủ repo đã được báo cáo),
còn `tmcut_process` fail vì `ERR_PACKAGE_IMPORT_NOT_DEFINED "#shared/utils/processStore"` trên Node v24.

---

## 2. Footprint: FFmpeg nằm ở đâu, dưới hình dạng nào

### 2.1 Binary và packaging

- Ba binary `resources/ffmpeg.exe` (164.232.192 B), `ffplay.exe` (166.259.712 B), `ffprobe.exe` (164.022.784 B).
  Chúng **không** nằm trong git — [.gitignore:39](file:///D:/Applications/tm-studio/.gitignore#L39) loại cả ba.
- Nhưng [electron-builder.yml:32](file:///D:/Applications/tm-studio/electron-builder.yml#L32) khai
  `extraResources: from resources` → mọi package desktop vẫn mang theo toàn bộ 471 MiB.
- [electron/tools/updater.cjs](file:///D:/Applications/tm-studio/electron/tools/updater.cjs) tải FFmpeg từ gyan.dev lúc chạy:
  đây chính là "spawn/exec binary media tool" và "download media tool" mà rule 2 và DoD §25 cấm.

### 2.2 Code, theo kích thước thật

| Khối | Dòng | Vai trò |
|---|---|---|
| [app/utils/ffmpegHelper.ts](file:///D:/Applications/tm-studio/app/utils/ffmpegHelper.ts) | 1305 | argv + parse |
| [electron/tools/ffmpeg.controller.cjs](file:///D:/Applications/tm-studio/electron/tools/ffmpeg.controller.cjs) | 1597 | spawn, progress, encoder args |
| [app/utils/tmcut/render/](file:///D:/Applications/tm-studio/app/utils/tmcut/render/index.ts) + compiler | 1790 | filtergraph của timeline export |
| [server/utils/htmlVideoRender.ts](file:///D:/Applications/tm-studio/server/utils/htmlVideoRender.ts) | 279 | Playwright capture + encode |
| [server/api/v1/media/render.post.ts](file:///D:/Applications/tm-studio/server/api/v1/media/render.post.ts) | 169 | export route |
| [server/api/v1/media/proxy.post.ts](file:///D:/Applications/tm-studio/server/api/v1/media/proxy.post.ts) | 145 | proxy 540p |
| [server/api/v1/media/analyze.post.ts](file:///D:/Applications/tm-studio/server/api/v1/media/analyze.post.ts) | 115 | ffprobe + thumbnail + waveform |
| [server/utils/renderJobs.ts](file:///D:/Applications/tm-studio/server/utils/renderJobs.ts) | 110 | job store |

### 2.3 Surface nằm ngoài code (thường bị quên khi "gỡ FFmpeg")

- **IPC**: [electron/preload.cjs:59](file:///D:/Applications/tm-studio/electron/preload.cjs#L59) expose namespace `tools:ffmpeg`
  với **10** tên kênh; [electron/ipcPolicy.cjs:45](file:///D:/Applications/tm-studio/electron/ipcPolicy.cjs#L45) sinh allow-list
  `tools:ffmpeg:${n}` từ `TASK_EVENT_NAMES`.
- **Database**: 3 bảng trong [electron/tools/sqlite.cjs](file:///D:/Applications/tm-studio/electron/tools/sqlite.cjs#L186) —
  `ffmpeg_configs` (dòng 186), `ffmpeg_batch_configs` (225), `ffmpeg_history` (235) — cộng các migration `tryAddHistoryCol`.
- **Shared types**: [shared/types/electron.ts](file:///D:/Applications/tm-studio/shared/types/electron.ts#L65) định nghĩa
  `FfmpegLabel`, `FfmpegSubFile`, `FfmpegRenderResponse`, `FfmpegConfig`, `FfmpegBatchConfig(Item)`, `FfmpegHistory`,
  `FfmpegVersions` và **10** method CRUD của `ToolsNamespace` (đo: `grep -cE "^  (list|create|update|delete)Ffmpeg"`).
- **i18n**: **9 key × 2 locale** (dòng 733, 886, 887, 888, 903, 967, 1007, 1249, 1311 của `en.json`/`vi.json`) —
  toàn bộ là text mô tả tính năng, chỉ sửa được **sau** khi engine thay thế xong, không trước.
- **Test**: 26 file `tests/unit` + 1 file `tests/e2e` + 3/44 file `packages/core/test` khớp từ khóa.
- **UI**: export modal, inspector (hint "export runs the exact FFmpeg chain"), media panel, timeline, preview player,
  autocut page, MCP bridge ([app/composables/useMcpRendererBridge.ts:173](file:///D:/Applications/tm-studio/app/composables/useMcpRendererBridge.ts#L173)
  phát `command: 'ffmpeg'`), task manager (`ToolKind = 'youtube' \| 'ffmpeg'`).

---

## 3. Phân loại chức năng (mục 0.2 của plan yêu cầu đúng bảng này)

| # | Nhóm | Hiện FFmpeg làm gì | Plan §18.2 nói thay bằng | Đã có thay thế chưa |
|---|---|---|---|---|
| 1 | Probe | `ffprobe -show_format -show_streams` → `normalizeProbe` | MediaProbeService + Mediabunny | **Chưa** — Mediabunny chưa nằm trong dependency |
| 2 | Export encode+mux | filtergraph → `libx264`/AAC → MP4 | WebCodecs + Mediabunny muxer | **Chưa** — repo có 0 `VideoEncoder` |
| 3 | Thumbnail/filmstrip | `extractFrame` IPC, seek `-ss` | Mediabunny + WebCodecs/Canvas | **Một nửa** — maths tick list đã ở core, extraction thì không |
| 4 | Proxy 540p | `buildProxyArgs` + route | Proxy chỉ "tùy chọn" (§5) | **Bỏ được sớm**, không cần thay |
| 5 | Scene + silence | scene detect, `silencedetect`, parse stderr | Decoder tự tính | **Chưa** — Autocut desktop-only |
| 6 | HTML-video export | Playwright screenshot + `ffmpeg -c:v libx264` | §9 cấm screenshot DOM làm export tổng quát | **Mâu thuẫn thiết kế**, cần ADR |
| 7 | Stabilization | 2-pass `vidstabdetect`/`vidstabtransform` | (plan không đề cập) | **Không có** tương đương WebCodecs |
| 8 | Effect grade | 20 preset → chuỗi `colorbalance`/`pixelize`/`lut3d` | §8 "Color effects cơ bản" qua GPU | **Chưa** — cần shader |
| 9 | Waveform | PCM qua `extractAudio` → JSON cache | Web Audio decode + worker | **Chưa** — repo có 0 dòng Web Audio |
| 10 | Desktop tools task | namespace `tools:ffmpeg`, 3 bảng DB | §14: Electron không có media engine riêng | **Bỏ được**, là tính năng tm-tools |

Kết luận §3: 4/10 nhóm (proxy, desktop tools, một phần thumbnail, một phần waveform-cache) bỏ được mà không cần thay thế ngay;
6/10 nhóm (probe, export, analysis, grade, stabilize, HTML-video) **bắt buộc có thay thế + test trước khi xóa**, đúng rule 11 của plan.

---

## 4. Cái đã khớp kiến trúc mới — không được viết lại

Plan §2 vẽ 8 layer. Repo đã có sẵn phần xương sống của 4 layer, đo cụ thể như sau.

| Layer plan yêu cầu | Đã có ở đâu | Bằng chứng |
|---|---|---|
| Timeline Core (time model) | [packages/core/src/time.mjs](file:///D:/Applications/tm-studio/packages/core/src/time.mjs), [clock.mjs](file:///D:/Applications/tm-studio/packages/core/src/clock.mjs) | integer ticks `TICKS_PER_SECOND = 120000`, `fpsToRational`, `createClock` với `frameStarts`/`durationFrames` — khớp §7 "chọn một internal time unit, rational frame rate" |
| Timeline Core (evaluator) | [packages/core/src/evaluate.mjs](file:///D:/Applications/tm-studio/packages/core/src/evaluate.mjs) | pure function, không DOM/clock/filesystem; ADR-018 half-open — khớp §7 |
| Export Core (scheduler) | [packages/core/src/scheduler.mjs](file:///D:/Applications/tm-studio/packages/core/src/scheduler.mjs), [renderAt.mjs](file:///D:/Applications/tm-studio/packages/core/src/renderAt.mjs) | timestamp suy từ frame index + rational fps, không `setTimeout` — khớp §12 "Frame scheduler deterministic" |
| Rendering semantics (stack) | [packages/core/src/paintStack.mjs](file:///D:/Applications/tm-studio/packages/core/src/paintStack.mjs) | `selectPaintRows` trả `{rows, base}` một lần cho mọi host — khớp §9 "composition graph độc lập renderer" |
| Platform Adapter | [packages/core/types/platform.ts:47](file:///D:/Applications/tm-studio/packages/core/types/platform.ts#L47), [platform.mjs](file:///D:/Applications/tm-studio/packages/core/src/platform.mjs) | `TmcutPlatformAdapter {info, media, capture, encoder}` + capability flags — đúng hình §16 |
| Project Core | [packages/core/src/project.mjs](file:///D:/Applications/tm-studio/packages/core/src/project.mjs), [v1compat.mjs](file:///D:/Applications/tm-studio/packages/core/src/v1compat.mjs) | `schemaVersion` + migration v1→v3 lossless, fixture test — khớp §6 và rule 12 |
| Audio maths | [audio.mjs](file:///D:/Applications/tm-studio/packages/core/src/audio.mjs), [waveform.mjs](file:///D:/Applications/tm-studio/packages/core/src/waveform.mjs) | `gainAt`, fade envelope, `int16ToPeaks` — dùng lại được cho Web Audio |
| Text style law | [textStyle.mjs](file:///D:/Applications/tm-studio/packages/core/src/textStyle.mjs) | một nguồn sự thật cho size/colour/stroke/shadow — §13 subtitle burn-in cần đúng cái này |

và một điểm hay bị hiểu nhầm: `MediaRecorder` trong repo **không** vi phạm plan.
Nó chỉ dùng cho voiceover realtime ([useTmcutRecorder.ts:77](file:///D:/Applications/tm-studio/app/composables/useTmcutRecorder.ts#L77),
mic capture trong media panel), tức là trường hợp mà §12 cho phép ("Có thể dùng cho realtime recording riêng"),
không phải offline export.

---

## 5. Cái trái kiến trúc mới

### 5.1 Phát hiện quan trọng nhất: core **phát hành cú pháp FFmpeg** như API công khai

Plan §2.1 cấm Media/Core gọi CLI và §16 bắt core không import runtime; DoD §25 yêu cầu không còn FFmpeg trong config/IPC.
Thực tế core không spawn, nhưng **in ra chuỗi FFmpeg** — nghĩa là mọi luật render hiện có hai bản: một bản semantics (dùng cho DOM)
và một bản văn bản FFmpeg (dùng cho export). Bản thứ hai phải bị xóa, và ở một số nơi nó là **bản duy nhất**.

| Module | Export phát hành văn bản FFmpeg | Hệ quả khi xóa |
|---|---|---|
| [canvas.mjs:286](file:///D:/Applications/tm-studio/packages/core/src/canvas.mjs#L286) | `buildFfmpegFitFilters`, và `buildFfmpegTransform` (373), `stillImageInputFlags` (45), `buildBackgroundSource` (103) | Fit/crop/rotate vẫn còn `computeFitObjectStyle` cho DOM; background/still input không còn nguồn nào khác |
| [mask.mjs:65](file:///D:/Applications/tm-studio/packages/core/src/mask.mjs#L65) | `maskAlphaExpr` — biểu thức `geq` alpha per-pixel | Luật mask chỉ tồn tại dưới dạng `geq`; phải viết lại thành shader/destination-out |
| [audio.mjs:68](file:///D:/Applications/tm-studio/packages/core/src/audio.mjs#L68) | Biểu thức fade theo `t` + filter `stereotools` | Còn `gainAt` (số học) để Web Audio dùng; phần filter string bỏ |
| [keyframes.mjs:143](file:///D:/Applications/tm-studio/packages/core/src/keyframes.mjs#L143) | FFmpeg math expression cho property theo thời gian | Cần bản "evaluate at tick" cho renderer (interpolation đã có) |
| [retime.mjs:380](file:///D:/Applications/tm-studio/packages/core/src/retime.mjs#L380) | Biểu thức `setpts` cho speed curve phi tuyến | Source-time mapping phải tự tính từ cùng curve — đã có `sourceTicks` trong evaluate |
| [effects.mjs:83](file:///D:/Applications/tm-studio/packages/core/src/effects.mjs#L83) | Bảng 20 preset → chuỗi grade, `lut3d` chain | §8 "Color effects cơ bản" cần shader tương ứng |
| [textStyle.mjs:6](file:///D:/Applications/tm-studio/packages/core/src/textStyle.mjs#L6) | Song song CSS và `drawtext` options | Giữ CSS, bỏ `drawtext` |
| [transitions.mjs:170](file:///D:/Applications/tm-studio/packages/core/src/transitions.mjs#L170) | `FFMPEG_XFADE_NAMES` + hình học đo từ binary | **Semantics giữ được** (window, progress, vùng), spelling bỏ |
| [probe.mjs:32](file:///D:/Applications/tm-studio/packages/core/src/probe.mjs#L32) | `normalizeProbe` theo shape JSON của ffprobe | MediaInfo schema §4.1 rộng hơn nhiều → viết contract mới |
| [stabilize.mjs:76](file:///D:/Applications/tm-studio/packages/core/src/stabilize.mjs#L76) | argv 2-pass vidstab | Không có thay thế → tính năng phải khai tử (xem §10) |
| [cache.mjs:52](file:///D:/Applications/tm-studio/packages/core/src/cache.mjs#L52) | `buildProxyArgs` | Bỏ được, proxy là optional |
| [analysis.mjs:4](file:///D:/Applications/tm-studio/packages/core/src/analysis.mjs#L4) | Parse stderr FFmpeg | Autocut mất đầu vào; cần decoder-side scene/silence |
| [platform.mjs:18](file:///D:/Applications/tm-studio/packages/core/src/platform.mjs#L18) | Capability flag `nativeFFmpeg` | Xóa flag khi engine gone; **đây là flag duy nhất cần giữ lại là `webCodecs`** |
| [crashRecovery.mjs:159](file:///D:/Applications/tm-studio/packages/core/src/crashRecovery.mjs#L159) | Health check `{name:'ffmpeg'}` | Thay bằng check WebCodecs/muxer capability |

Đây là **14 module**. Con số này giải thích vì sao "bỏ FFmpeg" không phải một PR xóa file: nó là một cuộc đổi phát ngôn của core.

### 5.2 Probe web không dám nói sự thật về FPS

[app/utils/tmcut/webProbe.ts:48](file:///D:/Applications/tm-studio/app/utils/tmcut/webProbe.ts#L48) trả `fps: 0`
và suy `hasAudio` từ "không có video track". Plan §4.1 bắt trường không đọc được là `undefined` kèm warning, §4.3 cấm mặc định 30 FPS.
Hiện code dùng `0` làm sentinel, tức là phân biệt "không biết" bằng một con số có vẻ hợp lệ — đúng cái plan cấm.

### 5.3 Hai tài liệu roadmap đang mâu thuẫn trực tiếp

Roadmap V4 cho phép FFmpeg ở lại với tư cách backend tùy chọn; plan mới cấm tuyệt đối.

| Dòng trong V4 roadmap | Nội dung | Mâu thuẫn với |
|---|---|---|
| 22 | FFmpeg là "Native Media Backend tùy chọn" | Rule 1, 3 |
| 70 | `yt-dlp · Optional FFmpeg · Native tools` | Rule 2, §15 |
| 589 | `Native fallback \| Optional FFmpeg backend` | Rule 3 |
| 867 | "Native FFmpeg khi cần" | Rule 3 |
| 937 | "Optional FFmpeg chỉ được gọi khi backend chính không đáp ứng" | Rule 3 — đây chính là fallback |
| 1354 | Phase 6 "Optional FFmpeg adapter" | §14 Electron không có media engine riêng |

Sáu dòng đó chỉ là **phần prose**. Phần đã được *quyết* nặng hơn, và audit này tìm ra đúng hai ADR đang giữ FFmpeg:

| ADR | Ở đâu | Nội dung đã duyệt | Số phận theo plan mới |
|---|---|---|---|
| ADR-006 | [docs/tmcut-v4-universal-rendering-multiplatform-roadmap.md:1501](file:///D:/Applications/tm-studio/docs/tmcut-v4-universal-rendering-multiplatform-roadmap.md#L1501) | "FFmpeg optional backend — giữ khả năng tương thích native khi cần" | **Bị supersede** — rule 1 và 3 không cho tồn tại backend tùy chọn |
| ADR-015 | [docs/v4-phase-0-audit.md:235](file:///D:/Applications/tm-studio/docs/v4-phase-0-audit.md#L235) | "Giữ làm backend 'compat' desktop + server; WebCodecs là backend web mặc định khi đủ codec" | **Bị supersede** — và đây là ADR đã được *áp dụng vào code*, nên xóa FFmpeg mà không ghi lệnh supersede thì lịch sử quyết định sẽ nói code đang sai |

Hệ quả thực tế: slice A phải tạo **một ADR supersede đàng hoàng** (đánh số 028) nêu rõ ADR-006 và ADR-015 không còn hiệu lực,
chứ không chỉ sửa 6 dòng prose.

Phải xử lý một trong hai hướng (xem §10 quyết định 4): hoặc sửa 6 dòng đó theo plan mới, hoặc archive V4 roadmap và lấy plan mới làm nguồn sự thật.

### 5.4 Ba điểm chính plan mới cần sửa trước khi giao cho agent khác

- §27 dẫn `docs/roadmap/zero-ffmpeg-zero-ffprobe-browser-first.md` — đường dẫn **không tồn tại**;
  file thật là [docs/tmcut-zero-ffmpeg-zero-ffprobe-browser-first-roadmap.md](file:///D:/Applications/tm-studio/docs/tmcut-zero-ffmpeg-zero-ffprobe-browser-first-roadmap.md) (dòng 1046).
- §26 đánh số ADR-001…006, nhưng repo đã dùng **hai gia đình số** cho cùng khoảng đó:
  roadmap §18 định nghĩa ADR-001…ADR-012 (ADR-001 = "Shared Project/Timeline Core", ADR-005 = "WebCodecs + muxer", ADR-006 = "FFmpeg optional backend"),
  còn [docs/v4-phase-0-audit.md:233](file:///D:/Applications/tm-studio/docs/v4-phase-0-audit.md#L233) mở đầu dãy ADR-013…ADR-027.
  Đo: `grep -rho "ADR-[0-9]\+" docs/*.md \| sort -u` cho **27** nhãn. Six ADR mới phải mang số **028…033**; nếu giữ số của plan,
  ADR-001 "Zero FFmpeg" sẽ đá trực tiếp lên ADR-001 "Shared Project/Timeline Core" đang được source code cite.
- §4.1 và §7 định nghĩa `TMCutProject { schemaVersion, tracks, sequences }` — repo đang lưu
  `version: 3` và `timeline.tracks` flat ([useTmcutProject.ts:313](file:///D:/Applications/tm-studio/app/composables/useTmcutProject.ts#L313)
  đặt `schemaVersion: TMCUT_PROJECT_SCHEMA_VERSION`, `project.mjs:43` đặt `version: 3`).
  Hai hình dạng này **không** tương thích một-một; cần một ADR migration riêng, không phải một field đổi tên.

---

## 6. Dependency: đã xác minh hôm nay, chưa cài

Đo bằng `grep` trên `packages/core` và `app|server|electron`:

| Capability plan cần | Số hit trong repo |
|---|---|
| `mediabunny` | **0** |
| `VideoEncoder` / `VideoDecoder` / `isConfigSupported` | **0** |
| `OfflineAudioContext` / `AudioContext` / `decodeAudioData` | **0** |
| `OffscreenCanvas` / OPFS | **0** |
| `WebGL2` class | **0**; chuỗi `'webgl2'` chỉ xuất hiện 1 lần như capability sniff ở crashRecovery |
| `MediaRecorder` | 3 file, tất cả là voiceover/mic realtime (hợp lệ) |
| `IndexedDB` | 5 file, tất cả là xóa storage hệ thống, không phải media cache |

Nghĩa là: **không tồn tại đường export nào không cần FFmpeg trong repo hôm nay.** Đây là sự thật định hình thứ tự migration (§8).

Metadata đã xác minh ngày 2026-11-03:

- `mediabunny` **1.65.1**, license **MPL-2.0**, runtime dependency chỉ là `@types/dom-webcodecs` và `@types/dom-mediacapture-transform`.
  API đọc (từ docs chính thức): `new Input({ formats, source })`, nguồn `BlobSource` / `UrlSource` / `BufferSource` /
  `FilePathSource` / `ReadableStreamSource`, `input.getFormat()`, `input.computeDuration()`, `track.getCodec()`,
  `videoTrack.getDisplayWidth()`, `videoTrack.computeFrameRateMetrics()`.
  API ghi: `new Output({ format, target })`, `Mp4OutputFormat`, `WebMOutputFormat`, target `BufferTarget` / `StreamTarget` /
  `FilePathTarget`, `addVideoTrack`, `addAudioTrack`, `mediaSource.add()`, `await output.finalize()`. Đơn vị thời gian: giây.
  Formats đọc/ghi: MP4, MOV, MKV, WebM, OGG, MP3, WAV, AAC, FLAC, TS, HLS; codec H.264, HEVC, VP8/VP9, AV1, ProRes, AAC, Opus,
  MP3, Vorbis, FLAC, AC-3, EAC-3, DTS, TrueHD, PCM, WebVTT.
- `mp4-muxer` **5.2.2**, MIT — phương án muxer dự phòng nếu muxer của Mediabunny không phủ tổ hợp codec đã chốt.
- License MPL-2.0 là **file-level copyleft**, không传染 sang app code, nhưng phải ghi trong NOTICE khi phát hành thương mại (plan §22 yêu cầu kiểm license).
- Rule 13 của plan có hiệu lực: chữ ký ở trên phải **verify lại bằng file `.d.ts` của version thực cài** trước khi viết code, không viết từ trí nhớ.

---

## 7. Test hiện tại chứng minh điều gì — và cái gì chết cùng engine

Nhóm A — **witness FFmpeg** (assertion là chuỗi filtergraph hoặc pixel do FFmpeg render; phải viết lại thành behavior test, không sửa cho xanh):
`tmcut_render_graph` (23 checks), `tmcut_render_parity` (14), `tmcut_export_paint_stack`, `tmcut_export_track_parity`,
`tmcut_export_gap_placement`, `tmcut_footage_row_rule` (chiều export), `tmcut_golden_frame`, `tmcut_text_pixel`,
`tmcut_svg_still`, `tmcut_fx_catalog`, `tmcut_detect_smoke`, `tmcut_render_smoke` (smoke), `tmcut_platform_adapter` (12),
`packages/core/test/canvas.test.mjs`, `assets-probe-cache.test.mjs`, `htmlVideo.test.mjs`.

Nhóm B — **luật thuần, sống sót nguyên vẹn**: `tmcut_paint_stack` (6 checks: equivalence + preview + stack order),
`tmcut_frame_scheduler`, `tmcut_time_domain` (7), `tmcut_shared_model`, `tmcut_text_style`, `tmcut_transition_preview`,
`tmcut_preview_boundary`, `tmcut_playback_duration` (9), `tmcut_retime`/`keyframes`/`evaluate` của core.

Nhóm C — **phải tồn tại trước khi nhóm A bị xóa** (theo rule 11), tương ứng §21 của plan:
probe normalization (MP4/MOV/WebM/MKV + file hỏng), round-trip encode→mux→decode, visual regression dung sai cho
crop/rotate/flip/anchor/text, cancel export, timestamp determinism, memory/GPU budget.

Ghi chú phương pháp: plan §18.2 nói "tạo behavior tests thay vì đòi output byte-identical" — nhưng repo đang có hai gate
pixel (`tmcut_text_pixel`, `tmcut_golden_frame`) so với **FFmpeg thật**. Khi engine đổi, baseline của chúng phải đổi theo
và đổi công khai (kèm ADR + số frame đã đo), không được âm thầm nới tolerance cho xanh.

---

## 8. Migration plan — Phase của plan → slice của repo

Nguyên tắc: **build-then-cut** (rule 11 thắng). Không slice nào xóa một tính năng đang chạy trước khi slice đó có test xanh.
Mỗi slice chạy 5 gate (`tmcut-verify-gate-pipeline`) rồi commit + push, như quy trình đang áp dụng từ slice #82.

| Slice | Việc | File chính | Exit gate | Phụ thuộc |
|---|---|---|---|---|
| A | Chốt kiến trúc: ADR-028…033, sửa 6 dòng fallback của V4 roadmap, lưu baseline | `docs/`, ADR mới | typecheck 0/0 `error TS`; suite ≥90/92 như baseline; doc guards xanh | — |
| B | `MediaProbeService` + Mediabunny cho **cả hai host**, trả schema §4.1 (undefined + warnings, không sentinel 0) | `packages/core/src/mediaInfo.mjs` mới, `webProbe.ts`, `useTmcutPlatform.ts` | probe test trên fixture MP4/MOV/WebM/MKV + file hỏng; ffprobe **vẫn còn** cho tới khi D | A |
| C | Asset cache fingerprint (IndexedDB/OPFS), trạng thái `queued\|probing\|ready\|partial\|unsupported\|error` | `useTmcutMedia.ts` | relink test; không serialize File object | B |
| D | Thumbnail + filmstrip bằng `VideoDecoder`/Canvas; bỏ `-ss` IPC | `useTmcutFrames.ts`, `frames.mjs` | thumb test theo timestamp; cancel stale request | B |
| E | Autocut analysis (scene + silence) phía decoder; retire `analysis.mjs` stderr parse | `analysis.mjs`, `useTmcutAutocut.ts` | parity với kết quả cũ trên fixture, hoặc khai tử tính năng có ADR | D |
| F | Scene graph + WebGL2 compositor cho **preview** (nâng cấp #96 thành slice đầu của renderer chung, không phải DOM stacking tạm) | `TmcutPreviewPlayer.vue`, `paintStack.mjs`, `renderAt.mjs` | preview composite đủ `rows`, pixel gate DOM↔GPU | B |
| G | Web Audio engine: mixer, gain/mute/solo, waveform PCM, volume keyframe | mới trong `app/composables` | gap/overlap/crossfade test; 0 hit `extractAudio` | F |
| H | Export MVP: capability matrix, frame scheduler → `VideoEncoder` → `Mp4OutputFormat` finalize, backpressure, cancel | `packages/core/src/export/*` mới | output play được, A/V sync, 0 spawn | F, G |
| I | **Cut FFmpeg**: xóa `app/utils/tmcut/render/`, `ffmpegHelper.ts`, `ffmpeg.controller.cjs`, 3 route media, namespace IPC, 3 bảng DB, binary, updater | 2.2 + 2.3 | DoD §25 pass; witness group A đã chuyển thành behavior test ở H | H |
| J | Cú pháp FFmpeg trong core (mục 5.1, 14 module) → semantics + shader/canvas instruction | `canvas/mask/audio/keyframes/retime/effects/textStyle/transitions/probe/stabilize/cache/analysis/platform/crashRecovery` | group B vẫn xanh; group A đã thay | I |
| K | Web/Electron parity + packaging không binary; docs consolidation (archive V4 pack, một nguồn sự thật) | `electron/`, `docs/` | cùng project mở ở hai host trong phạm vi capability | I, J |

Slice #96 đang mở (preview composite stack — G18 screen leg) nên **gộp vào F**: làm DOM-stacking tạm rồi viết lại sang GPU là trả nợ hai lần
cho cùng một luật đã có trong `paintStack.mjs`.

Điều kiện tiền đề của H mà audit này chưa trả lời được: **tổ hợp codec nào runtime thực tế encode được**.
Phải đo `VideoEncoder.isConfigSupported` trên máy dev (Chrome/Electron 44) trước khi chốt preset — không suy từ bảng §20 của plan.

---

## 9. Rủi ro đã lượng giá

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Mất export trong suốt B→H (vì I chặn sau cùng) | Cao, nhưng **chấp nhận được**: đây là bản dev, user đã nói chưa cần dùng file | Giữ nguyên slice I ở sau H; export cũ vẫn chạy tới lúc đó, chỉ bị treo nhãn "sắp retirement" trong docs |
| Stabilization không có tương đương (nhóm 7 §3) | Cao | Phải khai tử có ADR, hoặc để `stabilize` là tính năng desktop-only trong một phase riêng — **quyết định của chủ repo** |
| 20 grade preset + mask `geq` phải viết lại thành shader | Trung bình | Mỗi luật một slice, pixel gate dung sai; không làm cả bảng preset trong một PR |
| MPL-2.0 của Mediabunny khi sản phẩm thương mại | Trung bình | NOTICE + review license trước release (plan §22) |
| Doc guards (line length, table shape, link integrity) chặn việc ghi ADR/slice log | Thấp | Đã đọc luật của 3 guard; mọi dòng prose ≤ 1356, escape `\|`, anchor `#L` đo trước khi ghi |
| `backup/ffmpeg-engine-2026-11-03/` (76 file, 1.6 MB) chưa được decide | Thấp | Quyết định 6 ở §10 |

---

## 10. Quyết định cần chủ repo chốt (agent không được tự quyết)

1. **Stabilization (vidstab)**: khai tử, hay giữ như tính năng desktop-only ngoài phạm vi zero-FFmpeg?
2. **Autocut scene/silence**: chấp nhận làm lại phía decoder (slice E), hay tắt Autocut cho tới khi có?
3. **HTML-video export** (Playwright screenshot + encode): plan §9 nói không lấy screenshot DOM làm export engine tổng quát.
   Route này hoặc thành "composition type riêng có UI cảnh báo", hoặc bị gỡ — cần chọn một.
4. **V4 roadmap**: sửa 6 dòng cho khớp plan mới, hay archive cả bộ V4 (audit + roadmap + extraction-plan) và dùng plan browser-first làm nguồn sự thật?
   Đây chính là phần "tối ưu lại docs" đang chờ.
5. **Số ADR**: chấp nhận đánh số 028…033 cho 6 quyết định §26 của plan?
6. **`backup/ffmpeg-engine-2026-11-03/`**: commit vào repo (1.6 MB, để lịch sử kiểm tra được) hay giữ untracked tới slice I rồi xóa?
7. **`resources/*.exe` (471 MiB)**: chỉ xóa được ở slice I, và cần quyết định có xóa luôn khỏi máy dev hay giữ lại cho tới khi H xanh.
8. **ADR-025 (font vendoring)** vẫn chặn golden-frame text leg; nó có còn chặn gì sau khi `drawtext` bị retire không — cần đo lại ở slice J.

---

## 11. Definition of Done §25 → bằng chứng sẽ chứng minh

| Mục DoD | Bằng chứng dự kiến | Hiện tại |
|---|---|---|
| Không FFmpeg trong dependency tree | `package.json` + lockfile grep | **đã đúng** (chưa từng có package FFmpeg) |
| Không binary trong repo/build | `.gitignore` + `electron-builder.yml` | **chưa** — 471 MiB vẫn đóng gói |
| Không spawn/exec media | grep `child_process` trong `electron/`, `server/` | **chưa** — 12 file, chỉ 1 không liên quan media (`dev-electron-launcher.cjs` spawn chính Electron) |
| Không FFmpeg IPC/config/env | `ipcPolicy.cjs`, `preload.cjs`, `sqlite.cjs` | **chưa** — 10 kênh, 3 bảng |
| Không docs hướng dẫn cài FFmpeg | doc guards + `updater.cjs` | **chưa** — 6 dòng roadmap (§5.3) |
| Probe bằng MediaProbeService | fixture probe test 2 host | **chưa** |
| WebCodecs encode khi supported | capability test + round-trip | **chưa** — 0 hit |
| JS muxer | output parse lại được bằng Mediabunny `Input` | **chưa** |
| Deterministic frame timing | scheduler test đã có, cần wire vào encoder path | **một nửa** |
| MediaRecorder không phải offline exporter | grep: chỉ `useTmcutRecorder` | **đã đúng** |
| Electron dùng chung engine | không còn `ffmpeg.controller.cjs` | **chưa** |

---

## 12. Kết luận của Phase 0

Kiến trúc mới **không phủ** những gì Phase 1–2 đã xây; nó phủ đúng một thứ: quyền tồn tại của FFmpeg.
Time model, evaluator, scheduler, paint stack, platform adapter, schema versioning đều đã đứng về phía plan.
Việc còn lại tập trung ở ba khối, theo thứ tự ưu tiên đo được:

1. **Xóa quyền phát ngôn của FFmpeg trong core** — 14 module (mục 5.1) đang in văn bản FFmpeg song song với semantics.
2. **Dựng media stack thật** — probe, decode, encode, mux, audio: repo hiện có **0** dòng cho cả năm thứ.
3. **Dọn surface ngoài code** — IPC, DB, packaging, updater, i18n: những chỗ mà "gỡ FFmpeg" kiểu search-and-replace sẽ bỏ sót.

Với rule 11 ("không xóa tính năng đang chạy trước khi có thay thế + test"), thứ tự an toàn là §8: probe (B) → thumbnail (D)
→ preview compositor (F) → audio (G) → export (H) → rồi mới cắt (I). Slice I là điểm không quay lại, và nó chỉ được thực hiện
khi slice H có output hợp lệ đầu tiên.
