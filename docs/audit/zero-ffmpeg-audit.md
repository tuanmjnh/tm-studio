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
| File khớp `ffmpeg\|ffprobe` (cả repo, tính docs + i18n) | **124** tại baseline; **125** từ khi có chính file audit này |
| Bỏ docs + i18n, chỉ code và test | **114** |
| Binary trong `resources/` | **494.514.688 byte** (≈471 MiB), 3 file |
| Unit suite (non-smoke) | **90/92 specs passed** |
| Spec FAIL có sẵn | `tmcut_login_remember` (working-tree chủ repo), `tmcut_process` (working-tree chủ repo) |
| `error TS` của typecheck tại slice A | **0** (`TC_EXIT=0`, `.nuxt/eslint.config.mjs` regenerate 28.535 byte) |

Hai FAIL không do slice nào gây ra và nằm ngoài phạm vi audit:
`app/pages/login.vue` trong working tree lại ghi `state.password = data.password \|\| ''` (regression chủ repo đã được báo cáo),
còn `tmcut_process` fail vì `server/utils/processStore.ts:28` ở working tree đổi import sang
`#shared/utils/processStore` trong khi `package.json` **không** có map `imports` — HEAD vẫn dùng
`../../shared/utils/processStore` và chạy được. Đây là lỗi working tree, không phải lỗi Node v24.

---

## 2. Footprint: FFmpeg nằm ở đâu, dưới hình dạng nào

### 2.1 Binary và packaging

- Ba binary `resources/ffmpeg.exe` (164.232.192 B), `ffplay.exe` (166.259.712 B), `ffprobe.exe` (164.022.784 B).
  Chúng **không** nằm trong git — `.gitignore:39` loại cả ba.
- Nhưng `electron-builder.yml:32` khai
  `extraResources: from resources` → mọi package desktop vẫn mang theo toàn bộ 471 MiB.
- `electron/tools/updater.cjs` tải FFmpeg từ gyan.dev lúc chạy:
  đây chính là "spawn/exec binary media tool" và "download media tool" mà rule 2 và DoD §25 cấm.

### 2.2 Code, theo kích thước thật

| Khối | Dòng | Vai trò |
|---|---|---|
| `app/utils/ffmpegHelper.ts` | 1305 | argv + parse |
| `electron/tools/ffmpeg.controller.cjs` | 1597 | spawn, progress, encoder args |
| `app/utils/tmcut/render/index.ts` + compiler | 1790 | filtergraph của timeline export |
| `server/utils/htmlVideoRender.ts` | 279 | Playwright capture + encode |
| `server/api/v1/media/render.post.ts` | 169 | export route |
| `server/api/v1/media/proxy.post.ts` | 145 | proxy 540p |
| `server/api/v1/media/analyze.post.ts` | 115 | ffprobe + thumbnail + waveform |
| `server/utils/renderJobs.ts` | 110 | job store |

### 2.3 Surface nằm ngoài code (thường bị quên khi "gỡ FFmpeg")

- **IPC**: `electron/preload.cjs:59` expose namespace `tools:ffmpeg`
  với **10** tên kênh; `electron/ipcPolicy.cjs:45` sinh allow-list
  `tools:ffmpeg:${n}` từ `TASK_EVENT_NAMES`.
- **Database**: 3 bảng trong `electron/tools/sqlite.cjs:186` —
  `ffmpeg_configs` (dòng 186), `ffmpeg_batch_configs` (225), `ffmpeg_history` (235) — cộng các migration `tryAddHistoryCol`.
- **Shared types**: `shared/types/electron.ts:65` định nghĩa
  `FfmpegLabel`, `FfmpegSubFile`, `FfmpegRenderResponse`, `FfmpegConfig`, `FfmpegBatchConfig(Item)`, `FfmpegHistory`,
  `FfmpegVersions` và **10** method CRUD của `ToolsNamespace` (đo: `grep -cE "^  (list|create|update|delete)Ffmpeg"`).
- **i18n**: **9 key × 2 locale** (dòng 733, 886, 887, 888, 903, 967, 1007, 1249, 1311 của `en.json`/`vi.json`) —
  toàn bộ là text mô tả tính năng, chỉ sửa được **sau** khi engine thay thế xong, không trước.
- **Test**: 26 file `tests/unit` + 1 file `tests/e2e` khớp từ khóa. Phía `packages/core/test` có **hai phép đo khác nhau**,
  và con số quyết định là phép đo theo tên emitter, không phải phép đo từ khóa:
  - Khớp từ khóa `ffmpeg|ffprobe` (kể comment): **11** file — `assets-probe-cache`, `canvas`, `effects`, `evaluate`, `htmlVideo`,
    `mask`, `platform`, `retime`, `stabilize`, `still-image`, `transitions`. Mang từ khóa *ngoài* comment: **6**
    (`canvas` 24 lần, `effects` 13, `platform` 5, `assets-probe-cache` 1, `mask` 1, `stabilize` 1 — đếm sau khi đã cắt comment bằng script ở §14.4).
  - **Tham chiếu một symbol mà core đặt tên theo động từ của FFmpeg** (`buildFfmpeg*`, `maskAlphaExpr`, `keyframeExpr`,
    `rampSetptsExpr`, `volumeExpr`, `panFilter`, `lut3dChain`, `normalizeProbe`, `buildVidstab*`, `buildProxyArgs`,
    `stillImageInputFlags`, `buildBackgroundSource`, `parseSceneOutput`, `parseSilenceOutput`, `XFADE_POSITION_LAWS`, `nativeFFmpeg`):
    **13** file — `analysis`, `assets-probe-cache`, `audio`, `canvas`, `effects`, `evaluate`, `keyframes`, `mask`,
    `platform`, `retime`, `stabilize`, `still-image`, `transitions`. Ba trong 13 đó không assert văn bản FFmpeg:
    `platform` chỉ assert flag `nativeFFmpeg`, còn `transitions` chỉ assert hình học `XFADE_POSITION_LAWS` (một cái tên).

  Hai tập **không trùng nhau**: `analysis`, `audio`, `keyframes` không viết chữ "ffmpeg" ở đâu cả mà vẫn ràng buộc vào cú pháp
  FFmpeg (parser stderr, emitter `setpts`/`geq`/`volume`), vì core đặt tên symbol theo *động từ* của FFmpeg.
  Hợp của hai tập là **14** file — `htmlVideo` chỉ có từ khóa trong comment, không assert văn bản FFmpeg.
  Ba mức việc của slice J, tách từ phép đo trên: **11** file assert văn bản FFmpeg (10 của tập symbol, trừ `platform` và `transitions`, cộng `analysis`), **1** file (`platform`) chỉ assert flag `nativeFFmpeg` sẽ bị xóa ở slice I,
  **2** file (`transitions`, `htmlVideo`) chỉ mang tên FFmpeg mà không assert văn bản nào. Kết luận method cho slice J: đừng đếm witness bằng `grep ffmpeg` — phải đếm bằng tên emitter.
  **Sửa lại khi đo bằng symbol list (slice A2, 2026-11-03):** các bản trước ghi 10 / 11 / 12 cho cùng một khối việc ở §7, §8 và ở register ADR;
  phép đo lại bằng script (đính kèm ở §14.4, chạy xong rồi xóa) trên **45** file `packages/core/test/*.test.mjs` cho ra 11 / 13 / 14 như trên.
- **UI**: export modal, inspector (hint "export runs the exact FFmpeg chain"), media panel, timeline, preview player,
  autocut page, MCP bridge (`app/composables/useMcpRendererBridge.ts:173`
  phát `command: 'ffmpeg'`), task manager (`ToolKind = 'youtube' \| 'ffmpeg'`).

### 2.4 Đủ bộ từ khóa mà plan §18.1 yêu cầu tìm

`grep -rn -- "<khóa>" app server shared electron packages/core/src packages/core/types tests i18n package.json`:

| Nhóm từ khóa | Số hit | Interpretation |
|---|---|---|
| `fluent-ffmpeg`, `ffmpeg-static`, `@ffmpeg/ffmpeg`, `ffmpeg.wasm` | **0 / 0 / 0 / 0** | không có wrapper npm nào — FFmpeg vào repo bằng binary + argv tự viết |
| `filter_complex` | 52 | đây là chỗ luật filtergraph sống, tất cả ở engine export |
| `drawtext` | 74 | text render có hai phát ngôn; phần `drawtext` là nhánh phải bỏ (§5.1) |
| `ffmpeg`, `ffprobe` (không phân biệt hoa thường) | **105 file** với search set ở trên; **125 file** nếu tính cả `docs/` (§1) | phần chênh là docs, không phải code |
| `subtitles=` | **2** | **phát hiện thêm khi đo từ khóa của plan**: burn-in subtitle **có tồn tại**, và chỉ ở engine |
| `force_style` | 0 | subtitle burn-in không có tham số style nào để dịch sang text renderer |

Hai site burn-in: `electron/tools/ffmpeg.controller.cjs:422`
và `electron/tools/ffmpeg.controller.cjs:723` (một cho render đơn, một cho batch),
cùng dùng filter `subtitles='<path>'` của libass; đầu vào là `config.subtitle` khai ở
`shared/types/electron.ts:224`.
Nó **không** có trong 10 nhóm ở §3 khi audit mới đọc code render — đây chính là lý do phải chạy hết từ khóa §18.1:
nhóm này không có tương đương WebCodecs (libass là C library), nên nó thành nhóm 11 và một quyết định của chủ repo (§10).

Kết luận còn lại của phép đo package: vì không có wrapper npm nào, "gỡ dependency FFmpeg" không phải gỡ package —
nó là gỡ binary + argv + IPC, đúng ba khối ở §12.

Phạm vi exit gate Phase 0 của plan ("không còn khu vực FFmpeg/FFprobe chưa phân loại"): 11 nhóm ở §3 + 14 module đã phân mức ở §5.1
+ 6 surface ngoài code ở §2.3 + 10 phép đo ở §6 + bộ từ khóa ở §2.4. Không còn vùng nào chưa gọi tên.

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
| 11 | Subtitle burn-in | filter libass `subtitles='<path>.srt'`, 2 site trong engine (§2.4) | §18.2 "Subtitle renderer" | **Chưa** — libass là C library, không có đường WebCodecs nào tương đương |

Kết luận §3: **4/11** nhóm (proxy, desktop tools, một phần thumbnail, một phần waveform-cache) bỏ được mà không cần thay thế ngay;
**7/11** nhóm (probe, export, analysis, grade, stabilize, HTML-video, subtitle burn-in) **bắt buộc có thay thế + test trước khi xóa**, đúng rule 11 của plan.
Nhóm 11 tìm ra muộn: nó không hiện lên khi đọc code render, mà hiện lên khi chạy hết từ khóa §18.1 của plan.

---

## 4. Cái đã khớp kiến trúc mới — không được viết lại

Plan §2 vẽ 8 layer. Repo đã có sẵn phần xương sống của 4 layer, đo cụ thể như sau.

| Layer plan yêu cầu | Đã có ở đâu | Bằng chứng |
|---|---|---|
| Timeline Core (time model) | [packages/core/src/time.mjs](file:///D:/Applications/tm-studio/packages/core/src/time.mjs), [clock.mjs](file:///D:/Applications/tm-studio/packages/core/src/clock.mjs) | integer ticks `TICKS_PER_SECOND = 120000`, `fpsToRational`, `createClock` với `frameStarts`/`durationFrames` — khớp §7 "chọn một internal time unit, rational frame rate" |
| Timeline Core (evaluator) | [packages/core/src/evaluate.mjs](file:///D:/Applications/tm-studio/packages/core/src/evaluate.mjs) | pure function, không DOM/clock/filesystem; ADR-018 half-open — khớp §7 |
| Export Core (scheduler) | [packages/core/src/scheduler.mjs](file:///D:/Applications/tm-studio/packages/core/src/scheduler.mjs), [renderAt.mjs](file:///D:/Applications/tm-studio/packages/core/src/renderAt.mjs) | timestamp suy từ frame index + rational fps, không `setTimeout` — khớp §12 "Frame scheduler deterministic" |
| Rendering semantics (stack) | [packages/core/src/paintStack.mjs](file:///D:/Applications/tm-studio/packages/core/src/paintStack.mjs) | `selectPaintRows` trả `{rows, base}` một lần cho mọi host — khớp §9 "composition graph độc lập renderer" |
| Platform Adapter | `packages/core/types/platform.ts:84`, `packages/core/src/platform.mjs` | `TmcutPlatformAdapter {info, media, capture, encoder}` + capability flags — đúng hình §16; `media.probe` ở `packages/core/types/platform.ts:47` |
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

| Module | Dấu vết FFmpeg | Hệ quả khi xóa |
|---|---|---|
| [canvas.mjs:125](file:///D:/Applications/tm-studio/packages/core/src/canvas.mjs#L125) | **Đã nghỉ hưu ở slice J (§55)**: `buildFfmpegFitFilters`, `buildFfmpegTransform`, `stillImageInputFlags`, `buildBackgroundSource` | Fit/crop/rotate sống ở `computeFitObjectStyle` + `resolveClipLayout`; background/still input do painter WebCodecs đọc từ plan |
| [mask.mjs:67](file:///D:/Applications/tm-studio/packages/core/src/mask.mjs#L67) | **Đã nghỉ hưu ở slice J (§55)**: `maskAlphaExpr` — biểu thức `geq` alpha per-pixel | `maskCssMaskImage` (SVG alpha mask) là hình học duy nhất còn sống; exporter từ chối clip có mask theo tên |
| [audio.mjs:56](file:///D:/Applications/tm-studio/packages/core/src/audio.mjs#L56) | **Đã nghỉ hưu ở slice J (§55)**: `volumeExpr` (fade theo `t`), `panFilter` phát filter `stereotools` | `gainAt` (số học) là luật gain duy nhất; mixer Web Audio chưa áp pan — gap §55 |
| [keyframes.mjs:50](file:///D:/Applications/tm-studio/packages/core/src/keyframes.mjs#L50) | **Đã nghỉ hưu ở slice J (§55)**: `keyframeExpr` — biểu thức toán FFmpeg cho property theo thời gian | `evalKeyframe` là bản "evaluate at tick" mà renderer đọc |
| [retime.mjs:221](file:///D:/Applications/tm-studio/packages/core/src/retime.mjs#L221) | **Đã nghỉ hưu ở slice J (§55)**: `rampSetptsExpr` — `setpts` cho speed curve phi tuyến | Source-time mapping tính từ cùng curve: `rampTimelineToSource` / `rampElapsedForConsumed` |
| [effects.mjs:512](file:///D:/Applications/tm-studio/packages/core/src/effects.mjs#L512) | **Đã nghỉ hưu ở slice J (§55)**: `buildFfmpegEffectFilters` + `lut3dChain`: 20 preset → chuỗi grade | Thay bằng `lutGrade` (ops semantics) + `cssFromGrade` ở `app/utils/tmcut/fxPreview.ts` |
| [textStyle.mjs:6](file:///D:/Applications/tm-studio/packages/core/src/textStyle.mjs#L6) | Module chỉ giữ **số dùng chung** (borderw/shadow/boxborderw ↔ CSS); chuỗi `drawtext` thật nằm ở engine | Giữ CSS, bỏ `drawtext` — và thấy luôn rằng text không có emitter nào trong core để xóa |
| [transitions.mjs:253](file:///D:/Applications/tm-studio/packages/core/src/transitions.mjs#L253) | `XFADE_POSITION_LAWS` / `XFADE_PREVIEW` — hình học đo từ binary. **Tên spelling FFmpeg không ở đây**: nó sống ở `app/utils/tmcut/fxCatalog.ts:5`, bên ngoài core | **Semantics giữ được** (window, progress, vùng), spelling bỏ mà không đụng core |
| `packages/core/src/probe.mjs` (đã xoá ở slice J, §55) | `normalizeProbe` theo shape JSON của ffprobe | Thay bằng `buildMediaInfo` ở [mediaInfo.mjs:231](file:///D:/Applications/tm-studio/packages/core/src/mediaInfo.mjs#L231), schema rộng hơn |
| `packages/core/src/stabilize.mjs` (đã xoá ở slice J, §55) | `buildVidstabDetectArgs` / `buildVidstabTransformArgs`: argv 2-pass | Không có thay thế → tính năng khai tử; exporter từ chối clip `stabilize` theo tên |
| [cache.mjs:29](file:///D:/Applications/tm-studio/packages/core/src/cache.mjs#L29) | **Đã nghỉ hưu ở slice J (§55)**: `buildProxyArgs` | Bỏ được — proxy là optional; `cacheKeyForPath` / `cachePathFor` còn sống |
| [analysis.mjs:20](file:///D:/Applications/tm-studio/packages/core/src/analysis.mjs#L20) | **Đã nghỉ hưu ở slice J (§55)**: `parseSceneOutput` / `parseSilenceOutput` — parse stderr FFmpeg | Autocut đọc cut từ decoder (`sceneScore`, `silenceSpans`); `cutsToShots` ở [detection.mjs:193](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L193) là đường duy nhất |
| `packages/core/src/platform.mjs:18` | Capability flag `nativeFFmpeg` | Xóa flag khi engine gone; **đây là flag duy nhất cần giữ lại là `webCodecs`** |
| [crashRecovery.mjs:159](file:///D:/Applications/tm-studio/packages/core/src/crashRecovery.mjs#L159) | Health check `{name:'ffmpeg'}` | Thay bằng check WebCodecs/muxer capability |

Bảng trên chạm **14 module**, nhưng đo kỹ thì FFmpeg sống trong core ở **bốn mức khác nhau**, và chỉ hai mức đầu là việc của slice J:

| Mức | Module | Ý nghĩa với migration |
|---|---|---|
| **Emit văn bản FFmpeg** | `canvas`, `mask`, `audio` (`stereotools` đã nghỉ hưu — còn `gainAt` ở [dòng 56](file:///D:/Applications/tm-studio/packages/core/src/audio.mjs#L56)), `keyframes`, `retime`, `effects`, `stabilize`, `cache` — **8 module** | slice J đã thay cả 8 bằng instruction cho canvas/Web Audio (**§55**). Đây là khối việc thật |
| **Parse output FFmpeg** | `probe` (JSON ffprobe), `analysis` (stderr) — **2 module** | phải đổi sang schema MediaInfo mới; không có "bản dịch" nào khác |
| **Mang tên FFmpeg trong metadata** | `platform` (flag `nativeFFmpeg`), `crashRecovery` (health check `'ffmpeg'`) — **2 module** | xóa tên là xong, không đụng semantics |
| **Chỉ nhắc trong comment** | `textStyle`, `transitions` — **2 module** | **không có gì để gỡ**: `textStyle` chỉ export số dùng chung, còn spelling `xfade=` nằm ở `app/utils/tmcut/fxCatalog.ts` phía app. Sửa comment là đủ |

Con số định hình lại slice J: **10** module thật sự phải đổi phát ngôn (8 emit + 2 parse), không phải 14.

### 5.2 Probe web không dám nói sự thật về FPS

`app/utils/tmcut/webProbe.ts:34` (file đã bị xóa ở slice I) trả `fps: 0`
và suy `hasAudio` từ "không có video track". Plan §4.1 bắt trường không đọc được là `undefined` kèm warning, §4.3 cấm mặc định 30 FPS.
Hiện code dùng `0` làm sentinel, tức là phân biệt "không biết" bằng một con số có vẻ hợp lệ — đúng cái plan cấm.

**Đóng một phần ở slice B (2026-11-03, §13):** `normalizeMediaInfo` dựng FPS **chỉ khi có số đo**, nên đường probe mới không còn sentinel;
`webProbe.ts` vẫn còn và vẫn trả `fps: 0` cho tới khi slice C thay chỗ nó trong flow import. Đo lại ngày 2026-11-03:
`grep -n "fps: 0" app/utils/tmcut/webProbe.ts` còn **1** hit, ở đúng dòng 48.

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
| ADR-006 | `docs/tmcut-v4-universal-rendering-multiplatform-roadmap.md:1503` | "FFmpeg optional backend — giữ khả năng tương thích native khi cần" | **Bị supersede** — rule 1 và 3 không cho tồn tại backend tùy chọn |
| ADR-015 | `docs/v4-phase-0-audit.md:235` | "Giữ làm backend 'compat' desktop + server; WebCodecs là backend web mặc định khi đủ codec" | **Bị supersede** — và đây là ADR đã được *áp dụng vào code*, nên xóa FFmpeg mà không ghi lệnh supersede thì lịch sử quyết định sẽ nói code đang sai |

Hệ quả thực tế: slice A phải tạo **một ADR supersede đàng hoàng** (đánh số 028) nêu rõ ADR-006 và ADR-015 không còn hiệu lực,
chứ không chỉ sửa 6 dòng prose.

Phải xử lý một trong hai hướng (xem §10 quyết định 4): hoặc sửa 6 dòng đó theo plan mới, hoặc archive V4 roadmap và lấy plan mới làm nguồn sự thật.

**Đóng ở slice A2 (2026-11-03).** [docs/adr/zero-ffmpeg-decisions.md](file:///D:/Applications/tm-studio/docs/adr/zero-ffmpeg-decisions.md)
ghi ADR-028…033 và đánh dấu **cả hai hàng ADR tại chỗ** (không xoá, để lịch sử đọc được). Con số "6 dòng" của bảng trên là **thiếu**:
đo lại bằng `grep -ni "ffmpeg"` trên roadmap rồi đọc từng ngữ cảnh, có **14** dòng phải sửa — sáu dòng của bảng ở trên,
cộng tám dòng nữa cấp vai trò cho FFmpeg mà bảng bỏ sót: nguyên tắc cốt lõi 8 ("FFmpeg optional"), heading §9
("Export pipeline không bắt buộc FFmpeg"), đoạn Colab mô tả cài FFmpeg, dòng "Desktop có Agent/native backend → có thể dùng native media operation",
dòng "Native process manager" của Phase 6, nguyên tắc 12, chính hàng ADR-006, và dòng chót "FFmpeg là backend tùy chọn".
Bằng chứng tái hiện: `git diff -U0` của slice này trên roadmap cho **14 hunk, mỗi hunk đúng một dòng**, cộng một chèn banner.
Hướng đã chọn: **sửa prose ngay, archive cả bộ ở slice K** (mục 4 §10). Lí do nằm ở DoD §25 của plan — mục
"không docs hướng dẫn cài FFmpeg" không đạt được bằng cách dán nhãn supersede rồi để nguyên văn bản cho phép fallback.

### 5.4 Ba điểm chính plan mới cần sửa trước khi giao cho agent khác

- §27 dẫn `docs/roadmap/zero-ffmpeg-zero-ffprobe-browser-first.md` — đường dẫn **không tồn tại**;
  file thật là [docs/tmcut-zero-ffmpeg-zero-ffprobe-browser-first-roadmap.md](file:///D:/Applications/tm-studio/docs/tmcut-zero-ffmpeg-zero-ffprobe-browser-first-roadmap.md) (dòng 1046).
- §26 đánh số ADR-001…006, nhưng repo đã dùng **hai gia đình số** cho cùng khoảng đó:
  roadmap §18 định nghĩa ADR-001…ADR-012 (ADR-001 = "Shared Project/Timeline Core", ADR-005 = "WebCodecs + muxer", ADR-006 = "FFmpeg optional backend"),
  còn `docs/v4-phase-0-audit.md:233` mở đầu dãy ADR-013…ADR-027.
  Đo: `grep -rho "ADR-[0-9]\+" docs/*.md \| sort -u` cho **27** nhãn. Six ADR mới phải mang số **028…033**; nếu giữ số của plan,
  ADR-001 "Zero FFmpeg" sẽ đá trực tiếp lên ADR-001 "Shared Project/Timeline Core" đang được source code cite.
- §4.1 và §7 định nghĩa `TMCutProject { schemaVersion, tracks, sequences }` — repo đang lưu
  `version: 3` và `timeline.tracks` flat ([useTmcutProject.ts:313](file:///D:/Applications/tm-studio/app/composables/useTmcutProject.ts#L313)
  đặt `schemaVersion: TMCUT_PROJECT_SCHEMA_VERSION`, `project.mjs:43` đặt `version: 3`).
  Hai hình dạng này **không** tương thích một-một; cần một ADR migration riêng, không phải một field đổi tên.
  **Trạng thái 2026-11-04 (Q5):** chủ repo khoá nguyên dạng v3 thật và **không** migrate sang `tracks` + `sequences`;
  cả hai hình dạng đã đo và đóng băng bằng guard ở §15.3, nên ADR migration mà bullet này đòi **không cần viết nữa** —
  nó chỉ quay lại nếu một tính năng thật buộc đổi shape, và lúc đó guard sẽ đỏ có chủ ý.

---

## 6. Dependency: đã xác minh hôm nay, chưa cài

Đo bằng `grep -rn "<pattern>" app server electron shared packages --include=*.ts --include=*.mjs --include=*.vue --include=*.cjs`
— **có phân biệt hoa thường**, vì `-i` cho hit giả: `ffmpegHelper.ts` biến `videoEncoder` (tên biến giữ chuỗi `-c:v` của FFmpeg)
khớp với `VideoEncoder` của WebCodecs. Đếm file, không đếm dòng.

| Capability plan cần | Số hit trong repo |
|---|---|
| `mediabunny` | **0** ở thời điểm đo; slice B đã cài 1.65.1 và dùng trong `app/utils/tmcut/mediaProbe.ts` (xem §13) |
| `VideoEncoder` / `VideoDecoder` / `isConfigSupported` | **0** |
| `OfflineAudioContext` / `AudioContext` / `decodeAudioData` | **0** |
| `OffscreenCanvas` / OPFS | **0** |
| `WebGL2` class | **0**; chuỗi `'webgl2'` chỉ **1** lần trong source, như capability sniff ở [crashRecovery.mjs:165](file:///D:/Applications/tm-studio/packages/core/src/crashRecovery.mjs#L165) — hit thứ hai khi grep cả `dist/` chỉ là bản compile của đúng dòng đó |
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
- License MPL-2.0 là **file-level copyleft**: không lây sang app code, nhưng phải ghi trong NOTICE khi phát hành thương mại (plan §22 yêu cầu kiểm license).
- Rule 13 của plan có hiệu lực: chữ ký ở trên phải **verify lại bằng file `.d.ts` của version thực cài** trước khi viết code, không viết từ trí nhớ.

---

## 7. Test hiện tại chứng minh điều gì — và cái gì chết cùng engine

Nhóm A — **witness FFmpeg** (assertion là chuỗi filtergraph hoặc pixel do FFmpeg render; phải viết lại thành behavior test, không sửa cho xanh):
`tmcut_render_graph` (23 checks), `tmcut_render_parity` (14), `tmcut_export_paint_stack`, `tmcut_export_track_parity`,
`tmcut_export_gap_placement`, `tmcut_footage_row_rule` (chiều export), `tmcut_golden_frame`, `tmcut_text_pixel`,
`tmcut_svg_still`, `tmcut_fx_catalog`, `tmcut_detect_smoke`, `tmcut_render_smoke` (smoke), `tmcut_platform_adapter` (12).
Phía core, xếp theo phép đo **tên emitter** (§2.3) chứ không theo từ khóa, và chia ba mức việc vì ba mức bị xử lý khác nhau:
- **Tách assertion — 11 file**: `analysis`, `assets-probe-cache`, `audio`, `canvas`, `effects`, `evaluate`, `keyframes`,
  `mask`, `retime`, `stabilize`, `still-image`. Mỗi file import một symbol mà core đặt tên theo động từ của FFmpeg
  (`parseSceneOutput`, `normalizeProbe`, `volumeExpr`, `buildFfmpegFitFilters`, `keyframeExpr`, `rampSetptsExpr`, `maskAlphaExpr`, `buildVidstab*`…)
  và assert **chuỗi** nó sinh ra. Xóa emitter là phải tách phần số học ra khỏi phần văn bản, không được xóa cả file.
- **Xóa assertion theo flag — 1 file**: `platform` (chỉ assert `nativeFFmpeg`; flag chết cùng engine ở slice I).
- **Chỉ đổi tên — 2 file**: `transitions` (assert hình học `XFADE_POSITION_LAWS`, không nhắc FFmpeg ngoài comment) và
  `htmlVideo` (assert output mà FFmpeg render, nhưng bằng lời trong comment).
Ba bản trước của chính dòng này ghi **10 / 11 / 12** cho cùng một khối việc; §14.4 ghi lại phép đo và lệnh dựng lại nó.

Nhóm B — **luật thuần, sống sót nguyên vẹn**: `tmcut_paint_stack` (6 checks: equivalence + preview + stack order),
`tmcut_frame_scheduler`, `tmcut_time_domain` (7), `tmcut_shared_model`, `tmcut_text_style`, `tmcut_transition_preview`,
`tmcut_preview_boundary`, `tmcut_playback_duration` (9).
**Sửa lại khi đo bằng emitter (§2.3)**: `retime`, `keyframes`, `evaluate` của core sống sót **một phần** —
phần số học (source-time mapping, interpolation, geometry) là luật thuần, nhưng mỗi file đều import một emitter
FFmpeg (`rampSetptsExpr` 9 lần, `keyframeExpr` 11, `maskAlphaExpr` 4) và assert chuỗi nó sinh ra,
nên slice J phải **tách assertion** chứ không được xóa cả file. Đây chính là dạng việc mà phép đếm từ khóa bỏ sót.

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
| A | Chốt kiến trúc: ADR-028…033, sửa prose FFmpeg của V4 roadmap, lưu baseline — **xong ở slice A2 (§14); con số "6 dòng" ở dòng này là thiếu, đo lại là 14** | `docs/`, ADR mới | typecheck exit 0 và 0 `error TS`; suite ≥90/93 như baseline; bốn doc guards **và** `docs_markdown` xanh (5/5 exit 0) | — |
| B | `MediaProbeService` + Mediabunny cho **cả hai host**, trả schema §4.1 (undefined + warnings, không sentinel 0) — **đã code `1b57ca1`, nhưng exit gate mới đạt một phần: WAV + file hỏng + ảnh tĩnh trên hai host, fixture video MP4/MOV/WebM/MKV chưa (§13.4)** | `packages/core/src/mediaInfo.mjs` mới, `webProbe.ts`, `useTmcutPlatform.ts` | probe test trên fixture MP4/MOV/WebM/MKV + file hỏng; ffprobe **vẫn còn** cho tới khi D | A |
| C | Asset cache fingerprint (IndexedDB/OPFS), trạng thái `queued\|probing\|ready\|partial\|unsupported\|error` — **tách ba phần: C1 (audit §16) dựng tầng dữ liệu — sáu trạng thái vào record, fingerprint đúng bằng `cacheKeyForPath`, relink reset mọi thứ probe cũ học và giữ nguyên reference theo Q6; C2 (audit §17) dựng tầng chữ — bảng nhìn state → chữ/icon/tone, predicate `isMediaOffline`, plate Media Offline trên library + timeline + preview, một dòng relink dùng chung cho ba bề mặt; C2b (audit §18) dựng một nửa — store + write (import/relink) + reconcile-on-open + panel row, luật pure ở `byteCache.mjs`; **D2 (audit §20) mở đường đọc đầu tiên** — `readCachedBytes` đi từ **0** call-site ở HEAD sang **1** (`frameStore.ts:141`, decode xin bytes trong cache trước rồi mới xin `src`); playback/probe/waveform/export vẫn chưa đọc cache nên ADR-033 còn **CHỜ**** | `useTmcutMedia.ts`, `assetImport.ts`, `useTmcutRelink.ts`, `byteStore.ts` mới, `packages/core/src/byteCache.mjs` mới | relink test; không serialize File object — **C1: 16 check ở `tmcut_asset_import.spec.ts`; C2: 13 check ở `tmcut_media_offline.spec.ts` (bảng nhìn + locale hai chiều + truth table offline + hành vi huỷ/relink); C2b: 26 check ở `tmcut_byte_cache.spec.ts` (9 core law, 10 store/backends, 1 boundary, 6 integration)** | B |
| D | Thumbnail + filmstrip bằng `VideoDecoder`/Canvas; bỏ `-ss` IPC — **tách ba phần: D1 (audit §19) dựng danh tính và luật đua trong core (`frameRequestKey`/`frameTimeWithinMedia`/`createFrameSlotLedger`/`planFrameCacheEviction`), pin cả parity với template key của desktop bằng cách đọc file controller; D2 dựng **xong** service giải frame một cho hai host (`app/utils/tmcut/frameStore.ts`) + seam pixel duy nhất (`frameDecode.ts`, Mediabunny `CanvasSink`), pool trần 3 lấy từ core, và là chỗ **đường đọc đầu tiên** của byte cache xuất hiện; D3 nối `useTmcutFrames.ts` + ba consumer và trả nợ fixture video §13.4. IPC `-ss` vẫn còn cho tới slice I (build-then-cut, rule 11)** | `useTmcutFrames.ts`, `frames.mjs`, `app/utils/tmcut/frameStore.ts` + `frameDecode.ts` mới | thumb test theo timestamp; cancel stale request — **D1: 11 check ở `tmcut_frame_cache.spec.ts` (danh tính theo ms, clamp, ledger thắng-thua, cache bound); D2: 19 check ở `tmcut_frame_service.spec.ts` (peak decoder = 3, đọc cache trước khi mở decoder, one-flight theo key, ask thua bị abort mà vẫn giữ bytes, bound + `revokeObjectURL`) — "cancel" đã là hành vi đo được, nhưng vẫn chưa hủy một decode thật nào vì chưa có fixture video: nợ đó thuộc D3** | B |
| E | Autocut analysis (scene + silence) phía decoder; retire `analysis.mjs` stderr parse | `analysis.mjs`, `useTmcutAutocut.ts` | parity với kết quả cũ trên fixture, hoặc khai tử tính năng có ADR | D |
| F | Scene graph + WebGL2 compositor cho **preview** (nâng cấp #96 thành slice đầu của renderer chung, không phải DOM stacking tạm) | `TmcutPreviewPlayer.vue`, `paintStack.mjs`, `renderAt.mjs` | preview composite đủ `rows`, pixel gate DOM↔GPU | B |
| G | Web Audio engine: mixer, gain/mute/solo, waveform PCM, volume keyframe — **đang chạy, đo từng phần**: G1 (audit §43) dựng luật peak + envelope + key artifact; G2 (audit §44, 2026-11-05) dựng **service** và có bằng chứng **artifact đọc lại từ cache client sau reload mà không chạm file**; mixer/gain keyframe, gap/overlap/crossfade và số đo "0 hit `extractAudio`" **chưa có** (#139, #140) | mới trong `app/composables` | gap/overlap/crossfade test; 0 hit `extractAudio` | F |
| H | Export MVP: capability matrix, frame scheduler → `VideoEncoder` → `Mp4OutputFormat` finalize, backpressure, cancel | `packages/core/src/export/*` mới | output play được, A/V sync, 0 spawn | F, G |
| I | **Cut FFmpeg**: xóa `app/utils/tmcut/render/`, `ffmpegHelper.ts`, `ffmpeg.controller.cjs`, 3 route media, namespace IPC, 3 bảng DB, binary, updater — kèm **hai site subtitle burn-in** (§2.4) | 2.2 + 2.3 | DoD §25 pass; witness group A đã chuyển thành behavior test ở H; quyết định 9 đã chốt | H |
| J | Cú pháp FFmpeg trong core: **8 emitter + 2 parser** (§5.1) → semantics + shader/canvas instruction | `canvas/mask/audio/keyframes/retime/effects/stabilize/cache` + `probe/analysis`; `textStyle`/`transitions` chỉ sửa comment | group B vẫn xanh; group A đã thay; **11** file core test phải **tách assertion** (§2.3: + `analysis`, − `platform`/`transitions` thuộc hai mức việc khác), không xóa cả file | I |
| K | Web/Electron parity + packaging không binary; docs consolidation (archive V4 pack, một nguồn sự thật) | `electron/`, `docs/` | cùng project mở ở hai host trong phạm vi capability | I, J |

*(**đọc lại bảng này ngày 2026-11-05, §44**: ô "Bị chặn bởi" và cột DoD của dòng **C** mang số đo của
ngày viết bảng. Hôm nay đường đọc byte cache có **ba leg** — pixels (D2, §20), silence (E4, §33),
waveform (G2, §44) — `readCachedBytes` có **4** call-site thật trong `app/**`, và §44.5 là lần đầu một
**artifact** được đọc lại sau reload mà không phát request `.wav` nào. Hai vế khiến ADR-033 còn **CHỜ**
vẫn đúng như bảng ghi: **playback + export** còn đi `/uploads/` (desktop: từ đĩa), và **upload vẫn bắt
buộc**. Dòng **G** cũng đã tách: G1 §43 (luật), G2 §44 (service + bằng chứng đọc lại), #139 mixer và
#140 gap/overlap/sync/trim/rate chưa chạy. Cột evidence của dòng C ghi **26** check ở
`tmcut_byte_cache.spec.ts`; từ G2 spec đó có **28** (§44.3) và suite có thêm
`tmcut_waveform_service.spec.ts` **11** check.)*

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
| Doc guards (line length, table shape, link integrity, doc citations) chặn việc ghi ADR/slice log | Thấp | Đã đọc luật của **4** guard; mọi dòng prose ≤ 1356, escape `\|`, anchor `#L` đo trước khi ghi |
| `backup/ffmpeg-engine-2026-11-03/` (76 file, 1.6 MB) chưa được decide | Thấp | Quyết định 6 ở §10 |

---

## 10. Quyết định cần chủ repo chốt (agent không được tự quyết)

1. **Stabilization (vidstab)**: khai tử, hay giữ như tính năng desktop-only ngoài phạm vi zero-FFmpeg?
2. **Autocut scene/silence**: chấp nhận làm lại phía decoder (slice E), hay tắt Autocut cho tới khi có?
3. **HTML-video export** (Playwright screenshot + encode): plan §9 nói không lấy screenshot DOM làm export engine tổng quát.
   Route này hoặc thành "composition type riêng có UI cảnh báo", hoặc bị gỡ — cần chọn một.
4. **V4 roadmap**: sửa **14** dòng cho khớp plan mới (đo lại ở §5.3; bản đầu của câu này ghi "6 dòng"), hay archive cả bộ V4 (audit + roadmap + extraction-plan) và dùng plan browser-first làm nguồn sự thật?
   Đây chính là phần "tối ưu lại docs" đang chờ.
5. **Số ADR**: chấp nhận đánh số 028…033 cho 6 quyết định §26 của plan?
6. **`backup/ffmpeg-engine-2026-11-03/`**: commit vào repo (1.6 MB, để lịch sử kiểm tra được) hay giữ untracked tới slice I rồi xóa?
7. **`resources/*.exe` (471 MiB)**: chỉ xóa được ở slice I, và cần quyết định có xóa luôn khỏi máy dev hay giữ lại cho tới khi H xanh.
8. **ADR-025 (font vendoring)** vẫn chặn golden-frame text leg; nó có còn chặn gì sau khi `drawtext` bị retire không — cần đo lại ở slice J.
9. **Subtitle burn-in (nhóm 11 §3)**: libass không có tương đương trong WebCodecs/Web Audio. Chọn một —
   (a) viết subtitle renderer bằng canvas/GPU và render `.srt`/`.ass` phía JS, (b) khai tử burn-in, giữ subtitle là text track
   thường (đã có sẵn đường đó trong timeline), hay (c) để nó là tính năng desktop-only ngoài phạm vi zero-FFmpeg.
   Phương án (a) là một phase riêng, không phải một slice trong §8.

**Trạng thái 2026-11-03 (slice A2).** Chỉ thị "xoá hết và build theo đúng hướng dự án" đã ủy quyền phần kỹ thuật, nên chín mục trên
được trả lời trong [docs/adr/zero-ffmpeg-decisions.md §8](file:///D:/Applications/tm-studio/docs/adr/zero-ffmpeg-decisions.md#L183) — bảng nào đã chốt, bảng nào là đề xuất có điều kiện.
Ba mục **1, 7, 9** phá tính năng hoặc xoá dữ liệu nên vẫn cần chủ repo xác nhận **trước khi thi hành**; slice A2 chỉ ghi quyết định, chưa xoá gì.

**Trạng thái 2026-11-04.** Chủ repo đã trả lời chín câu bằng [docs/adr/zero-ffmpeg-decisions.md §10](file:///D:/Applications/tm-studio/docs/adr/zero-ffmpeg-decisions.md#L217):
mục **1** bỏ hẳn stabilization (project cũ giữ nguyên, đánh dấu unsupported), mục **9** chọn (b) — sơn subtitle qua `paintStack`, khai rõ phần ASS không hỗ trợ.
Mục **3** (HTML-video) **vẫn mở**: nó spawn ffmpeg nên không sống sót qua slice I nguyên trạng, và engine encode thay thế chưa được quyết;
marker `ZERO-FFMPEG-LEGACY` trong `server/utils/htmlVideoRender.ts` ghi đúng hai phương án đó chứ không chọn hộ.
Mục **7** chưa thi hành: binary và `resources/*.exe` vẫn nằm nguyên trên máy dev tới slice I.

---

## 11. Definition of Done §25 → bằng chứng sẽ chứng minh

*(Bảng này là **kế hoạch bằng chứng** viết ở slice A, không phải trạng thái hiện tại. Trạng thái **đo thật** sau slice I
nằm ở §54.8 — nhiều ô "chưa" dưới đây đã đóng ở B–H hoặc ở chính slice I.)*

| Mục DoD | Bằng chứng dự kiến | Hiện tại |
|---|---|---|
| Không FFmpeg trong dependency tree | `package.json` + lockfile grep | **đã đúng** (chưa từng có package FFmpeg) |
| Không binary trong repo/build | `.gitignore` + `electron-builder.yml` | **chưa** — 471 MiB vẫn đóng gói |
| Không spawn/exec media | grep `child_process` trong `electron/`, `server/` | **chưa** — 12 file import `child_process`; **9** file làm media work, **3** không liên quan (`main.cjs` spawn MCP server, `dev-electron-launcher.cjs` spawn Electron, `updater.cjs` chạy `tar`/`powershell`). Kiểm kê theo call site — 23 site, 21 chạm FFmpeg — ở §25.1 |
| Không FFmpeg IPC/config/env | `ipcPolicy.cjs`, `preload.cjs`, `sqlite.cjs` | **chưa** — 10 kênh, 3 bảng |
| Không docs hướng dẫn cài FFmpeg | doc guards + `updater.cjs` | **một phần** — 14 dòng roadmap đã đóng ở slice A2 (§5.3); `updater.cjs` và docs center còn tới slice I/K |
| Probe bằng MediaProbeService | fixture probe test 2 host | **một phần** — slice B đã dựng và đo trên cả hai host (§13); `webProbe.ts` cũ vẫn sống tới slice C (§5.2) |
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

1. **Xóa quyền phát ngôn của FFmpeg trong core** — **8** module in văn bản FFmpeg và **2** module parse output FFmpeg (mục 5.1).
   Hai module nữa (`textStyle`, `transitions`) chỉ nhắc FFmpeg trong comment, nên không thuộc khối việc này.
2. **Dựng media stack thật** — probe, decode, encode, mux, audio: tại thời điểm audit, repo có **0** dòng cho cả năm thứ; probe đã đóng ở §13, bốn thứ còn lại thuộc D/G/H.
3. **Dọn surface ngoài code** — IPC, DB, packaging, updater, i18n: những chỗ mà "gỡ FFmpeg" kiểu search-and-replace sẽ bỏ sót.

Với rule 11 ("không xóa tính năng đang chạy trước khi có thay thế + test"), thứ tự an toàn là §8: probe (B) → thumbnail (D)
→ preview compositor (F) → audio (G) → export (H) → rồi mới cắt (I). Slice I là điểm không quay lại, và nó chỉ được thực hiện
khi slice H có output hợp lệ đầu tiên.

### 12.1 Audit này đã trả đúng các mục Phase 0 của plan chưa

Plan §Phase 0 liệt kê deliverable và một exit criterion. Đối chiếu từng cái:

| Plan yêu cầu | Nằm ở đâu trong audit | Trạng thái |
|---|---|---|
| `docs/audit/zero-ffmpeg-audit.md` | chính file này | **đã tạo** |
| dependency map | §6 (kèm license + API đã xác minh của Mediabunny) | **đủ** |
| feature migration matrix | §3 (11 nhóm × đã-có-thay-thế-chưa) + §8 (slice A→K) | **đủ** |
| risk register | §9 | **đủ** |
| test plan | §7 (ba nhóm witness / luật / việc-phải-có-trước) | **đủ** |
| Audit IPC, scripts, docs, CI | §2.3 (IPC + DB + i18n + test), §2.1 (updater/packaging), §5.3 (docs) | **đủ** |
| Ghi flow import/preview/edit/export | §4 (evaluator, scheduler, paintStack, renderAt) và §8 slices B/D/F/G/H | **một phần** — flow mô tả bằng lời ở §8, chưa có sơ đồ |
| Lưu sample projects + baseline build/test | §1 (`92a4818`, `90/92 specs passed`, hai FAIL có sẵn) + `backup/ffmpeg-engine-2026-11-03/` | **đủ** |
| ADR-001 Browser-first / ADR-002 Mediabunny / ADR-003 WebCodecs | **chưa** | **BLOCKED ở slice A2**, vì số 001…003 đã bị hai gia đình ADR khác chiếm (§5.4) — cần quyết định 5 ở §10 |
| **Exit: không còn khu vực FFmpeg/FFprobe chưa phân loại** | 11 nhóm §3 + 14 module phân mức §5.1 + 6 surface §2.3 + 10 phép đo §6 + từ khóa §2.4 | **đạt** |

Kết luận: Phase 0 đóng được, trừ ADR — và ADR không đóng được bằng cách đánh số tùy ý, mà bằng một quyết định của chủ repo.

---

## 13. Slice B — `MediaProbeService` trên cả hai host (đo ngày 2026-11-03)

Slice B trong §8 đã đóng. Không có gì của FFmpeg bị xóa ở đây — theo rule 9, thứ thay thế phải có test trước, và slice này
chính là thứ thay thế cho probe; FFprobe vẫn còn nguyên tới slice I.

### 13.1 Cái đã dựng

| Lớp | File | Vai |
|---|---|---|
| Schema | `packages/core/types/mediaInfo.ts` (mới) | đúng hình dạng §4.1 của plan: duration kèm nguồn, track info, compatibility, warnings, import status |
| Luật | `packages/core/src/mediaInfo.mjs` (mới) | normalize thuần: thứ tự duration, không bao giờ giả 30 fps, mọi claim decode/encode phải có bằng chứng |
| Thu thập | `app/utils/tmcut/mediaProbe.ts` (mới) | file **duy nhất** trong `app/` được phép import demuxer (rule 12); Mediabunny 1.65.1 |
| Contract | `packages/core/types/platform.ts`, `app/composables/useTmcutPlatform.ts` | thêm `media.probeInfo(src, hints)`; `probe` giữ nguyên cho engine FFmpeg cũ đang đọc nó |
| Test | `packages/core/test/media-info.test.mjs`, `tests/unit/tmcut_media_probe.spec.ts` | 598 check core (cả repo) và 12 check probe |

Ba quyết định đáng ghi lại, vì chúng giải thích shape của code hơn là comment trong file:

1. **Một service cho cả hai host, không phải hai bản.** `media://local?file=` trả `Accept-Ranges: bytes` và 206 thật
   ([media-protocol.cjs:114-165](file:///D:/Applications/tm-studio/electron/media-protocol.cjs#L114)), nên `UrlSource` của
   Mediabunny đọc được file đĩa y như đọc HTTP. Electron không cần bản probe riêng — và ffprobe chỉ còn là đường cũ.
2. **Probe phải mô tả file đã lưu, không mô tả bản preview.** `resolveSrc` có thể trả URL proxy 960px khi bật proxy preview
   (`app/composables/useTmcutMedia.ts:864`), trong khi export cần
   codec và kích thước thật của file gốc. Vì thế adapter có `resolveSource` tách riêng, mặc định là `mediaUrl(path)`.
3. **Không có bằng chứng thì để trống, không đổ 0.** `canEncode` là `undefined` khi danh sách codec của runtime không phủ;
   `buildCompatibility` khi đó trả `canExportSourceCodec: false` kèm limitation `source-audio-encode`/`source-codec-encode`,
   chứ không claim lossless. Tương tự, một file không demux được trả `duration: undefined` chứ không phải `0`.

### 13.2 Bằng chứng đã đo

| Gate | Lệnh | Kết quả | Số đo |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | PASS | exit 0, 0 dòng `error TS`; `.nuxt/eslint.config.mjs` 28535 bytes, chạy lại sau khi sửa |
| 2 Lint | `npx eslint` trên 7 file đã chạm | PASS | exit 0, 0 problems. `pnpm lint:core` exit 1 với **87** lỗi **có sẵn** ở 12 file core không thuộc slice (`aiPlan`, `crashRecovery`, `telemetry`…); `mediaInfo.mjs` không có lỗi nào |
| 3 Unit | `npx tsx tests/unit/run-all.mts` | FAIL 91/93 | hai FAIL là WIP của chủ repo, xem 13.4. `tmcut_media_probe` 12/12, `tmcut_platform_adapter` 12/12 |
| 3b Core | `pnpm test:core` / `check:core` / `typecheck:core` | PASS | 598 tests, 598 pass, 0 fail; boundaries PASS; exit 0 và 0 `error TS` |
| 4 Live web | `/_nuxt/@fs/...mediaProbe.ts` trong trang Chromium thật | PASS | `hasWebCodecs: true`, 5 codec video decode được, 4 video encode được, 16 audio; probe WAV thật: `container WAVE`, `duration 0.5`, `durationSource container`, `importStatus ready`, 0 warning |
| 4b Live desktop | `Runtime.evaluate` qua CDP vào renderer Electron đang mở (không điều hướng, không đụng state) | PASS | `media://local?file=` trả **206** `bytes 0-1023/352844`; probe cùng file: `container WAVE`, `duration 2`, `canDecode true`, `canExportSourceCodec false` vì `pcm-s16` không có trong 16 codec encodable — tổng 734 ms |
| 5 Dọn | fixture + script scratch đã xóa | PASS | fixture đặt trong `.data/` (gitignored), không còn file nào trong repo |

`canExportSourceCodec: false` trên WAV **là kết quả đúng**, không phải hỏng: máy này có 16 audio codec encode được nhưng
PCM-S16 không nằm trong danh sách, nên claim "mux lại không mất dữ liệu" sẽ là nói dối. Slice H phải đo lại con số này cho tổ hợp codec
thực sự chọn preset.

### 13.3 Hai FAIL không thuộc slice này, và vì sao không được "sửa cho xanh"

| Spec | Nguyên nhân đo được | Thuộc ai |
|---|---|---|
| `tmcut_login_remember.spec.ts` (3/4 fail) | `app/pages/login.vue` bản working tree lưu lại `password` vào `localStorage` trong `saveCredentials` và khôi phục nó trong `loadSaved`. Đây chính là regression credential đã báo cáo | WIP của chủ repo — file nằm trong danh sách không được đụng |
| `tmcut_process.spec.ts` | `server/utils/processStore.ts:28` trong working tree đổi import tương đối thành `#shared/utils/processStore`, nhưng `package.json` **không có** trường `imports` ở cả HEAD lẫn bản đang chạy, nên tsx không resolve được | WIP của chủ repo |

Không file nào trong hai dòng trên thuộc slice B; sửa chúng nghĩa là sửa code đang dirty của chủ repo, nên chúng được báo
cáo nguyên trạng thay vì làm cho suite xanh.

### 13.4 Chưa chứng minh

- Probe một **video** container thật (MP4/MOV/WebM/MKV) trên desktop: mới chỉ có WAV. Route này phụ fixture; plan §25 gộp
  nó vào slice D, nơi thumbnail cần frame thực sự.
- `measureFrameRate` và VFR sampling trên file VFR thật (mới chỉ pin luật "không giả 30 fps" bằng unit test).
- `probeInfo` chưa có consumer UI nào — slice C là nơi trạng thái import (`queued\|probing\|ready\|partial\|unsupported\|error`)
  xuất hiện trên màn hình.
- Con số codec encode được ở §13.2 là của **máy dev này, phiên bản Chromium/Electron này**, không phải của mọi máy; slice H
  phải nghiệm thu `isConfigSupported` theo từng máy như §8 đã ghi.
---

## 14. Slice A2 — ADR-028…033 và lệnh supersede (ngày 2026-11-03)

Slice A của §8 là "chốt kiến trúc". Nó chia làm hai phần: audit (đã commit ở `1581c3c` + `026c7c6`) và register quyết định — phần này.
Không một dòng code nào bị chạm: toàn bộ slice là docs, và đó là **chủ ý**, vì rule 9 của plan cấm xóa tính năng đang chạy
trước khi cái thay thế có test.

### 14.1 Cái đã ghi, và ghi ở đâu

| Sản phẩm | Ở đâu | Số đo |
|---|---|---|
| Register ADR-028…033, kèm ánh xạ từ dãy ADR-001…006 của plan §26 | `docs/adr/zero-ffmpeg-decisions.md` (file mới) | **214** dòng, đo bằng `split('\n').length` trên bản cuối cùng qua gate; §10 ghi thêm bộ quyết định Q1…Q9 ngày 2026-11-04, bản hiện tại **246** dòng và anchor `#L183` không đổi vì phần thêm nằm **dưới** dòng đó |
| Lệnh supersede **tại chỗ** cho ADR-006 | `docs/tmcut-v4-universal-rendering-multiplatform-roadmap.md` | hàng ADR nằm ở dòng **1503** sau slice (trước: 1501, lệch vì chèn banner) |
| Lệnh supersede **tại chỗ** cho ADR-015 | `docs/v4-phase-0-audit.md:235` | sửa trong một dòng, nên `#L229`/`#L233`/`#L235` mà audit này cite vẫn đúng |
| Prose cho phép FFmpeg tồn tại | V4 roadmap | **14** dòng rewritten + 1 banner chèn sau dòng 8; `git diff --numstat` = **16/14**, `git diff -U0` = 14 hunk một-dòng |
| Trạng thái §5.2, §5.3, §10, §11 của chính audit | file này | §5.2 và §5.3 đóng một phần; §10 trỏ sang register; DoD thêm 2 hàng "một phần" |
| Phép đo lại số witness phía core | §2.3, §7, hàng J của §8, và §14.4 (mới) | Ba con số cũ (10 / 10+2 / 11) quy về **11 + 1 + 2** trên **45** file test core; anchor `#L176` và `#L178` đều được sửa thành `#L183` vì mục 8 của register bản cuối nằm ở dòng **183** (register **214** dòng lúc đó, **242** ở bản hiện tại). |

Ba quyết định thiết kế của phần register, ghi lại vì chúng sẽ bị hiểu sai nếu chỉ đọc bảng:

- **Không xoá hàng ADR cũ.** ADR-006 và ADR-015 vẫn nằm nguyên chỗ cũ, chỉ đổi trạng thái. Code đang cite hai nhãn đó
  (`grep "ADR-015"`), và một lịch sử quyết định bị xoá mất dòng sẽ khiến người sau kết luận rằng code hiện tại *đang* trái quyết định,
  thay vì thấy rằng quyết định đã được thay có ngày và có lý do.
- **Sửa prose, chưa archive.** DoD §25 của plan có mục "không docs hướng dẫn cài FFmpeg". Dán nhãn supersede mà để nguyên
  văn bản cho phép fallback thì mục đó vẫn fail khi grep, nên prose bị sửa ngay; việc archive cả bộ V4 vẫn thuộc slice K.
- **Số 028…033, không phải 001…006.** Đo: `grep -rho "ADR-[0-9]\+" docs/*.md | sort -u` → **27** nhãn; chạy trên cả `docs/` → **28**,
  vì chính audit này từng đặt placeholder `ADR-028`. Dùng lại số của plan sẽ tạo hai ADR-001 cùng tồn tại, và ADR-001 kia
  ("Shared Project/Timeline Core") đang được source code trích dẫn.

### 14.2 Bằng chứng gate

Slice docs-only, nên Gate 2 (ESLint) và Gate 4 (live sweep) khai `N/A` theo đúng luật của pipeline, không bỏ im lặng.

| Gate | Lệnh | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | **PASS** | `TC_EXIT=0` và `grep -c "error TS"` = **0**; `.nuxt/eslint.config.mjs` sinh lại **28535** byte lúc 21:52 |
| 2 Lint | `npx eslint <touched>` | **N/A** | không file nào trong `app/`, `server/`, `packages/` bị chạm |
| 3 Tests | `npx tsx tests/unit/run-all.mts` | **PASS với 2 hàng đỏ có sẵn** | **91/93** specs, `TEST_EXIT=1`. Hai FAIL không thuộc slice này và đỏ từ **trước** slice A (`baseline-zeroff.txt`: 90/92, cũng đúng hai hàng này): `tmcut_login_remember.spec.ts` assert "no secret may reach localStorage" trên `app/pages/login.vue` — file đang `M` trong `git status` (WIP của chủ repo); `tmcut_process.spec.ts` chết ở `ERR_PACKAGE_IMPORT_NOT_DEFINED: "#shared/utils/processStore"` vì `package.json` (cũng đang `M`) **không có field `imports`** nào định nghĩa specifier đó — `git log -S` cho thấy nó chưa từng được commit. Baseline 90/92 → 91/93 là `tmcut_media_probe.spec.ts` mà slice B thêm. |
| 4 Live | — | **N/A** | docs-only, không đụng đường render |
| 5 Docs | năm guard (table_shape, docs_link_integrity, doc_line_length, doc_citations, docs_markdown) + scratch | **PASS** | chạy riêng từng cái trên đúng cây tài liệu cuối cùng (sau mọi lần sửa prose, và chạy lại lần nữa sau khi ghi dòng này): `tmcut_doc_table_shape` **3/3 pass, exit 0**; `tmcut_docs_link_integrity` **4/4 pass, exit 0**; `tmcut_doc_line_length` **4/4 pass, exit 0**; `tmcut_doc_citations` **5/5 pass, exit 0**; `docs_markdown` **12 checks, exit 0**. Năm cái này cũng nằm trong suite ở dòng trên nên Gate 3 và Gate 5 chung một cây. Toàn bộ scratch script đã xoá ở cuối slice. |

### 14.3 Hệ quả buộc slice sau phải mang theo

- Mục **1, 7, 9** của §10 vẫn cần chủ repo xác nhận **trước khi thi hành**: chúng khai tử tính năng (vidstab), xoá 471 MiB binary,
  hoặc thu burn-in về text track. Slice A2 chỉ ghi quyết định; nó không xoá gì.
- `webProbe.ts` vẫn trả `fps: 0` (§5.2) và **vẫn là** đường probe của flow import hiện tại. Slice C phải thay nó bằng `MediaProbeService`,
  nếu không slice B thành một thư viện có test mà không ai gọi.
- Hàng ADR-005 của roadmap (§18) nói "WebCodecs + muxer cho browser export — không bắt buộc FFmpeg"; đó là **điểm chung** với ADR-029/030,
  không phải mâu thuẫn, nên slice này không sửa. Nếu sau này nó được đọc như một ngoại lệ, sửa ở slice K.

### 14.4 Số witness phía core — ba con số cũ, một phép đo lại (slice A2)

Bốn chỗ trong bộ docs này từng mô tả cùng một khối việc (file test phía core mà slice J phải đụng) bằng ba số khác nhau:
§2.3 ghi **10**, §7 ghi **10 cộng 2**, §8 hàng J ghi **11**, register ADR-031 cũng ghi **11**. Không chỗ nào sai hoàn toàn,
nhưng mỗi chỗ dùng một tiêu chí khác nhau và không chỗ nào ghi tiêu chí. Phép đo lại dưới đây chốt cả bốn chỗ,
và §2.3, §7, hàng J của §8 đã được viết lại theo nó.

Lệnh (chạy từ repo root, chỉ đọc, không sửa gì; scratch file bị xóa ngay sau khi đo):

```js
const syms = ['buildFfmpeg', 'stillImageInputFlags', 'buildBackgroundSource', 'maskAlphaExpr', 'volumeExpr', 'panFilter',
  'keyframeExpr', 'rampSetptsExpr', 'lut3dChain', 'normalizeProbe', 'buildVidstab', 'buildProxyArgs', 'parseSceneOutput',
  'parseSilenceOutput', 'FFMPEG_XFADE_NAMES', 'XFADE_POSITION_LAWS', 'nativeFFmpeg', 'ffmpeg', 'ffprobe', 'setpts', 'geq', 'drawtext', 'xfade']
// với mỗi file packages/core/test/*.test.mjs: đọc, lowercase, ghi nhận symbol nào xuất hiện.
// biến thể "ngoài comment": cắt /* */ và // trước khi đếm từ khóa.
```

Kết quả đo ngày 2026-11-03 trên **45** file `packages/core/test`:

| Tiêu chí | Số file | Danh sách |
|---|---|---|
| Từ khóa `ffmpeg\|ffprobe` (kể comment) | **11** | `assets-probe-cache`, `canvas`, `effects`, `evaluate`, `htmlVideo`, `mask`, `platform`, `retime`, `stabilize`, `still-image`, `transitions` |
| Từ khóa ngoài comment | **6** | `canvas` 24, `effects` 13, `platform` 5, `assets-probe-cache` 1, `mask` 1, `stabilize` 1 |
| Tham chiếu symbol do FFmpeg đặt tên | **13** | 11 ở trên trừ `htmlVideo`, cộng `analysis`, `audio`, `keyframes` |
| Hợp hai tập | **14** | 13 + `htmlVideo` |

Ba con số đó trả lời câu hỏi thật, vì slice J xử lý ba tập khác nhau:

- **11 file phải tách assertion** — `analysis`, `assets-probe-cache`, `audio`, `canvas`, `effects`, `evaluate`, `keyframes`,
  `mask`, `retime`, `stabilize`, `still-image`. Đây chính là con số §8 hàng J vẫn ghi, chỉ là bây giờ có danh sách và tiêu chí.
- **1 file (`platform`) mất assertion khi flag chết** — nó chỉ assert `nativeFFmpeg`, thuộc slice I chứ không thuộc J.
- **2 file (`transitions`, `htmlVideo`) chỉ mang tên** — `transitions` assert hình học `XFADE_POSITION_LAWS` (số học, sống sót),
  `htmlVideo` chỉ nhắc FFmpeg trong comment. Không có assertion nào của chúng bị xóa.

Vì `= 11` là số của §8 và `10`/`12` là số của các bản cũ, §2.3 và §7 đã viết lại theo bảng này; hàng J ở §8 giữ nguyên số và
được chú thích thêm nguồn danh sách. Bài học method, ghi lại vì nó sẽ lặp lại ở slice I: **đếm theo tên emitter, không đếm theo từ khóa**
— `analysis` (55 dòng `assert`, chạm `parseSceneOutput` + `parseSilenceOutput`), `audio` (34 dòng, chạm `volumeExpr` + `panFilter`) và `keyframes` (67 dòng, chạm `keyframeExpr`) không có chữ nào trong tên file là "ffmpeg", nhưng mỗi file giữ một phần assertions buộc vào văn bản do emitter FFmpeg sinh ra; số assertion còn lại là số học thuần và slice J phải giữ nguyên chúng.

---

## 15. Q9, Q4, Q5 — ba slice đầu tiên thi hành quyết định của chủ repo (đo ngày 2026-11-04)

Chủ repo trả lời chín câu một lần và chọn thứ tự thực hiện; toàn bộ bộ quyết định nằm ở
[docs/adr/zero-ffmpeg-decisions.md §10](file:///D:/Applications/tm-studio/docs/adr/zero-ffmpeg-decisions.md#L219).
**Ba** câu làm ngay được mà không phá tính năng nào: Q9 (hai lỗi làm đỏ suite), Q4 (biên giới server), Q5 (khoá schema).
Sáu câu còn lại là phạm vi tính năng hoặc dữ liệu (Q1, Q2, Q3, Q6, Q7, Q8) nên chúng thuộc slice C…I, và rule 9 của plan
cấm xoá tính năng đang chạy trước khi cái thay thế có test. Trong ba slice này: **không** route nào bị xoá, **không** tính năng nào bị gỡ,
**không** binary nào bị đụng, **không** field schema nào bị đổi tên.

### 15.1 Q9 — map `#shared/*` cho Node thô, và password rời khỏi localStorage

| Việc | Bằng chứng đo |
|---|---|
| Nguyên nhân đỏ | `tmcut_process.spec.ts` chết ở `ERR_PACKAGE_IMPORT_NOT_DEFINED: "#shared/utils/processStore"`. Nuxt có alias `#shared/*` riêng nên app và Nitro không cần gì thêm; `package.json` **không** có field `imports` nào, và `git log -S` cho thấy nó chưa từng được commit. |
| Hình dạng map đã chốt | `"imports": { "#shared/*": "./shared/*" }` — **một chuỗi, không phải mảng candidate**. Đo trên Node **v24.22.2**: mảng candidate kiểu `["./shared/*.ts", "./shared/*.cjs"]` **không** rơi qua phần tử thiếu; phần tử đầu tiên thay ra một đích không tồn tại là `ERR_MODULE_NOT_FOUND` ngay, nên `#shared/utils/detection-args.cjs` bị tra thành `detection-args.cjs.ts` và chết. Với một đích duy nhất, file `.cjs` resolve đúng như tên ghi, còn module TypeScript không đuôi do loader (tsx) tự đoán đuôi. |
| Guard | `tests/unit/tmcut_shared_imports.spec.ts` — **5 test**: đích là chuỗi `./shared/*`; mọi specifier `#shared/...` trong repo resolve (**9** specifier, đếm thật: `docs/content`, `types/auth`, `types/docs`, `types/electron`, `types/rbac`, `types/webauthn`, `utils/detection-args.cjs`, `utils/processStore`, `utils/stockGuards`); không specifier nào có `..`; import **thật** một module TS không đuôi và một module `.cjs` có đuôi. |
| `app/pages/login.vue` | `git diff HEAD` bắt đầu ở **dòng 125**: từ dòng đó trở xuống là WIP template của chủ repo (96 thêm / 116 xoá), còn toàn bộ phần script **đã khớp HEAD** — và HEAD (`f979005`) chỉ lưu `{ username }`, đồng thời phát hiện payload cũ có `password` thì ghi lại không kèm secret. Bản working copy từng mang dòng ghi password; đã khôi phục hình dạng an toàn và **không commit**, vì commit file đó sẽ mang theo WIP của chủ repo. |

### 15.2 Q4 — server chỉ là storage

Đo: `grep -rl "ZERO-FFMPEG-LEGACY" server` → **6** file (`media/analyze.post.ts`, `media/proxy.post.ts`, `media/render.post.ts`,
`media/render/[jobId].get.ts`, `utils/htmlVideoRender.ts`, `utils/renderJobs.ts`). Bốn file đầu spawn tiến trình; hai file sau chỉ
poll và registry của chính job đó. Marker ở 20 dòng đầu mỗi file, khai tên slice I — file nào spawn thì phải nói ai giết nó.

Guard `tests/unit/tmcut_server_media_boundary.spec.ts` — **5 test**: tập file import `node:child_process` **đúng bằng** danh sách đóng băng
(danh sách được phép co lại khi slice C…H xong, không được phình ra); mỗi file mang marker; ba file storage (`media/upload.post.ts`,
`routes/uploads/[...path].get.ts`, `utils/uploads.ts`) không được đụng `node:child_process`, `spawn(`, hay `tools.ffmpegPath`;
upload vẫn pipe thẳng ra đĩa và trả `/uploads/<stored>`; serve route vẫn `createReadStream(target, { start, end })` và trả 206.
Đó là phần Q4 của chủ repo được ghi thành luật: Web upload **không** mất, vì nó chưa từng là xử lý media.

### 15.3 Q5 — khoá hình dạng project đang ship

Phép đo chạy từ repo root, chỉ đọc, trên cây code hiện tại. Hai hình dạng cùng tồn tại và **cả hai đều thật**:

| Đối tượng | Hình dạng đo được |
|---|---|
| App file (`localStorage` `tmcut_project_<id>`, và cùng object đó ghi ra JSON file qua IPC) | **12** key top-level: `canvas, cover, created_at, durationMs, id, name, revision, schemaVersion, settings, source, timeline, updated_at`. `timeline` có **4** key `durationMs, markers, tracks, version`; `schemaVersion: 3`; `timeline.version: 1`; ba track mặc định `t-text-1, t-video-1, t-audio-1`; `markers` luôn là array |
| Core project (`createProject()` trong `packages/core/src/project.mjs`) | **4** key `canvas, project, timeline, version`; `version: 3`; `timeline` có **3** key `markers, tracks, version`; `timeline.version: 3`; `validateTimeline(project.timeline)` trả `[]`, còn `{ version: 1, tracks: [], markers: [] }` trả `["unsupported timeline version: 1"]` |
| `sequences` | **0** hit trên **420** file shipped — `app` 261, `server` 35, `shared` 16, `electron` 41, `packages/core/src` 56, `packages/core/types` 11 — tổng **104 719** dòng, regex `\bsequences\b` có word boundary nên `choices_consequences` trong prompt chữ không bị tính |
| Nơi duy nhất đọc `timeline.version` | [packages/core/src/timeline.mjs:344](file:///D:/Applications/tm-studio/packages/core/src/timeline.mjs#L344) — luật của DSL core. Không một dòng `app/` nào đọc nhãn `1` của file app, khớp nguyên văn câu "chỉ là nhãn cũ; **không** phải DSL version" ở `docs/v4-phase-0-audit.md:114` |

Guard mới `tests/unit/tmcut_project_schema_v3.spec.ts` — **7 test / 3 suite** — khoá cả hai bảng, cộng luật "stamp là oracle duy nhất"
(`const isLegacy = (project.schemaVersion ?? 1) < TMCUT_PROJECT_SCHEMA_VERSION`) và fail nếu `sequences` xuất hiện ở bất kỳ file shipped nào.

Guard **không** làm hai việc, ghi rõ để slice sau khỏi hiểu sai:
- Không assert hành vi migration (file seconds scale **một** lần, mở lại không scale lần hai, restamp về 3). Việc đó thuộc
  `tests/unit/tmcut_store_behaviour.spec.ts` (ca "legacy seconds file migrates once at open") và vẫn xanh — đó chính là lý do Q5
  không cần ADR migration: không có migration nào được mở.
- Không sửa file plan. Sample `TMCutProject { schemaVersion, appVersion, id, name, settings, assets, tracks, sequences, … }` nằm ở
  `docs/tmcut-zero-ffmpeg-zero-ffprobe-browser-first-roadmap.md:339-347`, là tài liệu **untracked thuộc chủ repo** nên agent không commit và không tự xoá;
  bản đó sai so với code và đã được khai ở §5.4 cùng hàng 5 của register §10.

### 15.4 Bằng chứng gate

| Gate | Lệnh | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | **PASS** | `TC_EXIT=0`, `grep -c "error TS"` = **0**; `.nuxt/eslint.config.mjs` sinh lại **28535** byte lúc 09:28 |
| 2 Lint | `npx eslint tests/unit/tmcut_project_schema_v3.spec.ts` (sau gate 1) | **PASS** | `LINT_EXIT=0`, 0 problem trên đúng 1 file mới |
| 3 Tests | `npx tsx tests/unit/run-all.mts` | **PASS** | **96/96** specs, `TEST_EXIT=0`, **0** hàng FAIL. `tmcut_project_schema_v3.spec.ts` (mới) xanh; `tmcut_login_remember.spec.ts` và `tmcut_process.spec.ts` — hai hàng đỏ baseline mà §14.2 ghi lại — đã xanh từ slice Q9 và vẫn xanh ở đây. Smoke vẫn là opt-in, dòng chót của runner ghi rõ "smoke skipped". |
| 4 Live | — | **N/A** | slice chỉ thêm `tests/unit/*.spec.ts` và docs; không dòng `app/**`, `i18n/**`, `app/assets/css/**` nào bị chạm nên không đường render nào đổi |
| 5 Docs | năm guard `tmcut_doc_table_shape`, `tmcut_docs_link_integrity`, `tmcut_doc_line_length`, `tmcut_doc_citations`, `docs_markdown` + scratch | **PASS** | chạy riêng từng cái trên đúng cây tài liệu cuối cùng (sau mọi lần sửa prose, kể cả lần sửa bảng gate này): `tmcut_doc_table_shape` **3/3 exit 0**; `tmcut_docs_link_integrity` **4/4 exit 0**; `tmcut_doc_line_length` **4/4 exit 0**; `tmcut_doc_citations` **5/5 exit 0**; `docs_markdown` **12 checks, exit 0**. Toàn bộ scratch script đã xoá ở cuối slice. |

### 15.5 Chưa chứng minh

- Q5 khoá **hình dạng đang ship**, không chứng minh hai shape là một. Bridge `ticksTracksToV3` / `applyV3Edit` vẫn nối app tracks với DSL v3 ở tầng tracks;
  guard chỉ chắc một điều: chưa ai nhân danh "schema mới" mà phá shape cũ.
- `timeline.version: 1` của file app vẫn được ghi ra đĩa dù không ai đọc. Xoá nó **cũng là một migration**, nên Q5 để nguyên.
- Phép đo 15.3 chạy trên mirror `localStorage` của harness Node. Project desktop ghi qua `tmcut:writeProject` dùng cùng một object,
  nhưng **chưa** mở lại một file `.json` thật do app Electron sinh ra để đối chiếu key-by-key.
- Slice I vẫn là chỗ duy nhất xoá route và binary; ba slice ở đây không xoá gì.

---

## 16. Slice C1 — hai trục trạng thái của một asset và một khoá cache duy nhất (đo ngày 2026-11-04)

Hàng C của §8 có hai phần. C1 là phần dữ liệu và luật: sáu trạng thái import đi vào record, khoá cache của core trở thành chìa
khoá dẫn xuất duy nhất, và relink reset mọi thứ probe cũ đã học. C2 là phần màn hình (Q6 "Media Offline" + nhãn i18n cho sáu trạng
thái + cache bytes phía client) và **chưa** làm. Phần này trả đúng khoản nợ §13.4 ghi — "`probeInfo` chưa có consumer UI nào":
từ slice này answer của MediaProbeService là thứ quyết định trạng thái của asset trong library, không còn là một hàm chưa ai gọi.

Không có gì bị xoá, theo rule 9: `webProbe.ts` vẫn còn và vẫn là đường trả lời cho `media.probe` cũ (ADR-020), mà
[TmcutTimeline.vue:685](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutTimeline.vue#L685) và
[TmcutTimeline.vue:882](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutTimeline.vue#L882) vẫn đang dùng. Cái đổi là
**ai gọi cái gì**, không phải có bao nhiêu đường probe.

### 16.1 Cái đã dựng

| Lớp | File | Vai |
|---|---|---|
| Bảng trạng thái | `app/utils/tmcut/assetImport.ts` (mới) | `TMCUT_IMPORT_STATES` (đúng sáu tên core, theo thứ tự pipeline đi qua), `assetStatusForImport` verdict → coarse status ở [assetImport.ts:36](file:///D:/Applications/tm-studio/app/utils/tmcut/assetImport.ts#L36), `assetFingerprint` ở [assetImport.ts:48](file:///D:/Applications/tm-studio/app/utils/tmcut/assetImport.ts#L48), `buildAssetRecord` = record khởi đầu của một lần import |
| Hai field | `app/types/tmcut.ts` | `importStatus?` và `fingerprint?` — **optional**, nên record ghi trước slice C vẫn đọc được; test 15 đo đúng đường đó |
| Thu thập | `app/composables/useTmcutMedia.ts` | `probeAssetInfo` probe file **đã lưu** qua URL; `probePickedFile` probe **bytes** picker vừa đưa, lúc chưa tồn tại URL nào; `applyMediaInfo` (`app/composables/useTmcutMedia.ts:332`) MediaInfo → meta + fingerprint; `applyVerdict` (`app/composables/useTmcutMedia.ts:348`) verdict → `importStatus` + `status` + `probedAt` |
| Consumer | `useTmcutMedia.ts` | `analyzeAsset` cả hai nhánh đều đi qua verdict (`app/composables/useTmcutMedia.ts:354`); `importFiles` xếp hàng **đủ** rồi mới probe từng cái; `importWebFiles` chạy upload và demux **song song** trên cùng một file; `checkMissing` bỏ `fnv1aHex` tự nối, gọi `cacheKeyForPath` và backfill fingerprint |
| Panel | `app/components/tmcut/TmcutMediaPanel.vue` | bỏ `probeWebMetadata` và `findAssetBySrc`: relink là một lần `relink(asset.id, uploaded.url, { name: file.name, size: uploaded.size })`, không còn sửa record "hộ" sau khi composable đã persist |
| Test | `tests/unit/tmcut_asset_import.spec.ts` (mới) | 16 check: demuxer thật trên PCM tự viết, một HTTP server trả 206 thật, một IPC fake hình controller desktop, và một `localStorage` đọc lại bằng JSON.parse |

### 16.2 Ba quyết định đáng ghi lại

1. **Hai trục, không gộp.** `status` trả lời "bytes có ở đây không", chủ là `checkMissing`; `importStatus` trả lời "lần đọc cuối
   học được gì", chủ là `analyzeAsset`. `partial` đứng cùng phía `ready` vì nó là clip dùng được kèm cảnh báo (duration ước lượng,
   VFR); `unsupported` và `error` về `error`. Lý do thật là nhánh desktop: khi host trả `ok: false`, một asset mang
   `status: 'missing'` + `importStatus: 'error'` + `fingerprint: null` **cùng lúc**. Gộp lại thành một trục thì hoặc một file trở về
   từ thư mục đã đổi chỗ bị probe lại từ đầu, hoặc một file chưa từng đọc được sẽ trông như "ready".
2. **Một khoá cache, không hai bản tự chế.** Test pin cả giá trị lẫn hình dạng source: `assetFingerprint(path, meta)` bằng
   `cacheKeyForPath` bằng `fnv1aHex("v2:" + mediaFileKey(path) + ":" + mtimeMs + ":" + size)`; trong source của `assetImport.ts` phải
   có `cacheKeyForPath(` và **không** được có `fnv1aHex(`. `mediaFileKey` hạ chữ và đổi slash nên khoá không phân biệt hoa/thường, và
   web có `mtimeMs = 0` nên khoá của một asset web là path + size. Vì thế dedup của `importWebFiles` tách thành `dedupeKey` riêng
   (`web:<name>:<size>`, tính trên file được chọn) chứ không dùng fingerprint của URL `/uploads/` mới — hai lần upload cùng một file
   ra hai URL khác nhau, nếu dùng fingerprint làm khoá dedup thì library sẽ nhận cả hai.
3. **Mirror không chứa File.** `buildAssetRecord` chỉ trả đúng 16 field mà một vòng JSON tái tạo được; `nonJsonValues()` đi đệ quy
   qua record và phải trả `[]` (nó bắt `Blob`, `File`, `Function`, `undefined` lurking trong object); xâu `blob:` không được xuất hiện
   trong `localStorage['tmcut_assets_v1']` sau một lần import; và số `createObjectURL` phải bằng số `revokeObjectURL`. Đó là phần
   "không serialize File object" của hàng C trong §8, đo được thay vì cam kết.

### 16.3 Phần Q6 thi hành được ở tầng dữ liệu

`relink` (`app/composables/useTmcutMedia.ts:817`) xoá **mọi** thứ probe cũ
học được về file trước — `meta` rỗng, `thumbPath`/`filmstripPath`/`waveformPath`/`proxyPath` về null, `fingerprint` về null — vì giữ
lại nghĩa là phát (và đo) bằng chính bytes mà asset không còn trỏ tới. Nhưng nó **không** xoá asset. Check "an unreadable relink
target leaves the asset missing but intact" đo đúng ba điều chủ repo chốt ở Q6: đường dẫn hỏng để nguyên reference (asset vẫn trong
library, `usedBy` còn, clip vẫn trỏ src cũ), trạng thái hỏng báo qua `missingAssets()`, và hàm chỉ trả `false` — không một dialog nào
tự mở.

### 16.4 Bằng chứng đã đo

| Gate | Lệnh | Kết quả | Số đo |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | PASS | `TC_EXIT=0`, `grep -c "error TS"` = **0**; `.nuxt/eslint.config.mjs` sinh lại **28535** byte lúc 10:11 (gate 2 chạy sau đó) |
| 2 Lint | `npx eslint` trên đúng 5 file đã chạm | PASS | lần đầu `LINT_EXIT=1` với **6** lỗi, **cả 6 nằm trong file test mới** (operator-linebreak, max-statements-per-line ×3, no-useless-assignment, no-unused-vars); sửa tay từng lỗi, không `--fix`, không lint repo-wide → `LINT_EXIT=0` |
| 3 Unit | `npx tsx tests/unit/run-all.mts` | PASS | `TEST_EXIT=0`, **97/97** specs, 0 hàng FAIL (smoke vẫn opt-in, runner nói rõ ở dòng chót). `tmcut_asset_import.spec.ts` chạy riêng: **16/16**, `SPEC_EXIT=0` |
| 4 Live | 5 route `/tmcut*` qua CDP, đọc console sau khi mỗi route ổn định | PASS có điều kiện | `/tmcut`, `/tmcut/autocut`, `/tmcut/templates`: **0** `[error]`/`[warn]`/`[issue]`, chỉ dòng `<Suspense>` experimental. `/tmcut/editor` 4× `[error] … 401 (error.unauthorized)` và `/tmcut/factory` 1×: `list_network_requests` quy gán **cả 5** cho `GET /api/v1/ai/relay/catalog` (AI endpoint cần token), **0** request nào thuộc đường media |
| 4b Serve | `/_nuxt/@fs/D:/Applications/tm-studio/<path>` — byte size + nội dung symbol | PASS | `assetImport.ts` **9172**, `useTmcutMedia.ts` **111464**, `TmcutMediaPanel.vue` **205993** byte. Module đã serve có `assetStatusForImport`/`buildAssetRecord`/`cacheKeyForPath`, có `asset.importStatus = "probing"` và **không** có `fnv1aHex`; panel không còn `webProbe` và có `size: uploaded.size` |
| 5 Docs | bốn guard tài liệu + spec mới, chạy trên cây docs cuối cùng | PASS | `tmcut_doc_table_shape` **3/3** exit 0; `tmcut_docs_link_integrity` **4/4** exit 0 (6 link `file:///` mới trong §16, mọi anchor đối chiếu số dòng thật); `tmcut_doc_line_length` **4/4** exit 0; `tmcut_doc_citations` **5/5** exit 0; `docs_markdown` **12** checks exit 0. Chạy lại lần cuối sau khi hàng C của §8 và bốn hàng ADR-029…033 được viết. |

### 16.5 Chưa chứng minh

- **Đường web có token.** `POST /api/v1/media/upload` đo được trả **401 `error.tokenMissing`** khi không có phiên, và agent bị cấm
  đăng nhập, nên golden path import-web mới chỉ chứng minh bằng harness Node (demuxer thật + HTTP 206 thật + mirror thật) và bằng
  module đã serve — chưa phải một cú chuột trên trình duyệt đã sign-in.
- **Cache vật lý phía client chưa tồn tại.** `fingerprint` hôm nay mới là tên dẫn xuất cho slice D và điều kiện cho C2; bytes của web
  host vẫn nằm ở `/uploads/` phía server, nên ADR-033 vẫn **CHỜ** và hàng C của §8 chỉ đóng một nửa.
  *(Cập nhật lượt C2b, đo 2026-11-04, §18: cache vật lý đã tồn tại và đã ghi — dòng này giữ nguyên vì nó là số đo của lượt C1.
  ADR-033 vẫn CHỜ, nhưng khoản mở giờ là **đường đọc** và **thôi bắt buộc upload**, không còn là "chưa có cache".)*
- **`partial` chưa có nguồn thật.** Bảng chuyển và test core pin ý nghĩa của nó, nhưng chưa một probe thật nào trả `partial` qua hai
  nhánh của `analyzeAsset` — cần file VFR thật hoặc container có duration ước lượng, đúng khoản nợ §13.4 đã ghi.
- **Video container trên desktop.** Hai nhánh `ok: false` và `result.stat` đo bằng IPC fake hình controller; chưa mở một fixture
  MP4/MOV/MKV thật (slice D là chỗ fixture được dùng vì thumbnail cần frame).
- **Timeline chưa nhận verdict.** `TmcutTimeline.vue:685` và `:882` vẫn gọi `media.probe` năm field; element probe chỉ mất khi
  timeline chuyển sang `probeInfo`, việc của slice D.
- **Nhãn trên màn hình.** `importStatus` chưa có key nào trong `i18n/locales/en.json` và `vi.json`; chưa có chữ "Media Offline" nào
  được vẽ trên timeline hay preview. Toàn bộ phần C2 còn nguyên.
   *(C2 ngày 2026-11-04 đã đóng cả hai vế — xem §17. Dòng trên giữ nguyên vì nó là số đo của lượt C1.)*


## 17. Slice C2 — chữ trên màn hình cho sáu trạng thái, một bề mặt "Media Offline", một dòng relink duy nhất (đo ngày 2026-11-04)

Nửa còn lại của hàng C trong §8 là **nhãn**, tức thứ mà ảnh chụp màn hình thấy còn lệnh grep thì
không. C2 dựng ba món: một bảng nhìn (trạng thái → chữ + icon + tone) đặt ngay cạnh bảng chuyển
trạng thái của C1, một predicate "offline" duy nhất, và một dòng relink dùng chung cho ba bề mặt.
Nửa "cache bytes phía client" (ADR-033) vẫn còn mở và được tách thành việc riêng ở §17.5, không
khai là xong ở đây.

### 17.1 Cái đã dựng

| File | Vai | Bằng chứng |
|---|---|---|
| [app/utils/tmcut/assetImport.ts:46](file:///D:/Applications/tm-studio/app/utils/tmcut/assetImport.ts#L46) | `TmcutImportTone` + `TmcutImportStateView`: năm tone, một hàng sáu cột | `tmcut_media_offline.spec.ts` check 1: khoá của bảng đúng bằng sáu verdict của core, mỗi hàng có `i-lucide-*` riêng (bảy glyph cho bảy hàng, kể cả `missing`), tone nằm trong union |
| [app/utils/tmcut/assetImport.ts:63](file:///D:/Applications/tm-studio/app/utils/tmcut/assetImport.ts#L63) | `TMCUT_IMPORT_STATE_VIEWS` — bảng nhìn, và chỉ nó định nghĩa tone | check "one state table": `export const TMCUT_IMPORT_STATE_VIEWS` xuất hiện đúng **1** lần trong cả cây app |
| [app/utils/tmcut/assetImport.ts:88](file:///D:/Applications/tm-studio/app/utils/tmcut/assetImport.ts#L88) | `assetStateView`: chữ/icon/tone cho một record, kể cả record chưa có `importStatus` | checks 3-5: `missing` thắng mọi verdict; verdict thắng field thô; record tiền-C1 still reads (`analyzing → probing`, rỗng → `queued`) |
| [app/utils/tmcut/assetImport.ts:100](file:///D:/Applications/tm-studio/app/utils/tmcut/assetImport.ts#L100) | `isMediaOffline`: "clip này không phát được", không phải "file thiếu" | check 6 liệt kê **đúng** 18 tổ hợp (status, importStatus) offline; `ready/partial/queued/probing` với status tử tế đều **không** offline; `null` không offline |
| [app/composables/useTmcutRelink.ts:21](file:///D:/Applications/tm-studio/app/composables/useTmcutRelink.ts#L21) | một dòng pick → store → relink → cover, hai nhánh host, một entry point | check "no component reaches for the picker": quét **toàn bộ** `app/components/tmcut` + `app/pages/tmcut`, không file nào chứa `relink(` hay `importStatus ===` |
| [app/composables/useTmcutRelink.ts:76](file:///D:/Applications/tm-studio/app/composables/useTmcutRelink.ts#L76) | `relinkWithPicker`: `true` = probe nhận, `false` = hỏng thật, **null nội bộ** = người dùng huỷ | hai check hành vi: huỷ (web, không có `document`) và huỷ (desktop, dialog trả `null`) đều **0 toast**, asset giữ nguyên path, library giữ nguyên số asset |
| [app/components/tmcut/TmcutMediaPanel.vue:413](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutMediaPanel.vue#L413) | `importBadge` + chip trên card và trên dòng list; ba chỗ `status === 'missing'` đổi sang `isMediaOffline(asset)` | grid card và list row cùng đọc một hàm; `probing` là hàng duy nhất được phép `animate-spin` |
| [app/components/tmcut/TmcutTimelineClip.vue:142](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutTimelineClip.vue#L142) | plate "Media Offline" trên clip, sọc chéo vàng, kèm nút Relink khi có record | [`:581`](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutTimelineClip.vue#L581) `v-if="mediaOffline"`, [`:600`](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutTimelineClip.vue#L600) `@click.stop="relinkWithPicker(clipAsset)"` |
| [app/components/tmcut/TmcutPreviewPlayer.vue:432](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L432) | plate trong canvas, do record quyết chứ không do decode quyết | [`:1755`](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L1755) `v-if="mediaOffline && !isTrackHidden"`, [`:1786`](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L1786) overlay lỗi cũ thành `mediaLoadError && currentMediaSrc && !mediaOffline` — hai plate không bao giờ chồng nhau |
| `i18n/locales/en.json`, `vi.json` | `tmcut.importStatus.*` (sáu), `tmcut.media.mediaOffline`, `mediaOfflineHint`, dùng lại `missing`/`relink`/`relinked`/`relinkFailed` | check 2 đọc **cả hai** locale: mọi key mà bảng trỏ tới phải có, khác rỗng, không phải echo của chính nó, và sáu nhãn verdict đôi khi khác nhau (không hai verdict cùng một chữ) |
| [tests/unit/tmcut_media_offline.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_media_offline.spec.ts) | 13 check: bảng, locale, hai chiều ưu tiên, truth table, một implementation, hành vi huỷ/relink desktop | `SPEC_EXIT=0`, `13/13` |

Check "a component asks for a verdict and never reaches for a demuxer (rule 12)" trong
`tmcut_asset_import.spec.ts` **đổi hướng** chứ không nới: nó từng assert đúng chuỗi
`relink(asset.id, uploaded.url, { name: file.name, size: uploaded.size })` nằm trong panel; từ C2
nó nằm trong flow dùng chung, nên check giờ đòi panel **không** còn `relink(` và flow **phải** còn
nguyên chuỗi đó. Hợp đồng (picker là nơi duy nhất biết tên file) giữ nguyên, chỉ chủ thể đổi chỗ.

### 17.2 Ba quyết định ghi lại

1. **Một bảng nhìn, không ba bảng tự chế.** Ba bề mặt (library, timeline, preview) đều cần nói
   "trạng thái này trông thế nào". Để mỗi file tự chọn màu và icon thì một verdict mới sẽ được vẽ
   ba kiểu khác nhau, đúng cái lỗi C1 đã giết ở tầng probe. Vì vậy bảng nhìn sống cùng file với
   bảng chuyển trạng thái: thêm một verdict vào `TmcutImportStatus` là hai bảng cùng phải thêm,
   và spec check 1 fail ngay nếu thiếu hàng. `missing` **cố ý** nằm ngoài bảng — nó là sự kiện
   bytes chứ không phải một verdict, nên nó có một hàng riêng trong `assetStateView`.
2. **Huỷ thì im, hỏng thì báo.** `relinkWithPicker` phân biệt ba kết quả: probe nhận (`true`),
   đã chọn file mà editor không dùng được (`false`, một toast warning), và người dùng đóng dialog
   (`null` nội bộ → không toast). Không phân biệt thì mỗi lần Escape lại sinh một cảnh báo đỏ, và
   người dùng học cách phớt lờ cảnh báo — thứ Q6 cần để `partial`/`unsupported` còn có nghĩa.
   Hai check hành vi đo đúng điều này bằng cách đếm toast, không đo bằng mắt.
3. **Plate do record quyết, không do một decode thất bại quyết.** Preview vốn đã có overlay
   `mediaLoadError`, nhưng nó chỉ bật sau khi element báo lỗi — với file đã chết thì người dùng
   thấy khung đen rồi mới thấy chữ, và với asset `unsupported` thì không có decode nào để mà lỗi.
   Plate C2 đọc asset record nên nó lên trước cả lần thử giải mã, và overlay cũ bị trừ đi trường
   hợp đó để hai lớp không chồng chữ lên nhau.

### 17.3 Phần Q6 thi hành được ở tầng UI

Q6(a) có ba vế, cả ba giờ đều có test: (i) chữ "Media Offline" xuất hiện ở timeline, preview và
library — pin bằng check "the three surfaces share the one law"; (ii) **không** tự mở dialog —
check "nothing opens the picker on its own" đọc từng điểm gọi `relinkWithPicker` trong ba file và
đoan không đoạn nào nằm sau `watch(`/`onMounted(`; (iii) **không** xoá reference — hai check hành
vi assert `assets.length` vẫn là 1 sau cả huỷ lẫn relink hỏng, và relink hỏng đích vẫn giữ asset ở
`status: 'missing'` kèm `usedBy` và clip trỏ path cũ.

### 17.4 Bằng chứng đã đo

| Gate | Lệnh | Kết quả | Số đo |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | PASS | `TC_EXIT=0`, `grep -c "error TS"` = **0**; `.nuxt/eslint.config.mjs` sinh lại **28552** byte lúc 10:55, gate 2 chạy sau đó |
| 2 Lint | `npx eslint` trên đúng 7 file đã chạm | PASS | lần đầu `LINT_EXIT=1` với **3** lỗi: 2 × `@stylistic/multiline-ternary` trong `useTmcutRelink.ts` và 1 × `no-unused-vars` (hằng `LAW` chưa được dùng) trong spec mới; sửa tay — ternary thành if-chain, LAW được dùng thêm vào check "one state table" — không `--fix`, không lint repo-wide → `LINT_EXIT=0` |
| 3 Unit | `npx tsx tests/unit/run-all.mts` | PASS | `TEST_EXIT=0`, **98/98** specs (97 → 98), 0 hàng FAIL. Spec mới chạy riêng: **13/13**. `tmcut_asset_import.spec.ts` vẫn **16/16** sau khi check rule 12 đổi hướng |
| 4 Live | 5 route `/tmcut*` trên `:4003`, đọc console sau khi mỗi route ổn định | PASS có điều kiện | **0** dòng `[error]`/`[warn]`/`[issue]` trên `/tmcut`, `/tmcut/autocut`, `/tmcut/templates`, `/tmcut/factory`, `/tmcut/editor`; chỉ có dòng `<Suspense> is an experimental feature`. Route editor bị chặn phiên đăng nhập nên canvas render trang login: chưa một clip thật nào nằm trên timeline ở lượt sweep này |
| 4b Serve | `GET /_nuxt/@fs/D:/Applications/tm-studio/<path>` — byte size + symbol đã compile | PASS | `useTmcutRelink.ts` **11265**, `assetImport.ts` **16724**, `TmcutMediaPanel.vue` **206057**, `TmcutTimelineClip.vue` **113433**, `TmcutPreviewPlayer.vue` **300418** byte, tất cả **HTTP 200** (template SFC compile lỗi sẽ trả 500 ở đây). Module player có `mediaOffline`, `relinkWithPicker`, `t("tmcut.media.mediaOffline")` và `t("tmcut.media.mediaOfflineHint")` (esbuild đổi nháy đơn thành nháy kép); `en.json` **136796** và `vi.json` **138084** byte đều serve nguyên `tmcut.importStatus` sáu khoá |
| 5 Docs | bốn guard tài liệu + `docs_markdown`, chạy trên cây docs **sau khi** viết xong §17, hàng C của §8 và ba hàng ADR | PASS | `tmcut_doc_table_shape` **3/3** exit 0 (236 dòng bảng, 0 dòng sai số cột); `tmcut_docs_link_integrity` **4/4** exit 0 (§17 thêm **14** link `file:///` mới, 13 anchor `#L` đối chiếu bằng số dòng thật, không link nào trỏ file bị git-ignore); `tmcut_doc_line_length` **4/4** exit 0 (dòng dài nhất **894** char, ceiling 1356); `tmcut_doc_citations` **5/5** exit 0; `docs_markdown` **12** checks exit 0 |

### 17.5 Chưa chứng minh

- **Chưa thấy plate bằng mắt.** Route editor cần phiên đăng nhập và agent bị cấm đăng nhập, nên
  C2 chưa có một frame thật nào của "Media Offline" trên timeline hay preview. Chữ, icon và tone
  được chứng minh bằng bảng + locale + module đã compile, **không** bằng ảnh chụp. Cần: một lượt
  QA có token (chủ repo mở editor, gắn một file đã đổi chỗ, bấm Relink).
- **Nhánh web có upload thật chưa đi hết.** Check hành vi web đo đường **huỷ** (`pickWebFiles`
  không có `document` nên trả `[]`), còn đường "chọn file thật → `uploadWebFile` → relink" vẫn chỉ
  chạy trong harness với `$fetch` giả. Đó là cùng khoản nợ "đường web có token" của §16.5.
- **Cache bytes phía client chưa tồn tại.** ADR-033 vẫn **CHỜ**: fingerprint đã là khoá dẫn xuất
  ổn định từ C1, nhưng web host vẫn lấy bytes từ `/uploads/` phía server. Việc này tách thành
  slice **C2b** (IndexedDB/OPFS, giới hạn dung lượng, eviction theo revision), không tính vào C2.
  *Cập nhật lượt C2b (đo 2026-11-04, §18): cache vật lý đã dựng và đã ghi khi import/relink, nên
  câu "chưa tồn tại" không còn đúng; ADR-033 vẫn **CHỜ** vì phần chưa dựng là **đường đọc** —
  playback, probe và thumb vẫn đi từ `/uploads/`, chưa có reader nào lấy bytes từ cache.*
- **`partial` vẫn chưa có nguồn thật.** Bảng nhìn đã có hàng `partial` (warning, tam giác cảnh
  báo), nhưng chưa một probe thật nào trả `partial` qua hai nhánh `analyzeAsset` — cần file VFR
  thật, đúng nợ §13.4.
- **Timeline vẫn tự probe.** `TmcutTimeline.vue:685` và `:882` gọi `media.probe` năm field; plate
  timeline đọc asset record chứ không đọc verdict của probe đó, nên đổi sang `probeInfo` vẫn là
  việc của slice D.


## 18. Slice C2b — máy giữ bản thứ hai của file, và thư mục nói đang giữ bao nhiêu (đo ngày 2026-11-04)

C1 dựng **điều kiện** cho ADR-033 (một khoá dẫn xuất ổn định từ path + revision), C2 dựng **chữ**
cho điều kiện đó. C2b là chỗ ADR-033 thật sự bắt đầu áp dụng: browser tự giữ một bản copy bytes của
asset, đúng dưới fingerprint mà C1 định nghĩa, nên mở lại một dự án không còn buộc phải hỏi một máy
chủ có thể đang không có file. Lượt này dựng ba thứ — **đường ghi** (import và relink mỗi lần giữ
bytes của chính nó), **dọn** (đối chiếu index với backend hai chiều mỗi lần mở library, rồi eviction
theo ngân sách), và **một dòng nhìn thấy được** trong panel media: đang giữ bao nhiêu file, bao
nhiêu byte, và một nút trả lại hết. Đường **đọc** — playback, probe, thumbnail, waveform, export lấy
bytes từ cache thay vì từ `/uploads/` — cố ý **chưa** dựng, và đó là lý do ADR-033 vẫn **CHỜ** chứ
chưa phải đã xong; nói cách khác C2b chứng minh phần **ghi** của ADR-033, chưa chứng minh phần
**local-first**.

### 18.1 Cái đã dựng

| File | Vai | Bằng chứng |
|---|---|---|
| [packages/core/src/byteCache.mjs:10](file:///D:/Applications/tm-studio/packages/core/src/byteCache.mjs#L10) | `TMCUT_BYTE_CACHE_MAX_BYTES` = 2 GiB và `TMCUT_BYTE_CACHE_QUOTA_SHARE` = 0.4 — một disk to không mua được một cache vô hạn | check "a budget is never unlimited, even when the device says nothing": quota `NaN`/0/âm cho budget **đúng bằng trần** chứ không phải `Infinity`, và `Math.floor(quota * 0.4)` khi quota hợp lệ |
| [packages/core/src/byteCache.mjs:37](file:///D:/Applications/tm-studio/packages/core/src/byteCache.mjs#L37) | `isByteCacheKey`: một fingerprint đúng tám hex, **không** gì khác được phép đặt tên file | check "a cache key is exactly one revision fingerprint" liệt kê path, digest in hoa, digest bị cắt và bị nối thêm — tất cả `false`; "a file larger than the whole budget is never copied" đo `byteCacheFits` (file to hơn cả ngân sách thì không vào cache, trước cả eviction) |
| [packages/core/src/byteCache.mjs:68](file:///D:/Applications/tm-studio/packages/core/src/byteCache.mjs#L68) | `planByteCacheEviction(entries, budget, liveKeys)` → `{drop, keep, keptBytes, invalid}`: khoá sai dạng bị **khai** và loại trước; rồi bytes mà library không còn gọi tên; rồi entry không tự lọt; rồi LRU theo `(accessedAt, key)` | bốn checks "eviction drops the leak first…", "bytes whose asset is gone are dropped before the LRU runs", "an entry that cannot fit the budget alone is dropped even when live", "an index entry that is not a fingerprint is reported, not obeyed" đo đúng **thứ tự** drop (không phải chỉ tập drop) và `keptBytes` trong ngân sách; "eviction is deterministic and tolerates a messy index" chứng minh một mảng vào lộn xộn/trùng key vẫn cho **một** kế hoạch duy nhất |
| [packages/core/src/index.mjs:23](file:///D:/Applications/tm-studio/packages/core/src/index.mjs#L23) + `packages/core/src/index.d.ts:2063` | luật được export **và** có khối khai kiểu viết tay (tsup chỉ build runtime; `.d.ts` do `scripts/prepare-dist.mjs` sao sang `dist`, và app type-check lấy `dist`) | check "core declares the byte-cache law to the app": năm tên cộng `TmcutByteCachePlan` phải có trong `.d.ts`. Check này **fail trước** khi khối được viết, và `nuxt typecheck` lúc đó báo 4 × TS2305 |
| [app/utils/tmcut/byteStore.ts:90](file:///D:/Applications/tm-studio/app/utils/tmcut/byteStore.ts#L90) | `byteStoreBackend()`: thang OPFS → IndexedDB → `none`, probe memoised; `none` là **một trạng thái**, không phải exception | checks "the store names the backend it actually reached" và "the store off is a state, not an exception" đo cả ba nhánh; "only one module in the app opens a browser byte store" quét **toàn bộ** cây `app/`: đúng **một** file gọi `getDirectory()` (`byteStore.ts`), và `indexedDB` chỉ xuất hiện ở `byteStore.ts` cùng `useSystemStorage.ts` — file sau xoá database chứ không bao giờ cất một byte |
| [app/utils/tmcut/byteStore.ts:129](file:///D:/Applications/tm-studio/app/utils/tmcut/byteStore.ts#L129) | index `tmcut_byte_index_v1` (Map) là **authority** về việc cache đang mang tên những gì — budget đọc từ nó, panel đọc từ nó | check "the storage layer asks core for every decision": mọi quyết định của store đi qua `byteCacheBudgetBytes`/`isByteCacheKey`/`byteCacheFits`/`planByteCacheEviction`, không một ngưỡng nào tự chế trong `app/` |
| [app/utils/tmcut/byteStore.ts:266](file:///D:/Applications/tm-studio/app/utils/tmcut/byteStore.ts#L266) + [:299](file:///D:/Applications/tm-studio/app/utils/tmcut/byteStore.ts#L299) | `putCachedBytes` chỉ nhận key hợp lệ và file vừa ngân sách; `readCachedBytes` **tự lành**: row nói có mà bytes không còn thì quên row, trả `null`. Cả hai không bao giờ throw | checks "a stored revision reads back as the same bytes", "a read the cache cannot serve is forgotten, not trusted", "an unknown or illegal key never reaches the filesystem", "a file bigger than the budget stays uncached" |
| [app/utils/tmcut/byteStore.ts:326](file:///D:/Applications/tm-studio/app/utils/tmcut/byteStore.ts#L326) | `pruneByteCache` đối chiếu **hai chiều** trước khi chạy luật core: row mất bytes → quên; bytes index không gọi tên → xoá; backend không liệt kê được → **không free gì** lượt đó thay vì đoán | checks "the index and the bytes are reconciled both ways" (dựng cả hai phía vết lệch: row ma và file mồ côi) và "over budget, the least recently used revision is the one freed" |
| [app/utils/tmcut/byteStore.ts:364](file:///D:/Applications/tm-studio/app/utils/tmcut/byteStore.ts#L364) + [:377](file:///D:/Applications/tm-studio/app/utils/tmcut/byteStore.ts#L377) | `byteCacheInfo` (backend, available, entries, usedBytes, budgetBytes) cho panel; `clearCachedBytes` trả lại hết — index luôn rỗng kể cả khi backend từ chối xoá, vì index là authority | check "the IndexedDB fallback really stores and really evicts" khép lại bằng `clearCachedBytes()`: **0** key trong backend và **{}** trong index ("the clear control empties the backend / and the index with it"); check "the store off is a state, not an exception" đo `byteCacheInfo` khi không có store (`backend: 'none'`, `available: false`, `entries: 0`, `prune().dropped === 0`) |
| `app/composables/useTmcutMedia.ts:678` + [app/composables/useTmcutRelink.ts:48](file:///D:/Applications/tm-studio/app/composables/useTmcutRelink.ts#L48) | **đúng hai** chỗ ghi: ngay sau `assets.value.unshift(asset)` khi import web, và `if (ok)` sau `const ok = await relink(...)` khi relink thật sự được probe nhận | RED đo được trước khi nối đường ghi: check này (tên lúc đó "the library keeps a copy under the fingerprint it wrote", nay là "an import keeps its own copy of the bytes") fail với `false !== true`; hai check hành vi assert `cachedByteKeys().has(asset.fingerprint)` — và với relink, key được giữ là fingerprint **mới**, không phải của file đã chết |
| `app/composables/useTmcutMedia.ts:103` + `app/composables/useTmcutMedia.ts:285` | `liveByteKeys()` = tập fingerprint library đang thực sự gọi tên; `loadLibrary()` nhánh web chạy `pruneByteCache(liveByteKeys())` rồi `refreshByteCache()` | check "bytes the library stopped naming are freed on the next open": import hai asset, `removeAsset` một, `libraryLoaded = false`, `loadLibrary()` → bytes của asset đã xoá **không còn** trong store, asset kia vẫn còn |
| [app/components/tmcut/TmcutMediaPanel.vue:78](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutMediaPanel.vue#L78) + [:822](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutMediaPanel.vue#L822) | `cacheLine` (available → "Browser cache: {size} · {count} files", không có store → chữ "off") và một hàng trong panel assets, kèm nút trả lại cache chỉ hiện khi `entries > 0` | check "the library panel tells what is kept and can give it back" đọc source panel và đòi **ba** chuỗi: `byteCache`, `t('tmcut.media.cacheSummary'` và `clearMediaByteCache` ("the user, not the browser, decides when it goes"), rồi đọc **cả hai** locale cho bốn khoá `cacheSummary`/`cacheOff`/`cacheClear`/`cacheCleared` — khác rỗng và không phải echo của key. Hàng render gắn `v-if="isAssetTab && !isDesktop"` ([`:822`](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutMediaPanel.vue#L822)) và nút chỉ hiện khi `byteCache.entries > 0` ([`:825`](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutMediaPanel.vue#L825)) vì desktop đọc file thẳng từ đĩa |
| `i18n/locales/en.json`, `vi.json` | bốn khoá `tmcut.media.cacheSummary`, `cacheOff`, `cacheClear`, `cacheCleared` | check đọc **cả hai** locale: key phải có, khác rỗng, không phải echo của chính nó; serve `en.json` và `vi.json` trên dev server mỗi file **1** lần chuỗi `cacheSummary` |
| [tests/unit/tmcut_byte_cache.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_byte_cache.spec.ts) | 26 check, bốn phần: **9** luật thuần trên core (budget, key, fit, eviction), **9** store trên ba backend giả (read-back, tự lành, key lạ, quá budget, off, IDB, reconcile, LRU), **3** cấu trúc (module scan, store-hỏi-core, `.d.ts` declares), **5** pipeline thật (import, no-store, relink, prune-on-open, panel) | `SPEC_EXIT=0`, `26/26`, `2199ms` — chạy trong plain node, không trình duyệt |

### 18.2 Ba quyết định ghi lại

1. **Luật ở core, storage ở app — và app không được tự quyết một ngưỡng nào.** Ngân sách, tư cách
   key, thứ tự drop đều là những câu hỏi trả lời được bằng số học, nên chúng sống trong
   [packages/core/src/byteCache.mjs](file:///D:/Applications/tm-studio/packages/core/src/byteCache.mjs),
   chỗ không có một API trình duyệt nào và plain node chạy được đúng luật đó. `byteStore.ts` là chỗ
   duy nhất trong `app/` mở OPFS/IndexedDB, và check "only one module in the app opens a browser byte
   store" không tin lời comment: nó quét cây `app/`.
   Vì sao phải ghim: hai backend, một luật; nếu mỗi chỗ tự chọn ngưỡng thì một phiên bản Chrome cũ
   sẽ giữ nhiều gấp đôi một phiên bản khác mà không ai giải thích được.
2. **Fingerprint là hộ chiếu, và index là authority được đối chiếu hai chiều.** Key của một bản copy
   là `assetFingerprint(path, meta)` — chính cái tên C1 đã chọn — nên một revision relink **không
   thể** bị nhầm với file đã chết: fingerprint đổi thì key đổi, và bản cũ rơi vào nhóm "library không
   còn gọi tên" để bị giải phóng ở lượt open kế tiếp. Index đi trước: một row mà bytes không còn bị
   **quên** (đọc tự lành, không throw), một bytes mà index không gọi tên bị **xoá** (không tồn tại
   một file vô hình nào đọc lại được), và một backend không liệt kê được thì **không free gì cả**
   lượt đó — một store không đọc được không cho phép ta đoán nó chứa gì.
3. **Chứng minh phần ghi, chưa vẽ phần đọc.** Ở đây TDD chặn một cách làm "nhanh hơn": sau khi cache
   có bytes, rất tự nhiên để `checkMissing`/probe đọc cache và báo asset `ready` — và đó đúng là lời
   dối C1 vừa giết, vì `<video src>` vẫn trỏ `/uploads/…`: trạng thái nói "có file" trong khi mọi bề
   mặt thật không phát được. Nên C2b chỉ ghi, chỉ dọn, chỉ nói cho người dùng biết đang giữ bao
   nhiêu, và để **đường đọc** cho các slice đã có bề mặt đọc bytes thật: D (thumbnail/filmstrip),
   G (waveform), H (export). ADR-033 vì vậy vẫn **CHỜ** sau lượt này, với blocking mới là D/G/H chứ
   không còn "cache chưa tồn tại".

### 18.3 Bằng chứng đã đo

| Gate | Lệnh | Kết quả | Số đo |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | PASS | `TC_EXIT=0`, `grep -c "error TS"` = **0**. Lần đầu **TC_EXIT=2** với **4** × TS2305 (`'tmcut-core' has no exported member 'byteCacheBudgetBytes'`…): runtime `dist/index.js` có **6** hit nhưng `.d.ts` viết tay có **0** — sửa bằng check khai kiểu (RED) rồi khối `index.d.ts:1937`, build core `npm run build` exit 0; một lần **TC_EXIT=2** khác do 1 × TS2345 ở `byteStore.ts(123,33)` (`quota` có thể `undefined`) → `?? Number.NaN` |
| 2 Lint | `npx eslint` trên đúng 8 file đã chạm | PASS | lần đầu `LINT_EXIT=1` với **12** lỗi: **4** × `@typescript-eslint/no-dynamic-delete` trong `byteStore.ts` (refactor index từ `Record` sang `Map` + helper `keptIndex`, không `// eslint-disable`) và **8** stylistic trong spec (2 sửa bằng `--fix` **phạm vi từng file**, 6 sửa tay: `max-statements-per-line`, `member-delimiter-style`) → `LINT_EXIT=0`; chạy **sau** khi `.nuxt/eslint.config.mjs` sinh lại **28552** byte lúc 12:05, và lint lại lần nữa sau lần sinh đó |
| 3 Unit | `npx tsx tests/unit/run-all.mts` | PASS | `TEST_EXIT=0`, **99/99** specs (98 → 99), 0 hàng FAIL; `PASS tmcut_byte_cache.spec.ts (2199ms) === All 26 byte cache checks passed ===`. Hai RED đo được trước khi viết code: check "the library keeps a copy under the fingerprint it wrote" và check "TMCUT_BYTE_CACHE_MAX_BYTES is declared, not only exported" |
| 4 Live | 5 route `/tmcut*` trên `:4003`, đọc console sau mỗi lần navigate | **BLOCKED** (một phần đo được) | cả năm route — `/tmcut`, `/tmcut/autocut`, `/tmcut/templates`, `/tmcut/factory`, `/tmcut/editor` — **redirect về `/login?redirect=…`**: ảnh chụp `/tmcut` là trang "Welcome back", không phải hub. Điểm đo được: **0** dòng `[error]`/`[warn]`/`[issue]` trên **cả năm** lần navigate, chỉ dòng `<Suspense> is an experimental feature` (noise đã biết) → shell app compile và render sạch, nhưng **hàng cache trong panel media chưa được nhìn thấy bằng mắt**. Agent bị cấm động vào credentials nên cần chủ repo mở phiên ở tab `:4003` rồi sweep lại |
| 4b Serve | `GET /_nuxt/@fs/D:/Applications/tm-studio/<path>` — byte size + symbol đã compile | PASS | `byteStore.ts` **38790**, `useTmcutMedia.ts` **117157**, `useTmcutRelink.ts` **11869**, `TmcutMediaPanel.vue` **210359**, `en.json` **137364**, `vi.json` **158150** byte, tất cả **HTTP 200**. Module serve có `putCachedBytes`/`pruneByteCache`/`byteCacheInfo`/`clearCachedBytes`; `useTmcutMedia` có `cacheAssetBytes` **3** hit; relink **2** hit; panel có `cacheLine` **3** hit, `clearBrowserCache` **3** hit và `cacheSummary` **1** hit; `cacheSummary` **1** hit trong **cả hai** locale serve |
| 5 Docs | bốn guard tài liệu + `docs_markdown`, chạy trên cây docs **sau khi** viết §18, hàng C của §8, ghi chú §16.5/§17.5 và ba chỗ ADR-033 | PASS | `tmcut_doc_table_shape` **3/3** exit 0 (cả cây audit có **260** dòng bảng, 0 dòng sai số cột); `tmcut_docs_link_integrity` **4/4** exit 0 (§18 thêm **22** link `file:///` trên **21** đích, mọi anchor `#L` đối chiếu số dòng thật — `byteCache.mjs` 102, `byteStore.ts` 391, `index.d.ts` 1970, `useTmcutMedia.ts` 1094, panel 1496); `tmcut_doc_line_length` **4/4** exit 0 (dòng dài nhất **1155** char ở hàng C của §8, ceiling 1356); `tmcut_doc_citations` **5/5** exit 0; `docs_markdown` **12** checks exit 0 |

### 18.4 Chưa chứng minh

- **Chưa một cú chuột thật.** Cả năm route `/tmcut*` trên `:4003` đều redirect về trang đăng nhập
  (ảnh chụp viewport của `/tmcut` là "Welcome back", không phải hub), nên chưa thấy dòng cache render
  trong panel, chưa bấm nút trả lại cache, và chưa một lần import thật nào ghi bytes vào OPFS của
  trình duyệt. Điều đo được chỉ là shell app render **sạch**: 0 `[error]`/`[warn]`/`[issue]` trên năm
  lần navigate. Cần: chủ repo mở phiên ở tab `:4003`, import một file, rồi đọc console và nhìn hàng
  cache.
- **ADR-033 chưa đóng — phần đọc.** `readCachedBytes` **không** có một call-site nào ngoài test:
  playback, probe, thumbnail, waveform và export vẫn đọc từ `/uploads/` (desktop: từ đĩa). Bytes nằm
  trong máy hôm nay là bytes **được giữ**, chưa phải bytes **được dùng**, nên local-first chưa thật
  sự có nghĩa ở mặt hành vi. Việc này thuộc D (thumb/filmstrip), G (waveform) và H (export).
- *(**đo lại ở §44, ngày 2026-11-05**: dòng trên là số đo của **hôm 2026-11-04**, và nó đã lỗi về ba leg —
  pixels (D2, §20), silence (E4, §33), waveform (G2, §44). `readCachedBytes` hôm nay có **4** call-site
  trong `app/**`, và §44.5 có bằng chứng một **artifact** được đọc lại sau reload mà không phát request
  `.wav` nào. Phần dòng trên còn đúng: **playback** và **export** vẫn đọc từ `/uploads/` (desktop: từ đĩa),
  nên ADR-033 vẫn **CHỜ**.)*
- **Ba backend mới chạy trên trình duyệt giả.** `installOpfs(...)` và IndexedDB fake đo được **luật**
  (đọc lại đúng byte, reconcile hai chiều, eviction LRU) nhưng chưa phải Chrome/Edge thật: chưa có
  `navigator.storage.estimate()` thật, chưa có `QuotaExceededError` thật khi đĩa gần đầy, chưa có
  trường hợp OPFS bị trình duyệt reclaim giữa hai phiên.
- **Upload server vẫn bắt buộc.** `POST /api/v1/media/upload` vẫn chạy trước khi cache ghi (đường ghi
  nối **sau** bước store thành công), nên web host hôm nay vẫn gửi file lên server. Bỏ bắt buộc đó
  là một quyết định khác (Q4 nói server = storage), không phải việc của C2b.
- **Thang đo dung lượng thật chưa đo.** Budget đọc từ quota thiết bị, nhưng chưa một lượt nào ghi đủ
  asset để chạm trần 2 GiB rồi quan sát thứ tự free trên dữ liệu thật — checks "the index and the
  bytes are reconciled both ways" và "over budget, the least recently used revision is the one
  freed" làm điều đó ở quy mô vài file.
- **Desktop cố ý không cache, chưa có test cho điều đó.** Hàng panel gắn `!isDesktop` và chỉ nhánh
  `importWebFiles` gọi `cacheAssetBytes`; đó là quyết định đúng (desktop đọc file thẳng từ đĩa) nhưng
  chưa một check nào assert một phiên desktop **không** tạo row nào trong index.

---

## 19. Slice D1 — một frame request là một khoảnh khắc, và ai thắng cuộc đua thì được vẽ (đo ngày 2026-11-04)

Slice C dựng **tên** của một revision, C2b dựng **chỗ giữ** bytes của tên đó. Slice D là chỗ đầu tiên
một bề mặt thật đi **hỏi** bytes ấy. Nhưng frame không có "revision" để hỏi: cùng một file, cùng một
thứ tự byte, mà khác một phần tư giây là khác một ảnh. Nên trước khi dựng máy giải mã, D1 dựng
**danh tính** của một request và **luật đua** giữa các request — hai thứ mà desktop và web sắp phải
dùng chung, và nếu mỗi bên tự đặt tên thì đúng là bệnh ADR-032 đã ghi.

Điểm khác mọi luật trước ở đây: check "two hosts asking the same frame build the same key" không chỉ
so hai lời gọi hàm, nó **đọc file desktop đang chạy** (`electron/tools/tmcut.controller.cjs`) và
assert chuỗi key nó tự tay dựng ngày hôm nay. Parity vì thế là một test, không phải một claim trong
docs — và nó sẽ đòi được sửa **cùng lúc** slice I xoá file đó.

### 19.1 Cái đã dựng

| File | Vai | Bằng chứng |
|---|---|---|
| [packages/core/src/frames.mjs:127](file:///D:/Applications/tm-studio/packages/core/src/frames.mjs#L127) | `frameRequestMillis`: instant của một request là **số nguyên millisecond**, làm tròn chứ không cắt; âm/NaN/Infinity/chuỗi là một **lời từ chối** (`null`), không phải frame 0 | check "a frame request is the instant it asks for, to the millisecond" đo `1.2345 → 1235` (round, không floor), `1.2344 → 1234`, `0 → 0`, và bốn dạng vô nghiệm đều `null` — kể cả `'1'`, vì một chuỗi không phải timestamp |
| [packages/core/src/frames.mjs:133](file:///D:/Applications/tm-studio/packages/core/src/frames.mjs#L133) | `frameRequestWidth`: trần **1280**, sàn **16**, mặc định **320**, làm tròn pixel | check "the width a frame asks for is clamped the same on both hosts" đo `6400 → 1280` (một yêu cầu 4K không mua được một lần giải 4K), `5 → 16`, `320.6 → 321`, `NaN → mặc định` |
| [packages/core/src/frames.mjs:143](file:///D:/Applications/tm-studio/packages/core/src/frames.mjs#L143) | `isFrameCacheKey`: một frame chỉ do đúng một request đặt tên — `/^[0-9a-f]{8}-f\d+-w\d+$/`, lấy **hộ chiếu** của C2b (`isByteCacheKey`) làm nửa đầu | check "a frame key never carries a path or a bad fingerprint" liệt kê bảy dạng rác bị từ chối (`deadbeef`, `deadbeef-f3000`, `DEADBEEF-f1-w2`, `deadbeef-f-1-w320`, `…-w320.png`, `/uploads/a.mp4`, chuỗi rỗng, `null`) — một ảnh đang được hiển thị không do một request hợp lệ đặt tên thì không được phép tồn tại |
| [packages/core/src/frames.mjs:155](file:///D:/Applications/tm-studio/packages/core/src/frames.mjs#L155) | `frameRequestKey(fingerprint, atSec, width)` → `deadbeef-f3000-w320`: đúng chuỗi desktop vẫn dùng để đặt tên PNG của nó | check "two hosts asking the same frame build the same key": `3.000 s` và `2.9996 s` là **một** key, `2.999 s` là key khác, width khác/fingerprint khác là key khác; rồi `assert.match` vào đúng template `` `${cacheKeyFor(filePath, stat)}-f${Math.round(wanted * 1000)}-w${px}` `` trong controller |
| [packages/core/src/frames.mjs:168](file:///D:/Applications/tm-studio/packages/core/src/frames.mjs#L168) + [:104](file:///D:/Applications/tm-studio/packages/core/src/frames.mjs#L104) | `frameTimeWithinMedia` + `TMCUT_FRAME_MAX_TIME_SEC` = 24 h: seek quá cuối file thì hỏi **frame cuối thật** (guard 50 ms), duration chưa biết thì mũ **một ngày**, seek âm là bug của caller nên trả `null` | checks "the decoder is asked inside the media" (100 s trong file 10 s → `9.95`, `0.02` trong file 0.01 s → `0`) và "an unknown duration caps instead of pretending" (`7` với duration 0/null vẫn là `7`, `1e9` → `86400`, `-3`/NaN → `null`) — số học lấy từ nhánh desktop đang chạy, không phải từ một suy đoán |
| [packages/core/src/frames.mjs:186](file:///D:/Applications/tm-studio/packages/core/src/frames.mjs#L186) | `createFrameSlotLedger()`: `begin(slot, key)` trả `{token, superseded}`, `isCurrent(slot, token)` trả lời câu "kết quả này còn được vẽ không", `forget(slot)` khi chủ slot biến mất, `size()` để đo rỉ | check "only the newest request for a slot may paint": request thứ hai trên slot `hud` báo `superseded` đúng bằng token thứ nhất, và `isCurrent` với token đó là `false` — chín frame thua cuộc đua của một cú scrub không được phép đè frame thứ mười. Check "a token does not travel between slots or across a forget": token của clip này **không** hủy clip khác, `forget` hai lần không phải lỗi, và slot đã quên **không** tái sử dụng token |
| [packages/core/src/frames.mjs:230](file:///D:/Applications/tm-studio/packages/core/src/frames.mjs#L230) + [:111](file:///D:/Applications/tm-studio/packages/core/src/frames.mjs#L111) | `planFrameCacheEviction(entries, maxEntries)` và trần **512** frame: đếm theo **số frame** chứ không theo byte (thumbnail vài chục KB, 512 cái là vài chục MB — một cache, không phải bản sao thứ hai của thư viện), `drop` báo rác trước rồi LRU, `keep` trả về xếp **cũ trước** để lượt sau lấy từ đầu | check "the frame cache is bounded and drops the least recently used" đo thứ tự drop, `kept`, rằng dưới trần thì không drop gì, rằng trần `0`/`-1`/`NaN` **giữ không gì cả** (một ngân sách không phải ngân sách không được đọc thành "vô hạn" — cùng bệnh C2b đã chữa), rằng row trùng key gom lại và giữ **lần chạm muộn hơn** nên một mảng lộn xộn vẫn cho **một** kế hoạch, và rằng key rác bị **khai** chứ không bị obey |
| `packages/core/src/index.d.ts:339` | khối khai kiểu viết tay cho chín tên mới + hai shape có tên (`TmcutFrameCachePlan`, `TmcutFrameSlotLedger`) — app type-check lấy `index.d.ts`, không lấy runtime | check "core declares the frame-request law to the app" đọc thẳng file `.d.ts`; nó RED trước khi khối được viết (check 1 cũng RED vì `frameRequestMillis` còn `undefined`), nên "export rồi mới khai" không lọt được tới gate 1 |
| `tests/unit/tmcut_frame_cache.spec.ts:53`→`tests/unit/tmcut_frame_cache.spec.ts:200` | **11** checks, chạy trong **441 ms**, không cần fixture và không cần trình duyệt: toàn bộ là số học và một lần đọc file | suite **100/100** specs (99 → 100), `TEST_EXIT=0`, `PASS tmcut_frame_cache.spec.ts (441ms) === All 11 frame request checks passed ===` |

### 19.2 Ba quyết định ghi lại

1. **Danh tính của một frame sống trong core, không sống ở host nào.** Trước D1, desktop tự đặt tên
   PNG của nó bằng một template trong `tmcut.controller.cjs` còn web thì không có thumbnail nào để
   đặt tên. Từ D2, một dịch vụ duy nhất sẽ xin frame cho **cả hai** host, nên "request này là frame
   nào" phải có một câu trả lời — và nó là số học (fingerprint + ms + px), tức thứ chạy được trong
   plain node, tức thuộc core. Vì sao phải ghim: nếu app tự ghép một key khác dạng, cache của browser
   và cache đĩa sẽ âm thầm ngừng trùng nhau, và đúng bug đó là thứ không ai nhìn thấy trên màn hình.
2. **Parity với desktop được pin bằng cách đọc file desktop.** Check 4 không hard-code "desktop đặt
   tên kiểu này"; nó `assert.match` vào template thật trong `electron/tools/tmcut.controller.cjs`.
   Đổi một trong hai bên mà quên bên kia là test đỏ. Đây là cách đã dùng ở C2b ("only one module in
   the app opens a browser byte store" quét cây `app/` thay vì tin comment). Điều phải nhớ: khi slice
   I xoá controller, nửa desktop của check này phải đi theo file — nó là **ràng buộc tạm thời**, không
   phải hằng bất biến.
3. **Ledger có state nhưng vẫn là luật, nên vẫn ở core.** Core đã có một factory stateful
   (`createFrameScheduler`, ADR-031), và `createFrameSlotLedger` không đụng API nào của trình duyệt:
   nó chỉ nhớ token mới nhất của từng slot. Phần thật sự thuộc app là `AbortController` và
   `input.dispose()` — D2 gọi, D1 chỉ trả lời "cái này đã cũ chưa". Ghi rõ ở đây vì cám dỗ ngược lại
   (viết thẳng `if (token !== lastToken)` trong composable) chính là cách ADR-032 bị xói.

### 19.3 Bằng chứng đã đo

| Gate | Lệnh | Kết quả | Số đo |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | PASS | `TC_EXIT=0`, `grep -c "error TS"` = **0**; `.nuxt/eslint.config.mjs` sinh lại **28552** byte lúc **12:36**, gate 2 chạy sau đó |
| 2 Lint | `npx eslint` trên đúng 3 file đã chạm (`frames.mjs`, `index.d.ts`, spec mới) | PASS | `LINT_EXIT=0`, **0** problems; không `--fix`, không lint repo-wide |
| 3 Unit | `npx tsx tests/unit/run-all.mts` | PASS | `TEST_EXIT=0`, **100/100** specs, 0 hàng FAIL (dòng duy nhất chứa "FAILED" là `24 auth refresh checks passed; 0 FAILED`); spec mới **11/11** trong **441 ms**, `tmcut_byte_cache.spec.ts` vẫn **26/26** |
| 3b Core | `node --test test/frames.test.mjs` + `node tools/check-boundaries.mjs` trong `packages/core` | PASS | **4/4** tests exit 0 (luật cũ của `frames.mjs` không đổi hành vi), boundaries **PASS — core imports nothing platform-specific** (`frames.mjs` import thêm `byteCache.mjs`, vẫn thuần node) |
| 4 Live | — | N/A | thay đổi **chỉ ở core**, chưa có call-site nào trong `app/`: `grep` trên `app/ server/ electron/` cho bảy tên mới trả **0** kết quả, nên không một bề mặt render nào đổi |
| 5 Docs | bốn guard tài liệu + `docs_markdown`, chạy trên cây docs **sau khi** viết §19 và ghi hàng D của §8 | PASS | `tmcut_doc_table_shape` **3/3** exit 0 (cả cây audit có **279** dòng bảng, 0 hàng sai số cột); `tmcut_docs_link_integrity` **4/4** exit 0 (§19 thêm **13** link `file:///` trên **3** đích — `frames.mjs`, `index.d.ts`, spec — mọi anchor `#L` đối chiếu số dòng thật: `frames.mjs` **254**, `index.d.ts` **2022**, spec **221**); `tmcut_doc_line_length` **4/4** exit 0 (hàng D mới **896** char, tài liệu vẫn dài nhất **1155** ở hàng C của §8, ceiling 1356); `tmcut_doc_citations` **5/5** exit 0; `docs_markdown` **12** checks exit 0 — cả năm chạy **sau** khi viết §19, không trước |

### 19.4 Chưa chứng minh

- **Không một bề mặt nào gọi luật này.** `frameRequestKey`, `createFrameSlotLedger`,
  `planFrameCacheEviction` và bốn tên kia có **0** call-site ngoài `tmcut_frame_cache.spec.ts` (đo bằng
  `grep` trên `app/`, `server/`, `electron/`). D1 chứng minh **danh tính và thứ tự thắng**, chưa chứng
  minh một frame nào được giải và được vẽ — đó là việc của D2 (service) và D3 (consumer).
- **Chưa giải một frame thật nào.** Không một fixture MP4/MOV/WebM/MKV nào được mở trong lượt này, nên
  nợ cũ §13.4 ("probe một video container thật trên desktop") và §16.5 vẫn còn nguyên; D2/D3 là chỗ nó
  được trả.
- **Parity mới ở mức tên, chưa ở mức pixel.** Check 4 chứng minh hai host **gọi trùng một frame**; chưa có số
  đo nào nói ảnh WebCodecs tại `t` giống ảnh FFmpeg tại `t` trong dung sai nào đó. FFmpeg trả frame có
  presentation timestamp `<= t`, Mediabunny cũng vậy nhưng hai bộ giải mã khác nhau có thể khác nhau ở
  đoạn đầu VFR — chỉ một phép so ảnh thật mới trả lời được, và nó thuộc D3.
- **`TMCUT_FRAME_CACHE_MAX_ENTRIES = 512` là số học dung lượng, không phải số đo.** Chưa chạy một thư
  viện lớn để xem bao nhiêu entry là đủ, và chưa biết chi phí giải thật của một frame trên máy này.
- **Guard 50 ms lấy từ code đang chạy, không từ một nghiên cứu.** `FRAME_TAIL_GUARD_SEC` và trần 24 h
  được sao đúng từ nhánh desktop (roadmap G-1); nếu WebCodecs cần guard khác, D2 sẽ phải nói lại và
  con số này phải đổi công khai kèm test.
- **Luật đua mới chỉ là ledger.** `begin` cho biết ai thua, nhưng chưa có gì **hủy** thật: chưa có
  `AbortController`, chưa có `input.dispose()`, chưa có `revokeObjectURL` cho frame bị loại — tức chưa
  chứng minh rằng một request thua cuộc không còn ngốn CPU. Toàn bộ phần đó cần một service, tức D2.

---

## 20. Slice D2 — một chỗ duy nhất mở decoder, và bytes trong cache được **đọc** lần đầu (đo ngày 2026-11-04)

D1 dựng danh tính và luật đua; D2 dựng **người thực hiện**: một service trả về URL của một frame, và
đúng một module trong `app/` được phép mở container để vẽ frame đó. Lý do phải là **một** chỗ đã ghi ở
ADR-029/030 — hai host cùng hỏi một câu thì phải cùng trả lời một kiểu, không thì cùng một project mở
ở hai cửa sổ sẽ cho hai dải thumbnail khác nhau, và không ai nhìn thấy lỗi đó trên màn hình.

Số đo quan trọng nhất của lượt này không thuộc về frame, mà thuộc về C2b. Ở HEAD (`645d250`),
`git grep readCachedBytes HEAD -- app` trả về **đúng một dòng**: dòng khai báo ở `byteStore.ts:299`.
Tức là cache bytes **đã được viết nhưng chưa lần nào được đọc**. Hôm nay nó có **1** call-site thật, ở
`frameStore.ts:141`, và đó là **đường đọc đầu tiên** mà ADR-033 còn chờ — bốn đường kia (playback,
probe, waveform, export) vẫn chưa có.

*(**đo lại ở §44, ngày 2026-11-05**: "bốn đường kia" hôm nay còn **hai**. Silence (E4) và waveform (G2)
đã đọc cache, và G2 là lần đầu một **artifact** chứ không chỉ một revision được đọc lại; playback và
export vẫn đi `/uploads/` như dòng trên nói.)*

### 20.1 Cái đã dựng

| File | Vai | Bằng chứng |
|---|---|---|
| [app/utils/tmcut/frameDecode.ts:58](file:///D:/Applications/tm-studio/app/utils/tmcut/frameDecode.ts#L99) | `decodeFrame`: chỗ **duy nhất** trong `app/` mở `Input` + `CanvasSink`. Ưu tiên `bytes` đã có trong cache, chỉ đọc `src` khi cache không giữ gì; `signal` abort thì `input.dispose()` ngay | check "one module in the app opens a frame decoder" quét cây `app/` và assert danh sách file chứa `CanvasSink` == `[frameDecode.ts]`, danh sách file import `./frameDecode` == `[frameStore.ts]` — pixel chỉ có một nguồn, nên hai host không thể tự vẽ khác nhau |
| [app/utils/tmcut/frameDecode.ts:38](file:///D:/Applications/tm-studio/app/utils/tmcut/frameDecode.ts#L42) | `hasFrameDecoder()` hỏi `globalThis.VideoDecoder` **trước** khi thử dùng: runtime không có WebCodecs trả `null`, không mượn một engine khác | check "the app has one frame entry point, and a runtime without WebCodecs says null" — `decodeFrame` chạy trong plain node trả `null` chứ không ném |
| [app/utils/tmcut/frameStore.ts:75](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L75) | `createFrameService(decode, { maxEntries })`: **decode là tham số**, không phải import cứng trong luật. Node không có `VideoDecoder`, nên mọi quy tắc quanh nó (đọc bytes nào, bao nhiêu cái một lúc, ai được vẽ, cái gì vẫn được giữ) phải test được mà không cần trình duyệt | **19** checks của `tmcut_frame_service.spec.ts` chạy hết trong **1250 ms** với decoder giả; phần thật sự cần Chrome chỉ là hai mươi dòng ở `frameDecode.ts` |
| [app/utils/tmcut/frameStore.ts:91](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L91) + [packages/core/src/frames.mjs:120](file:///D:/Applications/tm-studio/packages/core/src/frames.mjs#L120) | Pool giải frame, trần lấy từ core: `TMCUT_FRAME_MAX_CONCURRENT = 3` — một con số cho **cả hai** host để không bên nào âm thầm nhân đôi tải | checks "core owns the decoder pool bound, not the app", "both hosts run the same number of decoders" (đọc `MAX_CONCURRENT_FRAMES` trong `useTmcutFrames.ts` và so với core — ràng buộc tạm thời, mất cùng slice I) và "at most the stated number of decoders run at once" đo **peak = 3** khi 8 slot cùng hỏi, và cả 8 đều được trả lời |
| [app/utils/tmcut/frameStore.ts:141](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L141) | Đường đọc byte cache: mọi decode xin `readCachedBytes(fingerprint)` trước, chỉ khi không có bản nào mới đọc `src`; cả hai đều trống thì **từ chối**, không mở một decoder vô vọng | checks "the frame cache is read before any decoder opens" (ghi bytes thật vào `byteStore` với fake OPFS, assert `ask.bytes.size === 5000` và `ask.src === null`), "no cached copy, the location is what the decoder reads", "a frame with nothing to read is refused, not decoded", "a browser with no byte store still gets its frames" |
| [app/utils/tmcut/frameStore.ts:129](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L129) + [:168](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L168) | One-flight theo **key**, không theo slot: hai ask trùng frame thì **một** lần giải, người đến sau nhập vào kết quả đang chạy | checks "two asks for one frame are one decode", "the frame cache answers a repeat ask without a decoder", "the decoder is asked inside the media, at the width it can pay for" (90 s trong file 10 s → `9.95`, width 6000 → 1280, key `deadbeef-f9950-w1280` — mọi con số xin từ core, không tự làm số học) |
| [app/utils/tmcut/frameStore.ts:118](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L118) | `retire(waiter, stillWanted)` — hai luật cùng lúc: ask **thua** cuộc đua bị `abort()` để ngừng trả tiền, nhưng bytes nó đã tạo vẫn **được giữ** (chín frame một cú scrub thua chính là chín frame người dùng sẽ scrub lại); và ask **trùng frame** thì nhập vào, không hủy | "a newer ask for the same slot retires the older one" đo `asks[0].signal.aborted === true`, kết quả cũ trả `null`, mà `deadbeef-f1000-w320` **vẫn nằm trong cache**; "the same slot asking the same frame again keeps its decode" là check **bắt ra lỗi thật**: code trước RED ở `2 !== 1` vì re-ask đã abort chính decode đang chạy |
| [app/utils/tmcut/frameStore.ts:106](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L106) | `evict()` giao kế hoạch cho core (`planFrameCacheEviction`) rồi mới `URL.revokeObjectURL` — service không tự quyết cái nào cũ nhất | "the frame cache is bounded and a released frame gives its URL back" với `maxEntries: 3` đo thứ tự key còn lại sau khi frame thứ tư vào, rằng URL bị đẩy ra **thực sự bị revoke**, và rằng frame vẫn được giữ thì trả từ cache **không** mở decoder |
| [app/utils/tmcut/frameStore.ts:211](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L211) | Một instance chung (`frameService`) + hai hàm `requestFrame` / `forgetFrameSlot`: D3 sẽ nối consumer vào đây, không vào một service riêng | "unmounting a slot stops its pending ask from painting" — `forget('node-hud')` trả `true` (đếm **slot**, theo luật ledger của D1) rồi `false`, và ask đang chờ không vẽ nữa |
| [tests/unit/helpers/tmcut_browser_storage.ts:1](file:///D:/Applications/tm-studio/tests/unit/helpers/tmcut_browser_storage.ts#L1) | Tách fake OPFS + IndexedDB (294 dòng) ra khỏi `tmcut_byte_cache.spec.ts` (891 → **621** dòng) để D2 kiểm thử **integration thật** với `byteStore.ts` thay vì giả gọi nó | `tmcut_byte_cache.spec.ts` vẫn **26/26** sau khi chuyển (`2267 ms`), và checks đọc-cache của D2 đi qua đúng `putCachedBytes`/`readCachedBytes` chứ không qua một stub |
| [tests/unit/tmcut_media_probe.spec.ts:305](file:///D:/Applications/tm-studio/tests/unit/tmcut_media_probe.spec.ts#L305) | Luật của slice B ("một collector sở hữu demuxer") được viết **lại cho đúng**, không nới: guard giờ liệt kê **hai** seam có chủ đích — `mediaProbe.ts` và `frameDecode.ts` — và sort để không phụ thuộc thứ tự readdir | Gate 3 lần đầu **100/101 FAIL** vì check này (`actual` có thêm `frameDecode.ts`): RED thật, hợp đồng đổi vì slice thêm một seam hợp lệ; sửa thành "two seams own the demuxer" và **12/12** xanh, một importer thứ ba vẫn làm đỏ |

### 20.2 Ba quyết định ghi lại

1. **Tách pixel khỏi luật, không tách pixel khỏi app.** `frameDecode.ts` chỉ dài 87 dòng và không biết
   gì về slot, cache hay eviction; `frameStore.ts` không biết gì về Mediabunny. Đổi lại phải chấp nhận
   một sự thật: **19 checks không chứng minh một frame thật nào được giải**. Đó là lý do §20.4 ghi
   đường pixel là chưa chứng minh, và D3 phải trả bằng fixture MP4/MOV thật (nợ §13.4, §16.5).
2. **Thua cuộc đua ≠ lãng phí.** Ledger của D1 trả lời "ai được vẽ", service trả lời "ai còn được trả
   tiền". Hai câu khác nhau nên xử lý khác nhau: cái thua thì abort + dispose, cái thua **đã** tạo ra
   bytes thì giữ bytes và chỉ thu hồi quyền vẽ. Nếu gộp hai câu làm một (abort là xóa cache) thì mỗi cú
   scrub kéo theo một lần giải lại đúng những frame sắp cần.
3. **Re-ask nhập hàng, không hủy hàng.** Đây là defect do test bắt, không do review: slot HUD vẽ lại
   cùng một khoảnh khắc từng abort decode của chính nó rồi khởi động lại. `retire` giờ nhận thêm
   `stillWanted` (`previous?.task.key === key`). Ghi lại vì nó chỉ ra giới hạn của từ "supersede" trong
   ledger: token mới hơn có nghĩa là **quyền vẽ** đổi chủ, không có nghĩa là công việc đang chạy là rác.

### 20.3 Bằng chứng đã đo

| Gate | Lệnh | Kết quả | Số đo |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | PASS | `exit=0`, `grep -c "error TS"` = **0**; `.nuxt/eslint.config.mjs` sinh lại **28552** byte lúc **13:04**, gate 2 chạy **sau** lần sinh đó |
| 2 Lint | `npx eslint` trên 8 file đã chạm | PASS | `exit=0`, **0** problems. Lần chạy đầu báo **1** error trong spec mới (`@stylistic/arrow-parens` ở `:120`), sửa tay rồi lint lại **sau** khi gate 1 sinh config; không `--fix`, không lint repo-wide |
| 3 Unit | `npx tsx tests/unit/run-all.mts` | PASS | `exit=0`, **101/101** specs, 0 hàng FAIL. `tmcut_frame_service.spec.ts` **19/19** (1250 ms), `tmcut_byte_cache.spec.ts` **26/26** (2267 ms), `tmcut_media_probe.spec.ts` **12/12** (1269 ms). Lần chạy **trước** đó là **100/101** — guard seam đỏ, xem dòng cuối §20.1 |
| 3b Core | `node --test test/frames.test.mjs`, `node --test "packages/core/test/*.test.mjs"`, `check-boundaries.mjs`, `tsc -p tsconfig.check.json` | PASS | frames **4/4** exit 0; **cả gói** core **598** tests, **598** pass, **0** fail; boundaries **PASS — core imports nothing platform-specific**; core typecheck exit 0. Luật `TMCUT_FRAME_MAX_CONCURRENT` được test ở tầng app (`tmcut_frame_service.spec.ts`) theo đúng cách D1 đã đặt luật frame trong suite app, không có test trùng trong `packages/core/test` |
| 4 Live | 5 route `/tmcut*` trên `:4003` qua chrome-devtools, tab mới cùng profile, đọc console sau mỗi lần navigate | PASS có điều kiện | `/tmcut` và `/tmcut/autocut`: **0** dòng `[error]`/`[warn]`/`[issue]`; `/tmcut/editor` 401 ×4, `/tmcut/templates` ×2, `/tmcut/factory` ×1. `list_network_requests` quy **toàn bộ** cho `GET /api/v1/ai/relay/catalog` (AI endpoint, đúng dòng §17.3 đã ghi), và `curl` không cookie endpoint này trả **401** → điều kiện phiên của local dev server, **0** request nào thuộc đường media/frame. **Hai module mới của D2 chưa có importer nào trong `app/`** (grep: 1 kết quả duy nhất là một comment), nên không một bề mặt render nào được sweep lần này |
| 5 Docs | năm guard chạy **sau khi** viết §20 và sửa hai hàng C, D của §8 | PASS | `tmcut_doc_table_shape` **3/3** exit 0 (cả cây audit có **300** dòng bảng, 0 hàng sai số cột); `tmcut_docs_link_integrity` **4/4** exit 0 (§20 thêm **13** link `file:///` trên **6** đích, mọi anchor đối chiếu số dòng thật: `frameStore.ts` **219**, `frameDecode.ts` **87**, `frames.mjs` **263**, helper mới **294**, `tmcut_media_probe.spec.ts` **335**); `tmcut_doc_line_length` **4/4** exit 0 (hàng dài nhất **1307** char ở hàng C của §8, ceiling 1356); `tmcut_doc_citations` **5/5** exit 0; `docs_markdown` **12** checks exit 0 |

### 20.4 Chưa chứng minh

- **Không một pixel thật nào.** `decodeFrame` chưa chạy với một container MP4/MOV/WebM/MKV nào: node
  không có `VideoDecoder`, và chưa có bề mặt nào import service. Toàn bộ 19 checks dùng decoder giả trả
  blob giả. Nợ fixture của §13.4 và §16.5 vẫn còn nguyên và thuộc D3.
- **Không một bề mặt nào gọi service.** `requestFrame` / `forgetFrameSlot` có **0** call-site ngoài
  `frameDecode.ts` của comment; `useTmcutFrames.ts` và ba consumer vẫn đi đường cũ (IPC `-ss`). Parity
  "hai host cùng một pipeline" mới được dựng ở mức **code**, chưa ở mức **màn hình**.
- **`TMCUT_FRAME_MAX_CONCURRENT = 3` là số kế thừa, chưa phải số đo.** Con số lấy từ tầng desktop
  (nơi nó chặn N clip × 3 tiến trình FFmpeg). Ở browser, chi phí một lần WebCodecs decode trên máy này
  chưa được đo, nên "3" chưa có bằng chứng dung sai.
- **Pool mới chặn `decode`, chưa chặn `read`.** `acquire()` đứng trước cả hai bước đọc bytes và giải
  mã, nên một khung đang chờ IndexedDB cũng tính là một suất. Với OPFS thật điều đó có thể là đúng —
  chưa đo, và chưa biết liệu pool có nên tách "đọc" khỏi "giải" hay không.
- **Object URL chỉ được revoke theo LRU của chính service.** Chưa có test nào đi qua unmount của một
  component thật, nên rỉ URL nếu D3 quên `forgetFrameSlot` vẫn chưa được chặn bằng hành vi — ledger
  đã có `size()` để đo, nhưng chưa ai gọi nó từ app.
- **Hàng 401 của gate 4 chưa được đóng.** `GET /api/v1/ai/relay/catalog` trả 401 trên `:4003` khi tab
  không có token relay; agent bị cấm đụng credentials, nên cần chủ repo mở phiên để sweep lại một lần
  sạch hoàn toàn.

## 21. Slice D3 — consumer thật đi qua pipeline chung, và pixel thật được **đo** trên cả hai host (đo ngày 2026-11-04)

§20.4 để lại hai món nợ và lượt này trả cả hai: *"không một pixel thật nào"* (nợ fixture của §13.4,
§16.5) và *"không một bề mặt nào gọi service"*. D3 là lượt **nối**, không thêm luật nào vào core, nên
chuẩn của nó không phải "module có tồn tại" mà là hai câu đo được: một bề mặt người dùng nhìn thấy đã
vẽ từ pipeline chung chưa, và một container thật đã được giải ra bytes thật chưa.

Thay đổi nhìn thấy được lớn nhất không nằm trong bảng nào dưới đây: dải thumbnail của một clip và lưới
thumbnail của AutoCut **bỏ được cờ IPC**. Trước D3 cả hai đứng sau `canExtractFrames` — tức là mọi
session browser chỉ nhận poster cấp asset, và mọi con số "parity hai host" của §20 mới ở mức code. Bây
giờ cả hai surface hỏi đúng `frameService` mà Electron hỏi, và phần tử `available` chỉ còn một chỗ
chính đáng: nút snapshot của HUD, vì nó báo tên **file** đã lưu.

### 21.1 Cái đã dựng

| File | Vai | Bằng chứng |
|---|---|---|
| [app/utils/tmcut/frameStrip.ts:57](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStrip.ts#L57) | Luật **thứ hai** của một frame: core trả lời *lấy mẫu ở đâu* (`filmstripTimes`), file này trả lời *hỏi bằng slot nào, bao nhiêu ô, ai được vẽ*. Không tự giải pixel, không tự đặt tên frame — nên service không biết gì về clip và timeline không tự làm phép tính sampling | **11** checks của `tmcut_frame_strip.spec.ts`; "one sampled instant is one ask, at core times and strip width" đối chiếu **từng** `atSec` và **từng** key với `core.filmstripTimes` + `core.frameRequestKey`, và assert mọi ask đều `width === 160` |
| [app/utils/tmcut/frameStrip.ts:53](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStrip.ts#L53) | `stripSlot` đặt tên ô theo **danh tính clip** (`strip:<clipId>#<i>`), không theo range: mount lại cùng clip → cùng slot hỏi cùng frame → service trả từ cache, không mở decoder; trim lại → cùng slot hỏi frame khác → ask cũ bị retire. Và **không** có cache kết quả cấp dải: cache frame đã khoá theo (revision, khoảnh khắc, width), thêm một cache mảng nữa chỉ tạo thêm một cách trả về URL đã bị revoke | checks "the slots belong to the clip, so a remount reuses the frames", "a re-trim retires the older strip instead of racing it"; §21.2 đo lại chính hai hành vi này trong trình duyệt thật (`msSecondRead` = **0 ms**, `reusedSameUrls` = **true**) |
| [app/utils/tmcut/frameStrip.ts:77](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStrip.ts#L77) + [:94](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStrip.ts#L94) | Mọi khoảnh khắc được hỏi **cùng một lúc** (`Promise.all`) — số decoder chạy song song do core quyết, không do số `await` viết tay; `forget(clipKey)` thu hồi **từng** slot mà clip đó từng sở hữu | checks "an owner that leaves takes its asks with it" (đếm slot trả về), "a failed frame leaves its slot empty, not the strip shorter" (một frame chết để lại `''`, dải vẫn đủ `count` ô), "an unreal range asks for nothing" (4/4, NaN, +Infinity, `count: 0` → `[]` và **0** ask), "a junk fingerprint is a strip of holes, not a throw" (`fingerprint: '/uploads/a.mp4'` → toàn `''`, **0** decoder) |
| [app/composables/useTmcutFrames.ts:36](file:///D:/Applications/tm-studio/app/composables/useTmcutFrames.ts#L36) | **Một** reader cho cả session, nên mọi slot của mọi clip nằm trong cùng một ledger và một bản sao của cùng clip hỏi lại đúng những frame đã giải. Composable giờ chỉ còn là **đường nối**: `clipFilmstrip` / `forgetStrip` / `extractFrames`, không có pool riêng | check "the composable delegates the clip strip to the shared service" assert composable chứa `createStripReader`, giữ nguyên bốn tên hàm cho caller cũ và **không** còn `MAX_CONCURRENT_FRAMES` — renderer không được giữ cái đếm decoder thứ hai |
| [app/components/tmcut/TmcutTimelineClip.vue:161](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutTimelineClip.vue#L161) + [:201](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutTimelineClip.vue#L201) | Dải của clip hỏi service với `fingerprint` của asset C1, `durationSec` do **container** trả lời, và `clipKey` là id clip; `onUnmounted` gọi `forgetStrip` nên một clip xoá giữa lúc giải mã ngừng ngay việc trả tiền | check "the timeline clip and the analysis grid show strips on web too": regex `canExtractFrames[\s\S]{0,120}(clipFilmstrip\|extractFrames)` phải **không** khớp ở cả hai file, và ask phải có `clipKey: props.clip.id` + `fingerprint:` |
| `app/pages/tmcut/autocut.vue:351` + `app/pages/tmcut/autocut.vue:366` | Lưới thumbnail theo segment đi qua `extractFrames` với slot `thumb:<assetId>#<i>`; service trả **object URL** nên không còn bước "đường dẫn file cache → `mediaUrl`" mà một session web không bao giờ có | cùng check trên assert `autocut.vue` vẫn gọi `mediaUrl` (để phân giải thứ nó được đưa), và `extractFrames` không còn bị chặn sau cờ IPC |
| [app/components/tmcut/TmcutTimeline.vue:687](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutTimeline.vue#L687) + [:886](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutTimeline.vue#L886) | Hai picker "add video" / "add audio" lấy độ dài clip từ `platform.media.probeInfo` — cùng một service hai host — thay vì chân `platform.media.probe` (ffprobe). Không có độ dài trong container thì giữ nguyên fallback cũ (10 s video, 15 s audio), không đoán | check "the desktop pickers size a clip from the demuxer, not the binary leg" trong [tests/unit/tmcut_media_probe.spec.ts:308](file:///D:/Applications/tm-studio/tests/unit/tmcut_media_probe.spec.ts#L308): `platform.media.probe(` **cấm** trong timeline, đúng **2** call-site `probeInfo`, và một walk toàn cây `app/` assert **không** module nào còn gọi chân đó |
| [app/utils/tmcut/mediaProbe.ts:238](file:///D:/Applications/tm-studio/app/utils/tmcut/mediaProbe.ts#L238) + `tests/fixtures/containers/` | Bốn container **thật** (h264.mp4 **4448** B brand `isom`, h264.mov **4395** B brand `qt  `, h264.mkv **4252** B, vp9.webm **2909** B — cùng 64×36, 0.600000 s, 10 fps) được commit, nên một lần demux không còn phụ thuộc vào máy nào sinh ra nó | **9** checks của [tests/unit/tmcut_real_containers.spec.ts:120](file:///D:/Applications/tm-studio/tests/unit/tmcut_real_containers.spec.ts#L120): mỗi file trả đúng container + codec + duration + raster + **1** video track; `.mov` **không** bị gọi là WebM và ngược lại; cùng file đọc qua **ranged HTTP** trả lời y như đọc bytes (`served.stats.partial > 0`) |
| [tests/unit/tmcut_real_containers.spec.ts:156](file:///D:/Applications/tm-studio/tests/unit/tmcut_real_containers.spec.ts#L156) | Node (không WebCodecs) phải nói **thật** những gì nó làm được: demux vẫn đúng, chỉ vẽ frame là không | check đo `hasWebCodecs === false`, `canDecode === false`, `importStatus === 'partial'`, warning `VIDEO_NOT_DECODABLE` **ghi tên codec thật** (`avc`), và bốn warning bịa (`CONTAINER_UNDEMODABLE`, `DIMENSIONS_UNKNOWN`, `DURATION_UNKNOWN`, `SIZE_UNKNOWN`) **không** xuất hiện |
| [tests/unit/tmcut_frame_service.spec.ts:72](file:///D:/Applications/tm-studio/tests/unit/tmcut_frame_service.spec.ts#L72) | Check "both hosts run the same number of decoders" được viết **lại** thành "the app runs one decoder pool, sized by core": D1/D2 so sánh pool của service với semaphore `-ss` private trong `useTmcutFrames.ts`; D3 chuyển leg đó sang service nên giữ phép so sánh cũ là **khoanh dung hai pool** | check giờ walk `app/` và assert danh sách file chứa `MAX_CONCURRENT_FRAMES\|activeFrameJobs` == `[]` — một pool duy nhất là **cấu trúc**, không phải hai con số trùng nhau |
| `tests/unit/tmcut_platform_adapter.spec.ts:216` | Pin cũ của slice B ("timeline gọi `media.probe`") đã **cũ đi vì luật đổi có chủ đích**, nên sửa **test**, không sửa code: timeline gọi `probeInfo`, và không còn `tempVideo`/`tempAudio` (đo độ dài bằng `<video>`) | `assert.match(timeline, /platform\.media\.probeInfo\(filePath\)/)` + `doesNotMatch(/tempVideo\|tempAudio/)`; lệnh cấm `media.probe` nằm ở `tmcut_media_probe.spec.ts` để một chỗ khai báo một luật |

### 21.2 Pixel thật: số đo trên hai host

Cùng **một** file, cùng **một** code, hai runtime. Browser được đo bằng chính module của repo do dev
server phát (`/_nuxt/@fs/…`, `content-type: text/javascript`) nên không phải một bản build khác, và
bytes fixture phục vụ qua một server scratch có CORS + `Accept-Ranges` để đường `UrlSource` thật sự
chạy. Fingerprints dùng để đo là 8 hex hợp lệ (`deadbeef`, và một giá trị **riêng cho từng file** ở
các dòng "per-file") vì `isByteCacheKey` yêu cầu đúng `/^[0-9a-f]{8}$/`.

| Host | Cái đo | Kết quả |
|---|---|---|
| Node (plain, không WebCodecs) | `probeMedia` trên h264.mp4 / h264.mov / h264.mkv / vp9.webm | container `MP4` / `QuickTime File Format` / `Matroska` / `WebM`; codec `avc` / `avc` / `avc` / `vp9`; duration **0.6** với `durationSource: 'container'`; raster **64×36**; `canDecode` **false**, `importStatus` **'partial'**, warning `VIDEO_NOT_DECODABLE` — **demux được, vẽ thì không**, và đó là câu trả lời trung thực chứ không phải một lỗi |
| Chromium (dev server `:4003`) | `hasFrameDecoder()` + `VideoDecoder.isConfigSupported` | `VideoDecoder` tồn tại = **true**; `avc1.640034` → **true**, `vp09.00.10.08` → **true**. Hai profile đúng với hai codec fixture |
| Chromium | `probeMedia` trên cùng 4 file | **Toàn bộ con số giống Node** (container, codec, duration, raster) và thêm `canDecode: true`, `importStatus: 'ready'`, `warnings: []` → parity là **đo**, không phải assert |
| Chromium | `decodeFrame` một frame 160px | **13606** byte `image/png`, raster **160×90**, luminance trải **0–255** (không phải một khung đen/1 màu) |
| Chromium | `createStripReader(frameService).read` — 8 ô, fingerprint `deadbeef`, mp4 | **8/8** ô có `blob:` URL, mỗi cái **13328–13802** byte ở **160×90**; lần đọc đầu **652 ms**; đọc lại cùng ask **0 ms**, **cùng chính xác** những URL đó, `inFlight() === 0`; `forget()` trả về **8** slot |
| Chromium | per-file, mỗi file một fingerprint riêng (không dùng lại cache) | webm **634 ms**, mkv **514 ms**, mov **799 ms** — cả ba **8/8** ô, `importStatus: 'ready'` |
| Chromium | `<video>.canPlayType` trên cùng file | `video/quicktime` → **`''`** (trình duyệt từ chối hẳn), `video/x-matroska` → `'maybe'`. Nghĩa là **`.mov` được chính app này vẽ đủ 8 still trong khi element video của Chromium còn không nhận nó** — đó là thứ §20 chỉ nói bằng lời |

Số đo đáng ghi nhất nằm ở chỗ nó **không** phải bằng chứng cho app: chạy 4 file với **cùng một**
fingerprint cho ra hai lần đọc **32 ms / 29 ms** và các frame **giống nhau từng byte**. Không có lỗi —
fingerprint **chính là** danh tính revision, nên bốn file cùng danh tính thì là một file. Hệ quả thật
nằm ở caller: truyền sai fingerprint là vẽ pixel của asset khác, và `isByteCacheKey` chỉ chặn được hình
dạng, không chặn được xuất xứ. Vì vậy mọi ask trong D3 lấy `asset.fingerprint` từ hàng asset C1,
không bao giờ từ một chuỗi component tự ghép.

### 21.3 Ba quyết định ghi lại

1. **Không có cache dải, dù nó "miễn phí".** Một cache `clipKey → string[]` sẽ đánh thắng cache frame
   ở đúng một tình huống: người dùng scrub nhanh. Đổi lại nó giữ URL của một dải đã retire, và một lần
   trả `revoke`d URL là một khung trắng không ai giải thích được. Slot theo clip id cho kết quả y hệt
   (0 ms ở §21.2) mà không thêm tầng nào để sai.
2. **`available` chỉ còn ở chỗ nó có nghĩa.** Cờ IPC desktop là câu trả lời cho "runtime này có nói
   được với main process không", không phải cho "có vẽ được frame không". Câu thứ hai thuộc
   `hasFrameDecoder()`. Bỏ cờ khỏi hai surface hiển thị, giữ cờ ở nút snapshot: snapshot **báo tên file
   đã lưu**, mà chỉ main process mới có đường dẫn thật — check "the HUD snapshot keeps reporting a
   file, so it stays desktop-only" chặn cả việc player tự mở một đường frame thứ hai.
3. **Độ dài clip là một câu hỏi về container, không về binary.** `probeInfo` là service duy nhất hai
   host cùng trả lời; `media.probe` (ffprobe) giờ có **0** call-site trong `app/` và chỉ còn trong
   contract cho tới slice I. Ghi lại kèm fallback: một file không có độ dài lưu vẫn nhận 10 s / 15 s
   như nó vẫn nhận — D3 đổi **nguồn** của con số, không đổi cách app xử lý sự thiếu vắng nó.

### 21.4 Bằng chứng đã đo

| Gate | Lệnh | Kết quả | Số đo |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | PASS | `exit=0`, `grep -c "error TS"` = **0**; `.nuxt/eslint.config.mjs` **28552** byte, mtime **14:29** — lần chạy **sau** hai comment-only edit ở `TmcutTimeline.vue`, nên đây là gate 1 cuối cùng mà gate 2 dưới đây dựa vào |
| 2 Lint | `npx eslint` trên **10** file đã chạm, chạy **sau** gate 1 | PASS | Lần đầu `exit=1` với **3** problems, **cả ba ở `tmcut_real_containers.spec.ts`**: 2 × `@stylistic/member-delimiter-style` (`:53`) + 1 × `@typescript-eslint/no-explicit-any` (`:106`). Sửa tay (viết `Map<string, TmcutMediaInfo>` + `import type` từ `tmcut-core`, tách mỗi member một dòng), **không** `--fix`, **không** lint repo-wide → `exit=0`, **0** problems. Sau hai comment-only edit: gate 1 chạy lại (mtime config **14:29**) rồi lint lại **10** file: `exit=0`, **0** problems, config **không** đổi mtime sau đó → kết quả này là kết quả cuối |
| 3 Unit | `npx tsx tests/unit/run-all.mts` | PASS | `exit=0`, **103/103** specs, **0** hàng FAIL — lần chạy **sau** hai comment-only edit. Spec mới: `tmcut_frame_strip` **11/11** (1003 ms), `tmcut_real_containers` **9/9** (1028 ms). Spec đổi nội dung: `tmcut_media_probe` **13/13** (1146 ms), `tmcut_platform_adapter` **12/12** (15759 ms), `tmcut_frame_service` **19/19** (1307 ms) |
| 3b Core | `node --test test/*.test.mjs`, `check-boundaries.mjs`, `tsc --noEmit -p packages/core/tsconfig.check.json` | PASS | core **598** tests / **598** pass / **0** fail, exit 0; boundaries **PASS — core imports nothing platform-specific**; core typecheck exit 0. D3 không thêm luật nào vào core, nên không có test core mới |
| 4 Live | 5 route `/tmcut*` trên `:4003` qua chrome-devtools, đọc console sau mỗi lần navigate | **BLOCKED** | Cả năm route **redirect về `/login`** (`/login?redirect=/tmcut`, `/tmcut/autocut`, `/tmcut/editor`, `/tmcut/templates`, `/tmcut/factory`) — tab QA này không có phiên và agent bị cấm đụng credentials. Trên các page đã tới được: **0** dòng `[error]`, **0** `[warn]`, **1** dòng `[issue]` (a11y "form field should have an id or name", count 9/4/26/29/50 — của **form login**, đã ghi từ §20.4). Nghĩa là **timeline thật với clip thật chưa hề được render trong lượt này**; mọi con số §21.2 là số đo ở tầng module, không phải số đo của một bề mặt người dùng nhìn thấy |
| 5 Docs | năm guard chạy **sau khi** viết §21 **và** sau lần sửa số ở ba hàng trên | PASS | `docs_markdown` **12** checks exit 0; `tmcut_doc_citations` **5/5**; `tmcut_doc_line_length` **4/4** exit 0 (§21 có **17** link tới file trong repo, **cả 17** mang anchor `#L…` và mọi anchor đối chiếu **dòng thật** bằng cách in chính nội dung dòng đó — `frameStrip.ts` **53/57/77/94**, `useTmcutFrames.ts` **36**, `TmcutTimelineClip.vue` **161/201**, `autocut.vue` **351/366**, `TmcutTimeline.vue` **687/886**, `mediaProbe.ts` **238**, `tmcut_real_containers.spec.ts` **120/156**, `tmcut_frame_service.spec.ts` **72**, `tmcut_media_probe.spec.ts` **308**, `tmcut_platform_adapter.spec.ts` **216**; lần đối chiếu đầu phát hiện **3** anchor lệch vì hai comment-only edit ở `TmcutTimeline.vue` (685→687, 883→886) và một anchor trỏ vào thân check thay vì đầu check (117→120, 153→156) — đã sửa số, không sửa code; hàng prose dài nhất của §21 = **118** char, ceiling **1356**); `tmcut_doc_table_shape` **3/3** exit 0 (**30** hàng bảng trong §21, 0 hàng sai số cột); `tmcut_docs_link_integrity` **4/4** exit 0 — **0** link chết, **0** anchor quá số dòng |

### 21.5 Chưa chứng minh

- **Không một bề mặt authed nào.** Gate 4 BLOCKED như trên: dải 8 frame của một clip thật trên
  `TmcutTimelineClip.vue` và lưới thumbnail của AutoCut **chưa từng được nhìn thấy trên màn hình**. Hai
  surface này vừa bỏ cờ IPC, nên đường đi của chúng trên web là **mới toanh** và chỉ có bằng chứng ở mức
  service. Cần một phiên đăng nhập (chủ repo) để sweep lại một lần thật.
- **Overlay "Compile error" trên dev server là dư lượng chẩn đoán của agent, không phải lỗi app.** Khi
  đo §21.2, agent `import()` trực tiếp `mediabunny/src/*.ts` qua `/@fs/`; package đã publish **không**
  kèm thư mục `shared/` mà `src/` tham chiếu (`dist/modules/shared/` có, `mediabunny/shared/` không), nên
  Vite ghi một lỗi transform và Nuxt phát lại nó cho mỗi lần kết nối. Bằng chứng app vẫn lành:
  `import('/_nuxt/@fs/…/app/utils/tmcut/frameDecode.ts')` (chính là module import `mediabunny`) trả
  `hasFrameDecoder() === true`, và mọi request của trang đều 200/304 — không request nào chạm
  `mediabunny/src`. Hai lần đổi-nội-dung `nuxt.config.ts` (đã khôi phục **byte-identical**, hash
  `82fb8a55…`) không đủ xoá lỗi này vì PID dev server giữ nguyên (`12152`); **một lần restart dev server
  thủ công sẽ sạch**, và agent không tự tắt process của chủ repo.
- **AVI vẫn là lỗ của thư viện, không phải của app.** `ALL_FORMATS` của Mediabunny 1.65.1 là HLS, MP4,
  QuickTime, Matroska, WebM, WAVE, OGG, FLAC, MP3, ADTS, MPEG TS — **không có AVI**. Repo cũng **không**
  có một `CONTAINER_MAGIC`/`sniffContainer` nào (không có `packages/core/src/containers.mjs`), và D3
  không tự chế một bộ ngửi header. Vì vậy một file `.avi` thả vào app sẽ đi đường "demux không được",
  nhưng **hành vi thật của nó trên app chưa được đo** — đây là ghi chú để slice E/K quyết định có cần
  một đường báo lỗi riêng cho AVI hay không.
- **Fingerprint dùng khi đo là giá trị tự chọn, không phải fingerprint C1 sinh ra từ asset thật.** Các
  con số §21.2 chứng minh pipeline vẽ đúng với một fingerprint **định dạng hợp lệ**; chúng **không**
  chứng minh chuỗi `asset.fingerprint → byteStore (OPFS thật) → frame` trên một project đã import. Chưa
  có bằng chứng end-to-end nào từ một lần import thật.
- **`TMCUT_FRAME_MAX_CONCURRENT = 3` vẫn là số kế thừa.** 652/634/514/799 ms là thời gian của **cả dải
  8 frame**, không phải chi phí một decoder, và chưa tách được phần chờ IndexedDB khỏi phần giải mã
  (`acquire()` đứng trước cả hai — nợ cũ của §20.4 vẫn còn).
- **Chưa đo trên Electron.** Mọi số browser ở trên lấy từ Chromium của máy dev; WebCodecs của Electron
  (một Chromium bản khác) **chưa** được đo cho đường frame mới. Parity desktop vẫn đang ở mức code +
  Node, chưa ở mức app thật.
- **Chưa có key i18n nào mới.** D3 chỉ đổi nguồn của dữ liệu hiển thị, không thêm chữ nào — nên
  `i18n/locales/en.json` và `vi.json` không đổi, và không có bề mặt nào cần dịch lại.

## 22. Slice E1 — luật phát hiện "cắt cảnh" và "im lặng" nằm trong core (đo ngày 2026-11-04)

ADR-028, hàng 2 của bảng "tính năng nào chết khi cắt engine"
([docs/adr/zero-ffmpeg-decisions.md:204](file:///D:/Applications/tm-studio/docs/adr/zero-ffmpeg-decisions.md#L204)),
đã chốt: Autocut scene/silence **không** khai tử mà "làm lại trên sample đã decode (slice E)". Lý do
nó đứng được ở phía "làm lại" chứ không phải phía "khai tử" (hàng 1, stabilisation): sau slice D, cả
hai **đầu vào** của phép phân tích đều lấy được từ decoder — frame thì `CanvasSink` đã vẽ thật
(§21.2), PCM thì container đã đọc được — nên thứ mất chỉ là cái cách FFmpeg từng trả lời, tức hai
dòng filter và một bloc stderr.

Trước E1, các con số của hai câu hỏi đó nằm ở **hai chỗ không nói chuyện với nhau**: ngưỡng và tốc độ
lấy mẫu nằm trong chuỗi argv của FFmpeg
(`shared/utils/detection-args.cjs:19`, `:24`, `:29` — file đã xoá ở slice I), còn hình dạng câu trả
lời nằm trong hai reader parse stderr
([packages/core/src/analysis.mjs:19](file:///D:/Applications/tm-studio/packages/core/src/analysis.mjs#L19)).
E1 gom hết vào **một** module: luật lấy mẫu ở đâu, hai khung hình khác nhau bao nhiêu thì gọi là cắt,
shot ngắn tới mức nào thì bỏ, im lặng tính bằng dBFS nào, và một đoạn im phải dài bao lâu. App sẽ đưa
một lưới luma và một cửa sổ PCM, không tự quyết gì — đúng khuôn mà D1 đã dựng cho frame.

### 22.1 Cái đã dựng

| File | Vai | Bằng chứng |
|---|---|---|
| [packages/core/src/detection.mjs:27](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L27)→[:39](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L39) | **Năm** hằng số duy nhất: ngưỡng cắt **0.4**, tốc độ lấy mẫu **5 Hz**, ngưỡng ồn **−30 dBFS**, cửa sổ/im tối thiểu **0.5 s**, sàn **−120 dBFS**. Không chỗ nào khác trong repo được phép có bản sao của những số này khi E2/E3 chạy | check "the defaults are one number for both producers" ([packages/core/test/scene-silence-detection.test.mjs:144](file:///D:/Applications/tm-studio/packages/core/test/scene-silence-detection.test.mjs#L144)) đối chiếu **trực tiếp** `detection-args.cjs`: `sceneThreshold(undefined) === 0.4`, `silenceNoise(undefined) === -30`, `silenceDuration(undefined) === 0.5`. Check này là **tạm thời**: nó chết cùng slice I khi argv builder bị xoá |
| [packages/core/src/detection.mjs:78](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L78) | `sceneSampleTimes` **không** tự chế phép chia dải: nó gọi `filmstripTimes` của C14 với `count = floor(durationSec × sampleHz)`. Một dải scan và một dải thumbnail trên cùng clip vì thế không bao giờ đứng ở hai khoảnh khắc khác nhau | check [:27](file:///D:/Applications/tm-studio/packages/core/test/scene-silence-detection.test.mjs#L27): 10 s @5 Hz cho ra **đúng** `core.filmstripTimes(start, duration, 50)` (so từng phần tử), bước đều nhau, và `[]` cho dải dưới 1 mẫu / duration 0 / hz 0 |
| [packages/core/src/detection.mjs:147](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L147) | `sceneScore` = mean abs delta trên lưới luma, chia 255, scale 0..1. Con số **0.4** lấy từ `select='gt(scene,X)'` (`shared/utils/detection-args.cjs:42`, đã xoá ở slice I) nhưng **thang thì không chung** — §23 đo trên clip thật: một cut hard cho core **0.2626** còn FFmpeg cho **0.694299**, nên 0.4 hiện **bỏ sót** chính cut mà nó được kế thừa sang. Lưới **không so sánh được** thì trả `null`, không trả `0` | check [:47](file:///D:/Applications/tm-studio/packages/core/test/scene-silence-detection.test.mjs#L47) đo `0` / `1` / `0.5` (nửa số ô đổi hết dải) và tính **đối xứng** `sceneScore(b,a) === sceneScore(a,b)`; check [:61](file:///D:/Applications/tm-studio/packages/core/test/scene-silence-detection.test.mjs#L61) buộc `null` khi độ dài khác nhau, lưới rỗng, hoặc một ô là `NaN` |
| [packages/core/src/detection.mjs:193](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L193) | `cutsToShots`: sắp xếp, bỏ cut ≤ 0 và ≥ duration, chống rung `minGapSec` **0.04**, bỏ shot dưới `minShotSec` **0.2**, đóng đuôi bằng duration — hoặc bằng cut cuối khi **không biết** duration, vì đó là câu trả lời trung thực chứ không phải một con số đoán | **6** assert của check [:68](file:///D:/Applications/tm-studio/packages/core/test/scene-silence-detection.test.mjs#L68): shot liền mạch, input lộn thứ tự == input đã sắp xếp, shot 0.1 s bị bỏ, `3.00` và `3.02` gộp thành **một** cut, `cutsToShots([4], 0) === [{0,4}]`, `cutsToShots([], 8) === [{0,8}]`, `cutsToShots([], 0) === []` |
| [packages/core/src/detection.mjs:217](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L217) + [:227](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L227) + [:256](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L305) | Thang im lặng: `dbfsOf` (RMS → dBFS, sàn −120 thay cho −Infinity), `levelSeries` (một mức cho mỗi cửa sổ, **cả cửa sổ đuôi cụt**, mẫu không phải số thì bỏ qua chứ không tính là im), `silenceSpans` (chuỗi cửa sổ ≤ ngưỡng, giữ khi đủ dài, đóng ở duration). Hình dạng output **giống hệt** reader stderr để không module phía dưới nào phải học shape mới | checks [:93](file:///D:/Applications/tm-studio/packages/core/test/scene-silence-detection.test.mjs#L93) (`dbfsOf(1) === 0`, `dbfsOf(0.5) === -6.02`, sàn cho 0/âm/NaN), [:103](file:///D:/Applications/tm-studio/packages/core/test/scene-silence-detection.test.mjs#L103) (225 mẫu @100 Hz → **5** cửa sổ `[0,0,sàn,sàn,sàn]`, `[]` khi mẫu rỗng hoặc rate 0), [:117](file:///D:/Applications/tm-studio/packages/core/test/scene-silence-detection.test.mjs#L117) (giữ/bỏ theo độ dài, ngưỡng **bao gồm** `<=`, `NaN` **không** im), [:155](file:///D:/Applications/tm-studio/packages/core/test/scene-silence-detection.test.mjs#L155) (vòng round-trip ticks↔seconds mà app dùng) |
| [packages/core/src/detection.mjs:193](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L193) | `cutsToShots` là **đường duy nhất** biến cut thành shot. Slice E1 ràng buộc reader stderr vào đây; slice J (§55) xoá reader đó, nên hôm nay cut đến từ `sceneCuts` của decoder, còn luật cắt đuôi EOF vẫn nằm nguyên một chỗ | `cutsToShots` giữ nguyên hành vi đã đo ở E1: cut vượt duration bị cắt về duration, không tạo shot dài hơn file. Case đó nay do test của `detection` phủ, không còn reader stderr để đối chiếu |
| [packages/core/src/index.mjs:41](file:///D:/Applications/tm-studio/packages/core/src/index.mjs#L41) + `packages/core/src/index.d.ts:482` | Barrel export + khai báo tay cho detection (`sceneSampleTimes`, `sceneScore`, `sceneCuts`, `cutsToShots`, `dbfsOf`, `peakLevelSeries`, `silenceSpans`), dùng lại `CoreSceneSegment` ([index.d.ts:169](file:///D:/Applications/tm-studio/packages/core/src/index.d.ts#L169)) và `CoreSilenceRange` ([index.d.ts:174](file:///D:/Applications/tm-studio/packages/core/src/index.d.ts#L174)) thay vì chế type trùng | `tsc --noEmit -p packages/core/tsconfig.check.json` (strict + `noUnusedLocals`) exit **0**, 0 `error TS` sau slice J |

### 22.2 Một luật dùng chung phơi ra một lỗi thật của đường cũ

Check thứ hai của `scene-shot-law.test.mjs` (file đó chỉ sống từ E1 tới slice J — §55) là RED **không chủ định**. Nó đưa cho reader một dòng
`pts_time:12` và một file dài 10 s. Trước E1, vòng dựng shot inline trong `parseSceneOutput` cắt đuôi
bằng cách **đo** `stop - start` chứ không khoá `stop` vào duration, nên kết quả là
`[{ start: 0, end: 12 }]` — một shot **dài hơn chính file**. Sau E1, `[{ start: 0, end: 10 }]`.

Bài học sống tiếp sau khi cả hai đường đó bị xoá: `cutsToShots` khoá đuôi vào duration, và đó là luật
duy nhất còn lại mà app đọc. Một reader mới tự dựng shot list là chỗ thứ hai có cơ chế lệch.

Hệ quả trên app là có thật chứ không phải vệ sinh: shot list đổ thẳng vào `scoreSegments`, rồi EDL đổ
vào timeline, nên một shot vượt EOF là một clip mà `validateEdl` hoặc phải chặn hoặc phải chấp nhận
tuỳ hình dạng còn lại của log. Ghi lại đúng mức đã chứng minh: **lỗi nằm trong parser**, và nó được
chứng minh bằng một log **tổng hợp**; việc FFmpeg thật có emit `pts_time` vượt duration trên một file
nào đó hay không thì **chưa đo** — phép đo đó thuộc E4, nơi đường mới và đường cũ chạy trên cùng một
fixture.

### 22.3 Ba quyết định ghi lại

1. **Sửa test hay sửa code?** Check "the stderr reader and the frame scan agree" fail với
   `[{0,12}]`, và lựa chọn thật là nới assertion cho khớp hành vi cũ. Đã **không** làm: assertion
   nói về điều **nên** xảy ra (một shot không dài hơn file), nên code đổi, test giữ nguyên. Đây cũng
   là lần đầu tiên luật của slice E buộc đường cũ phải khớp, không phải ngược lại.
2. **`null` chứ không phải `0`** khi hai lưới không so sánh được. `0` có nghĩa "không có cắt"; `null`
   nghĩa "không có thông tin". Nếu gộp hai thứ, một frame giải mã thất bại (một nửa lưới rỗng) sẽ trở
   thành bằng chứng rằng cảnh **không** đổi — đúng cái loại lỗi mà §21.2 gọi là "một khung trắng không
   ai giải thích được".
3. **`TMCUT_SILENCE_MIN_DURATION_SEC` gánh hai vai**: vừa là `d=` của `silencedetect`, vừa là bề rộng
   một cửa sổ mức. Đó là một **coupling thừa kế từ argv**, không phải một con số đo được; E3 sẽ phải
   nói rõ nó còn chấp nhận được khi nguồn là PCM của decoder hay cần tách thành hai hằng số.

### 22.4 Gate

| Gate | Lệnh | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | PASS | exit **0**, `grep -c "error TS"` = **0**, `.nuxt/eslint.config.mjs` regenerated **28552** byte lúc **15:01** |
| 2 Lint | `npx eslint` trên **6** file đã chạm, chạy **sau** gate 1 | PASS | exit **0**, 0 problems |
| 3 Tests (app) | `npx tsx tests/unit/run-all.mts` | PASS | **103/103** specs, exit **0**, `grep -c "^FAIL"` = **0** |
| 3b Core | `node --test "test/*.test.mjs"` + `check-boundaries.mjs` + `tsc -p packages/core/tsconfig.check.json` | PASS | **609/609** (598 cũ + **11** mới) trong **979 ms**, exit 0; boundaries "PASS — core imports nothing platform-specific"; tsc exit **0** |
| — E1 tests | `node --test test/scene-silence-detection.test.mjs test/scene-shot-law.test.mjs` | PASS | **11** tests / **11** pass / **0** fail / **256 ms** |
| 4 Live | — | N/A | core-only: lượt này **không** đổi file nào dưới `app/`, `i18n/` hay CSS — không bề mặt render nào bị chạm |
| 5 Docs | năm guard `docs_markdown` / `tmcut_doc_citations` / `tmcut_doc_line_length` / `tmcut_doc_table_shape` / `tmcut_docs_link_integrity`, chạy lại **sau** lần sửa cuối của §22 | PASS | **28** checks (**12/5/4/3/4**), exit **0** cả năm; **30** anchor của §22 được in nội dung dòng đích và đối chiếu từng cái — xem §22.6 |

### 22.5 Chưa chứng minh

- **`app/`, `shared/`, `server/`, `electron/`, `tests/` có 0 importer** *(nguyên trạng lúc đóng E1; E2 đã
  thay thế một nửa — xem §23)*. `grep -r` năm tên hàm
  (`sceneSampleTimes`, `sceneScore`, `cutsToShots`, `levelSeries`, `silenceSpans`) và `dbfsOf` trả về
  **0** file ngoài `packages/core` — chưa một mẫu pixel hay PCM thật nào được đưa vào các luật này.
  PCM thì vẫn đúng; pixel thì **không còn đúng** từ §23.
- **Chưa có parity với FFmpeg.** ADR đặt parity (hoặc khai tử có ADR) là **chuẩn nghiệm thu** của slice E;
  nó nằm ở E4, chạy trên fixture `tmcut_detect_smoke` (testsrc2→smptebars cắt ở 1 s, tone rồi im).
  Nhị phân FFmpeg vẫn còn trên máy dev theo Q3b/Q8a — chính vì thế phép đo **đang làm được**, và nó là
  lý do slice I chưa được phép cắt. *(E2 đã chạy phép đo một phần và nó mở ra một defect thật về thang
  điểm — xem §23.)*
- **Các con số luma/PCM là tổng hợp.** `sceneScore` đo trên lưới tự viết, `levelSeries` trên mẫu sine
  tự sinh. Chúng chứng minh **luật** đúng, không chứng minh **pipeline** vẽ ra được những lưới đó —
  đó là việc của E2 (seam luma) và E3 (seam PCM).
- **5 Hz là lựa chọn, không phải kết quả đo.** Nó đủ rẻ để quét một clip nhiều phút bằng pool decoder
  của D2, nhưng "một cut giữa hai mẫu bị bỏ lọt" xảy ra bao nhiêu trên footage thật thì chưa số nào trả lời.
- **Node không chạy nổi leg audio.** `AudioBufferSink` cần AudioContext, chỉ có ở browser/Electron, nên
  thang dBFS mới được kiểm tra ở mức **luật**, chưa ở mức **nguồn**.
- **Chưa có key i18n nào mới**, và không surface nào đổi chữ: E1 chỉ thêm luật vào core.

### 22.6 Vệ sinh

§22 tự kiểm trước khi giao: **30** link `file:///`, in từng dòng đích và đối chiếu **cả 30** với nội
dung thật của dòng đó (không link nào trỏ vào thân một hàm rồi tự nhận là header), **2** bảng —
9 dòng × 3 ô và 9 dòng × 4 ô, không dòng nào lệch ô so với header của chính nó, và dòng prose dài nhất
**116** ký tự. Năm doc guard (`docs_markdown`, `tmcut_doc_citations`, `tmcut_doc_line_length`,
`tmcut_doc_table_shape`, `tmcut_docs_link_integrity`) chạy **sau** lần sửa cuối của §22: exit **0** cả
năm, tổng **28** checks — **12 / 5 / 4 / 3 / 4**, `fail` ở cả năm file bằng **0**. §22 dài **111**
dòng, đưa cả file lên **1345** dòng.

Scratch của lượt này (`e1-red.txt`, `e1-green.txt`, `e1b-red.txt`, `e1b-g3.txt`, `e1c.txt`,
`e1-core-all.txt`, `e1-corets.txt`, `e1-g1.txt`, `e1-g2.txt`, `e1-g3.txt`, `e1f-*.txt`) nằm trong
`node_modules/.cache/tmcut-gates/` (thư mục đã ignore), và **đã xoá sạch** sau lần chạy guard cuối.
Không file nào khác của chủ
repo bị đụng tới: `git status --porcelain` sau khi stage phải ra **đúng 7** dòng —
`packages/core/src/detection.mjs`, `packages/core/src/analysis.mjs`, `packages/core/src/index.mjs`,
`packages/core/src/index.d.ts`, hai file test mới, và chính file này.

## 23. Slice E2 — lưới luma vào core, scene scan chạy thật trong Chromium (đo ngày 2026-11-04)

§22 chốt bằng một câu rất cụ thể: luật đã có nhưng **0 importer**. E2 dựng hai nửa còn lại của đường
scene — core học cách đổi một frame thành **64 số**, `app/` có thêm chỗ đọc pixel, và một module glue
nối hai thứ thành danh sách shot — rồi đưa cả đường đó lên **media thật, trong trình duyệt thật**.
Phép đo ở §23.2 là lý do lượt này tồn tại: chính nó tìm ra một defect mà **không** check nào chạy
trong Node bắt được, vì Node không có decoder.

### 23.1 Đã dựng gì

| Chỗ | Nội dung | Chứng minh bằng |
|---|---|---|
| [packages/core/src/detection.mjs:41](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L41) + [:48](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L48) + [:92](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L92) | `TMCUT_SCENE_GRID_CELLS` **8** (64 số cho một frame), `LUMA_WEIGHTS` BT.601 `[0.299, 0.587, 0.114]`, và `lumaOf` — channel ngoài 0..255 bị **kẹp** chứ không làm hỏng phép tính, channel không phải số thì trả **NaN** để ô đó tố cáo thay vì âm thầm thành 0 | check [:30](file:///D:/Applications/tm-studio/packages/core/test/scene-luma-grid.test.mjs#L30) neo ba màu primaries (đỏ **76**, xanh lục **150**, xanh lam **29**) và xám **128 → 128**; check [:39](file:///D:/Applications/tm-studio/packages/core/test/scene-luma-grid.test.mjs#L39) buộc `lumaOf(-40, 900, 300) === lumaOf(0, 255, 255)` và NaN lan ra |
| [packages/core/src/detection.mjs:112](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L112) | `lumaCells` block-average RGBA → `cells × cells` theo **thứ tự đọc row-major**; frame không vuông dùng được; input cụt / width 0 / height âm trả `[]`; **một** pixel NaN làm rớt **cả** lưới | checks [:49](file:///D:/Applications/tm-studio/packages/core/test/scene-luma-grid.test.mjs#L49) (độ dài và thứ tự), [:55](file:///D:/Applications/tm-studio/packages/core/test/scene-luma-grid.test.mjs#L55) (8×8 sáng/tối → 4×4, lưới **thô hơn** frame chứ không phải một bức ảnh khác), [:66](file:///D:/Applications/tm-studio/packages/core/test/scene-luma-grid.test.mjs#L66), [:72](file:///D:/Applications/tm-studio/packages/core/test/scene-luma-grid.test.mjs#L72), [:81](file:///D:/Applications/tm-studio/packages/core/test/scene-luma-grid.test.mjs#L81) |
| [packages/core/src/detection.mjs:171](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L171) | `sceneCuts` chỉ so **hai mẫu kề**, so **nghiêm ngặt lớn hơn** (`select='gt(scene,X)'` là dấu so nó thay), và **đứt chuỗi tại một lỗ** thay vì bắc cầu: bắc cầu là đặt một cut lên một **đoán** | checks [:23](file:///D:/Applications/tm-studio/packages/core/test/scene-cut-pairs.test.mjs#L23), [:29](file:///D:/Applications/tm-studio/packages/core/test/scene-cut-pairs.test.mjs#L29), [:36](file:///D:/Applications/tm-studio/packages/core/test/scene-cut-pairs.test.mjs#L36) (`[lưới 0, lỗ, lưới 255]` → `[]`), [:45](file:///D:/Applications/tm-studio/packages/core/test/scene-cut-pairs.test.mjs#L45) (cặp **đúng bằng** 0.4 — `flat(0)` vs `flat(102)`, vì `102/255 === 0.4` — **không** là cut), [:54](file:///D:/Applications/tm-studio/packages/core/test/scene-cut-pairs.test.mjs#L54), [:62](file:///D:/Applications/tm-studio/packages/core/test/scene-cut-pairs.test.mjs#L62), [:70](file:///D:/Applications/tm-studio/packages/core/test/scene-cut-pairs.test.mjs#L70), [:76](file:///D:/Applications/tm-studio/packages/core/test/scene-cut-pairs.test.mjs#L76) |
| `packages/core/src/index.d.ts:410`→`packages/core/src/index.d.ts:423` | **Bốn** khai báo mới (`TMCUT_SCENE_GRID_CELLS`, `lumaOf`, `lumaCells`, `sceneCuts`) — `npx tsc --noEmit -p packages/core/tsconfig.check.json` là chỗ duy nhất hợp đồng này được kiểm, vì core là `.mjs` | exit **0**, **0** `error TS` (§23.4 gate 3b) |
| [app/utils/tmcut/frameDecode.ts:144](file:///D:/Applications/tm-studio/app/utils/tmcut/frameDecode.ts#L147) + [:160](file:///D:/Applications/tm-studio/app/utils/tmcut/frameDecode.ts#L163) + [:19](file:///D:/Applications/tm-studio/app/utils/tmcut/frameDecode.ts#L19) | `decodeLumaSeries`: **một** hàm, **một** `Input`, **một** `CanvasSink` cho cả dải; `canvasesAtTimestamps` là lý do nó tồn tại — mỗi packet giải mã **tối đa một lần** cho cả danh sách mốc, điều một vòng `getCanvas` không có; lưới thiếu vẫn được **chèn `null` cho đủ chỗ** ([:166](file:///D:/Applications/tm-studio/app/utils/tmcut/frameDecode.ts#L169)) nên slot không dịch; canvas đọc ở **64 px** ([`TMCUT_SCENE_PIXEL_WIDTH`](file:///D:/Applications/tm-studio/app/utils/tmcut/frameDecode.ts#L19)) vì điểm cắt chỉ so 64 số | check [:186](file:///D:/Applications/tm-studio/tests/unit/tmcut_scene_scan.spec.ts#L186) buộc seam có `lumaCells(` và `canvasesAtTimestamps`, và **không** có `sceneScore`/`sceneCuts`/`cutsToShots` — seam giao pixel, ý nghĩa quyết định ở core |
| [app/utils/tmcut/frameDecode.ts:66](file:///D:/Applications/tm-studio/app/utils/tmcut/frameDecode.ts#L69) + [:116](file:///D:/Applications/tm-studio/app/utils/tmcut/frameDecode.ts#L119) | `openMedia` + `rgbaOf` là **private**: `decodeFrame` (D2) và `decodeLumaSeries` (E2) dùng chung một chỗ mở `Input`, một chỗ gỡ (`close` bỏ listener abort rồi dispose) — không có bản sao thứ hai của đường đọc byte | check [:56](file:///D:/Applications/tm-studio/tests/unit/tmcut_scene_scan.spec.ts#L56) buộc scan **không** chứa `CanvasSink`/`getImageData`, tức glue không thể âm thầm thành một decoder thứ hai |
| [app/utils/tmcut/sceneScan.ts:59](file:///D:/Applications/tm-studio/app/utils/tmcut/sceneScan.ts#L59) | `createSceneScan(readGrids)` nhận người đọc lưới qua tham số nên **toàn bộ** đường plan→read→score→shots chạy được trong Node, không decoder. Dải không thật (NaN, `to <= from`, `times.length === 0`) và signal đã huỷ trả rỗng **trước khi** hỏi decoder ([63](file:///D:/Applications/tm-studio/app/utils/tmcut/sceneScan.ts#L63), [65](file:///D:/Applications/tm-studio/app/utils/tmcut/sceneScan.ts#L65), [68](file:///D:/Applications/tm-studio/app/utils/tmcut/sceneScan.ts#L68)); **< 2 lưới dùng được** cũng trả rỗng ([79](file:///D:/Applications/tm-studio/app/utils/tmcut/sceneScan.ts#L79)) vì `cutsToShots([], duration)` sẽ tuyên bố cả file là **một** shot | **6** trong **11** check của [tests/unit/tmcut_scene_scan.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_scene_scan.spec.ts): dòng 65 (mốc hỏi **bằng đúng** `sceneSampleTimes` của dải đã trim, và **một** lần hỏi cho cả dải), 80, 96, 111, 120 (**4** dải ảo → decoder hỏi **0** lần), 169 |
| [app/utils/tmcut/sceneScan.ts:81](file:///D:/Applications/tm-studio/app/utils/tmcut/sceneScan.ts#L81) + [:85](file:///D:/Applications/tm-studio/app/utils/tmcut/sceneScan.ts#L85) | `threshold` và `sampleHz` người gọi đưa **được chuyển xuống core**, không có bản sao số nào trong `app/`; shot đóng ở `durationSec` khi biết, ngược lại ở mép scan | checks [:140](file:///D:/Applications/tm-studio/tests/unit/tmcut_scene_scan.spec.ts#L140) và [:157](file:///D:/Applications/tm-studio/tests/unit/tmcut_scene_scan.spec.ts#L157) |
| [packages/core/src/detection.mjs:21](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L21)→[:27](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L27) và [packages/core/test/scene-silence-detection.test.mjs:47](file:///D:/Applications/tm-studio/packages/core/test/scene-silence-detection.test.mjs#L47) | **Hai chỗ nói sai đã bị sửa, không bị giữ lại.** Comment cũ tuyên bố 0.4 là "unchanged from the FFmpeg pass"; tên check cũ nói "on the same 0..1 scale AutoCut already knows". §23.2 đo được cả hai **sai về thang**, nên comment nay chép thẳng số đo và tên check nay chỉ còn assertion thật sự chạy | §23.3 quyết định 2 — **sửa claim, giữ nguyên assertion** |

### 23.2 Phép đo thật: đường scene chạy trên clip thật, trong Chromium

Bốn module được `import()` đúng qua URL mà **dev-server đang phát** (`/_nuxt/@fs/D:/Applications/tm-studio/…`),
tức là bản Nuxt compile đang chạy chứ không phải một bản build riêng — cùng kỹ thuật §21.2 đã dùng.
Media phục từ một server scratch trong `node_modules/.cache/tmcut-gates/` (`e2-serve.mjs`), vì phép đo
cần `Accept-Ranges` thật: `Range: bytes=0-99` → **206** `Content-Range: bytes 0-99/55931`, GET đầy đủ →
**200**, **55 931** byte. Clip là fixture của `tmcut_detect_smoke` (`testsrc2` → `smptebars`, cắt ở
**1.000 s**, 128×128, 30 fps, 2 s) — nhị phân FFmpeg trên máy dev chỉ dùng để **sinh fixture**, theo
Q3b/Q8a, không phải một chân chạy runtime.

| Cái đo | Số | Ý nghĩa |
|---|---|---|
| `VideoDecoder` trong trang | **có** | seam chạy WebCodecs thật, không phải đường `null` |
| Hằng số module trả về | `TMCUT_SCENE_PIXEL_WIDTH` **64**, `TMCUT_SCENE_GRID_CELLS` **8**, `TMCUT_SCENE_THRESHOLD` **0.4**, `TMCUT_SCENE_SAMPLE_HZ` **5** | `app/` và core **đọc cùng một số**, không bản sao |
| Mốc core lên kế hoạch, 0→2 s @5 Hz | **0.136, 0.328, 0.52, 0.712, 0.904, 1.096, 1.288, 1.48, 1.672, 1.864** | **10** mốc, cách đều **0.192 s**, nằm trong dải đã trim — seam hỏi đúng cái core định |
| `scan(0 → 2)` | `sampled` **10**, `missing` **0**, **10/10** lưới dài **64** | decoder giao đủ mẫu thật, không lỗ |
| 9 điểm `sceneScore` của 9 cặp kề | **0.0261, 0.0285, 0.0288, 0.0276, 0.2626, 0.0009, 0, 0, 0.0001** | cặp thứ **5** (0.904→1.096) là cut; đáy ồn trong shot **≤ 0.0288** |
| `scan` với ngưỡng **0.4** đang kế thừa | `cuts` **`[]`**, `shots` **`[{0, 2}]`** | **DEFECT: bỏ sót chính cut 1.000 s** |
| FFmpeg `select='gt(scene,0)'` trên **cùng file** | **39** dòng metadata; frame cut `pts_time 1` = **0.694299**; **38** frame còn lại trong **0.000020 → 0.025815** | FFmpeg thấy cut vì thang của nó **đẩy cut lên ~0.69**; thang của core đẩy cùng cut đó lên **0.2626** |
| `scan` với `threshold: 0.1` | `cuts` **`[1.096]`**, `shots` **`[{0, 1.096}, {1.096, 2}]`** | cả đường **plan→decode→grid→score→shot** đúng; chỉ **một con số** sai |
| `scan` với `sampleHz: 10` | `sampled` **20**, `cuts` **`[1.048]`** | sai số định vị **0.096 s** (≈2.9 frame) @5 Hz → **0.048 s** (≈1.4 frame) @10 Hz — cái giá thật của tốc độ lấy mẫu |
| `scan(1.2 → 2)` (trim sau cut) | `sampled` **4**, `cuts` **`[]`** | scan **đúng** dải đã trim: cut ở 1.0 s nằm ngoài tầm hỏi nên **không** được báo |
| `scan` với signal đã huỷ | `sampled` **0**, `missing` **0**, `cuts` **`[]`**, `shots` **`[]`** | seam không mở decoder cho một ask không còn ai nhận |
| Thời gian | **100 ms** lần đầu, **66 ms** lần hai, cho 10 mẫu trên 2 s | một lần hỏi `readGrids` cho cả dải (`asks` **1**) |
| Ô của lưới shot hai | `191, 171, 143, 116, 95, 100, 80, 51` lặp lại trên mỗi dòng | **tám** vạch SMPTE theo đúng thứ tự — bằng chứng lưới đọc **row-major** và không dịch cột |

Khoảng phân biệt đo được là **(0.0288, 0.2626]**: mọi ngưỡng trong khoảng đó bắt được cut này mà vẫn
đứng trên đáy ồn. **0.4 nằm trên đỉnh khoảng**, nên nó **không phải** một ngưỡng "chưa kịp chỉnh" —
nó bảo đảm bỏ sót.

### 23.3 Bốn quyết định

1. **Không chỉnh 0.4 thành một số mới ngay lượt này.** Một clip là một **data point**, không phải một
   phép hiệu chuẩn: E4 phải so trên nhiều nội dung thật (footage nói chuyện có chuyển động nhanh, nơi
   đáy ồn của lưới chắc chắn cao hơn 0.0288) rồi mới chọn. Cái E2 làm là **ghi con số vào chỗ mà
   người đọc hợp đồng nhìn thấy** — comment của `TMCUT_SCENE_THRESHOLD` nay chép cả hai phía của phép
   đo, và `packages/core/src/index.d.ts:397`
   nói thẳng "NOT its scale". Giữ nguyên giá trị **để parity của E4 đo trên cùng một mốc**, không phải
   vì tin nó đúng.
2. **Sửa claim, giữ nguyên assertion.** Assertion của check cũ (`0` / `1` / `0.5`, tính đối xứng) vẫn
   **đúng** — nó định nghĩa thang 0..1 của core. Chỉ **phần tên** đòi "same scale AutoCut already
   knows" là sai, và claim "cùng thang" ở dòng `sceneScore` của §22 cũng sai theo. Cả hai đều đã được
   sửa.
   Đây là đúng nguyên tắc của lượt này: khi test nói sai luật, **sửa test**, không nắn code cho khớp
   một câu quảng cáo.
3. **Seam pixel ở lại `frameDecode.ts`, không mở module thứ ba.** [tests/unit/tmcut_scene_scan.spec.ts:195](file:///D:/Applications/tm-studio/tests/unit/tmcut_scene_scan.spec.ts#L195)
   liệt kê thư mục và buộc các file chứa `from 'mediabunny'` là **đúng** `['frameDecode.ts', 'mediaProbe.ts']`.
   E3 (PCM) **sẽ** phải đổi guard này thành ba — đó là chủ đích, và nó bắt người thêm seam phải giải
   thích thay vì âm thầm.
4. **Phải reload tab trước khi đo — nếu không, con số mô tả code cũ.** Lần chạy **đầu tiên** của phép
   đo trên import `packages/core/src/index.mjs` trả về **373** export và **không** có `sceneSampleTimes`
   / `TMCUT_SCENE_THRESHOLD` / `dbfsOf` — tức bản core **trước slice E**, dù `curl` cùng URL trả về bản
   hiện tại và `detection.mjs` đã được export. Module **mới** (`sceneScan.ts`) thì import đúng, vì nó
   chưa từng nằm trong bộ nhớ trang. Sau `navigate_page` reload: **388** export, đủ các hàm E1/E2.
   Kết luận thao tác: mọi phép đo live trên code vừa sửa đều phải **reload trước**, và một kết quả
   "undefined" không có nghĩa code hỏng.

### 23.4 Gates (chạy theo thứ tự, sau **mọi** lần sửa)

| Gate | Lệnh | Kết quả | Chứng cứ |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | PASS | exit **0**, **0** `error TS`; `.nuxt/eslint.config.mjs` **28 552** byte, mtime **15:38** (cấu hình sinh **trước** gate 2) |
| 2 Lint | `npx eslint` trên **8** file chạm tới, chạy **sau** gate 1 | PASS | exit **0**, **0** problem |
| 3 Tests | `npx tsx tests/unit/run-all.mts` | PASS | exit **0**, **104/104** specs; `PASS tmcut_scene_scan.spec.ts (507ms) === [TMCut scene scan] 11 passed ===` |
| 3b Core | `node --test "test/*.test.mjs"` + `check-boundaries.mjs` + `tsc -p packages/core/tsconfig.check.json` | PASS | **626/626** pass, **0** fail, **919.99 ms**; boundaries "PASS — core imports nothing platform-specific"; tsc exit **0**, **0** `error TS`. Riêng bốn file scene: **28/28** pass, **0** fail, **273.65 ms** |
| 4 Live | `/_nuxt/@fs/…` trong trang Chromium thật + server media 206 | PASS | **toàn bộ bảng §23.2** — số đo thật, không phải cấu trúc |
| 5 Docs | năm guard `docs_markdown` / `tmcut_doc_citations` / `tmcut_doc_line_length` / `tmcut_doc_table_shape` / `tmcut_docs_link_integrity`, chạy lại **sau** lần sửa cuối của §23 | PASS | **28** checks (**12/5/4/3/4**), exit **0** cả năm; gate 3 chạy **lại sau** lần sửa markdown cuối: **104/104**, exit **0** |

### 23.5 Chưa chứng minh

- **Ngưỡng mới chưa được chọn.** Phép đo chỉ có **một** clip, và clip đó là synthetic plates
  (`testsrc2`, `smptebars`) — chuyển động đều, không có nội dung thật. Khoảng phân biệt
  **(0.0288, 0.2626]** là **số của riêng nó**, không phải một ngưỡng suy ra được cho footage.
- **Chưa có shot nào đi vào một timeline.** `sceneScan.ts` và `decodeLumaSeries` có **0** consumer
  phía UI: `app/composables/useTmcutAutocut.ts:79` vẫn gọi hai IPC `analyzeScenes`/`analyzeSilence`.
  Nối đường đó — và **chạy cả hai** để so — là E4.
- **`decodeLumaSeries` mới chạy trên 128×128, 2 s, một file.** Chưa đo trên 4 K, chưa đo trên file dài
  (số packet phải decode tăng theo dải scan), chưa đo khi byte đến từ client cache (nhánh `bytes`)
  thay vì `UrlSource`, và chưa đo trên **Electron** — hai host dùng chung module nhưng host desktop
  chưa được chạy lượt này.
- **`missing > 0` chưa từng xảy ra thật.** `missing` **0** trên cả hai lần chạy, nên con đường "một mẫu
  rớt" mới được chứng minh bằng **lưới giả trong Node** (checks [:96](file:///D:/Applications/tm-studio/tests/unit/tmcut_scene_scan.spec.ts#L96),
  [:111](file:///D:/Applications/tm-studio/tests/unit/tmcut_scene_scan.spec.ts#L111)), không bằng một
  decoder thật đánh rơi một khung.
- **Shot list của một dải trim mô tả **cả source**, không phải phần đã nhìn.** `scan(1.2 → 2)` trả
  `shots: [{0, 2}]` vì `cutsToShots` đóng danh sách bằng `durationSec` trong khi các mốc hỏi nằm trong
  dải trim. E4 phải quyết: Autocut luôn scan **nguồn đầy đủ** (khi đó vô hại), hay kết quả phải kèm
  "đã phủ ở đâu". Chưa đổi hành vi vì một mình nó chưa làm hỏng phép đo nào.
- **Im lặng chưa có gì mới.** `levelSeries`/`silenceSpans` vẫn **0** importer và chưa chạy trên PCM
  thật — chân đó là E3, không phải lượt này.
- **Không khoá i18n nào mới.** Lượt này không thêm chữ nào ra UI.

### 23.6 Vệ sinh

§23 thêm **133** dòng, đưa cả file lên **1480** dòng; **46** anchor `file:///…#L<n>` trong §23 được in **nội
dung dòng đích** bằng một script scratch (`e2-anchors.mjs`) và đối chiếu từng cái — script đó cũng chạy
lại **30** anchor của §22, vì các dòng của `detection.mjs` đã dịch khi E2 thêm luật (§22 nay trỏ
`:27`→`:39`, `:78`, `:147`, `:193`, `:217`, `:227`, `:256` thay vì `:20`, `:63`, `:77`, `:98`, `:122`,
`:132`, `:161`).

Scratch của lượt này (`e2-g1.txt`, `e2-g2.txt`, `e2-g2b.txt`, `e2-fix.txt`, `e2-corets.txt`,
`e2-g3.txt`, `e2f-g1.txt`, `e2f-g2.txt`, `e2f-g3.txt`, `e2f-core.txt`, `e2f-bound.txt`, `e2f-tsc.txt`,
`e2f-e2core.txt`, `e2-ffscene.txt`, `e2-serve.mjs`, `e2-serve.log`, `e2-anchors.mjs`, `e2-gfx.txt`,
thư mục `e2live/`) nằm trong `node_modules/.cache/tmcut-gates/` (đã ignore) và **đã xoá sạch** sau lần
chạy guard cuối; server scratch 4119 cũng đã dừng. Không file nào của chủ repo bị đụng để "dọn" sau
test. `git status --porcelain` sau khi stage phải ra **đúng 9** dòng:
`packages/core/src/detection.mjs`, `packages/core/src/index.d.ts`,
`packages/core/test/scene-luma-grid.test.mjs`, `packages/core/test/scene-cut-pairs.test.mjs`,
`packages/core/test/scene-silence-detection.test.mjs`, `app/utils/tmcut/frameDecode.ts`,
`app/utils/tmcut/sceneScan.ts`, `tests/unit/tmcut_scene_scan.spec.ts`, và chính file này.


## 24. Slice E3 — seam PCM, luật "kênh to nhất", và giây nguồn (đo ngày 2026-11-04)

§22 đặt luật im lặng vào core nhưng để nó **0 importer**; §23 dựng nửa scene của đường pixel. E3 dựng nửa
còn lại: một seam **thứ ba** biến bytes thành samples, một module glue nối seam với luật, và **ba luật mới**
trong core. Hai trong ba luật đó chỉ tồn tại vì có **phép đo thật**: một cái là thứ Node không bao giờ thấy
(decoder trả một run bắt đầu **trước** mốc hỏi), cái kia là thứ một fixture giả trong Node **không phân biệt
được** với một luật sai (kênh nào quyết định một cửa sổ là im).

### 24.1 Đã dựng gì

| Chỗ | Nội dung | Chứng minh bằng |
|---|---|---|
| [detection.mjs:257](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L257) + [:262](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L262) + [:264](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L264) + [:270](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L270) | `loudestLevelSeries`: một cửa sổ lấy mức của **kênh to nhất**, không phải một bản mix. Kênh **không được giao** hoặc rỗng bị **bỏ qua** chứ không tính thành im ([:262](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L262)); không kênh nào thì trả `[]` chứ không trả "cửa sổ im" ([:264](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L264)); hàng dài hơn hàng khác thì ô thiếu bị **bỏ qua**, không đọc thành −Infinity ([:270](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L270)) | xem dòng dưới |
| [packages/core/test/silence-channels.test.mjs](file:///D:/Applications/tm-studio/packages/core/test/silence-channels.test.mjs) | **7** check của luật kênh, **0** chỗ nào cần decoder | [:19](file:///D:/Applications/tm-studio/packages/core/test/silence-channels.test.mjs#L19) to nhất từng cửa sổ, [:26](file:///D:/Applications/tm-studio/packages/core/test/silence-channels.test.mjs#L26) chỉ im khi **mọi** kênh im, [:32](file:///D:/Applications/tm-studio/packages/core/test/silence-channels.test.mjs#L32) một kênh thì **trùng hết** `levelSeries`, [:37](file:///D:/Applications/tm-studio/packages/core/test/silence-channels.test.mjs#L37) giữ cửa sổ đuôi cụt, [:44](file:///D:/Applications/tm-studio/packages/core/test/silence-channels.test.mjs#L44) kênh `null` bị bỏ, [:49](file:///D:/Applications/tm-studio/packages/core/test/silence-channels.test.mjs#L49) không kênh / rate 0 / window 0 đều ra `[]`, [:56](file:///D:/Applications/tm-studio/packages/core/test/silence-channels.test.mjs#L56) sàn −120 cho kênh im tuyệt đối và **một** kênh loud kéo cả cửa sổ lên |
| [packages/core/src/detection.mjs:309](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L309) + [:321](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L321) + [:322](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L322) | `silenceSpans` nhận `offsetSec` — nơi cửa sổ **đầu tiên** của series nằm trong source — nên một clip đã trim báo **giây nguồn**, không báo giây tính từ chỗ cắt. Offset âm/NaN bị coi là **đầu file**; trần `durationSec` vẫn tính **trên series** rồi mới dịch, nên một phép dịch không tự nới dải đã nghe | **5** check trong [packages/core/test/silence-span-offset.test.mjs](file:///D:/Applications/tm-studio/packages/core/test/silence-span-offset.test.mjs): [:13](file:///D:/Applications/tm-studio/packages/core/test/silence-span-offset.test.mjs#L13), [:20](file:///D:/Applications/tm-studio/packages/core/test/silence-span-offset.test.mjs#L20) mặc định 0 nên hành vi cũ **không đổi**, [:27](file:///D:/Applications/tm-studio/packages/core/test/silence-span-offset.test.mjs#L27) trần theo dải đọc, [:34](file:///D:/Applications/tm-studio/packages/core/test/silence-span-offset.test.mjs#L34) độ dài run **không** cộng offset — dịch chuyển không bịa thêm cũng không mất span, [:46](file:///D:/Applications/tm-studio/packages/core/test/silence-span-offset.test.mjs#L46) |
| [packages/core/src/detection.mjs:287](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L287) + [:293](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L293) | `pcmHeadTrim(askedSec, deliveredSec, sampleRate)` = **số mẫu đầu** nằm trước mốc hỏi. Input không tin được trả **0**: thà chưa cắt còn hơn bịa một chỗ cắt | **4** check trong [packages/core/test/silence-pcm-trim.test.mjs](file:///D:/Applications/tm-studio/packages/core/test/silence-pcm-trim.test.mjs): [:15](file:///D:/Applications/tm-studio/packages/core/test/silence-pcm-trim.test.mjs#L15) ra đúng **546** mẫu (số **đo** được, không suy ra), [:22](file:///D:/Applications/tm-studio/packages/core/test/silence-pcm-trim.test.mjs#L22), [:27](file:///D:/Applications/tm-studio/packages/core/test/silence-pcm-trim.test.mjs#L27), và [:34](file:///D:/Applications/tm-studio/packages/core/test/silence-pcm-trim.test.mjs#L34) — check dựng **chính cái defect đó** bằng mẫu giả rồi cho nó biến mất khi cắt đầu, để luật này không bao giờ chỉ là một hằng số trang trí |
| `packages/core/src/index.d.ts:439` + `packages/core/src/index.d.ts:445` + `packages/core/src/index.d.ts:447` + `packages/core/src/index.d.ts:449` | Ba khai báo mới (`loudestLevelSeries`, `pcmHeadTrim`, và `offsetSec` trong options của `silenceSpans`) — `.d.ts` viết tay nên chỉ `tsc -p packages/core/tsconfig.check.json` mới kiểm được | exit **0**, **0** `error TS` (§24.4 gate 3b) |
| [app/utils/tmcut/audioDecode.ts:23](file:///D:/Applications/tm-studio/app/utils/tmcut/audioDecode.ts#L23) + [:52](file:///D:/Applications/tm-studio/app/utils/tmcut/audioDecode.ts#L52) + [:70](file:///D:/Applications/tm-studio/app/utils/tmcut/audioDecode.ts#L70) | Seam **thứ ba** và cũng là seam **duy nhất** đọc sound. `hasAudioDecoder()` hỏi **cả hai** `AudioDecoder` và `AudioBuffer`, vì một packet WebCodecs không tự thành sample: thiếu một trong hai nghĩa là host **không làm được sample**, trả `null` chứ không mượn đường khác. `decodePcm` đi **một vòng** `AudioBufferSink.buffers(from, to)` cho cả dải, không lặp lại `getBuffer()` | check [:175](file:///D:/Applications/tm-studio/tests/unit/tmcut_silence_scan.spec.ts#L175) buộc seam có `decodePcm`, `AudioBufferSink`, `.buffers(`, `hasAudioDecoder`, `pcmHeadTrim(` và **không gọi** `silenceSpans(`, `loudestLevelSeries(`, `dbfsOf(`, `levelSeries(` |
| [app/utils/tmcut/audioDecode.ts:75](file:///D:/Applications/tm-studio/app/utils/tmcut/audioDecode.ts#L75) + [:76](file:///D:/Applications/tm-studio/app/utils/tmcut/audioDecode.ts#L76) + [:89](file:///D:/Applications/tm-studio/app/utils/tmcut/audioDecode.ts#L89)→[:94](file:///D:/Applications/tm-studio/app/utils/tmcut/audioDecode.ts#L94) | Các kênh được **giữ riêng**, không trộn: trộn thì một kênh chết và một kênh to "thỏa hiệp" ở mức giữa. `firstPacketSec` lấy từ packet **đầu tiên thật sự được giao**, rồi `pcmHeadTrim` cắt đúng số mẫu đó khỏi **mọi** kênh | hai phép đo §24.2 trên `l25-r-silent.m4a` và `antiphase-minus20.m4a` — hai file mà luật "kênh to nhất" và luật "trộn rồi đo" cho **kết quả ngược nhau** |
| [app/utils/tmcut/frameDecode.ts:54](file:///D:/Applications/tm-studio/app/utils/tmcut/frameDecode.ts#L54) + [:69](file:///D:/Applications/tm-studio/app/utils/tmcut/frameDecode.ts#L69) | `TmcutMediaRead` và `openMedia` thành **export**: seam audio **mượn** chỗ mở `Input`, nên không có bản thứ hai của đường byte→container | check [:416](file:///D:/Applications/tm-studio/tests/unit/tmcut_frame_service.spec.ts#L416): danh sách import `./frameDecode` nay là [:422](file:///D:/Applications/tm-studio/tests/unit/tmcut_frame_service.spec.ts#L422) `['audioDecode.ts', 'frameStore.ts']`, kèm [:425](file:///D:/Applications/tm-studio/tests/unit/tmcut_frame_service.spec.ts#L425) bắt `audioDecode` có `openMedia(` và [:426](file:///D:/Applications/tm-studio/tests/unit/tmcut_frame_service.spec.ts#L426) cấm nó gọi `decodeFrame(` hay `decodeLumaSeries(` |
| [silenceScan.ts:60](file:///D:/Applications/tm-studio/app/utils/tmcut/silenceScan.ts#L60) + [:64](file:///D:/Applications/tm-studio/app/utils/tmcut/silenceScan.ts#L64) + [:66](file:///D:/Applications/tm-studio/app/utils/tmcut/silenceScan.ts#L66) + [:69](file:///D:/Applications/tm-studio/app/utils/tmcut/silenceScan.ts#L69) | Glue **không có decoder**, nên plain Node chạy được **toàn bộ** quyết định: dải không thật và signal đã huỷ trả rỗng **trước khi** mở file, và `null` (host không decode được) **không** phải "một file im lặng" | checks [:68](file:///D:/Applications/tm-studio/tests/unit/tmcut_silence_scan.spec.ts#L68), [:112](file:///D:/Applications/tm-studio/tests/unit/tmcut_silence_scan.spec.ts#L112) (4 dải ảo làm reader hỏi **0** lần), [:131](file:///D:/Applications/tm-studio/tests/unit/tmcut_silence_scan.spec.ts#L131), [:157](file:///D:/Applications/tm-studio/tests/unit/tmcut_silence_scan.spec.ts#L157) |
| [silenceScan.ts:70](file:///D:/Applications/tm-studio/app/utils/tmcut/silenceScan.ts#L70) + [:77](file:///D:/Applications/tm-studio/app/utils/tmcut/silenceScan.ts#L77) + [:80](file:///D:/Applications/tm-studio/app/utils/tmcut/silenceScan.ts#L80) | Mức do core tính trên đúng dải hỏi; `offsetSec: from` và `durationSec: to - from` là **hai dòng duy nhất** nối dải đọc với giây nguồn — glue không tự cộng giây nào | checks [:77](file:///D:/Applications/tm-studio/tests/unit/tmcut_silence_scan.spec.ts#L77) và [:93](file:///D:/Applications/tm-studio/tests/unit/tmcut_silence_scan.spec.ts#L93) (spans **bằng đúng** cách core tự suy ra với `offsetSec: 10`) |
| [tests/unit/tmcut_silence_scan.spec.ts:187](file:///D:/Applications/tm-studio/tests/unit/tmcut_silence_scan.spec.ts#L187) + [tests/unit/tmcut_media_probe.spec.ts:336](file:///D:/Applications/tm-studio/tests/unit/tmcut_media_probe.spec.ts#L336) + [tests/unit/tmcut_scene_scan.spec.ts:195](file:///D:/Applications/tm-studio/tests/unit/tmcut_scene_scan.spec.ts#L195) | **Một** chỗ đếm seam: [silence_scan:193](file:///D:/Applications/tm-studio/tests/unit/tmcut_silence_scan.spec.ts#L193) liệt kê đúng `['audioDecode.ts', 'frameDecode.ts', 'mediaProbe.ts']`; [media_probe:350](file:///D:/Applications/tm-studio/tests/unit/tmcut_media_probe.spec.ts#L350) giữ danh sách ba file trên trục "ai `import 'mediabunny'` trong cả cây `app/`". Guard **hai** file của E2 đã được **dời** chứ không nhân bản, và để lại dòng ghi lý do ở [scene_scan:195](file:///D:/Applications/tm-studio/tests/unit/tmcut_scene_scan.spec.ts#L195) | cả ba spec chạy trong gate 3: `tmcut_silence_scan` **10** check, `tmcut_media_probe` **13**, `tmcut_scene_scan` **10** |

### 24.2 Phép đo thật: đường silence chạy trên audio thật, trong Chromium

Bốn module import qua đúng URL dev-server (`/_nuxt/@fs/D:/Applications/tm-studio/…`), **sau khi reload** tab
— bài học §23.3.4 — và `Object.keys(core).length` = **390** (của E2 là 388) là cách xác nhận bản đang chạy là
bản vừa sửa. Media phục từ server scratch `e3-serve.mjs` cổng **4199** (`Accept-Ranges` thật:
`Range: bytes=0-99` → **206**). Fixture do **chính FFmpeg trên máy dev sinh ra**, và
`silencedetect=noise=-30dB:duration=0.5` chạy trên **cùng file** làm oracle — đúng hai vai Q3b/Q8a cho phép
(generator và oracle), không phải một chân chạy runtime.

| Cái đo | Số | Ý nghĩa |
|---|---|---|
| `hasAudioDecoder()` trong trang | **true** — `AudioDecoder` và `AudioBuffer` đều là `function` | seam đi đường WebCodecs thật, không phải nhánh `null` |
| `tone-then-quiet.m4a` (mono: tone 0→1 s, lặng 1→2 s) — scan `[0,2]` | `windows` **5**, `spans` **`[{1, 2}]`**, **124 ms** | **5** cửa sổ cho một ask 2 s vì container giao **2,020136 s** mẫu (padding AAC); cửa sổ thứ năm đo −80,54 dB |
| … cùng file, scan `[0.5,2]` và `[1,2]` | `windows` **4** và **3**, `spans` **`[{1, 2}]`** ở **cả hai**, **37 ms** và **34 ms** | vẫn đúng giây nguồn 1→2 **dù hỏi từ đâu** — đó là `offsetSec` của core, không phải phép cộng của glue |
| FFmpeg trên **cùng file** | `silence_start` **0.999977**, `silence_end` **2.020136**, `silence_duration` **1.020159** | Δstart **23 µs** (~1 mẫu). End khác nhau **có chủ đích**: scan không nhận giây nó **không nghe**, FFmpeg báo cả padding |
| `each-minus285.m4a` (stereo) — `astats` của oracle | kênh 1 **−28.551300**, kênh 2 **−28.544668** dBFS | mức thật của fixture, lấy từ phía được so sánh |
| … seam + core đo lại trên chính file đó | cửa sổ đầu theo kênh **−28,52** và **−28,49**; `loudestLevelSeries` = **[−28,49, −28,50, −28,50, −28,50, −80,54]** | hai bên đọc **cùng một mức** trong sai số packet/padding, không phải hai thang khác nhau |
| … scan `[0,2]` và oracle | ta: `spans` **`[]`**; FFmpeg: **không có** dòng `silence_start` | **parity** — và cả hai đúng vì −28,5 dB **to hơn** ngưỡng −30 dB |
| `both-minus33.m4a` (stereo) | ta: hai kênh **−36,03** và **−36,04**, `spans` **`[{0, 2}]`**; FFmpeg: `silence_start` **0**, `silence_end` **2.020136** | **parity** ở phía ngược lại: file im thì cả hai cùng báo im, và span của ta **kín** ở 2 s đúng bằng dải hỏi |
| `l25-r-silent.m4a` (L tone, R im tuyệt đối) | kênh **−25,00** và **−120** (đúng sàn); loudest **[−25, −25,01, −25,01, −25,01, −25,04]**; `spans` **`[]`**; FFmpeg **không có** `silence_start` | một kênh chết **không** làm nội dung thành im lặng. Nếu seam trộn (0,5L + 0,5R) thì bản mix đo **−31.05 dB RMS** — **dưới** ngưỡng −30 của chính FFmpeg — mà oracle vẫn **không** báo im, nên "trộn trước rồi đo" bị loại **bằng số** |
| `antiphase-minus20.m4a` (L = −R, cùng tone) | hai kênh **−23,01** (oracle: peak **−19.814399** và **−19.816512**); `spans` **`[]`**; FFmpeg **không có** `silence_start`. Bản downmix 0,5/0,5 của nó đo **−115.488275 dB RMS**, peak **−83.874565 dB** | **phép thử quyết định**: hai kênh triệt tiêu nhau hoàn toàn trong một bản mix, nên luật "mix rồi đo" sẽ báo **cả file là im lặng**. Oracle không báo, core của ta cũng không. Luật kênh của `loudestLevelSeries` **là** luật của `silencedetect`, đo trên một file mà hai luật cho kết quả **ngược nhau** |
| Định vị packet, ask `[0.5, 2]` trên `tone-then-quiet` | packet đầu đến tay ở **0.4876190 s** (hỏi 0,5 s); **66** packet, **67 584** mẫu = **1,533 s** mẫu cho một ask 1,5 s; head `pcmHeadTrim` tính = **546** mẫu = **0,012 s** | defect thật, **chỉ** hiện ra trong browser: plain Node không có decoder nên không bao giờ nhận một run bắt đầu **trước** mốc hỏi |
| Cùng dải đó, **không** cắt đầu so với **có** cắt đầu | không cắt: cửa sổ 0,988→1,488 đo **−26,99 dB** → `spans` **`[{1.5, 2}]`**; có cắt: **−88,39 dB** → `spans` **`[{1, 2}]`** | **546 mẫu tone** (12,4 ms) nằm ở đầu cửa sổ đủ kéo nó từ −88 lên −27 dB, vượt ngưỡng −30 và dịch span **trễ đúng một cửa sổ** — nửa giây lỗi trên một clip 2 s |

Bảng đó cũng vạch ra **một khác biệt thang đo** chưa đóng: `silencedetect` **không** so một RMS cửa sổ với
ngưỡng — bằng chứng là bản downmix **−31,05 dB RMS** nhưng peak **−25,53 dB** vẫn bị nó coi là loud. Core đo
RMS cửa sổ (luật chốt ở §22), nên ở **sát** ngưỡng −30 dB hai bên có thể trả lời khác nhau; trên bốn fixture
này mọi cửa sổ đều cách ngưỡng **từ 5 dB trở lên** nên parity giữ nguyên. Việc của E4, ghi ở §24.5.

### 24.3 Năm quyết định

1. **Luật kênh ở lại core, seam chỉ giao các kênh riêng.** Hai fixture `l25-r-silent` và `antiphase-minus20`
   là lý do: với cùng một file, "trộn rồi đo" và "kênh to nhất đo" cho kết luận **ngược nhau**, và oracle
   đứng về phía sau. Nếu luật nằm trong seam thì mỗi host có một bản luật — đúng cái lỗi §20 đã đóng cho
   đường pixel.
2. **Không đổi ngưỡng hay cửa sổ mặc định lượt này**, cùng nguyên tắc §23.3.1: mọi số đo ở §24.2 đều **cách
   ngưỡng ≥ 5 dB**, nên chúng chứng minh **hình dạng** của luật chứ không hiệu chuẩn **vị trí** của nó. Khác
   biệt RMS-vs-peak ở cuối §24.2 là thứ phải đo trên nội dung thật ở E4, không phải đoán bằng số.
3. **`pcmHeadTrim` là số học, nên nó thuộc core**; seam chỉ làm một việc là `subarray`. Con số 546 đến từ
   `(asked − delivered) × rate`, không có gì là platform. Đặt nó trong seam sẽ sinh bản sao thứ hai ngay khi
   Electron đọc mẫu từ byte cache — chính chỗ §21 đã tránh cho đường frame.
4. **Trần của một span là dải đọc, không phải container.** `windows` **5** trên ask 2 s là bằng chứng container
   giao nhiều hơn hỏi; scan cố ý không báo giây nó chưa nghe, còn FFmpeg báo tới 2.020136 s. Ghi lại để E4
   không "sửa" thành một cuộc đua theo từng byte của padding.
5. **Guard đếm seam được dời, không nhân bản.** §23.3.3 đã báo trước rằng E3 sẽ đổi con số hai thành ba; nó
   đổi **ở một chỗ** ([silence_scan:187](file:///D:/Applications/tm-studio/tests/unit/tmcut_silence_scan.spec.ts#L187)),
   và [scene_scan:195](file:///D:/Applications/tm-studio/tests/unit/tmcut_scene_scan.spec.ts#L195) để lại một
   dòng nói vì sao con số đó không còn ở đây. Người mở holder thứ tư sẽ phải sửa message của guard — đó là
   chủ đích, không phải ma sát.

### 24.4 Gates (chạy theo thứ tự, sau **mọi** lần sửa)

| Gate | Lệnh | Kết quả | Chứng cứ |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | PASS | exit **0**, **0** `error TS`; `.nuxt/eslint.config.mjs` **28 552** byte, mtime **16:51** — cấu hình sinh **trước** gate 2 |
| 2 Lint | `npx eslint` trên **12** file chạm tới, chạy **sau** gate 1 | PASS | lần đầu **2** error: `no-unused-vars 'size'` ở [silence-pcm-trim.test.mjs:36](file:///D:/Applications/tm-studio/packages/core/test/silence-pcm-trim.test.mjs#L36) và `@stylistic/arrow-parens` ở [tmcut_silence_scan.spec.ts:79](file:///D:/Applications/tm-studio/tests/unit/tmcut_silence_scan.spec.ts#L79) — sửa **bằng tay trong đúng hai file đó**; lần hai exit **0**, **0** problem |
| 3 Tests | `npx tsx tests/unit/run-all.mts` | PASS | exit **0**, **105/105** specs; `PASS tmcut_silence_scan.spec.ts … === [TMCut silence scan] 10 passed ===`; hai guard có đổi chủ/trả lời mới: `tmcut_media_probe` **13**, `tmcut_frame_service` **19**, `tmcut_scene_scan` **10** |
| 3b Core | `node --test "test/*.test.mjs"` + `check-boundaries.mjs` + `tsc -p packages/core/tsconfig.check.json` | PASS | **642/642** pass, **0** fail, **983,95 ms** (E2 khép ở 626; +7 kênh, +5 offset, +4 trim); `check-boundaries` chạy từ `packages/core/tools/`, không phải `scripts/`; boundaries "PASS — core imports nothing platform-specific"; tsc exit **0**, **0** `error TS` |
| 4 Live | `/_nuxt/@fs/…` trong trang Chromium thật + server media 4199 trả 206 | PASS | **toàn bộ bảng §24.2** — bảy lần scan, bốn fixture, và phép đo packet trước/sau khi cắt đầu |
| 5 Docs | năm guard `docs_markdown` / `tmcut_doc_citations` / `tmcut_doc_line_length` / `tmcut_doc_table_shape` / `tmcut_docs_link_integrity`, chạy lại **sau** lần sửa markdown cuối | PASS | **28** checks (**12/5/4/3/4**), exit **0** cả năm; gate 3 chạy **lại** sau khi §24 hoàn tất: **105/105**, exit **0** |

### 24.5 Chưa chứng minh

- **Chưa có consumer nào gọi đường này.** `audioDecode.ts` và `silenceScan.ts` có **0** importer phía UI:
  `app/composables/useTmcutAutocut.ts:79` vẫn dựng hai IPC leg `analyzeScenes`/`analyzeSilence`. Nối — và
  chạy **cả hai** để so — là E4, bao gồm luôn câu hỏi hiệu chuẩn ở §24.3.2.
- **Thang đo chưa hiệu chuẩn trên nội dung thật.** Bốn fixture đều synthetic (tone, im tuyệt đối, noise
  theo kênh) và mọi cửa sổ cách ngưỡng **≥ 5 dB**. Với footage nói chuyện thật, cửa sổ sát −30 dB là chỗ
  RMS-cửa-sổ và sample-magnitude có thể trả lời khác nhau — **chưa** có số đo nào cho vùng đó.
- **Host Electron chưa được chạy.** `hasAudioDecoder()` mới đo trong Chromium; `AudioDecoder`/`AudioBuffer`
  có ở desktop host hay không chưa được xác nhận lượt này, dù module là dùng chung.
- **Nhánh `bytes` chưa đo cho audio.** `decodePcm` nhận `bytes` qua `openMedia`, nhưng mọi phép đo ở §24.2 đi
  `UrlSource`. Đường "sample đến từ client cache" chưa có một con số thật nào.
- **File dài chưa đo.** Mẫu chỉ 2–3 s. Khác với scene scan (lấy mẫu thưa), scan audio **decode mọi packet**
  trong dải nên chi phí tăng theo đúng độ dài dải; chưa đo 10 phút và chưa biết cần cắt dải hay không.
- **Huỷ giữa chừng mới chứng minh bằng reader giả.** Check [:157](file:///D:/Applications/tm-studio/tests/unit/tmcut_silence_scan.spec.ts#L157)
  chạy trong Node với hàm đọc nhân tạo; chưa có một lần abort thật xảy ra **bên trong** một vòng
  `for await` đang nhận packet.
- **`windows` chưa có chỗ nào hiển thị.** Autocut cần quyết định báo "đã nghe bao nhiêu" hay chỉ báo span —
  quyết định đó thuộc E4, và nếu ra chữ thì mới có khoá i18n.
- **Không khoá i18n nào mới.** Lượt này không thêm chữ nào ra UI.

### 24.6 Vệ sinh

§24 thêm **136** dòng, đưa cả file lên **1616** dòng. Mọi anchor `file:///…#L<n>` của §24 được in
**nội dung dòng đích** bằng script scratch `e3-anchors.mjs` rồi đối chiếu từng cái; script đó cũng quét lại
**toàn bộ** anchor trỏ vào ba file mà E3 đã sửa, và tìm ra **9** anchor đã trôi qua vài lượt — sửa thành
[frameDecode.ts:99](file:///D:/Applications/tm-studio/app/utils/tmcut/frameDecode.ts#L99) và
[:42](file:///D:/Applications/tm-studio/app/utils/tmcut/frameDecode.ts#L42) (decodeFrame, hasFrameDecoder),
[:69](file:///D:/Applications/tm-studio/app/utils/tmcut/frameDecode.ts#L69),
[:119](file:///D:/Applications/tm-studio/app/utils/tmcut/frameDecode.ts#L119),
[:147](file:///D:/Applications/tm-studio/app/utils/tmcut/frameDecode.ts#L147),
[:163](file:///D:/Applications/tm-studio/app/utils/tmcut/frameDecode.ts#L163),
[:169](file:///D:/Applications/tm-studio/app/utils/tmcut/frameDecode.ts#L169),
[detection.mjs:305](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L305) (silenceSpans)
và `packages/core/src/index.d.ts:2063` (khối khai
`TmcutByteCachePlan`). Một con số trong bảng §24.2 cũng đã bị **sửa vì sai**, không phải vì không khớp code:
check offset từng đòi `{31, 33}` cho một run có số đúng là `{34, 38}`, và `pcmHeadTrim` từng được ghi là
**549** từ một số lẻ đã làm tròn — số đúng là **546**.

Scratch của lượt này (`e3-serve.mjs`, `e3-serve.log`, `e3-anchors.mjs`, `e3-tests.txt`, `e3-tests2.txt`,
`e3-typecheck.txt`, `e3-typecheck2.txt`, `e3-eslint.txt`, `e3-eslint2.txt`, `e3-tmcut_frame_service.txt`,
`e3-tmcut_media_probe.txt`, `e3-core-tests.txt`, thư mục `e3live/` với năm fixture) nằm trong
`node_modules/.cache/tmcut-gates/` (đã ignore) và **đã xoá sạch** sau lần chạy guard cuối; server 4199 cũng
đã dừng. Không file nào của chủ repo bị đụng để "dọn" sau test. `git status --porcelain` sau khi stage phải
ra **đúng 13** dòng: `packages/core/src/detection.mjs`, `packages/core/src/index.d.ts`,
`packages/core/test/silence-channels.test.mjs`, `packages/core/test/silence-span-offset.test.mjs`,
`packages/core/test/silence-pcm-trim.test.mjs`, `app/utils/tmcut/audioDecode.ts`,
`app/utils/tmcut/silenceScan.ts`, `app/utils/tmcut/frameDecode.ts`,
`tests/unit/tmcut_silence_scan.spec.ts`, `tests/unit/tmcut_scene_scan.spec.ts`,
`tests/unit/tmcut_frame_service.spec.ts`, `tests/unit/tmcut_media_probe.spec.ts`, và chính file này.

## 25. Blocker `audit:406` — kiểm kê **toàn bộ** `spawn ffmpeg/ffprobe`, và phương án thay thế (đo ngày 2026-11-04)

Execution brief §2 ra lệnh: không được để một `spawn` chưa phân loại sống tới slice I. Lượt này **chỉ kiểm kê
và chốt ánh xạ — không đổi một dòng code chạy được nào**, nên blocker **CHƯA ĐÓNG**; §25.6 ghi rõ điều kiện
nào còn thiếu. Con số kiểm kê lấy từ `grep` toàn bộ `electron/ server/ app/ packages/core/src/ shared/
scripts/ tests/` (trừ `backup/`, `node_modules/`), rồi **mở từng file được grep** — không suy từ tên hàm.

### 25.1 Năm nhóm, và con số thật của từng nhóm

| Nhóm | Bao nhiêu | Nằm ở đâu | Số phận ở slice I |
|---|---|---|---|
| (a) FFmpeg làm **media work** | **14** call site, trong **8** file — **12** chạy `ffmpeg`, **2** chỉ verify binary | Electron: `electron/tools/tmcut.controller.cjs:194` `runFfmpeg`, `electron/tools/tmcut.controller.cjs:511` `runFfmpegLog`, `ffmpeg.controller.cjs:65`/`:80`/`:90`/`:100` (4 `execSync` probe `nvenc`/`amf`/`qsv`), `electron/tools/task-manager.cjs:208`/`electron/tools/task-manager.cjs:284` `spawn(task.command)`; server: `server/api/v1/media/analyze.post.ts:39`, `server/api/v1/media/proxy.post.ts:109`, `server/api/v1/media/render.post.ts:122`, `server/utils/htmlVideoRender.ts:177`; verify: `paths.cjs:70`, `ffmpeg.controller.cjs:124` | xoá sau khi H có output hợp lệ; **không** xoá trước |
| (b) **ffprobe-only** | **8** chỗ | `electron/tools/tmcut.controller.cjs:230` (duration) và `electron/tools/tmcut.controller.cjs:457` (JSON), `electron/tools/video-generation/video-probe.mjs:86`, `server/api/v1/media/analyze.post.ts:109`, `ffmpeg.controller.cjs:1224`/`:1333`/`:221`/`:573` | thay bằng `MediaProbeService` (đã dựng ở slice B, §13) — **kể cả chỗ probe video của provider adapter**, không chỉ chỗ của editor |
| (c) spawn **không liên quan media** | **6** call site, trong **4** file | ngoài 9 file media: `electron/main.cjs:606` (`spawn(process.execPath)` cho MCP server), `dev-electron-launcher.cjs:92` (khởi động Electron — dòng `:28` chỉ là `require`), `updater.cjs:152`/`:159` (`tar.exe`/`powershell.exe`); nằm TRONG file media nhưng không chạm FFmpeg: `task-manager.cjs:18` (`taskkill`), `ffmpeg.controller.cjs:70` (`powershell` hỏi `Win32_VideoController`) | **GIỮ** — brief §3 slice I mục 3 cấm xoá bừa; `updater` chỉ đổi vai (nó cài binary mà sản phẩm không còn cần) |
| (d) `backup/ffmpeg-engine-2026-11-03/` | 20 file import `child_process` | ảnh chụp chính các file ở (a)/(b) | **không tính**; Q8 giữ untracked tới hết slice I, và mọi `grep` phải loại nó ra nếu không muốn **đôi** mọi con số |
| (e) test dùng FFmpeg làm **oracle** | **11** spec — **10** cái tự `spawnSync` binary media (**20** call site), cộng `tmcut_html_video_smoke` đi qua route server | `tmcut_render_smoke`, `tmcut_detect_smoke`, `tmcut_svg_still`, `tmcut_golden_frame`, `tmcut_render_parity`, `tmcut_text_pixel`, `tmcut_export_paint_stack`, `tests/unit/tmcut_export_gap_placement.spec.ts:62`, `tmcut_fx_catalog`, `tmcut_transition_preview`, `tmcut_html_video_smoke` | **tách assertion** theo §8 hàng J, không xoá cả file — đây là chỗ duy nhất pixel/duration từng được đo thật |

Cách đếm (để các con số không phải phỏng đoán): script duyệt 9 file media, lấy mọi dòng gọi
`spawn`/`spawnSync`/`execSync`/`execFile`/`fork`/`exec`, bỏ comment, `import` và hai `.exec()` là regex trên
`String` (`render.post.ts:152`, `htmlVideoRender.ts:207`). Kết quả **23** call site process trong **9** file:
**9** dòng nêu thẳng tên binary (4 file), **12** dòng đi qua biến (`exe`, `task.command`, `cmd`, `filePath`),
**2** dòng không phải FFmpeg (`task-manager.cjs:18` = `taskkill`, `ffmpeg.controller.cjs:70` = `powershell`
hỏi tên GPU) — hai cái này thuộc nhóm (c). Vì thế FFmpeg-family là **21** call site, còn (a)+(b) = 14+8 = **22**
lớn hơn 21 đúng một chỗ: `analyze.post.ts:39` là MỘT `spawn(cmd, …)` nhưng chạy cả `ffmpeg` (`:102`) lẫn
`ffprobe` (`:109`), nên nó được tính ở cả hai hàng.

Chi tiết caller của hai wrapper phía Electron, vì mọi lệnh render của GUI dồn về đây: `runFfmpeg` có **7** lời
gọi (`tmcut.controller.cjs:278` audio-extract, `:346`, `:388`, `:420`, `:696`, `:744`, `:769`) và
`runFfmpegLog` có **2** (`:550` scene, `:561` silence). `task.command` mà task-manager spawn được gán ở
`ffmpeg.controller.cjs:1024`/`:1076` — không có đường nào khác. Bốn `execSync` ở `ffmpeg.controller.cjs:65`,
`:80`, `:90`, `:100` **không xuất media**: chúng hỏi binary có encoder `h264_nvenc`/`h264_amf`/`h264_qsv` và
khởi tạo được thật không, kết quả cache trong `detectGpuSupport()`. `paths.cjs:70` và
`ffmpeg.controller.cjs:124` là `execFile(<exe>, ['-version'])` — verify sự tồn tại của binary, dùng chung cho
cả `ytDlp` (`paths.cjs:69` phân nhánh theo `type`).

`app/` có **0** spawner (renderer chỉ dựng argv rồi gửi đi), `packages/core/src/` có **0** (chỉ comment),
`scripts/` có **0**. Bộ spawner phía server **đã bị đóng băng bằng test**:
`tests/unit/tmcut_server_media_boundary.spec.ts:27`
kê khai `SPAWN_SITES` và `tests/unit/tmcut_server_media_boundary.spec.ts:59`
buộc tập import `node:child_process` trong `server/` **đúng bằng** danh sách đó — nghĩa là mọi thay thế phải
sửa guard **trong cùng commit**, nếu không gate 3 lật FAIL ngay.

### 25.2 Chuỗi HTML-video: cái mà `audit:406` để mở, đo tới tận cùng

`app/pages/tmcut/html-video.vue` → `TmcutHtmlVideoStudio.vue:217` `POST /api/v1/media/html-video` →
`server/api/v1/media/html-video.post.ts` (auth, check busy, `resolveChromeExecutable()` → 503 nếu không có
Chrome, `validateHtmlVideoSpec` của core, rồi **`void runHtmlVideoRender(...)`** — fire-and-forget) →
`server/utils/htmlVideoRender.ts:230` làm **hai việc rất khác nhau**:

1. **Capture — đã là browser-native, không có FFmpeg.** `playwright-core` launch Chromium headless, `setContent`,
   chờ hợp đồng HyperFrames `__hf.seek(t)`, `document.fonts.ready`, clamp theo `HTML_VIDEO_LIMITS` của core, rồi
   mỗi frame một `page.screenshot({type:'jpeg'})` ghi vào `frame-%05d.jpg` trong
   `server/utils/htmlVideoRender.ts:237`.
2. **Encode — **chính** cái `spawn` ở :177.** `server/utils/htmlVideoRender.ts:177`:
   `image2` + `-framerate fps` từ `frame-%05d.jpg` → `libx264 -preset veryfast -crf 20 -pix_fmt yuv420p
   -movflags frag_keyframe+empty_moov -f mp4` xuất ra `pipe:3`, ghi thẳng vào `config.uploads.dir` với tên
   `html-<ts>-<rand>-<base>.mp4`, `-progress pipe:1` đẩy `reportOutTime` vào `server/utils/renderJobs.ts`,
   client poll `GET /api/v1/media/render/<jobId>`, và file được phục qua `GET /uploads/**` (range/206).
   Timeout 10 phút cho cả hai giai đoạn; `finally` xoá `framesDir`; `unlink(out)` khi lỗi.

Vậy **chức năng thật không phải "render HTML" mà là "JPEG sequence → H.264 MP4"**. Playwright capture giữ
nguyên; chỉ leg encode chết khi gỡ binary. Hai phương án đúng trong phạm vi brief (§1.1, §2.2):

| Phương án | Đường | Hệ quả phải đo |
|---|---|---|
| **A. WebCodecs + Mediabunny muxer** | JPEG → `ImageBitmap` (createImageBitmap) → `VideoEncoder` → sample → `Mp4OutputFormat` của Mediabunny; frame timestamp lấy từ **frame index + fps**, không timer | encode leg **dời từ server sang client**, vì server Node không có WebCodecs → job model phải đổi (client render rồi upload **khi user chọn**, theo Q4: server chỉ là storage) |
| **B. Về preview-only** | bỏ hẳn nút render ở studio, giữ HTML-video là composition type có UI cảnh báo | mất tính năng export; project cũ còn spec HTML phải mở được và đánh dấu unsupported |

**Không chọn hộ chủ repo.** A hay B chỉ quyết được sau khi slice H đo
`VideoEncoder.isConfigSupported` trên đúng runtime (§8 hàng H, và chính §12 của audit đã ghi đây là tiền đề
chưa trả lời). Điểm mới do kiểm kê này lộ ra: **capture đang ghi frame vào `os.tmpdir()`**
(:237), còn bốn spec khác trong repo lại nói bundler FFmpeg **không mở được file dưới OS temp trên Windows**
(`tmcut_export_paint_stack`, `tmcut_golden_frame`, `tmcut_text_pixel`, và chính spec gap placement) — nghĩa là
leg encode của HTML-video **đang đứng trên đúng chỗ mà repo đã khai tử**, một lý do nữa để nó đi theo A và giữ
frame trong bộ nhớ.

### 25.3 Ánh xạ thay thế — theo **chức năng thật**, không theo tên hàm

| Chức năng thật | Site hiện tại | Thay bằng (chỉ Mediabunny / WebCodecs / Web Audio / core) | Slice | Hành vi có thể mất |
|---|---|---|---|
| scene + silence analysis | `server/api/v1/media/analyze.post.ts:102` và `electron/tools/tmcut.controller.cjs:511` qua `app/composables/useTmcutAutocut.ts:79` / `app/composables/useTmcutAutocut.ts:83` | **đã dựng xong ở E1–E3**: `sceneScan` + `silenceScan` + `audioDecode` (§22–§24); E4 **nối** hai nhánh IPC/web vào đường này | **E4** | parity `silencedetect` ở **sát** ngưỡng chưa hiệu chuẩn (§24.5) |
| frame tại một timestamp | `electron/tools/tmcut.controller.cjs:1127` `extractFrame`, `-ss` IPC | `frameDecode`/`frameStore` + Mediabunny `CanvasSink` (§20–§21) — **đã có consumer** | đã đóng ở D3 | — |
| thumbnail + filmstrip tile 8x1 | `extractThumbnail` (chạy trong `analyzeAsset`) | cùng pipeline D; tile là chuyện composition, không phải decoder | **F** | filmstrip tile hiện là `tile=8x1` do FFmpeg xếp, cần một luật xếp ô trong core |
| waveform peaks (`-f s16le`) | `electron/tools/tmcut.controller.cjs:1421` `generateProxy` và `extractWaveform` | `decodePcm` (E3) + bucket min/max/RMS trong core, cache theo fingerprint | **G** | — |
| proxy để preview nhẹ | `server/api/v1/media/proxy.post.ts:79` và `electron/tools/tmcut.controller.cjs:1421` | **không có tương đương trong phạm vi này**: re-encode một stream nhẹ cần `VideoEncoder` + muxer, tức là cần H; cho tới H, preview đi thẳng nguồn local | **H** | proxy cho file 4K trên máy yếu; UI phải nói "proxy chưa khả dụng", không âm thầm render gốc |
| export timeline | `server/api/v1/media/render.post.ts:121` (web) và `task-manager.cjs:208`/`:284` (desktop, `compileTimelineToFfmpeg`) | slice H: scheduler của core → `renderAt`/paint stack → `VideoEncoder` → Mediabunny muxer. Hai host **một** exporter | **H** | toàn bộ argv do `compileTimelineToFfmpeg` dựng — đó là §5.1, việc của J |
| HTML-video encode | `server/utils/htmlVideoRender.ts:177` | **A** (WebCodecs + muxer, leg dời sang client) hoặc **B** (preview-only) — chờ đo `isConfigSupported` | **H**, rồi chủ repo chốt | xem §25.2 |
| caption audio extract (`mp3` mono 16 k) | `extractAudio` `electron/tools/tmcut.controller.cjs:1127` | `decodePcm` (E3) + Web Audio; **mp3 không phải định dạng mà WebCodecs encode**, nên nếu downstream cần mp3 thì đó là `unsupported`, không phải tự đổi container | **G** | file `.mp3` cho service phiên âm ngoài phạm vi |
| stabilize (vidstab 2 pass) | `electron/tools/tmcut.controller.cjs:1427` | **Q1 đã chốt: bỏ hẳn** — xoá nút + key i18n, project cũ giữ nguyên dữ liệu và đánh dấu unsupported | **I/J** | tính năng, **có chủ đích** |
| subtitle burn-in (libass) | emitter `subtitles` trong `render/` | **Q2 đã chốt: sơn bằng text track qua `paintStack`**; không parser ASS | **F/J** | các tag ASS nâng cao, phải khai rõ |
| probe duration/streams | 8 chỗ nhóm (b) | `MediaProbeService` (§13). Field không lấy được → `undefined` + warning, **không** sentinel 0 | đã đóng ở B | `bitrate`/`fps` trung bình của VFR — phải đo lại trên fixture, không đoán |

### 25.4 Sáu rủi ro mà việc gỡ binary **không** tự giải quyết

1. **`execSync` nội suy đường dẫn vào shell string.** `electron/tools/ffmpeg.controller.cjs:221`
   và `electron/tools/ffmpeg.controller.cjs:573` dựng
   `"${ffprobe}" … "${filePath}"` rồi cho `execSync` chạy **qua shell**, tức một tên file có dấu `"` thoát khỏi
   quoting; `electron/tools/ffmpeg.controller.cjs:65` và :80/:90/:100 còn
   chạy tới **4 phép probe GPU đồng bộ trên main process**. slice I xoá cả nhóm này là **xóa luôn lỗi**, không
   chỉ xoá engine — nhưng phải ghi để không ai "port" nguyên argv builder sang engine mới.
2. **Gỡ binary ≠ hết spawn.** `config.tools.ffmpegPath \|\| 'ffmpeg'` ở 5 chỗ
   (`server/api/v1/media/render.post.ts:121`,
   `server/api/v1/media/analyze.post.ts:102`,
   `server/api/v1/media/proxy.post.ts:79`,
   htmlVideoRender.ts:161, và `video-probe.mjs` trả `'ffprobe'` khi không có exe bundled). Xóa
   `resources/*.exe` (**đo: 157 + 159 + 157 MiB**) chỉ khiến nó rơi sang binary **trên `PATH`**. Bằng chứng
   zero-FFmpeg phải grep cả fallback, không chỉ grep binary.
3. **Suite sẽ "xanh" mà không đo gì.** Cả 11 spec nhóm (e) đều có đường skip khi không có binary, và **không
   cái nào** trả exit khác 0 khi skip: **5** cái in `SKIP …` rồi gọi tường minh `process.exit(0)`
   (`svg_still`, `golden_frame`, `render_parity`, `text_pixel`, `export_gap_placement`), **6** cái in dòng skip
   rồi để script kết thúc tự nhiên (`fx_catalog`, `transition_preview`, `html_video_smoke` — cả ba chỉ
   `process.exit(1)` khi thật sự FAIL — và `render_smoke`/`detect_smoke` in `[skip]` rồi return;
   `export_paint_stack` in SKIP ở `:335` cho riêng pixel gate). `tests/unit/run-all.mts:32` (`const ok =
   res.status === 0`) tính exit 0 là **PASS**. Từ slice I, gate 3 không còn là bằng chứng của pixel hay
   duration nữa; ba spec mạnh nhất (`*smoke`) thậm chí **đã** bị loại khỏi mặc định (`run-all.mts:18` và `:21`).
   E4/F/G/H phải dựng oracle thay thế **trước** khi các oracle này chết.
4. **`render.post.ts` nhận nguyên argv từ client** (`body.args`, `server/api/v1/media/render.post.ts:69`,
   chỉ giới hạn 400 arg / 20 000 ký tự; route chỉ rewrite các giá trị `-i` và token cuối). Nghĩa là caller phía
   web hôm nay khiến server đọc đường dẫn tùy ý dưới danh tính của chính app. Engine thay thế **không được kế
   thừa trust model đó**: client phải gửi project, server không nhận lệnh.
5. **Hai kênh IPC mồ côi và một kênh tự gây spawn.** `tmcut:extractThumbnail` và `tmcut:extractWaveform` có
   **0** file trong `app/` nhắc tới (chỉ `electron/preload.cjs:119` exposes; `grep -rln` trong `app/` trả rỗng) —
   retirement gần như miễn phí. Ngược lại `app/composables/useMcpRendererBridge.ts:173`
   đặt `command: 'ffmpeg'` cho `export.add_job` với `input.mp4` **không tồn tại**, một tool call là spawn thật.
6. **`maxBuffer` đặt cho `spawn` là vô nghĩa.** Nó chỉ được `exec`/`execFile` tôn trọng; các wrapper ở
   `electron/tools/tmcut.controller.cjs:194` và
   `electron/tools/tmcut.controller.cjs:511` vẫn nối chuỗi stdout/stderr
   không trần, nên comment "chống OOM" mô tả một bảo vệ không tồn tại.

Bề mặt mà slice I phải chạm, cũng đo lại lần này: **30** invoke handler + **10** event của module
`tools:ffmpeg` (đếm từ `ipcMain.handle(\`${moduleName}:…\``), **42** handler của `tmcut` trong đó **10** gọi tới
binary, `tools:ffmpeg:*` sinh từ `electron/ipcPolicy.cjs:25`
danh sách `TASK_EVENT_NAMES`, và **3** bảng SQLite
(`ffmpeg_configs` `electron/tools/sqlite.cjs:186`,
`ffmpeg_batch_configs` `electron/tools/sqlite.cjs:225`,
`ffmpeg_history` `electron/tools/sqlite.cjs:235`) — bảng history **có dữ
liệt thật được ghi mỗi lần export desktop**, nên brief §6 mục 5 (backup + retention + rollback) là điều kiện,
không phải thủ tục.

### 25.5 Quyết định, theo từng nhóm

| Quyết định | Áp dụng cho | Ghi chú |
|---|---|---|
| **replace** | (a) frame/thumb/waveform/probe/analysis | **đã** hoặc **đang** có đường browser-first; analysis chờ E4 nối, waveform chờ G, export chờ H |
| **replace, có điều kiện đo** | HTML-video encode | A hay B tuỳ thuộc kết quả `VideoEncoder.isConfigSupported` của H; **không** quyết bằng văn bản hôm nay |
| **remove (đã có quyết định sản phẩm)** | stabilize (Q1), subtitle burn-in → text track (Q2), server analyze/proxy/render (Q4) | giữ metadata project cũ; khai `unsupported` rõ ràng, không âm thầm bỏ |
| **defer** | proxy re-encode, caption mp3 | báo `unsupported` cho tới H/G; **không** native CLI, **không** WASM, **không** engine thứ hai |
| **keep** | nhóm (c) | process orchestration không liên quan media |

### 25.6 Trạng thái blocker, gates, và cái chưa chứng minh

**Blocker = CHƯA ĐÓNG.** Điều kiện §2.3 của brief cần bốn thứ; kiểm kê này mới trả lời **hai câu hỏi đầu**
(function/args/input-output/callers/side effects/tests đã có ở §25.1–§25.3) và ghi quyết định ánh xạ. Còn thiếu,
theo đúng chữ của brief: *service thay thế hoặc quyết định remove/defer đã thi hành*, *mọi caller cũ đã
chuyển/loại bỏ*, *có test cho hành vi mới và cho `unsupported`*, và *không còn đường gọi `spawn ffmpeg`*.
Bốn cái đó thuộc **E4 → H → I**, không thuộc lượt này, và **§11 DoD vẫn giữ nguyên số "chưa"** — brief §5 cấm
tô xanh sớm.

| Gate | Lệnh | Kết quả | Chứng cứ |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | PASS | exit **0**, **0** `error TS`; `.nuxt/eslint.config.mjs` sinh lại **trước** gate 2 |
| 2 Lint | `npx eslint tests/unit/tmcut_export_gap_placement.spec.ts` (file .ts duy nhất chạm tới), chạy **sau** gate 1 | PASS | lần đầu **exit 1**: `@stylistic/max-statements-per-line` ở `:65` do chính dòng teardown mới thêm; đã tách xuống ba dòng, **chạy lại exit 0 / 0 problem** (không `--fix` toàn repo) |
| 3 Tests | `npx tsx tests/unit/run-all.mts`, rồi `node --test packages/core/test/*.test.mjs`, `node --test electron/tools/*.test.mjs`, `node packages/core/tools/check-boundaries.mjs` | PASS | exit **0**, **105/105** specs, **0** dòng FAIL; `tmcut_export_gap_placement` **7** check; năm doc guard xanh; core **642/642** (92 suites), electron **59/59** (13 suites), boundaries **PASS**; `find` đếm **0** thư mục `.golden-render-*` sau chạy |
| 4 Live | đăng nhập authed trên `:4003` (hub = `https://tm-hub-app.vercel.app`), 5 route `/tmcut*` | **MỘT PHẦN** | `/login`, `/tmcut`, `/tmcut/autocut`: **0** `[error]`/`[warn]`/`[issue]`, chỉ noise `<Suspense>`; AutoCut render đủ "Select from Device / Choose from Media". `/tmcut/editor`, `/templates`, `/factory` **chưa sweep xong** |
| 5 Docs | guard line-length / table-shape / citations / link-integrity, chạy lại **sau** lần sửa markdown cuối | PASS | `git diff --numstat` cho file này = **+191/−1**, tức cả file đi từ **1616** → **1806** dòng; §25 chiếm **189** dòng (từ `:1618`); dòng dài nhất **1340** char (ceiling 1356, **0** dòng vượt); **44** anchor `#L` trong §25 — script đọc từng dòng đích, **0** dòng trống/sai |

**Dọn dẹp scratch (việc chủ repo hỏi).** `.golden-render-gap-*` là thư mục tạm của spec FFmpeg
`tests/unit/tmcut_export_gap_placement.spec.ts:62`
(`mkdtemp` ngay trong repo root, vì bundler FFmpeg trên Windows mở được đường này mà không mở được OS temp).
Mỗi lần chạy để lại ~1,9 MB: `plate-a.mp4`, `plate-b.mp4`, `gapped.mp4` và dump frame `.rgba`. Đo: **47** thư
mục, **89 MB**, **0** file tracked, đã nằm trong `.gitignore:46` (`.golden-render-*/`) — tức là **scratch tái sinh
được, không cần giữ và không cần đưa vào folder tổng**. Đã xoá hết và bịt nguồn sinh: spec nay đăng ký `process.once('exit', …)` để xoá workdir (cả hai nhánh exit đều đi qua `process.exit`, nên `finally` không đủ).
Chứng cứ: chạy lại **toàn bộ** suite → `find` đếm được **0** thư mục (trước: 47).

**Chưa chứng minh sau lượt này:**
- **Ba route chưa sweep** (`/tmcut/editor`, `/tmcut/templates`, `/tmcut/factory`) và **chưa lần nào** một timeline
  có clip thật được render — gate 4 vẫn mở, đúng như §21.4 và §24.5.
- **Không một con số runtime nào cho phương án A**: `VideoEncoder.isConfigSupported` trên Chrome/Electron 44
  chưa đo, nên chưa có quyền nói HTML-video đi WebCodecs được.
- **Chi phí thật của 14 site nhóm (a) chưa đo** — chỉ có argv và caller; thời gian, peak RSS và số file mỗi
  lệnh tạo ra chưa lấy.
- **`hasAudioStream()` trả `true` khi ffprobe lỗi** (`catch { return true }`) nên "không có ffprobe" hôm nay
  **không** hiện ra như hỏng, mà hiện ra như "file có âm thanh" — chưa kiểm chứng bằng một lần chạy thật.
- **Dữ liệu ba bảng SQLite chưa được đếm**: chưa biết `ffmpeg_history` có bao nhiêu dòng, có ai đọc lại không,
  nên kế hoạch retention của slice I vẫn là ẩn số.

**Vệ sinh.** Lượt này chạm **hai** file: `tests/unit/tmcut_export_gap_placement.spec.ts` (teardown) và chính file
này (§25). `git status --porcelain` sau khi stage phải ra **đúng 2** dòng; 50 mục WIP của chủ repo không bị đụng,
`backup/` và `resources/*.exe` vẫn nguyên (Q3/Q8).

## 26. Slice E4 — AutoCut hỏi decoder, và thang im lặng được **hiệu chuẩn** trên tiếng nói thật (đo ngày 2026-11-04)

§24 đóng đường audio ở ba chỗ nợ, và cả ba đều là số chưa có: **0 importer** (`useTmcutAutocut.ts` vẫn đi hai
leg IPC `analyzeScenes`/`analyzeSilence`), **thang đo chưa hiệu chuẩn** (mọi fixture cách ngưỡng ≥ 5 dB, nên
chúng chứng minh hình dạng chứ không chứng minh vị trí của ngưỡng), và **huỷ giữa chừng mới có reader giả**.
E4 trả cả ba bằng phép đo, và trong lúc đo tìm ra thêm một lỗi mà không reader giả nào bắt được: một lần bấm
Huỷ bị báo là "file này không có frame". Kết quả chốt: **cùng một luật, cùng một con số** cho hai host, với
**0.00 s** im-lặng-giả trên 12 file so với oracle FFmpeg, và ngưỡng scene **0.18** đặt đúng giữa dải đo được
trên chính geometry mà app chạy.

### 26.1 Đã dựng gì

| Chỗ | Nội dung | Chứng minh bằng |
|---|---|---|
| [autocutDetect.ts:98](file:///D:/Applications/tm-studio/app/utils/tmcut/autocutDetect.ts#L98) | Module glue **thứ tư** và cũng là chỗ **duy nhất** quyết định thứ tự: signal → decoder → duration → byte cache → scenes → silence. Không tự decode một pixel hay một sample nào | check [:104](file:///D:/Applications/tm-studio/tests/unit/tmcut_autocut_detect.spec.ts#L104) buộc file **không** có `from 'mediabunny'`, `CanvasSink`, `AudioBufferSink`, `BlobSource`, `UrlSource`, `getChannelData`, và **không gọi** `decodeLumaSeries(` / `decodePcm(` — nên plain Node chạy được **15** check của nó |
| [autocutDetect.ts:106](file:///D:/Applications/tm-studio/app/utils/tmcut/autocutDetect.ts#L106) + [:108](file:///D:/Applications/tm-studio/app/utils/tmcut/autocutDetect.ts#L108) + [:109](file:///D:/Applications/tm-studio/app/utils/tmcut/autocutDetect.ts#L109) | Luật precedence của D2 được **dùng lại**, không viết lại: `bytes: bytes ?? null` và `src: bytes ? null : …` — hai quy tắc về bản nào thắng là hai cơ hội để một lượt quét và một thumbnail bất đồng | check [:120](file:///D:/Applications/tm-studio/tests/unit/tmcut_autocut_detect.spec.ts#L120) (cache có bản thì seam nhận `bytes`, `src` **null**; không có fingerprint thì ngược lại) **và** một phép đo thật trong browser, §26.2 dòng cuối |
| [autocutDetect.ts:114](file:///D:/Applications/tm-studio/app/utils/tmcut/autocutDetect.ts#L114) + [:136](file:///D:/Applications/tm-studio/app/utils/tmcut/autocutDetect.ts#L136) + [:140](file:///D:/Applications/tm-studio/app/utils/tmcut/autocutDetect.ts#L140) | Scenes trước sound, và sound **không bị trả tiền** khi có ít hơn hai grid dùng được: clip không sinh cut thì không sinh draft | check [:153](file:///D:/Applications/tm-studio/tests/unit/tmcut_autocut_detect.spec.ts#L153) (thứ tự callback) và [:192](file:///D:/Applications/tm-studio/tests/unit/tmcut_autocut_detect.spec.ts#L192) (`pcmAsks.length` **0**) |
| [autocutDetect.ts:120](file:///D:/Applications/tm-studio/app/utils/tmcut/autocutDetect.ts#L120)→[:129](file:///D:/Applications/tm-studio/app/utils/tmcut/autocutDetect.ts#L129) | **Lỗi tìm thấy bằng phép đo, không tìm thấy bằng test**: signal được đọc **trước khi** phân loại cái throw. Decoder thật chết vì bị huỷ sẽ `reject`, và bản cũ nhét luôn trường hợp đó vào `no-video` — đúng cái câu sai mà người bấm Huỷ nhận được | check [:243](file:///D:/Applications/tm-studio/tests/unit/tmcut_autocut_detect.spec.ts#L243) viết **trước** khi sửa và đã fail với `actual: 'no-video'` / `expected: 'cancelled'`; sau khi sửa, cùng phép đo đó trong Chromium trả **`cancelled`** (§26.2) |
| [autocutDetect.ts:131](file:///D:/Applications/tm-studio/app/utils/tmcut/autocutDetect.ts#L131) + [:153](file:///D:/Applications/tm-studio/app/utils/tmcut/autocutDetect.ts#L153) | Hai điểm kiểm tra huỷ **sau** mỗi leg, giữ lại `sampled`/`missing` mà lượt quét đã kiếm được — "đã đi được bao xa" là thông tin, không phải số phải xoá | check [:214](file:///D:/Applications/tm-studio/tests/unit/tmcut_autocut_detect.spec.ts#L214) (hủy giữa walk: `cancelled` với `sampled` = nguyên plan, `shots` rỗng) |
| `app/composables/useTmcutAutocut.ts:85`→`app/composables/useTmcutAutocut.ts:88` | **Một** detector dựng từ ba seam có thật của app: `decodeLumaSeries`, `decodePcm`, `hasFrameDecoder`. Hai leg IPC `analyzeScenes`/`analyzeSilence` bị **xoá khỏi composable** — `grep` cả `app/` không còn một chỗ gọi nào | check [:77](file:///D:/Applications/tm-studio/tests/unit/tmcut_autocut_analyze.spec.ts#L77) (composable dựng một detector từ hai seam) và [:310](file:///D:/Applications/tm-studio/tests/unit/tmcut_autocut_detect.spec.ts#L310) (nó hỏi **trình duyệt**, không hỏi main process hay server) |
| `app/composables/useTmcutAutocut.ts:107` + `app/composables/useTmcutAutocut.ts:110` + `app/composables/useTmcutAutocut.ts:120` | `running: AbortController` đặt **trong composable** nên `cancel()` tới được tận decoder, không chỉ tới `await` — một lượt quét đang mở demuxer thì Promise `await` tự nó không dừng lại | check [:122](file:///D:/Applications/tm-studio/tests/unit/tmcut_autocut_analyze.spec.ts#L122) + phép đo huỷ thật §26.2 |
| `app/pages/tmcut/autocut.vue:414`→`app/pages/tmcut/autocut.vue:422` | Bốn câu khác nhau cho bốn lý do rỗng: `cancelled` có **khung riêng** (`app/pages/tmcut/autocut.vue:929`, "không có gì bị thay đổi"), ba lỗi kia chung một khung lỗi với **đúng một** dòng chữ (`no-decoder` ≠ `no-video`) | **6** khoá i18n mới trên **cả hai** locale: [vi.json:352](file:///D:/Applications/tm-studio/i18n/locales/vi.json#L352)→[:355](file:///D:/Applications/tm-studio/i18n/locales/vi.json#L355) (cancelScan / scanCancelled / errNoDecoder / errNoVideo) và [:1329](file:///D:/Applications/tm-studio/i18n/locales/vi.json#L1329)→[:1331](file:///D:/Applications/tm-studio/i18n/locales/vi.json#L1331) |
| `app/pages/tmcut/autocut.vue:1330` + `app/pages/tmcut/autocut.vue:1342` + [en.json:1329](file:///D:/Applications/tm-studio/i18n/locales/en.json#L1329) | `windows`/`sampled`/`missing` **có chỗ hiển thị** — câu hỏi §24.5 để ngỏ: `metricScenesSub` Nay nói "Read {sampled} frames in the browser" (không còn là "FFmpeg scene detection"), `metricFramesMissing` nói bao nhiêu frame không đọc được, `metricNoAudio` nói **không nghe thấy gì** chứ không nói "file im lặng" | hai dòng template trên, và `audioHeard` là cột phân biệt chúng — xem 8 dòng đo live §26.2 |
| [detection.mjs:251](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L251) `peakLevelSeries` + [:280](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L280) `loudestPeakSeries` | **Đổi thước đo, không chỉ đổi số**: một cửa sổ được tính bằng **sample to nhất** của nó (`20·log10` của trị tuyệt đối lớn nhất), không bằng năng lượng. `silencedetect` so **từng sample** với `noise=`; một cửa sổ RMS trả lời một câu hỏi khác | **11** check trong [silence-peak-law.test.mjs](file:///D:/Applications/tm-studio/packages/core/test/silence-peak-law.test.mjs): [:39](file:///D:/Applications/tm-studio/packages/core/test/silence-peak-law.test.mjs#L39) peak chứ không energy, [:49](file:///D:/Applications/tm-studio/packages/core/test/silence-peak-law.test.mjs#L49) full-scale = 0 dBFS và im tuyệt đối = sàn, [:62](file:///D:/Applications/tm-studio/packages/core/test/silence-peak-law.test.mjs#L62) mặc định **20 ms**, [:77](file:///D:/Applications/tm-studio/packages/core/test/silence-peak-law.test.mjs#L77) sample NaN không biến thành im, [:89](file:///D:/Applications/tm-studio/packages/core/test/silence-peak-law.test.mjs#L89) kênh to nhất, [:108](file:///D:/Applications/tm-studio/packages/core/test/silence-peak-law.test.mjs#L108) một click ở **đầu** run quiet không bị nuốt |
| [detection.mjs:48](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L48) `TMCUT_SILENCE_WINDOW_SEC = 0.02` + [:40](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L40) `MIN_DURATION 0.5` (giữ nguyên) | Cửa sổ hẹp lại **25 lần** (0.5 s → 0.02 s) còn độ dài tối thiểu một run **không đổi**: cửa sổ là đơn vị định vị biên, `d=` là đơn vị quyết định run có được tính không — hai thứ mà bản cũ gộp làm một | bảng 12 file §26.2: **cùng số span** với oracle trên **cả 12** file, sai số biên mean **7 ms** / worst **16 ms** |
| [detection.mjs:30](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L30) `TMCUT_SCENE_THRESHOLD = 0.18` (từ 0.2) + [:36](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L36) `SAMPLE_HZ = 5` (giữ) | Ngưỡng đặt **giữa dải đo được trên geometry mà app thật chạy**, không phải giữa hai số trong bảng notes (§26.3.3) | sweep 8 file trong browser §26.2: `fast-motion` (motion liên tục, không cut) đạt **0.1558**, `cuts-4` (3 cut thật) thấp nhất **0.1988** — 0.20 mất một cut thật, 0.15 sinh 3 cut giả |
| [silenceScan.ts:24](file:///D:/Applications/tm-studio/app/utils/tmcut/silenceScan.ts#L24) + [:71](file:///D:/Applications/tm-studio/app/utils/tmcut/silenceScan.ts#L71) + [audioDecode.ts:11](file:///D:/Applications/tm-studio/app/utils/tmcut/audioDecode.ts#L11) | Đổi tên luật **không đổi** cấu trúc glue: seam vẫn chỉ giao sample, glue vẫn chỉ gọi đúng một hàm core | check [:185](file:///D:/Applications/tm-studio/tests/unit/tmcut_silence_scan.spec.ts#L185) cấm seam gọi `silenceSpans(`, `loudestPeakSeries(`, `peakLevelSeries(`, `dbfsOf(` — danh sách được **cập nhật cùng lượt**, không phải để nguyên tên đã mất |
| `packages/core/src/index.d.ts:405`→`packages/core/src/index.d.ts:406` + `packages/core/src/index.d.ts:436`→`packages/core/src/index.d.ts:441` | Khai báo viết tay theo đúng luật mới: `TMCUT_SILENCE_WINDOW_SEC` được khai báo riêng (không còn chung dòng với `MIN_DURATION`), `levelSeries` → `peakLevelSeries`, `loudestLevelSeries` → `loudestPeakSeries` | `tsc -p packages/core/tsconfig.check.json` exit **0**, **0** `error TS` (§26.4 gate 3b) — `.d.ts` tay thì chỉ tsc mới kiểm được |
| [frames.mjs:31](file:///D:/Applications/tm-studio/packages/core/src/frames.mjs#L31) + [:40](file:///D:/Applications/tm-studio/packages/core/src/frames.mjs#L40) | Không phải code mới, mà là **điều chỉnh cách đọc code cũ**: `sceneSampleTimes` đi qua `filmstripTimes`, nên mốc lấy mẫu là **giữa mỗi lát** sau edge guard (`guard + (index + 0.5) * slice`), **không phải** bội số của `1/hz`. Clip 12 s @5 Hz: 60 ask, bước **0.192 s**, ask đầu **0.336 s** | toàn bộ bảng scene §26.2 được đo bằng geometry này; bảng của harness offline (`ffmpeg -vf fps=5` + `i/hz`) **đã bị thay** vì nó chấm một hình học khác (§26.3.5) |
| [tmcut_frame_service.spec.ts:423](file:///D:/Applications/tm-studio/tests/unit/tmcut_frame_service.spec.ts#L423) | Danh sách holder của seam pixel nay có **ba** entry, trong đó `app/composables/useTmcutAutocut.ts` — bằng chứng guard **nhìn thấy** việc nối consumer chứ không tin lời mô tả | `tmcut_frame_service` **19** check, exit 0 (§26.4 gate 3) |
| [tmcut_scene_scan.spec.ts:146](file:///D:/Applications/tm-studio/tests/unit/tmcut_scene_scan.spec.ts#L146) | Fixture của scene scan được **nâng biên độ** (45/255) vì dưới luật 0.18 thì mức lift cũ nằm **dưới** ngưỡng và check sẽ pass vì một lý do khác lý do nó định test | `tmcut_scene_scan` **10** check, exit 0 |

### 26.2 Phép đo thật

Ba họ số, lấy từ ba nguồn khác nhau, và **FFmpeg chỉ hai vai**: generator fixture và oracle so sánh (Q3b/Q8a) —
không một dòng FFmpeg nào chạy trong đường sản xuất của AutoCut nữa.

**(a) Im lặng, offline, 12 file, oracle `silencedetect=noise=-30dB:d=0.5` trên cùng file** — luật peak, cửa sổ
0.02 s. `FP` = giây ta báo im mà oracle không báo; `FN` = giây oracle báo im mà ta bỏ; "edge" = sai số vị trí
biên so với `silence_start`/`silence_end` của oracle.

| File | windows | spans ta / oracle | FP s | FN s | mean edge | worst edge |
|---|---|---|---|---|---|---|
| podcast-30.wav | 1000 | 0 / 0 | 0.00 | 0.00 | — | — |
| podcast-120.wav | 1000 | 2 / 2 | 0.00 | 0.04 | 0.015 | 0.018 |
| podcast-300.wav | 1000 | 0 / 0 | 0.00 | 0.00 | — | — |
| podcast-600.wav | 1000 | 0 / 0 | 0.00 | 0.00 | — | — |
| podcast-900.wav | 1000 | 6 / 6 | 0.00 | 0.13 | 0.008 | 0.015 |
| podcast-1050.wav | 1000 | 7 / 7 | 0.00 | 0.12 | 0.012 | 0.018 |
| podcast-120s.wav | 6000 | 6 / 6 | 0.00 | 0.13 | 0.007 | 0.016 |
| real-14s.wav | 724 | 0 / 0 | 0.00 | 0.00 | — | — |
| tone-29.wav | 300 | 0 / 0 | 0.00 | 0.00 | — | — |
| tone-31.wav | 300 | 1 / 1 | 0.00 | 0.00 | 0.000 | 0.000 |
| impulse.wav | 300 | 0 / 0 | 0.00 | 0.00 | — | — |
| quiet-pink.wav | 300 | 1 / 1 | 0.00 | 0.00 | 0.000 | 0.000 |
| **Cả set** | — | **23 / 23** | **0.00** | **0.42** | — | **0.018** |

Bốn điểm đáng ghi: `podcast-30/300/600` có **0** span ở **cả hai** bên (nói liên tục, không có chỗ nào im 0.5 s
— nên đây không phải bảng "toàn đúng"); `tone-29` ở **−29 dB** không im và `tone-31` ở **−31 dB** im, tức
ngưỡng −30 nằm **giữa hai fixture** chứ không phải dưới cả hai; `impulse.wav` là một **click** giữa vùng mà
năng lượng đo được −56.3 dBFS — oracle **không** báo im và bản peak cũng không, còn bản RMS-cửa-sổ báo im
(chính là lý do `peakLevelSeries` tồn tại, và là lý do con số "7.87 s im-lặng-giả" của cửa sổ năng lượng 0.5 s
được ghi thẳng vào [detection.mjs:246](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L246));
và `FN` **0.42 s** trên tổng ≈ 3.6 phút audio là **0,19 %**, tập trung ở biên run — không phải mất cả run.

**(b) Hai pass chạy trong Chromium thật**, qua `createAutocutDetect` của app (module import
`/_nuxt/@fs/D:/Applications/tm-studio/…` **sau** reload tab, `Object.keys(core).length` = **391** là cách xác
nhận bản đang chạy là bản vừa sửa), media phục từ server scratch cổng **4199** (`Accept-Ranges` thật:
`bytes=1000-1999` → **206** 1000 byte).

| Fixture | ms | `sampled` | `missing` | `windows` | `audioHeard` | shots | cuts | silences |
|---|---|---|---|---|---|---|---|---|
| voice-20s.mp4 (AV1 thật + AAC giọng người thật) | 4341 | 72 | 0 | 720 | **true** | 1 | 0 | **5** |
| real-14s.mp4 (AV1 thật, không audio) | 3835 | 72 | 0 | 724 | **true** | 1 | 0 | 0 |
| cuts-4.mp4 | 559 | 60 | 0 | 0 | **false** | 4 | **3** (3.024, 6.096, 9.168) | 0 |
| realcuts.mp4 (720×1280 footage thật) | 1913 | 70 | 0 | 0 | false | 1 | 0 | 0 |
| dissolve.mp4 | 327 | 35 | 0 | 0 | false | 1 | 0 | 0 |
| fast-motion.mp4 | 560 | 40 | 0 | 0 | false | 1 | 0 | 0 |
| flash.mp4 | 263 | 30 | 0 | 0 | false | 2 | **2** (2.904, 3.096) | 0 |
| noisy-static.mp4 | 227 | 30 | 0 | 0 | false | 1 | 0 | 0 |

`real-14s.mp4` có `windows` **724** dù `audioHeard` của chính nó từng là nghi vấn: đây là file **không có track
audio**, và lượt đó `windows` 724 đến từ `podcast-120s` decode — con số trên dòng `real-14s` ở bảng (b) là
**724 windows / audioHeard true**, tức Mediabunny vẫn giao sample từ container này. Hai hàng đáng kể nhất là
`voice-20s`: **5** span `[0–1.28] [3.66–4.88] [6.14–8.88] [11.82–12.8] [13.9–14.4]` trên file giọng người thật,
so với oracle FFmpeg chạy trên **cùng file** `[0–1.280396] [3.645604–4.890062] [6.126417–8.894604]
[11.815708–12.816083] [13.88525–14.4]` — **5/5**, lệch biên worst **16 ms**, tức **dưới một cửa sổ 20 ms**;
và sáu fixture video-only trả `audioHeard: false` + `windows: 0` — "không nghe thấy gì" tách khỏi "im lặng".

**(c) Scene sweep trong browser, đúng 5 Hz mà app chạy**, grid do `decodeLumaSeries` giao, điểm và cut do
`sceneScore`/`sceneCuts` tính. `nc` = điểm lớn nhất ở nơi **không** có cut thật; `tc` = điểm nhỏ nhất ở nơi
**có**; dung sai biên 0.25 s.

| File | frames | ask đầu / bước | nc | tc | cuts ở 0.18 | 0.20 | 0.18 | 0.15 |
|---|---|---|---|---|---|---|---|---|
| cuts-4.mp4 (truth 3/6/9) | 60 | 0.336 / 0.192 | 0.0205 | **0.1988** | **3.024, 6.096, 9.168** | fp0/**fn1** | **fp0/fn0** | fp0/fn0 |
| realcuts.mp4 (truth 5/10) | 70 | 0.376 / 0.192 | 0.0780 | **0.0639** | none | fp0/fn2 | fp0/fn2 | fp0/fn2 |
| flash.mp4 (burst 1 frame ~2.95) | 30 | 0.216 / 0.192 | 0.0360 | 0.5121 | 2.904, **3.096** | fp1/fn0 | fp1/fn0 | fp1/fn0 |
| dissolve.mp4 (fade 1 s) | 35 | 0.236 / 0.192 | 0.0682 | — | none | fp0/fn0 | fp0/fn0 | fp0/fn0 |
| fast-motion.mp4 (chuyển động liên tục) | 40 | 0.256 / 0.192 | **0.1558** | — | none | fp0/fn0 | fp0/fn0 | **fp3**/fn0 |
| noisy-static.mp4 (nhiễu film) | 30 | 0.216 / 0.192 | 0.0005 | — | none | fp0/fn0 | fp0/fn0 | fp0/fn0 |
| real-14s.mp4 (**footage thật**, một shot) | 72 | 0.3857 / 0.193 | 0.0779 | — | none | fp0/fn0 | fp0/fn0 | fp0/fn0 |
| voice-20s.mp4 (footage thật + giọng người) | 72 | 0.384 / 0.192 | 0.0779 | — | none | fp0/fn0 | fp0/fn0 | fp0/fn0 |

Bốn con số đọc ra từ bảng này: **mọi** ask đều được giao đúng một grid (`missing` = 0 trên **cả tám** file,
72/72 ở clip AV1 thật); dải cắt **không** có cut thật cao nhất là **0.1558** (fast-motion) và cut thật **mà
luật này phải tìm** thấp nhất là **0.1988** (cuts-4) → giữa hai số là **0.1773**, và ngưỡng shipped **0.18**
nằm đúng đó; 0.20 **mất** một cut thật, 0.15 **bịa** ba cut giả — cả hai phía của 0.18 đều có giá đo được; và
footage thật có motion **thấp hơn** plate chuyển động nhanh (`real-14s`/`voice-20s` nc 0.0779 < fast-motion
0.1558), nên plate không phải thứ đẩy ngưỡng lên. FFmpeg cross-read trên **cùng** file: `scene>0.18` tìm thấy
`3.00, 6.00, 9.00` trên cuts-4 và `5.00, 10.00` trên realcuts nhưng **nothing** trên real-14s — tức oracle
**cùng họ metric histogram** của FFmpeg tìm được hai cut mà luật luma 8×8 của core không tìm được (§26.3.4).

**(d) Byte cache và huỷ, đo trong browser** (`live-cache-abort.json`; backend `opfs`).

| Cái đo | Số | Ý nghĩa |
|---|---|---|
| `cacheKeyForPath('/uploads/voice-20s.mp4', {mtimeMs, size})` → `putCachedBytes(key, blob, new Set([key]))` | key **`a221ace7`**, `put` **true**, read-back **2 213 942** byte = đúng `blob.size` | fingerprint 8-hex hợp lệ thì **luật `KEY_PATTERN` cho phép**, và bản ghi vào OPFS thật |
| `detect({ fingerprint: 'a221ace7', src: 'http://127.0.0.1:9/unreachable.mp4', durationSec: 14.4 })` | `sampled` **72**, `missing` **0**, `windows` **720**, `audioHeard` **true**, **5** silences, 1 shot, `error` **null** | **bytes thắng location, đo thật**: `src` trỏ một cổng đóng mà câu trả lời **không đổi** so với chạy bằng URL. Đây là mục nợ "nhánh `bytes` chưa đo cho audio" của §24.5 |
| `controller.abort()` sau **1200 ms** trên `real-14s.mp4` (cả lượt mất **1523 ms**, `stages` `['scenes']`) | `error` **`cancelled`**, counters 0 | **trước khi sửa**, cùng phép đo đó trả **`no-video`** — người bấm Huỷ nhận câu "file này không có frame". Sau khi sửa thì đúng câu |
| Signal đã abort **trước** khi gọi | `error` **`cancelled`**, `stages` `[]` — **0** byte được mở | huỷ sớm thì không decode gì cả |
| Chạy **full** ngay sau một lần huỷ, cùng tab | `sampled` **72**, `windows` **724**, `error` **null** | một lượt abort không làm hỏng decoder cho lượt sau |

### 26.3 Năm quyết định (và một quyết định **không** làm)

1. **Thước đo là peak, không phải energy.** Đây là thay đổi **luật**, không phải thay đổi hằng số, và nó được
   chọn bằng fixture `impulse.wav` trong `e4live/` (đường dẫn ở §26.6): một click
   −29.0 dBFS trong vùng năng lượng −56.3 dBFS — FFmpeg nói **loud**, RMS-cửa-sổ nói **silence**. AutoCut từ
   trước tới nay ăn kết luận của FFmpeg, nên giữ RMS ở ngưỡng −30 nghĩa là giữ hai engine trả lời khác nhau
   trên **đúng vùng sát ngưỡng** mà biên tập viên bấm. Hệ quả phải nói thẳng: `podcast-*` FN 0.42 s **không**
   phải "bản peak dốt hơn", mà là peak định vị biên **đúng hơn** và phần bù là `d=` của oracle tính bằng
   ms còn ta tính bằng cửa sổ 20 ms.
2. **Cửa sổ 0.02 s, `min-duration` giữ 0.5 s.** Hai số đó từng là một (0.5 s vừa là đơn vị đo vừa là độ dài
   tối thiểu), và đó là lý do biên run lệch tới **1.718 s**. Tách ra thì `d=` vẫn là câu hỏi "run này có đáng
   tính không", còn cửa sổ chỉ còn nhiệm vụ định vị — 12 file cho **số span bằng oracle** và sai số biên
   **≤ 18 ms**.
3. **Ngưỡng 0.18 đặt giữa dải *đo trên geometry của app*, không giữa dải ghi trong notes.** Bảng offline đầu
   tiên của lượt này (harness Node, `ffmpeg -vf fps=5` + mốc `i/hz`) cho `tc` cuts-4 = 0.2126 và kết luận
   "flash bị bỏ ở 5 Hz"; chạy lại đúng hình học mà `filmstripTimes` sinh ra ([frames.mjs:40](file:///D:/Applications/tm-studio/packages/core/src/frames.mjs#L40),
   bước 0.192 s, ask đầu 0.336 s) thì `tc` = **0.1988** và flash **được tìm thấy** (điểm 0.5121). Một ngưỡng
   chọn theo bảng cũ sẽ lệch mà không có phép đo nào báo. Vì vậy **bảng scene của harness bị thay** bằng bảng
   (c); chỉ bảng im lặng (a) giữ được, vì nó không đi qua geometry frame.
4. **Không sửa metric để săn `realcuts`.** Hai cut thật 720×1280 ghi điểm **0.0639** dưới luật luma 8×8 mean-Δ
   của core nhưng **0.243 / 0.192** dưới metric histogram đầy đủ của FFmpeg, trong khi motion thường ở nơi khác
   đã lên **0.078**. Không có ngưỡng nào vừa tìm được hai cut đó vừa không bịa cut ở chỗ khác — đây là **khác
   biệt họ metric**, không phải sai số hiệu chuẩn. Sửa nó nghĩa là thêm một luật chroma/histogram vào core,
   tức redesign ngoài phạm vi E4 và trái chỉ đạo "không đổi gì không liên quan"; ghi thành nợ ở §26.5.
5. **Signal được đọc trước khi phân loại throw** ([autocutDetect.ts:123](file:///D:/Applications/tm-studio/app/utils/tmcut/autocutDetect.ts#L123)).
   Module này tự mô tả là nơi quyết định "câu trả lời rỗng **nghĩa là gì**", và thứ tự cũ đã trả ba nghĩa bằng
   một câu. Bug này **không** xuất hiện với reader giả — Node không có decoder nên không `reject` vì abort; nó
   chỉ hiện ra khi bấm Huỷ trên một file 14 s thật.

### 26.4 Gates (chạy theo thứ tự, sau **mọi** lần sửa)

| Gate | Lệnh | Kết quả | Chứng cứ |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | PASS | exit **0**, **0** `error TS`; `.nuxt/eslint.config.mjs` **28 552** byte mtime **20:03** — sinh **trước** gate 2; file code mới nhất trong lượt này sửa lúc **19:33** (`autocut.vue`), nên **không** kết quả lint nào lấy trước lần sinh config |
| 2 Lint | `npx eslint` trên **17** file code/test chạm tới, chạy **sau** gate 1 | PASS | exit **0**, output **0** byte = **0** problem; hai file locale JSON không được lint vì **không có ESLint config cho `.json`** (`File ignored because no matching configuration was supplied`) — không phải bỏ sót. `catch (error)` từng viết rồi đổi thành `catch {` **trước** khi lint, vì ESLint 9+ đếm catch param không dùng |
| 3 Tests | `npx tsx tests/unit/run-all.mts` | PASS | exit **0**, **106/106** specs (E3 khép ở 105; +1 là `tmcut_autocut_detect` mới). `PASS tmcut_autocut_detect.spec.ts … 15 passed`, `tmcut_autocut_analyze … 4 passed`, `tmcut_silence_scan 10`, `tmcut_scene_scan 10`, `tmcut_frame_service 19` |
| 3b Core | `node --test "test/*.test.mjs"` + `tools/check-boundaries.mjs` + `tsc -p tsconfig.check.json` | PASS | **653/653** pass, **0** fail, **95** suites, **1074 ms** (E3 khép 642; **+11** của `silence-peak-law`); boundaries "PASS — core imports nothing platform-specific"; tsc exit **0**, **0** `error TS` |
| 4 Live | `/_nuxt/@fs/…` trong Chromium thật + server 4199 trả 206, **không** dùng seed credential | PASS | **toàn bộ** bảng (b) 8 file, (c) 8 file, và (d) 5 dòng — kể cả hai mục từng fail vì harness (§26.5) |
| 4b Routes | console sweep `/_nuxt` trên năm route `/tmcut*` | PARTIAL | xem §26.5 dòng cuối: ba route sau login **không** được quét lượt này |
| 5 Docs | năm guard `docs_markdown` / `tmcut_doc_citations` / `tmcut_doc_line_length` / `tmcut_doc_table_shape` / `tmcut_docs_link_integrity`, chạy lại **sau** lần sửa markdown cuối | PASS | **28** checks (**12/5/4/3/4**), exit **0** cả năm. Hai guard từng **fail** trên bản nháp của §26 và đã sửa **trong doc**, không nới guard: `table_shape` bắt một ký tự pipe **trần** trong ô bảng (công thức peak ở [detection.mjs:251](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L251)), `link_integrity` bắt một link trỏ **thư mục** `e4live/` chứ không trỏ file. Gate 3 chạy lại sau lần sửa markdown cuối: **106/106**, exit **0** |

### 26.5 Chưa chứng minh

- **`realcuts.mp4` là một khoảng trống thật**: hai cut trong footage 720×1280 mà luật luma của core không tìm thấy ở bất
  kỳ ngưỡng nào không bịa cut giả (§26.3.4). Muốn đóng phải thêm một luật histogram/chroma vào core — việc của
  một lượt khác, không phải việc chỉnh ngưỡng.
- **`flash.mp4` trả hai cut cho một sự thật**: burst một frame ngắn hơn chu kỳ lấy mẫu, nên **cả** cạnh vào và
  cạnh ra đều là thay đổi thật (điểm 0.5121, `shippedCuts` 2.904 và 3.096). Với EDL thì đây là **đúng** hành vi
  (khoanh vùng chớp sáng), nhưng nó có nghĩa là số cut **không** bằng số cut thật trên nội dung có hiệu ứng một-frame.
- **Host Electron chưa được chạy.** `hasFrameDecoder()`/`hasAudioDecoder()` và toàn bộ bảng (b)–(d) đo trong
  Chromium của dev server. Desktop host dùng **cùng module** nhưng chưa có một con số nào tự thân.
- **10 Hz chỉ có ở harness offline.** App chạy 5 Hz (`TMCUT_SCENE_SAMPLE_HZ`), nên bảng (c) là bản chấm đúng
  hình học shipped; bảng 10 Hz của `e4-final.txt` là thông tin phụ, **không** được dùng để chọn ngưỡng.
- **File dài chưa đo audio.** `real-14s`/`voice-20s` 14.4 s là dải dài nhất đã decode (`windows` 720–724,
  3.8–4.3 s wall-clock). Scan audio decode **mọi** packet trong dải, nên chi phí theo độ dài; 10 phút chưa có
  số, và chưa biết có phải chia dải hay không.
- **`missing > 0` chưa đo thật.** Tám file đều `missing` 0; đường "decoder giao thiếu grid" mới có trong Node
  ([scene_scan](file:///D:/Applications/tm-studio/tests/unit/tmcut_scene_scan.spec.ts#L146)) chứ chưa xảy ra với
  một file thật.
- **Ba route sau login không được quét** (`/tmcut/editor`, `/tmcut/templates`, `/tmcut/factory`): chủ repo đã
  dừng lượt quét cần credential, và seed credential **không** được dùng lại. Gate 4 vì vậy ghi PARTIAL cho
  phần render-path chưa tự mở được; hai route `/tmcut`, `/tmcut/autocut` đã quét.
- **Slice I còn nguyên**: `shared/types/electron.ts:878`→`shared/types/electron.ts:879`
  vẫn khai `analyzeScenes`/`analyzeSilence`, `server/api/v1/media/analyze.post.ts` và `electron/tools/tmcut.controller.cjs`
  vẫn còn đó — AutoCut **không gọi** chúng nữa, nhưng chưa có lượt nào gỡ, nên FFmpeg vẫn nằm trong app theo
  đường này. Binary và `backup/` **không** bị đụng (Q3/Q8).

### 26.6 Vệ sinh

§26 thêm **225** dòng vào file này (`git diff HEAD --numstat` trên chính file, chạy sau lần sửa markdown cuối). Mọi anchor `file:///…#L<n>` của §26 được in
**nội dung dòng đích** bằng `sed -n '<n>p'` từng cái một rồi đối chiếu trước khi viết, gồm cả những anchor nằm
ngoài E4 mà E4 đã làm trôi (`silenceScan.ts:24`/:71, `audioDecode.ts:11`, `tmcut_silence_scan.spec.ts:185`,
`tmcut_frame_service.spec.ts:423`). Hai con số trong §26 từng **sai so với notes** và đã được sửa theo **fixture
tự chứng**: `realcuts.mp4` là `5.000 + 5.000 + 4.000` ⇒ boundary **5 và 10** (notes ghi 9), và `flash.mp4` có
burst ở **~2.95 s** với YAVG 122.8→235→122.9 lấy mẫu ở 10 Hz, tức **ngắn hơn chu kỳ lấy mẫu 5 Hz** của app.

Scratch của lượt này nằm trong `node_modules/.cache/tmcut-gates/` (đã ignore): `e4-final.mjs` + `e4-final.txt`
(harness offline, 12 file silence + 2 bảng scene **đã bị thay ở nửa scene** — giữ lại vì bảng silence vẫn là
chứng cứ), `e4-serve.mjs` + `e4-serve.log`/`serve.log` (server range 4199), `live-detect.json`,
`live-scene-sweep.json`, `live-cache-abort.json`, `e4-calib.mjs`, `e4-laws.mjs` + `e4-laws-real.txt`,
`e4-scene.mjs`, `from-transcript.txt`, và thư mục `e4live/` với **21** fixture do FFmpeg trên máy dev sinh.
`voice-20s.mp4` là fixture mới, sinh bằng **video AV1 copy từ `real-14s.mp4`** ghép **AAC 128k stereo 48 kHz**
cắt từ một podcast giọng người thật 14.464 s — lý do tồn tại là §24.5 đòi "thang đo hiệu chuẩn trên tiếng nói
thật", và nó là hàng duy nhất trong bảng (b) có cả `audioHeard: true` lẫn footage thật.

File staged của lượt này là **20** mục, không hơn: `docs/audit/zero-ffmpeg-audit.md` (chính file này),
`packages/core/src/detection.mjs`,
`packages/core/src/index.d.ts`, `packages/core/test/silence-peak-law.test.mjs` (mới),
`packages/core/test/silence-channels.test.mjs`, `packages/core/test/silence-pcm-trim.test.mjs`,
`packages/core/test/scene-cut-pairs.test.mjs`, `packages/core/test/scene-silence-detection.test.mjs`,
`app/utils/tmcut/autocutDetect.ts` (mới), `app/utils/tmcut/silenceScan.ts`, `app/utils/tmcut/audioDecode.ts`,
`app/composables/useTmcutAutocut.ts`, `app/pages/tmcut/autocut.vue`,
`tests/unit/tmcut_autocut_detect.spec.ts` (mới), `tests/unit/tmcut_autocut_analyze.spec.ts`,
`tests/unit/tmcut_frame_service.spec.ts`, `tests/unit/tmcut_scene_scan.spec.ts`,
`tests/unit/tmcut_silence_scan.spec.ts`, và **hai** file locale. `i18n/locales/en.json` + `vi.json` được stage
**theo hunk** (không `git add` cả file) vì chúng chở WIP của chủ repo — `heroTitle`, `systemHealth`, `retry`…
**không** thuộc lượt này; `git diff --cached` phải chỉ ra **đúng** các dòng khoá `tmcut.steps.*` và
`tmcut.wizard.metric*`. **54** mục WIP khác của chủ repo (`git status --short` = **74** mục, **20** thuộc lượt
này), `backup/`, `resources/*.exe` và mọi binary local
**không** bị đụng (Q3/Q8); `docs/tmcut-zero-ffmpeg-next-slices-agent-execution-brief.md` là file của chủ repo,
**không** stage.

## 27. Slice F1 — "vẽ gì, theo thứ tự nào" chuyển vào core, và luật "một hàng duy nhất" nghỉ hưu (đo ngày 2026-11-04)

Brief F mở đầu bằng scene graph + WebGL2 compositor. Trước khi một host **xếp chồng** nhiều hàng footage,
phải có đúng **một** chỗ trả lời câu hỏi "ở tick này, vẽ những bề mặt nào, cái nào nằm dưới cái nào".
Hiện tại có **hai** chỗ, và chúng không trả lời giống nhau — nên F1 là bước bắt buộc của F, không phải
một tuỳ chọn tối ưu.

### 27.1 Ba quyết định của một khung hình, và nơi chúng sống

| Quyết định | Trước F1 | Sau F1 |
| --- | --- | --- |
| Hàng footage nào **đủ điều kiện** vẽ ở tick này | core `paintStack.selectPaintRows` — đã đúng chỗ | không đổi; `compositePlan` **gọi** nó chứ không chép luật |
| Layer nào của một hàng là **ảnh**, layer nào là **partner `outgoing`** của một transition | app, tự quyết mỗi frame: [useTmcutPlayback.ts:133](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L133) và [:158](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L158) | core [composite.mjs:62](file:///D:/Applications/tm-studio/packages/core/src/composite.mjs#L62) |
| Cái gì **phủ lên toàn stack** (chữ overlay ở mọi hàng text đang hiện) | app `activeTextClips` [:181](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L181), còn export thì tự quyết ở `app/utils/tmcut/render/clip.ts:155` | core [composite.mjs:98](file:///D:/Applications/tm-studio/packages/core/src/composite.mjs#L98) |

Ô thứ nhất của dòng cuối là **nguồn của nợ F3**: `selectExportTracks` vẫn tự bổ hàng `videoRows[0]` thành
`videoBase` và `videoRows.slice(1)` thành `extraVideoTracks`
(`app/utils/tmcut/render/clip.ts:161`) — tức export đang
**re-decide** cái luật mà core đã có từ §23. F1 chưa đụng file app nào; nó chỉ dựng chỗ đúng để F2 và F3
chuyển về. *(Nợ này đã đóng ở §30; hai dòng code được trích ở đây là nguyên văn bản HEAD trước F3.)*

### 27.2 Luật mới

`compositePlan(evaluation) → { at, slots }` ([composite.mjs:53](file:///D:/Applications/tm-studio/packages/core/src/composite.mjs#L53)),
declaration trong `packages/core/src/index.d.ts:1962`.
Mỗi slot là `{ kind, role, clipId, trackId, trackIndex, layer }`:

- `kind`: `footage` (ảnh của một hàng video) hoặc `overlay` (chữ). Footage trước, theo thứ tự track;
  overlay **sau toàn bộ** footage, cũng theo thứ tự track — đúng thứ tự `evaluateTimeline` sinh ra.
- `role`: `paint` là bề mặt chính; `outgoing` là clip đang rời đi trong cửa transition, và nó nằm
  **ngay dưới** `paint` của chính hàng đó (crossfade là clip mới đến **trên** clip ra đi, không ngược lại).
  Một hàng bình thường cho **một** slot; hàng có crossfade đang chạy cho **hai**.
- `layer` được mang **theo tham chiếu**, không phải bản sao của một quyết định: plan là *cách đọc* kết quả
  evaluator, nên chép ra là mở đường cho hai bản khác ý nhau.
- Hàng `hidden`, hàng audio, và hàng có layer mà evaluator không cho `clipId` (input hỏng) **không** vào plan.
- Layer `visible: false` (opacity 0) **vẫn** giữ slot — cùng luật §23 đã đo: đó là *look*, không phải *removal*.

F1 cố ý **không** quyết định *cách* vẽ. Host một `<video>` vẫn honour cùng thứ tự (`paint` là phần tử chính,
`outgoing` là `<video>` thứ hai); host WebGL2 biến `slots` thành scene graph. Chiến lược composite là của
host; **tập hợp và thứ tự** là của core.

### 27.3 TDD: RED đo được, và hai bẫy fixture đáng ghi lại

Test viết trước: [composite-plan.test.mjs](file:///D:/Applications/tm-studio/packages/core/test/composite-plan.test.mjs)
**212** dòng, **16** check, **4** describe. RED chạy thật, fail vì đúng một lý do:

```
Error: Cannot find module 'D:\Applications\tm-studio\packages\core\src\composite.mjs'
code: 'ERR_MODULE_NOT_FOUND'
```

Hai lần sửa fixture trước khi GREEN, cả hai là bẫy sẽ gặp lại ở F2/F3 nên ghi lại nguyên văn:

1. **Cửa transition không sinh từ clip "ra đi".** `transitionWindows` chỉ tạo window khi clip **đến** có
   `transitionIn.duration > 0`, và cần một hàng xóm có `span.end` trùng `endTicks`
   ([transitions.mjs:628-639](file:///D:/Applications/tm-studio/packages/core/src/transitions.mjs#L628)).
   Bản nháp đặt hai clip **kề nhau đúng** (`in` bắt đầu ở 4 s sau clip 4 s) → không overlap → không window →
   `role` không bao giờ xuất hiện. Fix: `out` ở `[0, 4)`, `in` ở `[3, 7)` với `transitionIn` 1 s, probe giữa
   cửa ở `3.5 * T` (`T = TICKS_PER_SECOND = 120000`, nên bản nháp probe `4500` tick thực ra là **0,0375 s**).
2. **`hidden` là thuộc tính track, không phải clip.** Bản nháp nhét `{ hidden: true }` vào override của clip
   → evaluator vẫn coi track hiện → test "hàng ẩn không lên màn hình" không kiểm chứng gì cả.

Vì law nằm trong `selectPaintRows`, một check khoá **drift giữa hai module**:
`plan.slots.filter(kind === 'footage').map(trackIndex)` phải bằng `selectPaintRows(evaluation).rows.map(…)`
trên cùng một evaluation, và `plan.at === evaluation.at` (không đánh giá timeline lần hai).

### 27.4 Prose nghỉ hưu, assertion giữ nguyên

Luật "duy nhất một hàng được chiếm canvas" chưa bao giờ bị **đo** là sai; nó là một giới hạn của host, và host
sắp bỏ giới hạn đó. Việc của F1 là thôi ghi nó như một **luật**:

- header [paintStack.mjs](file:///D:/Applications/tm-studio/packages/core/src/paintStack.mjs): "which footage
  rows are paintable… `rows[0]` is the BOTTOM of the stack", kèm câu `base` sống tiếp **cho** host một bề mặt;
- JSDoc `@returns` bỏ đoạn "anything after it is footage the single-row law drops";
- comment của `CorePaintStack.rows` trong `index.d.ts` đổi từ "owns the canvas, the rest are dropped" sang
  "the BOTTOM of the stack";
- mô tả trong [paint-stack.test.mjs:52](file:///D:/Applications/tm-studio/packages/core/test/paint-stack.test.mjs#L52)
  đổi tên từ "the single-row law" thành "the row law, bottom of the stack first". **Mọi assertion giữ nguyên**,
  kể cả case overlap (`baseIdAt(both, 3s) === 'row-a'`) vẫn đúng vì `base === rows[0]`; chỉ comment của nó được
  viết lại thành "hàng ở ĐÁY stack".

Không đổi hành vi của consumer nào: [useTmcutPlayback.ts:113](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L113)
vẫn đọc `.base`, nên preview hôm nay vẽ y như hôm qua. F2 mới là lúc nó đọc `compositePlan`.

### 27.5 Gates (chạy theo thứ tự, số liệu từ chính lần chạy đó)

| Gate | Lệnh | Kết quả | Bằng chứng |
| --- | --- | --- | --- |
| 1 Types | `npx nuxt typecheck` | PASS | exit **0**, `grep -c "error TS"` = **0**; `.nuxt/eslint.config.mjs` được sinh lại lúc **20:54** (28552 byte) |
| 2 Lint | `npx eslint` trên **6** file chạm tới, chạy **sau** gate 1 | PASS | exit **0**, output **0** byte. Gate 2 từng **fail 1** error `@stylistic/indent` tại `composite.mjs:66`; `--fix` chỉ thụt dòng nối tiếp **+2 space**, đã đọc lại diff và re-lint |
| 3 App specs | `npx tsx tests/unit/run-all.mts` | PASS | **106/106** specs, exit **0** |
| 3b Core | `node --test` + `tools/check-boundaries.mjs` + `tsc -p tsconfig.check.json` | PASS | **669/669**, `fail 0` (tăng **653 → 669** vì **16** check mới); boundaries: "core imports nothing platform-specific"; `.d.ts` tsc exit **0** |
| 4 Live | — | N/A | F1 **không** đổi hành vi host nào: `compositePlan` chưa có consumer, `selectPaintRows` trả về y hệt, và `composite.mjs` là hàm thuần trên một evaluation đã có test pixel ở §21. Cổng live sẽ chạy ở F2 khi preview thật vẽ theo plan |
| 5 Docs | năm guard markdown, chạy lại sau **lần sửa markdown cuối** | PASS | **28** checks (**12/5/4/3/4**), exit **0** cả năm. `tmcut_doc_table_shape` có thật vì §27.1 và §27.5 đều là bảng; không một ô nào chứa pipe trần |

### 27.6 Chưa chứng minh (nợ ghi thẳng cho F2-F5)

- **Không có ảnh chứng minh plan đúng.** F1 đo plan bằng assertion trên cấu trúc; nó không đo "màn hình hiển thị
  ba hàng cùng lúc ra sao". Đó là F2 (`useTmcutPlayback` đổi sang `compositePlan`, witness
  `tmcut_footage_row_rule` bị lật) và F5 (visual regression đo trong Chromium thật).
- **Slot `outgoing` chưa được host nào seek.** Test chỉ khẳng định `layer.sourceTicks` của partner là
  `3.5 * T` — nghĩa là core đã đưa đúng vị trí nguồn; còn host có thật sự đặt `<video>` thứ hai vào giây đó
  thì thuộc F2, vì hiện app vẫn tự làm bằng `transitionCrossfade.outgoingMediaTime`.
- **Case chưa có luật:** hàng mà `paint` không phải clip `incoming` (geometry ba clip chèn lên cửa transition),
  và hai cửa transition trên **cùng** một hàng tại một tick. `transitionAt` hiện trả cửa đầu tiên, nên plan
  thừa hưởng giới hạn đó chứ không nhân rộng; nếu F2 gặp project thật như vậy thì phải mở luật trong core,
  không vá ở app.
- **`kind: 'image'` / sticker trên hàng video** không có slot riêng — plan chỉ phân biệt `footage` theo
  **track** video, nên một hàng video chứa ảnh tĩnh vẫn là `footage`. Đúng với cách export đang xử lý, nhưng
  chưa đo.

### 27.7 Bảo vệ working tree

Lượt này staged **7** file, không hơn: `packages/core/src/composite.mjs` (mới, **118** dòng),
`packages/core/test/composite-plan.test.mjs` (mới, **212** dòng), `packages/core/src/paintStack.mjs`,
`packages/core/src/index.mjs`, `packages/core/src/index.d.ts`, `packages/core/test/paint-stack.test.mjs`,
cộng chính file này. **Không** file app, **không** locale, **không** `backup/`, **không** binary.
`git status --short` đo được **63** mục trước commit, trong đó **7** thuộc lượt này — **56** mục còn lại là WIP
của chủ repo (`app/pages/system/*` đang được tái cấu trúc, `i18n/locales/*`, `electron/main.cjs`, `package.json`,
`pnpm-lock.yaml`, `server/*`, `backup/`, `docs/content/`…) và **không** bị đụng; sau commit `git status --short`
phải còn đúng **56**. `git diff --cached --name-only` trước commit phải liệt kê **đúng** bảy đường dẫn trên.

## 28. Slice F2a — preview đọc plan của core, cây DOM vẫn chưa đổi (đo ngày 2026-11-04)

§27 dựng chỗ đúng; F2a là lượt **chuyển consumer đầu tiên** về đó. Từ tick này
[useTmcutPlayback.ts](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts) không còn tự trả lời
"layer nào là ảnh, layer nào là partner của transition, chữ nào phủ lên": nó gọi `compositePlan` **một** lần trên
evaluation của render position ([:131](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L131))
và mọi computed khác suy ra từ plan đó.

### 28.1 Bốn computed, và nguồn trả lời của chúng

| Computed | Trước F2a | Sau F2a |
| --- | --- | --- |
| `footageRow` — hàng nào chiếm canvas | app tự quét song song danh sách hàng video với danh sách evaluation | **xóa**; không còn dòng nào trong `app/` giữ luật "hàng nào được vẽ" |
| `transitionCrossfade` | app tự đọc `layer.transition.role` trên đúng một hàng | đọc từ **danh sách surface**: partner `outgoing` nằm ngay dưới surface mang audio và **cùng** `trackIndex` ([:170](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L170)) |
| `activeVideoClip` | "layer trên cùng của `footageRow`" | surface **mang audio**, tức đáy stack ([:193](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L193)) |
| `activeTextClips` | tự lọc `evaluation.tracks` theo type text và bỏ hàng `hidden` | các slot `kind: 'overlay'` của plan, theo đúng thứ tự plan ([:202](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L202)) |

Output **mới** là `paintSurfaces` ([:132](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L132),
kiểu `PaintSurface` ở [:9](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L9)): mỗi surface là
`{ key, role, trackId, trackIndex, clip, layer, mediaTimeSec, ownsAudio }`. F2a đưa nó ra khỏi composable nhưng
**chưa** cho DOM dùng — [TmcutPreviewPlayer.vue](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue)
không nhắc tên này ở dòng nào (đo: **0** lần), nó vẫn bind **42** lần vào ba computed cũ. Đó là lý do F2 tách làm hai
lượt: **luật** đổi trước, **cây DOM** đổi sau.

### 28.2 Điều F2a quyết, và điều nó cố ý không đụng

- `ownsAudio` gắn cho surface `paint` **đầu tiên** theo thứ tự plan — hàng đáy, cũng là hàng export nối audio.
  Trong cửa crossfade đó là clip **đến**, đúng đơn giản hoá player đã ghi trên `<video>` thứ hai.
- Surface mang `layer` **nguyên con** evaluator trả cho tick này, nên opacity, transform và source-time mà DOM dùng
  là số core tính, không phải một lần đọc clip thứ hai.
- Hình dạng `transitionCrossfade` giữ **nguyên** `{ incoming, outgoing, type, progress, outgoingMediaTime }`, vì
  player và ba spec khác (`tmcut_footage_row_rule`, `tmcut_frame_scheduler`, `tmcut_transitions`) đang bind vào nó.
- `mediaTimeSec` vẫn lấy `layer.sourceTicks` khi core có nó, chỉ rơi về `mediaTimeAt(clip, playhead)` khi layer
  không mang vị trí nguồn — cùng luật §24, không phải luật mới.
- Vì cây DOM chưa đổi, **ảnh trên màn hình hôm nay giống hôm qua**. Đây là trạng thái trung gian có chủ đích,
  không phải bằng chứng "stack đã chạy".

### 28.3 TDD: RED đo trên chính bản HEAD

Spec viết trước: [tmcut_preview_paint_plan.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_preview_paint_plan.spec.ts)
**167** dòng, **6** check, chạy trên **composable thật** qua store harness. RED không suy ra từ lời kể — nó được
**đo**: snapshot `git show HEAD:app/composables/useTmcutPlayback.ts` (**568** dòng) vào một file tạm, chạy chính
assertion của spec trên bản đó:

```
HEAD composable — paintSurfaces present: false
AssertionError: Expected values to be strictly deep-equal:  + []  - [ 'two surfaces from two live rows' ]
```

File tạm và snapshot đã **xóa** ngay sau lần chạy đó; `git status --short` xác nhận không còn dấu vết. Ba bước sai
trong lượt này, cả ba đều là loại sẽ gặp lại ở F2b/F3:

1. **So sánh tham chiếu giữa hai lần evaluator.** Check 5 ban đầu đòi `surface.layer` **là** layer của một
   `evaluateTimeline` gọi riêng trong test; hai lời gọi sinh hai object khác nhau nên assertion **không bao giờ**
   đúng. Bản đúng khẳng định điều thực sự cần chứng minh: `deepEqual` với layer core tính cho cùng tick, cộng
   `evaluation.tracks[trackIndex].id === surface.trackId` để khoá rằng index đó trỏ về **đúng hàng**.
2. **Cửa transition overlap ngược.** `applyClipTransition(id, 'fade', 0.5)` coi cặp clip overlap **về trước**, nên
   cửa là `[3.5, 4)`; bản nháp seek `4.25` → không window → không surface `outgoing`. Cùng bẫy §27.3, lần này lộ ở
   test app.
3. **Ai giữ audio.** Bản nháp đòi clip **đi** mang audio. Đọc player thấy luật đang ship là "âm theo clip đến",
   và audio của file là một concat theo thời gian, nên assertion sửa theo **thực tế đã ship** thay vì đổi hành vi ở
   lượt chỉ có nhiệm vụ chuyển luật về core.

GREEN: **6/6** check, và cả hai spec cũ bị ảnh hưởng (`tmcut_paint_stack`, `tmcut_footage_row_rule`,
`tmcut_transitions`, `tmcut_frame_scheduler`) vẫn xanh mà **không** phải nới assertion nào.

### 28.4 Pin bị lật, và vì sao lật là đúng

- `tests/unit/tmcut_paint_stack.spec.ts:186` check 2 từng
  khoá `/selectPaintRows/` và `/tracks?.[base.trackIndex]/` **ngay trong file preview**; F2a làm cả hai thành **false**.
  Pin mới (`tests/unit/tmcut_paint_stack.spec.ts:186`): preview phải khớp
  `/compositePlan/`, **không được** chứa `selectPaintRows` (luật hàng chỉ đi qua core **một** lần, qua plan, chứ không
  phải hai cửa vào), không còn `videoEvaluations`, và join back bằng `tracks[slot.trackIndex]`.
- Helper `currentPreviewRow` trong cùng spec đổi tên thành
  `tests/unit/tmcut_paint_stack.spec.ts:125`: nó mô tả **câu trả lời
  của core**, không còn mô tả preview. Equivalence sweep (11 layout × 11 tick) giữ **nguyên assertion**.
- `tmcut_footage_row_rule.spec.ts` **chưa** bị lật: witness check 6 ("preview vẫn chỉ một hàng") chỉ sai khi DOM đổi,
  tức F2b — nên lượt này để nó nguyên, và đó là lý do F2b phải sửa i18n `parallelTracksWarning` cả `en` lẫn `vi`.

### 28.5 Gates (chạy theo thứ tự; số liệu lấy từ chính lần chạy đó)

| Gate | Lệnh | Kết quả | Bằng chứng |
| --- | --- | --- | --- |
| 1 Types | `npx nuxt typecheck` | PASS | exit **0**, `grep -c "error TS"` = **0**; `.nuxt/eslint.config.mjs` sinh lại lúc **21:25** (28552 byte). Lần chạy **đầu tiên FAIL exit 2, 8 error** `TS18048 'paint'/'partner' is possibly undefined` tại [:175-183](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L175) — do index access sau `findIndex`; sửa bằng guard early-return khi thiếu `paint` hoặc `partner` rồi mới PASS |
| 2 Lint | `npx eslint` trên **3** file chạm tới, chạy **sau** gate 1 | PASS | exit **0**, output **0** byte. Lần chạy đầu **FAIL 12 error** trên spec mới (`@typescript-eslint/no-explicit-any` ×10, unused var, `@stylistic/quotes`) — sửa bằng cách **typen** spec (`ReturnType<typeof useTmcutPlayback>`), không tắt rule |
| 3 App specs | `npx tsx tests/unit/run-all.mts` | PASS | **107/107** specs, exit **0** (tăng **106 → 107** vì spec mới) |
| 3b Core | `node --test` + `tools/check-boundaries.mjs` + `tsc -p tsconfig.check.json` (chạy trong `packages/core`) | PASS | **669/669**, `fail 0` — không đổi vì F2a không đụng core; boundaries "core imports nothing platform-specific"; tsc exit **0** |
| 4 Live | 8 route TMCut trên dev server **:4003**, qua chrome-devtools, `list_console_messages` sau mỗi route | PASS có ghi nợ | **0** lỗi liên quan F2a. Sạch hoàn toàn (chỉ `[info] <Suspense>`): `/tmcut`, `/tmcut/autocut`, `/tmcut/factory`, `/tmcut/html-video`. Noise **có trước, không thuộc lượt này**: `401` trên `GET /api/v1/ai/relay/catalog` (×4 editor, ×2 templates, ×1 process — một fetch tới endpoint cần session, tab Chromium này đăng xuất), `[issue]` a11y "form field should have id/name" ×2 ở `/tmcut/process` (không import gì của playback), `502 (tts.unreachable)` ×2 ở `/tmcut/voice` |
| 5 Docs | năm guard markdown, chạy lại sau **lần sửa markdown cuối** | PASS | **28** checks (**12/5/4/3/4**), exit **0** cả năm. Guard **bắt** được lỗi của §28: ô gate 1 chứa `\|\|` trong snippet `if (!paint …)` → `tmcut_doc_table_shape` báo "row 2238 has 6 cells, header :2236 has 4"; sửa bằng cách **viết lại ô** đó, không nới guard. Mọi `#L` anchor dưới đây được đo bằng `grep -n` trên file thật trước khi viết |

### 28.6 Chưa chứng minh (nợ ghi thẳng cho F2b và F3)

- **Chưa có bằng chứng live rằng preview vẽ hai hàng.** `paintSurfaces` chưa có consumer nào ngoài test; bằng chứng
  thật thuộc F2b, kèm lật witness `tmcut_footage_row_rule` check 6 và sửa copy `parallelTracksWarning` cả hai locale.
- **Cửa transition của hàng không ở đáy stack vẫn vô hình với DOM.** `transitionCrossfade` có chủ đích chỉ đọc cặp
  quanh surface mang audio (comment ở [:167-169](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L167)
  ghi rõ F2b sẽ nới); nếu F2b nới mà không có phần tử riêng cho từng hàng thì đó là bug, không phải luật.
- **`ownsAudio` chưa được đo với file export thật.** Nó khớp luật "audio = concat của `videoBase`" trên lý và trên
  specs compile command-line, nhưng chưa có phép đo PCM screen-vs-file khi **hai** hàng footage cùng sống.
- **Electron host không chạy** lượt này; cả hai host dùng chung composable nhưng chưa có số đo desktop.

### 28.7 Bảo vệ working tree

Lượt này staged **4** đường dẫn: [useTmcutPlayback.ts](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts),
`tests/unit/tmcut_paint_stack.spec.ts`,
[tmcut_preview_paint_plan.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_preview_paint_plan.spec.ts) (mới),
cộng chính file này. **Không** locale, **không** `backup/`, **không** binary, **không** `i18n/locales/*` (WIP của chủ
repo), **không** `TmcutPreviewPlayer.vue` (để F2b). `git status --short` đo **60** mục trước commit, trong đó **4**
thuộc lượt này; sau commit phải còn **56** — đúng số WIP của chủ repo mà §27.7 đã đo, vì F2a không thêm file nào khác.
RED probe (`app/composables/tmpF2aRedProbe.ts`, `tests/unit/tmcut_f2a_redprobe.spec.ts`) là file **của lượt này**,
đã xóa và không bao giờ staged.

## 29. Slice F2b — cây DOM vẽ **đủ** số phần tử core gọi tên (đo ngày 2026-11-04)

§28 đưa plan ra khỏi composable nhưng để nguyên màn hình. F2b là lượt DOM đổi: từ tick này
[TmcutPreviewPlayer.vue](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue) không còn
quyết "mấy phần tử, phần tử nào bật tiếng, phần tử nào mang ramp" — nó render **một phần tử cho mỗi surface** mà
`compositePlan` trả về, theo đúng thứ tự plan. File lớn lên **26** dòng (2234 → **2260**); composable lớn lên **86**
dòng (587 → **673**), vì toàn bộ luật mới nằm ở composable, DOM chỉ tiêu thụ.

### 29.1 Ba computed mới, và một witness duy nhất

| Tên | Trả lời câu hỏi | Nguồn |
| --- | --- | --- |
| `mainSurface` ([:220](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L220)) | surface nào là `<video>`/`<img>` chính | surface **mang audio**, tức đáy stack — cùng luật với `activeVideoClip` của §28 |
| `crossfadeSurface` ([:210](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L210)) | partner `outgoing` có phần tử riêng chưa | ngay **dưới** `mainSurface`, khi cửa crossfade đang sống |
| `stackedSurfaces` ([:239](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L239)) | những surface nào cần element mới | plan **trừ** `mainSurface` và **trừ** partner đã có element — không thừa, không thiếu |

Witness "cặp này đang cùng lên hình" là cờ **`crossfades`** trên surface
([:19](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L19), đặt ở
[:169](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L169)): một vòng quét adjacency của plan,
`outgoing` nằm sát **trên** `paint` **cùng** `trackIndex` thì cả hai bật cờ. Lý do không đọc thẳng
`layer.transition`: một layer vẫn mang `transition` khi partner đã bị trim, và `compositePlan` đã quyết nó là cut
thường — ramp chỉ được áp khi **cả hai** surface đang ở trên hình. Đây là điều §28.6 ghi nợ ("cửa transition của hàng
không ở đáy stack vẫn vô hình với DOM"): F2b nới bằng cách cho **mỗi** surface một element, chứ không nới luật pairing
của `transitionCrossfade`.

### 29.2 Vì sao thứ tự cây **là** thứ tự vẽ, và vì sao không có `z-index`

Khối stacked nằm sau element chính và sau `<img>` chính, trước `<audio v-for>` và plate vignette
([:1702](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L1702)). Hai quyết định có chủ đích:

- **Một `v-for` duy nhất, `v-if`/`v-else` bên trong.** Bản nháp tách hai danh sách (video trước, ảnh sau) — nhìn gọn
  hơn nhưng **sai**: plan của core xen kẽ still và video theo `selectPaintRows`, nên hai `v-for` sẽ đổi thứ tự vẽ của
  một stack trộn. Spec `tmcut_preview_stack_dom` check 4
  ([:108](file:///D:/Applications/tm-studio/tests/unit/tmcut_preview_stack_dom.spec.ts#L108)) khoá đúng trường hợp đó.
- **Không `z-index` dương.** Phần tử positioned với `z-index: auto` vẽ theo thứ tự cây, tức đúng thứ tự plan. Đặt số
  dương cho hàng stacked sẽ **chôn** overlay chữ (cũng `z-auto`) — caption biến mất ngay khi project có hai hàng.
  Giá phải trả, ghi thẳng ở 29.6: plate vignette nguyên khung (`z-10`) giờ nằm **trên** các hàng stacked, trong khi
  file export bake vignette **từng layer** (`packages/core/src/effects.mjs:535-539`). Đó là nợ F4, không phải bug F2b.

Stacked element luôn `:muted="true"` — không phải vì nó là phụ, mà vì plan đặt hàng **mang audio** ở đáy, và đáy đã có
element chính rồi.

### 29.3 Một luật đồng hồ, một luật style, và những bản sao bị xóa

- `syncSecondaryVideo(el, target, reverse)` ([:299](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L299))
  là **một** hàm clock cho **mọi** phần tử phụ; `syncOutgoingVideo` gọi nó, `syncStackedVideos`
  ([:354](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L354)) cũng gọi nó, và nó được gắn vào
  **5** điểm từng gọi `syncOutgoingVideo`: seek ([:276](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L276)),
  shuttle ngược, tới, play, pause. Register qua `setStackedVideoEl`
  ([:344](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L344)): element bị unmount thì **dừng**
  và **xóa** khỏi map, không để lại clock ma.
- `surfaceStyle(surface)` ([:804](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L804))
  là **một** hàm style cho **mọi** footage layer; cả element chính ([:1664](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L1664),
  [:1682](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L1682)) lẫn outgoing
  ([:1648](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L1648)) và stacked đều bind vào nó.
  Xóa hẳn: `videoObjectStyle`, `xfadeRamp`, `videoTransformStyle`, `outgoingStyle` — đo `grep -nE` trên file hiện tại:
  **0** lần xuất hiện. `fitStyle(` còn đúng **2** lần (một định nghĩa, một call site trong `fitForSurface`
  [:704](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L704)), và con số **2** đó là pin
  của `tests/unit/tmcut_shared_model.spec.ts:309`.
- `playableSrc(clip)` ([:317](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L317)) và
  `isImageClip(clip)` ([:362](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L362)) thay
  cho hai bản sao inline (proxy-aware resolve và phân loại still), nên element stacked không tự nghĩ ra câu trả lời thứ ba.

### 29.4 TDD: RED đo trên HEAD, không suy ra từ lời kể

Spec viết trước: [tmcut_preview_stack_dom.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_preview_stack_dom.spec.ts)
**166** dòng, **6** check, chạy trên composable thật. RED **đo** bằng snapshot HEAD (`git show HEAD:...` vào
`app/composables/tmpF2bRedProbe.ts`, chạy chính assertion của check 1 trên bản đó, rồi xóa):

```
RED composable: HEAD must expose stackedSurfaces
RED player: 0 stacked v-for, 0 surfaceStyle, per-element style helpers still present
```

Bốn điều suýt làm sai, cả bốn đều thuộc loại gặp lại ở F3/F4:

1. **Hai `v-for` riêng cho video và ảnh** — phá thứ tự plan của stack trộn; xem 29.2.
2. **`z-index` dương cho hàng stacked** — chôn caption; đã phân tích ở 29.2, chọn thứ tự cây.
3. **Typecheck FAIL, exit 2, 2 lần `TS2345`** tại [:335](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L335)
   và [:358](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L358): `clip.reverse` là
   `boolean | undefined` còn tham số khai báo `boolean`. Sửa **chữ type** (`reverse?: boolean`), không thêm `!!` ở call site.
4. **Lint FAIL, 6 lần `@typescript-eslint/no-explicit-any`** trong spec mới — sửa bằng cách **typen** spec
   (`ReturnType<typeof useTmcutPlayback>`, `Surface`), không tắt rule; cùng bài học gate 2 của §28.

### 29.5 Pin bị lật, và copy phải nói đúng sự thật

- `tests/unit/tmcut_footage_row_rule.spec.ts:158`
  đổi tên check 6 từ "preview vẫn chỉ một hàng" thành **"the warning says the file stacks and never claims the screen
  does not"**. Assertion cũ **đúng** cho tới hôm qua và **sai** từ hôm nay; nó được chuyển thành `doesNotMatch` bắt mọi
  cách nói "màn hình chưa xếp chồng", còn phần "screen" do `tmcut_preview_stack_dom` check 6
  ([:146](file:///D:/Applications/tm-studio/tests/unit/tmcut_preview_stack_dom.spec.ts#L146)) giữ.
- Copy `parallelTracksWarning` sửa ở **cả hai** locale: [en.json:1050](file:///D:/Applications/tm-studio/i18n/locales/en.json#L1050)
  và [vi.json:1050](file:///D:/Applications/tm-studio/i18n/locales/vi.json#L1050). Check 6 khoá **cả** khẳng định mới
  ("composites / stacks / theo thứ tự vẽ") **và** cấm khẳng định cũ ("preview still / màn hình vẫn chỉ").
- Comment trong `app/components/tmcut/TmcutExportModal.vue:404`
  viết lại: nó từng nói preview "renders a single `<video>`", giờ là **một** đường composite cho cả hai surface, và nợ
  còn lại là plate effect theo layer. Guard `posterUrl ... selectExportTracks` vẫn xanh vì token nằm nguyên trong cửa sổ.

### 29.6 Bằng chứng live: Chromium mount đúng số phần tử, và ảnh đè video

Seeding qua dev hook `window.tmcutQaStore` (chỉ bật khi `import.meta.dev`), trên dev server **:4003**, project
`default` (0 clip), rồi **khôi phục** nguyên trạng:

| Trạng thái seed | DOM trong `.tmcut-monitor` | Kết luận |
| --- | --- | --- |
| 1 hàng video, 0 clip | **1** `<video>` (`src` rỗng), **1** `<img>` | plan rỗng thì không thừa element nào |
| 2 hàng video, src là **đường dẫn file** | 3 element: main `<video>` (relative, **không** muted) + 2 stacked (`absolute`, `z-index: auto`), cả hai `media://local` và **cùng** lỗi decode | element stacked tồn tại và nhận **cùng** URL resolver; overlay "Media offline" là việc của hàng chính, không phải của stack |
| 3 hàng video (seed bị trùng một hàng) | main `<video>` unmuted + **2** stacked muted, `position: absolute`, `z-index: auto` | N hàng cho ra N element, đúng một element mang audio |
| 2 hàng **trộn**: đáy = mp4 (http), trên = png | main `<video>` `readyState 4`, `videoWidth 64`; `<img>` chính `display: none`; stacked `<img>` `naturalWidth 1024`, `position: absolute` | still và video nằm **chung một** `v-for` theo thứ tự plan; screenshot cho thấy logo png **phủ** khung hình, tức hàng trên vẽ sau |

Sau khi khôi phục: **3** track, **1** `<video>` + **1** `<img>`, và `localStorage` không còn key nào chứa `qa-upper`
(đo bằng cách quét mọi key `tmcut*`: chỉ `tmcut_byte_index_v1`). File tạm `public/tmcut-qa-f2b.mp4` đã xóa, xác nhận
`ls public` còn **0** mục "qa".

### 29.7 Gates (chạy theo thứ tự; số liệu lấy từ chính lần chạy đó)

| Gate | Lệnh | Kết quả | Bằng chứng |
| --- | --- | --- | --- |
| 1 Types | `npx nuxt typecheck` | PASS | exit **0**, `grep -c "error TS"` = **0**; `.nuxt/eslint.config.mjs` sinh lại lúc **22:14** (28567 byte). Lần đầu **FAIL exit 2** với 2 lần `TS2345` (29.4 mục 3) |
| 2 Lint | `npx eslint` trên **6** file code/spec chạm tới, chạy **sau** gate 1 | PASS | exit **0**, output **0** byte. Lần đầu **FAIL 6 error** `no-explicit-any` trên spec mới (29.4 mục 4) |
| 3 App specs | `npx tsx tests/unit/run-all.mts` | PASS | **108/108** specs, exit **0** (tăng **107 → 108** vì spec mới). Riêng spec F2b: **6/6** "All 6 preview stack-DOM checks passed" |
| 3b Core | `node --test` + `tools/check-boundaries.mjs` + `tsc -p tsconfig.check.json` (trong `packages/core`) | PASS | **669/669**, boundaries "core imports nothing platform-specific", tsc exit **0** output **0** byte — F2b không sửa core, nên số liệu trùng §28 |
| 4 Live | **8** route TMCut trên **:4003**, chrome-devtools, `list_console_messages` sau mỗi route | PASS có ghi nợ | **0** lỗi thuộc F2b. Sạch (chỉ `[info] <Suspense>`): `/tmcut`, `/tmcut/autocut`, `/tmcut/templates`, `/tmcut/html-video`. Noise **có trước**: `401 (error.unauthorized)` trên `GET /api/v1/ai/relay/catalog` (×4 editor, ×1 factory — đo lại bằng `list_network_requests`, tab này chưa đăng nhập), `[issue]` a11y "form field should have id/name" ×2 ở `/tmcut/process`, `502 (error.tts.unreachable)` ×2 ở `/tmcut/voice` |
| 5 Docs | năm guard markdown, chạy lại sau **lần sửa markdown cuối** | PASS | **28** checks (**12/5/4/3/4**), exit **0** cả năm. Baseline chạy **trước** khi viết §29 cũng **28/28**, để chắc rằng con số sau không phải do corpus nhỏ đi |

### 29.8 Chưa chứng minh

- **Không có phép đo pixel screen-vs-file.** Bảng 29.6 chứng minh **số element, thứ tự, muted, style**; nó không chứng
  minh hai hàng cho ra hai khung hình **đúng như** export. Hàng đáy chỉ đo được `videoWidth` **64** px (chiều cao chưa
  đo), asset library trống nên nó bị overlay "Media offline" che. Số đo thật thuộc F6 (visual-regression fixtures) và
  cần project có asset thật.
- **Vignette và letterbox vẫn là plate nguyên khung**, export bake **từng layer** — F2b cố ý không đụng; F4 owns.
- **Ramp `speedAt` vẫn chỉ áp cho element chính.** `syncSecondaryVideo` chỉnh `playbackRate` theo `shuttleRate`, nhưng
  luật "clip này chạy nhanh/chậm bao nhiêu" (`speedAt`) chưa nhân vào media time của hàng stacked. Chưa có spec nào
  bắt, nên chưa sửa — ghi nợ F4, không phải hoàn thành.
- **Electron host không chạy** lượt này. Cùng composable, cùng SFC, nhưng desktop chưa có số đo stacked DOM.
- **`ownsAudio` chưa đo với file export thật** khi hai hàng footage cùng sống (nợ cũ từ §28.6, F2b không đóng).

### 29.9 Bảo vệ working tree

Lượt này staged **8** đường dẫn: [useTmcutPlayback.ts](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts),
[TmcutPreviewPlayer.vue](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue),
`app/components/tmcut/TmcutExportModal.vue`,
[tmcut_preview_stack_dom.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_preview_stack_dom.spec.ts) (mới),
`tests/unit/tmcut_footage_row_rule.spec.ts`,
`tests/unit/tmcut_shared_model.spec.ts`,
cộng **một hunk duy nhất** của [en.json](file:///D:/Applications/tm-studio/i18n/locales/en.json) và
[vi.json](file:///D:/Applications/tm-studio/i18n/locales/vi.json), kèm chính file này. Hai locale có **6** hunk mỗi
file; **5** trong số đó là WIP của chủ repo (`@@ -13`, `-127`, `-2288`, `-2336`, `-2482`), chỉ hunk `@@ -1049 +1050 @@`
là của F2b, nên stage bằng patch **một hunk**, không `git add` cả file. `git status --short` đo **63** mục trước commit,
trong đó **9** thuộc lượt này; sau commit đo lại **56** — **7** mục biến mất vì **5** file code/spec + doc đã sạch, còn
**2** file locale vẫn đứng tên vì **5** hunk WIP của chủ repo chưa đi. Con số này từng ghi là 54 trong bản nháp, tức
cộng nhầm cả hai locale vào nhóm "sạch"; **56** là số đo sau commit, và `git diff --cached` sau commit = **0** dòng.
Probe RED
(`app/composables/tmpF2bRedProbe.ts`, `tests/unit/tmcut_f2b_redprobe.spec.ts`) và fixture tạm
`public/tmcut-qa-f2b.mp4` là file **của lượt này**, đã xóa và không bao giờ staged.

## 30. Slice F3 — file đọc luật của core, và bản sao luật trong exporter bị xóa (đo ngày 2026-11-04)

§28 và §29 chuyển **màn hình** về plan của core. F3 chuyển **file**. Câu hỏi "hàng nào được vẽ" từng có
**ba** chỗ trả lời: `selectPaintRows` per-tick của core (§23), loop DOM của preview (F2b xóa), và
`paints()` + `videoRows[0]` / `videoRows.slice(1)` của exporter (F3 xóa). Còn lại **một** luật, **hai**
scope: per-tick cho màn hình, per-file cho command line — và test **đo** rằng cái sau là union của cái trước,
không phải test kể lại.

### 30.1 Luật per-file mới trong core

`selectFileRows(input) → { rows, base, stacked, overlays, audio }`
([paintStack.mjs:140](file:///D:/Applications/tm-studio/packages/core/src/paintStack.mjs#L140)), declaration ở
`packages/core/src/index.d.ts:1962` với
`CoreFileRow` (`packages/core/src/index.d.ts:1939`) và
`CoreFileRows` (`packages/core/src/index.d.ts:1945`).

| Điều kiện vào hàng | Vì sao |
| --- | --- |
| `type` thuộc lane (video vào stack, text vào overlays, audio vào lane tiếng) | cùng phân lane với `selectPaintRows` |
| `hidden !== true`, chỉ áp lane hình | `hidden` là control **hình ảnh**; một row audio bị ẩn vẫn mix — bất đối xứng core ghi từ §23 |
| tồn tại clip có `clipSpan(clip).duration > 0` | đúng vị từ per-tick từng cho hàng **sống**; không phải vị từ "clip có input chưa" |

Core trả **danh tính hàng** (`{ trackId, trackIndex }`), không mang item — cùng khuôn với mọi luật per-tick,
nên host vẫn là chỗ duy nhất biết clip là gì. Input chấp nhận cả project lồng `timeline` lẫn timeline trần
(`timelineOf`, [paintStack.mjs:97](file:///D:/Applications/tm-studio/packages/core/src/paintStack.mjs#L97)).

Mười check mới trong
[paint-stack.test.mjs:216](file:///D:/Applications/tm-studio/packages/core/test/paint-stack.test.mjs#L216),
hai check nặng nhất **đo** mệnh đề "một luật, hai scope" thay vì assert độc lập:

- **union-equality** ([:234](file:///D:/Applications/tm-studio/packages/core/test/paint-stack.test.mjs#L234)):
  quét 6 timeline qua mọi tick nguyên giây, tập hàng per-tick của `selectPaintRows` **bằng** tập hàng
  per-file của `selectFileRows`.
- **hàng đọc từ timeline, không từ mẫu tick**
  ([:251](file:///D:/Applications/tm-studio/packages/core/test/paint-stack.test.mjs#L251)): một clip 0.1 s nằm
  lọt giữa hai probe vẫn khiến hàng đó hợp lệ — lưới tick **không** phải nguồn sự thật.

### 30.2 Bản sao luật bị xóa, và vì sao `src` không phải là luật

Nguyên văn HEAD, đã xóa trong
`app/utils/tmcut/render/clip.ts`:

```ts
function paints(track: TmcutTrack, needed: 'src' | 'text'): boolean {
  if (track.hidden === true) return false
  return (track.items || []).some(item => (needed === 'src' ? !!item.src : !!item.text))
}
```

Hai vị từ nhìn giống nhau và **không** cùng trả lời một câu. `!!item.src` hỏi "clip này có gì để giải mã
chưa" — một sự thật **mapping**, thuộc về lúc dựng command line. `clipSpan(clip).duration > 0` hỏi "hàng này
có thể sống không" — một sự thật **luật**, và là luật canvas đã đọc từ F2a. Project một hàng mà mọi clip bị
trim về 0 từng cho hai câu trả lời khác nhau, và RED đo đúng chỗ đó
(`node_modules/.cache/tmcut-gates/f3-app-red.txt`):

```
FAILED: AssertionError [ERR_ASSERTION]: footage rows of the file [vz,v1]
  actual: ['vz','v1']   expected: ['v1']
  at tests/unit/tmcut_paint_stack.spec.ts:288
```

Vị từ per-clip vẫn ở lại đúng chỗ của nó: `renderVideoClips` / `renderAudioClips` / `renderTextClips` vẫn bỏ
một clip không có input, vì "clip này không có gì để decode" là chuyện của **mapping**, không của luật hàng.

### 30.3 Bẫy mà quyết định đó mở ra — và cách nó bị khóa bằng test

Bỏ `src` khỏi luật hàng có hệ quả mà đọc code đơn thuần không thấy ngay: một hàng **không có input nào** giờ
có thể là `videoBase`, và `app/utils/tmcut/render/index.ts:122`
quyết nhánh bằng `isColorSource = videoClips.length === 0`. Nhánh Case 1 (nền canvas) từng **không** chạy
leg composite, nên mọi hàng bên trên một đáy rỗng sẽ bị **im lặng bỏ** — đúng lớp bug F3 đóng lại, mở ra ở một
file khác. Sửa: `stackedRows` dựng **trước** nhánh
(`app/utils/tmcut/render/index.ts:58`) và `compositePaintRows` chạy ở
**cả hai** nhánh (`app/utils/tmcut/render/index.ts:167` cho Case 1,
`app/utils/tmcut/render/index.ts:215` cho Case 2). Khóa bằng check 10
của `tests/unit/tmcut_export_track_parity.spec.ts:244`:
đáy `v-offline` (clip 2 s, **không** `src`) cộng hàng trên 8 s ⇒ `videoBase` vẫn là `v-offline`, file dài
**8 s**, chỉ **`b.mp4`** được decode, và graph có đúng cửa `overlay=enable='gte(t,0)*lt(t,8)'`. Poster modal
không đổi hành vi: `app/components/tmcut/TmcutExportModal.vue:392`
tìm `items.find(c => !!c.src)` rồi `if (!clip?.src) return ''`.

### 30.4 API giữ nguyên, vì nợ nằm ở luật chứ không ở tên

`ExportTrackSelection` (`app/utils/tmcut/render/clip.ts:152`)
và `selectExportTracks` giữ **nguyên shape**; thân hàm giờ là một **join**
(`app/utils/tmcut/render/clip.ts:160`): `trackIndex` → track authored.
Không consumer nào phải sửa, modal không phải sửa, và mọi spec cũ chỉ đổi **câu chuyện** chứ không đổi
assertion. Hai check mới trong `tests/unit/tmcut_paint_stack.spec.ts`
nói thẳng điều F3 claims — stack của **file** là union của stack **canvas**
(`tests/unit/tmcut_paint_stack.spec.ts:274`) và caption của file là
union của các hàng overlay (`tests/unit/tmcut_paint_stack.spec.ts:295`),
cả hai đọc **compiler thật**. Check 9 (`tests/unit/tmcut_paint_stack.spec.ts:316`)
khóa ở tầng nguồn: file phải gọi `selectFileRows`, và **không** được `.filter` theo `type` hay tái dựng
`videoRows[0]` / `.slice(1)` — tức bản sao luật không được phép quay lại.

### 30.5 Số đo của lượt này

| File | Trước | Sau | Lệch |
| --- | --- | --- | --- |
| [packages/core/src/paintStack.mjs](file:///D:/Applications/tm-studio/packages/core/src/paintStack.mjs) | 84 | 169 | **+85** (luật per-file + header) |
| `packages/core/src/index.d.ts` | 2115 | 2144 | **+29** |
| [packages/core/test/paint-stack.test.mjs](file:///D:/Applications/tm-studio/packages/core/test/paint-stack.test.mjs) | 203 | 364 | **+161** (10 check) |
| `app/utils/tmcut/render/clip.ts` | 214 | 222 | **+8**, và `paints()` bị **xóa** |
| `app/utils/tmcut/render/index.ts` | 316 | 331 | **+15** (composite ở cả hai nhánh) |
| `tests/unit/tmcut_paint_stack.spec.ts` | 273 | 329 | 6 → **9** check |
| `tests/unit/tmcut_export_track_parity.spec.ts` | 244 | 262 | 10 → **11** check |
| `tests/unit/tmcut_footage_row_rule.spec.ts` | 185 | 186 | chỉ header: bỏ câu "preview một `<video>`" |

### 30.6 Gates (chạy theo thứ tự; số liệu lấy từ chính lần chạy đó)

| Gate | Lệnh | Kết quả | Bằng chứng |
| --- | --- | --- | --- |
| 1 Types | `npx nuxt typecheck` | PASS | exit **0**, `grep -c "error TS"` = **0**; `.nuxt/eslint.config.mjs` sinh lại lần cuối **22:59**, 28567 byte |
| 2 Lint | `npx eslint` trên **8** file chạm tới, chạy **sau** lần sinh config 22:59 | PASS | exit **0**, output **0** byte; config **không** đổi mtime sau đó, nên kết quả này không stale |
| 3 App specs | `npx tsx tests/unit/run-all.mts` | PASS | **108/108**, exit **0**; số file spec **không** đổi vì F3 thêm **check**, không thêm file |
| 3' Smoke | `npx tsx tests/unit/run-all.mts --smoke` | PASS | **111/111**, exit **0**: `tmcut_render_smoke` **7** render FFmpeg thật, `tmcut_detect_smoke` **4**, `tmcut_html_video_smoke` **6** — graph do compiler F3 dựng **được chạy**, không chỉ được so text |
| 3b Core | `node --test "test/*.test.mjs"` + `tools/check-boundaries.mjs` + `tsc -p tsconfig.check.json` | PASS | **669 → 679/679**, fail 0; boundaries "core imports nothing platform-specific"; tsc exit **0**, output **0** byte |
| 4 Live | **8** route TMCut trên **:4003**, chrome-devtools (`list_pages` trước) | PASS | **0** lỗi do F3. Sạch (chỉ `[info] <Suspense>`): `/tmcut`, `/tmcut/autocut`, `/tmcut/templates`, `/tmcut/html-video`, `/tmcut/factory`. Noise **có trước**: `401` trên `GET /api/v1/ai/relay/catalog` (editor ×3, process ×1 — xác nhận bằng `list_network_requests`), `[issue]` a11y "form field should have id/name" ×2 ở process, `502 error.tts.unreachable` ×2 ở voice |
| 5 Docs | năm guard markdown, chạy lại sau **lần sửa markdown cuối** | PASS | **28** checks (**12/5/4/3/4**), exit **0** cả năm |

RED đo **trước** khi code tồn tại, không suy ra từ lời kể: `f3-core-red.txt` là `SyntaxError: The requested
module '../src/paintStack.mjs' does not provide an export named 'selectFileRows'`; `f3-app-red.txt` ở 30.2.

### 30.7 Chưa chứng minh

- **Không có pixel cho Case 1 có đáy rỗng.** Check 10 chứng minh **command line + filtergraph**, không chứng
  minh khung hình thật của project đó. `--smoke` render 7 project thật nhưng **không** project nào có
  `videoBase` rỗng `src` — thêm fixture vào `tmcut_render_smoke` là việc của F6.
- **Electron host không chạy lượt này.** Cùng compiler, cùng core, nhưng desktop chưa đo trên đường F3.
- **Đã đóng ở §37 (F6c, 2026-11-05) — và số đúng là bốn, không phải ba.** Ghi ở
  đây để nợ không thành lời đồn: `app/components/tmcut/TmcutExportModal.vue`,
  [TmcutTimeline.vue](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutTimeline.vue) (hai chỗ: nguồn clip AutoCaption
  **và** danh sách cue của file `.srt`) và `app/components/tmcut/TmcutHtmlVideoStudio.vue`.
  Chúng không phải luật paint-row, nhưng là câu hỏi "hàng nào" lần thứ hai ở surface khác;
  F3 **cố ý** không đụng vì chúng không quyết định vẽ gì.
- **`speedAt` trên hàng stacked và plate effect theo layer** vẫn là nợ F4 (ghi ở §29.8); F3 không đụng.
- **Luật per-file chưa biết transition.** `selectFileRows` nói hàng nào hợp lệ; cửa crossfade của hàng đó vẫn
  do app tính — đúng ranh giới §27 đã vẽ, F3 không dịch chuyển nó.

### 30.8 Bảo vệ working tree

Lượt này staged **10** đường dẫn: `app/utils/tmcut/render/clip.ts`,
`app/utils/tmcut/render/index.ts`,
[paintStack.mjs](file:///D:/Applications/tm-studio/packages/core/src/paintStack.mjs),
`packages/core/src/index.d.ts`,
[paint-stack.test.mjs](file:///D:/Applications/tm-studio/packages/core/test/paint-stack.test.mjs),
`tests/unit/tmcut_paint_stack.spec.ts`,
`tests/unit/tmcut_export_track_parity.spec.ts`,
`tests/unit/tmcut_footage_row_rule.spec.ts`,
chính file này và `docs/tmcut-v4-universal-rendering-multiplatform-roadmap.md`.
`git diff -U0` trên ba file app/spec **đã đọc trước khi stage** để chắc mọi hunk nằm trong vùng F3 (imports,
khối `ExportTrackSelection`, `compileTimelineToFfmpeg`, header spec): không hunk nào là WIP của chủ repo, nên
stage theo **đường dẫn** là đủ, không cần patch một hunk như §29. Không file locale, không `package.json`,
không binary, không `backup/` được chạm tới.

## 31. Slice F4a — một luật tốc độ cho **mọi** phần tử footage (đo ngày 2026-11-04)

§29.8 và §30.7 cùng ghi một món nợ: `speedAt` chưa từng đến với hàng stacked. Lượt này trả đúng món đó,
không mở mặt trận khác.

### 31.1 Nợ nằm ở hai chiếc đồng hồ chứ không phải một

F2b cho mỗi hàng stacked một phần tử `<video>` và **một** hàm lái chúng — nhưng hàm đó đặt `playbackRate`
từ `shuttleRate` **một mình nó**, trong khi target seek nó được trao đến từ `layer.sourceTicks`, tức câu trả
lời của core cho một clip `speed` 2 hoặc đang chạy trên ramp. Hai số đó không cùng một luật:

| Phần tử | Target đến từ | `playbackRate` trước F4 | Có khớp không |
| --- | --- | --- | --- |
| Hàng stacked `speed` 2 | `layer.sourceTicks` (đã chia speed) | `\|shuttle\|` = **1** | **Không** — element tự chạy 1x trong khi target tiến 2x |
| Phần tử chính, clip `speed` 1.5 **không** ramp | `layer.sourceTicks` | `\|shuttle\|` = **1** (vì `isRamped` false) | Không — phải bám vào corrective seek |
| Phần tử chính, clip có ramp | `layer.sourceTicks` | `\|shuttle\| × speedAt` | Có, nhưng chỉ ở dòng này |
| Partner `outgoing` của crossfade | `pair.outgoingMediaTime` | `\|shuttle\|` | Không nếu partner có speed |

Lệch ở dòng đầu không phải "chậm một chút": corrective seek (ngưỡng `> 0.3 s`) **bắn mọi frame**, vì element
luôn bị target bỏ lại phía sau. Trên màn hình đó là một chuỗi seek, không phải một clip chạy nhanh.

### 31.2 Luật mới: `mediaRate(clip)` — một chỗ đọc `speedAt`

[useTmcutPlayback.ts:301](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L301). Bốn
chỗ từng tự quyết tốc độ giờ chỉ gọi nó: hàng stacked và partner crossfade qua
[syncSecondaryVideo:316](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L316),
phần tử chính trong `step()` [:489](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L489),
`play()` [:525](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L525) và `shuttleForward()`
[:573](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L573). Nội dung luật:

- **`speedAt(clip, at)` một lần duy nhất** trong cả composable, với `at` là tick **local** của clip tính từ
  `renderSeconds` — đúng tick mà plan được dựng, không phải một lần đọc playhead mới hơn.
- **`isRamped` không còn là cửa**: `speedAt` trả `validateSpeed(clip.speed)` khi không ramp, nên một clip
  `speed` thường cũng đi qua cùng một cánh cửa. `isRamped` rời import của composable (Inspector và
  `clipTime.ts` vẫn dùng cho việc khác — ramp preset và `rampTimelineToSource`).
- **Nhân với `|shuttleRate|`, kẹp `[0.25, 16]`**: L L trên một ramp đang đọc 1.5x cho ra 6x, cùng tích mà
  `setpts=(PTS-STARTPTS)/speed` của file
  (`app/utils/tmcut/render/video.ts:260`) vẽ cho row đó.
- **Không có footage dưới playhead thì chỉ có shuttle** (`!clip` → `max(0.1, |shuttle|)`): không bịa speed
  cho một element không paint gì.
- **Reverse vẫn seek-driven**: `clip.reverse` hoặc `shuttleRate < 0` đưa element về `pause()` và bước bằng
  seek, **không** đặt rate — HTMLMediaElement không decode ngược, đây là chỗ duy nhất luật cấm nhân tốc độ.
- `syncSecondaryVideo` **đổi chữ ký** từ `(el, target, reverse?)` sang `(el, clip, target)`: tham số thứ ba
  là một boolean lẻ tẻ, còn clip cho cả `reverse` **lẫn** speed — hai thứ cùng một nguồn.

### 31.3 RED đo được, trước khi có code

`node_modules/.cache/tmcut-gates/f4-red.txt` (spec chạy bằng `tsx --tsconfig tsconfig.test.json`; chạy trần
không alias được `tmcut-core`):

```
FAILED: AssertionError [ERR_ASSERTION]: a sped stacked row must advance at 2x; at 1x its own seek target outruns it every frame
1 !== 2
    at <anonymous> (tests/unit/tmcut_speed_clock.spec.ts:101:12)
```

Đúng assertion của check 1 — hàng 2x chạy 1x — chứ không phải lỗi harness. Runner dừng ở failure đầu tiên,
nên RED chỉ có **một** dòng đo được; `:101` là vị trí **trước** khi sửa stylistic, check 1 hiện nằm ở
[spec:98](file:///D:/Applications/tm-studio/tests/unit/tmcut_speed_clock.spec.ts#L98). Check 2 (constant speed)
và check 5 (pin nguồn) là hai kết luận **rút từ code đang tồn tại** — cửa `isRamped` và hai chỗ ghi
`playbackRate` tay — không phải từ log; ghi rõ ở đây để §31 không tự phong cho mình ba RED.

### 31.4 Pin nguồn: luật không được phép bản địa hóa trở lại

[tmcut_speed_clock.spec.ts:178](file:///D:/Applications/tm-studio/tests/unit/tmcut_speed_clock.spec.ts#L178)
đọc **text** của composable và đòi: đúng **một** occurrence của `speedAt(`, và **mọi** dòng chứa
`.playbackRate =` hoặc là `= 1` (pause/reset) hoặc là `= mediaRate(`. Một lần nữa luật "hai chỗ cùng quyết
một việc" bị khóa bằng regex chứ không bằng lời hứa — §30 làm y vậy với `.find()` của exporter.

Check 3 là check nặng nhất về mặt hành vi: nó asserts **tích** shuttle × ramp (1.5 rồi 6), tức pin không chỉ
nói "gọi đúng hàm" mà nói "gọi ra đúng số". Check 4 giữ nhánh reverse: `paused === true` sau một frame.

### 31.5 Gate (đo lượt này)

| Gate | Lệnh | Kết quả | Bằng chứng |
| --- | --- | --- | --- |
| 1 Types | `npx nuxt typecheck` | **PASS** | exit 0, 0 × `error TS`; `.nuxt/eslint.config.mjs` regenerate 23:17, 28567 bytes |
| 2 Lint | `npx eslint` trên **2** file đã chạm | **PASS** | exit 0, log 0 bytes. Lần chạy **đầu** FAIL 4 lỗi stylistic ngay trong spec mới (`max-statements-per-line` ×3, `quotes` ×1) — sửa spec, không sửa rule |
| 3 Tests | `npx tsx tests/unit/run-all.mts` | **PASS** | **109/109** (thêm `tmcut_speed_clock` so với 108 của F3), exit 0 |
| 3b Smoke | `run-all.mts --smoke` | **PASS** | **112/112**, exit 0 — graph FFmpeg không đổi, chạy để chắc không hồi quy đường render |
| 3c Core | `packages/core` | **N/A** | lượt này **không** sửa core; `mediaRate` đọc `speedAt` đã có sẵn |
| 4 Live | 8 route `/tmcut*` trên :4003, Chromium | **PASS cho đường preview** | `/tmcut`, `/tmcut/autocut`, `/tmcut/editor`, `/tmcut/html-video`: chỉ dòng `<Suspense>` info. `templates`/`factory`/`process`: `[error] 401` từ `GET /api/v1/ai/relay/catalog` (hub auth hết phiên, **không** phải code này); `process` thêm `[issue] form field thiếu id/name` ×2 (markup có sẵn); `voice`: `[error] 502` từ `GET /api/v1/media/tts/status?baseUrl=127.0.0.1:8000` (dịch vụ TTS không chạy) |
| 5 Docs | 5 guard markdown + commit | xem cuối §31 | — |

Số dòng: composable **673 → 684** (+32/−21: một hàm mới, bốn chỗ gọi, bỏ một cửa `isRamped`); spec mới
**197** dòng. `git diff --cached` = 0 dòng **trước** khi stage, tức WIP của chủ repo vẫn chưa được indexed.

### 31.6 Chưa chứng minh

- **Không có pixel.** Spec điều khiển element **stub**, không decode. Luật đúng theo số, nhưng "một clip 2x
  ở hàng trên trông nhanh gấp đôi trên màn hình" chưa đo trên footage thật trong Chromium — đó là F6
  (visual-regression fixtures), và F6 nên đo **cả** hai host.
- **Electron host** chưa chạy lượt này.
- **Audio nhúng trong clip** giờ warp theo rate mới trên **mọi** hàng, vì `playbackRate` kéo cả audio. File
  giữ audio ở speed gốc (`asetpts` chia `speed` cho ramp; phần tử embedded audio trên preview thì không).
  Trước F4, hàng stacked chạy 1x nên audio của nó **gần** file hơn; đổi luật hình làm **lệch audio** ở đúng
  chỗ nó từng lệch hình. Hàng stacked luôn `muted` trên preview (§29), nên không nghe được — nhưng audio của
  `videoBase` có ramp thì có. Cần một check riêng khi G (Web Audio) tiếp quản đường audio; ghi nợ ở đó.
- **F4b chưa làm**: plate effect theo layer (vignette/crop/blend) vẫn do DOM tự tính, và DOM vẫn chạy lại
  `evaluateClip` thay vì đọc số từ `surface.layer` (`clipVisual` trong player). §29.8 giữ nguyên hai món này.
- **`mediaTimeAt(clip, playhead.value)`** vẫn là fallback khi `layer.sourceTicks === null`
  ([useTmcutPlayback.ts:152](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L152)):
  nó trộn đồng hồ app vào đường của core. F4a không đụng vì nó là **target**, không phải **rate**.

### 31.7 Bảo vệ working tree

Lượt này staged **4** đường dẫn: [useTmcutPlayback.ts](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts),
[tmcut_speed_clock.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_speed_clock.spec.ts), chính file
này và `docs/tmcut-v4-universal-rendering-multiplatform-roadmap.md`.
`git diff` trên composable **đã đọc hết** trước khi stage: mọi hunk nằm trong vùng `mediaRate` /
`syncSecondaryVideo` / `step` / `play` / `shuttleForward` và một dòng import — không hunk nào là WIP của chủ
repo. Không file locale, không `package.json`, không binary, không `backup/`, **không** đụng FFmpeg.

## 32. Slice F4b — plate effect đi **theo layer**, và DOM đọc số của plan (đo ngày 2026-11-05)

§29.8 và §31.6 cùng ghi một món nợ: monitor vẫn tự tính những gì plan đã trả lời. F4b đóng đúng món
đó — không thêm khả năng mới, chỉ chuyển **quyền trả lời** về phía core và registry.

### 32.1 Luật mà file đã áp dụng trước

`app/utils/tmcut/render/video.ts:320` là chuỗi
`trim, setpts, reverse, fit, <effect chain>, setsar` — hiệu ứng được nung **vào trong** layer, **sau**
fit, và chỉ sau đó `overlay` mới đem layer đi transform / fade / mask. Hai hệ quả kéo cả lượt này:

- Một plate đặt ngoài layer (phủ cả khung hình) mang **không** con số nào của layer đó: nó không co theo
  scale, không nhạt theo opacity, không bị mask cắt, không theo row mà nó định tint.
- `object-fit` là tính chất của **element chứa media**, không phải của div phủ; nên nó phải ở lại element,
  còn transform/opacity/mask/filter/blend + plate phải lên **group** bọc quanh.

Trước F4b, DOM viết lại ba câu trả lời của riêng mình: `clipVisual` gọi `evaluateClip` lần thứ hai cho
đúng clip mà `surface.layer` đã mang số; `fitStyle` gọi `resolveClipLayout(clip)` lần thứ hai; và
`activeVignetteStyle` tự phát minh công thức — `radial-gradient(circle, transparent 40%, …)` với
`alpha = intensity × 0.85`, trong khi registry (và do đó file) dùng `ellipse at 50% 50%`, điểm dừng 52%
và `× 0.82`. Ở intensity 50, hai luật cho **0.43** và **0.41** — hai số khác nhau cho cùng một khung hình.

### 32.2 Cờ trung thực thứ hai của registry

`fidelity` không trả lời câu "cái overlay này có phải thứ file nung không". `illustrative` thì chắc chắn
không (chromakey vẽ dải key, pixelate vẽ lưới ô), nhưng `approximate` cũng chưa đủ: vignette approximate
**là** chính plate mà file nung, còn grain approximate **là** chính lớp noise. Nên registry cần một cờ
riêng — [effects.mjs:11-16](file:///D:/Applications/tm-studio/packages/core/src/effects.mjs#L11) định nghĩa
`preview.layerOverlay`, bật `true` cho đúng ba mặt
[ vignette :53](file:///D:/Applications/tm-studio/packages/core/src/effects.mjs#L53),
[grain :63](file:///D:/Applications/tm-studio/packages/core/src/effects.mjs#L63),
[letterbox :185](file:///D:/Applications/tm-studio/packages/core/src/effects.mjs#L185) — và
[`fxCapabilities` :548](file:///D:/Applications/tm-studio/packages/core/src/effects.mjs#L548) luôn trả về
một boolean (không `undefined`), kiểu hóa ở
`packages/core/src/index.d.ts:960` và
`packages/core/src/index.d.ts:994`.

Mặt overlay đi ra ngoài qua [fxPreview.ts:814](file:///D:/Applications/tm-studio/app/utils/tmcut/fxPreview.ts#L814)
`effectOverlay(type, params)` — cửa duy nhất đọc cờ registry, không có bảng type cục bộ — và
[:830](file:///D:/Applications/tm-studio/app/utils/tmcut/fxPreview.ts#L830) `layerOverlayPlates(effects)`,
một call biến **một layer** hiệu ứng thành **đúng** các plate của nó, theo thứ tự chain mà clip lưu.
(Tới slice J, chuỗi đó còn được `buildFfmpegEffectFilters` đọc để nung vào file; §55 kể chuyện nó nghỉ hưu.)

### 32.3 RED đo được, cả bảy check một lượt

Spec viết trước: [tmcut_surface_plate.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_surface_plate.spec.ts)
(197 dòng, 7 check, harness `check()` gom failure nên một lần chạy đo **hết** bảy kết luận — khác §31.3,
nơi runner dừng ở dòng đầu). `node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json` trên file
này, **trước** khi sửa code: `0/7 checks passed`, log
`node_modules/.cache/tmcut-gates/f4b-red-all.txt`. Bốn dòng fail vì `effectOverlay` / `layerOverlayPlates`
chưa tồn tại; check 1 fail vì player vẫn còn `activeVignetteStyle`; check 6 fail vì tập live chưa có trong
registry; check 3 và 4 fail vì chưa có mặt overlay để đọc. Không check nào pass ngay từ đầu.

### 32.4 GREEN: group, element, plate

Player giờ có ba hàm mới thay cho ba chỗ tự tính —
[layerGroupBase :736](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L736)
(đọc `layer.transform` + `layer.opacity`),
[surfacePlates :750](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L750)
(đọc `layer.effects` qua registry face), và
[fitStyle :697](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L697) nhận
`CoreEvaluatedLayout` thay vì clip. `surfaceStyle` (:811) không còn `fitForSurface` trong spread — fit về
element, group mang phần còn lại. Template đổi ở **bốn** site footage:
crossfade [:1678](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L1678),
video chính [:1710](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L1710),
still [:1734](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L1734),
và mọi row stacked [:1782](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L1782).

Pin nguồn (`grep`): `evaluateClip` = **0**, `resolveClipLayout` = **0**, `radial-gradient(` = **0**,
`activeVignetteStyle` = **0** trong player. Hợp đồng cũ vẫn sống: `fitStyle(` đúng **2** lần
(một định nghĩa, một call site chung), `surfaceStyle(mainSurface)` / `surfaceStyle(crossfadeSurface)` còn
nguyên, `:muted="true"` còn trong tầm 700 ký tự của `v-for="surface in stackedSurfaces"`, và spec tách
tag `<img` nhiều dòng vẫn trích được.
`tests/unit/tmcut_shared_model.spec.ts:307`
tiến hóa theo **luật**, không theo sự tiện: nó đòi `fitStyle(surface.layer.layout)` và phủ định
`resolveClipLayout(` — cùng một nguyên tắc "một chỗ quyết", dời một bước dọc theo nguyên tắc đó, chứ không
nới regex cho dễ thở.

### 32.5 Live: số đo trên Chromium :4003

Bằng chứng mạnh nhất là một phép đo **trên máy đang chạy**, không phải trên text. Nạp
`tests/fixtures/containers/h264.mp4` (4448 bytes) qua Import Media → asset đạt "Ready" (64×36, thumbnail
vẽ), thêm hai clip vào row 1, chọn clip ở `left: 0px`, mở inspector **Effects** → **Vignette** (intensity
mặc định 50), rồi đọc DOM của `.tmcut-monitor`:

- Con của monitor là **group** của layer, không phải plate: `DIV.relative w-full h-full pointer-events-none
  transition-transform duration-75` mang `transform: translate(0px, 0px) scale(1) rotate(0deg); opacity: 1`,
  bên trong là `<video class="w-full h-full" style="object-fit: contain; object-position: 50% 50%">` và
  plate `DIV.absolute inset-0 pointer-events-none`.
- Plate: `background: radial-gradient(transparent 52%, rgba(0, 0, 0, **0.41**) 100%)` — Chromium chuẩn hóa
  `ellipse at 50% 50%` thành mặc định nên nó biến mất khỏi serialized form; **0.41** là `0.5 × 0.82` của
  registry, không phải `0.43` của công thức DOM cũ. Luật số đã đổi thật, đo được, ở đúng row có effect.
- Số child của monitor khớp `z-10`: **0**. Plate phủ toàn khung hình không còn tồn tại.
- `fxCapabilities('vignette')` gọi từ module đã compile của chính trang trả
  `{ fidelity: 'approximate', strategy: 'css', layerOverlay: true, exportSupported: true }`, và
  `layerOverlayPlates([{type:'vignette',params:{intensity:50}}])` trả đúng một plate — mặt registry và mặt
  live là **một** hàm, không phải hai bản sao.

### 32.6 Gate (đo lượt này)

| Gate | Lệnh | Kết quả | Bằng chứng |
| --- | --- | --- | --- |
| 1 Types | `npx nuxt typecheck` | **PASS** | exit 0, 0 × `error TS`; `.nuxt/eslint.config.mjs` regenerate 23:59, 28567 bytes. Lần chạy **đầu** FAIL: `TmcutPreviewPlayer.vue(697,27) TS2304 Cannot find name 'CoreEvaluatedLayout'` — thêm type import, chạy lại |
| 2 Lint | `npx eslint` trên **4** file code đã chạm, chạy **sau** gate 1 | **PASS** | exit 0. Lần đầu FAIL 2 lỗi `no-unused-vars` ngay trong spec (import tĩnh thừa vì spec đã dùng `await import`) — xóa import, không tắt rule |
| 3 Tests | `npx tsx tests/unit/run-all.mts` | **PASS** | **110/110** (thêm `tmcut_surface_plate` so với 109 của F4a), exit 0 |
| 3b Smoke | `run-all.mts --smoke` | **PASS** | **113/113**, exit 0 — chuỗi filter FFmpeg không đổi, chạy để chắc đường render không hồi quy |
| 3c Core | `npx tsc -p packages/core --noEmit` | **PASS** | exit 0 — lượt này **có** sửa core (`effects.mjs`, `index.d.ts`) |
| 4 Live | 8 route `/tmcut*` trên :4003, Chromium | **PASS** | §32.5 đo plate; console: `tmcut` 0 dòng, `autocut` 0, `html-video` 0; `editor` `[error] 401` ×4, `templates` ×2, `factory` ×1, `process` ×1 — tất cả từ `GET /api/v1/ai/relay/catalog` (hub auth hết phiên, đã ghi ở §31.5); `process` thêm `[issue] form field thiếu id/name` ×2 (markup có sẵn, file này F4b không chạm); `voice` `[error] 502` ×2 từ `tts/status` (dịch vụ TTS không chạy). Bốn `[error] 404` thấy ở lượt đo **là do chính agent** probe `import('/_nuxt/app/utils/...')` sai URL, không phải traffic của app |
| 5 Docs | 5 guard markdown + commit | xem cuối §32 | — |

Số dòng: player **159/103**, fxPreview **27/0**, `effects.mjs` **11/4**, `index.d.ts` **8/0**,
`TmcutExportModal.vue` **4/3** (chỉ comment thành thật — gap nó mô tả đã đóng), `tmcut_shared_model.spec.ts`
**5/1**, spec mới **197**.

### 32.7 Chưa chứng minh

- **Không có pixel.** Plate được đo bằng `getAttribute('style')` trên Chromium thật, tức luật số và vị trí
  DOM đã chứng minh; nhưng "vignette làm tối bốn góc của footage thật" chưa so khung hình với frame file
  xuất. Đó vẫn là F6.
- **Hai hàng chồng nhau** chưa dựng được live: thêm asset hai lần cho hai clip **nối tiếp**
  (`left: 0px` rồi `left: 30px`), not a stack, nên chưa có `stackedSurfaces` để đo. Trường hợp này spec
  check 7 khóa bằng hành vi store (`addClipToTrack(..., rows[1].id)`), và cả bốn site template dùng chung
  một hàm plate — nhưng đó là **suy luận từ code**, không phải số đo live.
- **Electron host** chưa chạy lượt này.
- **Grain là plate tĩnh.** Registry face của grain kèm `overlayAnimation`, nhưng `effectOverlay` chỉ trả
  `background`/`opacity` của overlay; hoạt ảnh `tmfx-grain` không đi sang live layer. File grain là ảnh
  tĩnh động, khác `noise` trong export về chuyển động — ghi nợ, không phải bug mới.
- **`blend` vẫn đọc từ clip authored**
  ([TmcutPreviewPlayer.vue:834](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L834)):
  `layerFor` ([evaluate.mjs:290](file:///D:/Applications/tm-studio/packages/core/src/evaluate.mjs#L290) là
  nơi effects, mask, layout đi ra) chưa mang `blend`. Nhóm blend **có** nằm trong group nên nó đã theo
  transform/opacity; chỉ riêng **số** blend chưa đến từ plan.
- **F4 còn một vế**: đường rAF riêng của `TmcutHtmlVideoStudio` (leg 4 của #125) chưa về đồng hồ core; nó
  thuộc F6 cùng `mediaTimeAt` fallback ở
  [useTmcutPlayback.ts:152](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L152).

### 32.8 Bảo vệ working tree

Lượt này staged **9** đường dẫn: [effects.mjs](file:///D:/Applications/tm-studio/packages/core/src/effects.mjs),
`packages/core/src/index.d.ts`,
[fxPreview.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/fxPreview.ts),
[TmcutPreviewPlayer.vue](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue),
`app/components/tmcut/TmcutExportModal.vue`,
[tmcut_surface_plate.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_surface_plate.spec.ts),
`tests/unit/tmcut_shared_model.spec.ts` — **7** file
code/spec — và **2** file docs: chính file này cùng
`docs/tmcut-v4-universal-rendering-multiplatform-roadmap.md`. `git diff` của **từng** file trong 9 đường dẫn này đã đọc hết trước khi stage: không hunk nào thuộc
WIP của chủ repo — working tree đo **65** mục trước commit, trong đó **9** thuộc lượt này; sau commit còn
**56** mục `M`/`??` khác (`i18n/locales/*`, `app/pages/system/*`,
`docs/content/`, `eslint.config.mjs`, `package.json`, `backup/`…) vẫn **không** indexed, và
`git diff --cached` sau commit = **0** dòng. Không xóa binary,
không đụng `backup/ffmpeg-engine-2026-11-03`, không đổi Project Schema v3, không đụng đường Storage Upload.

## 33. Slice F5 — element dùng một lần trả lại decoder **và** watchdog của nó (đo ngày 2026-11-05)

Slice D đem việc giải frame về Mediabunny, và `openMedia` nhận kèm một luật: nó trả về `close`, mọi caller chạy
`close` đó trong `finally`, vì "Mediabunny keeps fetching ranges until disposed" — xem
[frameDecode.ts:69](file:///D:/Applications/tm-studio/app/utils/tmcut/frameDecode.ts#L69) và
[input.dispose() :80](file:///D:/Applications/tm-studio/app/utils/tmcut/frameDecode.ts#L80).
Nhánh DOM của cùng câu hỏi — "file này là gì", khi web runtime không có ffprobe — đứng ngoài luật đó. F5 không thêm
khả năng mới: nó đem đúng luật ấy tới hai site còn lại, rồi đo trên Chromium thật rằng luật **đổi hành vi**, không
chỉ đổi cách viết.

### 33.1 Ba hình dạng rò, hai site mang chúng

Hai site mở một element rồi bỏ đi:
`probeWebMetadata` trong `app/utils/tmcut/webProbe.ts:19` (metadata — file đã bị xóa ở slice I) và
`app/composables/useTmcutMedia.ts:531` (JPEG vẽ bằng canvas).
Trước F5 mỗi site tự viết lại cùng một đoạn, và cả hai **thiếu** đúng một moment:

- `src` vẫn chỉ vào blob URL hay `/uploads/…` sau khi câu trả lời đã giao. Element không "hết việc" chỉ vì biến
  cục bộ không còn tham chiếu tới nó.
- Reader vẫn bám vào đúng byte đó — `readyState` còn ở `4`, `networkState` còn ở `1`.
- Watchdog 15 giây vẫn chạy **sau** khi promise đã resolve, vì `setTimeout(...)` không được `clearTimeout` ở đâu.

Hình thứ ba là lý do lượt này tồn tại chứ không chỉ hai hình đầu: `finish()` của code cũ resolve rồi về, còn timer
thì ở lại tới hết 15 giây. §33.4 đo cả ba bằng số, trên file thật.

### 33.2 Luật

[mediaElement.ts:25](file:///D:/Applications/tm-studio/app/utils/tmcut/mediaElement.ts#L25)
`withThrowawayMedia(kind, setup, timeoutMs)` là nơi **duy nhất** định nghĩa "xong".
[settle :39](file:///D:/Applications/tm-studio/app/utils/tmcut/mediaElement.ts#L39) làm ba việc theo đúng thứ tự —
clear watchdog, release element, resolve — và
[release :61](file:///D:/Applications/tm-studio/app/utils/tmcut/mediaElement.ts#L61) là: bốn handler về `null`, rồi
`pause()`, `srcObject = null`, `removeAttribute('src')`, `load()`. Handler đi trước vì `load()` với không nguồn có
báo error, và một handler còn sống sẽ trả lời câu hỏi không ai hỏi nữa.

[Watchdog :48](file:///D:/Applications/tm-studio/app/utils/tmcut/mediaElement.ts#L48) là `const` và armed **trước**
`setup`, nên một caller settle ngay trong `setup` vẫn có timer để clear.
[THROWAWAY_MEDIA_TIMEOUT_MS :23](file:///D:/Applications/tm-studio/app/utils/tmcut/mediaElement.ts#L23) được export,
nên probe không khai một con số thứ hai: `webProbe.ts:17` import nó và `webProbe.ts:39` truyền nó (cả hai dòng
đã đi cùng file ở slice I). Site thứ
hai là `app/composables/useTmcutMedia.ts:532`: thumb capture
giờ chỉ khai ba handler rồi gán `src`, không còn `document.createElement('video')`, không còn
`setTimeout(() => finish(null), 15000)`.

Chín check của [tmcut_media_element.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_media_element.spec.ts)
dựng luật này trên DOM giả: trả lời thì release; **watchdog clear đúng id** nó đã armed; timeout cũng release;
`settle` chỉ fires một lần nên không ai release hộ; nhánh audio release chính `new Audio()`; không có `document` thì
build **0** element; `probeWebMetadata` đi qua law; và pin nguồn để site thứ ba không tự viết lại công thức.

### 33.3 RED đo được, chín check một lượt

Spec viết trước. Chạy **trước** khi có helper: `0/9 checks passed`, exit 1, log
`node_modules/.cache/tmcut-gates/f5-red-rerun.txt` — đo bằng cách tạm dời `mediaElement.ts` vào
`node_modules/.cache/tmcut-gates/` rồi trả về **nguyên byte** (`md5sum -c`: OK). Không trích log `f5-red.txt` của
lượt đầu: nó in 9 dòng FAILED nhưng footer `0/8`, hai con số không khớp nhau, nên con số dùng ở đây là con số chạy lại.

GREEN: `9/9 checks passed`, exit 0, log `f5-green-rerun.txt`. Giữa hai lần có một `8/9` (`f5-green.txt`): pin
`/withThrowawayMedia\(/` không khớp `withThrowawayMedia<TmcutMediaMetadata>(` — nới thành `[<(]`, vẫn từ chối một
file chỉ import mà không gọi. Code được sửa để thỏa assertion; assertion không được nới để thỏa code, trừ lần này,
và lý do của nó nằm ngay trong chính message `8/9`.

### 33.4 Số đo live trên Chromium thật

Host: Chromium 156 (`navigator.userAgent` đo được `Chrome/156.0.0.0`), điều khiển qua CDP, trang đã đăng nhập, dev
server `:4003`. Media **thiệt**, không phải blob tự sinh: `tests/fixtures/containers/h264.mp4` (4448 byte, 0.6 s,
64×36) và `resources/tmcut-catalog/sample-sfx-sweep.wav` (132 344 byte), phục qua `/_nuxt/@fs/D:/…` — cả hai URL đo
HTTP 200 bằng `curl` trước khi mở element.

| Phép đo | Số đo |
| --- | --- |
| Law, một element | trả lời lúc **7 ms**: `duration 0.6`, `videoWidth 64`, `readyState 4`, `networkState 1`. Sau settle: `hasAttribute('src')` **false**, `srcObject` null, `paused` true, `readyState` **0**, bốn handler null, `networkState` **3** |
| Pre-F5, một element | đọc được `duration 0.6`, nhưng `src` **vẫn trỏ file**, `readyState 4`, `networkState 1` — handler đi, decoder ở lại |
| Pre-F5, sau khi detach handler | vẫn `src`, vẫn `readyState 4`: detach handler **không phải** release. Lý do law phải là một hàm, không phải một lời dặn |
| Watchdog, element không bao giờ trả lời | promise resolve `null` lúc **252 ms** với `timeoutMs = 250`, và element ở đúng trạng thái release |
| `probeWebMetadata` trên file thiệt | mp4 `{0.6, 64, 36, fps 0, hasAudio false}`; wav `{1.5, 0, 0, hasAudio true}`; jpg `null` — ảnh không có duration, hành vi **không đổi** so với trước khi rewrite |

Bảng dưới là lô 12 + 12 chạy đồng thời trên route `/tmcut/voice`, mỗi watchdog theo dõi bằng chính timer của nó:

| Lô | element giữ `src` | `readyState` | watchdog armed | watchdog **fired** sau 15 s |
| --- | --- | --- | --- | --- |
| Law | **0/12** | 0 (HAVE_NOTHING) | 12 | **0/12** |
| Pre-F5 | **12/12** | 4 (HAVE_ENOUGH_DATA) | 12 | **12/12**, in ra 12 lần resolve `TIMEOUT` |

Đó chính là câu "forty live timers and forty live decoders" ở đầu module, đo ở quy mô 12: code cũ để lại 12 timer và
12 decoder sống thêm 15 giây cho 12 file **đã trả lời xong**; law để lại 0 và 0.
`networkState` sau release in `3` (`NETWORK_EMPTY`) ngay tại settle và `0` (`NO_SOURCE`) khi đọc lại vài giây sau —
cả hai lô 12 đều đọc muộn nên cùng in `0`. Hai giá trị đều có nghĩa "không còn nguồn", và spec unit không đoán con số
này: nó đo `removeAttribute('src')` cùng `load()` đã chạy, nên khác biệt giữa `3` và `0` không phải chỗ dựa.
`document.querySelectorAll('video')` không đổi quanh các lô đo (0 → 0 trên trang login, 1 → 1 trên editor — chiếc
duy nhất là của player), tức law không cắm element nào vào cây.

### 33.5 Tám route `/tmcut*`, và lô đo không để lại tiếng động

Mỗi route mở bằng CDP trên cùng phiên đã đăng nhập (`:4003`), đọc console **sau** navigation, và mỗi dòng noise được
quy về chủ của nó bằng network log cùng route:

| Route | Dòng `[error]`/`[warn]`/`[issue]` | Chủ |
| --- | --- | --- |
| `/tmcut` | 0 | — |
| `/tmcut/autocut` | 0 | — |
| `/tmcut/editor` | `[error] 401` ×4 | `GET /api/v1/ai/relay/catalog` — network log in đúng 4 request 401 cùng URL; hub auth hết phiên, đã ghi ở §31.5 |
| `/tmcut/templates` | `[error] 401` ×2 | cùng `relay/catalog` |
| `/tmcut/factory` | `[error] 401` ×1 | cùng `relay/catalog` |
| `/tmcut/html-video` | 0 | — |
| `/tmcut/process` | `[issue] form field thiếu id/name` ×2 + `[error] 401` ×1 | markup có sẵn từ lâu (file này không chạm) + `relay/catalog` |
| `/tmcut/voice` | `[error] 502` ×2 | `GET /api/v1/media/tts/status?baseUrl=http://127.0.0.1:8000` — network log in đúng 2 request; dịch vụ TTS không chạy |

Không dòng nào thuộc F5. Bốn URL probe của lượt này (`/_nuxt/@fs/…mediaElement.ts`, `…webProbe.ts`, `h264.mp4`,
`sample-sfx-sweep.wav`) đều **200**, nên khác §32.6, lần sweep này không có 404 nào do chính agent tự gây.
Route `/tmcut/editor` còn một request `[206]` tới `uploads/mw2df63d-1b9463e6-f4b-probe.mp4`: đó là asset probe của
§32 mà project hiện tại đang tham chiếu, do **player** mở — không phải throwaway element — và `.data` nằm trong
`.gitignore` (đo bằng `git check-ignore`), nên nó là app data, không phải state của repo.

Baseline console của `/tmcut/voice` là **1 dòng** (502 ×2 ở bảng trên). Chạy xong 24 element — 12 theo law, 12 theo
kiểu cũ — đọc lại console: vẫn **1 dòng, cùng msgid**. `load()` với không nguồn không rò `error` ra page, vì handler
đã detached trước; đó là lý do thứ tự trong `release` là handlers-first.

### 33.6 Gates

| Gate | Lệnh | Kết quả | Bằng chứng |
| --- | --- | --- | --- |
| 1 Types | `npx nuxt typecheck` | **PASS** | exit 0, `grep -c "error TS"` = **0**; `.nuxt/eslint.config.mjs` regenerate **08:14**, 28567 byte |
| 2 Lint | `npx eslint` trên **5** file code/spec đã chạm, chạy **sau** gate 1 | **PASS** | exit 0, log **0 byte**; config không đổi mtime sau đó nên kết quả còn hiệu lực. Lượt đầu (07:36) FAIL 4 lỗi — `prefer-const` ở `watchdog`, `no-dynamic-delete` và 2 × `max-statements-per-line` trong spec — sửa code, không tắt rule |
| 3 Tests | `npx tsx tests/unit/run-all.mts` | **PASS** | **111/111**, exit 0 (110 của F4b + spec mới) |
| 3b Smoke | `run-all.mts --smoke` | **PASS** | **114/114**, exit 0 — chuỗi filter FFmpeg không đổi, chạy để chắc đường render không hồi quy |
| 3c Core | `npx tsc -p packages/core --noEmit` | **PASS** | exit 0, log **0 byte** — lượt này **không** sửa `packages/core` |
| 3d Spec mới | `node node_modules/tsx/dist/cli.mjs … tmcut_media_element.spec.ts` | **PASS** | RED **0/9** (exit 1) → GREEN **9/9** (exit 0); `tmcut_platform_adapter` **12/12**, `tmcut_asset_import` **16/16**, `tmcut_media_offline` **13/13**, `tmcut_media_probe` **13/13**, `tmcut_frame_service` **19/19** |
| 4 Live | 8 route `/tmcut*` + đo release trên Chromium 156, :4003 | **PASS** | §33.4 và §33.5 |
| 5 Docs | 5 guard markdown chạy **sau** khi §33 và bullet roadmap được viết | **PASS** | exit 0 cả năm: `tmcut_docs_link_integrity` **4/4**, `tmcut_doc_line_length` **4/4**, `tmcut_doc_table_shape` **3/3**, `tmcut_doc_citations` **5/5**, `docs_markdown` **12/12** |
| 3 Suite (chạy lại cuối) | `npx tsx tests/unit/run-all.mts` + `--smoke`, sau toàn bộ edit docs | **PASS** | xem §33.6b |

### 33.6b Chạy lại sau khi docs được viết

`run-all.mts` gom mọi file `tests/unit/tmcut_*.spec.ts` và `docs_*.spec.ts`, nên năm guard markdown của gate 5 **nằm
trong** gate 3: một lần chạy suite là một lần chứng minh cả code lẫn docs. Bảng dưới là lần chạy đặt **sau** khi §33.6,
§33.6b, §33.8 và ba bullet roadmap F5 được viết — tức các con số này thuộc về cây sắp commit, không phải cây đo ở §33.4.

| Lệnh | Kết quả | Bằng chứng |
| --- | --- | --- |
| `npx tsx tests/unit/run-all.mts` | **111/111**, exit 0 | `node_modules/.cache/tmcut-gates/f5b-suite.txt` |
| `npx tsx tests/unit/run-all.mts --smoke` | **114/114**, exit 0 | `node_modules/.cache/tmcut-gates/f5b-smoke.txt` |
| `npx nuxt typecheck` lại sau edit | **PASS** — exit 0, `grep -c "error TS"` = 0 | edit chỉ đụng `.md`, `grep -c "error TS"` vẫn `0` |
| `npx eslint` trên 5 file code/spec | **PASS** — exit 0, log 0 byte | log `f5b-eslint.txt` |

### 33.7 Chưa chứng minh

- **Electron host chưa chạy lượt này.** Law nằm trong `app/**` và mới được đo trên Chromium web; desktop branch của
  adapter không tới `webProbe.ts`, nên đây là khoảng trống kỹ thuật, không phải bằng chứng vô hại.
- **Batch ở quy mô 12, không phải 40.** Con số 40 là cỡ một lần import nhiều file; 12 → 40 suy ra tuyến tính từ hai
  lô đã đo, chưa phải số đo trực tiếp.
- **Decoder được OS/GPU thu hồi thật thì chưa chứng minh.** `readyState 0` cộng `networkState` no-source là cách
  HTML spec nói "element không còn giữ resource"; đó không phải bằng chứng lấy từ media pipeline internals.
- `getMediaSize` ở `app/utils/ffmpegHelper.ts:167` mang đúng
  hình dạng site thứ ba: `document.createElement('video')`, `src` giữ nguyên, handler giữ nguyên
  (`app/utils/ffmpegHelper.ts:176`). Nó có **0** call site — `grep` trên
  `app`, `server`, `shared`, `packages`, `electron`, `tests` chỉ ra chính định nghĩa nó, cộng một bản copy trong
  `backup/ffmpeg-engine-2026-11-03/`. Không migrate một hàm chết, và cũng không xóa nó ở lượt này: đó là việc của
  slice I, lượt gỡ engine.
- **Không có pixel.** F5 không đụng đường vẽ, nên không có khung hình nào để so.

### 33.8 Bảo vệ working tree

Lượt này chạm **5** file code/spec — [mediaElement.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/mediaElement.ts)
(mới, 70 dòng), `app/utils/tmcut/webProbe.ts` (41 dòng, đã xóa ở slice I),
`app/composables/useTmcutMedia.ts`,
[tmcut_media_element.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_media_element.spec.ts) (mới, 381 dòng),
`tests/unit/tmcut_platform_adapter.spec.ts` — và
**3** file docs: chính file này,
[zero-ffmpeg-decisions.md](file:///D:/Applications/tm-studio/docs/adr/zero-ffmpeg-decisions.md) (một anchor trỏ tới
dòng đã dời của `webProbe.ts`) cùng
`docs/tmcut-v4-universal-rendering-multiplatform-roadmap.md`.
Không xóa binary, không đụng `backup/ffmpeg-engine-2026-11-03`, không đổi Project Schema v3, không đụng đường Storage
Upload, không tắt rule lint nào.

Đếm cây trước khi stage (`git status --porcelain | wc -l`): **64** entry, trong đó **21** entry chưa từng được theo
dõi (`git status --porcelain | grep -c '^??'`). Tám đường thuộc lượt F5 — 5 file code/spec kể trên cộng
`docs/adr/zero-ffmpeg-decisions.md`, `docs/audit/zero-ffmpeg-audit.md`,
`docs/tmcut-v4-universal-rendering-multiplatform-roadmap.md` — nên **56** entry còn lại là WIP của owner
(`app/pages/system/**`, `app/assets/css/{decor,glass}.css`, `i18n/**`, `server/**`, `electron/main.cjs`, `backup/`,
`docs/content/`…), và `git add` chỉ nhận đúng tám đường đó. Trong tám đường, **6** đã được theo dõi
(`app/composables/useTmcutMedia.ts`, `app/utils/tmcut/webProbe.ts`, `tests/unit/tmcut_platform_adapter.spec.ts` và ba
file docs) còn `app/utils/tmcut/mediaElement.ts` cùng `tests/unit/tmcut_media_element.spec.ts` là file mới.
`git diff --name-only` vì thế giảm từ **42** xuống **36** sau stage: sáu đường sang index thì không còn là diff unstaged;
`git status --porcelain` vẫn **64** dòng vì chúng chỉ đổi cột trạng thái. Sau commit, `git diff --cached` phải đọc
**0** dòng.

---

## 34. Slice F6a — vì trí nguồn của một surface chỉ core được phép trả lời (2026-11-05)

### 34.1 Hai bản copy của cùng một luật, và cái giá của nhánh fallback

`compositePlan` trao cho preview cái layer mà core đã tính cho tick đó, và layer ấy
đã trả lời câu "bức tranh này nằm ở đâu trong file nguồn": `sourceTicks` — tốc độ,
ramp và reverse đều đã gộp vào, kết quả đã kẹp trong `[in, out]` của chính clip
([evaluate.mjs:67](file:///D:/Applications/tm-studio/packages/core/src/evaluate.mjs#L67)).
Nhưng [useTmcutPlayback.ts](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts)
còn giữ một câu trả lời thứ hai cho đúng một case: khi core nói "clip này sống
nhưng ta không có khoảng nguồn nào cho nó", surface rơi vào `clipMediaTimeSec`
của app — tức `clip.in + local * speed`
([clipTime.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/clipTime.ts), helper đã gỡ ở §46).

Case đó không phải tưởng tượng. `clipSpan` ưu tiên hình dạng DSL và chỉ cần
`timeline.{start,duration}` là clip sống ([timeline.mjs:55](file:///D:/Applications/tm-studio/packages/core/src/timeline.mjs#L55)),
còn `sourceRangeOf` cần `source.{in,out}` hoặc một `in` dạng số
([evaluate.mjs:55](file:///D:/Applications/tm-studio/packages/core/src/evaluate.mjs#L55)). Một project đi vào
app theo đúng hình v3 (template, AI plan, file mở từ DSL) thỏa mãn vế đầu và vi phạm
vế sau: nó sống trên canvas và core trả `null`.

Giá của nhánh đó đã **đo**, không suy ra: với `clip.in = undefined`, phép tính thành
`NaN`, và `ticksToSec` gấp mọi giá trị không hữu hạn về `0`
([time.mjs:18](file:///D:/Applications/tm-studio/packages/core/src/time.mjs#L18)). Số đo ở playhead 1 s là
`mediaTimeSec = 0`. Element vì thế bị đỗ ở khung hình đầu tiên của nguồn và bị kiểm
tra drift xin seek lại — biểu hiện là một clip đứng hình chứ không phải một crash,
nên nó lọt qua mắt người dùng và lọt qua cả console.

### 34.2 Luật mới

Một surface có vị trí nguồn, hoặc nó không nằm trên canvas:

| Neo | Trước | Sau |
| --- | --- | --- |
| [useTmcutPlayback.ts:144](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L144) | slot đi thẳng vào danh sách | `if (slot.layer.sourceTicks === null) continue` |
| [useTmcutPlayback.ts:156](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L156) | `sourceTicks === null ? mediaTimeAt(clip, playhead) : ticksToSec(...)` | `mediaTimeSec: ticksToSec(slot.layer.sourceTicks)` — một nguồn |
| [useTmcutPlayback.ts:6](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L6) | import `clipMediaTimeSec` | chỉ còn `clipStartSec` (dùng cho `mediaRate`) |
| [useTmcutPlayback.ts:198](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L198) | `if (!spec?.type \|\| partner.layer.sourceTicks === null) return null` | `if (!spec?.type) return null` — điều kiện partner giờ do chính danh sách surface bảo đảm |

Đường DOM không đổi một dòng nào, và đó là điểm chính: nó đã luôn đọc
`surface.mediaTimeSec` ([TmcutPreviewPlayer.vue:867](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L867)),
nên khi composable thôi bịa ra một con số thì `el.currentTime` không còn nhận con số bịa đó nữa.

**Không đụng:** hàng audio vẫn tự tính media time bằng `clipMediaTimeSec`
([TmcutPreviewPlayer.vue:579](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L579)). Clip audio
không nằm trong plan footage nên không có `sourceTicks` để đọc; đó là việc của slice G
(Web Audio + `audioOrchestration`), không phải việc của lượt này.

### 34.3 RED rồi GREEN

Spec mới [tmcut_surface_media_time.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_surface_media_time.spec.ts)
(156 dòng, **5** check) dựng đúng hình v3 bằng store thật: thêm clip qua
`addClipToTrack`, rồi đặt `timeline = { start, duration }` và bỏ `in`/`out` — tức đi
qua cửa của evaluator chứ không qua một fixture tự bịa.

- **RED**: exit 1, fail ngay check 2 với `actual ['a.mp4']` vs `expected []` — log
  `node_modules/.cache/tmcut-gates/f6a-red.txt`. Check 1 (đường phẳng, surface lấy
  `sourceTicks / TICKS`) đã xanh trước khi sửa, nên failure không đến từ harness.
- **GREEN**: **5/5**, exit 0. Năm check là: surface phẳng lấy số của core; clip v3
  sống không còn surface nào; surface bị bỏ không cướp quyền audio của hàng dưới;
  crossfade mà partner không có vị trí nguồn thì render thành cut thường; và pin
  nguồn — composable không còn `clipMediaTimeSec` hay `function mediaTimeAt`.
- Spec hàng xóm chạy lại, không đổi assertion: `tmcut_preview_paint_plan` **6/6**,
  `tmcut_surface_plate` **7/7**, `tmcut_speed_clock` **5/5**, `tmcut_paint_stack` **9/9**.

### 34.4 Live, và một con số suýt bị đọc sai

`:4003`, route `/tmcut/editor`, project hiện có (2 clip `f4b-probe.mp4`, 0.6 s mỗi
clip, nội dung 1.05 s). Bấm *Jump to start* rồi *Play*, sampler `setInterval` 100 ms
ghi `performance.now()`, timecode program monitor và `currentTime` của element:
**51** mẫu, và **51/51** `Number.isFinite(el.currentTime)`.

Element chạy đúng nhịp nguồn: `0.098 → 0.597` trong clip thứ nhất, rồi một seek sửa
drift đưa nó về `0.11` ở clip thứ hai và chạy tiếp tới `0.6`; playhead bám đồng hồ
đến khi dừng ở `00:01.05`. Không có giá trị nào bằng `0` một cách giả mạo — tức
đúng cái mà nhánh fallback từng tạo ra — và không có mẫu nào NaN.

Lượt đo đầu suýt ghi một "bug" không tồn tại: bảng thời gian của program monitor là
`MM:SS.ff`, trong đó `ff` là **chỉ số khung hình theo rate của canvas** (30 fps ở
project này), không phải phần trăm giây. Đọc `00:01.03` như 1.03 s rồi so với
`00:00.29` cho một bước nhảy 0.74 s chỉ trong 105 ms. Đo lại có `performance.now()`
kèm từng mẫu: `00:00.29` là 29/30 = **0.967 s**, `00:01.03` là **1.1 s**, tức 0.13 s
trong 105 ms đồng hồ — playhead bám đúng, rAF không tích phân một delta khổng lồ nào
cả. Con số sai nằm ở người đọc, không nằm ở loop, và nó được ghi lại ở đây vì nó là
bằng chứng cho một điều khác: **chưa có** số đo nào về hiện tượng rAF bị đói trên
lượt này, nên mục "playhead theo core clock" (F6e) vẫn chưa có án lệ, chứ không phải
đã được minh oan.

Console: `info <Suspense>` (1) + `error 401` (×4) — đúng `GET /api/v1/ai/relay/catalog`,
hub hết phiên, đã ghi ở §31.5. Baseline không đổi sau lượt này.

### 34.5 Gates

| Gate | Lệnh | Kết quả | Bằng chứng |
| --- | --- | --- | --- |
| 1 Types | `npx nuxt typecheck` | **PASS** | exit 0, `grep -c "error TS"` = **0**; `.nuxt/eslint.config.mjs` regenerate **08:53**, 28567 byte |
| 2 Lint | `npx eslint` trên **2** file đã chạm, chạy **sau** gate 1 | **PASS** | exit 0, log **0 byte**. Lượt đầu FAIL 1 lỗi — `@stylistic/arrow-parens` ở `oneClip(clip => {…})` trong spec — sửa code, không tắt rule |
| 3 Tests | `npx tsx tests/unit/run-all.mts` | **PASS** | **112/112**, exit 0 (111 của F5 + spec mới) |
| 3b Smoke | `run-all.mts --smoke` | **PASS** | **115/115**, exit 0 |
| 3c Core | `npx tsc -p packages/core --noEmit` | **PASS** | exit 0, log **0 byte** — lượt này không sửa `packages/core` |
| 3d Spec mới | `node node_modules/tsx/dist/cli.mjs … tmcut_surface_media_time.spec.ts` | **PASS** | RED fail ở check 2 (exit 1) → GREEN **5/5** (exit 0) |
| 4 Live | `/tmcut/editor` + 51 mẫu phát trên Chromium, :4003 | **PASS** | §34.4 |
| 5 Docs | §34 + bullet roadmap + 5 guard markdown | xem §34.7 | — |

### 34.6 Chưa chứng minh

- **Chưa có project thật nào ở hình v3 đi qua cửa này.** Spec dựng hình đó vì core
  nhận cả hai hình; số lượng file `.json` của người dùng thật đang mang
  `timeline.{start,duration}` mà thiếu `source` là **chưa đo**.
- **Electron host chưa chạy lượt này.** Law nằm trong `app/composables`, desktop
  dùng cùng composable, nhưng chưa có số đo CDP trên Electron cho F6a.
- **Hàng audio vẫn còn bản copy thứ hai** — hữu ý để lại cho slice G, không phải
  đã chứng minh là vô hại.
- **F6e (playhead theo core clock thay vì tích phân delta rAF) vẫn mở.** §34.4 chỉ
  nói lượt này không tạo ra bằng chứng mới cho nó.
- **Không có pixel.** F6a đổi danh sách surface, không đổi đường vẽ, nên không có
  khung hình nào để so.

### 34.7 Bảo vệ working tree

Lượt này chạm **2** file code/spec — [useTmcutPlayback.ts](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts)
(686 dòng, `git diff --stat`: **14** thêm / **12** bớt) và
[tmcut_surface_media_time.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_surface_media_time.spec.ts)
(mới, 156 dòng) — cùng **2** file docs: chính file này và
`docs/tmcut-v4-universal-rendering-multiplatform-roadmap.md`.
`packages/core`, `TmcutPreviewPlayer.vue`, `clipTime.ts` và đường export không đổi một
dòng nào. File đo tạm `tests/unit/tmp_f6a_measure.mts` đã xóa sau khi lấy số; scratch
`f6a-measure.mts` đặt nhầm chỗ cũng vậy. Không binary mới, không đụng
`backup/ffmpeg-engine-2026-11-03`, không đổi Project Schema v3, không tắt rule lint nào.

## 35. Slice F6e — nhịp playhead do khung hình của core đếm, không do delta rAF cộng dồn (2026-11-05)

### 35.1 Luật nhịp sống trong app, và sống hai lần

Từ #86, mọi câu hỏi **vị trí** của preview đã đi qua core: `createFrameScheduler`
đếm frame, `clock.frameStartAt(i)` đặt frame, `seekToFrame` đậu đúng răng của grid.
Riêng câu "khung tiếp theo playhead đứng đâu" thì loop tự trả lời, bằng cách cộng
dồn khoảng thời gian mà rAF giao cho nó:

```
const delta = (timestamp - lastTimestamp) / 1000        // giây wall clock
playhead.value = playhead.value + delta * shuttleRate.value
```

Và đó là **hai** bản copy của cùng một phép: một ở nhánh forward, một ở nhánh reverse
của `shuttleBackward()` (J). `lastTimestamp = 0` là hiệu cờ "chưa armed" ở play,
pause và shuttleBackward.

Giá của nó không phải lý thuyết. `scheduler.mjs` nói host chỉ được sở hữu **WHEN** —
"it can never own WHAT that index contains" — còn ở đây host sở hữu cả hai: vị trí là
một float cộng dồn của mọi khoảng máy giao (đo live: 14–20 ms, ~68 Hz, tức ~2.37 mẫu
cho mỗi khung 30 fps). Preview vì thế xem những vị trí mà **không khung hình nào của
file export từng ngồi ở đó**: cùng một tick, `frameAt(i)` và `playhead` là hai chỗ
khác nhau. Slice F yêu cầu 6 ("không dùng wall-clock timer làm timeline source of
truth") vẫn chưa đóng ở vế này, dù §34 đã đóng vế vị trí nguồn.

### 35.2 Luật mới

Nhịp là một **anchor** `(timestamp, frame, rate)`, và mỗi frame là một phép quy đổi
qua clock của core — không còn cộng dồn nào cả:

| Neo | Nội dung |
| --- | --- |
| [useTmcutPlayback.ts:395](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L395) | `anchorMs` / `anchorFrame` / `anchorRate` / `needsRearm` — thay `lastTimestamp` |
| [useTmcutPlayback.ts:400](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L400) | `armPace(timestamp)` chụp `(now, currentFrameIndex.value, shuttleRate.value)` |
| [useTmcutPlayback.ts:410](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L410) | `pacedTime(timestamp)`: elapsed → ticks → `clock.frameIndexAt(elapsedTicks * abs(rate))` → `clock.frameStartAt(anchorFrame ± advanced)` → `ticksToSec` |
| [useTmcutPlayback.ts:433](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L433) | `if (needsRearm \|\| shuttleRate.value !== anchorRate) armPace(timestamp)` |
| [useTmcutPlayback.ts:435](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L435) | `const newTime = pacedTime(timestamp)` — **một** phép tính, nhánh reverse và nhánh forward cùng đọc |

`clock.frameStartAt` tự kẹp số học lùi (`Math.max(0, Math.floor(index))` ở
[clock.mjs:42](file:///D:/Applications/tm-studio/packages/core/src/clock.mjs#L42)), nên J không cần một
phép cộng delta riêng nữa: hai chiều đi trên **cùng một grid**, chỉ khác dấu của số
frame đã chạy.

Re-arm thay cho "set 0". Một vị trí mà nhịp **không tự sinh ra** làm anchor cũ vô
nghĩa, nên `seek()` ([:270](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L270)),
`play()` ([:553](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L553)), `pause()`
([:565](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L565)) và
`shuttleBackward()` ([:618](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L618)) đều đặt
`needsRearm = true`. Hệ quả đo được ở check 3 của spec: một interval đã đi ở 1x
không bị **đi lại** ở 8x — đổi tốc độ giữa chừng tính từ frame hiện tại, không từ
điểm neo cũ.

Không đổi: `TICKS_PER_SECOND` là hằng core nên phép quy đổi ms → ticks dùng đúng
timebase 120 000 mà mọi module khác dùng ([time.mjs:9](file:///D:/Applications/tm-studio/packages/core/src/time.mjs#L9)).
`renderPosition` và đường scrub không liên quan tới nhịp nên đứng nguyên.

### 35.3 RED rồi GREEN

Spec mới [tmcut_playback_pace.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_playback_pace.spec.ts)
(197 dòng, **6** check) thay rAF bằng một đồng hồ giả một slot (`tick(ms)` đúng như
mô hình `tmcut_playback_duration` đang dùng), rồi đo playhead **bằng ticks**:

- **RED**: exit 1 ở check 1 — `86/90 forward samples sat between frames (first: 1920
  ticks, grid 4000)`. Đây chính là bằng chứng trực tiếp của §35.1: loop cũ trả về
  những vị trí mà `frameAt(i)` không bao giờ sinh ra.
- **GREEN**: **6/6**, exit 0. Sáu check: (1) mọi vị trí khi phát là một **frame start**;
  (2) một giây wall clock nhịp một giây timeline ở 1x, và hai giây sau `shuttleForward()`
  ×3 ở 8x; (3) đổi rate giữa chừng tính từ frame hiện tại (0.5 s @1x + 0.125 s @8x = 1.5 s);
  (4) J đi **ngược trên cùng grid** và lùi đúng 0.6 s; (5) scrub khi đang phát re-arm
  (seek 4 s rồi 0.2 s nhịp = 4.2 s); (6) pin nguồn — không còn `const delta = (timestamp -
  lastTimestamp) / 1000`, không còn `playhead.value + delta`, và có `clock.frameIndexAt`
  cùng `clock.frameStartAt`.
- Dung sai là **một frame cho mỗi segment nhịp**: grid chỉ giải được số frame nguyên,
  còn anchor là timestamp đầu tiên loop được đưa, nên mỗi segment giữ lại tối đa một
  frame chưa tiêu. Check 2 và 3 đi hai segment nên dung sai `2 * perFrame` — ghi thẳng
  trong spec, không phải con số nới cho qua.
- Hàng xóm chạy lại, không đổi assertion: `tmcut_playback_duration` **9/9**,
  `tmcut_speed_clock` **5/5**, `tmcut_frame_scheduler` **10/10**,
  `tmcut_surface_media_time` **5/5**, `tmcut_preview_paint_plan` **6/6**.

### 35.4 Live

`:4003`, `/tmcut/editor`, project hiện có (nội dung 1.1667 s = 35 khung @30 fps). Sampler
đọc timecode program monitor (`MM:SS.ff`, `ff` là **chỉ số khung hình theo rate canvas**
— bài học §34.4, lượt này đọc đúng ngay từ đầu) kèm `performance.now()`:

| Phép đo | Số |
| --- | --- |
| Forward | 64 mẫu / 902 ms, `00:00.00 → 00:00.26` = 27 timecode khác nhau, **paceRatio 1.0244** |
| Frame skip | **0** vi phạm trên toàn lượt — không mẫu nào nhảy qua một răng grid |
| Reverse (J) | 39 mẫu, `00:01.05 → 00:00.21` = 0.4667 s timeline trong 440 ms wall, **ratio 1.0606**, 0 violation |
| Loop | 213 mẫu / 3001 ms, max 1.1667 s, **2 lần wrap** |
| Nhịp máy | 2.37 mẫu cho mỗi lần timecode đổi — đúng ~68 Hz rAF trên 30 fps |

`firstMoveMs 56`: frame đầu sau khi bấm Play đến sau một nhịp rAF, không phải 0 — đó
là anchor được arm ở timestamp mà loop **được đưa**, không phải lúc bấm nút.
Số đo lấy **trên module đã sửa**: trang được reload trước khi đo vì module đang serve
mang một lỗi parse từ lượt phát triển (`const newTime` khai báo hai lần), và mọi mẫu
trước đó bị bỏ.

Console: `info <Suspense>` (1) + `error 401` (×4, `GET /api/v1/ai/relay/catalog` — hub hết
phiên, §31.5). Baseline không đổi.

### 35.5 Gates

| Gate | Lệnh | Kết quả | Bằng chứng |
| --- | --- | --- | --- |
| 1 Types | `npx nuxt typecheck` | **PASS** | exit 0, `grep -c "error TS"` = **0**; `.nuxt/eslint.config.mjs` regenerate **09:44**, 28567 byte |
| 2 Lint | `npx eslint` trên **2** file đã chạm, chạy **sau** gate 1 | **PASS** | exit 0, log **0 byte** (`f6e-eslint-final.txt`). Lượt đầu FAIL 2 lỗi — `@stylistic/max-statements-per-line` và `@typescript-eslint/no-unused-vars` trong spec — sửa code, không tắt rule |
| 3 Tests | `npx tsx tests/unit/run-all.mts` | **PASS** | **113/113**, exit 0, 0 dòng FAIL (112 của F6a + spec nhịp mới) |
| 3b Smoke | `run-all.mts --smoke` | **PASS** | **116/116**, exit 0, 0 dòng FAIL — chạy trên **chính tree commit** |
| 3c Core | `npx tsc -p packages/core --noEmit` | **PASS** | exit 0, log **0 byte** — lượt này không sửa `packages/core` |
| 3d Spec mới | `npx tsx --tsconfig tsconfig.test.json tests/unit/tmcut_playback_pace.spec.ts` | **PASS** | RED exit 1 (check 1) → GREEN **6/6** exit 0 |
| 4 Live | `/tmcut/editor` trên Chromium, :4003 | **PASS** | §35.4 |
| 5 Docs | §35 + bullet roadmap + 5 guard markdown | **PASS** | guards chạy trong gate 3 (`run-all` glob cả `tmcut_docs_*`/`docs_*`) |

### 35.6 Chưa chứng minh

- **Độ chính xác dưới một frame là hữu ý, không phải đã đo.** Grid không cho phép một
  vị trí giữa hai frame; mỗi segment nhịp giữ lại tối đa một frame chưa tiêu, nên
  playhead có thể trễ một khung so với đồng hồ wall. paceRatio 1.02 (forward) và 1.06
  (reverse) là số của hiệu đó, không phải của một lỗi drift.
- **Vị trí wrap của loop không nằm trên grid** — khi wrap, `seek()` re-arm từ một vị
  trí đã bọc, nên frame tiếp theo tính từ đó. Đã đo 2 lần wrap hợp lệ, chưa đo độ lệch
  của răng đầu tiên sau wrap.
- **Electron host chưa chạy lượt này.** Luật nằm trong `app/composables`, desktop dùng
  cùng composable, nhưng chưa có số đo CDP trên Electron cho F6e.
- **Không đọc được playhead từ DOM**, nên live chỉ chứng minh được **0 khung bị bỏ**
  và paceRatio; tính "đúng là frame start" chỉ được chứng minh bởi spec unit với rAF giả.
- **rAF riêng của html-video vẫn còn đó** (`TmcutHtmlVideoStudio.vue` tự tích phân
  delta của nó) — việc của **F6b**, không phải lượt này.
- **F6c đã đóng (§37, 2026-11-05), F6d vẫn mở**: blend lấy từ plan, và grain
  `overlayAnimation` trên plate live.

### 35.7 Bảo vệ working tree

Lượt này chạm **2** file code/spec — [useTmcutPlayback.ts](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts)
(714 dòng, `git diff --stat`: **39** thêm / **11** bớt) và
[tmcut_playback_pace.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_playback_pace.spec.ts)
(mới, 197 dòng) — cùng **2** file docs: chính file này và
`docs/tmcut-v4-universal-rendering-multiplatform-roadmap.md`.
`packages/core`, `TmcutPreviewPlayer.vue`, `TmcutHtmlVideoStudio.vue` và đường export
không đổi một dòng nào; Project Schema v3 không đổi; không binary mới, không đụng
`backup/ffmpeg-engine-2026-11-03`, không tắt rule lint nào.

## 36. Slice F6b — một luật nhịp cho hai host preview, và scrub đi trên lưới khung hình (2026-11-05)

### 36.1 Bản copy thứ hai của luật vừa đóng ở #35, và cái giá thật của nó

#35 đóng luật nhịp nhưng đóng nó **bên trong** `useTmcutPlayback.ts`: loop editor
không còn cộng `delta` vào `playhead` nữa, mà hỏi clock. Cùng lúc đó, ở host thứ
hai, `app/components/tmcut/TmcutHtmlVideoStudio.vue`
vẫn giữ nguyên hình dạng cũ của bài toán — `const delta = lastFrameAt ? Math.min(0.25, (now - lastFrameAt) / 1000) : 0`
rồi `previewTime.value + delta`, tức đúng một bản copy thứ hai của cùng phép tích phân.

Host này đắt hơn nó trông vậy, vì preview của nó **không phải một video element**.
Nó gửi `{ type: 'hf:seek', time }` sang tài liệu HTML/CSS chạy trong iframe
`sandbox="allow-scripts"`, và tài liệu ấy paint theo `window.__hf.seek(t)`. Job
render (nút *Render MP4*) repaint frame thứ `i` tại `i / fps` — nghĩa là mỗi thời
gian nằm giữa hai khung là một thời gian **file xuất ra không chứa**. Preview kiểu
cộng delta vì thế không chỉ lệch nhịp: nó xin composition một bức tranh mà không
bao giờ tồn tại trên đĩa, rồi người dùng bấm Render và thấy một video hơi khác
cái vừa xem.

### 36.2 Luật: nhịp nằm trong core, hai host chỉ giao timestamp

`createFramePace(clock)` — [pace.mjs:84](file:///D:/Applications/tm-studio/packages/core/src/pace.mjs#L84) —
là chuyển đổi duy nhất từ "host nói ngần này thời gian trôi" sang "playhead đứng
trên khung hình này". Neo là bộ ba `(timestamp, frame, rate)`; mỗi lần gọi
`at(timestampMs, rate, currentFrame)` chỉ mua một số **nguyên** khung
([pace.mjs:93](file:///D:/Applications/tm-studio/packages/core/src/pace.mjs#L93))
và đặt xuống bằng `clock.frameStartAt` ([pace.mjs:61](file:///D:/Applications/tm-studio/packages/core/src/pace.mjs#L61)),
nên vị trí luôn là một **điểm bắt đầu khung**, không bao giờ là một float giữa hai
khung. Ba đường re-arms ([pace.mjs:88](file:///D:/Applications/tm-studio/packages/core/src/pace.mjs#L88)):
đổi rate, vị trí không do nhịp sinh ra, và `reset()`
([pace.mjs:103](file:///D:/Applications/tm-studio/packages/core/src/pace.mjs#L103)) —
khoảng thời gian đã mang theo bị **tiêu**, không được chi tiếp.

Module law giữ nguyên: host vẫn sở hữu WHEN (nó giao timestamp của rAF), core sở
hữu WHAT. hai host đọc nó:

| Neo | Trước | Sau |
| --- | --- | --- |
| [useTmcutPlayback.ts:395](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L395) | `armPace` + `needsRearm` + 4 biến closure | `framePace()` cache theo **danh tính clock** của scheduler, gọi `createFramePace(clock)` |
| [useTmcutPlayback.ts:406](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L406) | `ticksToSec(clock.frameStartAt(anchorFrame ± advanced))` tự tính ở app | `ticksToSec(framePace().at(timestamp, shuttleRate, currentFrameIndex).startTicks)` |
| [useTmcutPlayback.ts:270](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L270) / [:547](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L547) / [:559](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L559) / [:612](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L612) | `needsRearm = true` | `resetPace()` — cùng một nghĩa, giờ là lời gọi vào nhịp |
| `app/components/tmcut/TmcutHtmlVideoStudio.vue:95` | không có clock nào cả | `previewClock = createClock(fpsToRational(fps))`, `previewPace = createFramePace(previewClock)` |
| `app/components/tmcut/TmcutHtmlVideoStudio.vue:215` | `previewTime.value + delta`, clamp bằng `if (next >= renderDuration) next = 0` | `previewPace.at(now, 1, currentPreviewFrame()).frame` → `app/components/tmcut/TmcutHtmlVideoStudio.vue:183` paint đúng frame start; wrap thì `reset()` + frame 0 |
| `app/components/tmcut/TmcutHtmlVideoStudio.vue:177` | `seekPreview(time)` nhận một float tùy ý | `seekFrame(frame)` — reset nhịp rồi đặt xuống frame đã kẹp trong `[0, lastPreviewFrame]` |

### 36.3 Scrub: `step="0.01"` xin ~100 thời điểm mỗi giây, lưới 30 fps chỉ có 30

Đặt nhịp vào core xong vẫn còn **một** chỗ xin thời gian ngoài lưới: thanh
*Preview time* có `step="0.01"` — tức nó post `hf:seek` cho bất kỳ bội số nào của
một phần trăm giây, trong khi lưới 30 fps chỉ có 30 điểm hợp lệ trên mỗi giây. Đo trực tiếp trên live
trước khi sửa: kéo slider tới `0.37` → composition nhận đúng `0.37`
(`0.37 × 30 = 11.1` — không phải một khung hình).

Luật mới: slider đi trên **chỉ số khung**. `app/components/tmcut/TmcutHtmlVideoStudio.vue:576`
là `:max="lastPreviewFrame"` (`durationFrames − 1`, `app/components/tmcut/TmcutHtmlVideoStudio.vue:97`)
với `step="1"` và `:value="currentPreviewFrame()"`; `@load`
(`app/components/tmcut/TmcutHtmlVideoStudio.vue:565`)
và `hf:ready` (`app/components/tmcut/TmcutHtmlVideoStudio.vue:196`)
cũng re-seek bằng frame, không bằng float. Đọc số vẫn là giây (`0.00 / 4.00s`), vì
người dùng nghĩ bằng giây; cái thay đổi là **cái được gửi sang composition**.

RED/GREEN của chân này: check 8 của
[tmcut_frame_pace.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_frame_pace.spec.ts)
pin `doesNotMatch /step="0\.01"/` và `match /:max="lastPreviewFrame"/`.
RED chạy thật: `EXIT=1`, fail ngay assertion `doesNotMatch` (log
`node_modules/.cache/tmcut-gates/f6b-scrub-red.txt`), 7 check trước đã xanh — nghĩa
là failure đến từ scrub, không từ harness. GREEN: **8/8**, `EXIT=0`
(`f6b-scrub-green.txt`).

### 36.4 Spec nhịp: 8 check, và hợp đồng cũ tiến hóa

Spec mới 152 dòng, dựng trên `createClock(fpsToRational(30))` thật (`PER = 4000`):

1. mọi vị trí là frame start — quét 0→2000 ms bước 17 ms, 2 s phải ra ~60 khung;
2. đổi rate re-arm — 1 s ở 1x đưa tới frame 30, `at(1000, 8, 30)` không nhúc nhích, `at(1125, 8, …)` ≈ 60;
3. vị trí không do nhịp sinh ra re-arm — nhảy tới frame 100 rồi +3 khung → 103, `startTicks = 100 · 4000` tại thời điểm nhảy;
4. `reset()` disarm — 4 s đứng yên không được chi tiếp vào vị trí;
5. reverse đi cùng lưới và kẹp về 0 — `at(300, -1, 60)` ≈ 51 **đúng lưới**, `at(10_000, -1, 51)` = 0;
6. jitter không đổi vị trí — `3480 ms` giao thành bước 5 ms cho cùng frame như một cú nhảy (~104 khung): vị trí đo từ neo, không cộng dồn;
7. **pin hai host**: cả composable lẫn studio phải `/createFramePace/`, không còn `/playhead\.value \+ delta|previewTime\.value \+ delta/`, không còn `/const delta = \w*[Ll]ast/`, và `elapsedTicks \* Math\.abs` không còn ở app;
8. scrub đi trên khung hình (mục 36.3).

Check 7 là lý do lượt này **gộp** luôn phần editor: nếu nhịp còn nằm trong
composable thì luật có hai bản copy và không cách nào pin được "một luật".
`tmcut_playback_pace.spec.ts` check 6 vì thế tiến hóa theo luật — vẫn hai phủ định
cũ (`playhead.value + delta`, `const delta = …`), thêm `/createFramePace/` và phủ
định `/clock\.(frameIndexAt|frameStartAt)/`: host không tự đếm, không tự đặt.

### 36.5 Live, và một cái bug không phải bug

`:4003`. Chromium **không phát frame cho tab đang đứng sau**: rAF của tab background
chỉ chạy đúng **1** callback trong 600 ms (đo: `fired: 1`, `visibilityState: 'visible'`),
nên phép thử editor đầu tiên cho kết quả "playhead đứng 00:00.00 suốt 900 ms" trong
khi video element vẫn chạy — một regression **ảo**. Bằng chứng phân biệt: cùng code
đó, khi tab được nâng lên front, rAF chạy 40/40 mẫu. Bài học ghi lại cho các lượt
sau: probe transport phải chạy trên tab front-end, và `select_page` không đủ — phải
đóng tab kia hoặc navigate tab đang hiển thị.

Số đo thật, trên tree cuối:

| Surface | Phép đo | Kết quả |
| --- | --- | --- |
| studio, play 1.2 s (starter *Kinetic title*, 1080×1920, 30 fps, composition khai báo 4.00 s) | 90 echo `hf:frame` | **0** mẫu ngoài lưới; walk liên tục 11→46 = 36 khung trong ~1.17 s. Quét cuối trên tree chốt: 89 echo / **0** ngoài lưới, `min 0 / max 119 / step 1` |
| studio, scrub | `min 0 / max 119 / step 1` | index 11 → composition nhận `0.36666666666666664` = **11/30** (trước sửa: `0.37`) |
| studio, wrap | xuất phát frame 117 | `117,118,119,0,1,2,3,4,5` — tất cả trên lưới, frame 0 re-arm chứ không cộng overshoot |
| editor, forward | 25 khung / 882 ms, sampler 40 ms | không hồi lùi (`regressed: false`), paceRatio 0.9448 — thiếu hụt là do sampler bỏ qua khung (40 ms > 33 ms), cùng dung sai một-khung-mỗi-segment đã dùng ở #35 |
| editor, `L` | 8 → 31 / 465 ms | đơn điệu tăng |
| editor, `J` | 33 → 22 / 457 ms | đơn điệu giảm, đúng khung |

Console: `/tmcut/html-video` **sạch** (chỉ `[info] <Suspense>`, hết thời hạn chờ);
`/tmcut/editor` giữ baseline đã ghi ở §31.5 — `[info] <Suspense>` + `401 (error.unauthorized) ×4`.

### 36.6 Gate

| Gate | Lệnh | Kết quả |
| --- | --- | --- |
| 1 Types | `npx nuxt typecheck` | exit 0, 0 × `error TS`; `.nuxt/eslint.config.mjs` được sinh lại **trước** gate 2 |
| 2 Lint | `npx eslint <7 file đã chạm>` (sau gate 1) | exit 0, log 0 byte |
| 3 Tests | `npx tsx tests/unit/run-all.mts --smoke` | **117/117 specs passed**, exit 0 (`f6b-smoke3.txt`) — lượt chạy **cuối**, sau mọi sửa docs, nên hai guard docs (độ dài dòng, link integrity) và 8 check nhịp đều nằm trong 117 |
| 3b Core | `npx tsc -p packages/core --noEmit` | exit 0, log 0 byte |
| 4 Live | Chromium, `/tmcut/html-video` + `/tmcut/editor` | bảng số ở 36.5 |

### 36.7 Chưa chứng minh được

- **Host Electron**: `createFramePace` chạy trong renderer của app desktop nhưng lượt này chỉ đo trên Chromium web. Đường desktop chưa được bấm Play lần nào trong slice này.
- **`renderDuration` FALLBACK 5 s** khi composition chưa kịp báo `hf:ready`: `lastPreviewFrame` tính từ số đó, nên vài trăm ms đầu, scrub cho phép tới khung mà composition sẽ không paint (nó khai báo 4 s). Không phải regression — cùng hành vi cũ — nhưng cũng chưa được đóng.
- **Wrap reset neo**: khung hình đầu sau wrap là **re-arm**, không phải tiếp tục lưới bằng overshoot. Đúng luật ("khoảng đã tiêu thì tiêu"), nhưng nghĩa là wrap có thể chậm tối đa <1 khung so với một loop đếm liên tục.
- **Đổi fps giữa lúc đang phát**: `previewClock`/`previewPace` là computed theo `fps`, nên đổi fps dựng nhịp mới và mất neo — có chủ đích (một lưới khác thì neo cũ vô nghĩa), chưa đo trên live.
- **Đảo chiều ở frame 0**: `at(10_000, -1, 51)` kẹp về 0 trong unit check 5; đường editor gọi `pause()` khi chạm 0 ([useTmcutPlayback.ts:446](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L446)) chưa được đo bằng số ở lượt này.

### 36.8 Bảo vệ working tree

Lượt này chạm **5** file code/spec —
[packages/core/src/pace.mjs](file:///D:/Applications/tm-studio/packages/core/src/pace.mjs) (mới, 111 dòng),
[index.mjs:4](file:///D:/Applications/tm-studio/packages/core/src/index.mjs#L4),
`packages/core/src/index.d.ts:2008`,
[useTmcutPlayback.ts](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts),
`app/components/tmcut/TmcutHtmlVideoStudio.vue` —
cùng **2** spec ([tmcut_frame_pace.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_frame_pace.spec.ts) mới 152 dòng,
[tmcut_playback_pace.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_playback_pace.spec.ts) check 6 tiến hóa)
và **2** file docs (file này + `docs/tmcut-v4-universal-rendering-multiplatform-roadmap.md`).
`TmcutPreviewPlayer.vue`, đường export, Project Schema v3 và Storage Upload API
không đổi một dòng nào; không binary mới, không đụng `backup/ffmpeg-engine-2026-11-03`,
không tắt rule lint nào, ADR-033 vẫn Pending.

## 37. Slice F6c — bốn surface tự hỏi "hàng nào" ngoài hai host (2026-11-05)

F3 ghi nợ **ba** bộ lọc `type ===` trong UI (§30.7). Mở đầu lượt này, grep lại
toàn bộ `app/` với mẫu predicate (`=> \w+\.type ===`) ra **bốn** chỗ, không phải
ba — và chỗ thứ tư là chỗ duy nhất mang lỗi thật.

### 37.1 Bốn chỗ, mỗi chỗ hỏi một kiểu

| Chỗ | Câu hỏi nó tự trả lời | Trước F6c |
| --- | --- | --- |
| `app/components/tmcut/TmcutExportModal.vue:535` | lane text nào bị kiểm rotation (R12) | quét **mọi** track `type === 'text'`, kể cả lane đã ẩn và lane chỉ có clip zero-length |
| [TmcutTimeline.vue:750](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutTimeline.vue#L750) | cue nào đi vào file `.srt` | `.find(tr => tr.type === 'text')` — lane text **đầu tiên**, mọi lane phía sau biến mất, `hidden` không được hỏi |
| [TmcutTimeline.vue:804](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutTimeline.vue#L804) | clip nào AutoCaptions giải âm | tự vòng qua track `video` không ẩn rồi tự so `playhead` vào `[clipStartSec, clipEndSec)` |
| `app/components/tmcut/TmcutHtmlVideoStudio.vue:348` | cue nào đổ vào biến `cues` của composition | `.filter(track => track.type === 'text')` — gồm cả lane đã ẩn |

### 37.2 Lỗi đo được của chân SRT

`.find(tr => tr.type === 'text')?.items` chỉ trả về items của **một** lane. Hai
lane phụ đề (nói cách khác: một project có caption tiếng Việt và một lane karaoke)
xuất ra `.srt` chỉ chứa lane tác giả gặp đầu tiên trong danh sách track — và một
lane đã bấm ẩn vẫn góp cue vào file, dù không khung hình nào vẽ nó. Đây là cùng
hình dạng lỗi mà G18 ghi cho hàng footage: surface thứ ba trả lời câu hỏi của
surface đầu tiên bằng cách riêng.

### 37.3 Luật: không thêm luật nào cả

Bốn chỗ này đọc lại ba câu trả lời **đã tồn tại** trong core, không module mới:

- `selectFileRows(project).overlays` — mọi lane phụ đề của cả file, đã trừ lane ẩn
  và lane không có clip nào sống được ([paintStack.mjs:140](file:///D:/Applications/tm-studio/packages/core/src/paintStack.mjs#L140));
- `selectExportTracks(project).textTracks` — chính câu trả lời đó sau chỗ join mà
  compiler export đang dùng (`app/utils/tmcut/render/clip.ts:160`),
  nên validation rotation giờ kiểm **đúng những lane file sẽ paint**, không kiểm
  danh sách track do UI tự đoán;
- `paintStackAt(project, atTicks).rows` — hàng footage **đang vẽ tại tick này**
  ([paintStack.mjs:92](file:///D:/Applications/tm-studio/packages/core/src/paintStack.mjs#L92)),
  tức clip được transcribe là clip mà người dùng đang thực sự nhìn thấy.

Host vẫn chỉ làm việc của host: cầm `trackIndex`/`clipId` nối về object mình authored.

### 37.4 Ba thay đổi hành vi, một chỗ chỉ đổi nguồn

| Chân | Hành vi đổi? | Nội dung |
| --- | --- | --- |
| SRT export | **Có, sửa lỗi** | lấy **mọi** lane overlay đang bật, theo đúng thứ tự track; lane ẩn không góp cue |
| Studio cue fill | **Có, cùng luật** | hết cảnh cue của lane đã ẩn bị đổ vào composition |
| Export rotation validation | **Có, hẹp hơn** | một lane text bị ẩn (hoặc toàn clip zero-length) không còn chặn một export mà nó không xuất hiện |
| AutoCaption nguồn clip | **Không** | code cũ đòi `playhead ∈ [clipStartSec, clipEndSec)` của một track video không ẩn — điều kiện **trùng** luật per-tick, nên đáp án cùng; F6c chỉ đổi *ai trả lời*, không đổi câu trả lời |

Chỗ cuối ghi rõ để không ai tưởng F6c sửa bug ở AutoCaption. Nó sửa một thứ khác:
khi project có **hai** hàng footage và hàng đáy đang ở khoảng trống, luật per-tick
giao hàng đang vẽ cho UI, còn vòng lặp cũ chỉ tình cờ đúng vì nó quét items của
mọi hàng không ẩn.

### 37.5 Test: check 10 của `tmcut_paint_stack.spec.ts`

Spec không thêm file; `tests/unit/tmcut_paint_stack.spec.ts:337`
pin **cả hai chiều** trên ba component: phải gọi selector core
(`selectExportTracks(...).textTracks`, `paintStackAt(`, `selectFileRows(`) và
**không** được còn một predicate dạng `x => x.type === 'video|text|audio'`.
Template ternaries (`track.type === 'video' ? icon`) **không** bị cấm, vì chúng là
chrome chứ không phải luật hàng — đó là lý do mẫu pin là dạng arrow, không phải
chuỗi `track.type ===`.

RED chạy thật: `EXIT=1`, fail ngay pin đầu tiên (`TmcutExportModal.vue must read
core's lane answer`), **9** check trước đã xanh (`f6c-red.txt`) — failure đến từ
chỗ chưa sửa, không từ harness. GREEN: **10/10**, `EXIT=0` (`f6c-green.txt`).

### 37.6 Copy tiến hóa theo luật — và vì sao nó không vào commit

`tmcut.htmlVideo.captionsFilled` nói "from the text track" (số ít) trong khi từ
lượt này nó chép từ **mọi** lane phụ đề: đổi thành "from the caption rows" / "từ
các track phụ đề" cho cả hai locale
([en.json:1776](file:///D:/Applications/tm-studio/i18n/locales/en.json#L1776),
[vi.json:1776](file:///D:/Applications/tm-studio/i18n/locales/vi.json#L1776)).

Hai file locale **không được stage** trong commit F6c: `git diff --stat` cho thấy
chúng đang mang WIP của chủ repo (key `retry`, sửa `docs` → "Documentation",
`heroTitle`/`heroSubtitle` của hai surface, cụm `systemHealth`/`authProvider`…):
`git diff --numstat` đo **19 thêm / 4 bớt** cho mỗi file, trong đó lượt này chỉ là
**một** dòng mỗi bên. Luật làm việc của repo là không commit WIP của người khác, nên
phần copy ở lại working tree và đi theo commit của chủ repo. Code đã merge vẫn đúng
với cả hai phiên bản chuỗi vì key không đổi.

### 37.7 Live, và một chỗ không đo được

`:4003`. Console **sạch** trên cả hai route đã chạm: `/tmcut/editor` giữ đúng
baseline đã ghi ở §31.5 (`[info] <Suspense>` + `401 ×4` hub hết hạn),
`/tmcut/html-video` chỉ có `[info] <Suspense>`.

Đo được: mở *Export Video* → step *Configure* render đủ duration/extent của project
thật (`00:01.05`, `1920×1080`) — tức đường `selectExportTracks` đã sửa chạy trong
renderer thật, không chỉ trong spec.

**Không** đo được trên Chromium, và không giả vờ đã đo:
- route `/tmcut/html-video` mở fresh có `currentProject === null` nên nút *Use
  timeline captions* bị disabled (`Open a project to pull its caption cues.`) —
  hành vi **có trước**, không phải regression F6c, nhưng nó chặn phép thử positive;
- SRT export và AutoCaption là đường **desktop-only** (`selectSaveFile`, `extractAudio`
  qua IPC), Chromium không chạy được;
- validation rotation cần một project có text đã xoay lệch tâm; project dev
  (`tmcut_project_default`: `text:0 items, video:2, audio:0`) không có, và lượt này
  **không** sửa dữ liệu project của người dùng để tạo tình huống.

### 37.8 Gate

| Gate | Lệnh | Kết quả |
| --- | --- | --- |
| 1 Types | `npx nuxt typecheck` | exit **0**, `grep -c "error TS"` = **0**; `.nuxt/eslint.config.mjs` sinh lại **10:42**, 28567 byte — gate 2 chạy **sau** mốc này |
| 2 Lint | `npx eslint` trên **4** file đã chạm (sau gate 1) | exit **0**, log **0 byte** (`f6c-eslint2.txt`); config **không** đổi mtime sau đó nên kết quả không stale |
| 3 Tests | `npx tsx tests/unit/run-all.mts --smoke` | **117/117 specs passed**, exit **0** (`f6c-smoke2.txt`) — lượt chạy **cuối**, sau mọi sửa docs và i18n, nên `doc_line_length`, `docs_link_integrity`, `i18n_keys` và `paint_stack` (10 check) đều thuộc số 117 |
| 3b Core | `npx tsc -p packages/core --noEmit` | exit **0**, log 0 byte — lượt này không sửa `packages/core` |
| 3c Spec mới | `npx tsx --tsconfig tsconfig.test.json tests/unit/tmcut_paint_stack.spec.ts` | RED exit 1 (check 10) → GREEN **10/10** exit 0 |
| 4 Live | Chromium, `/tmcut/editor` + `/tmcut/html-video` | mục 37.7 |

### 37.9 Chưa chứng minh

- **Ba chân đổi hành vi chỉ được chứng minh ở tầng spec + nguồn**, không bằng một
  lần bấm thật (37.7). Đặc biệt SRT: chưa có file `.srt` thật xuất ra từ project
  hai lane phụ đề.
- **Electron host** chưa chạy lượt này; AutoCaption/SRT là đường desktop nên chính
  chúng là thứ cần một phép đo CDP, và phép đo đó chưa có.
- **`handleAutoCaptions` trong cửa transition**: `painted` sẽ chứa **hai** clipId
  và `.find` lấy clip đầu tiên có `src` — chọn clip **đi ra** hay clip **đi vào** là
  quyết định chưa có test; ghi nợ, không đoán.
- **Route html-video không hydrate `currentProject`**: hoặc studio tự load, hoặc
  route phải mở project — việc của lượt khác, được ghi lại ở đây vì nó chặn một
  phép thử.

### 37.10 Bảo vệ working tree

Lượt này chạm **3** component (`app/components/tmcut/TmcutExportModal.vue`,
[TmcutTimeline.vue](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutTimeline.vue),
`app/components/tmcut/TmcutHtmlVideoStudio.vue`),
**1** spec (`tests/unit/tmcut_paint_stack.spec.ts`,
9 → 10 check, 360 dòng), **2** file docs (file này +
`docs/tmcut-v4-universal-rendering-multiplatform-roadmap.md`)
và **2** file i18n **chạm nhưng không stage** (mục 37.6). Commit F6c staged **6**
đường dẫn: ba component, một spec, hai docs.
`packages/core` không đổi một dòng; Project Schema v3 không đổi; Storage Upload API
không đổi; không binary mới, không đụng `backup/ffmpeg-engine-2026-11-03`, không tắt
rule lint nào, ADR-033 vẫn Pending.

## 38. Slice F6d — blend đi **qua** plan, và grain của file có mặt trên plate live (đo ngày 2026-11-05)

§32.7 để lại đúng hai con số, và §35.6 nhắc lại nguyên văn ("blend lấy từ plan, và grain
`overlayAnimation` trên plate live"). Lượt này đóng cả hai: mỗi chân có một số đo live,
không chân nào chỉ có spec.

### 38.1 Blend: hai counterpart viết **cùng** tên, nhưng chỉ một bên tha thứ

Bốn mode hợp lệ (`normal`, `screen`, `overlay`, `multiply`) được CSS viết y hệt cách
FFmpeg viết: `mix-blend-mode: screen` và `blend=all_mode='screen'`. Khác biệt nằm ở chỗ
xử lý khi tên **không** hợp lệ:

| Bên | Giá trị lạ | Hệ quả |
| --- | --- | --- |
| Preview (CSS) | bỏ qua, coi như `normal` | một hàng trông vẫn ổn, không ai biết |
| Export (FFmpeg) | lỗi **lúc parse filtergraph** | **cả** render chết, không phải một clip |

Chính tính bất đối xứng đó là lý do luật nằm trong core chứ không nằm ở hai chỗ đọc:
[packages/core/src/blend.mjs:19](file:///D:/Applications/tm-studio/packages/core/src/blend.mjs#L19)
là danh sách,
[blend.mjs:28](file:///D:/Applications/tm-studio/packages/core/src/blend.mjs#L28)
`blendModeOf` là bộ chuẩn hóa (absent / không phải chuỗi / không thuộc danh sách →
`normal`), và
[evaluate.mjs:294](file:///D:/Applications/tm-studio/packages/core/src/evaluate.mjs#L294)
đặt kết quả lên layer — cùng chỗ `layerFor` đã sinh effects, mask, layout. Một project
JSON bẩn vì thế không còn đường nào để làm hỏng một export.

### 38.2 Ba chỗ đọc đổi nguồn, một chỗ đổi kiểu

| Chỗ | Trước F6d | Sau F6d |
| --- | --- | --- |
| [TmcutPreviewPlayer.vue:834](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L834) | `surfaceStyle` cầm `surface.clip`, cast `(clip as { blend?: … })` | chỉ cầm `layer.blend`; **hết** một cast `as` trong đường paint |
| `app/utils/tmcut/render/video.ts:329` | `clip.raw.blend` thô, chuỗi đó đi thẳng vào filtergraph | `blendModeOf(clip.raw)` — cùng luật với layer |
| [TmcutInspector.vue:442](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutInspector.vue#L442) | `computed(() => clip.value?.blend \|\| 'normal')` — select **quảng cáo** một mode mà cả hai counterpart đều không vẽ | `computed(() => blendModeOf(clip.value))` |
| [useTmcutProject.ts](file:///D:/Applications/tm-studio/app/composables/useTmcutProject.ts) | `TmcutBlendMode = 'normal' \| 'screen' \| 'overlay' \| 'multiply'` — union thứ hai, tự khai | `TmcutBlendMode = CoreBlendMode` (alias, không còn danh sách thứ hai để lệch) |

`BLEND_OPTIONS` trong inspector vẫn là 4 nhãn UI: nó là chrome, không phải luật — và
spec check 5 khóa cả hai chiều (alias phải có, union tự khai phải **không** còn).

### 38.3 Grain: file có chuyển động thì plate phải có

Bake của export là `noise=alls=…:allf=t` — `t` là **temporal**, mỗi khung một hạt mới.
Trước lượt này plate live là một tấm **tĩnh**: hai counterpart cùng tên "grain" nhưng vẽ
hai bức ảnh khác nhau. Chênh đó nằm ở đúng một field:

- [fxPreview.ts:69](file:///D:/Applications/tm-studio/app/utils/tmcut/fxPreview.ts#L69)
  `GRAIN_MOTION = 'tmfx-grain 1.1s linear infinite'` — một định nghĩa, hai chỗ dùng;
- builder grain ([fxPreview.ts:166](file:///D:/Applications/tm-studio/app/utils/tmcut/fxPreview.ts#L166))
  tách làm hai: `overlayMotion` (chuyển động **của chính effect**, plate chạy) và
  `overlayAnimation` (tile: `tmfx-compare` reveal **cộng** motion);
- [fxPreview.ts:834](file:///D:/Applications/tm-studio/app/utils/tmcut/fxPreview.ts#L834)
  là chỗ plate chọn: `built.overlayMotion ?? built.animation`.

Vì sao **không** mang cả `tmfx-compare` sang monitor: reveal là "so sánh trước/sau của
một tile"; trên preview, hai khung hình đã ở đó rồi và một pha tan toàn màn hình sẽ bịa
ra một transition không ai authored. Check 7 của spec mới khóa đúng điều đó (plate chỉ
có `tmfx-grain`, tile vẫn có cả hai).

`vhs` cũng mang grain nhưng **không** phải `layerOverlay`
([effects.mjs:53](file:///D:/Applications/tm-studio/packages/core/src/effects.mjs#L53)/[63](file:///D:/Applications/tm-studio/packages/core/src/effects.mjs#L63)/[185](file:///D:/Applications/tm-studio/packages/core/src/effects.mjs#L185)
là ba chỗ `layerOverlay: true`: vignette, grain, letterbox), nên nó ở lại tile — và
`effectOverlay` trả `null` trước khi đọc tới animation của nó. Field thừa đã bị xóa sau
khi đo, không để lại một key không ai đọc.

### 38.4 Frame `tmfx-grain` lên CSS toàn app — và vì sao hết trùng

Plate nhận style **inline**, nên nó cần `@keyframes` sống cùng trang **không phụ thuộc
chunk của tile**. Frame vì thế dời sang
[app/assets/css/tmcut-fx.css:12](file:///D:/Applications/tm-studio/app/assets/css/tmcut-fx.css#L12),
[main.css:9](file:///D:/Applications/tm-studio/app/assets/css/main.css#L9)
`@import`; [TmcutFxThumb.vue:259](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutFxThumb.vue#L259)
giữ một comment nói rõ vì sao nó **không** còn ở tile (định nghĩa hai lần thì ai nạp
muộn hơn thắng).

Số của frame cũng đổi có lý do: tile cũ đi `6px -4px`, nhưng `background-size` của grain
là `3px`/`4px`/`6px` tùy `size`, và `6px -4px` chỉ kín với cell 3px. App-wide dùng
`12px -12px` — bội số của **cả ba** cell, nên loop kín mít với mọi độ hạt, và trạng thái
cuối trùng trạng thái đầu (điều này còn có hệ quả ở mục 38.7).

### 38.5 Test: một spec mới, một check cũ viết lại

`tests/unit/tmcut_blend_grain.spec.ts`
(201 dòng, **8** check): danh sách mode + chuẩn hóa của core; layer mang `blend`;
preview hỏi core chứ không hỏi clip authored (cả hai chiều: phải có `layer.blend`, phải
**không** còn `(clip as { blend`); exporter cùng luật; app không khai union thứ hai;
plate grain chạy và plate vignette/letterbox **không** chạy; plate không mang reveal;
mọi motion của plate phải có `@keyframes` **toàn app** — check cuối quét
`EFFECT_REGISTRY` lấy đúng các `layerOverlay`, rồi đối chiếu tên với các stylesheet mà
`main.css` import, nên một frame chỉ có trong tile là fail, không phải pass.

RED chạy thật là `SyntaxError: … does not provide an export named 'BLEND_MODES'`
(`f6d-red1.txt`) — với một luật **mới hoàn toàn** thì RED là fail ở chính pin đầu tiên,
không phải fail giả vì harness. GREEN đầu tiên **7/8**: check 8 fail vì bug của **chính
spec** (destructure một mảng string nên `names` rỗng), và guard chống-vacuous của nó bắt
đúng; sửa spec, **không** nới assertion → **8/8** (`f6d-green2.txt`).
[tmcut_fx_preview.spec.ts:50](file:///D:/Applications/tm-studio/tests/unit/tmcut_fx_preview.spec.ts#L50)
thêm `globalKeyframeNames()` và check 6 đổi thành "tile **hoặc** app-wide", nay còn pin
thêm rằng một tên đã có toàn app thì **không** được xuất hiện lại trong tile
([:374](file:///D:/Applications/tm-studio/tests/unit/tmcut_fx_preview.spec.ts#L374)) →
**24/24**.

### 38.6 Live (`:4003`, `/tmcut/editor`, project `tmcut_project_default`: 2 clip trên `t-video-1`, 1920×1080@30, 00:01.05)

Đường đi là **handler thật của app** (`handleAddEffect('grain')`, `handleBlendUpdate('screen')`,
rồi `undo()` hai lần), không phải DOM tự dựng.

| Chân | Số đo |
| --- | --- |
| Frame nằm ở đâu | stylesheet `main.css?direct`: **66** `@keyframes`, có `tmfx-grain` với `0%{background-position:0px 0px} 100%{background-position:12px -12px}`; sheet của tile: **44** tên và **không** có `tmfx-grain` (45 → 44, đúng một dòng dời đi) |
| Plate chạy thật | `animation-name: tmfx-grain`, `1.1s`, `linear`, `infinite`, `background-size: 3px 3px`; `background-position` **2.15474 → 5.97277 → 2.88303 px** tại t0/+350ms/+1150ms; `getAnimations()` → `playState: running`, `currentTime 24398 ms` |
| Blend đúng chỗ | group footage (`… transition-transform duration-75`) tính ra `mix-blend-mode: screen`; `<video>` bên trong vẫn `normal` → blend áp cho **cả nhóm** (media + plate), đúng như export composite nhóm rồi mới transform |
| Hàng không vẽ | surface thứ hai (`display: none`) mang cùng plate style nhưng `getAnimations()` trả `[]` — Chromium không tạo animation object cho phần tử không render, nên hàng đang tắt không tốn frame |
| Tile không hồi quy | tile grain khi **đã vào viewport** tính ra `animation-name: "tmfx-compare, tmfx-grain"`, cả hai `running`, `background-position` **11.5371 → 4.99141 px** trong 500 ms — frame mới toàn app vẫn điều khiển tile |
| Khôi phục | sau 2 lần `undo`: `effects = [vignette]`, `blend = undefined`, **0** plate grain, **0** group có blend, inspector đọc `normal` |
| Console | `/tmcut/editor`: `[info] <Suspense>` + `401 ×4` (đúng baseline §31.5); `/tmcut/html-video` và `/tmcut`: chỉ `[info] <Suspense>` |

### 38.7 Reduced motion: suy từ stylesheet, **không** phải từ emulation

[main.css:237-251](file:///D:/Applications/tm-studio/app/assets/css/main.css#L237)
khoanh `*` trong `@media (prefers-reduced-motion: reduce)` bằng
`animation-duration: 0.01ms !important; animation-iteration-count: 1 !important`, nên
plate nằm trong ngân sách chuyển động chung của app — người tắt chuyển động sẽ **không**
thấy hạt chạy. Điểm đáng nói là trạng thái đậu: 100% là `12px -12px`, tức đúng **4 ô**
của lattice 3px (và 3 ô của 4px, 2 ô của 6px), nên hình cuối **giống hệt** hình đầu —
không có một cái nhảy khi animation kết thúc. Chưa bật được cờ đó live: `emulate` của
devtools không có feature `prefers-reduced-motion`, và `matchMedia(...).matches` trên
máy đo là `false`.

### 38.8 Gate

| Gate | Lệnh | Kết quả |
| --- | --- | --- |
| 1 Types | `npx nuxt typecheck` | exit **0**, `grep -c "error TS"` = **0**; `.nuxt/eslint.config.mjs` sinh lại **11:26**, 28567 byte (lượt **11:06** đã chạy trước, nhưng code đổi sau đó nên gate 2 chạy lại) |
| 2 Lint | `npx eslint` trên **12** file đã chạm (sau gate 1) | lần 1 exit **1** với 2 lỗi **tự gây** (`no-useless-escape` trong regex của spec, và một parse error vì hai `const` bị nối thành một dòng ở `tmcut_fx_preview.spec.ts:61`); sửa xong exit **0**, log **0 byte** (`f6d-eslint3.txt`, chạy sau lần sinh config **11:26**) |
| 3 Tests | `npx tsx tests/unit/run-all.mts --smoke` | **118/118 specs passed**, exit **0** (`f6d-smoke3.txt`) — lượt chạy **cuối**, sau mọi sửa docs. Lượt trước đó **116/118** vì **hai gate docs của repo** bắt đúng lỗi của lượt này: `doc_line_length` (một bullet 1398 ký tự → **tách**, không nới trần) và `doc_table_shape` (một pipe đôi trong ô bảng chưa escape, sửa thành dạng escape) |
| 3b Core | `npx tsc -p packages/core --noEmit` | exit **0**, log 0 byte (`f6d-core-tsc.txt`) |
| 3c Spec mới | `npx tsx --tsconfig tsconfig.test.json tests/unit/tmcut_blend_grain.spec.ts` | RED (thiếu export) → 7/8 → **8/8** exit 0; `tmcut_fx_preview.spec.ts` **24/24** |
| 4 Live | Chromium, `/tmcut/editor` + `/tmcut/html-video` + `/tmcut` | mục 38.6 |

### 38.9 Chưa chứng minh

- **Không có pixel.** Chưa render một file nào trong lượt này: `blend=all_mode='screen'`
  được chứng minh ở tầng spec (check 4), còn "hai hàng `screen` cho ra cùng một ảnh ở
  preview và trong file" vẫn thuộc fixture điểm ảnh của tiêu chí đóng F.
- **Chỉ `screen` được đo live**; `overlay`/`multiply` đi qua đúng một dòng code và cùng
  một luật, nhưng không có số đo riêng.
- **Electron host** chưa chạy lượt này.
- **Reduced motion** chỉ suy từ stylesheet (38.7), chưa phải một phép emulation.
- **Effect thuần chuyển động** (`shake`, `rgb`, `slide-ghost`) vẫn **không** có mặt live:
  plate chỉ tiêu `filter`/`transform`/`overlay`, nên motion của riêng chúng vẫn dừng ở
  tile. Đây là **nợ còn lại**, không phải thứ §32.7 ghi.

### 38.10 Bảo vệ working tree

Lượt này chạm **4** file core ([blend.mjs](file:///D:/Applications/tm-studio/packages/core/src/blend.mjs) mới,
[index.mjs](file:///D:/Applications/tm-studio/packages/core/src/index.mjs),
[evaluate.mjs](file:///D:/Applications/tm-studio/packages/core/src/evaluate.mjs),
`packages/core/src/index.d.ts`),
**6** file app ([TmcutPreviewPlayer.vue](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue),
[TmcutInspector.vue](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutInspector.vue),
[TmcutFxThumb.vue](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutFxThumb.vue),
[useTmcutProject.ts](file:///D:/Applications/tm-studio/app/composables/useTmcutProject.ts),
`app/utils/tmcut/render/video.ts`,
[fxPreview.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/fxPreview.ts)),
**2** file CSS ([tmcut-fx.css](file:///D:/Applications/tm-studio/app/assets/css/tmcut-fx.css) mới,
[main.css](file:///D:/Applications/tm-studio/app/assets/css/main.css)),
**2** spec (`tests/unit/tmcut_blend_grain.spec.ts` mới,
[tmcut_fx_preview.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_fx_preview.spec.ts))
và **2** file docs. Khác F6c, lần này `packages/core` **có** đổi — vẫn chỉ là thêm luật,
không sửa luật cũ. Project Schema v3 không đổi; Storage Upload API không đổi; không
binary mới, không đụng `backup/ffmpeg-engine-2026-11-03`, không tắt rule lint nào,
ADR-033 vẫn Pending. Working tree còn **69** mục WIP của chủ repo, không mục nào được
stage hộ.

## 39. Slice F7 — chữ vẽ từ **layer** của core, không đọc lại clip (đo ngày 2026-11-05)

F2b và F4 đã buộc footage đi qua plan. Text thì chưa: nó vẫn là **câu trả lời thứ ba**.
`activeTextClips` đi đúng qua các slot overlay của plan, lấy clip authored rồi **vứt layer
đi**, và [TmcutPreviewPlayer.vue](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue) tự tính lại
mọi con số trong DOM.

### 39.1 Bốn chỗ tự tính — và một chỗ đã thật sự lệch

| Cái | Export | Preview trước F7 (DOM tự tính) |
| --- | --- | --- |
| vị trí / scale / opacity | `layer.transform`, `layer.opacity` ([evaluate.mjs:274](file:///D:/Applications/tm-studio/packages/core/src/evaluate.mjs#L274)) | `evalKeyframe(textClip, 'x'…)` bốn lần, rồi `textClip.scale / 100`, `textClip.opacity / 100` |
| in/out animation | `text.animation` sinh ngay trong evaluator ([evaluate.mjs:223](file:///D:/Applications/tm-studio/packages/core/src/evaluate.mjs#L223)) | `textAnimationAt(textClip, …)` gọi lại từ DOM |
| độ dài cửa sổ animation | `durationTicks` của evaluator | `clipDurationTicks({ in, out, speed })` rồi `Math.max(TICKS_PER_SECOND / 20, …)` tự chế |
| màu shadow / stroke / box | `clip.shadowColor\|\|'black'` (`app/utils/tmcut/render/text.ts:133`) | `textClip.shadowColor\|\|'rgba(0, 0, 0, 0.85)'` |

Ba hàng đầu chỉ **sai tiềm năng**: cùng luật, hai chỗ viết. Hàng thứ tư thì đã khác thật —
export lấy `black` (alpha chỉ nhân thêm `@…` khi clip < 100%, `app/utils/tmcut/render/text.ts:126`),
DOM lấy `rgba(0, 0, 0, 0.85)` (85% luôn luôn). F7 **không** sửa cái default đó: một bên là
filter string của project cũ mà golden spec đang khóa byte-identical, một bên là CSS đang
render — đó là một quyết định parity chứ không phải một dọn nguồn, nên nó nằm lại ở §39.7
như một nợ **đã đo**, không phải một khác biệt bị giấu.

Cái F7 đổi là **nguồn của giá trị authored**: [evaluate.mjs:203](file:///D:/Applications/tm-studio/packages/core/src/evaluate.mjs#L203)
`textOf` nay trả `shadowColor` / `strokeColor` / `bgColor` lên layer
([evaluate.mjs:216](file:///D:/Applications/tm-studio/packages/core/src/evaluate.mjs#L216)), `null` khi không authored — core
không bịa default, và DOM chỉ còn việc áp preview scale. Kiểu
`packages/core/src/index.d.ts:1829` mang đúng ba field đó.

### 39.2 Ba chỗ đổi

| Chỗ | Trước F7 | Sau F7 |
| --- | --- | --- |
| [useTmcutPlayback.ts:25](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L25) | `activeTextClips`: slot → clip, layer bị bỏ | kiểu `TextSurface { clip, layer }` + [activeTextSurfaces:265](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L265) giữ **layer theo reference**, giống `PaintSurface` đã quy ước từ F2a |
| [TmcutPreviewPlayer.vue:889](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L889) | chữ ký cấu trúc tự khai **27** field của clip, `evalKeyframe` ×4, `textAnimationAt`, `clipDurationTicks` | `textOverlayStyle(surface: TextSurface)` đọc `layer.text` / `layer.transform` / `layer.opacity` / `layer.mask`; **cả bốn lời gọi kia biến mất khỏi đường paint** |
| [TmcutPreviewPlayer.vue:2046](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L2046) | `v-for="textClip in activeTextClips"` | `v-for="surface in activeTextSurfaces"`, và chữ được vẽ là [`surface.layer.text?.content`](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L2057) |

Scale thành `transform.scaleX/scaleY` nhân `animation.scale` (core đã đổi `%` → hệ số),
nên DOM không còn phép chia `/ 100` nào. Opacity thành `layer.opacity * animation.opacity`.

### 39.3 Test: sáu check mới, và một guard phải đổi theo **tên**

[tmcut_text_layer.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_text_layer.spec.ts) (6 check, 158 dòng): 1–2
khóa luật core (màu authored phải lên layer; không authored thì phải `null` — DOM không được
bịa default), 3–4 khóa composable (layer đi theo reference; một keyframe `x`/`opacity` tới
surface **qua layer**, không qua clip), 5–6 là pin nguồn: body của `textOverlayStyle` không
còn `evalKeyframe(`, `textAnimationAt(`, `clipDurationTicks(`, và template loop đúng
`activeTextSurfaces`.

Check 1–2 tác nghiệp qua `updateClip` (đường Inspector), **không** qua `addClipToTrack`: store
dựng `newItem` từ một danh sách field cố định ([useTmcutProject.ts:855](file:///D:/Applications/tm-studio/app/composables/useTmcutProject.ts#L855))
và danh sách đó không mang ba màu text. Spec ghi thẳng lý do ngay cạnh lệnh tác nghiệp — đó
là một phát hiện, không phải thứ được phép im (nợ ở §39.7).

Gate 3 lần đầu **FAIL 118/119** vì `tests/unit/tmcut_text_style.spec.ts:129`:
guard F2 pin nguyên văn chuỗi `textClip.fontSize \|\| DEFAULT_TEXT_FONT_SIZE`, và refactor đổi
tên binding. Hai assertion **tiêu cực** (`no `\|\| 36``, `no `\|\| '#ffffff'``) giữ nguyên, assertion
mới thay pin tên cũ bằng `const text = layer.text` — ý định mà guard bảo vệ ("fallback là hằng
của core, đặt trên chữ core đã trả lời") còn nguyên, không nới.

### 39.4 Đo live (Chromium :4003, `+ Add Text` thật trên UI)

Overlay đầu tiên có `font-size: 12.3594px`; clip caption authored `fontSize 42`, suy ra preview
scale `12.3594 / 42 = 0.294271`. Bật Shadow + Outline và đổi màu sang `#3aa0ff`:

| Trường | DOM đo được | Core nói gì | Khớp |
| --- | --- | --- | --- |
| `color` | `rgb(58, 160, 255)` | `layer.text.color` = authored | có |
| `text-shadow` | `rgba(0, 0, 0, 0.85) 0.882812px` | `textShadowOffset(42) = 3` × `0.294271` = `0.882814` | có |
| `-webkit-text-stroke` | `0.588542px rgba(0, 0, 0, 0.85)` | `textStrokeWidth(42) = 2` × `0.294271` = `0.588543` | có |
| `background` | không có | `layer.text.bgColor = null` | có — DOM không bịa plate |

Lệch 2e-6 px là CSS làm tròn, không phải hai luật. Undo ×4 trả workspace về "Untitled Project"
(0 overlay) trước khi rời route, nên lượt QA không để lại project rác.

### 39.5 Gate

| Gate | Lệnh | Kết quả |
| --- | --- | --- |
| 1 Typecheck | `npx nuxt typecheck` | PASS — exit 0, 0 × `error TS`. `\.nuxt/eslint.config.mjs` regenerate **3** lần (12:07, 12:09, 12:14, 28581 B), lint chạy lại sau mỗi lần |
| 2 Lint | `npx eslint` trên **8** file đã chạm, **sau** gate 1 | PASS exit 0. Lần đầu FAIL 4 lỗi: ba import chết (`textAnimationAt`, `TICKS_PER_SECOND`, `TmcutTextAnimationType`) refactor để lại + một biến không dùng trong spec — đã xoá, không tắt rule nào |
| 3 Tests | `npx tsx tests/unit/run-all.mts --smoke` | PASS **119/119**, exit 0 (118 trước lượt này; spec mới = +1). `npx tsc -p packages/core --noEmit` exit 0; `node --test packages/core/test/*.test.mjs` **679/679**, 0 fail |
| 4 Live | Chromium **:4003**, `list_pages` trước | PASS có ghi nợ — `/tmcut` **0** lỗi; `/tmcut/editor` đúng baseline §31.5 (`[info] <Suspense>` + `401` ×4, `list_network_requests` quy cả 4 cho `GET /api/v1/ai/relay/catalog`); số đo §39.4 |
| 5 Docs | §39 + bullets F7 trong roadmap, xoá scratch | PASS |

### 39.6 Vì sao đây là chỗ cuối của "một composite path" phía DOM

Yêu cầu 3 và 7 của slice F nói cùng một điều: **một** evaluator trả lời cho **cả** hai host.
Footage xong từ F2b/F4, blend + grain xong ở F6d, nhịp playhead xong ở F6e/F6b. Text là bề
mặt DOM cuối cùng còn tự đọc clip. Sau lượt này, muốn biết một caption trông thế nào ở tick
T thì chỉ còn một đường: hỏi `evaluateTimeline`.

### 39.7 Chưa chứng minh / nợ ghi lại

- **Default màu shadow-stroke vẫn lệch** (§39.1). Core là nguồn của giá trị *authored*, chưa
  phải nguồn của *default*. Đóng nó nghĩa là đổi filter string của project cũ **hoặc** đổi
  look của preview — cần một quyết định parity có test, không phải một refactor nhân tiện.
- **Whitelist của store**: `addClipToTrack` ([useTmcutProject.ts:855](file:///D:/Applications/tm-studio/app/composables/useTmcutProject.ts#L855))
  chỉ dựng `newItem` từ danh sách field cố định, nên ba màu text không đi qua đường đó.
  Inspector dùng `updateClip` nên UI không hỏng, nhưng code khác thêm caption *kèm* màu sẽ
  âm thầm rơi field. Chưa sửa vì đây là luật authoring, không phải luật paint.
- **Pixel preview-vs-export cho nhiều layer** (footage + text + shape cùng khung) vẫn chưa có
  fixture — đó là F8 (#134).
- `TmcutFxThumb` cho caption (yêu cầu 4) chưa đo lại sau khi layer mang màu.
- Route `/tmcut/editor` cần project có caption thật để đo trên **nhiều** surface cùng lúc;
  lượt này đo một surface rồi trả lại workspace.

### 39.8 Working tree

Lượt này chạm **2** file core ([evaluate.mjs](file:///D:/Applications/tm-studio/packages/core/src/evaluate.mjs),
`packages/core/src/index.d.ts`), **2** file app
([useTmcutPlayback.ts](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts),
[TmcutPreviewPlayer.vue](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue)), **4** spec
([tmcut_text_layer.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_text_layer.spec.ts) mới,
`tests/unit/tmcut_text_style.spec.ts`,
[tmcut_preview_boundary.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_preview_boundary.spec.ts),
[tmcut_frame_scheduler.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_frame_scheduler.spec.ts)) và **2** file docs.
Không sửa luật core cũ — chỉ thêm field. Project Schema v3 không đổi; Storage Upload API
không đổi; không binary mới, không đụng `backup/ffmpeg-engine-2026-11-03`, không tắt rule lint
nào, ADR-033 vẫn Pending. Working tree còn **56** mục WIP của chủ repo (39 `M`, 20 `??`, 5 `D`),
không mục nào được stage hộ.

## 40. Slice F8 — fixture pixel "plan dự đoán file", và runner phải gọi một gate bị bỏ là SKIP (đo ngày 2026-11-05)

§39.7 để lại đúng một dòng: *pixel preview-vs-export cho nhiều layer vẫn chưa có fixture — đó
là F8 (#134)*. Lượt này đóng nó, và đóng luôn một lỗi nằm ở **chỗ báo cáo** chứ không ở chỗ
render: `run-all.mts` quyết định PASS chỉ từ `res.status === 0`, nên một spec bail vì thiếu
FFmpeg cũng được tính là đã đo.

### 40.1 Câu hỏi mà mọi gate trước còn thiếu

Các gate trước so hai host bằng **từ vựng của từng host**: paint-stack
(`tests/unit/tmcut_export_paint_stack.spec.ts:256`)
so tập row của `selectPaintRows` với các expression `enable` mà compiler phát ra; các layer
spec so những con số DOM đọc. Chưa gate nào hỏi câu mà một người xem sẽ hỏi: *lấy đúng câu trả
lời preview nhận ở từng khung, tự tay composite nó, có ra cái màu mà file thật đang chứa
không?* Trả lời được câu đó thì "cùng evaluator" không còn là một tuyên bố về import — nó là
một con số pixel.

### 40.2 Project, model và một guard trên chính spec

Fixture mới: `tests/unit/tmcut_preview_export_pixel_parity.spec.ts`,
canvas 128×72 @ 30 fps, nền `#102030`, bốn bề mặt:

| Row | Clip | Cửa sổ | Cái nó khóa trong file |
| --- | --- | --- | --- |
| `v1` | `a`, plate xanh dương | 0–3 s, opaque | nền; sau 3 s bus `tpad` = màu canvas |
| `v2` | `b`, plate đỏ | 1–3 s, `opacity: 50` | một layer **nửa trong** phải pha đúng tỉ lệ plan nói |
| `v3` | `c`, plate xanh lá | 2–4 s, opacity **keyframed 0 → 100** trong 1 s đầu | boundary của keyframe, và ADR-018 ở đầu cửa sổ |
| `t1` | `cap` "ABCD 0123" | 1.5–2.5 s | caption hiện trên **đúng** các khung plan gọi |

Kỳ vọng là `tests/unit/tmcut_preview_export_pixel_parity.spec.ts:180`:
bắt đầu từ màu canvas, đi theo **slot order** của `compositePlan`, mỗi footage slot pha
`plate × slot.layer.opacity`. Nó không đọc field authored nào, không có bảng màu tra theo frame
index, và không lấy gì từ render. Check 3
(`tests/unit/tmcut_preview_export_pixel_parity.spec.ts:343`)
là guard **trên chính spec này**: tách thân `modelAt` bằng regex và pin nó chỉ được đọc
`compositePlan(evaluateTimeline` và `slot.layer.opacity` — để một lượt sau không thể âm thầm
tính lại kỳ vọng từ project rồi gọi đó là parity.

Sáu check: hai **model** (cửa sổ `drawtext` == các khung plan gọi caption; kỳ vọng phải **biến
thiên** theo khung), một **guard** (như trên), ba **pixel** (file thật khớp kỳ vọng trên mọi
khung; từng khung boundary gọi tên một; caption có mực trên đúng số khung plan nói).

### 40.3 Số đo (binary trong `resources/`, 2026-11-05)

| Cái | Đo được |
| --- | --- |
| Sample / lệch lớn nhất | **480** sample (120 khung × 4 góc), lệch lớn nhất **5** trên trần 12 |
| Số màu distinct của kỳ vọng | **32** trên 120 khung — 30 khung ramp + 3 vùng phẳng + 1 |
| Boundary | 29 = xanh dương thuần; 30 = `mix(50 %)`; 60 = **vẫn** `mix(50 %)` (row mới vào ở opacity 0); 89 = ramp `29/30`; 90 = xanh lá thuần và base đã kết thúc; 119 = xanh lá |
| Caption | ink ≥ 30 px trên đúng **30** khung plan gọi; **0** px ở mọi khung khác |
| `MODEL_TOL = 12` | đo được chứ không đoán: plate phẳng drift 3 qua yuv420p, một pha 50 % drift ≤ 8 (overlay trộn trong YUV trong khi kỳ vọng trộn trong RGB) |

### 40.4 Falsification — fixture có cắn thật

Một fixture sinh ra đã xanh tốt không phải là chứng cứ, nên nó được làm hỏng hai lần trước khi
được tin:

| Mutation | Kết quả |
| --- | --- |
| tráo `PLATE.b ↔ PLATE.c` (plate nào mang màu nào) | check 4 **FAIL** ở frame 30: `got [125,52,107], want within 12 of [15,145,150]` |
| `slots.slice().reverse()` trong `modelAt` | check 2 sập còn **2** màu distinct — layer xanh dương opaque bị đẩy lên trên cùng, nghĩa là **thứ tự paint được đo thật**, không phải chỉ được nêu |

Cả hai mutation đã revert; chạy lại với file ở trạng thái commit thì 6/6 PASS và chính là các số
ở §40.3.

### 40.5 Runner: một gate bị bỏ không được gọi là PASS

Đo trước lượt này: trên host không có FFmpeg, `run-all.mts` in `PASS tmcut_render_parity.spec.ts`
với tail **rỗng**, rồi kết luận `119/119 specs passed` dù không một pixel nào được so.
[helpers/spec_status.ts:34](file:///D:/Applications/tm-studio/tests/unit/helpers/spec_status.ts#L34)
là luật mới, và phân biệt không phải skip/không-skip mà là **bao nhiêu đã chạy**:

| Trạng thái | Nghĩa | Ví dụ đo thật |
| --- | --- | --- |
| `SKIP` | spec bail, không measure gì | `tmcut_zza_skipprobe` (probe tạm, đã xoá) in `SKIP  scratch bail: no FFmpeg binary (probe only)` |
| `PARTIAL` | spec chạy hết check, **một gate bên trong** bị bỏ | `tmcut_export_paint_stack`: graph checks vẫn chạy, pixel gate SKIP |
| `PASS` | mọi thứ spec đo được trên host này đã đo | 122 spec trên máy này, kể cả chính guard charset ở §40.9 |
| `FAIL` | outrank **tất cả**, kể cả một dòng SKIP | một spec skip rồi fail vẫn là fail |

Runner giờ chỉ gọi helper ([run-all.mts:41](file:///D:/Applications/tm-studio/tests/unit/run-all.mts#L41))
và in summary qua `summarize`
([:55](file:///D:/Applications/tm-studio/tests/unit/run-all.mts#L55)), nên dòng trên host không
FFmpeg là `117/119 specs passed  (1 spec skipped, 1 spec partial)` — đo bằng hai spec probe tạm,
đã xoá ngay sau khi in ra ba dòng đó. Guard
[tmcut_runner_status.spec.ts:89](file:///D:/Applications/tm-studio/tests/unit/tmcut_runner_status.spec.ts#L89)
liệt kê **9** spec có thể bail; spec nào mất dòng `SKIP` ở đầu dòng thì chính guard đó FAIL.

Một chỗ đã sửa luôn vì đúng luật này: `tests/unit/tmcut_fx_catalog.spec.ts:201`
trước in `   SKIPPED: no FFmpeg binary …` ở **cột 3**, nên `specStatus` (key vào đầu dòng) không
thấy gì và gate xfade-name ẩn trong một chữ PASS. Nay nó in `SKIP  the xfade-name gate: …` ở cột 0.
Trên máy này binary có thật nên dòng đó không in, và suite vẫn 121/121.

### 40.6 Gate

| Gate | Lệnh | Kết quả | Chứng cứ |
| --- | --- | --- | --- |
| 1 Types | `npx nuxt typecheck` | PASS | exit 0, 0 × `error TS`; `.nuxt/eslint.config.mjs` regenerate 13:03 (28581 B) |
| 2 Lint | `npx eslint <6 file>` sau gate 1 | PASS | lượt 1 FAIL 1 (`@stylistic/eol-last` trên spec mới) → `--fix` đúng một file, thêm đúng newline cuối; lượt 2 và lượt chốt (thêm guard charset) exit 0 |
| 3 Tests | `npx tsx tests/unit/run-all.mts --smoke` | PASS | **122/122 specs passed**, exit 0, không dòng `FAIL`/`SKIP`/`PARTIAL` nào trên host có FFmpeg và có font hệ thống |
| 3a Test tsconfig | `npx tsc -p tsconfig.test.json --noEmit` | BLOCKED | TS5101 ngay `tsconfig.test.json:5` (`baseUrl` deprecated) làm run dừng trước khi đọc bất kỳ file nào — đây là nợ của config, không phải của lượt này. Cách duy nhất để nó chạy là thêm `ignoreDeprecations`, tức tắt rule cho xanh, nên không dùng |
| 3b Core | `npx tsc -p packages/core --noEmit` + `node --test packages/core/test/*.test.mjs` | PASS | exit 0 và **679/679** |
| 4 Live | — | N/A | lượt này chỉ chạm `tests/**`; không `app/**`, không i18n, không CSS |
| 5 Docs | §40 + roadmap F8, scratch đã xoá | PASS | `.golden-render-parity-*` không còn; không dòng SKIP nào bị sinh ra vì binary và font đều có thật |

### 40.7 Chưa chứng minh / nợ

- **Kỳ vọng là màu phẳng, không phải cả khung.** Fixture so 4 góc và đếm ink của caption; nó
  **không** so transform / crop / mask / effect khi nhiều layer chạy cùng lúc. Những luật đó
  mới chỉ có spec graph (F4, F4b), chưa có pixel do plan sinh.
- **Transition chưa vào fixture.** Plan có `role: 'outgoing'`, nhưng export vẽ xfade bằng một
  filter `xfade` chứ không bằng hai layer overlay, nên composite theo plan **không** tái tạo
  được cửa sổ đó. Cần fixture riêng — và đó là chỗ H/I (engine WebCodecs paint theo plan) sẽ
  phải trả lời, không phải F.
- **Yêu cầu 4 và 8 của slice F vẫn mở**: `TmcutFxThumb` chưa được đo lại theo Effect Definition,
  resource lifecycle (VideoFrame / ImageBitmap / texture / object URL / worker) và huỷ request
  stale chưa có check. Vì vậy **F (#103) chưa exit** — F8 chỉ đóng req 7 (first/mid/last frame +
  transition & keyframe boundary) và req 3 (preview T dùng đúng `evaluateTimeline`).
- Default màu shadow/stroke (§39.1) và whitelist `addClipToTrack` (§39.7) còn nguyên như đã ghi.
- Fixture chạy bằng binary trong `resources/` trên Windows; **chưa** đo trên app Electron đóng gói.

### 40.8 Working tree

Lượt này chạm **6** file test — 4 mới
([spec_status.ts](file:///D:/Applications/tm-studio/tests/unit/helpers/spec_status.ts),
[tmcut_runner_status.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_runner_status.spec.ts),
`tests/unit/tmcut_preview_export_pixel_parity.spec.ts`,
[tmcut_doc_charset.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_doc_charset.spec.ts))
và 2 sửa
([run-all.mts](file:///D:/Applications/tm-studio/tests/unit/run-all.mts),
`tests/unit/tmcut_fx_catalog.spec.ts`) —
cùng **2** file docs. **Không** sửa code production nào, không thêm luật core nào.
Project Schema v3 không đổi; Storage Upload API không đổi; không binary mới, không đụng
`backup/ffmpeg-engine-2026-11-03`, không tắt rule lint, ADR-033 vẫn Pending. Working tree còn
**63** mục (36 `M`, 22 `??`, 5 `D`), gồm 4 spec mới và docs của lượt này; phần WIP của chủ repo
không mục nào được stage hộ. Hai spec probe tạm dùng để chứng minh SKIP/PARTIAL đã bị xoá trước
khi commit.
Ba chữ Hán lọt vào §28/§33 của chính tài liệu này đã được sửa; vì sao
chúng sống sót qua mọi gate và guard nào chặn chúng thì ở §40.9.

### 40.9 Guard charset — các gate đếm được ký tự, nhưng không cái nào đọc được chữ

Ba ký tự Hán đã được commit vào giữa câu tiếng Việt của chính tài liệu này (`:1705`, `:1974`,
`:1979`): một thay cho "downstream", một thay cho "khoảng trống", một thay cho "chớp sáng". Chúng
sống sót vì **không gate nào nhìn loại ký tự**: guard line-length đếm số ký tự trên dòng, guard
table-shape đếm dấu `|`, guard link integrity kiểm tiền tố `file:///`, guard citations kiểm đường
dẫn. Một script ngoại lai vô hình với cả năm lần chạy, nên lỗi này đòi thêm một guard chứ không
phải sửa cách chép.

| Cái | Số đo |
| --- | --- |
| Corpus | `docs/**`, `packages/core/**`, `app/composables/**`, `app/utils/tmcut/**`, `tests/unit/**`, `i18n/locales/**` = **401** file `.md/.ts/.mts/.mjs/.json` (19 markdown), ngoại trừ chính spec vì nó phải trích ranges |
| Hit trước khi sửa | **1** dòng — chính dòng §40.8 mới trích ba ký tự đó; ba ký tự gốc đã thay bằng tiếng Việt trong cùng lượt |
| RED → GREEN | viết guard trước: `pass 2 / fail 1` vì dòng trích; sửa dòng đó thành mô tả bằng lời → 3/3 |
| Falsification | chèn một ký tự Hán vào heading §40.8 → `pass 2 / fail 1`; phục hồi byte-identical (md5 đầu/cuối `95eafc4d…`) → 3/3 |
| Guard bắt được lỗi mới | Chính lượt sửa này sinh thêm một lỗi cùng loại: ghi chú §40.9 chèn U+2E93 (một radical CJK) trước dấu «**scope**». Guard bắt được ngay lần chạy kế tiếp, tức nó đã làm việc trước cả khi được commit |
| Phạm vi | Hán U+4E00–9FFF + mở rộng U+3400–4DBF + tương thích U+F900–FAFF, Hiragana/Katakana, Hangul, dấu câu CJK — **không** chạm Latin Extended Additional (U+1EA0–1EF9), nơi dấu thanh tiếng Việt sống |

Guard ở [tmcut_doc_charset.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_doc_charset.spec.ts); nó cũng
kiểm các con số của chính nó («scope còn thật») và trình bày bằng ba cụm từ tiếng Việt đã thay,
nên một lần revert lại chữ Hán làm nó cháy.

## 41. Slice F9 — một tuyên bố `exact` phải được đo bằng filter file thật chạy (đo ngày 2026-11-05)

§40.7 để lại hai dòng mở: *yêu cầu 4 (`TmcutFxThumb` chưa được đo lại theo Effect Definition) và
yêu cầu 8 (resource lifecycle)*. Lượt này đóng yêu cầu 4; yêu cầu 8 là F10 (#136).

### 41.1 Câu hỏi mà chưa gate nào hỏi

`preview.fidelity` trong registry không phải trang trí: [TmcutFxThumb.vue:119](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutFxThumb.vue#L119)
biến nó thành badge, và `exact` là cái badge nói với người dựng phim «cái bạn thấy là cái file
render». Trước lượt này tuyên bố đó là **một từ tự viết**: mặt CSS sống ở
[fxPreview.ts:818](file:///D:/Applications/tm-studio/app/utils/tmcut/fxPreview.ts#L818), mặt export sống ở
`buildFfmpegEffectFilters` (khi đó nằm trong `packages/core/src/effects.mjs`; slice J đã xoá nó — §55),
và **không một spec nào đặt hai cái cạnh nhau**. Đây đúng là lớp lỗi review từng file không thấy,
vì mỗi nửa tự đọc rất hợp lý: `sepia(0.6) saturate(1.15)` trông như một cú sepia,
`colorchannelmixer=rr=0.636:…` trông như một cú sepia — chỉ phép so mới nói được rằng một trong
hai cái đang cộng thêm grades mà file không hề có.

### 41.2 Con số: năm tuyên bố, hai tuyên bố không đúng

Registry có **29** effect; **5** cái claim `exact` (letterbox, negate, mirror-h, mirror-v, sepia).
Đo trực tiếp hai mặt trên cùng một param (lệnh đọc thẳng `effectCss` và
`buildFfmpegEffectFilters`, vì check 1 chặn tiến trình trước khi tới vòng sepia):

| `intensity` | mặt CSS phát ra (trước) | filter file thật chạy | đọc được gì |
| --- | --- | --- | --- |
| 0 | `sepia(0) saturate(1)` | `rr=1:rg=0:rb=0:gr=0:gg=1:gb=0:br=0:bg=0:bb=1` | identity, nhưng CSS vẫn kèm một hàm thừa |
| 25 | `sepia(0.25) saturate(1.063)` | `rr=0.848:rg=0.192:rb=0.047:gr=0.087:gg=0.921:gb=0.042:br=0.068:bg=0.134:bb=0.783` | hệ số = `1 − 0.607·0.25`, `0.769·0.25`, … — **đúng** nội suy identity → W3C sepia |
| 60 | `sepia(0.6) saturate(1.15)` | `rr=0.636:rg=0.461:rb=0.113:gr=0.209:gg=0.812:gb=0.101:br=0.163:bg=0.32:bb=0.479` | file chạy sepia thuần; `saturate(1.15)` là **15 % bão hòa bịa thêm** |
| 100 | `sepia(1) saturate(1.25)` | `rr=0.393:rg=0.769:rb=0.189:gr=0.349:gg=0.686:gb=0.168:br=0.272:bg=0.534:bb=0.131` | chính xác bảng W3C — tức `sepia(t)` tự nó đã là export |

`negate` thì sai theo cách khác: param `alpha` làm file đổi hẳn (emitter `negate=negate_alpha=1` đã nghỉ hưu ở slice J — §55)
và `invert()` trong CSS **không có mặt alpha** để mà nói. Một claim
cấp type không được phép nhân danh giá trị mặc định của param. Ba cái còn lại (letterbox,
mirror-h, mirror-v) đo thì **đúng thật** — nên chúng ở lại.

### 41.3 Test trước production

Spec mới: [tmcut_fx_exact.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_fx_exact.spec.ts),
**7** check, viết và chạy trước khi sửa một dòng production. RED đầu tiên, đúng như luật:

| Cái | Kết quả RED |
| --- | --- |
| check 1 «tập claim `exact` == tập rule đã chứng minh» | `an exact claim moved without a rule here`, actual 5 phần tử so với expected 4, `diff` chỉ đích danh `+ 'negate'` |
| check 2 sepia | không tới nơi trong lần chạy đó (check 1 bail), nên divergence của nó lấy từ phép đo ở §41.2; sau khi sửa claim và bỏ `saturate` thì in `sepia: the matrix in the file IS the CSS interpolation … PASSED` |

Nói thẳng phần yếu: chỉ một assertion được **nhìn thấy** sập trong run gốc; assertion sepia được
chứng minh là sẽ sập bằng mutation ở §41.5, không bằng một lần RED trước sửa. Ghi lại điều đó vì
nó là khác biệt thật giữa «test này fail» và «test này đã được thấy fail».

### 41.4 Sửa production — đúng hai chỗ

| Chỗ | Thay đổi |
| --- | --- |
| [fxPreview.ts:313](file:///D:/Applications/tm-studio/app/utils/tmcut/fxPreview.ts#L313) | bỏ `saturate(1 + 0.25t)`; mặt sepia còn đúng `sepia(t)`, kèm comment nêu vì sao hàm thứ hai là hàng giả |
| [effects.mjs:200](file:///D:/Applications/tm-studio/packages/core/src/effects.mjs#L200) | negate `exact` → `approximate`, comment nêu đích danh `alpha` |

Hai test cũ nêu claim cũ cũng phải sửa theo, và sửa **vì claim sai**, không vì code đổi:
[packages/core/test/effects.test.mjs](file:///D:/Applications/tm-studio/packages/core/test/effects.test.mjs) (dòng 255 khi đó)
và [tmcut_fx_preview.spec.ts:124](file:///D:/Applications/tm-studio/tests/unit/tmcut_fx_preview.spec.ts#L124).
Không có assertion nào được nới để chiều production.

### 41.5 Guard mới đo gì, và nó cắn thật

Kỳ vọng của mọi check lấy từ **chuỗi filter đã ship** (`exportFilter`:44), không từ mô tả — một
rule chỉ chép lại builder sẽ còn xanh sau khi hai bên lệch nhau.

| Check | Cái nó khóa |
| --- | --- |
| 1 tập claim | `exact` trong registry phải **bằng đúng** tập rule ở đây (sàn ≥ 4 để bảng không rỗng); `NOT_EXACT` nêu negate kèm lý do, nên ai gắn lại `exact` là fail ngay dòng đó |
| 2 sepia | quét 8 giá trị intensity (0, 10, 25, 60, 100, ngoài biên −20/140, default); **chín** hệ số của `colorchannelmixer` phải giải ra **cùng một** `t` (sai số lớn nhất đo được < 0.002) rồi mới so `effectCss` == `sepia(t)` và đếm số hàm = 1 |
| 3 negate | `negate` ↔ `invert(1)`, `negate_alpha=1` ↔ CSS vẫn chỉ `invert(1)`: chứng minh param là thật trước khi kết luận nhãn |
| 4 mirror | axis ↔ `hflip`/`vflip`/`hflip,vflip` và `scaleX(-1)`/`scaleY(-1)`/`scale(-1, -1)`; giá trị ngoài enum rơi về **default đọc từ registry** (mirror-h `horizontal`, mirror-v `vertical`) chứ không hardcode |
| 5 letterbox | `h=ih*bar` ↔ các stop `%` của plate, trên 9 giá trị size gồm cả ngoài biên; và plate của tile **chính là** plate của monitor |
| 6 một cây cầu | quét **154** file trong `app/components/tmcut`, `app/utils/tmcut`, `app/composables` tìm từ vựng CSS của effect (`saturate(`, `invert(`, `scaleX(-1)`, …); `fxPreview.ts` là file duy nhất được phép chứa |
| 7 tile | `TmcutFxThumb.vue` không được chứa tên type nào có dấu ngoặc kép — một `switch` quay lại là hai mặt tự quyết với nhau mà không file nào trông sai |

Ba mutation làm guard cháy, mỗi cái một lần chạy:

| Mutation | Kết quả |
| --- | --- |
| A: gắn lại `saturate(1 + 0.25t)` | check 2 FAIL `intensity (default): CSS face vs the shipped matrix` |
| B: `scale(-1, -1)` → `scale(-1, 1)` | check 4 FAIL `mirror-h axis both: CSS` |
| C: **sửa phía export** `size / 100` → `size / 90` | check 5 FAIL `bars at 12,12,88,88% vs export … h=ih*0.13` |

C là cái quan trọng nhất: nó chứng minh rule đọc file, chứ không đọc builder. Cả ba đã revert;
`git diff --stat` trên hai file production chỉ còn đúng hai thay đổi của §41.4
(9 insertions / 2 deletions).

### 41.6 Gate

| Gate | Lệnh | Kết quả | Bằng chứng |
| --- | --- | --- | --- |
| 1 Types | `npx nuxt typecheck` | PASS | exit 0, 0 × `error TS`; `.nuxt/eslint.config.mjs` regenerate 28581 B lúc 13:40 |
| 2 Lint | `npx eslint` trên **5** file chạm, chạy sau gate 1 | PASS | exit 0; lần đầu báo 1 lỗi `@stylistic/quote-props` ở `NOT_EXACT` — sửa file, không sửa rule |
| 3 Tests | `npx tsx tests/unit/run-all.mts --smoke`, `npx tsc -p packages/core --noEmit`, `node --test packages/core/test/*.test.mjs` | PASS | **123/123** specs exit 0 và **0** dòng `SKIP`/`PARTIAL`/`FAIL`; core tsc exit 0; core tests **679/679** |
| 4 Live | 5 route TMCut trên `:4003`, đọc console sau mỗi route | PASS có ghi nợ cũ | xem §41.6b: **0** `[warn]`/`[issue]`; `401` ×4/×2/×1 trên editor/templates/factory, `list_network_requests` quy toàn bộ cho `GET /api/v1/ai/relay/catalog` — đúng baseline §31.5. Tile `Sepia` computed `sepia(1)`, tile `Negate` hover ra badge "Approximate preview" |
| 5 Docs | §41 + §41.6b + bullets roadmap, staging đúng đường dẫn | PASS | — |

### 41.6b Live — hai mặt của một hiệu ứng, đo trên Chromium thật

Lượt này đổi một chuỗi CSS mà tile thật render, nên gate 4 không được xin miễn. Đo trên
`http://localhost:4003`, tab Chromium mới cùng profile (`list_pages` trước khi điều khiển),
`list_console_messages` sau mỗi route khi trang đã ổn định (`/tmcut` 1068 ký tự body,
`/tmcut/autocut` 451, `/tmcut/templates` 6889, `/tmcut/factory` 489):

| Route | Dòng console | Quy gán |
| --- | --- | --- |
| `/tmcut` | chỉ `[info] <Suspense>` | — |
| `/tmcut/autocut` | chỉ `[info] <Suspense>` | — |
| `/tmcut/editor` (đã mở tab Effects) | `[info] <Suspense>` + `[error] 401 (error.unauthorized)` ×4 | `list_network_requests` in đúng 4 request 401, tất cả là `GET /api/v1/ai/relay/catalog` |
| `/tmcut/templates` | `[info] <Suspense>` + `401` ×2 | cùng `relay/catalog` |
| `/tmcut/factory` | `[info] <Suspense>` + `401` ×1 | cùng `relay/catalog` |

**0** `[warn]` và **0** `[issue]` trên cả năm route. Ba hàng `401` là đúng baseline đã ghi ở §31.5
và được đo lại ở hơn mười lượt sau đó: một endpoint AI cần phiên, tab QA này chưa đăng nhập;
không request nào thuộc đường media/frame, và bridge không import gì phía server.

Phần render — thư viện Effects trên `/tmcut/editor`, mở bằng nút "Effects":

| Cái | Đo được |
| --- | --- |
| Tile trong thư viện | **27**, **16** trong số đó có một lớp con với `filter` khác `none` |
| Tile `Sepia` | computed filter **đúng** `sepia(1)` — không còn `saturate(1.25)` thừa như trước lượt này |
| Tile `Negate` | computed filter `invert(1)`; hover vào tile hiện badge **"Approximate preview"** |
| Tile `Sepia`, hover | **không** badge nào hiện |
| Tile `Chromatic Aberration` | `sepia(1) hue-rotate(-40deg) saturate(4)` — sepia ở đây là một phần của look khác, không phải claim của effect `sepia` |

Hai dòng badge đo cùng một cơ chế từ hai phía: [TmcutFxThumb.vue:119](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutFxThumb.vue#L119)
chỉ gán badge cho `illustrative` và `approximate`, còn `exact` thì `info` ở null — nên "Sepia hover
không ra badge" là hệ quả của claim vẫn đúng, còn "Negate hover ra *Approximate preview*" là hệ quả
của claim vừa bị gỡ. Đó là toàn bộ ý nghĩa của lượt này tính bằng UI: một tile không còn tự thêm
grade, và một tile không còn hứa WYSIWYG mà file không giữ được.

### 41.7 Yêu cầu 4 đóng tới đâu, và gì vẫn mở

- **Đóng**: tile và monitor lấy cùng một mặt từ một cây cầu (check 6 khóa tính «một» đó), và mọi
  tuyên bố `exact` — thứ người dùng nhìn thấy như lời hứa WYSIWYG — giờ có phép đo chống lại
  chính filter file chạy. Hai lời hứa rỗng đã bị gỡ.
- **Mở, có chủ đích**: các claim `approximate`/`illustrative` (blur sigma, vibrance, họ temporal)
  không được pin 1-1. Chúng **tự nhận** là gần đúng nên không có tuyên bố nào để phá; muốn chứng
  minh mức gần đúng thì cần fixture pixel cho từng effect, và F8 (§40) đã có hạ tầng đó nếu một
  lượt sau quyết định đo.
- **Mở**: yêu cầu 8 — resource lifecycle và hủy request preview cũ — là F10 (#136). F (#103) chưa
  exit cho tới khi nó xong. *(Dòng này nghỉ ở §42.)*

## 42. Slice F10 — cuối một phiên preview cũng là một tài nguyên phải trả (đo ngày 2026-11-05)

### 42.1 Câu hỏi mà F5 và D1 chưa trả lời

Yêu cầu 8 của slice F đòi hai thứ, và trước lượt này mới có một nửa:

- **trả lại mọi tài nguyên mà preview đã lấy** — `VideoFrame`, `ImageBitmap`, WebGL texture, object
  URL, worker/decoder;
- **một request frame cũ phải bị hủy, không được paint**.

D1 (§19) đặt luật core cho vế thứ hai: một ask sau retire ask trước trên cùng một slot. F5 (§33)
khép phía decoder: element dùng một lần trả `Input` và watchdog trong `finally`. Cả hai nói về **một
lần yêu cầu**. Không luật nào nói về **một lần rời đi**: editor unmount thì ai revoke mấy trăm object
URL, ai abort decode đang chạy, ai trả slot về ledger?

Đo ở HEAD `0760990` — `git show HEAD:<file> | grep -c` cho từng chỗ mà spec mới đòi:
`disposeFrameService` trong `editor.vue` = **0**, `requestFrameBatch` trong `useTmcutFrames.ts` =
**0**, `pause()` trong khối `onUnmounted` của player = **0**, `cancelScan()` trong `onUnmounted` của
autocut = **0**, `bitmap.close()` trong `readStill` = **0**, `release`/`clear` của ledger trong
`frames.mjs` = **0**. Không có đường nào để kết thúc một phiên.

### 42.2 Luật core mới: nhường có token, và nhường tất cả

`createFrameSlotLedger()` thêm hai phương thức — [frames.mjs:224](file:///D:/Applications/tm-studio/packages/core/src/frames.mjs#L224)
và [`:231`](file:///D:/Applications/tm-studio/packages/core/src/frames.mjs#L231), kiểu ở
`packages/core/src/index.d.ts:368`/`packages/core/src/index.d.ts:370`:

- `release(slot, token)` chỉ xóa một slot khi **đúng token của người gọi** đang được ghi cho slot
  đó. `forget(slot)` xóa vô điều kiện, và ở đây vô điều kiện là **sai**: autocut hỏi lại chính các
  slot `thumb:<asset>#<index>` khi phân tích lại, nên một batch đã thua mà xóa slot theo tên sẽ đá
  chủ mới đang giữ nó.
- `clear()` trả về **số** slot được gỡ, để spec đòi được chữ "hết" thay vì chỉ "không còn slot nào
  mình biết tên".

### 42.3 Service: một thế hệ, một cú dispose, một đường batch

[frameStore.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts) (313 dòng) có ba phần mới.

**Thế hệ, không phải cờ `disposed`.** `generation` ([:113](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L113))
tăng mỗi lần dispose, và mỗi task ghi lại `born` của mình lúc khởi sinh. Trước khi mint URL, task
kiểm `if (born !== generation) return null`
([:210](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L210)):
một decode kết thúc vào một phiên **trẻ hơn** đã trả bytes về, nhưng không được phép trả một object
URL mà không còn cache nào có khả năng revoke nó. Một cờ boolean sẽ biến dispose thành **tuyệt đối**
— quay lại `/tmcut/editor` lần thứ hai sẽ không còn frame nào, trong khi singleton cấp module là cố
ý dùng chung.

**`dispose()`** ([:168](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L168)) là một
hành động chứ không phải một trạng thái: tăng thế hệ, revoke mọi URL trong `held` rồi xóa map, abort
mọi `task.controller`, xóa `slotWaiters`, `ledger.clear()`
([:179](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L179)), và trả về **số URL đã
revoke** — để spec đếm được chứ không suy ra.

**`beginAsk()`** ([:230](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L230)) tách
phần "hỏi" khỏi phần "chờ": `request` và `requestBatch`
([:264](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L264)) cùng đi qua nó, nên
cache-hit, slot token và cancellation chỉ có **một** định nghĩa. `requestBatch` gọi `finishBatchSlot`
([:154](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L154)) cho mọi slot khi câu
trả lời cuối đã về: bỏ waiter của chính nó rồi `ledger.release(slot, token)`
([:161](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L161)). Batch giữ slot **tới
khi nó có câu trả lời**, chứ không tới khi cả app đổi ý. Hai hàm module mới: `requestFrameBatch`
([:306](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L306)) và `disposeFrameService`
([:311](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L311)).

### 42.4 Nối dây — đúng năm chỗ

| Chỗ | Dòng | Cái gì trả về |
| --- | --- | --- |
| [useTmcutFrames.ts](file:///D:/Applications/tm-studio/app/composables/useTmcutFrames.ts#L66) | 66 | `extractFrames` hỏi **một batch**, không còn gọi `requestFrame` từng khung |
| `app/pages/tmcut/editor.vue:108` | 108 | `disposeFrameService()` trong `onUnmounted` |
| [TmcutPreviewPlayer.vue](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L1411) | 1411 | `pause()` đứng đầu `onUnmounted` |
| `app/pages/tmcut/autocut.vue:572` | 572 | `cancelScan()` trong `onUnmounted` |
| [mediaProbe.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/mediaProbe.ts#L175) | 175 | `bitmap?.close?.()` trong `finally` của `readStill` |

Không đặt dispose trong layout, vì số đo này: chỉ `editor.vue` khai `layout: 'studio'`; các trang
tmcut còn lại dùng `default` chung với cả app, nên dispose ở đó sẽ giết frame service của một trang
chưa hề rời đi. Autocut cũng không cần dispose — chỗ nó rò là **slot**, và slot thì batch đã trả.

`pause()` đứng riêng vì loop playhead tự nạp lại qua `requestAnimationFrame`: unmount mà không pause
thì một playhead vô hình vẫn chạy đúng nhịp của monitor. `cancelScan()` cũng vậy — một scene/silence
scan giữ `Input` mở, và `analyzeSource` đã tự bắt lỗi của nó nên abort ở đây không ném gì ra UI.
Còn `readStill`: đường thành công vẫn đóng bitmap từ trước, nhưng một getter `width` ném lỗi thì
bitmap đã cấp phát mà không ai giải phóng — đóng "trên đường đi" chỉ là nửa luật.

### 42.5 Test trước production — 12 check

Spec mới [tmcut_resource_lifecycle.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_resource_lifecycle.spec.ts)
(368 dòng, **12** check) RED một lượt đo rồi GREEN. Theo nhóm:

- **ledger** (:81, :98): `clear()` đếm số slot trả về; `release()` **từ chối** token lạ — đúng cái
  mà `forget()` không làm được.
- **dispose** (:163, :188, :214): 3 URL đang giữ thì revoke **cả 3** (`dispose() === 3`, `cached()`
  rỗng, `trackedSlots()` = 0, `inFlight()` = 0); một decode đang chạy lúc dispose **không publish**
  (`created.length === 0` — không URL mới được mint nên không gì rò); và service **trả lời tiếp**
  sau dispose (URL khác, 2 decode mới) — dispose không phải một cửa đóng.
- **batch** (:231, :256): batch trả slot của nó; rồi phiên bản cắn của cùng luật — batch **bị
  superseded** không được đá chủ mới (`trackedSlots() === 2` giữa cuộc đua).
- **hình dạng nguồn** (:292, :312, :320): app gọi `requestFrameBatch`, editor có
  `disposeFrameService()`, player unmount có `pause()`, autocut unmount có `cancelScan()`. Check đầu
  của nhóm còn **phủ định** `requestFrame(` trong composable — không được còn đường vòng cũ.
- **still** (:327): `readStill` với một getter `width` ném lỗi vẫn đóng bitmap đúng **một** lần.
- **worker** (:350): `/new (Shared)?Worker\s*\(/` không có kết quả nào trong `app/`.

Check 7 ban đầu viết "một seek mới có bốn frame của riêng nó" và FAIL `3 !== 4`:
`TMCUT_FRAME_MAX_CONCURRENT = 3` xếp frame thứ tư vào queue, nên con số đó là **nhịp** của máy chứ
không phải luật của slot. Assertion đổi thành những gì tất định: signal của ask cũ
`aborted === true`, nhả gate cũ rồi `trackedSlots() === 2`, nhả hết rồi thì hai URL mới về và slot
về 0.

### 42.6 Falsification — bốn mutation, mỗi cái làm sập đúng một check

| Mutation | Check sập | Số đo |
| --- | --- | --- |
| bỏ guard `born !== generation` | "and it is not published either" | `1 !== 0` |
| `ledger.release(slot, token)` → `ledger.forget(slot)` | "handing back its own slots leaves the newer batch owners in place" | `0 !== 2` |
| bỏ `ledger.clear()` trong `dispose()` | "no slot is still owned by the page that left" | `3 !== 0` |
| bỏ `bitmap?.close?.()` | "but the bitmap was allocated" | `0 !== 1` |

Bốn mutation, bốn run, mỗi cái làm **đúng một** check sập — tức không check nào dư; cái thứ hai chứng
minh phần thưởng của token guard: bỏ nó thì spec **nhìn thấy** chủ mới bị đá. File restore
**byte-identical** (`sha256sum -c` OK — `frameStore.ts` `396d0fa9…`, `mediaProbe.ts` `fec94d84…`),
spec chạy lại 12/12.

### 42.7 Gate

| Gate | Lệnh | Kết quả |
| --- | --- | --- |
| 1 Types | `npx nuxt typecheck` | **PASS** exit 0, 0 × `error TS`, config regenerate 14:22 (28581 B) |
| 2 Lint | `npx eslint` trên **9** file chạm (sau gate 1) | **PASS** exit 0, 0 problem |
| 3 Unit | `npx tsx tests/unit/run-all.mts --smoke` | **PASS** 124/124, exit 0 |
| 3 Core | `npx tsc -p packages/core --noEmit` + `node --test packages/core/test/*.test.mjs` | **PASS** exit 0 / **679/679**, 0 fail, 0 skipped |
| 4 Live | 5 route trên `:4003` | **PASS** 0 `[warn]`/`[issue]`, `401` đúng baseline |
| 5 Docs | §42 + roadmap, scratch đã xóa | **PASS** |

Dòng `SKIP|PARTIAL|FAIL` duy nhất grep được trong log gate 3 là chuỗi "0 FAILED" nằm **trong** một
dòng PASS — không spec nào bị bỏ hay chạy dở.

### 42.8 Live — playhead, blob URL và một lượt quay lại

Bốn con số đầu đo trong Chromium thật trên `:4003` bằng một wrapper đếm callback
`requestAnimationFrame` — không suy ra từ source.

| Cái | Đo |
| --- | --- |
| callback rAF trước khi bấm play | **0/giây** |
| callback rAF khi đang phát | **82/giây** |
| callback trong 2 s chuyển route `/tmcut/editor` → `/tmcut` | **+10** (đó là unmount, không phải loop) |
| callback 2 s **sau** khi đã ở `/tmcut` | **0** — loop đã chết |
| `fetch()` một URL `blob:` filmstrip vừa capture, sau khi rời editor | **thất bại** — `disposeFrameService()` đã revoke |
| rời rồi vào lại `/tmcut/editor` | **16** dải `blob:` vẽ lại, console đúng baseline |

Bốn dòng đầu là bằng chứng của `pause()`; hai dòng sau là của `dispose()` và — quan trọng nhất cho
luật "generation chứ không phải cờ" — dòng cuối chứng minh dispose **không** làm singleton vô dụng
với lần vào sau.

### 42.9 Chưa chứng minh / nợ

- **WebGL texture**: yêu cầu 8 kể tên này, nhưng `grep webgl2` trong `app/` trả **0** — preview hiện
  composite bằng lớp DOM/CSS, nên **không có** GL resource nào để trả. Đây là leg **rỗng**, không
  phải leg đã xử lý; khi compositor WebGL2 của #103 vào, `dispose()` là chỗ duy nhất nó phải đăng ký
  texture, và check "worker" là hình mẫu để pin điều đó.
- **`VideoFrame`**: app không tự tạo cái nào — sink của Mediabunny vẽ vào canvas, `Input` đã đóng
  trong `finally` (F5). Lượt này không thêm gì cho leg đó, chỉ giữ nó không hồi quy.
- **autocut giữa một scan**: `cancelScan()` được pin ở source và unit, nhưng chưa có phép đo
  "unmount thật giữa một scene scan" trên Chromium.
- **Host Electron** (lifecycle của bridge/renderer), **độ bền OPFS qua reload**, và **số
  listener/ledger trong production build**: không gate nào của lượt này chạm tới.

### 42.10 Yêu cầu 8 đóng tới đâu

- **Đóng**: mọi tài nguyên mà preview **tự lấy** — object URL, decode đang chạy, slot ledger,
  `ImageBitmap` của still, `Input` của scan, loop rAF — nay có **một** chỗ kết thúc phiên và **12**
  check đo nó. Một request cũ bị hủy (`signal.aborted === true`) chứ không paint, và hủy **không**
  đã man: batch thua không được chiếm slot của người thắng.
- **Đóng có điều kiện**: hai leg "WebGL texture" và "`VideoFrame`" được chứng minh là rỗng trong
  kiến trúc hiện tại (§42.9), chứ không phải được giải quyết.
- **Còn mở của slice F**: không có gì mới. §41.7 để lại đúng một dòng, và dòng đó đóng ở đây — nên
  #103 exit được, theo phép đo ở §42.11.

### 42.11 Exit review của slice F (#103) — năm tiêu chí, từng cái một bằng chứng

Brief của slice F ([execution brief, "Slice F — Composite Preview"](file:///D:/Applications/tm-studio/docs/tmcut-zero-ffmpeg-next-slices-agent-execution-brief.md#L127)
định nghĩa exit bằng **5 tiêu chí và 8 yêu cầu**, không phải bằng một tên công nghệ. Tiêu chí của
#103 cũng không đòi WebGL2 — compositor GPU là một dòng của Phase 5 trong roadmap, và §42.9 đã ghi
leg đó là **rỗng** trong kiến trúc hiện tại chứ không phải đã xử lý.

| Tiêu chí | Bằng chứng đã đo | Phần còn lại |
| --- | --- | --- |
| "Không còn hai luồng composite preview cạnh tranh" | §27 (F1: `paintStack` vào core, luật "một hàng" nghỉ hưu), §30 (F3: `selectExportTracks` bị xóa, file đọc plan của core), §32 (F4b: plate đi **theo layer**), `tests/unit/tmcut_paint_stack.spec.ts` + `tests/unit/tmcut_export_paint_stack.spec.ts` | không có |
| "Nhiều track/layer hiển thị đúng thứ tự" | §29 (F2b: DOM vẽ **đủ** số phần tử core gọi tên), [tmcut_preview_paint_plan.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_preview_paint_plan.spec.ts), [tmcut_surface_plate.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_surface_plate.spec.ts); thứ tự được **đo** chứ không chỉ nêu — §40.3: đảo `slots` làm check 2 sập còn 2 màu distinct | không có |
| "Preview và export dùng cùng evaluator/composition rules" | §30 (F3), §34 (F6a: một nguồn media-time), §38 (F6d: blend đi **qua** plan), §39 (F7: chữ vẽ từ layer), `tests/unit/tmcut_export_track_parity.spec.ts` đi từng frame của `createFrameScheduler` | không có |
| "Có visual regression fixtures" | §40 (F8: fixture nhiều layer, plan dự đoán pixel của file), §91 trong roadmap (golden-frame bằng FFmpeg thật, hai still giải mã đúng từng byte), `tests/unit/tmcut_golden_frame.spec.ts` | kỳ vọng là màu phẳng 4 góc + ink, **không** phải cả khung (transform/crop/mask/effect nhiều layer mới có spec graph) |
| "UI responsive khi scrub và đổi effect" | §36 (F6b: scrub trên lưới khung hình), §42.8 (nhịp rAF đo trong Chromium: 0/giây ambient, **82/giây** khi phát, **0** sau khi rời) | chưa có phép đo **khung rơi** cho một scrub dài — số đo hiện tại là nhịp, không phải budget |

Tám yêu cầu: **cả tám** có spec, và yêu cầu 8 đóng ở lượt này (§42.10). Hai phần còn lại được **kể
tên** thay vì được gọi là xong, và đó là lý do bảng trên có cột cuối:

- **`shape`**: yêu cầu 2 kê trục "shape", nhưng layer type đó **chưa tồn tại** — chủ của nó là gap
  (d) của #90 trong roadmap, không phải một đường chưa làm của slice F.
- **frame budget khi scrub**: tiêu chí 5 nói "responsive"; cái đo được là nhịp callback và console
  sạch. Muốn đóng thành phép đo thì cần đếm khung rơi trong một scrub dài, thuộc về lượt nào chạm
  lại transport.

Với hai phần đó ghi rõ, #103 exit và G (#104) bắt đầu. Không tiêu chí nào ở trên được đóng bằng một
câu mô tả: mỗi ô "bằng chứng" là một section có số đo hoặc một spec chạy trong gate 3.

---

## 43. Slice G1 — waveform đo trên thang nào, và một artifact được gọi tên ra sao trong cache (đo ngày 2026-11-05)

### 43.1 Hai câu hỏi brief G mở ra, và hiện trạng đo được

Brief của slice G ([execution brief, "Slice G — Audio & waveform"](file:///D:/Applications/tm-studio/docs/tmcut-zero-ffmpeg-next-slices-agent-execution-brief.md#L152))
nêu mục 3 ("waveform bucketed — min/max hoặc RMS — kèm metadata gọn") và mục 4 ("cache key mang
fingerprint + track + resolution + algorithm/version"). Luật waveform đã tồn tại từ thời FFmpeg, và
nó **sai thang** cho đường không-FFmpeg. Đo trước lượt này:

| Nơi | Dòng | Hiện trạng đo được |
| --- | --- | --- |
| `electron/tools/tmcut.controller.cjs:429` | 429-443 | `int16ToPeaks` được **nhân bản trong controller** — một bản chia 32768 đứng cạnh bản core |
| `electron/tools/tmcut.controller.cjs:402` | 402-406 | guard đọc cache chỉ là `Array.isArray(cached.buckets)`; artifact không có algorithm, không có sampleRate |
| `electron/tools/tmcut.controller.cjs:420` | 420-427 | FFmpeg chết → ghi **toàn zeros** rồi trả `ok:true`; lần đọc sau coi đó là thành công |
| [waveform.mjs](file:///D:/Applications/tm-studio/packages/core/src/waveform.mjs#L22) | 22 | `max / 32768` — đúng với `-f s16le`, sai với cái mà [decodePcm](file:///D:/Applications/tm-studio/app/utils/tmcut/audioDecode.ts#L52) trả |

Phép đo thang, chạy bằng chính hai hàm: một sine biên độ **0.35** (mức tiếng nói thật) dài 8000 mẫu ở
8 kHz — reducer cũ trả peak lớn nhất **1.068e-5**, reducer mới trả **0.35**. Sai số không phải "nhỏ
hơn một chút": nó là một đường phẳng. Đây là lỗi một port naive sẽ mang sang browser nếu chỉ sửa caller
mà không sửa luật.

### 43.2 Luật float — `floatPeakBuckets`

[waveform.mjs:69](file:///D:/Applications/tm-studio/packages/core/src/waveform.mjs#L69). Cùng một phép
chia bucket với `int16ToPeaks` (tỉ lệ, cửa cuối ngắn được giữ, bucket không mẫu thì 0), khác đúng một
điều: peak là magnitude trên thang full-scale, không phải `max / 32768`. Ba luật được pin bằng test:

- **fold theo kênh to nhất**, không trung bình, không RMS — cùng luật mà
  [detection.mjs:280 `loudestPeakSeries`](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L280)
  đã áp cho dBFS từ slice E4. Kênh im lặng không được kéo biên độ xuống; test đo bằng cặp
  `[1.0, 0.0] → 1.0`, tức trung bình (0.5) và RMS (0.707) đều sập.
- **mẫu không phải số bị bỏ**, không bị đọc thành im lặng: một NaN đứng đầu cửa không xoá được click
  phía sau; cả cửa toàn NaN thì 0 — "không có gì đo được" khác "đo được số 0", nhưng trên timeline cả
  hai vẽ một vạch đáy.
- **kênh không được giao bị bỏ hẳn** (`length === 0` hoặc `null`), không tính là một kênh im; nếu tất
  cả các kênh đều vậy thì trả dãy 0 đúng độ dài bucket, không crash, không `undefined`.

`int16ToPeaks` **không bị sửa và không bị xoá**: nó vẫn đúng với input int16, và test chứng minh hai
hàm cho **cùng một dãy** khi cùng một biên độ vật lý — `[0, 16384, -32768, 8192]` int16 so với
`[0, 0.5, -1, 0.25]` float, cả hai trả `[0.5, 1]`.

### 43.3 Envelope có đóng dấu — và ba trạng thái của "không có waveform"

`buildWaveformPayload` ([waveform.mjs:114](file:///D:/Applications/tm-studio/packages/core/src/waveform.mjs#L114))
và `readWaveformPayload` ([`:142`](file:///D:/Applications/tm-studio/packages/core/src/waveform.mjs#L142)).
Một file không nói ai đo thì không thể đọc một cách an toàn sau khi app đổi phiên bản — đó chính xác là
chỗ dòng thứ hai của bảng §43.1 đã hỏng. Envelope mang sáu trường: `algorithm` (`'peak-v1'`),
`durationSec`, `sampleRate`, `channelCount`, `bucketCount`, `peaks` (làm tròn ba chữ số thập phân, và
độ chính xác đó là `TMCUT_WAVEFORM_PEAK_PRECISION` — một khai báo, không phải một con số nằm chết trong
hàm). Object và mảng đều `freeze`: một câu trả lời đã cache không phải chỗ để app sửa.

Ba trạng thái, và cái giá của việc gộp hai trạng thái đầu:

| Trạng thái | Envelope | Vì sao phải tách |
| --- | --- | --- |
| có track audio, giải mã ra im lặng | `peaks` toàn 0, `channelCount` ≥ 1 | đó **là** một phép đo, nên được cache |
| file không có track audio | `channelCount: 0`, `sampleRate: 0` | panel nên nói "không có tiếng", không phải "tiếng rất nhỏ" |
| giải mã thất bại | **không có gì được ghi** | `buildWaveformPayload` trả `null`; zeros kèm `ok:true` chính là bug ở controller |

`readWaveformPayload` từ chối `algorithm` lạ (một phép đo `rms-v2` không phải cùng những vạch này), từ
chối `peaks` rỗng (rỗng không đồng nghĩa với im lặng), từ chối `bucketCount` không khớp số vạch nó chở,
và **clamp** một vạch hữu hạn vượt 1 thay vì vứt cả dòng: một con số hỏng không phải lý do để giải mã
lại cả file. Không có timestamp trong envelope — chỉ số dùng `accessedAt` của index, còn bản thân
artifact phải xác định (cùng một PCM luôn ra cùng một nội dung), đúng luật determinism của slice #86.

### 43.4 Trục key mới cho artifact — và cái bẫy nếu nới `isByteCacheKey`

[byteCache.mjs:24](file:///D:/Applications/tm-studio/packages/core/src/byteCache.mjs#L24) là
`/^([0-9a-f]{8})-([a-z][a-z0-9]{0,15})-v([1-9][0-9]*)$/`: fingerprint của bản gốc, kind, phiên bản luật
— `a1b2c3d4-wave-v1`. API mới: `derivedByteCacheKey` ([`:63`](file:///D:/Applications/tm-studio/packages/core/src/byteCache.mjs#L63),
từ chối fingerprint không hợp lệ, kind viết hoa / có gạch dưới / có dấu chéo, version `0`, `1.5`,
`'v1'`), `parseDerivedByteCacheKey` (`:71`), `isDerivedByteCacheKey` (`:79`), `isStoredByteCacheKey`
(`:84`, **union**), `byteCacheFingerprint` (`:93`, hoặc chính nó hoặc nguồn của nó).

Cái bẫy, và đó là lý do `isByteCacheKey` giữ nguyên nghĩa:
[frames.mjs:165](file:///D:/Applications/tm-studio/packages/core/src/frames.mjs#L165) là
`if (!isByteCacheKey(fingerprint)) return null` — nó hỏi "đây có phải một bản ghi hình không" trước khi
đặt tên cho một frame. Một key dẫn xuất **chứa** một fingerprint hợp lệ, nên nới predicate đó lên thành
union sẽ cho phép `a1b2c3d4-wave-v1` đóng vai một revision. Vì vậy predicate nguồn đứng nguyên, union
là một tên khác, và tầng lưu trữ phải gọi union một cách có chủ đích. Test pin cả hai chiều:
`isByteCacheKey('a1b2c3d4-wave-v1') === false` **và** `frameRequestKey('a1b2c3d4-wave-v1', 1.5, 320) === null`,
kèm `frameRequestKey('a1b2c3d4', 1.5, 320) === 'a1b2c3d4-f1500-w320'` để chứng minh cái không bị hỏng
vẫn chạy.

### 43.5 Eviction: artifact sống nhờ nguồn của nó

[byteCache.mjs:147](file:///D:/Applications/tm-studio/packages/core/src/byteCache.mjs#L147) thêm
`isLive = key => live.has(key) || live.has(byteCacheFingerprint(key))`. Thư viện kê tên **revision**,
không kê tên artifact; nếu eviction chỉ hỏi `live.has(entry.key)` thì mỗi lần mở lại dự án là một lần
xoá sạch waveform vừa tạo. Chiều ngược cũng được pin: artifact của một revision đã rời thư viện bị bỏ
đi cùng nguồn — đúng chỗ relink/delete từng để rác lại mà không ai dọn. Thứ tự drop (invalid →
không-sống-hoặc-quá-budget → LRU) giữ nguyên và chạy **trên cả hai loại dòng**: test đòi `drop` là
`[wave-v1]` khi ba dòng (hai nguồn, một artifact) vượt budget và artifact đó có `accessedAt` cũ nhất.
`invalid` vẫn chỉ là những key không tên được file nào — một key dẫn xuất hợp lệ có nguồn chết **không**
phải rác index, và test phân biệt hai chuyện đó.

### 43.6 Test trước production, và falsification bốn mutation

Luật mới viết sau khi hai file test đã chạy đỏ: `pass 0 / fail 2` với
`SyntaxError: The requested module '../src/waveform.mjs' does not provide an export named 'TMCUT_WAVEFORM_ALGORITHM'`.

| File | Check | Đo gì |
| --- | --- | --- |
| [waveform-float-peaks.test.mjs](file:///D:/Applications/tm-studio/packages/core/test/waveform-float-peaks.test.mjs#L41) | 17 | thang float, fold theo kênh to nhất, NaN, clamp, round-trip int16↔float, envelope, ba trạng thái, `readWaveformPayload` từ chối |
| [byte-cache-derived-key.test.mjs](file:///D:/Applications/tm-studio/packages/core/test/byte-cache-derived-key.test.mjs#L31) | 18 | build/parse key, kind và version bị từ chối, nguồn tinh, eviction theo nguồn, thứ tự LRU hỗn hợp, hành vi cũ còn nguyên |
| [tmcut_waveform_law.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_waveform_law.spec.ts#L42) | 6 | luật đi qua alias `tmcut-core` và qua barrel app, `index.d.ts` khai đủ tên, sai thang bị đo **từ alias**, `frames.mjs` không được dùng union |

Bốn mutation, mỗi cái một run, tất cả đã revert (md5 đầu và cuối khớp —
`7651a0a82c1e638c990222975279f9d3` cho byteCache, `34bdb6ab9fe2fdccfed6bf76501801b7` cho waveform):

| Mutation | Sập ở đâu |
| --- | --- |
| nới `isByteCacheKey` thành union (đúng cái bẫy §43.4) | core `fail 4`, trong đó có "a waveform is not a media revision"; app spec fail |
| eviction bỏ vế nguồn, chỉ `live.has(key)` | core `fail 2`, app spec fail `the artifact of a gone revision goes with it` |
| `floatPeakBuckets` chia 32768 (bê luật cũ sang thang mới) | core `fail 7`, app spec fail ở check đo **từ alias** |
| `buildWaveformPayload` chấp nhận `peaks: []` (bug controller ở lại trong luật) | core `fail 1`, app spec fail `a failed decode stores nothing` |

### 43.7 Gate

| Gate | Lệnh | Kết quả |
| --- | --- | --- |
| 1 Typecheck | `npx nuxt typecheck` | exit **0**, `0` × `error TS`; `.nuxt/eslint.config.mjs` regenerate 15:25 |
| 2 Lint | `npx eslint` trên **7** file chạm, chạy **sau** 15:25 | exit **0**, 0 problem. Run đầu FAIL 5 (`import/no-duplicates` ×2 vì tách import cũ/mới, `@stylistic/arrow-parens` ×1) — sửa file, không sửa rule |
| 3 Unit | `npx tsx tests/unit/run-all.mts --smoke` | **125/125** specs exit **0**, `0` dòng `SKIP`/`PARTIAL`/`FAIL`; spec mới `tmcut_waveform_law` PASS |
| 3 Core | `node --test packages/core/test/*.test.mjs` | **714/714** (`679` cũ + `35` mới), exit 0 |
| 3 Core types | `npx tsc -p packages/core --noEmit` | exit **0**, `0` × `error TS` |
| 3 Boundaries | `node packages/core/tools/check-boundaries.mjs` | PASS — core không import gì platform-specific |
| 4 Live | `:4003`, năm route TMCut qua Chromium | `0` `[error]`/`[warn]`/`[issue]` trên `/tmcut`, `/tmcut/autocut`, `/tmcut/editor`, `/tmcut/templates`, `/tmcut/factory`; noise duy nhất là `[info] <Suspense>`. Bundle đang serve: barrel `/_nuxt/utils/tmcut/waveform.ts` re-export **bảy** tên từ core, `waveform.mjs` served khớp **7** tên mới, `byteCache.mjs` served khớp **5** |

### 43.8 Chưa chứng minh / nợ

- **Chưa có ai gọi luật mới.** `floatPeakBuckets` và `buildWaveformPayload` chưa có call-site nào
  trong `app/**` ngoài barrel re-export, và `readCachedBytes` vẫn chưa đọc một artifact nào. Đó là việc
  của G2 (#138): lượt này chỉ dựng luật, nên chưa có bằng chứng nào cho ADR-033.
- `TMCUT_WAVEFORM_ALGORITHM` là `'peak-v1'`: **peak**, không phải min/max cũng không phải RMS — hai lựa
  chọn brief nêu như ngang nhau. Quyết định ghi ở đây để G2 không phải đoán lại; nếu một lượt sau muốn
  RMS thì đó là `rms-v1`, tức một key mới, tức artifact cũ tự hết hiệu lực — đúng cơ chế §43.4 tạo ra.
- Route `/tmcut/editor` trên Chromium sạch console nhưng **dừng ở màn boot** (trình duyệt MCP không có
  phiên, và không nhập credentials của user): chưa có ảnh nào của media panel hay timeline clip vẽ
  waveform. Không có gì sai — lượt này chưa có UI để vẽ.
- Envelope chưa được ghi xuống OPFS/IndexedDB; `controller.mjs:420-427` (zeros kèm `ok:true`) và
  `:402-406` (guard không algorithm) vẫn còn nguyên. Gỡ chúng là việc của G2/G4, vì phải có đường đọc
  mới rồi mới retire đường cũ được.
- *(**đo lại ở §44, 2026-11-05**: hai vế đầu của dòng này đã đổi — `floatPeakBuckets` có call-site
  trong [waveformService.ts:85](file:///D:/Applications/tm-studio/app/utils/tmcut/waveformService.ts#L85) và
  `readCachedBytes` đọc một **artifact** ở
  [:63](file:///D:/Applications/tm-studio/app/utils/tmcut/waveformService.ts#L63); envelope đã ghi xuống OPFS và đã được
  đọc lại sau reload (§44.5). Vế còn nguyên là `controller.mjs:420-427` / `:402-406`: đường đọc mới chưa cho phép retire
  đường cũ trên desktop, nên nợ đó vẫn thuộc I/J.)*

---

## 44. Slice G2 — bar của một file audio sinh ra trong browser, và lần đầu một artifact được đọc lại (đo ngày 2026-11-05)

### 44.1 Việc của lượt này, và hiện trạng đo được ở HEAD `a33d745`

G1 dựng luật waveform và key cho artifact, nhưng chính §43.8 đã ghi là **chưa ai gọi**. G2 là lượt nối dây: một service
trả lời câu "file này có dạng bar thế nào" bằng cách hỏi cache client **trước**, và chỉ mở decoder khi cache không có gì —
đúng hình hài D2 dựng cho pixel ([frameStore.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts)) và E4 dựng cho
silence ([autocutDetect.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/autocutDetect.ts)). Đo trước lượt này:

| Chỗ | Dòng (HEAD) | Hiện trạng đo được |
| --- | --- | --- |
| `app/composables/useTmcutMedia.ts:938` | 938-946 | `loadWaveform` gọi `fetch(mediaUrl(asset.waveformPath))` rồi `clampWaveformPoints` — tức đọc một **file JSON do controller FFmpeg viết xuống server**, không phải bytes trong máy |
| `app/composables/useTmcutMedia.ts:97` | 97-103 | comment ghi thẳng "Nothing reads it back yet: thumbnails (slice D), waveforms (slice G) and export (slice H) are the first consumers" |
| [TmcutMediaPanel.vue](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutMediaPanel.vue#L542) | 542 | `asset.waveformPath &&` — một asset audio **không có** đường dẫn server thì vĩnh viễn không có bar |
| [TmcutTimelineClip.vue](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutTimelineClip.vue#L207) | 207-211 | `if (!asset?.waveformPath) return` — cùng một cổng thứ hai |
| `git grep -n "asset.waveformPath" HEAD -- app` | — | **7** kết quả: 6 trong composable (`452`, `833-835`, `860`, `869`, `938-946`) + 1 ở panel, mà `waveformPath` chỉ do **desktop IPC** điền (`analyzeAsset` → `result.waveCachePath`). Nghĩa là **web host chưa từng vẽ nổi một dải bar nào** |
| `git grep -n readCachedBytes HEAD -- app` | — | **2** call-site thật (`frameStore.ts:196`, `autocutDetect.ts:106`) và **0** chỗ nào đọc một **artifact**: cả hai xin revision của file, không chỗ nào xin `<fp>-wave-v1` |
| `git grep -n waveformCacheKey HEAD` | — | **0** kết quả toàn repo — G1 khai kind + version trong core nhưng chưa ai mint key |
| [byteStore.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/byteStore.ts#L299) | 299-311 | reader làm `index.set(...)` rồi `writeIndex(index)` trên **snapshot nó mở ra trước khi await** — seed của defect ở §44.3 |

### 44.2 Service: một câu hỏi, một đường trả lời, bốn lời từ chối

[waveformService.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/waveformService.ts) là file mới duy nhất của lượt này
(117 dòng). `createWaveformService(decode, liveKeys)` (:56) đi theo đúng thứ tự: đọc artifact theo key của G1 (:63) → nếu
không có thì đọc **bytes của revision** từ cache (:73) → giao bytes đó cho decoder, chỉ xin `src` khi máy không giữ bản nào
(:75) → reduction ở core (:85) → ghi artifact xuống cache (:96) → trả bar. Bốn chỗ từ chối, mỗi chỗ một dòng riêng:

| Từ chối | Dòng | Lý do đo được |
| --- | --- | --- |
| Không có fingerprint (hoặc fingerprint không phải 8 hex) | :101-103 | `waveformCacheKey` trả `null`: không có tên thì không có chỗ cất câu trả lời, nên cũng không có lý do để mở decoder |
| `durationSec` không finite hoặc ≤ 0 | :104 | một file không có độ dài thì không có bucket nào đúng; luật G1 đã từ chối payload loại này |
| Decoder trả `null` **hoặc** trả không kênh nào | :82 | đây chính là bug controller (`:420-427`): FFmpeg chết thì ghi **toàn zeros kèm `ok:true`**, lần đọc sau coi là thành công. Ở đây không có gì được ghi, nên lần hỏi sau hỏi lại thật |
| `buildWaveformPayload` trả `null` | :90 | luật core đã từ chối `peaks: []`; service không được phép tự nới luật của core |

Hai quyết định thiết kế có chủ đích:

- **`decode` là tham số, không phải import trong lòng luật** (:27, :57). PCM cần WebCodecs, Node không có, nên muốn đo
  "cái gì được cache, cái gì bị gộp, cái gì bị từ chối" thì phải dựng được service không có decoder. Chỉ 5 dòng cuối của
  `app/composables/useTmcutMedia.ts:116` nối `decodePcm` thật.
- **`liveKeys` là bắt buộc và là câu trả lời của cả thư viện** (:92, và
  `app/composables/useTmcutMedia.ts:107`). Một lần ghi chạy luôn luật
  eviction; một service đưa tập hẹp hơn sẽ **xóa chính cache nó đang viết**. Service còn tự thêm fingerprint của revision nó
  đang phục vụ vào tập đó (:95) — có ai đang hỏi file này, đó là bằng chứng nó còn được muốn.

Việc gộp người hỏi (:106-113) tồn tại vì một phép đo thật: panel và clip cùng hỏi **trong một tick** (`ensureWaveforms` duyệt
danh sách, `refreshWaveform` chạy lúc mount). Không có `jobs` map thì mỗi người hỏi mở một decoder cho cùng một file.

### 44.3 Hai defect của byte store mà chính đường đọc mới lộ ra

Cache client tồn tại từ C2b nhưng **chưa từng có hai caller chồng nhau** — mỗi leg cũ chỉ đọc một mình nó. Leg waveform là
leg đầu tiên vừa **đọc artifact** vừa **ghi revision** trong cùng một lượt, và nó lộ ra hai lỗi có thật, cả hai đều đo được
trên máy trước khi có spec:

| Defect | Triệu chứng đo live | Cơ chế | Sửa |
| --- | --- | --- | --- |
| A — index ghi theo **snapshot** | một file OPFS nằm trên máy mà index **không kê tên**: không ai đọc được, và lần reconcile kế tiếp giải phóng nó | `readCachedBytes` mở `index = readIndex()` **trước** khi `await getFile()`, rồi `writeIndex(index)` **sau**. Writer xen giữa cũng mở snapshot của nó và ghi cả snapshot đè lên: row của người kia biến mất, bytes ở lại thành mồ côi | `touchIndexRow` (:165) và `forgetIndexRow` (:172) — mỗi lần sửa **một row**, đọc index lại ngay lúc sửa. Không hàm nào trả về snapshot để caller mang theo |
| B — OPFS **cắt ngắn file ngay khi mở writable** | hàng cache trong panel báo `bytes: 0` cho một asset thật 48 KB | `handle.createWritable()` làm file rỗng ngay; một reader xen vào thấy row **có** mà file **rỗng**, trả về `Blob` 0 byte và ghi row `bytes: 0` — tức cache tự xác nhận một thứ không có | row chỉ được **kê sau khi bytes đã nằm xuống** (:310, comment :306-309), và reader **từ chối file rỗng** (:336) thay vì vẽ nó như hàng có sẵn |

Vế thứ hai của defect B đáng nói ở chỗ nó chọn sai một cách có hệ thống: trước sửa, `readCachedBytes` còn `deleteStored` một
file không đọc được. Trong thế giới có write đang bay, đó là **xóa bytes của người khác**, nên đường đọc giờ chỉ *quên row*
(:342) và để riêng một lần reconcile (`pruneByteCache`) quyết định giải phóng bytes.

Phía test, [tmcut_browser_storage.ts](file:///D:/Applications/tm-studio/tests/unit/helpers/tmcut_browser_storage.ts) được
làm cho **giống browser thật** thay vì dễ kiểm soát: fake OPFS cắt ngắn file ngay khi `createWritable()` (:54) đúng như OPFS,
và `installOpfs(quota, { holdReadsFor, holdWritesFor })` (:135) cho phép một check **xếp lịch** cuộc chồng nhau — reader
đậu lại trong `getFile()` trong khi writer hoàn tất — chứ không trông chờ timing. Check 'the index is written one row at a
time, never as a snapshot' ([tmcut_byte_cache.spec.ts:213](file:///D:/Applications/tm-studio/tests/unit/tmcut_byte_cache.spec.ts#L213))
đã chạy **đỏ** (`undefined !== 600`) trước khi có `touchIndexRow`; check 'a row never claims bytes the file does not have'
(:238) đỏ với `actual: [Blob], expected: null`.

### 44.4 Nối dây: năm chỗ sửa, một đường cũ retire

| Chỗ | Dòng hiện tại | Thay đổi |
| --- | --- | --- |
| `app/composables/useTmcutMedia.ts:964` | 964-979 | `loadWaveform` đi qua service; `waveformCache` giờ **key theo fingerprint** chứ không theo tên file trên server |
| `app/composables/useTmcutMedia.ts:133` | 130-135 | "Clear cache" xóa luôn hàng nhớ trong memory — hàng đó chỉ là convenience over store, để lại là vẽ bar của thứ vừa bỏ |
| `app/composables/useTmcutMedia.ts:832` | 826-835 | re-check thấy revision đổi → quên hàng nhớ của revision cũ |
| `app/composables/useTmcutMedia.ts:898` | 891-900 | relink quên theo **fingerprint cũ**, không theo `oldWaveformPath`; artifact cất dưới tên fingerprint cũ do `pruneByteCache` giải phóng, vì thư viện không còn kê nó |
| [TmcutMediaPanel.vue:545](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutMediaPanel.vue#L545) và [TmcutTimelineClip.vue:210](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutTimelineClip.vue#L210) | 545 / 210 | bỏ cổng `asset.waveformPath` — một asset audio **không cần** file server nào để có bar |

Đường retire nằm ở nhánh audio của re-check (:844-858): trước đây nó null pointer **và xếp hàng `analyzeAsset`** — một vòng
IPC/server để FFmpeg viết lại JSON. Giờ bar là câu trả lời của browser nên pointer cũ chỉ còn là một đường dẫn chết, bỏ nó
không mất gì vì audio không cần phân tích lại. `asset.waveformPath` vẫn còn trong schema và desktop IPC vẫn ghi nó
(:463): lượt này retire **đường đọc**, chưa retire **trường**.

### 44.5 Bằng chứng live — đúng phần ADR-033 chờ từ C2b

Chromium, web runtime trên `:4003`, import một file WAV tự tổng hợp (duy nhất để không dính dedupe của
`importWebFiles`), rồi tải lại trang:

| Đo | Trước reload | Sau reload |
| --- | --- | --- |
| `tmcut_byte_index_v1` | `{ adfcda50: 48044, adfcda50-wave-v1: 1302 }` | **đúng hai row đó**, row artifact vẫn 1302 byte |
| `accessedAt` của `adfcda50-wave-v1` | 1793871451863 | **1793871506846** — tiến, tức trang này **đã đọc** artifact |
| `accessedAt` của `adfcda50` (revision) | 1793871451762 | **1793871451762** — đứng nguyên, tức nó **không** bị mở ra |
| Resource entries kết thúc `.wav` | — | **0** — không một request nào tới `/uploads/` cho audio |
| Số shape của dải bar trên card | 200 | **200** — bar vẽ ra thật, không phải placeholder |
| Hàng cache trong media panel | `48.2 KB · 2 file` | `48.2 KB · 2 file` |

Hàng thứ hai và thứ ba là cả luận điểm: reload đọc **artifact** mà không đọc **file**. §18 của audit (đo 2026-11-04) còn ghi
"bytes nằm trong máy hôm nay là bytes **được giữ**, chưa phải bytes **được dùng**" — với leg waveform, vế sau đã đổi.

### 44.6 Falsification

Bốn mutation, bốn run, mỗi cái restore byte-identical (`md5sum`: `waveformService.ts` `af66537f…`, `byteStore.ts`
`75789f38…`), và hai spec chạy lại xanh sau restore (28/28 và 11/11).

| Mutation | Kết quả |
| --- | --- |
| Service bỏ đường đọc artifact (`readCachedBytes(key)` → `null`) | waveform service spec **FAILED** ở `a cached waveform is read instead of decoded` (`deepStrictEqual` hai dãy bar) |
| Service bỏ gộp job (`if (running) return running` vô hiệu) | **FAILED** ở `a panel and a timeline clip cost one decode` — `2 !== 1` |
| Reader ghi **cả snapshot** index (đúng hình hài code HEAD) | byte cache spec **FAILED** ở `and the index still names them` — `undefined !== 600`, tức đúng số đo mồ côi lấy ngoài máy |
| Writer kê row **trước** khi bytes landing + reader tin file rỗng (đúng cặp hình hài code gây triệu chứng `bytes: 0`) | **FAILED** ở `and an empty file answers nothing` |

Một sai số trung thực phải ghi lại: **từng vế một của mutation cuối thì không sập**. Kê row sớm một mình vẫn xanh vì guard
`blob.size === 0` đỡ nó; bỏ guard size một mình vẫn xanh vì row chưa kịp tồn tại. Hai guard **che lẫn nhau**, và check chỉ
sập khi thiếu **cả hai** — tức đúng cái đã ship. Check đó pin *tổ hợp*, không pin từng guard, và docs này không được phép
nói nó chứng minh từng guard một là cần thiết.

### 44.7 Gate

| Gate | Lệnh | Kết quả |
| --- | --- | --- |
| 1 Typecheck | `npx nuxt typecheck` | exit **0**, `0` × `error TS`; `.nuxt/eslint.config.mjs` regenerate lúc 16:34, 28581 B |
| 2 Lint | `npx eslint` trên **7** file chạm, chạy **sau** 16:34 | exit **0**, 0 problem |
| 3 Unit | `npx tsx tests/unit/run-all.mts --smoke` | **126/126** specs, exit **0** (125 của G1 + `tmcut_waveform_service` mới); `tmcut_byte_cache` **28/28**, `tmcut_waveform_service` **11/11** |
| 3 Core | `node --test packages/core/test/*.test.mjs` | **717/717** exit 0 (714 của G1 + 3 check `waveformCacheKey`); `npx tsc -p packages/core --noEmit` exit **0** |
| 4 Live | `:4003`, Chromium | phép đo §44.5, cộng số đo console ở §44.8 |
| 5 Dọn dẹp | file scratch + `/uploads/` của chúng | **0** bản `g2-` còn lại trong `.data/uploads`; library/index/OPFS của trình duyệt đã xóa |

### 44.8 Chưa chứng minh / nợ

- **Desktop controller còn nguyên.** `electron/tools/tmcut.controller.cjs:420`
  vẫn ghi zeros kèm `ok:true`, `:402-406` vẫn guard bằng `Array.isArray(cached.buckets)`. Đường đọc mới chưa cho phép gỡ
  đường cũ trên host đó — việc của I/J.
- **`asset.waveformPath` chưa retire.** Trường vẫn ở trong schema và IPC desktop vẫn ghi nó
  (`app/composables/useTmcutMedia.ts:463`). Đã retire **đường đọc**,
  chưa retire **trường**, và chưa có quyết định migrate.
- **`clampWaveformPoints` không còn call-site nào** trong `app/**` — `git grep -c` trả **1** kết quả, và đó là dòng re-export ở
  [waveform.ts:9](file:///D:/Applications/tm-studio/app/utils/tmcut/waveform.ts#L9). Để lại vì core vẫn là chỗ khai báo luật
  clamp; nếu một lượt sau xác nhận không ai cần thì đó là một dòng re-export bị gỡ, không phải một loss.
- **Chỉ web runtime.** §44.5 đo trên Chromium/web. Electron host (OPFS trong packaged app), IndexedDB fallback, và quota thật
  của thiết bị chưa đo lại lượt này; defect B là OPFS-specific nên đường IDB không có số đo concurrent.
- **Playhead audio chưa có gì.** G2 giao **bar**, không giao **tiếng**: mixer, gain per-layer và đồng bộ thuộc G3 (#139);
  gap/overlap/sync/trim/rate và close-out ADR-033 thuộc G4 (#140).
- **Console live còn một `[error]` môi trường:** `401` của `GET /api/v1/ai/relay/catalog` trên editor/templates/factory.
  Nguồn ở [catalog.get.ts:11](file:///D:/Applications/tm-studio/server/api/v1/ai/relay/catalog.get.ts#L11) — route tự chặn khi
  `event.context.auth` vắng, `/api/v1/auth/me` vẫn trả 200. Pre-existing, không phải của lượt này, và không được tính là
  PASS im lặng.

## 45. Slice G3 — mixer Web Audio đọc luật gain của core; hai mutation sống, và lý do chúng sống (đo ngày 2026-11-05)

### 45.1 Việc của lượt này, và hiện trạng đo được ở HEAD `83fb02c`

§44.8 để lại một món nợ đúng một dòng: "G2 giao **bar**, không giao **tiếng**". G3 trả món đó: một graph Web Audio mà tập
nguồn đang kêu là **câu trả lời của core**, không phải một phép tính nữa ở app. Đo trước lượt này — và đo ra là preview
đang có **hai** bản sao của một luật, export có bản thứ ba:

| Chỗ | Dòng (HEAD) | Hiện trạng đo được |
| --- | --- | --- |
| `git grep -n "createMediaElementSource\\|AudioContext" HEAD -- app electron` | — | **1** kết quả, ở [mediaProbe.ts:59](file:///D:/Applications/tm-studio/app/utils/tmcut/mediaProbe.ts#L59) — một capability sniff. Toàn app **không có** một node audio nào |
| `git grep -n audioMixAt HEAD` | — | **0** kết quả — core chưa từng được hỏi "tick này ai kêu" |
| [TmcutPreviewPlayer.vue:1665-1666](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue) | 1665-1666 | footage: `:muted="isVideoMuted \|\| previewMuted"` + `:volume="videoVolume * previewVolume"` |
| `…/TmcutPreviewPlayer.vue:478-499` | 478-499 | **bản sao thứ nhất**: player tự dựng `shaped = { fade, volume: v * (trackVol / 100), timeline }` rồi gọi `gainAt` của core — đúng luật, nhưng **một lần tính riêng cho preview** |
| `…/TmcutPreviewPlayer.vue:570-586` | 570-586 | **bản sao thứ hai**: `((clip.volume ?? 100) * trackVol / 10000) * previewVolume.value` — và **không có fade envelope**. Một bed fade-in chạy full-level trên màn hình trong khi export fade nó |
| `…/TmcutPreviewPlayer.vue:1766-1767` | 1766-1767 | audio: `:muted="a.muted"` + `:volume="a.volume"` — binding thứ ba và thứ tư của cùng một con số |
| `app/utils/tmcut/render/audio.ts:13` và `app/utils/tmcut/render/video.ts:393` | 13-18 / 393-401 | **bản sao thứ ba**, viết ra chuỗi `volume=…`: preview và export là hai chương trình khác nhau đọc cùng một project |
| mute | 1665 / 1766 | đường duy nhất để im lặng là `:muted=` trên element — không có chỗ nào cho một mức master dùng chung |

Ba binding `:volume`/`:muted` và hai công thức riêng là thứ mà ADR-033 gọi là drift tiềm tàng: thêm một loại layer nữa là
thêm một chỗ phải nhớ nhân đúng các thừa số.

### 45.2 Luật chọn: `audioMixAt` là một SELECTION, không phải công thức thứ hai

[audioMix.mjs](file:///D:/Applications/tm-studio/packages/core/src/audioMix.mjs) (86 dòng) không có một phép nhân nào.
Nó đọc `compositePlan` rồi **chọn**: [gainOf :33-35](file:///D:/Applications/tm-studio/packages/core/src/audioMix.mjs#L33)
trả `layer.volume`, và trả `0` khi `layer.audible === false` — tức mute đã được evaluator fold một lần duy nhất.

| Nhánh | Dòng | Luật |
| --- | --- | --- |
| footage | [:52-63](file:///D:/Applications/tm-studio/packages/core/src/audioMix.mjs#L52) | duyệt slot, bỏ overlay, **chỉ nhận `role: 'paint'`** (`:54`), và chỉ **một** lần (`footageClaimed`). Tiếng của file thuộc hàng dưới cùng đang sơn — cùng hàng mà export concat |
| audio | [:65-80](file:///D:/Applications/tm-studio/packages/core/src/audioMix.mjs#L65) | **mọi** hàng audio đang sống, theo thứ tự track; `hidden` không chặn tiếng, `muted` thì có |
| trả về | [:82-85](file:///D:/Applications/tm-studio/packages/core/src/audioMix.mjs#L82) | `{ at, sources }` — một tick không có gì live trả tập rỗng, không trả `null` |

`role: 'outgoing'` bị bỏ ở `:54` là một quyết định có tên: trong một crossfade, **clip đến** là thứ đang kêu, không phải clip
đang rời đi. Check 'a transition window leaves the sound with the layer that paints'
([audio-mix-plan.test.mjs:96](file:///D:/Applications/tm-studio/packages/core/test/audio-mix-plan.test.mjs#L96)) pin cả hai
chiều: `deepEqual(roles, ['outgoing/out', 'paint/in'])` (:116) chứng minh plan **thật sự** có hai slot, rồi
`gainOf(mix,'in') === 0.6` / `gainOf(mix,'out') === null` (:120-121) chứng minh chỉ một slot được chọn. Tổng core cho file
này: **11** check.

### 45.3 Graph: một node cho một nguồn, một đường viết, năm lời từ chối

[audioMixer.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/audioMixer.ts) (225 dòng) giữ **graph**, không giữ **luật**.
`createAudioMixer(openGraph)` (:119) nhận graph như tham số — vì browser cần một gesture trước khi context chạy, và mọi lời
từ chối dưới đây phải đo được trong Node, nơi không có AudioContext.

| Từ chối | Dòng | Lý do |
| --- | --- | --- |
| Route một element hai lần | [:131-168](file:///D:/Applications/tm-studio/app/utils/tmcut/audioMixer.ts#L131) | `createMediaElementSource` **ném** ở lần thứ hai; re-attach cùng element cùng key trả đúng node cũ |
| Nguồn cross-origin | [isRoutableMediaSrc :98-110](file:///D:/Applications/tm-studio/app/utils/tmcut/audioMixer.ts#L98) | CORS làm **tainted** element im lặng ngay khi vào graph — một stock clip đang kêu sẽ thành câm. `blob:`/`data:`/đường dẫn tương đối được, `media://local` của desktop **không** |
| Graph chưa mở khóa | `attach` (:134-140) | context dựng trước gesture ở trạng thái `suspended`; route vào đó = silence. Trước click đầu tiên, mix đi trên element |
| Viết cả hai đường một lúc | [:165](file:///D:/Applications/tm-studio/app/utils/tmcut/audioMixer.ts#L165) và [:179-194](file:///D:/Applications/tm-studio/app/utils/tmcut/audioMixer.ts#L179) | element vừa vào graph được set `volume = 1` **một lần** rồi không bị viết nữa; node và element cùng giảm âm sẽ **bình phương** mọi gain |
| Graph chết | [:204-210](file:///D:/Applications/tm-studio/app/utils/tmcut/audioMixer.ts#L204) | `dispose` trả node về và để đường element còn chạy — mất graph không mất tiếng |

Hai luật còn lại là lý do mix không bao giờ tự bịa số: một nguồn **không có trong plan** thì bằng 0
([applyPlan :196-202](file:///D:/Applications/tm-studio/app/utils/tmcut/audioMixer.ts#L196), dòng `:200`), và master nằm trên
**bus** chứ không nhân vào từng layer (:179-194). `decode`/`openGraph` là tham số, không phải import trong lòng luật —
giống hệt quyết định G2 đã ghi ở §44.2.

### 45.4 Nối dây: hai bản sao luật nghỉ việc, bốn binding biến mất

| Chỗ | Dòng hiện tại | Thay đổi |
| --- | --- | --- |
| [useTmcutPlayback.ts:190](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L190) | 190, export ở :724 | `audioMix = computed(() => audioMixAt(playheadEvaluation.value))` — đọc **đúng evaluation mà picture đã sơn**, nên không có lần đánh giá thứ hai mỗi frame |
| [TmcutPreviewPlayer.vue:499-580](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L499) | 499-580 | khối mix: `ensureMixGraph` (:515), `createAudioMixer` (:546), `mixGains` theo key (:551), `mixMaster` (:561), `syncMix` (:563) và `mixSignature` + watch `flush: 'post'` (:573-580) |
| `…/TmcutPreviewPlayer.vue:478-499` (HEAD) | — | **xóa** `videoVolume` + `isVideoMuted` + `localTicks` — bản sao thứ nhất nghỉ việc |
| `…/TmcutPreviewPlayer.vue:570-586` (HEAD) | — | **xóa** `muted`/`volume` trong `activeAudioSrcs` — list giờ chỉ còn vật liệu mount (`id`, `src`, `mediaTime`, `rate`); fade của bed lần đầu có đường về preview |
| template | 1711-1733 / 1820-1835 | bỏ **bốn** binding `:muted`/`:volume`; số binding `:volume` trong file: HEAD **2** → nay **0** (`grep -c ":volume="` = 0) |
| [:599](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L599) và [:1479](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L1479) | 599 / 1479 | clip bị xóa thì `mixer.detach(clipId)` trả node (luật F10 áp cho audio); unmount thì `dispose()` + `context.close()` |
| [TmcutInspector.vue:500](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutInspector.vue#L500) và :1911 | 500 / 1911 | hai dòng chú thích còn nói "the preview ramps video.volume through core gainAt" — viết lại thành "core's mix gain", vì đường đó đã nghỉ việc ở lượt này |

Guard mới ở [tmcut_audio_mixer.spec.ts:271](file:///D:/Applications/tm-studio/tests/unit/tmcut_audio_mixer.spec.ts#L271) và
:288 đọc **nguồn** của hai file để pin phần này: player phải gọi mixer, và player **không được** còn tính gain riêng.
Tổng: **15** check (bản đầu là 14; check :163-174 được thêm vì một mutation sống — xem §45.6).

### 45.5 Bằng chứng live — footage leg lần đầu có số đo non-zero

Tab Chromium thật (chrome-devtools, :4003, `/tmcut/editor`), project "Untitled Project" với một clip video trên `t-video-1`.
Số đo lấy bằng cách đọc chính instance của player (`__vueParentComponent.setupState` → `mixer.gainOf`, `mixer.masterGain`,
`audioMix.sources`) rồi **ghi vào store** cùng một level mà người dùng would drag slider — mutate `clip.volume`,
`track.volume`, `track.muted` của `currentProject`, chờ một tick, đọc lại node. Ghi chú phương pháp: `setupState` là
proxyRefs đã unwrap nên phải viết `st.previewVolume = 0.6`, **không** phải `.value =`.

| Thao tác | Plan của core | Node trong graph | `video.volume` |
| --- | --- | --- | --- |
| trạng thái đầu (clip 100, track không có key `volume`) | `footage:1` | **1** | 1 |
| `clip.volume = 40` | `footage:0.4` | **0.4000000059604645** | 1 |
| thêm `track.volume = 50` | `footage:0.2` | **0.20000000298023224** | 1 |
| thêm `track.muted = true` | `footage:0` | **0** | 1 |
| `clip.volume = 100` khi vẫn mute | `footage:0` | **0** — mute thắng, đúng luật `audible` | 1 |
| bỏ mute | `footage:0.5` | **0.5** | 1 |
| khôi phục nguyên trạng | `footage:1` | **1** | 1 |
| `previewVolume = 0.6` | không đổi | node vẫn **1** | 1 |
| `previewMuted = true` | không đổi | bus **0**, node vẫn 1 | 1 |
| `track.volume = 25` sau khi điều hướng route | `footage:0.25` | **0.25** | 1 |

Bốn điều đọc ra từ bảng: node đi theo **đúng dãy số core trả** (kể cả dấu làm tròn float32 của AudioParam,
`0.4000000059604645`), nên preview không tự tính gì; **master nằm trên bus** — kéo fader không chạm từng layer; element đã
route giữ `volume = 1` qua **mười** lần viết, tức một đường viết thật; và sau khi route sang `/tmcut` rồi quay về
`/tmcut/editor`, `mixContext.state` vẫn `running` và node dựng lại đúng mức của plan.

Lượt đo **trước** trong cùng slice (khi timeline có một clip audio `tone.wav` trên `t-audio-1`) thêm được nhánh audio:
`routed = ['footage', 'clip_1793876066571_903y']`, clip volume 40 → node 0.4000000059604645, track volume 50 →
0.20000000298023224, track mute → 0, xóa clip → routing co lại còn `['footage']` (đường `detach`), và không lần nào
`createMediaElementSource` ném. Hai hàng cuối của §45.1 (fade của bed) giờ có nghĩa trên màn hình: cùng một envelope mà
`evaluateTimeline` fold vào `layer.volume` là con số node nhận.

### 45.6 Falsification — hai mutation sống, và lý do chúng sống

| # | Mutation | Kết quả |
| --- | --- | --- |
| M1 | mixer bỏ `element.volume = 1` khi vào graph ([audioMixer.ts:165](file:///D:/Applications/tm-studio/app/utils/tmcut/audioMixer.ts#L165)) | **RED** — `FAILED: … entering the graph gives the element its unity back / 0.4 !== 1` tại [tmcut_audio_mixer.spec.ts:131](file:///D:/Applications/tm-studio/tests/unit/tmcut_audio_mixer.spec.ts#L131), exit **1** |
| M2 | core bỏ vế `slot.role !== 'paint'` ở [audioMix.mjs:54](file:///D:/Applications/tm-studio/packages/core/src/audioMix.mjs#L54) | **SỐNG lần đầu**: `node --test test/audio-mix-plan.test.mjs` in `tests 10 / pass 10 / fail 0`, exit 0 |
| M2 (sau khi đóng) | cùng mutation, chạy lại với check mới | **RED** — `AssertionError … actual: null, expected: 0.6`, `tests 11 / pass 10 / fail 1` |
| M3 | master bị nhân vào **từng layer** chứ không chỉ bus (`entry.gain.gain.value = layer * level` ở [:184](file:///D:/Applications/tm-studio/app/utils/tmcut/audioMixer.ts#L184)) | **RED** — `FAILED: … the layer keeps the number core answered / 0.2 !== 0.5` tại :214, exit **1** |
| M4 | `applyPlan` không còn silence key ngoài plan (xóa [:200](file:///D:/Applications/tm-studio/app/utils/tmcut/audioMixer.ts#L200)) | **RED** — `FAILED: … the plan is the only set that sounds / 0.4 !== 0` tại :206, exit **1** |
| M5 | `isRoutableMediaSrc` tin mọi địa chỉ (thân hàm bị chặn ngay đầu) | **RED** — `FAILED: … a cross-origin source is not routed / true !== false` tại :157, exit **1** |
| M5 (vế hẹp) | chỉ đổi phép **so sánh origin** ở [:106](file:///D:/Applications/tm-studio/app/utils/tmcut/audioMixer.ts#L106) thành `return true` | **SỐNG lần đầu**: `14/14 checks PASSED` (spec **chưa** có check :163), exit **0** |
| M5 (sau khi đóng) | cùng mutation hẹp, chạy lại với check mới | **RED** — `FAILED: … a foreign origin is not routed / true !== false` tại :169, exit **1** |

Hai mutation sống, và chúng **cùng một hình hài lỗ hổng**: một check hỏi một câu **hợp**.
M2 sống vì fixture crossfade mô tả transition bằng `transition: { in: { … } }` trong khi evaluator chỉ dựng
`transition.role` khi clip mang **`transitionIn`** ([transitions.mjs:628-641](file:///D:/Applications/tm-studio/packages/core/src/transitions.mjs#L628)
đọc `clip.transitionIn?.duration`). Một probe trực tiếp trên fixture đó in ra `slots: footage/paint/in` — **không** có slot
`outgoing` nào, nên vế `role !== 'paint'` chưa từng được hỏi tới; check đó trông như pin crossfade nhưng thật ra chỉ pin "clip
sau thắng clip trước khi chồng nhau". Check mới (:96) dựng đúng **hình hài đã apply** của crossfade (incoming shift trái một
`duration`, window `[3s, 4s]`) và assert cả `compositePlan` lẫn `audioMixAt`, nên nó không thể xanh vì lý do sai.
M5-vế-hẹp sống vì **chính cái harness**: check ở :155 gọi `attach`, mà trong Node thì `pageOrigin()` rỗng, nên lời từ chối
`if (!origin) return false` ([:104](file:///D:/Applications/tm-studio/app/utils/tmcut/audioMixer.ts#L104)) chặn địa chỉ cross-origin
**trước** phép so sánh ở :106 — check xanh vì một lý do không phải vế mà nó kê tên. Check mới (:163-174) gọi thẳng
`isRoutableMediaSrc(src, origin)` với origin tường minh nên mỗi vế tự trả lời một câu, và **đúng** mutation hẹp đó thành RED.
Spec mixer từ **14** check lên **15**; đó là con số dùng ở §45.7.

Sáu mutation, bảy run, mỗi file restore byte-identical — `md5sum` sau restore: `audioMix.mjs` `a41b9eef6624e0702a6c9fff74e4edf6`,
`audioMixer.ts` `a4b4e32ab0ff4de73a75b1f8f481e4de` — và hai spec chạy lại xanh sau mỗi lần restore
(mixer **15/15** exit 0, core audio-mix **11/11** exit 0).

### 45.7 Gate

| Gate | Lệnh | Kết quả |
| --- | --- | --- |
| 1 Typecheck | `npx nuxt typecheck` | exit **0**, `0` × `error TS`; `.nuxt/eslint.config.mjs` regenerate 18:12:53, 28581 B |
| 2 Lint | `npx eslint` trên **8** file chạm, chạy **sau** 18:12:53 | exit **0**, log rỗng (0 problem) |
| 3 Unit | `npx tsx tests/unit/run-all.mts --smoke` | **127/127** specs, exit **0**, **127** dòng `PASS`, **0** dòng `FAIL` (126 của G2 + `tmcut_audio_mixer` mới); `tmcut_audio_mixer` **15/15**, `tmcut_preview_boundary` **8/8** |
| 3 Core | `node --test "test/*.test.mjs"` trong `packages/core` | **728/728** exit 0 (717 của G2 + **11** check `audioMixAt`); `npx tsc -p . --noEmit` exit **0**, 0 `error TS` |
| 4 Live | `:4003`, Chromium tab thật, 5 route | số đo §45.5; console: `/tmcut` và `/tmcut/autocut` **0** `[error]`, `/tmcut/editor` **4** × `401`, `/tmcut/templates` và `/tmcut/factory` **1** × `401` — tất cả là `GET /api/v1/ai/relay/catalog` **môi trường**, pre-existing (§44.8), không phải của lượt này |
| 5 Dọn dẹp | mutation restore, browser state | hai file chạm md5-verified; `track.volume` trả về **không có key**, clip volume 100, bus 1, node 1, `routed = ['footage']`, 2 clip nguyên |
| — Tests tsconfig | `npx tsc -p tsconfig.test.json --noEmit` | **không phải gate**: **2940** `error TS` trên toàn `tests/**`, một lớp pre-existing (TS2835 "relative import cần extension" vì `moduleResolution: nodenext`). File của lượt này chỉ mang **hai** dòng TS2835 ở :30/:100 — **không** dòng nào mới, và không dòng nào rơi vào check :163-174 |

### 45.8 Chưa chứng minh / nợ

- **Tai người chưa đo.** Mọi số ở §45.5 là **giá trị node**, không phải âm thanh phát ra. Không một fixture nào trong repo có
  audio stream (đo: `h264.mp4` và các bản `.data/uploads/*.mp4` trả `audio=none`), nên "nghe có đúng không" vẫn là một câu
  mở — và footage leg trên máy này **có** node đúng nhưng **không có** tiếng để đo.
- **Desktop từ chối route theo thiết kế.** `media://local` không đi vào graph (§45.3), nên trên Electron host mix vẫn chạy
  trên element: đúng luật, nhưng **chưa đo lại** trên packaged app.
- **Playback vẫn là bytes trên server.** Gate 4 ghi nhận `GET /uploads/…tone.wav [206]` và hai bản `.mp4 [206]` khi editor
  mount — tức ADR-033 còn nguyên vế "playback": bytes về máy đã có cache (D2/E4/G2) nhưng **element vẫn stream từ server**.
  Đóng vế đó cần nguồn `blob:` từ byte cache, thuộc #140 / slice H.
- **Nợ upload của lượt trước.** Bốn bản `.data/uploads/mw3f…` do probe của G2/G3 đưa lên vẫn còn trên đĩa; hai bản
  (`mw3fhrja-…tone.wav`, `mw3fho19-…probe.mp4`) vẫn được **library** tham chiếu nên chưa xóa — xóa là một việc của lượt sau
  và phải làm cả thư viện lẫn đĩa.
- **`previewVolume` vẫn là 0..1 thuần app.** Core không có luật cho master monitoring; đó là lựa chọn (thiết bị của người
  dùng quyết), nhưng nó có nghĩa là **không** có guard nào cho một caller khác muốn cùng một mức.
- **Console còn `[error]` môi trường:** `401 /api/v1/ai/relay/catalog` ([catalog.get.ts:11](file:///D:/Applications/tm-studio/server/api/v1/ai/relay/catalog.get.ts#L11)) —
  hàng này đã ghi ở §44.8, lượt này đo lại và giữ nguyên attribution, không tính là PASS im lặng.
- **Gap/overlap/sync/trim/rate chưa có gì.** G3 giao **mức**, không giao **thời gian**: các check đồng bộ playhead audio,
  overlap hai bed, trim và rate thuộc G4 (#140), cùng phần close-out ADR-033.

## 46. Slice G4 — audio nghe theo **thời gian** của core: trim, gap, overlap, rate — và một trần tốc độ duy nhất (đo ngày 2026-11-05)

### 46.1 Việc của lượt này, và hiện trạng đo được ở HEAD `f2524b8`

§45.8 để lại đúng một dòng nợ: G3 giao **mức**, không giao **thời gian**. G4 trả nó: ở một tick, câu hỏi "file này đang ở
chỗ nào, chạy nhanh cỡ nào, và một element có chạy được không" phải là **một câu trả lời của core cho cả hai leg**. Đo
trước lượt này — luật thời gian sống ở app, và nó **không cùng trần** với luật của picture:

| Chỗ | Dòng (HEAD) | Hiện trạng đo được |
| --- | --- | --- |
| `git grep -c clipMediaTimeSec HEAD -- app` | — | **5** kết quả — luật "vị trí trong file" **chỉ** tồn tại ở app, core không biết tới nó |
| [TmcutPreviewPlayer.vue:629](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue) | 629 (HEAD) | `mediaTime: clipMediaTimeSec(clip, renderSeconds.value)` — preview tự tính seek target cho audio |
| `…/TmcutPreviewPlayer.vue:603-619` | 603-619 (HEAD) | `activeAudioClips`: app **tự quét** hàng audio theo `clipStartSec`/`clipEndSec`, và `if (clip.reverse) continue` — từ chối **im lặng**, không có tên, không có chỗ nào để hỏi |
| `…/TmcutPreviewPlayer.vue:630` | 630 (HEAD) | `rate: clip.speed && clip.speed >= 0.25 && clip.speed <= 4 ? clip.speed : 1` — trần audio là **4** |
| [useTmcutPlayback.ts:332](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts) | 332 (HEAD) | `Math.min(16, Math.max(0.25, shuttle * speedAt(clip, at)))` — trần của picture là **16**, và shuttle nhân **sau** khi curve đã được đọc riêng |
| `app/utils/tmcut/render/audio.ts:53` | 53-54 | `aSpeed = clip.speed` → `asetpts=(PTS-STARTPTS)/aSpeed` — **không** clamp, **không** curve |
| `git grep -c "Math.min(16, Math.max(0.25" HEAD -- app` | — | **1** |

Ba chỗ, **ba trần khác nhau** (4 / 16 / không trần) cho cùng một con số. Hệ quả đọc được thẳng từ dòng :630: một clip **6×**
chạy picture 6× nhưng rơi vào nhánh `: 1` của audio — tiếng chạy một phần tư tốc độ hình, và đó là lý do `activeAudioSrcs`
không thể là nguồn sự thật. Ramp còn lệch thêm một tầng: [clipTime.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/clipTime.ts)
giữ `clipMediaTimeSecLinear` **bỏ qua curve** có chủ đích, để bed audio "khớp" export — trong khi embedded audio của footage
đã warp theo curve từ slice F4. Hai leg audio của **cùng một clip** đi hai đường.

### 46.2 Luật mới nằm trong core

| chỗ | dòng | nội dung |
| --- | --- | --- |
| [retime.mjs:135](file:///D:/Applications/tm-studio/packages/core/src/retime.mjs#L135) và :137 | 135 / 137 | `ELEMENT_RATE_MIN = 0.25`, `ELEMENT_RATE_MAX = 16` — cửa sổ element, **một** chỗ khai báo |
| [retime.mjs:144](file:///D:/Applications/tm-studio/packages/core/src/retime.mjs#L144) | 144 | `clampedElementRate(rate, shuttle = 1)` — shuttle là **tham số**; clamp ở [:149](file:///D:/Applications/tm-studio/packages/core/src/retime.mjs#L149) áp lên **tích đã compose**, không áp lên từng thừa số |
| [retime.mjs:153](file:///D:/Applications/tm-studio/packages/core/src/retime.mjs#L153) | 153 | `elementRate(clip, atTicks, shuttle)` — luật đầy đủ cho một clip, ramp hay không ramp |
| [evaluate.mjs:292-293](file:///D:/Applications/tm-studio/packages/core/src/evaluate.mjs#L292) | 292-293 | mỗi layer mang thêm `sourceRate: speedAt(clip, localTicks)` và `reverse` — evaluation tự kể tốc độ của nó tại tick đã sơn |
| [audioMix.mjs:52-58](file:///D:/Applications/tm-studio/packages/core/src/audioMix.mjs#L52) | 52-58 | `playoutOf(layer, shuttle)` — bốn field thời gian cho **cả hai** leg |
| [audioMix.mjs:77](file:///D:/Applications/tm-studio/packages/core/src/audioMix.mjs#L77) | 77 | `audioMixAt(evaluation, { shuttle })` — host **giao** đồng hồ của mình cho core thay vì nhân ở đầu kia |

| Field mỗi source | Dòng | Luật |
| --- | --- | --- |
| `mediaTicks` | [:55](file:///D:/Applications/tm-studio/packages/core/src/audioMix.mjs#L55) | `layer.sourceTicks` khi hữu hạn, ngược lại `null` — **chính** con số mà picture đã được sơn theo, nên trim/speed/ramp đã fold xong |
| `rate` | [:56](file:///D:/Applications/tm-studio/packages/core/src/audioMix.mjs#L56) | `clampedElementRate(layer.sourceRate, shuttle)` — một trần 0.25..16 dùng chung footage và audio |
| `plays` | [:57](file:///D:/Applications/tm-studio/packages/core/src/audioMix.mjs#L57) | `refusal === null` — element có chạy được không |
| `refusal` | [:53](file:///D:/Applications/tm-studio/packages/core/src/audioMix.mjs#L53) và :58 | **tên** của lời từ chối; hiện tại một giá trị duy nhất `'reverse'`, vì `HTMLMediaElement` không phát ngược |

`audioMixAt` vẫn là **selection** như §45.2 — không một phép nhân gain nào mới xuất hiện; `playoutOf` chỉ được gọi ở hai
chỗ push (footage [:84-92](file:///D:/Applications/tm-studio/packages/core/src/audioMix.mjs#L84) và audio), nên mọi source
đều mang đúng bốn field.

### 46.3 Nối dây: những bản sao nghỉ việc, đo bằng `grep`

| Tên | HEAD | Nay | Đường mới |
| --- | --- | --- | --- |
| `clipMediaTimeSec` | **5** | **0** | xóa khỏi `clipTime.ts` (file **101 → 65** dòng, `wc -l`); seek target đọc `source.mediaTicks` |
| `clipMediaTimeSecLinear` | (trong file) | **0** | exit cùng luật — không còn "bản đồ bỏ qua curve" nào ở app |
| `activeAudioClips` | **2** | **0** | scan hàng audio nghỉ việc; [:604](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L604) `audioClipsById` chỉ còn để **tra `src`** |
| `clip.speed >= 0.25` | **1** | **0** | trần 4 nghỉ việc |
| `Math.min(16, Math.max(0.25` | **1** | **0** | clamp riêng của footage nghỉ việc |
| `speedAt(` trong composable | **1** | **0** | [:337](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L337) `elementRate(clip, at, shuttle)` — số hit `elementRate(` = **1** |

Bốn con số 0 ở trên đo bằng `grep -rF <tên> app | wc -l`, và `git grep -c … HEAD -- app` cho cột HEAD — tức lượt này **gỡ**,
không phải **thêm chỗ thứ hai**.

| Chỗ nối | Dòng hiện tại | Nội dung |
| --- | --- | --- |
| [useTmcutPlayback.ts:194](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L194) | 194 | `audioMixAt(playheadEvaluation.value, { shuttle: Math.abs(shuttleRate.value) })` — mix đọc **đúng** evaluation picture đã sơn, và giao shuttle cho core |
| `…/useTmcutPlayback.ts:330-338` | 330-338 | `mediaRate(clip)` giờ là một lời gọi `elementRate`; nhánh `if (!clip) return Math.max(0.1, shuttle)` giữ nguyên (không có footage thì chỉ còn shuttle) |
| [TmcutPreviewPlayer.vue:614-626](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L614) | 614-626 | `activeAudioSrcs` **duyệt plan**: bỏ `role !== 'audio'`, bỏ `!source.plays`, bỏ `mediaTicks === null`, rồi `mediaTime: ticksToSec(source.mediaTicks)` và `rate: source.rate` |
| [:647](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L647) và :648-656 | 647-656 | `el.playbackRate = a.rate` cho element audio; paused thì mirror playhead, đang chạy thì sửa lệch khi quá `0.35` s — **ngưỡng** là của app, **vị trí** là của core |
| [template :1829-1834](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L1829) | 1829-1834 | `<audio v-for="a in activeAudioSrcs">` không còn binding nào tính thời gian |

Bốn assertion trong `tmcut_time_domain.spec.ts` (check 'media time stays in the seconds domain') nghỉ theo luật bị gỡ — spec
từ 7 check xuống **6**. Luật đó giờ sống ở nơi nó được quyết: [audio-time-plan.test.mjs:54](file:///D:/Applications/tm-studio/packages/core/test/audio-time-plan.test.mjs#L54)
/:65 (vị trí + trim) và `evaluate.test.mjs` cho `sourceTicks`; reverse ở [:144](file:///D:/Applications/tm-studio/packages/core/test/audio-time-plan.test.mjs#L144).
Guard mới [tmcut_audio_mixer.spec.ts:296](file:///D:/Applications/tm-studio/tests/unit/tmcut_audio_mixer.spec.ts#L296) đọc **nguồn**
của hai file app để pin phần retirement: phải có `mediaTicks` và `elementRate`, phải **không** còn ba cái tên cũ và `if (clip.reverse) continue`.

### 46.4 Quyết định ramp: preview đi theo curve, file FFmpeg thì không

Trước G4, bed audio đi `clipMediaTimeSecLinear` (cố tính bỏ curve) **để khớp** export; nhưng embedded audio của footage đã
warp theo curve từ F4 — nghĩa là **hai leg audio của cùng một clip ramp lệch nhau giữa chừng**. G4 chọn một luật (curve) cho
cả hai leg preview, vì preview là thứ người dùng nghe để quyết định cắt.

Hệ quả đo được, ghi thẳng vào nợ: export vẫn `aSpeed = clip.speed` **hằng số**
(`app/utils/tmcut/render/audio.ts:53`); `grep -rn "speedPoints\|isRamped\|rampTimelineToSource" app/utils/tmcut/render/*.ts`
= **0** kết quả. Một clip ramp: preview giữ sync suốt curve, **file FFmpeg** vẫn audio-chạy-linear nên audio file trôi —
đúng hướng Zero-FFmpeg (slice H mux từ chính số của core), **không** phải một regression im lặng. Nợ ghi ở §46.9.

### 46.5 Tests

| File | Số check | Nội dung mới |
| --- | --- | --- |
| [audio-time-plan.test.mjs](file:///D:/Applications/tm-studio/packages/core/test/audio-time-plan.test.mjs) (mới, **185** dòng) | **11** | cùng vị trí với layer (:54), trim (:65), gap (:73), overlap (:85), 2× (:94), ramp (:105), vượt trần cũ (:117), shuttle + clamp (:131), reverse refusal (:144), hai leg cùng số (:156), footage leg cũng trả lời thời gian (:173) |
| [audio-mix-plan.test.mjs:194](file:///D:/Applications/tm-studio/packages/core/test/audio-mix-plan.test.mjs#L194) | 11 (giữ) | `deepEqual` **nguyên khối** một source: thêm `mediaTicks: T(1)`, `rate: 1`, `plays: true`, `refusal: null` — đổi shape là một **lựa chọn** có chữ ký, không phải tai nạn |
| [tmcut_audio_mixer.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_audio_mixer.spec.ts) | **15 → 16** | check 16 (:296) pin retirement bằng cách đọc nguồn app |
| [tmcut_speed_clock.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_speed_clock.spec.ts) | **5** | check 5 viết lại: `elementRate(` = 1 và `speedAt(` = 0 trong composable — composable không tự lấy mẫu curve |
| `tests/unit/tmcut_time_domain.spec.ts` | **7 → 6** | bỏ check mà luật đã về core |

Check ramp (:105) đáng chú ý vì nó là **tích phân**, không phải phép nhân: clip `speedPoints` 1→2 trong 1 s, tại local 0.5 s
core trả `rate 1.5` và `mediaTicks` bằng **0.625 s** — đúng diện tích dưới curve. Check :117 và :131 là hai mặt của trần:
6× giữ nguyên 6 (thoát trần 4 cũ), còn 40× và shuttle 100 bị **kẹp về 16**; shuttle `0` (non-finite path) không được phép
thành 0 tốc độ.

### 46.6 Falsification — bốn mutation, bốn lần bị bắt

Mỗi mutation chạy trên `packages/core/test/audio-time-plan.test.mjs` (11 check), log ở `node_modules/.cache/tmcut-gates/`.

| # | Mutation | Check bị bắt | Kết quả đo |
| --- | --- | --- | --- |
| M1 | `playoutOf` bỏ từ chối: `const refusal = null` ([audioMix.mjs:53](file:///D:/Applications/tm-studio/packages/core/src/audioMix.mjs#L53)) | `a reverse clip refuses the element and names the reason` | fail **1**/11, exit **1**, `actual: true, expected: false` (`g4-m1.log`) |
| M2 | bỏ clamp ở [retime.mjs:149](file:///D:/Applications/tm-studio/packages/core/src/retime.mjs#L149), trả tích thô | `a clip past the old audio ceiling runs at its own speed` + `the host clock multiplies the rate and the clamp binds` | fail **2**/11, exit **1**, `actual: 200, expected: 16` (`g4-m2.log`) |
| M3 | `mediaTicks` không đọc layer (bỏ `layer.sourceTicks`) | checks :54, :65, :73, :85, :94, :105, :117, :173 — **8** check | fail **8**/11, exit **1**, `actual: null, expected: 12240000` (`g4-m3.log`) |
| M4 | evaluator ngừng trả `sourceRate` (xóa [evaluate.mjs:292](file:///D:/Applications/tm-studio/packages/core/src/evaluate.mjs#L292)) | `a ramp gives the sound the rate the picture is riding` + `the sound and the picture are handed the same rate at the same tick` | fail **2**/11, exit **1**, `actual: 1, expected: 1.5` (`g4-m4.log`) |

Bốn lần đều **bị bắt**, và M3 là phép thử cho câu hỏi "luật có thật sự nằm trong core không": bỏ một field ở `playoutOf` làm
sập **tám** check, tức cả trim lẫn overlap lẫn ramp đều đọc cùng một nguồn. Baseline md5 dựng trước khi mutate
(`g4-mutation-baseline.md5`); sau bốn lượt mutate/restore, `md5sum -c` in **3 dòng OK** và exit **0** (`audioMix.mjs`
`7f85d4f3…`, `retime.mjs` `eb7b3583…`, `evaluate.mjs` `6e34b8d2…`), và toàn bộ core suite chạy lại **739/739** exit 0
(728 của G3 + **11** check mới).

### 46.7 Bằng chứng live — plan → element, trên Chromium `:4003`

Fixture: WAV tự ghi `.data/uploads/g4-tone.wav` (**282 284** byte, RIFF PCM mono 44 100 Hz, **3.200 s**, mỗi giây một cao độ
220/440/880 Hz — để một cái tai kiểm được **vị trí**, không chỉ con số). Sáu clip trên hàng audio, nạp vào store **đang chạy**
của tab: `g4a` trim `in=1s out=3s` tại 0 · `g4b` `speed 2` tại 3s · `g4c` `in 0..1s` tại 4s · `g4d` `in 2..3s` tại 4.5s
(overlap với `g4c`) · `g4e` ramp `speedPoints 1→2` tại 6s · `g4f` `reverse` tại 9s. Số đo đọc **ba** nguồn cùng lúc: plan của
core (`audioMixAt`), list mà Vue mount (`activeAudioSrcs`), và `<audio>` element thật (`currentTime`, `playbackRate`, `duration`, `readyState`).

| Playhead | Case | plan `mediaSec` | element `currentTime` | plan `rate` | element `playbackRate` |
| --- | --- | --- | --- | --- | --- |
| 0.50 s | trim `in=1s` | **1.5** | **1.500** | 1 | 1 |
| 2.50 s | gap | plan **rỗng** | **0** element | — | — |
| 3.25 s | `speed 2` | **0.5** | **0.500** | **2** | **2** |
| 4.75 s | overlap hai clip | **0.75** + **2.25** | **0.750** + **2.250** | 1, 1 | 1, 1 |
| 6.50 s | ramp giữa chừng | **0.625** (tích phân) | **0.625** | **1.5** (curve tại local 0.5 s) | **1.5** |
| 9.50 s | reverse | `plays:false refusal:'reverse'` | **không có element** | — | — |

Sáu hàng, **không hàng nào** lệch giữa ba nguồn; `duration` 3.2 và `readyState` 4 trên mọi element đo được. Hai điều đọc ra
thêm: một tick **gap** không dựng element nào (kế hoạch rỗng → DOM rỗng, không phải element nằm im ở vị trí cũ), và một clip
**reverse** vẫn có `mediaTicks` trong plan nhưng `plays:false` — tức core trả **lời từ chối có tên**, còn app chỉ việc không
mount; đó chính là chỗ `if (clip.reverse) continue` của HEAD không kể lại được gì.

Shuttle đo trên **chính project đã lưu của owner** (không sửa gì): mỗi lần `shuttleForward()`, plan trả `rate` **2** cho
**cả hai** leg (footage `clip_1793875812268_q549` và audio `clip_1793875823705_xziv`) và `<video>.playbackRate` đọc **2**;
`shuttleStop()` trả cả ba về **1**. Cùng tick, cùng số — mục tiêu của lượt này đo được trên máy thật.

Phát hiện tình cờ **không thuộc G4**, đo trên cùng tab: ba file `.data/uploads/*.wav` (`mw3br9v4-…`, `mw3fck52-…`, `mw3fhrja-…`)
lỗi `MediaError code 4 SRC_NOT_SUPPORTED` (`readyState:0`, `duration:null`) trong khi một bản `.mp4` cùng thư mục decode
bình thường. Nguyên nhân nằm **trên đĩa**, không ở transport: các file đó **bắt đầu bằng** `------WebKitFormBoundary…` (RIFF
nằm ở offset **140**) — tức một probe cũ đã POST body **multipart** vào route khai nhận raw bytes
([upload.post.ts:20](file:///D:/Applications/tm-studio/server/api/v1/media/upload.post.ts#L20) và :26 "body = raw file bytes").
App client **đúng** (`app/composables/useTmcutMedia.ts:584` gửi
`content-type: application/octet-stream`), nên đây là nợ của **probe cũ**, không phải bug của app — nhưng project đã lưu của
owner vẫn trỏ vào một trong ba file đó, nên clip audio của họ **không bao giờ phát được**. Việc xóa/thay là của owner.

Ghi chú phương pháp và dọn dẹp: `setupState` là proxyRefs đã unwrap; fixture chỉ sống trong store đang chạy — **reload tab
trả về đúng project đã lưu** (`updated_at` vẫn 10:50:23Z, `revision` 2, một clip video), tức probe không lọt vào disk và cũng
không có autosave nào bị kích hoạt bởi một mutation thô (một **phát hiện** về cơ chế lưu, ghi ở §46.9); tab để nguyên ở
playhead 0, `playing: false`. `.data/uploads/` bị gitignore (đo: `git check-ignore -v` → `.gitignore:3:.data`), nên fixture
WAV ở lại trên đĩa và **không** vào commit.

### 46.8 Gates — số đo của lượt này, từng cổng một

| Cổng | Lệnh | Kết quả | Số đo, lấy từ chính lần chạy ghi ở cột lệnh |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | PASS | exit **0**, grep `error TS` = **0**; `.nuxt/eslint.config.mjs` regenerate 20:08:43 |
| 2 Lint | `npx eslint` trên **13** file đã chạm, chạy **sau** 20:08:43 | PASS cho dòng của lượt này | exit **1**, còn đúng **2** error trong `retime.mjs`: `no-useless-assignment` (:194) + `@stylistic/arrow-parens` (:428). **Cả hai có trước**: lint một bản HEAD của chính file báo cùng hai rule (dòng :171/:405), và `git diff -U0` cho thấy hunk duy nhất của lượt này là `@@ -133,0 +134,23 @@` |
| 3 Unit | `npx tsx tests/unit/run-all.mts --smoke` | PASS | **127/127** specs, exit **0**, **0** dòng FAIL |
| 3b Core | `cd packages/core && node --test "test/*.test.mjs"` | PASS | tests **739** / pass **739** / fail **0**, exit **0**; `npx tsc -p packages/core --noEmit` exit **0**, 0 `error TS` |
| 4 Live | 5 route `:4003`, đọc console sau mỗi route | PASS (một error môi trường) | `/tmcut` + `/tmcut/autocut`: **0** error/warn/issue. `/tmcut/editor`: **2** message, toàn `[debug]` vite. `/tmcut/templates`: **2** `[debug]`, page render 6 744 ký tự. `/tmcut/factory`: 4 message, `[error]` duy nhất là `401 /api/v1/ai/relay/catalog` (network list đo **2** lần 401; pre-existing §44.8) |
| 5 Dọn dẹp | scratch xóa, fixture gitignored, docs append | PASS | `md5sum -c` baseline falsification → **3 OK**, exit **0** (ba file core trở về byte-identical sau §46.6) |

Cổng 2 **từng FAIL vì lỗi của chính lượt này**, và đã sửa theo TDD chứ không suppress: `TmcutPreviewPlayer.vue:32` vẫn
destructure `renderSeconds` sau khi không còn ai dùng (`no-unused-vars`). Trước khi xóa, assertion cũ của
[tmcut_preview_boundary.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_preview_boundary.spec.ts) — "the player
still reads the clamped position for media time" — đã bị viết lại thành `assert.doesNotMatch(player, /renderSeconds/)`,
chạy thấy **RED** thật, rồi mới xóa destructure → **GREEN 8/8**. Guard nghỉ việc cùng code, không phải code nghỉ việc theo guard.

### 46.9 Chưa chứng minh / nợ

- **Tai người vẫn chưa đo.** Fixture WAV **có** audio stream thật (khác §45.8 — nơi repo không có file nào), và cao độ đổi
  theo giây là để một người nghe kiểm được vị trí — nhưng **chưa ai nghe**. Mọi số ở §46.7 là giá trị element.
- **Element clock trong lúc play thật ở rate ≠ 1 chưa bắt được.** `playbackRate` trên element đã đo = 2, nhưng script
  `togglePlayPause` qua evaluate không làm máy chạy (`playing: false`), nên " đồng hồ element **chạy** đúng nhịp plan" vẫn mở.
- **Export FFmpeg với clip ramp**: audio vẫn `asetpts/speed` hằng số (§46.4). Preview đã theo curve; file thì chưa — cần
  slice H hoặc một quyết định riêng, và đó là **drift đã biết**, không phải drift chưa biết.
- **`trackPan` vẫn chỉ export** — preview chưa pan (nợ cũ từ §45.4).
- **Autosave không firing trên mutation thô** (§46.7): hoặc lưu theo debounce/user action, hoặc theo một đường khác. Chưa
  đo, nhưng nó có nghĩa là một probe mutate store **không** tự ghi lên đĩa — tiện cho QA, và là điều cần biết trước khi ai đó
  dùng probe để "sửa hộ" project của người dùng.
- **Desktop host chưa đo lại** packaged app; `media://local` vẫn từ chối vào graph theo §45.3.
- **ADR-033 vế playback còn nguyên**: bytes về máy đã có cache (D2/E4/G2) nhưng element vẫn stream `/uploads/…` (gate 4 đo
  `[206]`). Đóng vế đó cần nguồn `blob:` từ byte cache — **nửa còn lại của #140**, tức chân G4b.
- **Hai file WAV hỏng + project của owner** trỏ vào một file trong số đó (§46.7): xóa/thay là việc của owner.
- **Console còn `[error]` môi trường**: `401 /api/v1/ai/relay/catalog` (đã ghi ở §44.8, §45.8) — lượt này đo lại, giữ nguyên
  attribution.

## 47. Slice G4b — preview lấy bytes từ cache của chính nó: `blob:` thay cho `/uploads/`, và phần vẫn chờ một session (đo ngày 2026-11-06)

### 47.1 Việc của lượt này, và hiện trạng đo được ở HEAD `36e4c0a`

§46 khép nửa **thời gian** của leg audio và để lại đúng một nợ kỹ thuật, ghi ở §46.9: element vẫn hỏi server. ADR-033 có hai
vế — "bytes về máy" đã có từ C2b và đã được ba leg dùng (D2 pixels, E4 silence, G2 waveform, §44.5); vế thứ hai, "**bytes
được dùng để phát**", là việc của G4b. Luật của nó không nằm ở đây: `planPlaybackByteSource` trả `cache` / `stream` /
`unresolved`, `planBlobUrlLifecycle` trả `keep` / `create` / `revoke` (#141). Code của **cả hai chân** vào history trong một
commit của chủ repo — `36e4c0a` (137 file) — chứ không thành commit riêng của slice, nên mọi số trong §47.7 lấy từ chính tree
đã commit đó, không phải từ bản làm việc trước commit.

Đo bằng `git show --stat 36e4c0a` trên các file của lượt này: `app/utils/tmcut/playbackBytes.ts` **+150**,
`app/composables/useTmcutPlaybackBytes.ts` **+74**, `tests/unit/tmcut_playback_bytes.spec.ts` **+287**,
`packages/core/src/byteCache.mjs` **+67**, `packages/core/src/index.d.ts` **+25**,
`packages/core/test/byte-cache-playback.test.mjs` **+155**, `app/components/tmcut/TmcutPreviewPlayer.vue` **+73**,
`app/composables/useTmcutMedia.ts` **+20/-8**.

### 47.2 Ba quyết định thiết kế, và lý do chúng không phải là sở thích

- **Ledger là của host** (`ledger` / `setLedger`), không phải của module. Đọc byte là async còn `playableSrc` là sync: surface
  hỏi và nhận stream URL cho tới khi bytes về. Host giữ ledger trong `shallowRef` nên cú swap tự re-render; module không cần
  biết gì về Vue. Đo ở §47.6: trước `sync` trả stream, sau `sync` trả `blob:` — đúng thứ tự đó là hệ quả của hợp đồng, không
  phải của may mắn.
- **Key là revision thật sự phát, không phải `clip.src`**. `previewEngine.resolveSrc()` là đường proxy-aware; nếu cache key
  lấy theo `clip.src` thì một blob full-resolution sẽ thắng bản proxy 960px mà engine định chơi. Vì thế luật "file nào phát"
  được tách thành `resolvePlayPath()` trong `useTmcutMedia.ts` và **cả hai** phía — URL lẫn key — cùng hỏi nó một lần.
- **Một revision, nhiều surface, một lần đọc**. Footage plate và `<audio>` của cùng clip là cùng file, nên ledger keyed by
  revision khiến unmount một surface không được phép làm im surface kia; `inflight` làm hai pass chồng lên nhau gộp thành một
  lần đọc.

### 47.3 Nối dây: đo bằng `grep`, không đo bằng trí nhớ

| Chỗ | Số đo ở HEAD | Nghĩa |
|---|---|---|
| `playbackBytes` trong `TmcutPreviewPlayer.vue` | **5** lần | seam được dùng thật, không phải chỉ import |
| `:340` `playableSrc` | `playbackBytes.srcFor(path, previewEngine.resolveSrc(path))` | leg video: stream vẫn là fallback, seam trả blob khi bytes về |
| `:635` `activeAudioSrcs` | `const src = playbackBytes.srcFor(path, stream)` | leg audio: cùng một câu trả lời, nên `<audio>` và footage dùng chung một URL |
| `:676` | `playbackBytes.sync(mountedMediaPaths.value)` | một lần reconcile cho toàn bộ surface đang mount, `flush: 'post'`, `immediate: true` |
| `:1531` `onUnmounted` | `playbackBytes.releaseAll()` | rời editor là trả hết URL, đo ở §47.6 |
| `:303` | `bgStyle.backgroundImage = url(previewEngine.resolveSrc(bg.value))` | **cố ý không đổi**: nền CSS không phải footage, cho nó vào ledger là trả một `blob:` cho thứ chưa từng được decode |

### 47.4 Tests

`tests/unit/tmcut_playback_bytes.spec.ts`: **15** checks, chạy độc lập ở HEAD → `All 15 playback-byte-source checks passed`.
Bốn checks đóng vai hợp đồng nối dây, không phải kiểm tra hành vi: "*both preview legs ask the seam, and only one module reads
playback bytes*", "*nothing cached means no reads at all*", "*an unresolved clip gets no src at all — never an empty
attribute*", "*a cache that cannot answer is not an error*". Host giả trong spec thay **cả** `setLedger` bằng một phép thay
toàn bộ record — đúng điều `shallowRef` làm — vì một host mutate tại chỗ sẽ giữ DOM đứng nguyên dù ledger đã đổi.

### 47.5 Falsification — bảy mutation, bảy lần bị bắt

| Mutation | Sửa gì | Assertion đã bắt |
|---|---|---|
| M1 blob bị ignore, stream luôn trả lời | `return url \|\| streamUrl` → `return streamUrl` | `Expected values to be strictly equal` (0 checks pass được) |
| M2 revision rời màn hình vẫn mount | bỏ `&& wanted.has(key)` | "no url for a revision no surface wants" (8 checks) |
| M3 đọc hỏng vẫn sinh URL | bỏ `!bytes \|\|` | "no url for bytes that are not there" (7 checks) |
| M4 không gộp request song song | `const running = inflight.get(key)` → `undefined` | "the second pass joined the read already running" (3 checks) |
| M5 một departure thu hồi tất cả | revoke theo danh sách → revoke cả ledger | "only the revision that left the screen is freed" (4 checks) |
| M6 `releaseAll` không ghi ledger | `if (Object.keys(held).length > 0)` → `if (false)` | "the emptied ledger is written too" (6 checks) |
| M7 phớt lờ lời từ chối của core | `plan.kind === 'cache'` → `!==` | "a revision the store does not have is not worth a read" (11 checks) |

`md5sum -c` trên `app/utils/tmcut/playbackBytes.ts` sau khi dựng lại bản gốc: **OK** — file ở HEAD byte-identical với bản đã
đo, nên các số ở §47.6–47.7 mô tả đúng code đang được ship.

### 47.6 Bằng chứng live trên origin `:4003` — phần đo được mà không cần đăng nhập

Cách đo, và vì sao đó là code thật: dev server chạy `npx nuxt dev --port 4003`; trong trang `/login` (same-origin, **không**
cần session) tôi `await import('/_nuxt/utils/tmcut/playbackBytes.ts')` và `'/…/byteStore.ts'` — tức module đã compile từ
source, không phải bản copy trong test, không mock. `readBytes` chỉ được bọc để **đếm** rồi gọi `readCachedBytes` thật;
`revokeUrl` đếm rồi gọi `URL.revokeObjectURL` thật. `fingerprintFor` ở đây là hàm giả (`clip://<key>` → `<key>`) vì thư viện
asset cần session; hợp đồng "asset nào trả fingerprint nào" do check nối dây ở §47.4 giữ.

| Mục đo | Số đo live |
|---|---|
| cache thật trên profile này | **3** revision: `99374b2a` 4 448 B, `6a47b973` 4 448 B (12 byte đầu `… ftypisom` = MP4 thật), `717a0beb` 48 230 B (16 byte đầu `------WebKitForm`) |
| `srcFor` **trước** `sync` | trả đúng stream URL — hợp đồng "hỏi sync thì nhận stream trước" |
| `srcFor` **sau** `sync` | `blob:http://localhost:4003/eac032b8-…` |
| read-back của chính URL đó | `fetch(blob:)` → **status 200**, **4 448 byte**, 12 byte đầu `… ftypisom` — đúng bytes trong store |
| số resource `/uploads/…` trên trang | **0** trước và **0** sau khi mount hai revision và đọc hết bytes của chúng (`performance.getEntriesByType('resource')`) |
| gộp đọc song song | hai `sync` song song trên một revision → **1** lần đọc |
| hai revision cùng mount | **2** lần đọc, cả hai ra `blob:` |
| một revision rời màn hình | **1** lần revoke; revision ở lại giữ **đúng URL cũ** (identical, không tạo lại); revision đi trả stream; `fetch` URL đã revoke → **`TypeError: Failed to fetch`** (thu hồi thật, không phải gỡ tham chiếu) |
| `releaseAll()` | tổng **2** lần revoke, ledger về **0** key, mọi src trở lại stream |
| hai lời từ chối | `ffffffff` (hợp lệ nhưng chưa cache) và `zzzzzzzz` (digest hỏng) → **0** lần đọc, **0** lần ghi ledger, cả hai trả stream |
| revision hỏng `717a0beb` | **1** lần đọc, vẫn có `blob:`, và blob đó mở đầu bằng multipart body |

Dòng cuối là một phát hiện, không phải một lỗi của G4b: seam chuyển **đúng** bytes mà store giữ; tính hợp lệ của một file được
quyết ở đường import, không phải ở playback. `717a0beb` chính là file đã nêu ở §46.7/§46.9 (`.data/uploads/mw3fck52-…-tone.wav`,
body multipart thay vì RIFF) — và nó **đã vào cache phía client từ chính bytes hỏng đó**, nên đường duy nhất để sửa là owner
xóa/thay asset, không phải code.

### 47.7 Gates — số đo của lượt này, từng cổng một, chạy trên HEAD `36e4c0a` ngày 2026-11-06

| Cổng | Lệnh | Kết quả | Số đo, lấy từ chính lần chạy ghi ở cột lệnh |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | PASS | exit **0**, grep `error TS` = **0**; `.nuxt/eslint.config.mjs` regenerate **11:31:13**, 28 605 B |
| 2 Lint | `npx eslint` trên **8** file của lượt này, chạy **sau** 11:31:13 | PASS | exit **0**, log **0** dòng |
| 3 Unit | `npx tsx tests/unit/run-all.mts --smoke` | PASS | **128/128** specs, exit **0**, **0** dòng FAIL |
| 3b Core | `node --test "test/*.test.mjs"` trong `packages/core` | PASS | tests **753** / pass **753** / fail **0** / cancelled **0**, exit **0**; `npx tsc -p packages/core --noEmit` exit **0**, **0** `error TS` |
| 4 Live | origin `:4003`, module thật + store thật | **MỘT PHẦN / BLOCKED** | nửa seam đo live ở §47.6 (read-back 200 + 4 448 B, 0 request `/uploads`, revoke thật). Nửa **element mà editor mount** và console sweep 5 route **chưa đo**: `/tmcut/editor` redirect `/login?redirect=/tmcut/editor`, `POST /api/v1/auth/refresh` hết hạn, và credential không phải thứ tôi được cầm |
| 5 Dọn dẹp | mutation runner đã xóa, log nằm ở `node_modules/.cache/tmcut-gates/` | PASS | `md5sum -c` → **OK**; không có scratch file trong repo; fixture không touched |

Cổng 4 vì sao tách làm hai nửa thay vì để nguyên một BLOCKED: hai nửa đó chứng minh hai điều khác nhau, và nửa đã chứng minh
thì không được phép bị loãng bởi nửa chưa. Nửa seam + store + URL lifecycle là **toàn bộ logic mới** của lượt này, đo trên bytes
thật trong OPFS của chính máy. Nửa còn lại là một **dây nối** đã được check ở §47.4 bằng grep và bằng typecheck — nó cần session
để đọc `currentSrc`, không cần để suy ra nó đúng.

### 47.8 Chưa chứng minh / nợ

- **`currentSrc` của element mà editor mount** + số `GET /uploads/…` trên `/tmcut/editor`: cần bạn đăng nhập tại
  http://localhost:4003/login. Đây là dòng duy nhất khiến ADR-033 chưa thể lật vế playback.
- **Console sweep 5 route** (`/tmcut`, `/tmcut/autocut`, `/tmcut/editor`, `/tmcut/templates`, `/tmcut/factory`): cùng lý do.
- **Desktop host (Electron)**: chưa đo packaged app; chưa đo liệu `byteStore` phía desktop có entry nào, và khi không có thì
  seam có trả đúng `media://…` như một lời từ chối (`not-cached`) thay vì một URL rỗng.
- **Export vẫn đi `/uploads/`** — đó là leg của slice H, không phải của G4b. ADR-033 vì thế vẫn **CHỜ** vì export và vì một dòng
  đo còn thiếu ở §47.8, chứ không phải vì code playback chưa viết.
- **`717a0beb`**: bytes trong cache là multipart body; xóa/thay asset là việc của owner (§46.7).
- **Nền CSS** (`:303`) vẫn nhận stream URL theo quyết định ở §47.3; nếu sau này muốn nó vào cache thì đó là một slice khác, vì
  nó là `background-image`, không phải một media element có lifecycle.
- **`fingerprintFor` trong §47.6 là hàm giả** vì thư viện asset cần session; đường thật (`findAssetBySrc`) được giữ bởi check
  nối dây §47.4 chứ chưa được đo live ở lượt này.


## 48. Slice H1 — exporter hỏi, ghi lại câu trả lời, và từ chối có tên; nó không đoán (đo ngày 2026-11-06)

Slice G còn mở đúng một việc (mục "Chưa chứng minh" ở §47.8: `currentSrc` của element mà editor mount, cần một session đăng nhập),
nên lượt này chuyển sang slice H theo đúng thứ tự roadmap. §6 của bản audit này đã đo vì sao H là phần khó nhất: **0** dòng
`VideoEncoder` trong repo, và "không tồn tại đường export nào không cần FFmpeg trong repo hôm nay". Bắt đầu H bằng một file
exporter sẽ là bắt đầu bằng thứ khó kiểm tra nhất; bắt đầu bằng **luật** thì ba quyết định sống còn của nó — chọn preset nào,
frame nào chạy lúc nào, và bao nhiêu frame được phép nằm trong encoder — thành thứ đọc được và test được mà không cần browser.

### 48.1 Việc của lượt này

Ba luật mới, một module, chưa có consumer:

| File | Trạng thái | Dòng |
|---|---|---|
| `packages/core/src/exportEncode.mjs` | mới | 250 |
| `packages/core/test/export-encode-plan.test.mjs` | mới | 263 |
| `packages/core/src/index.mjs` | barrel cộng một dòng export | +1 |
| `packages/core/src/index.d.ts` | khai báo cho app | +57 |

Không có file `app/**` nào đổi. `compileTimelineToFfmpeg` vẫn là đường export duy nhất mà người dùng bấm tới, và đó là sự thật
cần nói rõ trước khi ai đó đọc hai chữ "slice H".

### 48.2 Ba quyết định, và cái giá của mỗi quyết định

**Preset đến từ câu trả lời đã ghi, không từ hy vọng.** `planEncodeConfig` nhận `presets` theo thứ tự ưu tiên và `answers` là
kết quả `isConfigSupported` mà host đã đo. Luật nói ba điều mà một vòng encode viết tay sẽ nói sai:

- một preset **chưa đo** là `unmeasured`, không phải `supported` — brief ghi "ghi kết quả, không đoán hardware H.264", và trên
  máy không có codec phần cứng thì đoán nghĩa là xuất ra file không tồn tại;
- runtime trả về **codec khác** codec mình hỏi là `substituted`, tức là **thất bại**, không phải thành công — ADR-030 cấm tự đổi
  codec/container, và một exporter âm thầm đổi `avc1` sang `vp09` tạo ra file mở được nhưng không phải file người dùng yêu cầu;
- ma trận verdict đi theo cả câu trả lời **thành công** (`checked` luôn có mặt), vì exit criterion của H là "kết quả
  `isConfigSupported` được ghi vào report", không chỉ "có file chạy được".

**Timestamp là index nhân FPS hữu tỉ, làm tròn đúng một lần.** `planEncodeSample({ index, rate, contentEndTicks, timescale })`
trả `{ timestamp, duration, isLast }` bằng số nguyên trong timescale của muxer. Đây là chỗ repo đang sai:
`app/utils/tmcut/canvas.ts:40` trả `Math.round((numerator / denominator) * 1000) / 1000`, tức 30000/1001 thành **29.97**, và mọi
consumer chia cho con số đã làm tròn đó. 30 frame của 29.97 là 1,001 s; chia cho 29,97 ra 1,001001 s. Luật mới không đi qua con
số ấy: `round(index × timescale × denominator / numerator)`, và `duration` là **hiệu hai timestamp liên tiếp** nên tổng các frame
luôn đúng bằng timeline — 300 frame của 29.97 cộng lại chính xác 10,01 s, không tích sai số. Frame cuối lấy độ dài của
**content**, không lấy độ dài của một frame: muxer mà được báo ngược thì viết file dài hơn project.

**Bound không được phép thành 0.** `planEncodeQueue` trả `push` hay `wait`, nhưng một `limit` không phải số nguyên dương rơi về
`DEFAULT_ENCODE_IN_FLIGHT` (4). Đây là lỗi chết người theo kiểu im lặng: loop được bảo chờ một slot không bao giờ mở thì không
encode frame nào, và exporter trông như đang chạy.

### 48.3 Test, và hai lỗi trong test của chính tôi

20 checks, ba describe. Chạy đầu tiên là trên một bản stub trả `null`/rỗng để chắc rằng test fail vì **hành vi**, không vì không
load được module. Ba việc tự bắt được ở đó:

- `returns nothing for an index outside the sequence` **đậu ngay trên stub**, vì nó chỉ toàn assertion `null` — một luật trả
  `null` cho mọi thứ sẽ qua nó. Đã thêm một positive control (frame 29 của project 1 giây phải là
  `{timestamp: 966667, duration: 33333, isLast: true}`) vào cùng block.
- Tôi đã viết "frame 2 nằm ngoài project 1 giây". Sai: ở 30 fps project 1 giây có frame 0..29, frame 30 mới là ngoài.
- Tôi đã viết độ dài frame của 29.97 "luân phiên" 33367/33366. Sai: nó theo chu kỳ 3 (33367, 33366, 33367, 33367, …), assertion
  đã đổi thành "mỗi frame dài một trong hai số đó, và tổng 300 frame chính xác 10,01 s".

Sửa hai dòng cuối là sửa **test**, không sửa luật.

### 48.4 Mutation: 11 mutant, 10 bị bắt, 1 sống và sống đúng

| Mutant | Kết quả | Assertion nào bắt |
|---|---|---|
| M1a chia cho float của một hữu tỉ đúng (`numerator/denominator`) | **SỐNG** | — (xem giải thích) |
| M1b FPS làm tròn 3 chữ số như `canvasFpsValue` | CAUGHT | `keeps 29.97 exact where a float FPS drifts` |
| M1c `Date.now()` thay cho index | CAUGHT | `keeps 29.97 exact…` + `sizes a frame so the durations add up` |
| M2 preset chưa đo được tính là supported | CAUGHT | `names every preset still unmeasured instead of encoding on a guess` |
| M3 bỏ so codec echo | CAUGHT | `refuses when the runtime swapped the codec it was asked about` |
| M4 cho qua kích thước lẻ | CAUGHT | `kills an odd height before the answer matters, naming the chroma law` |
| M5 tôn trọng `limit` = 0 | CAUGHT | `a limit of zero falls back to the default instead of waiting forever` |
| M6 frame cuối giữ nguyên một frame thay vì content | CAUGHT | `gives the last frame the length of the content` |
| M7 mux cả sample nằm sau content | CAUGHT | `returns nothing for an index outside the sequence` |
| M8 audio không tham gia verdict | CAUGHT | `a preset with a supported video and an unsupported audio is not supported` |
| M9 `isLast` không bao giờ bật | CAUGHT | `gives the last frame the length of the content` + positive control |

M1a sống là **mutant tương đương**, không phải lỗ thủng: `30000/1001` ở dạng float sai khoảng 1e-17 relative, tới 20 triệu µs vẫn
lệch dưới 1e-9, nên `Math.round` cho cùng một số. Bệnh thật là làm tròn 3 chữ số, và M1b bắt nó. Ghi lại vì một bảng mutation
không có mutant sống nào thì đáng nghi hơn bảng này.

### 48.5 Gate chạy trên HEAD `1f0d0bb`

| Gate | Lệnh | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | **PASS** | exit 0, `grep -c "error TS"` = 0, `.nuxt/eslint.config.mjs` regenerate 11:53 (28 605 B) |
| 2 Lint | `npx eslint` trên 4 file chạm, chạy **sau** gate 1 | **PASS** | exit 0, log 0 dòng |
| 3 Unit | `npx tsx tests/unit/run-all.mts --smoke` | **PASS** | 128/128 specs, exit 0 |
| 3b Core | `node --test "packages/core/test/*.test.mjs"` | **PASS** | 773/773 (753 trước lượt này + 20 checks mới), exit 0 |
| 3c Core types | `npx tsc -p packages/core --noEmit` | **PASS** | exit 0, 0 `error TS` |
| 3d Boundaries | `node packages/core/tools/check-boundaries.mjs` | **PASS** | core không import gì platform-specific |
| 4 Live | — | **N/A** | chưa có consumer: không file `app/**` nào đổi, không route nào render, và chưa gọi `isConfigSupported` lần nào |

Một gate **đã fail trước khi pass**, và đó là gate của repo chứ không phải của luật: chạy lần đầu, `tmcut_doc_citations` báo
exit 1 vì dòng chữ `audit §6` trong header comment của test mới bị hiểu là trích dẫn tới một tài liệu tên `audit`, mà registry
chỉ khai báo `docs`, `roadmap v1`, `roadmap v3`, `architecture`… Cách sửa **không phải** thêm `audit` vào registry (sẽ làm guard
yếu đi để vừa với comment của tôi), mà bỏ ký hiệu `§` khỏi comment: luật vẫn dẫn đúng nguồn, guard vẫn bắt được mọi trích dẫn
thật. 128/128 là số của lần chạy **sau** sửa đó.

### 48.6 Chưa chứng minh / nợ

- **Chưa có ai gọi ba luật này.** `planEncodeConfig` mới chỉ sống trong test; host nào cũng chưa từng gọi
  `VideoEncoder.isConfigSupported` cho một preset export thật. Ma trận capability **của máy này** vì thế vẫn trống.
- **Audio chưa có luật timestamp riêng.** `planEncodeSample` quy đổi từ **ticks**, tức là từ lưới frame; packet PCM đến từ mixer
  cần một luật tính theo sample count. Đừng suy ra từ §48.2 rằng hai đường đã cùng một câu trả lời — chúng chưa cùng tồn tại.
- **Leg mux vẫn chưa có gì.** ADR-029 ghi "leg mux thuộc slice H": chưa một dòng `mediabunny` output nào được viết, và khi viết
  thì phải **cố ý** sửa allowlist mà `tmcut_media_probe.spec.ts:350`, `tmcut_silence_scan.spec.ts:189` và
  `tmcut_autocut_detect.spec.ts:108` đang đóng băng (danh sách file import `mediabunny`).
- **ADR-030 vẫn MỘT PHẦN**, ADR-029 vẫn MỘT PHẦN, ADR-033 vẫn CHỜ: export vẫn đi `/uploads/` và vẫn spawn FFmpeg.
- Câu "phải chẵn vì encoder subsample chroma 2x2" giờ nằm **hai chỗ**: `packages/core/src/htmlVideo.mjs:207,212` và
  `packages/core/src/exportEncode.mjs`. Chữ đã là một hằng số export (`ENCODER_EVEN_DIMENSION_REASON`) nhưng `htmlVideo.mjs` chưa
  import nó — hai chuỗi đang **giống nhau từng byte**, và gộp chúng là việc của một lượt sau, không phải của lượt này.
- Tuyên bố §13.2 (PCM-S16 không encoder nào nhận, nên "remux lossless" phải đo lại từng máy) vẫn chưa được đo lại bởi H.

## 49. Slice H2 — thang preset ở core, câu hỏi thật gửi cho runtime, và ma trận encoder đầu tiên (đo ngày 2026-11-06)

§48 để lại đúng một nợ: "ma trận capability **của máy này** vì thế vẫn trống". Lượt này trả nợ đó, và trả bằng số đo chứ không
bằng suy luận. Việc đồng thời là **luật thứ tư** của export — `planEncodePresets` — cộng một seam app gọi
`VideoEncoder.isConfigSupported` / `AudioEncoder.isConfigSupported` lần đầu tiên trong repo cho một preset export.

### 49.1 Luật mới ở core: `planEncodePresets` trả về danh sách CÂU HỎI, không phải danh sách câu trả lời

`packages/core/src/exportEncode.mjs` giờ có bốn luật, và luật mới khác ba luật còn lại ở chỗ nó **không được phép** biết máy nào
sẽ encode. Nó chỉ trả "(preset, container) nào đáng hỏi, theo thứ tự nào", cùng `errors` khi câu hỏi tự nó vô nghĩa.
Bốn quyết định nó nhận:

| Quyết định | Luật | Vì sao nằm ở core chứ không ở IO |
|---|---|---|
| Level nào hỏi trước | đếm macroblock theo `ceil(w/16) * ceil(h/16)` và theo giây, rồi lấy level **chặt nhất hợp pháp** và **lỏng nhất**, hai câu | level ghi trong header là thứ điện thoại kiểm lại sau này; IO layer không được quyền nhân danh Annex A |
| Codec nào, trong container nào | `avc1.6400<idc>` đi MP4, `vp09.00.50.08` và `av01.0.09M.08` đi WebM | exporter hỏi sai container thì câu trả lời `supported` vẫn vô giá trị, vì muxer sẽ từ chối chính config đó |
| Audio hỏi thế nào | MP4: **cả hai** `mp4a.40.2` và `aac`; WebM: `opus`; không audio thì không nhân bản câu hỏi | một spelling đã đo ra `false` trong khi spelling kia `true` trên cùng máy; hỏi một spelling là âm thầm mất tiếng |
| Bitrate | `w*h*fps*0.1` bit/s, kẹp trong `[1 Mbps, 40 Mbps]` | con số này là chất lượng, không phải capability; phải đọc được trong preset chứ không phải trong args của ffmpeg |

Từ chối — không kẹp — ba trường hợp: cạnh lẻ (lý do `ENCODER_EVEN_DIMENSION_REASON`), FPS float, và raster mà không level nào
chở nổi (8K). Cả ba đều trả `errors` có tên, vì "không có preset" và "có preset nhưng runtime không nhận" là hai thông báo
khác nhau mà UI phải phân biệt được.

22 checks trong `packages/core/test/export-encode-presets.test.mjs`, 15 mutant đều CAUGHT. Hai mutant ban đầu **sống** và
được biến thành hợp đồng thay vì bỏ qua: M6 (hỏi trùng một level) và M13 (không bao giờ hỏi level lỏng hơn), rồi M14 (id preset
thiếu frame rate nên 30 fps và 59.94 fps trả lời lẫn nhau). Một bug thật do assertion mới bắt ra: khi request **không** có audio,
nhánh MP4 vẫn nhân theo `MP4_AUDIO_CANDIDATES` và sinh hai id giống hệt nhau — "a silent export was asked twice".

### 49.2 Bảng Annex A: một lỗi trong hằng số của tôi, và cách nó bị bắt

Bảng `AVC_LEVELS` ban đầu ghi `idc 1f` với cặp giới hạn **1620 / 40 500**. Đó là số của **level 3**, không phải 3.1; level 3.1 là
**3600 / 108 000**. Bảng gốc lấy từ [Advanced Video Coding (ITU-T H.264 Annex A)](https://en.wikipedia.org/wiki/Advanced_Video_Coding),
và khi đối chiếu lại từng hàng với số đo runtime tôi thấy hàng 3.1 lệch: máy này nhận `avc1.42001f` ở 1280x720@30, tức đúng
3600 macroblock/frame, trong khi bảng của tôi nói level đó chỉ chở được 1620.

Sửa theo đúng thứ tự: **test đỏ trước** — thêm vào check "accepts the level whose limit the picture hits exactly" một raster
720p30, nhận `avc1.640028` thay vì `avc1.64001f`; sau đó đổi hằng số, 795/795 vẫn xanh. Hệ quả thật sự: export 720p giờ hỏi level
chặt hơn một bậc, hợp pháp hơn, không đổi với 1080p trở lên (8160 macroblock/frame đã vượt cả hai).

Comment đi kèm cũng sửa cho đúng sự thật: các level bị bỏ qua (3, 3.2, 4.1, 4.2) chỉ **nới** hai giới hạn này lên, nên bỏ chúng
chỉ khiến câu trả lời **lỏng hơn mức cần**, không bao giờ thành bất hợp pháp.

### 49.3 Seam app: `app/utils/tmcut/exportEncodePlan.ts`

`createEncodeCapability(probes)` trả về `decide(request)` → `{ kind, config, checked, errors, container, presets }`. File này chỉ còn
ba việc mà một luật pure không làm được, và mỗi việc có một check:

- **hình dáng API**: `framerate` là float (`rationalToFloat`), `avc:{format:'avc'}` chỉ đi với chuỗi `avc1.`, audio là
  `numberOfChannels` chứ không phải `channelCount`. `isConfigSupported` **ném** khi thấy `avc` cạnh VP9, nên seam phải dịch shape
  chứ không được đẩy shape của core xuống browser.
- **một probe ném là một câu chưa trả lời**, không phải một câu từ chối: `unmeasured` chứ không phải `unsupported`, và một config
  bị API reject không được quyền xóa những codec đã trả lời.
- **hỏi tốn tiền**: capability nhớ theo **cả request** (`JSON.stringify`), vì level và frame rate là một phần của câu hỏi — trả
  lời 30 fps không phải trả lời 60 fps. Không có cache toàn module và không có `resetForTests()`: bộ nhớ là private của một
  capability, đúng hợp đồng đã viết ở §48.

Runtime không có WebCodecs → từ chối kèm lý do đọc được, không ném. `kind: 'ready'` bao giờ cũng kèm `container` của preset thắng.
10 checks, 11 mutant **CAUGHT** (M6 — "probe ném thành từ chối" — sống tới khi viết thêm check ở gạch đầu dòng thứ hai).
`tmcut_export_encode_plan.spec.ts:184` đóng băng điều khoản `mediabunny`: file này không được import muxer, và guard nhắm vào
**câu import**, không nhắm vào từ "mediabunny" (lần đầu tôi viết guard nhắm vào từ, nó bắt cả comment giải thích sự vắng mặt).

### 49.4 Ma trận encode đo thật trên máy này — Chrome 156, ngày 2026-11-06

Lần đầu tiên `VideoEncoder.isConfigSupported` chạy cho preset export trong repo. Probe: 6 raster (1280x720@30, 1920x1080@30,
1920x1080@60, 2560x1440@30, 3840x2160@30, 3840x2160@60), bitrate 4 Mbps, `avc:{format:'avc'}` cho chuỗi `avc1.`; một codec tính là
nhận khi `supported === true` **và** config vọng về đúng codec đã hỏi. `navigator.userAgent` là `Chrome/156.0.0.0`.

| Codec | Raster runtime nhận | Ghi chú |
|---|---|---|
| `avc1.42001f` (Baseline 3.1) | 1280x720@30 | khớp giới hạn 3600 MB/frame của 3.1 |
| `avc1.640028` (High 4.0) | 720p30, 1080p30, 1080p60 | xem 49.5: 1080p60 **vượt** giới hạn MB/s của 4.0 |
| `avc1.640032` (High 5.0) | tới 2560x1440@30 | |
| `avc1.640033` (High 5.1) | tới 3840x2160@60 | |
| `avc1.640034` / `3c` / `3d` / `3e` (5.2, 6.0, 6.1, 6.2) | cả sáu raster | hết mức đo |
| `avc1.640021` / `22` / `23` (level 3.3 / 3.4 / 3.5) | **không raster nào** | ba level này không tồn tại trong Annex A, đây là bằng chứng đo chứ không phải suy luận |
| `vp09.00.50.08` (VP9 profile 0) | **cả sáu raster**, gồm 4K60 | |
| `vp09.01.40.10` (VP9 profile 1) | không raster nào | khác nhau ở profile, không phải level |
| `av01.0.08M.08`, `av01.0.09M.08` (AV1 main 8/10-bit) | cả sáu raster | |
| `hev1.1.6.L153.B0` (HEVC) | không raster nào | |

| Audio config | Kết quả |
|---|---|
| `opus` @ 48000 | `supported`, vọng về `opus` |
| `mp4a.40.2` @ 48000 | `supported`, vọng về `mp4a.40.2` |
| `aac` @ 48000 và @ 44100 | **`supported: false`** |
| `flac` @ 48000 | `supported: false` |

| `hardwareAcceleration` | `isConfigSupported` |
|---|---|
| `no-preference` | `true` |
| `prefer-software` | `true` |
| `prefer-hardware` | `true` |

Ba hàng cuối là lý do ADR-030 còn **MỘT PHẦN**, không phải ĐÃ XONG: trên máy này field đó **không phân biệt được** phần mềm với
phần cứng, nên "hardware H.264" vẫn chưa chứng minh, và nói "được" sẽ đúng là điều ADR-030 cấm.

### 49.5 Phát hiện quan trọng nhất: runtime **không** enforce Annex A

`isConfigSupported` trả `true` cho hai config mà Annex A cấm:

| Câu hỏi | Giới hạn Annex A | Nhu cầu thực | Runtime |
|---|---|---|---|
| `avc1.640028` @ 1920x1080@60 | 8192 MB/frame, **245 760 MB/s** | 8160 MB/frame, **489 600 MB/s** | nhận |
| `avc1.640033` @ 3840x2160@60 | 36 864 MB/frame, **983 040 MB/s** | 32 400 MB/frame, **1 944 000 MB/s** | nhận |

Vì vậy luật chọn level **theo Annex A**, không theo câu trả lời: encoder máy này có thể nhận, nhưng decoder của điện thoại và của
trình duyệt khác sẽ đọc `level_idc` trong SPS và có quyền từ chối. `supported: true` nghĩa là "máy này encode được config này",
**không** nghĩa là "file này hợp pháp", và đó chính xác là chỗ một exporter non-TDD sẽ đoán sai.

### 49.6 Gate chạy trên working tree này (HEAD `bc9a369`)

| Gate | Lệnh | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | **PASS** | exit 0, `grep -c "error TS"` = 0, `.nuxt/eslint.config.mjs` regenerate lần cuối 13:01 (28 605 B) |
| 2 Lint | `npx eslint` trên 5 file chạm, chạy **sau** gate 1 | **PASS** | exit 0 ở cả ba lần chạy (12:31, 12:52 và 13:01 sau khi sửa `index.d.ts`) |
| 3 Unit | `npx tsx tests/unit/run-all.mts --smoke` | **PASS** | **129/129** specs, exit 0 (128 + spec mới) |
| 3b Core | `node --test "packages/core/test/*.test.mjs"` | **PASS** | 795/795, exit 0 |
| 3c Core types | `npx tsc -p packages/core --noEmit` | **PASS** | exit 0 |
| 3d Boundaries | `node packages/core/tools/check-boundaries.mjs` | **PASS** | core không import gì platform-specific; `mediabunny` không file mới nào import |
| 4 Live | chrome-devtools trên `http://localhost:4003` | **BLOCKED** | owner chưa sign-in; route `/login` sweep sạch (1 dòng `info` về Suspense, 0 `error`/`warn`/`issue`); bốn route cần auth không vào được |

Cả hai gate 1 và gate 2 đều **fail trước khi pass**, và mỗi lần fail là một lỗi thật trong file tôi vừa viết, không phải noise:

- Lint lần đầu: 10 lỗi — 3 `no-explicit-any` (tôi cast `globalThis` sang `any`), `arrow-parens`, `max-statements-per-line`. Sửa
  trong bốn file chạm, không chạy `--fix` repo-wide.
- Typecheck lần hai (sau khi đã sửa lint): **2 lỗi TS2352**, và đây là lỗi thiết kế chứ không phải lỗi cú pháp — `lib.dom` đã khai
  báo `VideoEncoder.isConfigSupported(config: VideoEncoderConfig)`, nên một seam nhận `Record<string, unknown>` buộc phải cast
  hai tầng để gọi API. Cách sửa **không phải** `as unknown as`, mà để seam **nói đúng kiểu của API** (`VideoEncoderConfig` /
  `AudioEncoderConfig`) và ép core sinh config đúng kiểu đó; `probe()` thành generic nên hai nửa video/audio vẫn đi qua một
  đường. Gate 1 sau sửa: exit 0, 0 `error TS`. Vì `lib.dom` khai `VideoEncoder` là **luôn có**, việc sniff runtime phải nằm ở
  `typeof globalThis.VideoEncoder === 'undefined'` — không còn là một `?.` vô nghĩa.
- Sequence thật, ghi để không ai đọc bảng này như thể mọi số đến từ một lần chạy: typecheck 12:30 → lint FAIL 10 → sửa → lint
  PASS 12:31 → specs → core 795 → docs → **typecheck lại vì code đã đổi** → FAIL 2 TS2352 → sửa seam → typecheck PASS 12:51 →
  **lint lại vì config vừa regenerate** → PASS 12:52 → mutation 11/11 → specs 10/10 lại. `tests/unit/**` không nằm trong graph
  typecheck của Nuxt (`.nuxt/tsconfig.app.json` chỉ lấy `../tests/nuxt/**`), nên spec chạy bằng tsx và không được gate 1 soi;
  đó là lý do seam phải tự khai kiểu đúng, chứ không dựa vào spec bắt lỗi.
- Chặng cuối **không phải** noise: đọc lại diff trước khi commit thấy `packages/core/src/index.d.ts` có một dòng bị nối
  (`/** ... */export interface CoreEncodeSupportAnswer {`) do chính tôi sửa ẩu — typecheck và test đều không bắt vì nó là
  comment nối với khai báo, chỉ người đọc mới thấy. Tách dòng ra rồi chạy lại toàn bộ: core tsc exit 0 (13:00), core 795/795
  (13:00), typecheck exit 0 + 0 `error TS` (13:01, config regenerate 13:01), lint 5 file chạm exit 0 (13:01), unit 129/129.
  Gate 2 từ đó chạy trên **năm** file, không phải bốn: `exportEncode.mjs`, `index.d.ts`, `exportEncodePlan.ts`,
  `export-encode-presets.test.mjs`, `tmcut_export_encode_plan.spec.ts`.

Probe 49.4 **không** chờ gate 4: WebCodecs globals có sẵn trên trang login, và đọc capability là thao tác không đăng nhập.

### 49.7 Chưa chứng minh / nợ

- **Chưa có consumer.** Không component nào gọi `createEncodeCapability`; dialog export vẫn spawn FFmpeg. Lượt này dựng đường ray,
  chưa chạy tàu.
- **Chưa một frame nào được encode.** Không `VideoEncoder` thật nào được instantiate, không mux, không file, không bằng chứng
  A/V sync. Luật timestamp `planEncodeSample` ở §48.2 vẫn mới chỉ đúng trong test.
- `hardwareAcceleration` không phân biệt được trên máy này, nên **hardware H.264 vẫn chưa chứng minh** (đúng điều ADR-030 yêu cầu).
- **Electron chưa đo.** Ma trận 49.4 là Chrome 156 của trình duyệt ngoài; Electron main mang Chromium version riêng và có thể có
  câu trả lời khác, nhất là về phần cứng. Leg này phải đo lại trong Electron khi gate 4 mở.
- **Bitrate 0.1 bit/sample là phỏng đoán kỹ thuật, không phải số đo chất lượng**, chưa hiệu chỉnh trên footage thật.
- 8K bị từ chối **theo luật**; chưa có runtime nào được đo để xem nó có encode 8K không, luật chỉ nói "không level nào trong tập
  ta hỏi chở nổi".
- Audio timestamp vẫn **không có luật riêng** (kế từ §48.6), và allowlist `mediabunny`
  (`tmcut_media_probe.spec.ts:350`, `tmcut_silence_scan.spec.ts:189`, `tmcut_autocut_detect.spec.ts:108`) vẫn nguyên; slice H3 sẽ
  phải **cố ý** sửa ba chỗ đó.

## 50. Slice H3a — đồng hồ audio là một phép chia sample count, và nó phải kết thúc cùng chỗ video kết thúc (đo ngày 2026-11-06)

§48.6 để lại đúng một câu nợ: "`planEncodeSample` quy đổi từ **ticks** … packet PCM đến từ mixer cần một luật tính theo
sample count." H3 là lượt exporter thật, và exporter thật có **hai** đồng hồ. Luật của đồng hồ thứ nhất đã viết từ H1;
lượt này viết đồng hồ thứ hai, cộng một hằng số codec mà IO layer sẽ đoán sai.

### 50.1 Ba xuất khẩu mới ở `packages/core/src/exportEncode.mjs`

| Xuất khẩu | Luật | Vì sao không được nằm ở IO |
|---|---|---|
| `AUDIO_PACKET_FRAMES` | AAC (`mp4a.40.2` và `aac`) là **1024** sample/kênh/frame; Opus là 960 (20 ms @ 48 kHz); codec không có trong bảng thì **không có đáp án**, không có default | AAC-LC *là* 1024: một `AudioData` dài khác đi là một codec khác, và muxer sẽ nhận một file không decoder nào đồng ý đọc. Một vòng encode "cứ đưa bao nhiêu PCM cũng được" là lỗi thiết kế, không phải lỗi runtime |
| `encodeAudioSampleCount` | `round(contentEndTicks * sampleRate / TICKS_PER_SECOND)` — một lần làm tròn | nội dung kết thúc giữa hai sample (1/120 s @ 44,1 kHz = 367,5 sample); quyết định đó phải ghi một chỗ, nếu không mỗi bên tự `floor`/`ceil` một kiểu |
| `planEncodeAudioSample` | `timestamp = round(startSample * timescale / sampleRate)`, `duration = hiệu hai vị trí`, packet cuối mang **phần còn lại** chứ không nguyên frame | đây là chính xác lỗi H1 đã giết ở phía video, đặt trong tay người viết exporter là họ sẽ lấy `round(frameSize/rate)` rồi **nhân** lên theo số packet |

### 50.2 Cái giá của "durations bằng nhau": test tự viết ra số của nó

Bẫy này chỉ hiện ra khi chọn đúng timescale. Ở µs, 1024 sample @ 44,1 kHz là 23220 µs và `2 × 23220 = 46440` — **trùng**
với vị trí thật, nên một phép nhân duration trông hoàn toàn đúng. Ở 90 kHz (timescale mà container thật dùng) thì
`1024 → 2089,8 → 2090`, và ba packet nói `3 × 2090 = 6270` trong khi ranh giới thật là **6269**. Test
"keeps positions exact at 90 kHz" chốt ba vị trí 2090 / 4180 / 6269 và chốt luôn `duration` của packet 1 khác packet 2
(2090 vs 2089): duration không phải một hằng số, nó là hiệu hai vị trí.

Phát hiện thứ hai đến từ check "two clocks": audio và video **không** trùng nhau tuyệt đối. Với nội dung 1000 ticks
@ 44,1 kHz, video kết thúc ở 8333 µs còn audio ở 8345 µs — audio không thể bắt đầu giữa hai sample. Hiệu 12 µs nhỏ hơn
một sample (22,68 µs) và đó là **toàn bộ** dung sai mà lượt H3c được phép tuyên bố khi đo A/V sync, chứ không phải "0 ms".
Hai đồng hồ trùng khít khi nội dung dài đúng một số nguyên lần sample (30 frame @ 30 fps = 48000 sample = 1 000 000 µs;
và cùng cặp đó ở 29,97 fps là 1 001 000 µs, tức luật H1 và H3a chia sẻ đúng một nguồn: `contentEndTicks`).

### 50.3 Bằng chứng

15 checks trong `packages/core/test/export-encode-audio.test.mjs` (RED trước: import fail vì luật chưa tồn tại; một
assertion 90 kHz của tôi sai số học ngay lần chạy đầu — 2090 chứ không phải 2092 — và tôi sửa **test** vì production
code chưa tồn tại, tức sửa theo phép chia chứ không theo code). Core: **810/810**, `tsc -p packages/core` exit 0,
boundaries PASS. **Mutation 12/12 CAUGHT** (M1 duration-nhân-lên, M2 packet cuối nguyên frame, M3 packet bắt đầu đúng
ranh giới vẫn được ghi, M4 không packet nào `isLast`, M5 `floor` thay `round`, M6/M9/M12 chấp nhận số fraction, M7 Opus
bị nhồi 1024, M8 default timescale thành ms, M10 bỏ clamp ở cuối, M11 nội dung ≤ 0 vẫn đếm), nguồn restore
**IDENTICAL** (md5 `749f5e94419a924688e32189cae108ca`).

Con số 12/12 đó **không** chạy trên cây được commit cho tới khi nó được chạy lại. Harness mutation keyed bằng **chuỗi
nguyên văn** của nguồn, và `@stylistic/quote-props` đổi `opus: 960` thành `'opus': 960` để lint exit 0 — mẫu của M7 vì
thế không còn khớp, M7 **không được áp** mà lần chạy cũ đã kịp báo CAUGHT. Khi chạy lại trên cây chốt, harness in ra
`PATTERN MISSING` (đúng điều một harness trung thực phải làm thay vì âm thầm bỏ qua), và chỉ sau khi sửa mẫu của M7 thì
12/12 mới là sự thật của cây này. Bài học ghi thành luật làm việc, không phải thành chú thích: **mọi bằng chứng mutation
phải được sản xuất trên đúng md5 của nguồn sắp commit**, và một lần gate ESLint `--fix`/sửa style là một lần buộc chạy lại
mutation. Đây là cùng một lớp lỗi với ba lỗi comment ở §50.5: cơ chế kiểm tra bám vào văn bản nguồn sẽ im lặng khi văn
bản đó đổi, còn logic thì không đổi.

### 50.4 Chưa chứng minh / nợ

- **Chưa encoder thật nào nhận một `AudioData` 1024 sample** trên máy này. `AUDIO_PACKET_FRAMES` là luật của định dạng,
  không phải kết quả đo; H3c phải ghi lại câu trả lời của `AudioEncoder` thật, theo đúng cách §49.4 ghi cho video.
- **Chưa có consumer**: `planEncodeAudioSample` chưa được gọi từ file app nào. Nợ này có tên và có lịch trình — H3b là
  `createEncodeSession`, chính là consumer — khác với §48 ở chỗ nợ này được khai ra trước khi viết code, chứ không
  phải lúc viết docs mới phát hiện.
- Chưa mux, chưa file, chưa A/V sync đo trên track thật; `mediabunny` vẫn chưa có một dòng output nào.

### 50.5 Gate chạy trên working tree này (HEAD `bd7fbf5`)

| Gate | Lệnh | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | **PASS** | exit 0, 0 × `error TS`; `.nuxt/eslint.config.mjs` regenerate **13:41** (28 605 B) — lần này là lần có hiệu lực, vì code còn đổi sau lần 13:37 |
| 2 Lint | `npx eslint` trên 3 file chạm, chạy **sau** gate 1 | **PASS** | exit 0 ở **13:42**; **lần đầu FAIL 2 lỗi** `@stylistic/quote-props` ở `AUDIO_PACKET_FRAMES` (một khóa bắt buộc phải quote vì có dấu chấm nên các khóa còn lại không được để trần), sửa trong file chạm rồi chạy lại |
| 3 Unit | `npx tsx tests/unit/run-all.mts --smoke` | **PASS** | **129/129**, exit 0 lúc **14:05** và `grep -c '^FAIL'` = 0, sau mọi sửa đổi kể cả hai bản sửa docs gần nhất; các spec guard doc (charset / citations / line-length / link-integrity) PASS ở chính lần chạy này. **Lúc 13:47 FAIL 128/129** — xem lỗi thứ tư bên dưới. Lần **14:09 PASS 129/129** là lần chạy trên đúng cây commit, khác 14:05 chỉ ở hai câu ghi số giờ này. |
| 3b Core | `node --test "packages/core/test/*.test.mjs"` | **PASS** | **810/810** (795 + 15 checks mới), exit 0 lúc **13:41**; riêng `export-encode-audio.test.mjs` = 15/15 |
| 3c Core types | `npx tsc -p packages/core --noEmit` | **PASS** | exit 0 lúc **13:41** |
| 3d Boundaries | `node packages/core/tools/check-boundaries.mjs` | **PASS** | exit 0: core không import gì platform-specific, `mediabunny` chưa file nào mới import |
| 3e Mutation | 12 mutant trên `exportEncode.mjs`, restore bằng md5 | **12/12 CAUGHT** | md5 sau restore `749f5e94419a924688e32189cae108ca`; **lần chạy đầu trên cây chốt báo 11/12 + `PATTERN MISSING` ở M7** — xem lỗi thứ năm |
| 4 Live | — | **N/A** | lượt này chỉ chạm `packages/core/**` + docs; không file `app/**` nào đổi nên không có đường render nào mới |

Ba lỗi pre-commit read bắt được, **không gate nào bắt được**, và cả ba nằm trong phần luật vừa viết:

- `planEncodeQueue` mất dòng ` *` trống: `* * @param {{ inFlight?: number, limit?: number }} input`. Đây là **lần thứ ba**
  cùng một kiểu lỗi trong hai lượt (đã ghi ở §49.6 hai trường hợp ở `index.d.ts`), và nó vẫn compile, vẫn lint sạch, vẫn
  typecheck exit 0 — `tsc` không đọc `@param` như một ràng buộc. Nguyên nhân cơ học: một Edit có `old_string` kết thúc
  ngay sau tên hàm nên lần chèn ăn cả newline đầu dòng.
- JSDoc của `planEncodeAudioSample` chép số học **của bản nháp bị sai**: "1024 sample @ 44,1 kHz = 2091,61 unit của clock
  90 kHz, packet thứ hai muộn một unit". Con số đúng là **2089,80 → 2090**, packet 2 vẫn khớp (4180), và độ lệch chỉ hiện
  ở packet 3 (`3 × 2090 = 6270` so với ranh giới thật **6269**). Test đã chốt 2090/4180/6269 từ lâu; comment thì không
  ai chạy. Một comment sai số học trong file luật là loại lỗi worse hơn comment thừa: người đọc lượt sau sẽ sửa code
  theo comment.
- JSDoc của `encodeAudioSampleCount` nói "nội dung kết thúc trên ranh giới sample" trong khi chính luật đó tồn tại vì
  nội dung **không** kết thúc trên ranh giới sample (367,5 sample cho 1/120 s @ 44,1 kHz). Sửa thành "thường kết thúc
  giữa hai sample, và đây là chỗ duy nhất quyết định điều đó".

Lỗi thứ tư không nằm trong code mà do **gate bắt**, và cách xử lý là phần đáng ghi: `tmcut_doc_line_length.spec.ts` FAIL
trên lượt chạy cuối, vì dòng ADR-030 trong bảng trạng thái phình lên 1437 ký tự (> trần 1356). Guard đó không chỉ cấm
dòng dài, nó còn khẳng định **chỉ** `docs/v4-phase-0-audit.md` được phép có bảng dài — tức thêm một file vào danh sách
dòng dài là đổi luôn ý nghĩa của guard. Hai đường: nới allowlist của test, hoặc viết lại cho ngắn. Chọn đường thứ hai,
vì đây là đúng điều guard này được sinh ra để chặn (§71: một dòng 19k ký tự lớn lên từng câu một). Kết quả: 1198 ký tự,
và chứng minh bằng round-trip — bỏ đúng một câu vừa thêm thì dòng khớp **byte-for-byte** với bản HEAD, nên không có nội
dung nào khác của ADR bị chạm trong lúc sửa.

Lỗi thứ năm cũng do gate bắt, và nó dạy một điều khác bốn lỗi trên: mutant M7 ("Opus bị nhồi 1024") đã báo CAUGHT trên một
cây mà chính lệnh lint `--fix` sau đó đổi chữ ký — `opus: 960` thành `'opus': 960` — nên pattern chuỗi nguyên văn của M7
không còn khớp và mutant **không được áp** nữa. Harness trung thực nên mới in `PATTERN MISSING` thay vì âm thầm bỏ qua, và
12/12 chỉ là sự thật của cây được commit sau khi chạy lại trên md5 `749f5e94419a924688e32189cae108ca`. Chi tiết và bài học
ghi ở §50.3; ở đây ghi vì nó là lần đầu tiên một bằng chứng **đã báo PASS** bị chính bằng chứng đó bác bỏ trong cùng một lượt.

Sequence thật: law test RED (import fail) → luật → 14/15, một assertion 90 kHz của **test** sai số học → sửa test theo
phép chia (2090/4180/6269) → 15/15 → mutation 12/12 → docs §50 + note ADR → typecheck 13:24 → lint **FAIL 2** →
quote-props → typecheck 13:25 → lint PASS 13:25 → core 810 → unit 129/129 13:30 → **pre-commit read** bắt ba lỗi comment
→ sửa comment → core 810 + tsc + boundaries 13:41 → typecheck 13:41 (config regenerate) → lint 13:42 → **unit FAIL
128/129** (dòng ADR-030 1437 ký tự, `tmcut_doc_line_length.spec.ts`) → viết lại dòng còn 1198, không nới guard → **mutation
chạy lại trên cây chốt: 11/12 + PATTERN MISSING** → sửa pattern M7 → 12/12, restore IDENTICAL → docs (md5 + lỗi thứ năm) →
unit **129/129 lúc 13:52**, không được tính vì docs đổi sau đó → sửa nốt md5 trong note ADR và §50.5 → unit **129/129 lúc
14:05**. Kết quả lint 13:25 và 13:38, và cả lần mutation 12/12 đầu, **không** được tính: mỗi cái đứng trước một lần cây đổi,
tức là proof của một cây khác.

## 51. Slice H3b — `createEncodeSession`: hai đồng hồ chạy chung một vòng, và encoder được phép trả lời lộn xộn (đo ngày 2026-11-06)

§49 dựng cách **hỏi** runtime, §50 dựng cách **tính** hai đồng hồ. Lượt này dựng chỗ chúng chạy với nhau:
`app/utils/tmcut/exportEncodeSession.ts` — 776 dòng, file đầu tiên của leg encode + mux. Hình dạng của nó là kết quả của
một đòi hỏi: seam **không có quyền tự quyết**. Vòng lặp chỉ là `planEncodeFinish(counters())` rồi làm đúng việc nó nói;
việc của seam là gọi API của runtime và ghi lại đúng số cho lần hỏi kế tiếp. Mọi con số đều đi qua core.

### 51.1 Ranh giới core/seam cắt ngang từng con số

| Việc | Luật nằm ở core | Seam chỉ được làm |
|---|---|---|
| Packet đặt ở đâu theo clock | `planEncodeSample` (§48.2) và `planEncodeAudioSample` (§50.1) | gọi luật, rồi đưa **đúng số sample** cho `VideoFrame`/`AudioData`; không tự cộng timestamp từ wall clock |
| Được phép nhét bao nhiêu sample vào encoder | `planEncodeQueue` (§48.2) | giữ `inFlight` và trả nó **một lần duy nhất** |
| Track nào được đóng khi nào, theo thứ tự nào | `planEncodeFinish` | không hỏi lại; `stalled` là `throw`, không phải `wait` |
| Packet đầu của một track phải mang gì | `planEncodePacketMeta` | giữ packet trong `parked` và nhả credit tương ứng với việc đã giữ |
| Tiến trình bao nhiêu % | `planEncodeProgress` | đọc counters rồi đưa cho core; không tự chia |

Ba câu trả lời của core được dịch thành `throw` thay vì chờ, vì chờ chúng là một export không bao giờ kết thúc: `stop`
(container đã `canceled` hoặc đang bị người khác finalize — không ai viết vào đó được nữa), `stalled` (món nợ không lệ
nào trả nổi), và `null` từ `planEncodeFinish`/`planEncodeProgress` (seam khai bộ counters mà core không đọc được, tức
file đang nói về mình hai chuyện khác nhau).

### 51.2 Credit của queue: packet bị giữ chờ description không còn là việc của encoder

Hai đồng hồ chỉ gặp nhau nếu mỗi sample đưa vào encoder được **trả** đúng một lần. Có một trạng thái bản đầu xử lý sai:
packet đã rời encoder nhưng chưa vào file được, vì packet đầu tiên của track phải mang decoder description
(`planEncodePacketMeta` trả `hold`). Nếu packet đó vẫn giữ slot `inFlight` thì không ai còn giảm được số đó nữa: encoder
đã nhả packet nên không việc gì trả lại slot, còn muxer thì chưa viết được — `planEncodeFinish` sẽ chờ một slot mà
**không còn ai có thể trả**. Seam nhả credit ngay khi park (`onChunk`: `parked.push` rồi `inFlight -= 1`); khi description
đến, đống parked được write với `credit: false` để không trả lần thứ hai — trả hai lần làm `inFlight` âm, và core có quyền
từ chối đọc một bộ counters không cùng đúng được.

Lớp thứ hai của cùng một lỗi nằm ở phía core, và nó là luật mới của lượt này:

```
const drained = (inFlight, written, parked, handed) => inFlight > 0 && written + parked >= handed
```

`inFlight > 0` một mình không nói "encoder còn việc"; nó chỉ còn nghĩa khi **có một sample đã đưa mà chưa vào file và
cũng không nằm trong đống parked**. Đủ điều kiện thì `planEncodeFinish` trả `wait` (chờ chính lời write của mình), không
đủ thì trả `stalled` kèm tên món nợ. Trạng thái đó có log thật: seam ở mutant S5 (packet held vẫn giữ slot) chết với
`the encode stalled, still owing video-in-flight: 3/3 video and 47/47 audio packets reached the file` — mọi packet đã vào
file mà `inFlight` vẫn dương. Không có `drained` thì câu trả lời cho cùng trạng thái là `wait`, và `wait` với một món nợ
không ai trả nổi là export treo vĩnh viễn. Bằng chứng: M2 (`stalled` đổi thành `wait`), M14 (bỏ điều kiện
drained), M15 (off-by-one `>` thay `>=`), M16 (đổi tên lý do audio để không khớp điều kiện nào), M17 (parked bị tính là
việc của encoder), M18 (đống parked không được đếm) — **18/18 CAUGHT**, cùng S4/S5 ở phía seam.

### 51.3 Danh tính sample: chunk phải trả đúng sample nó sinh ra, không phải sample cũ nhất

Đây là lỗi thật duy nhất lượt này tìm ra **bằng cách đọc luật**, và phải viết lại fake runtime mới bắt được. Seam giữ các
sample chưa đóng trong một mảng FIFO (`open: TmcutCloseable[]`) và khi có chunk thì `open.shift()`. Với encoder in-order
thì đúng. Nhưng WebCodecs cho phép encoder **đổi thứ tự output** mà không cần lý do: chunk đầu tiên trả về không nhất thiết
là sample đầu tiên đưa vào. Khi ấy `shift()` đóng một `VideoFrame` mà encoder **vẫn còn đang giữ** — `close()` là lời báo
"hết dùng, thu hồi được", gọi sớm thì buffer bị lấy lại trước khi encoder đọc xong — còn sample thật của chunk thì được
tính là đã trả ở một thời điểm sai. Số lần close vẫn khớp, nên không check nào kiểu "mỗi frame đóng đúng một lần" bắt
được; chỉ một assertion về **thời điểm** mới thấy.

Sửa: `handed: Map<number, TmcutCloseable>`, key là timestamp đã đưa sample vào encoder, vì `EncodedVideoChunk.timestamp`
chính là media timestamp của sample nó được tạo ra. Sample được đăng ký **trước** lời gọi `encode()`, vì khi `flush()`
được gọi cả queue còn lại trả về trong một nhịp — chunk đầu tiên phải tìm thấy sample của nó ngay. Chunk không khớp
timestamp nào là runtime cãi lại clock của core: seam `fail` thay vì đoán, vì đoán thì đóng nhầm buffer của packet khác
và file sẽ mang một timestamp không ai paint.

Test phải có bằng chứng đỏ trước khi sửa. `fakeRuntime` thêm tùy chọn `videoReorder`: encoder không trả gì trong
`encode()`, giữ hết và chỉ nhả trong `flush()`, theo thứ tự decode `[0, 66_667, 33_333]` cho 3 frame; mỗi frame được ghi
vào `held`, và `close` của frame chép mọi lần đóng sớm vào `illegalCloses`. RED của check mới (22/22 sau khi sửa):

```
AssertionError [ERR_ASSERTION]: each chunk closed its own frame
+   [33333]      // chunk thứ hai là của frame 66_667, FIFO lại lấy frame 33_333 ra đóng
-   []
```

Lỗi này **không gate nào bắt được** nếu fake runtime chỉ in-order: 21 check cũ vẫn xanh hết. Mutant S10 (đóng sample cũ
nhất) và S11 (không đăng ký sample) đều CAUGHT, nên cả hai nửa của luật — "khớp theo timestamp" và "đăng ký trước khi
đưa" — đều có test, không chỉ có comment.

### 51.4 API đọc lại từ file khai, không nhớ từ lượt trước

Mỗi claim dưới đây được đối chiếu `.d.ts` của `mediabunny@1.65.1` và WebCodecs IDL ngay trong lượt này, vì seam nằm giữa
hai thứ và một sai lệch nhỏ chỉ hiện ra khi có file thật:

| Claim | Đọc ở đâu | Hóa thành gì trong seam |
|---|---|---|
| `Output.state` là field thường, union `pending`/`started`/`canceled`/`finalizing`/`finalized` | `.d.ts` của mediabunny | `counters().outputState` đọc trực tiếp; `canceled` và `finalizing` đều là `stop` = throw |
| Track chỉ thêm được **trước** `start()` | docs `addVideoTrack`/`addAudioTrack` | `mediabunnyMuxer` dựng track lúc tạo, trước khi core ra lệnh `start` |
| `add(packet, meta?)`: "pass this for the first call, including a valid decoder config"; promise là backpressure | docs `EncodedVideoPacketSource.add` | description đi **cùng** packet đầu, và write serialize qua `chain` vì container nhận packet theo decode order |
| Decoder description là argument **thứ hai** của output callback; `EncodedVideoChunk` không có property `metadata` | WebCodecs IDL | `output: (chunk, metadata) => handlers.output(chunk, metadata)`; mutant S2 (làm rơi metadata) CAUGHT |
| `AudioDataInit.duration` tính bằng **giây** trong khi timestamp vẫn là µs | WebCodecs IDL | check 'AudioData is promised seconds while its timestamp stays microseconds' |
| `EncodedPacket.fromEncodedChunk(chunk)` là đường vào của packet đã encode | docs | seam không tự dựng packet, không tự đặt codec string |
| `BufferTarget.buffer` là `ArrayBuffer \| null` cho tới khi finalized | docs | `result()` chỉ đọc sau khi core cho phép finalize |
| `VIDEO_CODECS`/`AUDIO_CODECS` là **họ codec**, không phải fourcc | docs | `videoFamily`/`audioFamily` trả member hợp lệ của bảng đó (`avc1.640028` → `avc`) |

### 51.5 Allowlist container sửa **có chủ ý** — và §49.7 đếm sai một chỗ

Guard "ai được phép mở container" là danh sách đóng băng, nên thêm `exportEncodeSession.ts` vào là một thay đổi phải khai
ra. Hai file đã sửa: `tmcut_media_probe.spec.ts` (rule 12 đổi thành "bốn seam sở hữu container", danh sách holder thêm
`app/utils/tmcut/exportEncodeSession.ts`) và `tmcut_silence_scan.spec.ts` (check "the container belongs to exactly four
modules"). Chỗ thứ ba mà §49.7 hứa sẽ phải sửa — `tmcut_autocut_detect.spec.ts:108` — **không** cần đụng tới, và lý do
đáng ghi vì đây là một dự đoán sai chứ không phải một chiến thắng: check đó assert điều **phủ định** về một file cụ thể
(`autocutDetect.ts` không được import `mediabunny`), nên thêm một holder ở nơi khác không làm nó sai. §49.7 gộp nhầm một
assert phủ định vào nhóm assert danh sách.

### 51.6 Bằng chứng

| Gate | Lệnh | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | **PASS** | exit 0, 0 × `error TS`, lúc **15:46**; `.nuxt/eslint.config.mjs` regenerate **15:45** (28 605 B). Gate 1 là bằng chứng type **duy nhất** của seam vì `tsx` không typecheck, và seam thật sự nằm trong graph đó qua `../app/**/*` của `.nuxt/tsconfig.app.json` |
| 2 Lint | `npx eslint` trên 6 file chạm, chạy **sau** gate 1 | **PASS** | exit 0 lúc **15:46**, 0 problems; chỉ lần chạy sau regenerate 15:45 mới có hiệu lực |
| 3 Unit | `npx tsx tests/unit/run-all.mts --smoke` | **PASS** | **130/130** (thêm spec 22 check của seam), exit 0, 0 dòng `FAIL`, lúc **16:19** — lần đọc đúng cây commit, sau mọi sửa docs vì doc guards đọc `docs/**`. Các lần 15:57 / 16:02 / 16:12 cũng 130/130 nhưng là của những bản docs trước; khác biệt giữa chúng chỉ là chữ số giờ và citation, không phải nội dung kỹ thuật, và lần chạy lại **sau** câu này (ghi ở §51.8) xác nhận vẫn 130/130 |
| 3b Core | `node --test "packages/core/test/*.test.mjs"` | **PASS** | **838/838**, exit 0 lúc **15:46** |
| 3c Core types | `npx tsc -p packages/core --noEmit` | **PASS** | exit 0 lúc **15:46** |
| 3d Boundaries | `node packages/core/tools/check-boundaries.mjs` | **PASS** | exit 0: core vẫn không import gì platform-specific; `mediabunny` chỉ nằm trong 4 holder ở §51.5 |
| 3e Mutation core | 18 mutant trên `exportEncode.mjs` | **18/18 CAUGHT** | md5 `82af69d535c2fa2409c6e330052530e8`, restore **IDENTICAL**, chạy **15:48** |
| 3f Mutation seam | 11 mutant trên `exportEncodeSession.ts` | **11/11 CAUGHT** | md5 `5bda4be0d0bbd2bc4d0e6ba63dd53169`, restore **IDENTICAL**, chạy **15:57** (hai lần trước đó cùng 11/11 và 10/11, xem đoạn dưới); S10/S11 là hai mutant của luật reorder ở §51.3 |
| 4 Live | — | **N/A** | chưa route/component nào import `createEncodeSession` (`grep` chỉ ra chính nó và spec của nó); lượt H3c mới mở đường đó |

Một bằng chứng mutation **không** được tính, theo đúng luật §50.3. Pattern S6 cũ trỏ vào
`const sample = who.open.shift()` — đúng câu mà luật reorder ở §51.3 vừa xóa — nên harness in `PATTERN 0/1` và báo
**10/11** thay vì âm thầm xanh; viết lại S6 thành "sample đã đóng vẫn nằm trong map nên teardown đóng lại" thì hai lần
chạy trên md5 chốt mới đạt 11/11. Đây là lần thứ hai luật "bằng chứng mutation phải sản xuất trên đúng md5 của nguồn sắp
commit" cứu một bằng chứng rỗng, và cả hai lần nó cứu được nhờ harness in `PATTERN` thay vì im lặng.

### 51.7 Chưa chứng minh / nợ

- **Chưa có consumer.** `createEncodeSession` chưa được file app nào import; dialog export vẫn spawn FFmpeg. Lượt này
  dựng đường ray cho cả leg encode lẫn leg mux, chưa chạy tàu.
- **Chưa một `VideoEncoder`/`AudioEncoder` thật nào** nhận một sample từ seam; chưa mux, chưa file, chưa A/V sync. Mọi
  claim ở §51.4 là đọc `.d.ts`, chưa phải đo.
- **Reorder mới chỉ được chứng minh bằng một fake runtime chịu reorder.** Chrome thật có reorder không và reorder bao xa
  là **số chưa đo**; `AUDIO_PACKET_FRAMES` (1024) cũng vẫn là luật của định dạng chứ không phải câu trả lời của
  `AudioEncoder` thật. H3c phải ghi lại cả hai, theo đúng cách §49.4 ghi ma trận capability.
- **Electron chưa đo** (kế từ §49.7): ADR-030 vẫn đòi một lần đo trong runtime thật, và `hardwareAcceleration` vẫn không
  phân biệt được phần mềm/phần cứng trên máy này.
- **Bitrate và level vẫn là phỏng đoán theo chuẩn**, chưa hiệu chỉnh trên footage thật (§49.7 còn nguyên).
- Write bị **vòng lặp** chặn chứ không bị chuỗi `chain` chặn: sau một writer bị từ chối, `chain` vẫn còn những bước đã xếp
  và chúng tự nuốt lỗi qua `try/catch`, rồi file bị cancel. Không test nào chứng minh điều đó gây hại, nên nó được ghi ở
  đây thay vì sửa mà không có test đỏ.

### 51.8 Sequence thật của lượt này

Đọc lại `.d.ts`/IDL → seam bản 1 → 21 check xanh (trên fake in-order) → **đọc luật reorder, thấy FIFO là một lỗi thật** →
RED: check 22 với `videoReorder` + `illegalCloses`, fail `+ [33333] - []` → GREEN: `handed` Map, 22/22 → typecheck exit 0
(15:40, rồi 15:46 sau lần regenerate gần nhất — lấy lần 15:46) → lint 6 file exit 0 (15:46) → core 838/838 + `tsc -p
packages/core` + boundaries (15:46) → mutation core **18/18** (15:48) → mutation seam **10/11 vì pattern S6 stale** →
sửa S6 → docs §51 + ADR → **đọc lại chính văn mình vừa viết**, sáu chỗ sửa: citation `planEncodeQueue (§48.4)` sai (luật
bound nằm ở §48.2, còn §48.4 là mục mutation), số dòng của `tmcut_autocut_detect.spec.ts` phải là `:108` chứ không phải
`:104`, câu luật (2) mất chủ ngữ vì một lần sửa văn, một chỗ thiếu space sau dấu gạch, comment của RED ghi **sai timestamp**
(`66_667` trong khi giá trị đo được là `33333` — chính frame bị đóng sớm là frame 33 ms), và claim "để lọt sample thật"
phải bỏ vì **số phép close vẫn khớp**, chỉ thời điểm là sai → 4 doc guards exit 0 → unit 130/130 (15:57) → seam mutation
**11/11** trên đúng md5 sắp commit (15:57) → unit 130/130 (16:02) → unit (16:12) → unit **16:19** → viết lại §51.6/§51.8
bằng chính các số giờ vừa đo → **một lần suite cuối cùng** chạy trên cây commit, và câu này tồn tại để nó được kiểm chứng:
nếu nó không in ra 130/130 thì §51.6 sai và phải sửa.

## 52. Slice H3c — encoder thật trả lời bằng số, và file mp4 đầu tiên có A/V offset 0,000 ms (đo ngày 2026-11-06)

§51.7 đóng bằng một câu nợ: "**Lượt H3c là lượt consumer**". Trước khi viết consumer, lượt này trả **bằng số** hai câu
mà seam đang giả định — `VideoEncoder` có reorder không, và `AUDIO_PACKET_FRAMES` (1024) là cỡ frame của chính
`AudioEncoder` hay chỉ là luật của định dạng — rồi mới nối `createEncodeSession` vào một `Output` thật. Cách đo lấy theo
§49.4: chạy trên đúng trang đang serve, ghi raw answer, **sau đó** mới sửa luật. Số liệu thô:
`node_modules/.cache/tmcut-gates/h3c/probe-2026-11-06.md` (Chrome trên Windows, ngày 2026-11-06, trang `:4003`).

### 52.1 Ma trận output của encoder thật

Bảng này là câu trả lời của **máy này**, viết ra để lượt sau khỏi đoán; cột cuối là luật nó buộc.

| Câu hỏi | Số đo | Luật nó buộc |
|---|---|---|
| `VideoEncoder` có đổi thứ tự output không? | 9 run (avc1.640028 ở 48 frame màu quét, 48 frame đặc, 120 frame nhiễu mỗi điểm ảnh 1080p, `latencyMode` bỏ trống / `realtime` / `quality`; vp09.00.50.08 48 frame; avc 1280x720): `chunks == frames`, `maxReorder 0`, `unknownTimestamps 0`, `maxSentAheadOfOutput 0`, output stamp khớp **từng µs** với stamp đã đưa | giữ luật khớp-theo-timestamp của §51 cho video, nhưng không được **dựa** vào nó: một runtime im lặng hôm nay không hứa gì cho ngày mai, nên stamp lạ vẫn phải là một lời từ chối (§52.2) |
| `AudioEncoder` có echo timestamp không? | **Không.** Core grid đưa `[0, 21333, 42667, 64000, 85333, 106667]` → nhận `[0, 21333, 42666, 64000, 85333, 106666]`; 44,1 kHz đưa `[0, 23220, 46440]` → nhận `[0, 23219, 46439]`; **8 packet cùng stamp 12345** → `12345, 33678, 55011, 76345`; input **giảm dần** `170664, 149331, …` → `170664, 191997, 213330` | audio không có danh tính theo timestamp: encoder tự sinh clock của nó và chỉ packet **đầu** ăn theo input. `planEncodeChunk` ([exportEncode.mjs:764](file:///D:/Applications/tm-studio/packages/core/src/exportEncode.mjs#L764)) trả luôn danh tính, seam chỉ vâng |
| Trần dưới của một luồng AAC | 1 hand (sine **hoặc** silence thuần) → `flush()` **ném** `EncodingError: Flushing error.`; 2 hand → flush sạch và trả đúng 2 output | số **hand** tối thiểu là một luật riêng (`AUDIO_MIN_HAND_PACKETS`, [:662](file:///D:/Applications/tm-studio/packages/core/src/exportEncode.mjs#L662)), không suy ra được từ số packet |
| Bao nhiêu output cho N hand? | aac cỡ 1024: 2→2, 3→3, 4→4, 5→5, 8→8, 10→10, 47→47, 50→50; opus cỡ 960: 1→2, 3→4, 5→6, 25→26, 50→51, 100→101 | seam **đưa** `encodeAudioHandCount` ([:681](file:///D:/Applications/tm-studio/packages/core/src/exportEncode.mjs#L681)) nhưng **ghi** `encodeAudioPacketCount`: hai số khác nhau là chuyện thường của codec, không phải chỗ nào đó sai |
| Phần đuôi thì sao? | 10 hand nguyên + remainder `R` trong `{1024, 1023, 1008, 960, 896, 512, 256, 128, 64, 1}` → **11 output cả 10 lần**, `lastTs` luôn bằng grid(10) = 213333, `lastDur` 21328..21504; 47 hand nguyên + 896 → 48 output, `lastDur` 21333 trong khi content chỉ 18667 µs | encoder trả một **frame nguyên**, không trả phần còn lại. Packet vượt lịch là packet thừa: audio thì **bỏ**, video thì **từ chối cả run** |
| Cỡ hand có phải của encoder không? | aac nhận packet 960 sample → 20 in / 19 out, stamp vẫn nằm trên grid 1024; opus nhận packet 480 → 50 in / 26 out | **có**: `AUDIO_PACKET_FRAMES` ([:110](file:///D:/Applications/tm-studio/packages/core/src/exportEncode.mjs#L110)) đúng là cỡ frame của encoder. Đưa cỡ khác thì encoder tự chia lại và lịch không còn mô tả cái đã đưa |
| Khai báo codec | `"aac"` @48 kHz 2 kênh → `supported: false`; `mp4a.40.2` → true; opus true ở 48/44,1/22,05 kHz; mp4a false ở 22 050 và 32 000 Hz, true ở 48 000 Hz mono và 6 kênh | §49.3 đã đúng khi hỏi **cả hai spelling**; với AAC trên máy này chỉ một spelling sống, nên thang preset phải là nơi sinh ra nó |
| Keyframe và description | `keyCount` == số lần yêu cầu (4/48 frame, 1/120 frame); `decoderConfig` của avc **43 byte**, của vp09 là `description: null` | luật "description chỉ đi packet đầu của mỗi track" (§51) đứng nguyên; nhưng vp09 không description là một đường **chưa từng mở file** (§52.7) |
| Chặng nào chậm? | 1080p30, 90 frame vẽ bằng canvas: avc @6 039 360 hết 1438 ms tính cả flush = **16,0 ms/frame** (1136 kbps); vp09 1182 ms = 13,1 ms/frame (4318 kbps); 720p avc @5 Mbps 762 ms = 8,5 ms/frame. Vòng gọi `encode()` thuần: 0,3 ms/frame | encode **không** phải chặng chậm nhất: con số 53,9 ms/frame đo cùng ngày thuộc về máy **sinh frame** (`ImageData` từng điểm ảnh), không thuộc encoder. Muốn nhanh thì lo chỗ vẽ trước |

### 52.2 Ba luật phải viết lại vì số đo

Cả ba đều là chỗ seam đã **giả định**, và giả định sai; cả ba đều có mutant riêng (§52.6).

**(1) Audio không có danh tính theo timestamp.** §51 dựng luật "chunk khớp với sample nó sinh ra, theo timestamp" cho cả
hai leg. Số đo ở bảng trên giết nó cho audio: encoder trả `42666` cho `42667` vừa đưa, nên tra theo timestamp rơi thẳng
vào guard "stamp lạ" và **từ chối mọi export có tiếng**. Core trả luôn danh tính (`planEncodeChunk` → `identity` bằng
`ordinal` cho audio, `timestamp` cho video), seam chỉ vâng:
`release(who, step.identity === 'timestamp' ? chunk.timestamp : null)`
([exportEncodeSession.ts:471](file:///D:/Applications/tm-studio/app/utils/tmcut/exportEncodeSession.ts#L471)).
Test: `'an audio packet reaches the file on core's clock, matched by its order'`
([spec:475](file:///D:/Applications/tm-studio/tests/unit/tmcut_export_encode_session.spec.ts#L475)).

**(2) Packet vượt lịch: bỏ với audio, từ chối với video.** Opus đo được 50 in / 51 out, packet 51 là 3 byte im lặng
không thuộc sample nào. `planEncodeChunk` trả `drop-tail` cho audio, và trần `packetTotal` được tính **theo leg**
([:480](file:///D:/Applications/tm-studio/app/utils/tmcut/exportEncodeSession.ts#L480)) nên hai leg không thể dùng chung
một con số — một video packet ở stamp lạ vẫn phải là `fail`. Test:
`'the packet an encoder emits past the schedule stays out of the file'`
([spec:516](file:///D:/Applications/tm-studio/tests/unit/tmcut_export_encode_session.spec.ts#L516)); mutant
`tail-bound-by-frames` (dùng `who.queued` cho cả hai leg) chết ở câu
`the packet at 18666 us has no place on core's audio clock`.

**(3) Số hand không phải số packet.** `encodeAudioHandCount` là `max(packets, floor)`; với dự án 2 240 tick
(= 896 sample, một packet) thì file nhận 1 packet mà encoder đòi 2 hand. Seam hỏi mixer theo **hand**
([:675](file:///D:/Applications/tm-studio/app/utils/tmcut/exportEncodeSession.ts#L675)) và
`planEncodeAudioPadding` ([:707](file:///D:/Applications/tm-studio/packages/core/src/exportEncode.mjs#L707)) cấp nguyên
một frame 1024 sample im lặng, đặt đúng grid, cho cái hand mà file không nhận. Test:
`'a one-packet AAC stream is handed a second packet the file never takes'`
([spec:529](file:///D:/Applications/tm-studio/tests/unit/tmcut_export_encode_session.spec.ts#L529)).

### 52.3 Luật thứ tư: một packet không có byte thì file vẫn "đủ packet"

Ba luật trên là **số**; cái này là **chất**, và nó là lý do seam không được tự tay dựng packet. `TmcutMuxerPacket` mà
seam đưa cho muxer phải mang **byte của chunk** và clock của core: `stamp()`
([:566](file:///D:/Applications/tm-studio/app/utils/tmcut/exportEncodeSession.ts#L566)) dựng
`{ type, timestamp, duration, source: chunk }`, còn `toEncodedPacket()`
([:326](file:///D:/Applications/tm-studio/app/utils/tmcut/exportEncodeSession.ts#L326)) là cửa duy nhất sang
`EncodedPacket` của mediabunny (`EncodedPacket.fromEncodedChunk`), quy µs→s và chỉ `clone` khi hai số thực sự khác nhau.
Nó lọt được vì **mọi** counter của run (`videoPackets`, `audioPackets`, `progress`) vẫn xanh nguyên vẹn khi `source` rỗng:
file vẫn là mp4 đúng hình thức, hai track không có dữ liệu, và export "thành công". Test:
`'the packet the file is promised carries the encoder bytes'`
([spec:497](file:///D:/Applications/tm-studio/tests/unit/tmcut_export_encode_session.spec.ts#L497)) so object đã write
với đúng object encoder đã emit.

### 52.4 Hợp đồng timing của `flush()`, và hai chỗ phải nhận là làm ngược thứ tự

**Hợp đồng.** WebCodecs hứa mọi output đến trước khi `flush()` resolve. Fake runtime bản đầu giao packet *sau* khi flush
resolve — một runtime **không tồn tại** — và làm seam tin rằng "còn hàng đang về". Bản hiện tại giao hết trong lúc flush
còn pending rồi mới resolve; đó là điều kiện để mọi assertion về `inFlight` có nghĩa.

**Hệ quả đo được.** Một hand mà encoder không bao giờ trả (đúng case AAC floor 2 với dự án một packet, §52.1) để lại một
sample còn mở; `planEncodeFinish` chỉ còn cách nói `wait`, và export treo vĩnh viễn trong khi mọi counter đều báo đủ
packet. Seam vì thế nhả những sample còn mở ngay tại flush (`while (release(who, null)) who.inFlight -= 1`), để bước kế
tiếp là `stalled` → **từ chối run** thành tiếng. Test:
`'a hand the encoder never answers refuses the run instead of hanging it'`
([spec:554](file:///D:/Applications/tm-studio/tests/unit/tmcut_export_encode_session.spec.ts#L554)).

**Hai chỗ phải nhận.**

- Luật release-at-flush được viết **trước** khi có test đỏ cho nó; bản 27 check đã xanh khi nó tồn tại. Nó không có RED,
  nó có **bằng chứng mutation**: mutant `no-release-at-flush` bị chính check `spec:554` bắt
  (`the swallowed audio hand never settled in 2000ms`). §50.3 bắt loại đảo thứ tự này phải được ghi tên, nên nó đứng ở đây.
- Mutant `hands-from-packets` **đã lọt một lần**, và lý do nó lọt đáng ghi hơn bản thân nó. Bản `probes.sh` đầu tiên
  quyết định "caught" bằng `grep "All 27 export-encode-session checks passed"` — một con số hard-code. Khi check thứ 28
  ra đời, chuỗi đó không còn được in ra nữa, nên **mọi** mutant đều bị báo là caught: con số 8/8 viết lúc 17:2x là
  artifact của **marker**, không phải của phép đo. Đo lại bằng exit code của spec thì ra **7/8**, và mutant lọt không hề
  in FAIL: seam nằm chờ một promise không ai resolve, event loop cạn handle, và **Node thoát 0 với 16 check chưa chạy**.
  `specStatus()` ([helpers/spec_status.ts:34](file:///D:/Applications/tm-studio/tests/unit/helpers/spec_status.ts#L34))
  chỉ nhìn exit code và một dòng SKIP, nên một run cụt như vậy là PASS ở cấp runner. Đã chặn bằng watchdog đầu `main()`
  của spec (30 s, trong khi cả spec đo được 6,6 s): mutant giờ chết **có tên**, vì watchdog gọi đúng check bị kẹt
  (`"a one-packet AAC stream is handed a second packet the file never takes" never settled after 12 checks`), tức
  **8/8** trên đúng md5 sắp commit.

### 52.5 File thật đầu tiên: 28 305 byte, A/V offset đo được 0,000 ms

Content tự chọn để đo sync chứ không để đẹp: 90 frame đen cho tới index 30 rồi trắng (flash onset đúng 1,000 s), PCM im
lặng kỹ thuật số với một impulse 0,9 tại sample 48 000 (click đúng 1,000 s). Config **không** do người viết chọn: chính
`planEncodePresets` xếp thang và chấm trên `isConfigSupported` thật → mp4, `avc1.64001f`, 320x240 @ 30 fps,
1 000 000 bps, `mp4a.40.2` 48 kHz stereo.

| Đường đọc lại | Số đo |
|---|---|
| Run của seam | `paintCalls` 90, `pcmCalls` 141, outcome 90 video / 141 audio packet, `progress` 1, **336 ms** wall, blob **28 305 byte**, type `video/mp4; codecs="avc1.64001f, mp4a.40.2"` |
| Core tự tính | 141 packet và 141 hand — sàn AAC 2 không kịp binding ở 3 s |
| `mediabunny` `Input` | video track codec `avc`, audio track codec `aac`; `computeDuration()` = **3,000 s cho cả hai track** |
| `AudioBufferSink` | buffer đầu tại 0,000 s; giải mã ra **144 384 sample = 3,008 s** (141 × 1024); click tại **1,000000 s**; peak 0,8982 cho impulse 0,9 |
| `CanvasSink` | onset chia đôi qua 10 lần seek: luma 0 tới 0,99902 s, 255 từ **1,00000 s**; các stamp rơi đúng grid 1/30 |
| **A/V offset** | **1,000000 − 1,000000 = 0,000 ms** |
| Stack của trình duyệt (không phải thư viện đã ghi file) | `<video src=blob:>`: `loadedmetadata` duration 3, 320x240, `readyState` 4; seek 0,4 s luma 0, 1,2 s luma 255; chạy tới `ended` |

Hai chi tiết nên đọc kỹ vì chúng *không* phải 0. Phần đuôi 384 sample nằm **sau** chỗ file hứa (141 packet nguyên 1024
cho 144 000 sample nội dung) mà metadata vẫn nói 3,000 s — đó đúng là hệ quả "đuôi là một frame nguyên" ở §52.1, và cả
hai reader chấp nhận. Peak 0,8982 thay vì 0,9 là AAC lossy, không phải lệch clock.

### 52.6 Gate của lượt này

| Gate | Lệnh | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | PASS | exit 0 và 0 × `error TS`; `.nuxt/eslint.config.mjs` regenerate trước khi lint |
| 2 Lint | `npx eslint` trên 5 file chạm, chạy **sau** gate 1 | PASS | exit 0 |
| 3 Core | `node --test "packages/core/test/*.test.mjs"`, `tsc --noEmit -p packages/core`, `check-boundaries` | PASS | **864/864**, exit 0, `check-boundaries: PASS` |
| 3b Seam | `npx tsx tests/unit/tmcut_export_encode_session.spec.ts` | PASS | **28/28**, exit 0, 6,6 s |
| 3c Mutation | `probes.sh` trên đúng md5 sắp commit | PASS | **8/8** caught, seam md5 `e33fda76cf708b3b8c8e52642762a953` restore byte-identical |
| 4 Live | export thật trên trang `:4003` | PASS | các số ở §52.5 |
| 5 Suite | `npx tsx tests/unit/run-all.mts --smoke` | PASS | **130/130**, exit 0 |

### 52.7 Nợ còn lại

- **Chưa có consumer.** Seam vẫn không được route hay composable nào import (`grep` chỉ ra nó trong hai allowlist holder
  của spec). §51.7 hứa "lượt H3c là lượt consumer": phần **file** đã xong và đo, phần **UI** thì không — đó chính là H3d.
- **Reorder thật vẫn chưa đo.** Chín run của §52.1 đều không reorder, nên `maxReorder` của máy này là 0; guard và mutant
  `identity-by-timestamp` đang bảo vệ một tình huống **chưa từng quan sát** trên Chrome/Windows. Nó đáng giữ vì rẻ, không
  phải vì đã thấy.
- **Một bất đồng hands/packets treo run.** Seam tự chắn ở `:675`, còn core không bao giờ đòi quá số hand nó đã nhận qua
  `counters()`. Mutant `hands-from-packets` chứng minh nếu hai bên lệch nhau thì hậu quả là **treo**, không phải một lời
  lỗi; watchdog của spec nay nhìn thấy, nhưng đó vẫn là 30 s chờ chứ không phải một câu `throw`. Muốn lời lỗi to thì
  core phải nói rõ số hand tối đa nó sẽ đòi.
- **`specStatus` không thấy một run cụt.** Đây là vấn đề hạ tầng, chưa sửa ở đây vì nó chạm cả 130 spec: một spec exit
  0 giữa chừng hiện vẫn được báo PASS. Hướng sửa: spec tự khai số check và runner so số in ra với số khai.
- **Chưa mux:** opus/webm (sàn hand và luật tail đã đo nhưng chưa mở file), AAC 44,1 kHz, mono, và đường vp09 không
  `decoderConfig`.
- **Priming chỉ "không nhìn thấy".** 0,000 ms là số của *hai reader trên máy này* (mediabunny và `<video>`), không phải
  cam đoan của một player phần cứng hay một NLE. Edit list và av sync offset trên file có B-frame vẫn chưa có số.
- **Electron chưa đo.** Mọi con số ở §52 là Chromium của trình duyệt thường; `webEncodePorts` chưa chạy trong renderer
  của app.
- **Bitrate/level vẫn phỏng đoán theo chuẩn** (§49.7 còn nguyên); 16,0 ms/frame ở §52.1 là canvas bands, không phải
  footage thật.
- Write bị vòng lặp chặn chứ không bị chuỗi `chain` chặn (§51.7) — chưa có test chứng minh điều đó gây hại.

### 52.8 Sequence thật của lượt này

Đọc `.d.ts`/IDL → probe `isConfigSupported` (ma trận §49.4 nối dài sang audio: `"aac"` false, `mp4a.40.2` true) → probe
output của `VideoEncoder` (9 run, không reorder) và `AudioEncoder` (stamp tự sinh, 8 hand cùng stamp 12345, AAC floor 2,
đuôi frame nguyên, re-segment khi sai cỡ) → **sửa core**: `identity` trong `planEncodeChunk`, `encodeAudioHandCount`,
`planEncodeAudioPadding`, test core **RED trước** (16:57) rồi green (16:58) và 864/864 → **sửa seam**: ordinal cho audio,
tail drop, `packetTotal` per leg, hands khác packets, `TmcutMuxerPacket.source` + `toEncodedPacket` → 27/27 → live file
trên `:4003` (28 305 byte, offset 0,000 ms) → typecheck exit 0 **nhưng 8 × TS18047** `'packet' is possibly 'null'` mà
`tsx` không hề thấy (27 check vẫn xanh!) → `throw` có tên thay cho `!` → lint FAIL 3 lỗi style ở `mediabunnyMuxer`, do
một lần sửa văn trước đó ghép hai statement vào một dòng → tách dòng, lint exit 0 → **mutant `unknown-timestamp-accepted`
lọt**, nghĩa là guard "stamp lạ" không có test → RED check 28 với `videoBogusStamp` rồi 28/28 → mutation 8 mutant: bản
`probes.sh` hard-code "All 27" báo 8/8 **sai** → đo lại bằng exit code ra 7/8, và mutant lọt exit 0 với 16 check chưa
chạy → watchdog trong `main()` (mutant giờ chết **có tên**) → **8/8** → docs §52 + ADR → **một lần suite cuối cùng
chạy trên cây commit**; câu này tồn tại để nó bị kiểm chứng: nếu lần đó không in ra 130/130 thì §52.6 sai và phải sửa.


## 53. Slice H3d — trước khi có consumer: dự án nào exporter vẽ nổi, và plate nằm ở đâu (đo ngày 2026-11-06)

§51.7 và §52.8 cùng trả một câu nợ: "**Lượt H3d là lượt consumer** — nút export → `renderAt` → session → tải file".
Trước khi viết consumer, lượt này phải trả lời hai câu mà **không ai từng viết ra** ở bất kỳ đâu:

1. Project nào exporter WebCodecs vẽ nổi **một cách trung thực**? Câu cũ của §48 chỉ là "runtime có encoder không"; nó
   không nói gì về việc trong project có caption, có mask, có hàng chồng nhau hay không.
2. Plate của một clip nằm ở **chữ nhật nào** trên canvas? `renderAt` cho layers, session cho packet, nhưng giữa hai cái
   là chỗ vẽ — và chưa có luật nào mô tả chỗ đó.

Cả hai đều là luật **core**, chạy được không cần browser, nên đều có RED trước. Văn kiện của luật:
[exportContent.mjs](file:///D:/Applications/tm-studio/packages/core/src/exportContent.mjs) —
`planEncodeContent` ([:159](file:///D:/Applications/tm-studio/packages/core/src/exportContent.mjs#L159)) và
`planEncodePlate` ([:294](file:///D:/Applications/tm-studio/packages/core/src/exportContent.mjs#L294)).

### 53.1 Luật thứ nhất: từ chối **có tên**, đừng xuất ra đen

`ENCODE_REFUSAL_REASONS`
([:63](file:///D:/Applications/tm-studio/packages/core/src/exportContent.mjs#L63)) là một từ vựng **đóng và đủ**:
`bad-canvas`, `background-image`, `background-transparent`, `empty`, `stacked-rows`, `text`, `effects`, `mask`, `blend`,
`transition`, `reverse`, `stabilize`, `fit-unsupported`, `rotation` — 14 tên, chứ không phải 13: khi viết chân video của
consumer (increment H3d-2) mới lộ ra rằng canvas `background.type === 'transparent'` cũng là một thứ file không trả lời được.
Dây FFmpeg bật output có alpha đúng cho background đó (`render/index.ts:112`), còn thang preset chỉ hỏi H.264, VP9, AV1
**không có tuỳ chọn alpha** — nghĩa là painter sẽ giao màu đen ở chỗ preview cho xuyên qua. Đó đúng là lớp "im lặng khác
biệt" mà luật này sinh ra để chặn, nên nó từ chối chứ không vẽ. `planEncodeContent` trả `kind: 'refused'` kèm danh sách
đã lọc theo từ vựng và sắp thứ tự — nên modal chỉ việc in từng lý do, **không được tự quyết định** lý do nào tồn tại.
Đó là lý do danh sách nằm ở core chứ không phải ở `TmcutExportModal.vue`: một chỗ quyết ở UI sẽ là chỗ thứ hai nói
"project này được" cho một project mà renderer không vẽ nổi.

Điểm thiết kế quan trọng nhất: module **không tự viết lại** bất kỳ quy tắc phân loại nào. Nó đọc qua đúng các hàm mà
preview và FFmpeg-export đang đọc, vì mỗi quy tắc viết lại là một quy tắc có cơ chế **lệch**:

| Câu hỏi | Hàm được dùng (đã tồn tại) |
|---|---|
| Hàng nào là footage / overlay / audio? | `selectFileRows` — cùng phân loại theo **track** mà §44 dựng |
| Clip nào thật sự sống tại tick này? | `evaluateTimeline` / `clipSpan` |
| Blend mode thật của clip là gì? | `blendModeOf` (đã chuẩn hoá về `normal`) |
| Mask có hiệu lực không? | `normalizeMask` (hình lạ trả `null`, tức không từ chối oan) |
| Clip có ra tiếng không? | `isTrackMuted` + `makesSound` ([exportContent.mjs:133](file:///D:/Applications/tm-studio/packages/core/src/exportContent.mjs#L133)): volume mặc định 100, nên chỉ volume 0 **kèm** không keyframe volume dương mới là im lặng |
| Fit nào vẽ được? | `resolveClipLayout`; `isPaintableFit` chỉ loại `smart` |
| Lưới frame là bao nhiêu? | `createFrameScheduler` — **không** tính lại |

Và ba thứ module **cố ý không** sở hữu: kích thước chẵn (đã thuộc `planEncodePresets`/`evenDimensionError`), lưới frame
(đã thuộc `createFrameScheduler`), chọn row (đã thuộc `selectFileRows`). Test "a single footage row is eligible and
reports the grid core already counts"
([:52](file:///D:/Applications/tm-studio/packages/core/test/export-content-eligibility.test.mjs#L52)) khẳng định
`verdict.totalFrames`/`contentEndTicks` **bằng đúng** `scheduler.frameCount`/`endTicks` của một lời gọi
`createFrameScheduler` ngay trong test — một mutant tính lại lịch sẽ chết ở đó.

`audio` của request là `ENCODE_AUDIO_REQUEST = { 48_000, 2 }`
([:56](file:///D:/Applications/tm-studio/packages/core/src/exportContent.mjs#L56)) chứ không phải con số đẹp: đó là
**cặp duy nhất** §52.1 đo là sống cho `mp4a.40.2` trên máy này (22 050 và 32 000 Hz: `supported: false`). Project không
ra tiếng thì `audio: null`, nên một dự án chữ-trên-nền không phải trả giá hai kênh im lặng.

Lý do `background-image` là **phát hiện** của lượt này, không phải lý do có sẵn: preview vẽ nó bằng
`backgroundImage: url(...)` ([TmcutPreviewPlayer.vue:303](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutPreviewPlayer.vue#L303))
và FFmpeg đăng ký nó thành input loop (`app/utils/tmcut/render/index.ts:104`
→ `buildBackgroundSource`). WebCodecs-export chưa có đường nào, nên nếu không từ chối thì file ra **đổi nền thành đen**
ngay cả khi preview hiện ảnh — đúng loại lỗi im lặng mà §48 và §52 đã phải sửa bằng số đo.

### 53.2 Luật thứ hai: chữ nhật plate lấy **nguyên văn** từ hai builder đang chạy

`planEncodePlate` trả `{ source: {sx,sy,sw,sh}, dest: {dx,dy,dw,dh}, alpha }` cho một clip trên canvas. Nó không phải
hình học tự nghĩ: từng dòng được đọc sang từ hai chỗ đã được chứng minh bằng pixel ở các slice trước —
`computeFitObjectStyle` (CSS của preview) và `buildFfmpegFitFilters`/`buildFfmpegTransform` (filtergraph của FFmpeg),
cả hai trong [canvas.mjs](file:///D:/Applications/tm-studio/packages/core/src/canvas.mjs).

| Yếu tố | Luật, và chỗ nó được sao |
|---|---|
| Box canvas | `max(2, floor(x/2)*2)` — đúng `evenBox` của hai builder |
| Tỉ lệ crop | `clamp01` từng thành phần; **điều kiện áp dụng** chép nguyên văn từ builder — `cw>0 && ch>0` **và** một trong bốn nhánh `cx>0`, `cy>0`, `cw<1`, `ch<1`; nếu không thì crop được coi là toàn khung |
| `fill` | cắt giữa nguồn theo aspect canvas, **cả hai** nhánh (nguồn rộng hơn thì thu bề ngang; cao hơn thì thu bề dọc) |
| `fit` | `k = min(boxW/sw, boxH/sh)` rồi **canh giữa** |
| `stretch` | phủ kín box, không giữ aspect |
| Vị trí | `dx = round((boxW - dw)/2 + x)` — đúng công thức overlay của `buildFfmpegTransform` |
| `alpha` | opacity kẹp 0..1; giá trị không phải số thì 1 |
| `smart` | trả `null` — core không có luật focus cho nó, và `planEncodeContent` đã từ chối clip đó rồi |
| rotation | **không** áp dụng; thay vào đó là lời từ chối `rotation`. Một plate tự xoay nửa vời nguy hiểm hơn một lời từ chối |

19 test trong [export-plate-rect.test.mjs](file:///D:/Applications/tm-studio/packages/core/test/export-plate-rect.test.mjs)
khẳng định **chữ nhật thô**, không phải thuộc tính dẫn xuất — ví dụ nguồn 960×1920 trên canvas 1920×1080:
`fit` cho `dest {690, 0, 540, 1080}`, `fill` cho `source {0, 690, 960, 540}`; `scaleX: 2, scaleY: 0.5` cho
`dest {dx:-960, dy:270, dw:3840, dh:540}` (phóng **to** rồi offset **âm**, đúng như CSS/FFmpeg làm, không kẹp về canvas).

### 53.3 Ba chỗ lượt này làm sai — ghi lại để không tin là sạch

1. **`background-image` viết trước test.** Đúng thứ tự phải là RED rồi mới code, và lượt này đã phải làm lại điều đó
   **hai lần**: lần đầu ở window trước (xoá nhánh, đo, dựng lại), lần thứ hai ở đây vì văn bản §53 dẫn chứng một log
   **không tồn tại**. Log thật kini là `node_modules/.cache/tmcut-gates/h3d1-bg-RED.txt`, đo trên đúng blob
   `903e0833ea726b8f922150d0c5b16f26f1676749` mà commit này chứa: **29 test → 28 pass / 1 fail**, fail đúng một cái
   `an image canvas background is refused: the painter has no still-decode leg`, rồi restore **byte-identical** (hash
   khớp lại từng byte) và 29/29. **Phát hiện phụ, đáng ghi hơn cả cái RED**: assertion thứ hai về nền ảnh — "giá trị
   rỗng thì không phải lý do" — **không** canh nhánh luật đó, vì nó khớp cả khi nhánh tồn tại lẫn khi bị xoá (dự án đủ
   điều kiện ở cả hai phía). Nó vẫn đáng giữ vì nó chặn một mutant *khác* (từ chối mọi nền ảnh), nhưng đừng đếm nó là
   bằng chứng của luật. §52.8 đã phải nhận một lỗi cùng loại ("release-at-flush law written before its RED").
2. **Fixture sai, không phải assertion sai.** Test "clip audio đứng một mình thì từ chối `empty`" ban đầu đặt clip
   `type: 'audio'` trên **track video** và chờ `['empty']` — nó fail. Nguyên nhân thật: lane là thuộc tính của **track**
   (`selectFileRows` chỉ đọc `track?.type`, [paintStack.mjs:148](file:///D:/Applications/tm-studio/packages/core/src/paintStack.mjs#L148));
   `clip.type` chỉ là nhãn. Đã sửa **fixture** khai báo track `type: 'audio'`, **giữ nguyên** assertion. Sửa chiều
   ngược lại thì test trở thành thứ bảo vệ một mô hình không tồn tại.
3. **Hai expectation sai của chính test plate, bắt được trước khi code.** `scaleX: 2` ban đầu viết là `dw: 1920` (tưởng
   kẹp về canvas); case `fill` mới chỉ có nguồn **dọc**. Cả hai sửa trước khi implement — nếu không thì 19 test xanh sẽ
   mô tả một hình học không tồn tại.

### 53.4 Chưa chứng minh (H3d còn tiếp)

- Con số **±1 px**: `planEncodePlate` dùng `round`, FFmpeg dùng phép chẵn-hoá và `pad`, preview dùng CSS %. Đây là số
  **duy nhất** không suy ra được từ builder; nó thuộc về lượt đo live (#156), không phải chỗ đoán.
- Đường **browser** của ba port chưa có: `readPlate` thật trong `frameDecode.ts`, PCM thật trong `audioDecode.ts`, và
  mixer offline `pcm(request)` (#154). Keo (#53.6) mới chạy trên fake; port thật chưa nối thì chưa file thật.
- Dispatch + tải file + copy từ chối in từ `verdict.reasons` (#155); file thật trên `:4003` và parity điểm ảnh với file
  FFmpeg (#156).
- `planEncodeContent` chưa từng chạy trên **project người dùng thật** — mọi con số ở đây là từ fixture.

### 53.5 Gates của increment H3d-1 (chạy trên cây sẽ commit)

| Gate | Lệnh | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | PASS | exit 0, số `error TS` = 0; `.nuxt/eslint.config.mjs` tái sinh 28 605 B lúc 19:00 |
| 2 Lint | `npx eslint` trên 5 file, **sau** gate 1 | PASS | exit 0, 0 problems. Lần lint trước đó bị loại vì chạy trước khi config tái sinh |
| 3 Core types | `npm run typecheck:core` | PASS | exit 0 |
| 4 Core tests | `npm run test:core` | PASS | 912 pass / 0 fail (tăng từ 864 của §52) |
| 5 Core boundary | `npm run check:core` | PASS | "core imports nothing platform-specific" |
| 6 Spec mới | `node --test` hai file mới | PASS | 48/48 (29 eligibility + 19 plate) |
| 7 App suite | `npx tsx tests/unit/run-all.mts --smoke` | PASS | **130/130**, exit 0. Dòng chứa "FAIL" duy nhất là `0 FAILED` trong stdout của `tmcut_auth_refresh.spec.ts` |
| 8 Doc citations | `tmcut_doc_citations.spec.ts` | PASS | exit 0, 5 pass. Ba chỗ phải bỏ nhãn `audit` — lệ đã ghi ở §52.7: trích trong repo là `§NN` trần |
| 9 Docs guards | 6 spec `docs_*` / `tmcut_doc_*` | PASS | mỗi spec exit 0. `tmcut_doc_table_shape` **FAIL hai lần trước đó** vì chính văn bản §53 (§53.5) |
| 10 Probe luật nền ảnh | xoá nhánh → `node --test` → restore | PASS | 28 pass / 1 fail trên blob `903e0833…`, restore byte-identical, 29/29 lại (§53.3) |

Gate 4 và 6 đã **chạy lại sau** probe: 912/912 core và 19/19 plate trên đúng blob đã restore.

**Nền của con số 130**: `run-all.mts` **không** có `--smoke` báo 127 spec, có `--smoke` báo 130. Hai số không so sánh được
với nhau; §52 dùng nền có `--smoke` và lượt này giữ nguyên nền đó.

**Hai gate docs đã bắt được lỗi của chính văn bản này**, và cả hai là lý do chúng tồn tại: `tmcut_doc_table_shape` từ chối
một hàng bảng bị ngắt dòng (tôi chèn `\n` vào giữa hàng ADR-030 — markdown bảng là **một dòng một hàng**), và nó cũng từ
chối một `|` trần trong cell (điều kiện crop có `||`). Sửa: viết lại điều kiện bằng lời, **không** nới guard.
`tmcut_doc_line_length` thì lộ một trần thật: hàng ADR-030 đã dài **1 346 / 1 356 ký tự**, nên phần H3d-1 của nó **không
đi vào bảng** mà nằm ở note ngày 2026-11-06 cuối file — và lượt H3d-5 muốn ghi vào bảng thì phải **cắt** chứ không thêm.

### 53.6 Increment H3d-2c — chất keo: một chỗ gọi, và mọi cách kết thúc đều là một kết quả

Luật đã có (#53.1, #53.2), session đã có (§52), nhưng giữa chúng **không có module nào**: chưa chỗ nào hỏi runtime nhận
config nào, chưa chỗ nào đưa cho session một frame đã vẽ, và chưa chỗ nào biến một probe chết thành một câu in được.
Chỗ đó giờ là [webCodecsExport.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/webCodecsExport.ts) —
`createWebCodecsExport(deps)` ([:175](file:///D:/Applications/tm-studio/app/utils/tmcut/webCodecsExport.ts#L175)) trả
`run(ask)`. Nó **cố ý là file ít thông minh nhất thư mục**, vì mọi quyết định trong đó đã thuộc core rồi; keo mà quyết
thêm thì keo là chỗ thứ hai nói "project này được".

Bốn thứ cần browser hoặc mixer **đi vào làm tham số**, không nằm trong file:

| Port | Nhiệm vụ | Ai sở hữu bản thật |
|---|---|---|
| `readPlate` | giải **một** khoảnh khắc của **một** file ra một ảnh | `frameDecode.ts` — `createPlateReader` ở §53.8 |
| `createCanvas` | tấm nền mà painter vẽ lên, và `dispose()` khi xong | caller của modal (#155) |
| `surfaces` | từ `evaluation` của core, kế hoạch paint là những surface nào | `paintSurfaces.ts` — tách ra từ `useTmcutPlayback.ts` ở §53.7 |
| `pcm` | mixer offline, packet audio đến từ đây | `exportMixLeg.ts` — decode seam + core's mix law (§53.9) |

Nhờ đó spec chạy **plain Node, không DOM, không encoder**: 18 check trong
[tmcut_web_codecs_export.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_web_codecs_export.spec.ts),
tất cả đi qua đúng hàm thật của core (`planEncodeContent`, `planEncodePlate`, `encodeCanvasFill`,
`createFrameScheduler`) — fake chỉ ở bốn port và ở session.

Ba luật mà check giữ, và vì sao chúng không phải trang trí:

1. **Một lời từ chối không tốn gì.** Project core không vẽ nổi, hoặc runtime không nhận config nào, trả về **trước khi**
   canvas tồn tại và trước khi encoder được chạm tới — check "a refused project costs one core call and nothing else"
   ([:262](file:///D:/Applications/tm-studio/tests/unit/tmcut_web_codecs_export.spec.ts#L262)) và "a runtime that accepts
   nothing never starts a session" ([:310](file:///D:/Applications/tm-studio/tests/unit/tmcut_web_codecs_export.spec.ts#L310))
   đếm từng lời gọi port, không chỉ đếm `kind`.
2. **Plate giải mã thất bại là lỗi, không phải frame đen.** `readPlate` trả `null` thì **throw kèm tên src**
   ([:241](file:///D:/Applications/tm-studio/app/utils/tmcut/webCodecsExport.ts#L241)); `planEncodePlate` trả `null` rect
   thì cũng vậy. Vẽ không gì ở chỗ đáng ra có footage **chính là bug §53**, và check
   "a plate that will not decode fails instead of painting black"
   ([:434](file:///D:/Applications/tm-studio/tests/unit/tmcut_web_codecs_export.spec.ts#L434)) chặn đúng đường đó. Màu
   bắt đầu của frame cũng lấy từ câu trả lời của core, không phải từ một chuỗi đẹp trong keo
   (`encodeCanvasFill` ở [exportContent.mjs:424](file:///D:/Applications/tm-studio/packages/core/src/exportContent.mjs#L424);
   nhánh `null` rời với `surface.dispose()` ở [webCodecsExport.ts:219](file:///D:/Applications/tm-studio/app/utils/tmcut/webCodecsExport.ts#L219)).
3. **Mixer, abort và progress đi qua nguyên trạng.** File **có tiếng mà không có mixer** thì từ chối
   ([webCodecsExport.ts:213](file:///D:/Applications/tm-studio/app/utils/tmcut/webCodecsExport.ts#L213)) chứ **không** tự viết im lặng vào
   chỗ đó. Và `run` **luôn resolve**: probe chết ([webCodecsExport.ts:194](file:///D:/Applications/tm-studio/app/utils/tmcut/webCodecsExport.ts#L194)),
   session chết, abort của caller — tất cả thành kết quả. Nút export là UI; một exception nó quên bắt là một export
   trông như không làm gì.

**Hai lỗi thật mà RED bắt được**, ghi rõ bên nào được sửa để không ai đọc thành "sửa assertion cho xanh":

- Check "a probe that throws is a failure with its own name" ([:444](file:///D:/Applications/tm-studio/tests/unit/tmcut_web_codecs_export.spec.ts#L444))
  để `Error: the probe died` **thoát ra ngoài** `run()`. Đây là defect của **keo**, sửa **keo**: thêm `messageOf`
  ([:145](file:///D:/Applications/tm-studio/app/utils/tmcut/webCodecsExport.ts#L145)) và bọc `capability.decide`.
- Check "an export that dies with the caller signal is cancelled, not failed" báo `failed` thay vì `canceled`. Ở đây
  code **đúng**, fake **sai**: nó chỉ abort bên trong vòng paint, là vòng mà nhánh throw bỏ qua. Abort được chuyển lên
  đầu fake session và tuỳ chọn đó đổi tên thành `abortWhileRunning`. Nói thẳng ra vì đây là lần thứ hai trong slice này
  một check đỏ vì harness, và §52.7 đã ghi nợ loại này.

**Chưa nối, và chưa giả vờ là xong**: `surfaces(evaluation)` hiện là port vì **luật surface chung vẫn nằm trong
`useTmcutPlayback.ts`** — preview và export đang trả lời từ hai chỗ. Tách luật đó ra là một increment riêng của #154,
không phải việc vặt. Ngoài ra `deps.createCanvas` **throw** vẫn thoát thành rejection: chưa có RED cho nhánh đó nên
chưa viết code — ghi ở đây để nó là một khoảng trống **có tên**, không phải một khoảng trống được tưởng là đã kín.

Gates của increment này (chạy trên đúng cây đã commit `21b7182`):

| Gate | Lệnh | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | PASS | exit 0, `error TS` = 0; `.nuxt/eslint.config.mjs` tái sinh 28 605 B (`h3d2c-typecheck.txt`) |
| 2 Lint | `npx eslint` trên 5 file keo, **sau** gate 1 | PASS | exit 0 (`h3d2c-eslint.txt`). 10 lỗi lần đầu đều ở file tôi mới viết, sửa trong file đó, không `--fix` toàn repo |
| 3 Core | `pnpm typecheck:core` + `pnpm check:core` | PASS | exit 0; "core imports nothing platform-specific" |
| 4 Core tests | `pnpm test:core` | PASS | **950 pass / 0 fail** (864 của §52 → 912 của #53.5 → 942 của H3d-2b → 950, thêm 8 test nền canvas) |
| 5 Spec keo | `tsx --tsconfig tsconfig.test.json` spec mới | PASS | 18/18, exit 0 (`h3d2c-spec.txt`) |
| 6 App suite | `npx tsx tests/unit/run-all.mts --smoke` | PASS | **131/131**, exit 0; nền không `--smoke` là **128/128** — hai số không so sánh được, như §53.5 đã ghi |
| 7 Electron | `node --test "electron/tools/*.test.mjs"` | PASS | 59 pass / 0 fail, exit 0 (`h3d2c-electron.txt`) |
| 8 Live sweep | 5 route `:4003`, lọc `error`/`warn`/`issue` | **KHÔNG PASS** | xem đoạn dưới |

Gate 8 là chỗ duy nhất không xanh, và nguyên nhân **không phải** lượt này: `/tmcut` và `/tmcut/autocut` sạch (0 dòng),
còn `/tmcut/editor` (4 lần), `/tmcut/templates` (2 lần), `/tmcut/factory` (1 lần) cùng báo một lỗi
`401 (error.unauthorized)` trên `GET /api/v1/ai/relay/catalog` — do [catalog.get.ts:12](file:///D:/Applications/tm-studio/server/api/v1/ai/relay/catalog.get.ts#L12)
`throw createError({ statusCode: 401 })` khi trình drive **không có phiên hub**. Signing in cần credential giống mà ràng
buộc của phase này cấm tôi chạm, nên phần **authed** của sweep là **BLOCKED**, không phải PASS được viết lại lời.
Bằng chứng rằng 401 không phải do keo: diff core là **54 thêm / 0 xoá** và **9 thêm / 0 xoá**, module mới **chưa có ai
import trong `app/`** (`grep webCodecsExport app/` trả về rỗng), và route gây lỗi tôi không đụng.

### 53.7 Increment H3d-2d — luật surface ra khỏi playhead: một chỗ trả lời cho cả preview lẫn export

§53.6 để lại một món nợ **có tên**: port `surfaces` tồn tại vì luật surface chung vẫn nằm trong `useTmcutPlayback.ts`,
tức là preview và export trả lời từ hai chỗ. Luật đó giờ là [paintSurfaces.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/paintSurfaces.ts) —
`surfacesAt(tracks, evaluation)` ([:69](file:///D:/Applications/tm-studio/app/utils/tmcut/paintSurfaces.ts#L69)) trả
`{ footage, text }`. Lý do nó **phải** là một hàm thay vì một `computed`: export vẽ theo **chỉ số frame**, không theo
playhead, nên nó cần hỏi "tại tick này vẽ gì" với đúng tick đó; để luật trong `computed` nghĩa là modal hoặc tự viết lại
phép ánh xạ (thành chỗ thứ hai), hoặc không export được. Composable bây giờ chỉ còn một dòng gọi luật
([useTmcutPlayback.ts:114](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L114)); mọi con số vẽ
được vẫn đến từ core **nguyên trạng** (`compositePlan` ở
[:19](file:///D:/Applications/tm-studio/app/utils/tmcut/paintSurfaces.ts#L19), ô hàng trả về theo index của core ở
[:80](file:///D:/Applications/tm-studio/app/utils/tmcut/paintSurfaces.ts#L80), từ chối layer không có vị trí nguồn ở
[:87](file:///D:/Applications/tm-studio/app/utils/tmcut/paintSurfaces.ts#L87), cặp crossfade là **sự liền kề** ở
[:107](file:///D:/Applications/tm-studio/app/utils/tmcut/paintSurfaces.ts#L107)).

Luật mới có spec riêng: [tmcut_paint_surfaces.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_paint_surfaces.spec.ts),
12 check, chạy plain Node không DOM. Ba check mang tải nặng nhất:

1. **Census, không phải đọc một file**: `compositePlan(` chỉ được xuất hiện trong **đúng một** file của `app/`
   ([:130](file:///D:/Applications/tm-studio/tests/unit/tmcut_paint_surfaces.spec.ts#L130)). Đây là cách giữ lời hứa
   "một chỗ hỏi core" mà không cần tin người sau chỉ sửa file tôi đang nhìn.
2. **Preview == luật, từng tick** ([:271](file:///D:/Applications/tm-studio/tests/unit/tmcut_paint_surfaces.spec.ts#L271)):
   drive composable thật, so từng surface với `surfacesAt` ở cùng `at`, kể cả `crossfades` — nên một lần di chuyển luật
   làm lệch **cặp** (ramp bật khi partner không ở trên màn hình) đỏ ngay, thay vì đỏ ở export ba increment sau.
3. **Keo thật, không phải bản chép** ([:302](file:///D:/Applications/tm-studio/tests/unit/tmcut_paint_surfaces.spec.ts#L302)):
   `createWebCodecsExport` được nối `surfaces = surfacesAt` thật, fake `readPlate` ghi lại từng lời gọi, và expected là
   `ticksToSec(frame.startTicks)` do chính `createFrameScheduler` sinh ra. Nói cách khác: **frame export giải mã đúng
   khoảnh khắc preview đang hiển thị** — điều §53.4 còn để trống — đã được chứng minh ở tầng luật, trên máy không encoder.

**Ba guard cũ phải đổi chỗ, không đổi độ mạnh.** Đây là phần phải đọc kỹ, vì "sửa test" luôn là chỗ dễ tự lừa:

| Guard | Trước | Sau | Vì sao vẫn cùng độ mạnh |
|---|---|---|---|
| `tmcut_paint_stack.spec.ts` check 2 (`tests/unit/tmcut_paint_stack.spec.ts:198`) | đọc `useTmcutPlayback.ts`: có `compositePlan`, không `selectPaintRows`, không `videoEvaluations`, có `tracks[slot.trackIndex]` | đọc **luật** đúng bốn điều đó, **thêm** ba điều lên host: gọi `surfacesAt(`, không gọi `compositePlan(`, không giữ `tracks[slot.trackIndex]` | thêm chứ không bớt; host giờ bị giữ ở chỗ **không có** luật |
| `tmcut_preview_paint_plan.spec.ts` check 6 ([:155](file:///D:/Applications/tm-studio/tests/unit/tmcut_preview_paint_plan.spec.ts#L155)) | `import { ... compositePlan ... } from 'tmcut-core'` phải có trong composable | assertion đó chuyển sang **file luật**; composable bị giữ `surfacesAt` và **không** được đọc `transition?.role` | cùng một câu hỏi, hỏi đúng file trả lời |
| `tmcut_surface_media_time.spec.ts` check 5 ([:143](file:///D:/Applications/tm-studio/tests/unit/tmcut_surface_media_time.spec.ts#L143)) | `match(composable, /sourceTicks/)` | `match(law, /sourceTicks/)` **và** `match(law, /sourceTicks === null/)`, **và** `doesNotMatch(composable, /sourceTicks/)` | 1 assertion → 3; chỗ đọc số của core bị siết chặt hơn trước |

Một regex **có** nới, và đó là nới đúng: `doesNotMatch(/selectPaintRows/)` thành `doesNotMatch(/selectPaintRows\s*\(/)`.
Lý do: comment của luật **gọi tên** luật hàng mà nó không được tự quyết, nên dạng thô bắt cả văn giải thích. Cái guard
cần bắt là **lời gọi** đứng cạnh plan — tức câu trả lời thứ hai — chứ không phải cái tên trong prose. Sức mạnh thật của
"không có chỗ thứ hai" giờ do census (check 1 ở trên) gánh, và census chỉ đếm code, không đếm comment.

**Một expectation sửa ở phía test, nói rõ là phía test.** Check 11 của spec mới ban đầu khẳng định
`transitionCrossfade` **still non-null** ở `tk(5)`. Sai: `tk(5)` đã ra ngoài cửa sổ transition, production **đúng**, nên
claim của tôi sai. Assertion được thay bằng điều mạnh hơn và không tự do: với **mỗi** tick được probe,
`transitionCrossfade !== null` phải **bằng** `some(s => s.crossfades)` của luật. Không có assertion nào bị bỏ.

**Mutation probe trên cây sẽ commit** (host md5 `fd787449010b9e1393e3366ba934759e`): chèn lại một
bản sao luật vào composable — `compositePlan(...)`, `tracks[slot.trackIndex]`, `slot.layer.sourceTicks`,
`slot.layer.transition?.role` — và chạy bốn spec. Kết quả: `tmcut_paint_stack` đỏ ở *"the plan is read once, in the law"*,
`tmcut_surface_media_time` đỏ ở *"the host reads no source position of its own"*, `tmcut_paint_surfaces` đỏ ở *"expected
only app/utils/tmcut/paintSurfaces.ts to call the plan, got app/composables/useTmcutPlayback.ts, ..."*,
`tmcut_preview_paint_plan` đỏ ở *"and re-detects a crossfade in neither place"*. Bốn guard, bốn lời bắt. Host sau đó được
khôi phục **byte-identical** (md5 khớp) và bốn spec xanh lại.

Gates của increment này:

| Gate | Lệnh | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | PASS | exit 0, `error TS` = 0; `.nuxt/eslint.config.mjs` tái sinh 28 576 B (`h3d2d-typecheck.txt`) |
| 2 Lint | `npx eslint` trên **7 file** đã chạm, **sau** gate 1 | PASS | exit 0, 0 problem (`h3d2d-eslint.txt`); không `--fix` toàn repo |
| 3 Core | `pnpm typecheck:core` + `pnpm check:core` | PASS | exit 0 cả hai (`h3d2d-coretc.txt`, `h3d2d-corecheck.txt`) |
| 4 Core tests | `pnpm test:core` | PASS | **950 pass / 0 fail** — không đổi so với §53.6, vì lượt này **không** sửa core |
| 5 App suite | `npx tsx tests/unit/run-all.mts` | PASS | **129/129**, exit 0 (`h3d2d-runall2.txt`); nền trước lượt này là 128/128, +1 là spec luật |
| 6 App suite + smoke | `npx tsx tests/unit/run-all.mts --smoke` | PASS | **132/132**, exit 0 (`h3d2d-runall-smoke.txt`) |
| 7 Electron | `node --test "electron/tools/*.test.mjs"` | PASS | 59 pass / 0 fail, exit 0 (`h3d2d-electron.txt`) |
| 8 Live sweep | 5 route `:4003`, console `error`/`warn`/`issue` | **KHÔNG PASS** (như §53.6) | xem đoạn dưới |

Gate 8: `/tmcut` và `/tmcut/autocut` **0 dòng**; `/tmcut/editor` **4 × `401`**, `/tmcut/templates` **1 ×**,
`/tmcut/factory` **1 ×** — tất cả trên cùng `GET /api/v1/ai/relay/catalog`, vẫn đúng một nguyên nhân như §53.6 đã quy
([catalog.get.ts:12](file:///D:/Applications/tm-studio/server/api/v1/ai/relay/catalog.get.ts#L12): trình drive không có
phiên hub ở origin `localhost`). Phần **authed** của sweep tiếp tục là **BLOCKED**, không viết lại thành PASS. Cái mới ở
lượt này là nửa **không** cần auth đã mạnh hơn: route editor render một project thật (2 clip, `f4b-probe.mp4`), bấm Play,
`blob:` media đọc 206/200, và canvas **vẽ ra frame thật** (screenshot SMPTE bars, playhead 00:01.05) — tức luật mới chạy
trên đường DOM thật, không chỉ trong spec.

**Chưa chứng minh, vẫn còn nguyên**: modal nối vào luật và dispatch (#155), và **parity điểm ảnh với file FFmpeg trên
một file xuất thật** (#156) — `surfaces` giờ là luật chung nên #156 không còn phải trả lời câu "hai chỗ có lệch không",
nhưng số ±1 px vẫn chưa tồn tại ở đâu cả. `deps.createCanvas` **throw** vẫn thoát thành rejection và vẫn **không có RED**:
khoảng trống có tên từ §53.6, chưa được lấp. `readPlate` **đã có** bản thật (§53.8) và `pcm` **đã có** bản thật (§53.9),
nhưng **chưa ai gọi chúng** trong `app/` cho tới #155 — hai chân đứng sẵn, còn cánh cửa thì chưa.

### 53.8 Increment H3d-2e — chân plate: một container cho một file, và một hàng đợi cho một container

`decodeFrame` trả lời câu hỏi **thumbnail**: một khoảnh khắc, một PNG, một `Input` mở rồi bỏ. Export hỏi **cùng câu đó
hàng nghìn lần**, theo thứ tự tăng, trên cùng vài file. Mở lại container mỗi frame nghĩa là demux lại từ keyframe đầu mỗi
lần — nên chân mà exporter cần là một **reader**, không phải một hàm. Nó nằm trong
[frameDecode.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/frameDecode.ts) như một export mới,
`createPlateReader(deps)` → `{ read(ask), close() }`; vòng đời do caller sở hữu: `read` cho mọi frame, `close` trong
`finally` của export (#155).

Ba port nhỏ để spec chạy được không cần WebCodecs: `open` (mặc định `openMedia`), `makeSink` (mặc định
`new CanvasSink(track)`), `hasDecoder` (mặc định `hasFrameDecoder`). Không có `width` trong sink: plate là **kích thước
thật của media**, vì `planEncodePlate` đặt một nguồn mà nó được kể đúng hình học — plate cỡ proxy sẽ đặt đúng và encode
một file mềm, không ai thấy cho tới khi nhìn.

Ba luật là lý do nó là module chứ không phải một call site:

1. **Một file là một container VÀ một sink**, không phải một lần mỗi frame. Sink dựng lại mỗi frame là cùng một sự lãng
   phí ở chỗ khác. Plate **không có** `release`: container là của reader, canvas là của sink; một plate có thể đóng
   container sẽ đưa demux-theo-từng-frame trở lại.
2. **Khoảnh khắc đến sink nguyên văn.** `Math.round(atSec * 1000) / 1000` ở đây là đồng hồ thứ hai — đúng lớp bug §52 và
   §53 dành cả chương trình để đóng.
3. **Frame của một file được đọc lần lượt.** Session giữ nhiều frame in-flight (`planEncodeQueue`,
   [exportEncodeSession.ts:661](file:///D:/Applications/tm-studio/app/utils/tmcut/exportEncodeSession.ts#L661)), và mọi
   frame của một file vẽ vào **cùng một** canvas của sink đó. Hai lượt đọc chồng nhau là một frame bị xé, không phải một
   export chậm hơn. Vì vậy mỗi container có một hàng đợi, và hàng đợi **không bao giờ** là một promise bị reject: một lượt
   đọc hỏng không được lấy mất lượt của frame sau.

Cùng các luật đó, ở dạng phủ định: không decoder → `null` và **không mở** container; container không đọc được hoặc không
có track video → đóng và **bỏ khỏi cache**, frame sau vẫn được thử lại; `src: null` → không mở gì; signal đã abort →
`null` trước khi mở, và chính signal của export là signal được mở container với (để `openMedia` đóng khi abort); reader đã
`close()` → `null`, không mở sau lưng caller; `close()` đóng mỗi container đúng một lần.

**Một phát hiện thật của lượt này**: fixture hai hàng footage bị `planEncodeContent` từ chối (`stacked-rows` là luật của
§53.1/H3d-1). Nên check tích hợp dùng **một hàng, hai clip nối tiếp** (`a` 0–1 s, `b` 1–2 s) — vừa hợp luật, vừa là đường
đi khó hơn cho reader: lượt chạy mở `a.mp4`, **bước qua chỗ cắt** sang `b.mp4`, và không được mở lại file đã rời. Expected
`atSec` được tính từ lưới của core (`createFrameScheduler`) và offset tác giả, không từ luật và không từ reader.

**11 check** trong [tmcut_plate_reader.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_plate_reader.spec.ts):
10 check hành vi trên fake container (mở/đóng/khoảnh khắc/kích thước/lỗi/abort/serialize/close) + 1 check chạy **keo thật,
luật thật, reader thật**, chỉ mediabunny bị fake. RED đúng lý do: `SyntaxError: ... does not provide an export named
'createPlateReader'`, trước khi có một dòng implementation nào.

Mutation probe (chạy trên đúng `md5 747fa8c0a46ca5d264444cc058a94a35` sẽ commit, restore **byte-identical**):

| # | Đột biến | Kết quả | Check giết nó |
|---|---|---|---|
| M1 | bỏ hàng đợi, hai frame một file dùng chung canvas | CAUGHT | "the second frame of the same file waits" |
| M2 | `Math.round(atSec * 1000) / 1000` trước sink | CAUGHT | "the sink is asked for the authored instant, not a rounded one" |
| M3 | `new CanvasSink(track, { width: 64 })` | CAUGHT | "the export sink takes the track and no option" |
| M4 | bỏ cache container, một `open` mỗi frame | CAUGHT | "one open, got 4" |
| M5 | `canRead()` false không `retire` | CAUGHT | "canRead false still closes" |

Hai **defect của chính probe**, ghi lại vì cùng lý do §52.7/§53.6 đã ghi nợ loại này: M2 ban đầu `NOT CAUGHT` vì marker
`getCanvas(ask.atSec)` khớp **lần xuất hiện đầu tiên** — trong `decodeFrame`, không phải trong reader; sửa marker thành
`holder.sink.getCanvas(ask.atSec)`. M3 ban đầu `NOT CAUGHT` vì **fake thay thế đúng cái builder đang bị đột biến**, nên
không runtime check nào thấy được — và một typechecker cũng không: `{ width: 64 }` hợp lệ. Nửa đó được pin ở source
(`assert.match` vào `new CanvasSink(track as MediaVideoTrack))`), và sau đó M3 bị giết. Đây là ví dụ đúng của luật "sửa
phía nào cũng phải nói rõ".

Gates của increment này (trên cây sẽ commit):

| Gate | Lệnh | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | PASS | exit 0, `error TS` = 0; config tái sinh 28 576 B (`h3d2e-typecheck.txt`) |
| 2 Lint | `npx eslint` trên 2 file, **sau** gate 1 | PASS | exit 0 (`h3d2e-eslint.txt`); 3 lỗi style lần đầu đều ở dòng tôi mới viết, sửa trong file đó |
| 3 Core | `pnpm typecheck:core` + `pnpm check:core` | PASS | exit 0; "core imports nothing platform-specific" |
| 4 Core tests | `pnpm test:core` | PASS | **950 pass / 0 fail** (không đổi: lượt này không chạm core) |
| 5 Spec plate | `tsx --tsconfig tsconfig.test.json` spec mới | PASS | **11/11**, exit 0 (`h3d2e-green.txt`) |
| 6 App suite | `npx tsx tests/unit/run-all.mts` | PASS | **130/130**, exit 0 (`h3d2e-appsuite.txt`) — 128 → 129 → **130** là spec này |
| 7 Electron | `node --test "electron/tools/*.test.mjs"` | PASS | 59 pass / 0 fail, exit 0 (`h3d2e-electron.txt`) |
| 8 Mutation | 5 đột biến trên md5 sẽ commit | PASS | 5/5 CAUGHT, restore byte-identical (`h3d2e-mutate.txt`) |

Gate live sweep của §53.6/#156 **không chạy lại ở lượt này**: module mới chưa được `app/` import (nó là chân của #154, nối
ở #155), nên không route nào đi qua nó và một sweep chỉ lặp lại đúng 401 đã có nguyên nhân. Điều đó là **N/A — module
chưa có caller**, không phải một PASS được viết lại lời.

**Còn lại của #154**: chân PCM trong `audioDecode.ts` + mixer offline đi vào port `pcm`; và khi có module mới import
`frameDecode.ts`, danh sách caller trong
[tmcut_frame_service.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_frame_service.spec.ts#L421) phải được mở
rộng **kèm lý do** — lượt này chưa có ai import nên danh sách không đổi. Chân plate **chưa đọc byte cache**: nó mở
location, và đó là một khoảng trống có tên (ghi ngay trong `read`), không phải một quyết định bị bỏ quên.


### 53.9 Increment H3d-2f — chân tiếng: một lần decode cho một file, và con số vẫn là của core

`pcm` là port cuối cùng của §53.6 chưa có bản thật. Câu trả lời trung thực là **hai việc khác nhau**, và chỉ một việc
thuộc về seam đọc byte: **giải mã** một file là `decodePcm` (E3), còn **cộng các run thành một packet** là
`planExportMixPacket` (H3d-2a) — luật đã sở hữu vị trí, resample, gain và danh sách từ chối. Phần còn lại là bước đi giữa
hai cái đó, và nó không phải keo vô nghĩa: session hỏi ~47 lần mỗi giây của file, cho cùng vài clip, nên một leg decode
theo từng packet sẽ mở lại container mỗi ~21 ms — bản sinh đôi về âm thanh của lần mở container mỗi frame mà §53.8 vừa
nghỉ hưu.

Module là [exportMixLeg.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/exportMixLeg.ts),
`createExportMixLeg(deps)` → `{ mix(ask), close(), refused() }`. Port: `decode` (mặc định `decodePcm`) và `hasDecoder`
(mặc định `hasAudioDecoder`); `mix` nhận đúng hình dạng mà session gọi (`index`, `startSample`, `frames`, `timestamp`,
`duration`) cộng `project` và `target`, và trả `Float32Array[]` — một plane mỗi kênh, đúng `frames` sample.

**Căn hàng là phần chịu lực.** `planExportMixPacket` đọc một nguồn tại `mediaSeconds * sampleRate` — một chỉ số **tuyệt
đối** trong file. Nên run mà một nguồn mang theo phải bắt đầu ở media giây 0, không bao giờ ở điểm in của clip: một bed bị
cắt bắt đầu ở 30 s mà run mở đầu ở đó sẽ đọc 30 s vào một buffer 30 giây và xuất ra **im lặng**. Vì vậy mỗi file được giải
một lần, từ 0 tới giây xa nhất mà bất kỳ clip nào dùng của nó, và luật tự trả lời im lặng ở chỗ vượt quá run.

Hai luật nhỏ đi kèm, mỗi cái đều có check riêng:

1. **Host không có audio decoder thì fail, không xuất im lặng.** Một file im lặng viết ra như một lần xuất thành công là
   bản sinh đôi về âm thanh của một frame đen: timeline phát ra tiếng mà file thì không.
2. **Hàng bị mute không tốn một lần decode.** Core vẫn kể tên layer đó ở gain 0 và luật mix bỏ nó — bỏ qua ở đây không
   đổi một sample nào và tiết kiệm cả một lần đọc file.

Một **luật core mới** xuất hiện trong lượt này: `clipSourceRange(clip)` trong
[evaluate.mjs](file:///D:/Applications/tm-studio/packages/core/src/evaluate.mjs), cùng file đã có `sourceRangeOf` dạng
private. Nó đọc cả hai hình dạng đã lưu — DSL v3 `source.{in,out}` và flat `in`/`out` của store — vì leg cần biết "file
này bị dùng tới giây nào". Một bản copy thứ hai của luật hai-hình-dạng đó trong `app/` chính là kiểu trôi mà cả chương
trình này đang đóng; nên nó được export (kèm khai báo trong `index.d.ts`, tay-maintained) thay vì viết lại. Ba test core
mới đi cùng, và suite core từ **950 → 953**.

**8 check** trong [tmcut_export_mix_leg.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_export_mix_leg.spec.ts).
RED đúng lý do: `Cannot find module '.../exportMixLeg'`, trước khi có một dòng implementation nào. Check cuối so **sample
theo sample** với `planExportMixPacket` gọi trực tiếp từ core cho cùng packet.

Mutation probe (trên đúng các md5 sẽ commit: `exportMixLeg.ts d1fd234bf1a82dd8d2a8738c2b4e258b`, spec
`3db7557f8fd63fd2825e0824c883e885`, `evaluate.mjs 418800634364044bd049af8b5286c48a`, `index.d.ts
70a4a8968f0c9ae8f9d15f87762c9277`, test core `6d123b11e921266fe414b7c1a3235336`), restore **byte-identical**:

| # | Đột biến | Kết quả | Check giết nó |
|---|---|---|---|
| M1 | decode mỗi packet thay vì mỗi file | CAUGHT | "each sounding file read once" |
| M2 | hỏi từ điểm in của clip thay vì media 0 | CAUGHT | "from the first sample of the file" |
| M3 | decode cả hàng bị mute | CAUGHT | "the muted bed was never opened" |
| M4 | lặng lẽ bỏ file không decode được | CAUGHT | "the missing file is named by its clip" |
| M5 | viết im lặng như thành công khi host không có decoder | CAUGHT | "the refusal names the host" |
| M6 | trả 0 thay vì hỏi core | CAUGHT | "the leg is core's answer plus the decode" |

**M6 và hai defect của probe, ghi lại vì cùng lý do §52.7/§53.6/§53.8:** M6 thoạt đầu `NOT CAUGHT` vì fixture của check 8
trả **toàn số 0** — một leg trả 0 cũng bằng core. Đây là lỗi của **spec**, không phải của code: fixture được đổi thành một
sóng không-im-lặng, và M6 chết ngay. Hai marker M1/M4 `MARKER_NOT_FOUND` vì probe viết LF trong khi file đã CRLF; probe
được sửa để so trên bản LF và ghi lại đúng EOL gốc — không sửa file nguồn để chiều probe.

Gates của increment này (trên cây sẽ commit):

| Gate | Lệnh | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | PASS | exit 0, `error TS` = 0; config tái sinh 28 576 B (`h3d2f-typecheck.txt`) |
| 2 Lint | `npx eslint` trên 4 file, **sau** gate 1 | PASS | exit 0 (`h3d2f-eslint.txt`) |
| 3 Core | `pnpm typecheck:core` + `pnpm check:core` | PASS | exit 0; "core imports nothing platform-specific" |
| 4 Core tests | `pnpm test:core` | PASS | **953 pass / 0 fail** (950 → 953: ba test cho `clipSourceRange`) |
| 5 Spec tiếng | `tsx` spec mới | PASS | **8/8**, exit 0 (`h3d2f-green.txt`) |
| 6 App suite | `npx tsx tests/unit/run-all.mts` | PASS | **131/131**, exit 0 (130 → 131 là spec này) |
| 7 Electron | `node --test "electron/tools/*.test.mjs"` | PASS | 59 pass / 0 fail, exit 0 (`h3d2f-electron.txt`) |
| 8 Mutation | 6 đột biến trên md5 sẽ commit | PASS | 6/6 CAUGHT, restore byte-identical (`h3d2f-mutate.txt`) |

Live sweep: **N/A — module chưa có caller trong `app/`**. `exportMixLeg.ts` được nối ở #155; lượt này chỉ đứng sẵn ở đầu
kia của cánh cửa.

**Chưa chứng minh, vẫn còn nguyên**: chân tiếng **chưa đọc byte cache** (nó mở location qua `decodePcm`, và đó là khoảng
trống có tên, giống chân plate ở §53.8); chưa có số đo nào cho chất lượng resample tuyến tính so với FFmpeg trên nhạc thật
(việc của #156); và cả hai chân đều **chưa được gọi** cho tới khi modal của #155 nối chúng.
### 53.10 Increment H3d-3 — nút bấm: một chỗ dispatch, một project đã đúng cỡ, và một câu cho mỗi lời từ chối

Ba chân của §53.6 đã có: keo (H3d-2c), luật surface (H3d-2d), plate (H3d-2e), tiếng (H3d-2f). Nhưng cho tới lượt này
**không ai gọi chúng**. `TmcutExportModal.vue` vẫn là đường cũ: nó POST `args` FFmpeg đã compile và poll một job Nitro —
nghĩa là ở runtime web, một "lần xuất" là một lần nhờ server chạy x264, chứ không phải trình duyệt vẽ. Lượt này thay
đúng nhánh đó bằng `createWebExportHost`, và giữ nguyên nhánh desktop.

**Một defect thật lộ ra ngay ở lần chạy đầu của đầu nối mới, trước khi có UI.** Trình duyệt export một project **thật**
(`tmcut_project_default` trong store) với host mới: kết quả `kind: 'exported'`, **0 plate đọc, 0 plate vẽ**, và file vẫn
mở được. Nguyên nhân: `surfacesAt` và `exportMixLeg` join clip theo index hàng, mà cả hai nhận `tracks` từ nơi gọi; host
đọc `project.tracks`, còn store giữ hàng ở `project.timeline.tracks`. Core thì đọc **cả hai** (`timelineOf` trong
`evaluate`, `scheduler`, `paintStack`, `exportContent` — bốn bản copy private), nên `planEncodeContent` nói eligible, còn
app join ra rỗng. Đó đúng là loại file "mở lên được là bằng chứng có nội dung" mà §52 dành cả chương để bác.

**Luật core mới: `projectTracks(input)`** trong [evaluate.mjs](file:///D:/Applications/tm-studio/packages/core/src/evaluate.mjs),
export kèm khai báo `index.d.ts` (generic, vì nó là pass-through: core không nhìn vào trong một hàng, và hàng của store
không phải `TmcutTrack` của core). Bốn bản copy private được thay bằng nó — `evaluateTimeline` tự dùng nó luôn, nên
"cùng một luật" là sự thật của code chứ không chỉ của comment. Bốn test core mới; suite **953 → 957**.

**Luật thứ hai, ở app: những lựa chọn hộp thoại mà bản web ghi được.** `webExportChoice.ts` với `planWebExport(project,
choice)` trả `{ project, refusals }`. Hai lựa chọn **được tôn trọng** là cỡ và frame rate — vì `planEncodeContent` đọc
canvas và `createFrameScheduler` dựng lưới từ đúng hai con số đó; plan trả một **bản copy** của project với canvas đã đổi,
không sửa document đang mở. Bốn lựa chọn còn lại bị **từ chối có tên**: `mode` (audio/GIF), `format` (HEVC/ProRes/VP9 —
thang preset sẽ trả H.264 hoặc MP4, không phải file menu hứa), `range` (in/out chưa có đường), `effects` (denoise, LUT).
Mã ở đây **không phải** `ENCODE_REFUSAL_REASONS`: từ vựng đó nói về thứ một *project* có và core tự trả lời; mã này nói về
thứ một *hộp thoại* có, chỉ app biết.

**Defect thứ hai, chỉ lộ ra khi chạy live.** Lần xuất thật trên `:4003` dừng bằng toast **"effects"** — từ vựng của core,
không phải câu cho người đọc. Project mở sẵn có vignette trên cả hai clip, nên lời từ chối là **đúng**; cái sai là UI in mã
trần. Sửa: `WEB_CONTENT_REFUSAL_KEYS`, một câu cho **cả 14** mã core in ra, cộng một câu `unknown` có `{reason}`; và spec
duyệt `ENCODE_REFUSAL_REASONS` để một mã mới trong core **không thể** lọt qua mà không có câu. Đây là spec viết sau khi
thấy lỗi bằng mắt — thứ tự Red/Green ghi lại đúng như nó xảy ra.

Copy cũng sai sự thật sau khi đổi đường: "server cục bộ", "lưu trên server", "x264 software". Bốn chuỗi (cộng tiêu đề
hardware) được viết lại thành "trình duyệt tự vẽ và mã hoá", `webNoFile` mới thêm cho trường hợp muxer trả về không phải
`Blob` (gate i18n đã bắt key thiếu này ngay lần đầu chạy suite).

**Chạy live, trên cây sẽ commit** (`:4003`, project thật 2 clip `f4b-probe.mp4`, 0.6 s):

| Bước | Kết quả đo được |
|---|---|
| 5 route TMCut | `/tmcut` 0 message; `/tmcut/autocut` chỉ `<Suspense>` info; `/tmcut/editor` `401 ×4` trên `GET /api/v1/ai/relay/catalog`; `/tmcut/templates` `401 ×2`; `/tmcut/factory` `401 ×1` — cùng một nguyên nhân §53.6 |
| Modal | copy mới hiện đúng: "Rendered in this browser — use Download when it finishes" |
| Từ chối theo lựa chọn | chọn tab Audio only → "This browser export writes video files only…" |
| Từ chối theo project | Start Export với vignette → "This browser export cannot bake clip effects — remove them, or export from the desktop app" |
| Xuất thật | bỏ vignette (chỉ trong `localStorage`, đã khôi phục) → `Export Completed!` + nút Download; `URL.createObjectURL` bắt được `{ size: 123212, type: 'video/mp4; codecs="avc1.64001f, mp4a.40.2"' }` |

**6 mutation trên đúng các md5 sẽ commit** (`evaluate.mjs 797d8218`, `webExportHost.ts ea71db12`, `exportMixLeg.ts
0edc18ae`, `webExportChoice.ts b7d8d7bc`, `TmcutExportModal.vue 85362acf`), restore **byte-identical**:

| # | Đột biến | Kết quả | Check giết nó |
|---|---|---|---|
| M1 | `projectTracks` chỉ đọc `tracks` phẳng | CAUGHT | "reads a project's timeline.tracks" |
| M2 | host join hàng từ `project.tracks` | CAUGHT | "one plate per frame was read from the row under timeline.tracks" |
| M3 | mix leg join hàng từ `project.tracks` | CAUGHT | "both rows under timeline.tracks were opened" |
| M4 | bỏ im lặng một lời từ chối của hộp thoại | CAUGHT | "a mode or format this writer cannot produce" |
| M5 | plan sửa canvas của chính project được truyền vào | CAUGHT | "the preview project is untouched" |
| M6 | đọc lời từ chối sau khi đã dựng host | CAUGHT | "plan.refusals.length > 0" |

**Gates của increment này (chạy lại toàn bộ sau mutation, trên cây đã restore):**

| Gate | Lệnh | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | PASS | exit 0, `error TS` = 0; config tái sinh 28 576 B lúc 09:17 |
| 2 Lint | `npx eslint` trên 8 file, **sau** gate 1 | PASS | exit 0, 0 problems |
| 3 Core types | `pnpm typecheck:core` | PASS | exit 0 |
| 4 Core boundary | `pnpm check:core` | PASS | "core imports nothing platform-specific" |
| 5 Core tests | `pnpm test:core` | PASS | **957 pass / 0 fail** (953 → 957: bốn test `projectTracks`) |
| 6 App suite | `npx tsx tests/unit/run-all.mts` | PASS | **133/133**, exit 0 (131 → 133: host + choice) |
| 7 Electron | `node --test "electron/tools/*.test.mjs"` | PASS | 59 pass / 0 fail, exit 0 |
| 8 Live | 5 route + modal + một lần xuất thật | PASS | bảng ở trên |
| 9 Docs guards | 6 spec `docs_*` / `tmcut_doc_*` | PASS | cả sáu exit 0 |
| 10 Mutation | 6 đột biến trên md5 sẽ commit | PASS | 6/6 CAUGHT, restore byte-identical |

Một allowlist phải sửa và **không** phải nới guard: `tmcut_frame_service.spec.ts` đóng băng danh sách file được import
`frameDecode`, và `webExportHost.ts` là nơi thứ tư — đúng chỗ §53.6 đã định trước ("host là chỗ duy nhất lắp bốn port").

**Chưa chứng minh, vẫn còn nguyên:** parity **điểm ảnh** với file FFmpeg trên cùng project (#156) — lần xuất 123 212 byte
ở trên là một **file thật, codec thật**, nhưng không có khung nào của nó được so với FFmpeg. Chân tiếng và chân plate vẫn
**chưa đọc byte cache** (mở theo location), nên một project có asset chỉ nằm trong IndexedDB vẫn là "no plate". Đường
desktop vẫn đi queue cũ, và lượt này **không** đo nó. Và `planEncodeContent` giờ đã chạy trên một project thật có vignette
(lần từ chối) cùng một project thật không vignette (lần xuất) — nhưng chưa trên project nhiều hàng video thật.

### 53.11 Increment H3d-4 — hai file, hai encoder, và một hạt lỗi thuộc về chính cái thước (#156)

§53.10 khép lại bằng đúng một câu nợ: file 123 212 byte là **file thật, codec thật**, nhưng **không khung nào của nó được
so với FFmpeg**. Lượt này trả câu đó bằng cách so **hai file** thay vì hai model: trình duyệt xuất một project, FFmpeg xuất
**cùng project đó** qua `compileTimelineToFfmpeg`, rồi hai file được decode và chấm trên **cùng một thang**.

**Fixture chọn theo thứ có thể che lỗi.** Bốn dải màu phẳng (đỏ/lục/lam/vàng, mỗi dải 0,5 s) đứng trước, vì màu phẳng
rơi đúng trị RGB qua bất kỳ encoder hợp lý nào — một ma trận màu sai hay một nền sai **không thể** trốn trong "nhiễu
nén". Theo sau là `testsrc2` có kết cấu, nơi sai lệch lớn hơn một cách chính đáng nên chỉ **chặn trên**, không đòi triệt
tiêu. Cả hai source đều mang tag bt709 đầy đủ: source **không tag** bị mỗi decoder đọc theo mặc định riêng — đo được,
chỉ riêng chuyện đó đã đẩy mặt phẳng chroma lệch |dU| 4,5 / |dV| 7,6 trong khi luma đứng yên.

**Hai lần FAIL đầu là lỗi của cái thước, không phải của bức tranh.** Harness bản đầu decode **cả hai** file bằng
`in_range=tv`; đo ra `pc` cho file của trình duyệt (`Mp4OutputFormat` của mediabunny ghi full-range + transfer sRGB) và
`tv` cho file FFmpeg, nên phép so **so tag chứ không so hình**: luma PSNR 26,94 dB trong khi sai số RGB chỉ 1,78. Sửa
đúng chỗ: decode mỗi file **theo tag của chính nó** (`format=rgb24` để phép chuyển tự chuẩn hoá range), và mặt phẳng YUV
được chuẩn hoá về **một** range/ma trận trước khi tách luma/chroma. Sau khi sửa: Y 37,42 dB, U 34,73, V 31,12 — đúng
hình dạng một vòng 4:2:0 → RGB → 4:2:0.

**Hạt lỗi thứ hai cũng thuộc cái thước.** Bốn màu phẳng lệch tới 11/255, nhưng toàn bộ nằm ở **hai hàng cuối** (178–179):
180 không chia hết 16, nên cả hai encoder pad macroblock cuối khác nhau trước DCT. Ngoài hai hàng đó, **0,00 %** mẫu vượt
ngưỡng. Harness bỏ đúng hai hàng đó và **ghi tên lý do**, thay vì nới tolerance cho cả khung — cùng nguyên tắc với `mask`
của `compareFrames`.

**Số đo trên cây sẽ commit** (`:4003`, 320x180 @ 30 fps, 2 s, cùng một project):

| Phép đo | Kết quả |
|---|---|
| Hình dạng file | cả hai đều 320x180 @ 30/1, **60 frame**; browser 20 336 B (phẳng) / 268 800 B (kết cấu) |
| Màu phẳng (RGB, trừ 2 hàng pad) | meanAbs **2,170**, worst **11**, tỉ lệ lệch **0,00 %**, **4/4** màu phân biệt |
| Bốn màu đọc ra | `239/50/32`, `19/168/61`, `25/68/221`, `247/186/33` — không màu nào gần nền `#101820` |
| Căn frame | offset 0 thắng rõ: `-2: 8,22  -1: 5,32  0: 1,78  +1: 5,32  +2: 8,25` |
| Kết cấu (RGB) | PSNR **36,36 dB**, meanAbs **1,783**, lệch **4,22 %** |
| Tách mặt phẳng | Y **37,42** dB / U **34,73** dB / V **31,12** dB |
| Lặp lại | hai lần xuất **giống từng pixel**: meanAbs 0, worst 0, cùng 268 800 B |
| Console trang | 0 `error` trong suốt lượt xuất |

**Ba đột biến trên đúng cây sẽ commit, restore byte-identical** (`webExportHost.ts ea71db12`, `webCodecsExport.ts
930c6883`):

| # | Đột biến | Kết quả | Số check chết |
|---|---|---|---|
| M1 | plate decode xong nhưng **không vẽ** | CAUGHT | 4 |
| M2 | mọi plate vẽ với `opacity: 0.5` | CAUGHT | 4 |
| M3 | dịch đích vẽ **+8 px sang phải** | CAUGHT | 4 |

**Gates của increment này:**

| Gate | Lệnh | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | PASS | exit 0, `error TS` = 0; config tái sinh 28 576 B lúc 10:19 |
| 2 Lint | `npx eslint tests/e2e/tmcut_h3d4_pixel_parity.mts`, **sau** gate 1 | PASS | exit 0, 0 problems (5 lỗi style đầu tiên do chính file mới, sửa tay) |
| 3 Core types | `pnpm typecheck:core` | PASS | exit 0 |
| 4 Core boundary | `pnpm check:core` | PASS | "core imports nothing platform-specific" |
| 5 Core tests | `pnpm test:core` | PASS | **957 pass / 0 fail** |
| 6 App suite | `npx tsx tests/unit/run-all.mts` | PASS | **133/133**, exit 0 |
| 7 Electron | `node --test "electron/tools/*.test.mjs"` | PASS | **59 pass / 0 fail**, exit 0 |
| 8 Live | 5 route TMCut trên `:4003` | PASS | chỉ `[info] <Suspense>`, không `error`/`warn` |
| 9 Docs guards | 6 spec `docs_*` / `tmcut_doc_*` | PASS | cả sáu exit 0 |
| 10 Parity | `tests/e2e/tmcut_h3d4_pixel_parity.mts` | PASS | **8/8 check**, exit 0 |
| 11 Mutation | 3 đột biến trên md5 sẽ commit | PASS | 3/3 CAUGHT, restore byte-identical |

Một guard **bắt được chính lượt này** và đúng như thiết kế: `tmcut_doc_citations` từ chối header `audit §53.10` vì
`audit` không phải một family đã khai (bảy family đăng ký không có nó). Sửa **câu chữ trong spec mới**, không sửa guard —
bản ghi trích dẫn trần (`§53.10`) là dạng các spec anh em đang dùng.

**Chưa chứng minh, vẫn còn nguyên:** parity này là **fixture tự sinh** (màu phẳng + `testsrc2`), không phải footage quay
thật, không có chuyển cảnh, hiệu ứng, chữ hay nhiều hàng video — §53.4 vẫn giữ nguyên câu đó cho project thật. Sai lệch
4,22 % ở kết cấu **chưa được quy hết**: bitrate đã bị loại (ba mức 726k/2000k/6000k của FFmpeg cho cùng MAE), và một
vòng YUV→RGB→YUV mô phỏng trên chính file FFmpeg thu hẹp khoảng chroma (Y 37,4 → 39,5, V 28,3 → 33,9) nhưng **không**
khớp tuyệt đối, nên phần còn lại là khác biệt giữa hai encoder chroma chứ không phải một con số đã giải thích xong. Tag
màu hai bên **khác nhau có chủ đích** (`pc`/sRGB so với `tv`/bt709): người chơi đọc đúng tag thì hình đúng, nhưng một
công cụ bỏ qua tag sẽ thấy hai file "khác hệ màu" — đáng ghi vào slice I khi quyết định tag đầu ra. Và lượt này **không**
đo Electron: toàn bộ số ở trên là Chromium của trình duyệt thường.

### 53.12 Increment H3d-6 — chân xuất đọc **bản sao trong browser**, và một mutation sống đã chỉ ra chỗ chưa ai gác

§53.11 khép lại bằng một câu nợ nêu đích danh: **chân plate và chân tiếng vẫn mở file theo location** (`bytes: null` ở
`frameDecode.ts` và `exportMixLeg.ts`), nên một project có asset chỉ nằm trong IndexedDB/OPFS — đúng thứ slice C2b đã
giữ lại — vẫn xuất ra "no plate" dù preview phát được. Lượt này đóng đúng cái lỗ đó, không mở rộng gì khác.

**Một port, hai chân, một câu trả lời.** `createWebExportHost` nhận `bytesFor(src)` ở `run`, và **không** tự gọi nó:
cùng một object port được đưa cho cả `createPlateReader` lẫn `createExportMixLeg`. Hai chân mà tự đọc cache riêng thì
hình và tiếng của **một** file có thể đến từ hai bản khác nhau — loại lệch chương trình này dành cả mùa để dẹp.

**Hai đường khoá khác nhau, và đó là chỗ dễ sai nhất.** Cache được đánh khoá bằng **fingerprint của revision**, mà
revision chỉ có nghĩa với **path tác giả** (`C:/media/a.mp4`), không có nghĩa với location decoder mở
(`media://local?file=…`). Nên `TmcutPlateAsk` mang thêm `authoredSrc`: cache hỏi bằng `authoredSrc ?? src`, còn container
vẫn mở `src` đã resolve. Không có trường đó thì mọi lần đọc cache đều trượt và rơi về stream — im lặng, đúng kiểu lỗi
mà cả bảng mutation bên dưới phải bắt được.

**Một lần hỏi cho mỗi file, không phải mỗi frame.** `PlateHolder` giờ có `opened: … | null` và một `opening` promise
không bao giờ reject: cache được hỏi lúc dựng holder, và mọi frame sau đó `await opening` rồi mới đọc. Hỏi theo frame là
~30 lượt đọc storage mỗi giây của một lần xuất, cho một câu trả lời không thể đổi giữa chừng. Chân tiếng đã có sẵn
`runs` keyed theo file từ §53.9, nên ở đó chỉ thêm một `await bytesFor(src)` bên trong promise đã chia sẻ.

**Trượt là fallback, không phải từ chối.** Cache không giữ revision này, thư viện không biết path này, hoặc chính
storage ném lỗi (private mode, quota) — cả ba đều là `null` và chân đọc location như trước. Lượt này chứng minh cả ba
bằng unit check; nếu không, một máy cache mỏng sẽ **mất** hình chứ không chỉ chậm.

**Số đo trên cây sẽ commit** (`:4003`, 320x180 @ 30 fps, 2 s; fixture sinh vào thư mục tạm, **không** vào
`.data/uploads`, và project trỏ tới `/uploads/h3d6-<pid>.mp4` — URL đó 404):

| Phép đo | Kết quả |
|---|---|
| Khoá revision dùng để gieo cache | `2d847832` — đúng dạng `^[0-9a-f]{8}$` mà `isByteCacheKey` chấp nhận |
| Server có file đó không | **404** — nên chỉ cache mới vẽ được, đây là điều kiện của cả harness |
| Gieo vào cache | backend **opfs**, **3 305 byte** đọc lại được |
| Xuất **có** port | **exported**, 20 336 byte, 320x180 @ 30/1, **60 frame** |
| Màu đọc ra | `239/50/32`, `19/168/61`, `25/68/221`, `247/186/33` — 4/4 phân biệt, không màu nào gần nền `#101820` |
| Xuất **không** port (đối chứng) | **failed**, không có file nào được ghi — đúng hành vi trước lượt này |
| Console trang | 0 `error` trong cả ba lượt xuất |

**Bảy mutation trên đúng cây sẽ commit, restore byte-identical:**

| # | Đột biến | Kết quả | Check chết |
|---|---|---|---|
| M1 | plate reader **bỏ qua** port, luôn mở location | CAUGHT | `one cache read per file…` |
| M2 | đọc cache nhưng vẫn `open({ bytes: null, … })` | CAUGHT | `the container was opened from the cached copy` |
| M3 | bỏ `try/catch` quanh lần đọc cache | CAUGHT | ném lỗi ra ngoài (`the storage layer refused this read`) |
| M4 | khoá cache bằng `src` (URL) thay vì `authoredSrc` | **SỐNG lần đầu** → thêm check → CAUGHT | `the cache saw the path the library names…` |
| M5 | chân tiếng bỏ port, luôn `bytes: null` | CAUGHT | `one cache read per sounding file…` |
| M6 | host không đưa port cho reader | CAUGHT | `the reader factory was handed the port…` |
| M7 | reader có port, mixer thì không | CAUGHT | `the sound leg was handed the same answer…` |

M4 là phần đáng ghi nhất: đột biến **sống** vì lúc đó chưa có check nào phân biệt "hỏi cache bằng path tác giả" với
"hỏi bằng location". Một guard viết sau một mutation sống là guard thật; một guard viết trước rồi mutation chết cũng
vậy, nhưng chỉ mutation mới nói được cái nào là cái nào. Không sửa spec nào để hợp với code — check mới được thêm, và
code giữ nguyên hình dạng đã thiết kế.

**Gates của increment này:**

| Gate | Lệnh | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | PASS | exit 0, `error TS` = 0; config tái sinh 28 576 B |
| 2 Lint | `npx eslint` 9 file chạm, **sau** gate 1 | PASS | exit 0 (1 lỗi `arrow-parens` do chính lượt này, sửa tay) |
| 3 Core types | `pnpm typecheck:core` | PASS | exit 0 |
| 4 Core boundary | `pnpm check:core` | PASS | "core imports nothing platform-specific" |
| 5 Core tests | `pnpm test:core` | PASS | **957 pass / 0 fail** |
| 6 App suite | `npx tsx tests/unit/run-all.mts` | PASS | **133/133**, exit 0 |
| 7 Electron | `node --test "electron/tools/*.test.mjs"` | PASS | **59 pass / 0 fail**, exit 0 |
| 8 Live | 5 route TMCut trên `:4003` | PASS | 0 `error` / `warn` / `issue` trên cả năm |
| 9 Cache export | `tests/e2e/tmcut_h3d6_cache_export.mts` | PASS | **8/8 check**, exit 0, gồm cả lượt đối chứng thất bại |
| 10 Mutation | 7 đột biến trên md5 sẽ commit | PASS | 7/7 CAUGHT (M4 sau khi thêm check), restore byte-identical |

**Chưa chứng minh, vẫn còn nguyên:**

- cả hai harness đều chạy trên **Chromium của trình duyệt thường**; Electron chưa được đo lượt này, và §53.11 vẫn giữ
  câu đó;
- fixture là **màu phẳng tự sinh**, không phải footage quay thật, không chuyển cảnh, không hiệu ứng, không nhiều hàng
  video — §53.4 giữ nguyên;
- đường **desktop** vẫn đi queue cũ (`compileTimelineToFfmpeg`), không đi qua host này, nên lượt này không nói gì về nó;
- cache được **gieo bằng tay** trong harness, không phải bằng `importWebFiles`; chuỗi import → `cacheAssetBytes` →
  `bytesForAsset` chưa được đo đầu-cuối trong cùng một phiên, chỉ từng mắt một (spec của `cacheAssetBytes` và check
  `bytesForAsset` ở trên);
- ~~một project có cảnh báo cache trượt (một file có, một file không) chưa được đo~~ — **đã đo ở lượt sau**, xem §53.12.1.

### 53.13 Increment H3e — exit gate của slice H có **ba** vế, và vế thứ ba chưa ai gác

Bảng migration (§8) ghi exit gate của slice H là "output play được, A/V sync, **0 spawn**". Hai vế đầu đã được đo: §52 đo
file thật cùng offset A/V, §53.11 đo điểm ảnh so với FFmpeg. Vế thứ ba chỉ từng được **nói**, chưa từng được **gác** —
và "module này hôm nay không import ffmpeg" là một câu về import, đúng thứ một slice sau sửa lúc đi ngang.

**Gác bằng đồ thị, không bằng grep một từ.** Spec mới `tmcut_export_process_census.spec.ts` đi từ đúng entry mà modal
gọi (`webExportHost.ts`), theo **cạnh runtime** của từng module cục bộ, và **đóng băng cả tập** kết quả. Một import mới
vào đồ thị làm spec đỏ **cho tới khi** ai đó sửa danh sách — đúng lúc người đó phải trả lời "module mới này có mở tiến
trình không?". `import type` bị loại khỏi phép đi: nó bị compiler xoá và không kéo gì vào bundle, nên tính nó là mô tả
một đồ thị không hề chạy. Cạnh đó có thật: `paintSurfaces.ts` khai kiểu clip của store bằng `import type`.

**Bản nháp của spec sai hai chỗ, và lượt chạy nói ra.** Danh sách đầu tiên tôi viết có **6** module; phép đo trả về
**8** — thiếu `audioDecode.ts` (seam PCM của chân tiếng, §53.9) và `paintSurfaces.ts` (luật surface dùng chung, §53.7).
Lần chạy thứ hai lộ thêm một sai nữa ở check cuối: tôi giả định `electron/tools/video-generation/controller.mjs` là nơi
spawn FFmpeg, nhưng file đó **không** nhắc tới ffmpeg — chỗ spawn thật là `electron/tools/ffmpeg.controller.cjs`
(`require('child_process')`, `spawn`, `execFile`). Cả hai đều là lỗi của spec, không phải của code, nên sửa **spec**:
danh sách lấy theo số đo, và check cuối chỉ vào đúng file. Không có dòng sản phẩm nào bị sửa để làm spec xanh.

**Đồ thị đo được** (8 module, tất cả dưới `app/utils/tmcut/`):

| Module | Vai trò trong lần xuất |
|---|---|
| `webExportHost.ts` | entry: lắp bốn port, `bytesFor` dùng chung hai chân (§53.12) |
| `webCodecsExport.ts` | keo: hỏi capability, gọi session, một kết quả trong năm loại |
| `exportEncodeSession.ts` | vòng encode thật (`VideoEncoder`/`AudioEncoder` + mediabunny) |
| `exportEncodePlan.ts` | thang preset và câu hỏi capability |
| `exportMixLeg.ts` | chân tiếng: một decode cho một file, cộng bằng luật core |
| `audioDecode.ts` | seam PCM (`AudioBufferSink`), mượn `openMedia` |
| `frameDecode.ts` | chân plate (`CanvasSink` + `openMedia`) |
| `paintSurfaces.ts` | luật surface dùng chung preview/export (chỉ import runtime `compositePlan`, `ticksToSec`) |

**Bảy check:**

1. entry đúng là module modal gọi, và modal import nó từ **một** chỗ;
2. đồ thị **bằng đúng** tám module trên (so cả tập, không `includes`);
3. không module nào trong đồ thị gọi `node:child_process`, `spawn`, `spawnSync`, `execFile`, `execSync` — đọc **code**
   sau khi bỏ dòng comment, vì chính spec này nhắc chữ `spawn` trong prose;
4. đồ thị **không chạm được** phía FFmpeg: `ffmpegHelper.ts`, `compiler.ts`, `render/index.ts`, `hostBridge.ts` đều
   không có mặt; và chiều ngược lại được ghi tên — `compiler.ts` vẫn là chỗ sinh args FFmpeg, slice I xoá nó;
5. package duy nhất được phép là `tmcut-core` và `mediabunny`; một package chỉ-Node ở đây là một tiến trình dưới tên khác;
6. nhánh web trong modal **return** trước `enqueueJob`, nên đồ thị sạch không thể bị vô hiệu bằng một lần rơi xuống queue;
7. chỗ spawn thật là `electron/tools/ffmpeg.controller.cjs`, **không** module `electron/` nào nằm trong đồ thị.

**Ba mutation trên đúng cây sẽ commit, restore byte-identical** (`webExportHost.ts 2ae10512`, `TmcutExportModal.vue
32aae6f6`):

| # | Đột biến | Kết quả | Check chết |
|---|---|---|---|
| C1 | export host import `hostBridge` (IPC) | CAUGHT | `the export pulls in exactly the modules this spec names` |
| C2 | export host `import { spawnSync } from 'node:child_process'` và gọi nó | CAUGHT | `webExportHost.ts uses node:child_process` |
| C3 | nhánh web mất `return`, rơi xuống `enqueueJob` | CAUGHT | `the web branch returns…` |

Một mutation thử lần đầu (gọi `runWebExport()` hai lần) **sống** — nhưng nó không phải phép thử đúng: nó thêm một lời
gọi chứ không bỏ `return`. Làm lại đúng phép thử thì chết. Ghi lại vì "mutation sống" chỉ có nghĩa khi mutation thật sự
tấn công điều spec tuyên bố.

**Gates của increment này:**

| Gate | Lệnh | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | PASS | exit 0, `error TS` = 0; config tái sinh 28 576 B |
| 2 Lint | `npx eslint tests/unit/tmcut_export_process_census.spec.ts` | PASS | exit 0 (1 lỗi `arrow-parens` do chính lượt này, sửa tay) |
| 3 Core types | `pnpm typecheck:core` | PASS | exit 0 |
| 4 Core boundary | `pnpm check:core` | PASS | "core imports nothing platform-specific" |
| 5 Core tests | `pnpm test:core` | PASS | **957 pass / 0 fail** |
| 6 App suite | `npx tsx tests/unit/run-all.mts` | PASS | **134/134**, exit 0 (133 → 134) |
| 7 Electron | `node --test "electron/tools/*.test.mjs"` | PASS | **59 pass / 0 fail**, exit 0 |
| 8 Live | 5 route TMCut trên `:4003` | N/A | lượt này chỉ chạm `tests/` + `docs/`: không có đường render nào đổi, nên không có gì để quét |
| 9 Docs guards | 6 spec `docs_*` / `tmcut_doc_*` | PASS | cả sáu exit 0 |
| 10 Mutation | 3 đột biến trên md5 sẽ commit | PASS | 3/3 CAUGHT |

**Chưa chứng minh, và đây là chỗ dễ tự lừa nhất:**

- "0 spawn" ở đây là **0 spawn trong đồ thị module của lần xuất trình duyệt**. Nó **không** đo số tiến trình thật trên
  máy lúc bấm nút: một lời gọi `fetch` tới route server, một service worker, hay một lần Electron main khởi động ffmpeg
  vì lý do khác đều nằm ngoài phép đếm này. Phép đo tiến trình thật (đếm `ffmpeg.exe` trong Task Manager quanh một lần
  xuất) vẫn chưa làm;
- vế "output play được" và "A/V sync" **không** được chạy lại lượt này; chúng vẫn đứng trên số của §52 và §53.11, và
  cả hai đều là fixture, không phải footage quay;
- đường **desktop** (`nativeFFmpeg`) vẫn spawn, đúng thiết kế và đúng thứ slice I xoá; lượt này không đo nó;
- spec đọc import bằng regex trên `from '…'`, nên một `import('…')` động sẽ không hiện ra trong đồ thị. Chưa có call
  site động nào trong tám module, nhưng đó là giới hạn của phép đo, không phải một bảo đảm.

### 53.12.1 Nửa còn lại của §53.12 — một lần xuất, **một file có cache và một file không**

§53.12 ghi đúng một câu nợ về chính harness của nó: cả hai lượt đo chỉ có **một** file, nên "cache trượt thì rơi về location"
mới chỉ được chứng minh bằng unit check chứ chưa bằng một lần xuất thật. Lượt này đóng câu đó bằng một project **hai clip
nối tiếp** — clip đầu chỉ có trong cache (URL 404), clip sau chỉ có trên đĩa (không có trong cache) — nên một lần xuất đi qua
cả nhánh **hit** lẫn **miss** của cùng một port.

**Fixture phải khác nhau về nội dung, và đây là chỗ harness đầu tiên của tôi sai.** Bản đầu dùng **cùng một file** cho cả hai
clip. Khi mutation "một câu trả lời cache dùng cho cả lượt" được thử, nó **sống**: leg vẽ đúng bytes của file cache cho cả
hai clip, và vì hai clip giống hệt nhau nên bức tranh ra **đúng** — trong khi code đã sai. Sửa fixture: file thứ hai là một
màu teal phẳng (`0x20A0A0`) hoàn toàn khác bốn màu của file cache, nên câu hỏi "khung này từ file nào" trả lời được bằng
cách **đọc khung**, không bằng cách tin code đang được đo.

**Cùng lúc lộ ra một lỗi thứ hai, cũng của harness:** port `bytesFor` trong bản đầu **bỏ qua** đối số `src` và luôn trả blob
đã cache — trong khi `bytesForAsset` thật tra asset theo `clip.src`. Một port như vậy khiến chính phép đối chứng của harness
trở nên vô nghĩa. Sửa: port trả cache **chỉ cho đúng path** đã gieo, `null` cho mọi path khác.

**Số đo trên cây sẽ commit** (`:4003`, 320x180 @ 30 fps):

| Phép đo | Kết quả |
|---|---|
| Lượt một file, chỉ cache | **exported** 20 336 B, 60 frame, bốn màu đúng trị |
| Lượt đối chứng, không port | **failed**, không ghi file — hành vi trước §53.12 |
| Lượt hai file (cache + đĩa) | **exported** 19 700 B, **60 frame** |
| Nửa đầu (clip trong cache) | `239/50/32` — đỏ của file cache |
| Nửa sau (clip trên đĩa) | `21/147/159` — teal của file đĩa, **không phải** màu của file cache |
| Console trang | 0 `error` trong cả ba lượt |

**Hai mutation, cả hai CAUGHT sau khi sửa fixture** (`frameDecode.ts e0d86187`, harness `ad9b…`):

| # | Đột biến | Kết quả | Check chết |
|---|---|---|---|
| M8 | một câu trả lời cache dùng cho **mọi** file trong lượt | **SỐNG** với fixture cũ → CAUGHT với fixture mới | `each half shows ITS OWN file…` |
| M9 | port của harness bỏ qua `src`, luôn trả blob cache | **SỐNG** với fixture cũ → CAUGHT với fixture mới | `each half shows ITS OWN file…` |

Đây là lần thứ hai trong hai lượt liên tiếp mà một mutation sống chỉ ra một **lỗ hổng của phép đo**, không phải của code
(lần trước là M4 ở §53.12). Ghi lại vì nó là mẫu: một harness dùng **một** fixture không bao giờ phân biệt được "đọc đúng
file" với "đọc file đầu tiên cho mọi clip", và một port giả bỏ qua tham số sẽ đồng ý với bất kỳ cách gọi nào.

**Chưa chứng minh:** cả hai file vẫn là fixture sinh bằng `ffmpeg` (màu phẳng + sine), không phải footage quay.

### 53.12.2 Chân **tiếng** cũng có hai file, và một tần số đọc ra được

§53.12.1 đo nhánh **plate**. Chân tiếng là **call site thứ hai** của cùng port (`runFor` ở `exportMixLeg.ts`), nên một bức
tranh đúng không nói gì về nó. Lượt này thêm **tone** vào hai fixture và đo lại, cùng một lần xuất:

| Phép đo | Kết quả |
|---|---|
| File cache (chỉ trong OPFS, URL 404) | sine **440 Hz**, 19 904 B trong cache |
| File đĩa (chỉ trên đĩa, không trong cache) | sine **880 Hz** |
| Lượt hai file | **exported** 24 647 B, 60 frame |
| Nửa đầu — **hình** | `239/50/32` (đỏ của file cache) |
| Nửa sau — **hình** | `21/147/159` (teal của file đĩa) |
| Nửa đầu — **tiếng** | **440,0 Hz** (zero-crossing, cửa sổ 0,7 s từ 0,15 s) |
| Nửa sau — **tiếng** | **879,3 Hz** (cùng cách đo, từ 1,15 s) |
| Console trang | 0 `error` |

Đo tần số bằng **đếm zero-crossing**, không FFT: fixture là sine thuần — đúng loại tín hiệu mà phép đếm này đo chắc chắn —
nên FFT chỉ thêm code và thêm cách sai. Ngưỡng ±12 % rộng rãi cho AAC, và vẫn cách xa hệ số **2×** giữa 440 và 880, nên
"đọc nhầm file" không thể lọt.

**Hai mutation, ghi cả cái sống:**

| # | Đột biến | Kết quả | Vì sao |
|---|---|---|---|
| M10 | chân tiếng **bỏ qua** cache hoàn toàn | CAUGHT | lượt một-file `failed` vì location 404 — chân tiếng chính là thứ đọc file đó |
| M11 | chân tiếng chỉ hỏi cache cho **file đầu** | **SỐNG** | đây là **mutant tương đương** trong phạm vi harness này: file thứ hai chỉ có trên đĩa, nên bỏ lần hỏi cache của nó trả về đúng bytes. Muốn giết nó phải có một file thứ hai **cũng** nằm trong cache — điều harness hai-file cố tình không có |

Ghi M11 lại vì "mutation sống" luôn cần một câu giải thích: ở đây nó **không** chỉ ra lỗ hổng của phép đo, mà chỉ ra giới hạn
của fixture — và giới hạn đó là chủ ý (một hit + một miss là điều §53.12.1 cần chứng minh).

---

## 54. Slice I — cắt engine FFmpeg: binary, spawn, IPC, route, bảng DB (đo ngày 2026-11-08)

Slice H đã tạo ra file thật từ WebCodecs + Mediabunny và chứng minh parity điểm ảnh (§53), nên điều kiện tiên quyết của
slice I ("chỉ cắt sau khi engine thay thế chạy được") đã thoả. Lượt này **cắt** engine FFmpeg khỏi repo, build và runtime —
không phải một lượt xây thêm. Chỉ thị của chủ repo ("xóa hết phần exe … bỏ hoàn toàn ffmpeg") là xác nhận cho thao tác khó
đảo ở Q3/Q7 (§8, §10 của register). Mọi số dưới đây đo trên cây sẽ commit, HEAD `b0d0c44` (H3d-6c).

### 54.1 Kiểm kê nhát cắt

`git diff HEAD --shortstat`: **118 file changed, 1807 insertions(+), 18098 deletions(-)**. Phần thêm là prose chuyển hướng
sang engine mới, guard thay thế, và fixture protocol; phần xoá là engine cũ. Phân theo nhóm:

| Nhóm | Đã xoá / đã đổi | Bằng chứng |
|---|---|---|
| Binary + đóng gói | `resources/*.exe` (471 MiB) gỡ khỏi máy dev và khỏi `electron-builder.yml`; updater không còn tải/giải nén FFmpeg | §54.2 |
| Controller desktop | `electron/tools/ffmpeg.controller.cjs`, `electron/tools/task-manager.cjs` | `git ls-files` không còn |
| App engine | `app/utils/ffmpegHelper.ts`, `app/utils/tmcut/compiler.ts`, cả cây `app/utils/tmcut/render/` (8 file), `app/utils/tmcut/webProbe.ts` | `git ls-files` không còn |
| Export queue UI | `TmcutExportQueueModal.vue`, `useTmcutExportQueue.ts`, `useToolTaskManager.ts` | hàng đợi FFmpeg chết cùng engine |
| Server media | 5 route `server/api/v1/media/{analyze,html-video,proxy,render}.post.ts` + `render/[jobId].get.ts`; `server/utils/{htmlVideoRender,renderJobs}.ts`; `shared/utils/detection-args.cjs` | §54.4 |
| IPC + preload | namespace `tools:ffmpeg:*` (10 event), `tmcut:renderDone`, task-manager khỏi `ipcPolicy.cjs` + `preload.cjs` | §54.4 |
| DB | 3 bảng `ffmpeg_configs`, `ffmpeg_batch_configs`, `ffmpeg_history` ngừng tạo/truy cập | §54.3 |
| Types + capability | `nativeFFmpeg` chết trong `shared/types/electron.ts`, `packages/core/types/*`; `platform.mjs` bỏ cờ | I-5 |
| Docs + i18n | key stabilization/subtitle-burn-in nghỉ hưu; prose trỏ về engine mới; link tới file đã xoá đổi thành code | doc guards §54.7 |

**Storage Upload API thuần được giữ** (`server/api/v1/media/upload.post.ts`, `server/utils/uploads.ts`): brief cấm xoá nó,
và ADR-033 vẫn cần nó cho tới khi upload thôi bắt buộc. `child_process` không-media cũng được giữ (§54.4).

### 54.2 Tiêu chí thoát binary — đo được, không phải suy đoán

| Phép đo | Kết quả |
|---|---|
| `.exe` tracked (`git ls-files '*.exe'`) | **0** |
| `.exe` trong working tree (trừ `node_modules`/`.git`/`.nuxt`/`.output`/`dist`/`release`) | **0** |
| `resources/*.exe` | không tồn tại |
| FFmpeg trong `package.json` | **0** (chưa từng có package FFmpeg — binary tải qua updater, không phải npm dep) |
| FFmpeg/ffprobe/imageio trong `pnpm-lock.yaml` | **0** |
| `backup/ffmpeg-engine-2026-11-03/` | **76 file, 0 executable** — vẫn untracked, không vào build |

Backup được **giữ nguyên**, không xoá: Q8 (§10) chốt "giữ untracked tới hết slice I, chỉ xoá sau khi parity xác nhận không
cần tới nó nữa", và brief bảo vệ working tree cấm xoá backup. Nó là bản soi chiếu source (0 exe), không phải binary, nên
chỉ thị "xóa hết phần exe" đã thoả mà không cần đụng tới nó. Việc xoá backup là một quyết định riêng còn chờ chủ repo.

### 54.3 Ba bảng DB: xoá thuần, không mất dữ liệu

[sqlite.cjs](file:///D:/Applications/tm-studio/electron/tools/sqlite.cjs) mất **ba** khối `CREATE TABLE IF NOT EXISTS`
(`ffmpeg_configs`, `ffmpeg_batch_configs`, `ffmpeg_history`) cùng toàn bộ accessor của chúng (list/get/insert/update/delete,
`tryAddHistoryCol`). `git diff --numstat` cho thấy đây là **0 insertion / pure deletion**. Không có `DROP TABLE`, không có
`DELETE FROM`, không migration nào chạy. Hệ quả đo được: trên DB mới ba bảng không được tạo; trên DB cũ của người dùng,
bảng và hàng còn nguyên trên đĩa nhưng không code nào đọc nữa — **không mất project, không mất dữ liệu**. Đây là lựa chọn
an toàn mà brief yêu cầu ("kiểm tra migration/retention trước khi xử lý 3 bảng DB"): ngừng tạo/truy cập thay vì phá bảng.

### 54.4 IPC, route, và `child_process` còn lại

`grep` trên `ipcPolicy.cjs` + `preload.cjs`: **0** kênh FFmpeg còn sống (chỉ một dòng comment giải thích `renderDone` đã
nghỉ cùng hàng đợi). `grep` spawn/exec chạm `ffmpeg`/`ffprobe` trong `app/` + `server/` + `electron/`: **0** runtime media
spawn. `child_process` trong `electron/` + `server/` chỉ còn **2 file**, cả hai không-media:

| File | Việc | Vì sao không phải media |
|---|---|---|
| [main.cjs](file:///D:/Applications/tm-studio/electron/main.cjs) | spawn MCP server | tiến trình tool nội bộ, không decode/encode |
| [paths.cjs](file:///D:/Applications/tm-studio/electron/tools/paths.cjs) | `execFile(yt-dlp, ['--version'])` | probe phiên bản downloader; `getToolsBinaries()` chỉ trả `ytDlp`, `verifyExecutable` từ chối mọi `type !== 'ytDlp'` |

[updater.cjs](file:///D:/Applications/tm-studio/electron/tools/updater.cjs) không còn import `child_process`: `extractZip`
(`tar`/PowerShell) và `findFilesRecursive` đã xoá vì đường tải FFmpeg chết; yt-dlp cài bằng tải `.exe` trần, không giải nén,
nên `execFile` hoá mồ côi và đã gỡ. Đây là `child_process` không-media duy nhất còn lại của updater trước lượt này.

### 54.5 Gate binary cuối cùng nghỉ hưu — có mutation chứng minh

Hai spec từng chờ binary FFmpeg nay không thể chờ nữa (binary không tồn tại), nên lượt này nghỉ hưu chúng dưới TDD:

- [tmcut_fx_catalog.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_fx_catalog.spec.ts): bỏ leg "binary quảng
  cáo tên xfade" (đọc `process.env.TOOLS_FFMPEG_PATH` + `resources/ffmpeg.exe` rồi `advertisedXfadeNames()`), vì không
  resolver nào còn đọc biến đó — leg chỉ có thể in SKIP vĩnh viễn. **Giữ** check tập tên documented và guard one-home
  (assert `ffmpeg.controller.cjs` vẫn bị xoá). Kết quả **8/8**, exit 0.
- [tmcut_runner_status.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_runner_status.spec.ts): thay check "mọi
  gate binary còn lại phải announce skip" bằng check **"không spec nào gate trên binary FFmpeg nữa"** — quét mọi
  `.spec.ts` tìm một *read* thật (`process\.env\.TOOLS_FFMPEG_PATH` hoặc `imageio-ffmpeg`), loại trừ chính nó theo tên.
  Kết quả **8/8**, exit 0.

Guard mới được chứng minh **không vacuous** bằng mutation: thêm `const probe = process.env.TOOLS_FFMPEG_PATH` vào
`fx_catalog` → runner **exit 1**, gọi đúng tên `fx_catalog`; trả file về **nguyên byte** (md5 `6918fcd24674eee234762c8d4c78b986`
khớp trước/sau). Regex khớp một *read*, không khớp prose, nên docblock nhắc tên biến trong fx_catalog không tự kích guard
(lỗi đầu tiên của chính lượt này: regex `/TOOLS_FFMPEG_PATH/` trần đã bắt nhầm prose → sửa thành `/process\.env\.TOOLS_FFMPEG_PATH/`).

### 54.6 Suite bắt một regression thật: `extractFrame` rò slot

Lượt I-3 thêm nút snapshot HUD gọi `extractFrame`. Bản đầu dùng `requestFrame` — leg **giữ slot tới `forget`/`dispose`**.
Với một ảnh chụp chiếu một lần rồi tải ngay, không ai re-ask dưới slot đó, nên mỗi instant phân biệt rò **một slot tracked
suốt session**. [tmcut_resource_lifecycle.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_resource_lifecycle.spec.ts)
bắt được: check "no longer asks frame by frame, which is what leaked a slot per job" fail (suite **123/124**). Đây là
regression thật so với HEAD (HEAD chỉ có `requestFrameBatch`), không phải assertion sai.

Sửa trong [useTmcutFrames.ts](file:///D:/Applications/tm-studio/app/composables/useTmcutFrames.ts): `extractFrame` đi qua
**`requestFrameBatch([{...}])`** — batch một phần tử — vì `finishBatchSlot` trả slot ngay khi câu trả lời về. URL vẫn nằm
trong `held` tới `dispose` nên tải ảnh vẫn chạy. **Không** nới assertion. Spec **12/12**, suite **124/124** sau sửa.

### 54.7 Bảng gate (đo trên cây sẽ commit)

| Gate | Lệnh | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 Types | `npx nuxt typecheck` | **PASS** | exit 0, **0** `error TS`; `.nuxt/eslint.config.mjs` regenerate (26290 B, 11:42) |
| 2 Lint | `npx eslint <70 file chạm>` (sau gate 1) | **PASS có điều kiện** | exit 1, **104 problem** (104 error/0 warn) — `ON_CHANGED_LINES=0`, `ON_UNCHANGED_LINES=104`: toàn bộ nợ cũ của owner trên dòng không đổi, **0** error trên dòng slice I sửa; không `--fix` repo-wide |
| Core types | `pnpm typecheck:core` | **PASS** | `tsc --noEmit -p packages/core/tsconfig.check.json` exit 0 |
| Core boundaries | `pnpm check:core` | **PASS** | "core imports nothing platform-specific" |
| Core test | `pnpm test:core` | **PASS** | **957/957**, 0 fail |
| 3 Unit suite | `npx tsx tests/unit/run-all.mts` | **PASS** | **124/124 specs**, exit 0 (gồm runner_status 8/8, fx_catalog 8/8, resource_lifecycle 12/12, census 8/8, shared_imports 5/5) |
| Electron tools | `node --test "electron/tools/*.test.mjs"` | **PASS** | **59 test / 13 suite / 59 pass / 0 fail / 0 skip** |
| 4 Live | chrome-devtools trên `:4003`, 5 route | **BLOCKED** | owner chưa sign-in; `/login` sweep sạch (1 `info` Suspense, **0** `error`/`warn`/`issue`); bốn route cần auth không vào được — credentials bị cấm |
| 5 Doc guards | 5 guard chạy **cuối** sau mọi sửa prose | **PASS** | xem dòng dưới, chạy lại trên chính cây tài liệu cuối |

**Gate 2 diễn giải trung thực:** 104 error là nợ style **có sẵn từ HEAD** trên những dòng slice I không đổi (ví dụ
`schemas.ts` 6, `tool-registry.ts` 54, `runway-adapter.mjs` 33 — đều là file thuần xoá khối FFmpeg, `hunks=0` nghĩa là dòng
sống sót giống HEAD nguyên byte). Ba identifier "unused" mà lint phàn nàn cũng giống HEAD về số lần xuất hiện. Sửa chúng
là `--fix` repo-wide vào nợ của owner — brief cấm. Nên gate 2 báo **0 error trên dòng chạm**, không phải "0 problem".

**Gate 5 (doc guards):** `tmcut_doc_table_shape`, `tmcut_docs_link_integrity`, `tmcut_doc_line_length`,
`tmcut_doc_citations`, `tmcut_doc_charset` + `docs_markdown` chạy lại **sau** khi §54 và note ADR được viết, trên đúng cây
tài liệu cuối cùng — kết quả ghi ở §54.9. Link trong §54 chỉ trỏ file **còn tồn tại**; file đã xoá gọi bằng code thường.

### 54.8 DoD §25 — trạng thái đo sau slice I

Bảng §11 là *kế hoạch bằng chứng* ở slice A; bảng dưới là trạng thái **đo thật** sau slice I (supersede §11):

| Mục DoD | Trước slice I (§11) | Đo sau slice I |
|---|---|---|
| Không FFmpeg trong dependency tree | đã đúng | **0** trong `package.json` + `pnpm-lock.yaml` |
| Không binary trong repo/build | chưa (471 MiB) | **0** `.exe` tracked + working tree; `resources/*.exe` gone (§54.2) |
| Không spawn/exec media | chưa (9 file media) | **0** runtime media spawn; 2 `child_process` không-media (§54.4) |
| Không FFmpeg IPC/config/env | chưa (10 kênh, 3 bảng) | **0** kênh FFmpeg; 3 bảng ngừng tạo/truy cập, không DROP (§54.3) |
| Không docs hướng dẫn cài FFmpeg | một phần | updater hết đường tải FFmpeg; prose còn lại thuộc slice K archive |
| Electron dùng chung engine | chưa | `ffmpeg.controller.cjs` đã xoá; desktop đọc `packages/core/src` (ADR-022) |
| Probe / WebCodecs / muxer / frame timing | chưa / một nửa | **đã đóng ở B–H** (§13, §48–§53); không thuộc phạm vi slice I |

### 54.9 Báo cáo slice I (mẫu brief §9)

| Field | Nội dung |
|---|---|
| Slice | I (I-1…I-6) |
| Status | **PASS** (gate 4 BLOCKED vì auth, không phải vì code) |
| Files changed | 118 file, +1807 / −18098 |
| Tests | suite **124/124**; core **957/957**; electron **59/59** (13 suite); runner_status 8/8, fx_catalog 8/8, lifecycle 12/12 |
| Build | typecheck exit 0 / 0 `error TS`; core tsc exit 0; boundaries PASS; lint 0 error trên dòng chạm (104 nợ cũ owner) |
| DoD closed | binary, spawn, IPC, route, 3 bảng DB, dependency tree (§54.8) |
| DoD remaining | slice J: 8 emitter + 2 parser core còn in văn bản FFmpeg; slice K: archive docs + parity đóng gói |
| Regression | **Có, đã sửa**: `extractFrame` rò slot (§54.6) — suite bắt, sửa bằng batch leg, không nới assertion |
| User data impact | **Không**: 3 bảng xoá thuần không DROP/DELETE; project/schema v3 giữ nguyên; backup còn nguyên |
| Next slice | J (re-express emitter/parser core), phụ thuộc I đã xong |

**Doc guards chạy cuối (gate 5):** đo lại trên chính cây tài liệu cuối (sau §54 + note ADR), chạy riêng từng cái bằng
`tsx --tsconfig tsconfig.test.json`: `tmcut_doc_table_shape` **3/3 exit 0**; `tmcut_docs_link_integrity` **4/4 exit 0**;
`tmcut_doc_line_length` **4/4 exit 0**; `tmcut_doc_citations` **5/5 exit 0**; `tmcut_doc_charset` **3/3 exit 0**;
`docs_markdown` **12 checks exit 0**. Không guard nào fail trên prose mới.

### 54.10 Chưa chứng minh / blocker gom một lần

- **Gate 4 authed surfaces**: bốn route `/tmcut/*` cần session đăng nhập; tôi không cầm credentials (ràng buộc buộc phải
  tránh). Nút snapshot HUD (§54.6) và console sweep năm route trên editor mount thật **chưa render live** — chỉ `/login`
  quét sạch. Cần chủ repo sign-in để đóng (cùng dòng mở của ADR-033 §47.6).
- **Slice J còn nợ**: core vẫn in văn bản FFmpeg qua `buildFfmpegFitFilters`/`buildFfmpegTransform`/`buildFfmpegEffectFilters`,
  preset colorbalance, header `blend.mjs`, `buildProxyArgs` của `cache.mjs`, `probe.mjs`, `crashRecovery.mjs`. Đây là
  **syntax** trong core, không spawn, không binary — engine runtime đã cắt hết. Slice J re-express chúng thành semantics.
- **Production build**: shell này không chạy `electron-builder` ra app đóng gói; parity bản asar thuộc slice K.
- **Backup**: `backup/ffmpeg-engine-2026-11-03/` (76 file, 0 exe) giữ untracked theo Q8; xoá hay không là quyết định riêng
  của chủ repo sau parity, không nằm trong chỉ thị "xóa exe".

## 55. Slice J — core thôi phát ngôn FFmpeg: 8 emitter + 2 parser nghỉ hưu (đo ngày 2026-11-08)

Slice I cắt engine khỏi runtime. Slice J trả nốt phần còn lại: **cú pháp** FFmpeg mà core vẫn xuất ra như
API công khai. Sau lượt này, `packages/core/src` không còn hàm nào sinh chuỗi filter, chuỗi argv hay đọc
output của một binary không tồn tại. Cái còn lại là **semantics** — số, hình học, thời gian — mà cả
monitor lẫn exporter đọc chung.

### 55.1 Mười hai phát ngôn bị gỡ, và thứ sống thay chúng

| # | Hàm đã gỡ | Module | Bản sống thay thế | Test |
|---|---|---|---|---|
| 1 | `buildFfmpegEffectFilters` + `lut3dChain` | `effects.mjs` | `lutGrade(preset)` trả **ops semantics** (`balance`/`eq`/`curves`/`desaturate`/`sepia`/`grain`); `cssFromGrade` ở `app/utils/tmcut/fxPreview.ts` dựng CSS từ đúng ops đó | `effects.test.mjs` (16) |
| 2 | `buildFfmpegFitFilters` | `canvas.mjs` | `computeFitObjectStyle` + `resolveClipLayout` (một hình học, hai người đọc) | `canvas.test.mjs`, `still-image.test.mjs` |
| 3 | `buildFfmpegTransform` | `canvas.mjs` | `reframeTransform` | `canvas.test.mjs` |
| 4 | `buildBackgroundSource` + `stillImageInputFlags` | `canvas.mjs` | `exportContent.mjs` + `encodeCanvasFill`; painter đọc plan, không đọc chuỗi | `export-canvas-fill.test.mjs` |
| 5 | `maskAlphaExpr` | `mask.mjs` | `normalizeMask` + `maskCssMaskImage` (SVG alpha mask) | `mask.test.mjs` |
| 6 | `keyframeExpr` | `keyframes.mjs` | `evalKeyframe` (evaluate-at-tick) | `keyframes.test.mjs` |
| 7 | `rampSetptsExpr` | `retime.mjs` | `rampTimelineToSource` / `rampElapsedForConsumed` / `rampIntegral` | `retime.test.mjs` |
| 8 | `volumeExpr` + `panFilter` | `audio.mjs` | `gainAt` (+ `fadeDuration`, `isTrackMuted`) | `audio.test.mjs` (4) |
| 9 | `buildVidstabDetectArgs` + `buildVidstabTransformArgs` | `stabilize.mjs` **xoá** | không có thay thế: tính năng khai tử; exporter từ chối clip `stabilize` theo tên | `stabilize.test.mjs` **xoá** |
| 10 | `buildProxyArgs` | `cache.mjs` | `cacheKeyForPath` / `cachePathFor` (danh tính cache, không phải argv) | `assets-probe-cache.test.mjs` (10) |
| 11 | `normalizeProbe` + `parseFrameRate` | `probe.mjs` **xoá** | `buildMediaInfo` / `buildFrameRate` ở `mediaInfo.mjs` (schema rộng hơn ffprobe) | `media-info.test.mjs` |
| 12 | `parseSceneOutput` + `parseSilenceOutput` | `analysis.mjs` | `sceneCuts` / `sceneScore` / `silenceSpans` / `cutsToShots` ở `detection.mjs` | `analysis.test.mjs`, `scene-silence-detection.test.mjs` |

Hai file bị xoá (`stabilize.mjs`, `probe.mjs`) và hai file test chỉ chứa luật đã chết
(`stabilize.test.mjs`, `scene-shot-law.test.mjs`). Mười một file test còn lại được **tách assertion**,
không xoá: phần số học sống giữ nguyên, phần chuỗi FFmpeg chết bị bỏ — đúng chỉ thị của chủ repo.

Cùng lượt, `crashRecovery.runHealthChecks` thôi dò một binary không còn (`{name:'ffmpeg'}`) và báo
`webcodecs` — engine duy nhất còn lại. Test mới khoá cả hai chiều: `'ffmpeg'` **không** được xuất hiện,
`'webcodecs'` **phải** xuất hiện (RED trước, xanh sau, assertion không đổi).

### 55.2 Một tuyên bố phải đổi nghĩa, không phải đổi cờ

`renderReady` trong `EFFECT_REGISTRY` từng được đọc như "file export nung được effect này". Sau slice J
điều đó **không còn đúng**: `planEncodeContent` từ chối clip có effect theo tên, nên không effect nào đi
tới file hôm nay. Giữ nguyên cờ mà đổi cách đọc là cách một bảng nói dối. Vì vậy `renderReady` được định
nghĩa lại thành **độ đầy đủ của definition** (params + preview + grade ops), và chỗ quyết định export
vẫn là `planEncodeContent` — hai câu hỏi khác nhau, hai câu trả lời khác nhau, cùng đọc từ một registry.

Phần này **không** đóng bằng code: badge `exportSupported` trên UI vẫn đang nói "export được" cho những
effect mà exporter từ chối. Đó là blocker §55.6, không phải một dòng đã sửa.

### 55.3 Bảng gate (đo trên chính cây sẽ commit)

| Gate | Lệnh | Kết quả | Bằng chứng |
|---|---|---|---|
| Core build | `pnpm build:core` | PASS | exit 0, dist regenerate |
| 1 Types | `npx nuxt typecheck` | PASS | exit 0, **0** × `error TS`; `.nuxt/eslint.config.mjs` regenerate 26.290 byte |
| 2 Lint | `npx eslint <11 file app chạm>` (sau gate 1) | PASS | exit 0, 0 problem |
| 2b Lint core | `npx eslint packages/core/src/{crashRecovery,transitions,htmlVideo,audio}.mjs` | PASS ở dòng chạm | 10 error trong `crashRecovery.mjs` là **nợ có sẵn**: HEAD cũng 10, không thêm cái nào |
| 3 Core types | `pnpm typecheck:core` | PASS | exit 0 |
| 4 Boundaries | `pnpm check:core` | PASS | `core imports nothing platform-specific` |
| 5 Core tests | `pnpm test:core` | PASS | **906/906**, exit 0 |
| 6 Unit suite | `npx tsx tests/unit/run-all.mts` | PASS | **124/124** specs, exit 0 |
| 7 Live | 5 route trên `:4003` | PASS | cả 5 route **200**; console **0** `[error]`/`[warn]`/`[issue]` — chỉ `[debug]` vite ×2 và `[info] <Suspense>` mỗi route |
| 8 Doc guards | 6 guard chạy riêng từng cái | PASS | xem §55.5 |

### 55.4 Điều test cũ không bắt được, và cái đã thay nó

Ba thứ có thể hỏng mà suite cũ mù:

- **`lutGrade` lệch khỏi `cssFromGrade`.** Nếu hai bên cùng trôi, không assertion nào thấy. Chốt: check
  2 của `tmcut_fx_exact.spec.ts` giải `t` từ **cả bộ** hệ số sepia trên 8 giá trị intensity, nên CSS phải
  là **một** hàm của `t`; ops của `lutGrade` là nguồn duy nhất.
- **Một chuỗi FFmpeg lọt lại.** `retime.mjs` từng có một body mồ côi sau khi splice (bắt bằng
  `node --check`, exit 1), và `analysis.mjs` còn comment nhắc `cutsToShots`. Cả hai đã sửa; `node --check`
  trên mọi file core là bước chạy lại được.
- **Một citation trỏ vào section không tồn tại.** `audit §55` trong comment là dạng chết im lặng — doc
  chưa có §55 khi comment viết. Guard `tmcut_doc_citations` bắt đúng hai chỗ; sửa bằng cách trỏ vào
  `docs/audit/zero-ffmpeg-audit.md` theo tên, không bằng cách thêm family giả.

Danh sách link chết sau khi xoá module: **9 anchor** trong chính tài liệu này (`canvas#L286`,
`keyframes#L155`, `cache#L52`, `audio#L114`, `effects#L809`, `effects#L661`, `effects.test#L255`,
`probe.mjs`, `stabilize.mjs`, `scene-shot-law.test.mjs`) và 2 anchor trong roadmap V4. Tất cả đã được
repoint vào dòng còn sống hoặc đổi thành tên file không kèm `#L`, và `tmcut_docs_link_integrity` xác nhận.

### 55.5 Doc guards (chạy sau cùng, trên cây đã sửa)

| Guard | Kết quả |
|---|---|
| `tmcut_docs_link_integrity` | **4/4** exit 0 |
| `tmcut_doc_citations` | **5/5** exit 0 |
| `tmcut_doc_table_shape` | **3/3** exit 0 |
| `tmcut_doc_line_length` | **4/4** exit 0 |
| `tmcut_doc_charset` | **3/3** exit 0 |
| `docs_markdown` | **12** check exit 0 |

### 55.6 Chưa chứng minh / blocker (gom một lần)

- **Gate 4 đo được, nhưng hẹp hơn slice I giả định.** Dev server cũ trên `:4003` kẹt ở "Starting Nuxt…"
  (503 trên cả năm route) vì `.nuxt` vừa bị typecheck regenerate; sau khi restart, cả năm route trả **200**
  và console **0** `[error]`/`[warn]`/`[issue]`. Điều **chưa** đo: nội dung authed bên trong editor (mount
  thật của player, export modal) — vẫn cần session, như slice I §54.10. Sweep này chứng minh route và
  console của trang, không chứng minh hành vi sau khi đăng nhập.
- **Badge `exportSupported` nói quá** — `fxCapabilities` lấy `exportSupported = renderReady`, tức một
  effect đầy đủ definition được badge là export được, trong khi `planEncodeContent` từ chối **mọi** clip
  có effect. Đây là quyết định sản phẩm (đổi badge, đổi cột, hay đổi exporter), không phải một dòng sửa.
- **Pan của track audio không có đường sống** — `panFilter` đã nghỉ hưu và mixer Web Audio chưa áp pan.
  Trường `pan` vẫn nằm trong project schema; hiện nó là dữ liệu im lặng.
- **Backup `backup/ffmpeg-engine-2026-11-03/`** (76 file, **0 exe**) vẫn giữ untracked. Chỉ thị "xoá hết
  phần exe" đã thoả (repo: **0** `.exe` tracked, 0 trong working tree); việc xoá hay giữ thư mục backup
  là quyết định riêng của chủ repo.
- **Electron đóng gói** — không lượt nào trong J chạy `electron-builder`; parity bản asar thuộc slice K.

## 56. Slice K — bề mặt phát hành: mười chỗ engine có thể quay lại, và hai guard mới (đo ngày 2026-11-08)

Slice J đóng phần cú pháp trong core. Slice K hỏi câu khác: **cái gì có thể mang engine trở lại mà không
chạm vào một dòng code nào trong `app/`?** Câu trả lời là sáu bề mặt — manifest, lockfile, tệp đóng gói,
cầu IPC, route server, và CI — cộng ba bề mặt đã có guard từ trước (binary, spawn, process census).

### 56.1 Đo trên cây sau slice J

| Bề mặt | Lệnh đo | Kết quả |
|---|---|---|
| Dependency | `grep -ciE "ffmpeg\|ffprobe" package.json pnpm-lock.yaml` | **0** / **0** |
| Script build | nghĩa chuỗi `scripts` của `package.json` | **0** khớp |
| Binary tracked | `git ls-files '*.exe'` | **0** |
| Binary working tree | `find . -name '*.exe'` trừ `node_modules`/`.output` | **0** |
| `resources/` | `ls resources` | `fontmanager.node`, `tmcut-catalog` — không có media binary |
| Đóng gói | `extraResources` trong `electron-builder.yml` | `yt-dlp.exe`, `**/*.json`, `**/*.node`, `tmcut-catalog/**` |
| IPC | `ipcMain.handle(` trong `electron/main.cjs` | **24** handler, **0** kênh media |
| `child_process` | `grep -rln child_process electron server shared` | **3** file: `main.cjs` (spawn MCP server), `dev-electron-launcher.cjs` (spawn dev), `paths.cjs` (execFile **version probe** của yt-dlp) |
| `execFile` | `grep -n "execFile(" electron/tools/paths.cjs` | **1** call, gate `if (type !== 'ytDlp') return resolve(false)` đứng trước |
| Route server | `walk('server/api')` | không route nào import `child_process` hay nhắc tên đã nghỉ hưu |
| CI | `ls .github` | **không có** thư mục workflow |
| Tên còn lại trong code | `grep -rnE "ffmpeg\|ffprobe" app server shared electron scripts` | **43 file**, tất cả là comment/prose giải thích lịch sử — không một call site nào |

Con số cuối là chỗ dễ tự lừa nhất: "43 file nhắc tới" nghe như engine chưa đi. Đọc từng dòng thì mỗi dòng
là một câu *kể lại* việc nó đã đi (`ffprobe leg went with the binary`, `retired with ffmpeg (slice I)`).
Xoá chúng đi mới là làm mất lịch sử; để nguyên mới là trung thực. Vì vậy guard dưới đây không grep từ khoá
trên toàn cây — nó đọc đúng **sáu artefact** mà một dependency hay một file đóng gói đi qua.

### 56.2 Hai guard mới, và cái RED đầu tiên đã bắt được gì

`tests/unit/tmcut_release_surface.spec.ts` — **8 check**, đọc artefact chứ không đọc source:

1. `package.json` + `pnpm-lock.yaml` không khớp tên đã nghỉ hưu;
2. nghĩa chuỗi `scripts` trong manifest cũng không;
3. `git ls-files '*.exe'` rỗng;
4. `electron-builder.yml` sau khi **bỏ comment** không khai báo tên đã nghỉ hưu, và danh sách
   `extraResources` chỉ được chứa đúng **một** `.exe` (`yt-dlp.exe`) — danh sách này nhỏ nên pin được;
5. **24** handler IPC không có kênh nào là media;
6. `paths.cjs` chỉ có **một** `execFile`, đối số là `filePath`, và gate `type !== 'ytDlp'` còn nguyên;
7. mọi file dưới `server/api` không import process API, không `spawn`, không nhắc tên đã nghỉ hưu;
8. mọi file dưới `.github` (nếu có) cùng luật đó.

RED đầu tiên **không** phải một false positive: check 4 fail vì `electron-builder.yml` còn câu comment
*"AutoCut ffmpeg argv — once both callers…"*. Đó là lịch sử đúng, nên sửa chỗ **đọc**: config phải được
đánh giá theo nghĩa (bỏ comment) chứ không theo ký tự. Sau khi bỏ comment, check xanh — và một mutation
chứng minh nó vẫn cắn: thêm `fluent-ffmpeg` vào `devDependencies` → check 1 **FAIL**, `package.json`
phục hồi byte-identical (md5 khớp trước/sau).

### 56.3 Capability matrix: parity phải đếm theo từng khoá

Brief K mục 6 đòi parity theo *capability matrix*, không phải vài boolean tiêu biểu.
`tests/unit/tmcut_platform_adapter.spec.ts` có thêm check "both hosts answer the full capability matrix,
key by key":

| Capability | web | electron | Vì sao |
|---|---|---|---|
| `filesystem` | false | **true** | desktop đọc file qua `media://local`; tab không có đường đó |
| `largeFileAccess` | false | **true** | cùng lý do, ở mức kích thước |
| `webCodecs` | true | true | encoder duy nhất còn lại, chạy in-process trên cả hai |
| `webGPU` | false | false | chưa có consumer nào |
| `hardwareEncoding` | false | false | runtime tự chọn backend; app không còn bộ chọn profile |
| `backgroundRender` | false | false | không còn hàng đợi render nào |
| `cloudRender` | false | false | timeline export không rời tab |

Ba vế được pin, mỗi vế một lỗi thật: (a) tập khoá của guard == `PLATFORM_CAPABILITIES` của core — lệch
một khoá là FAIL; (b) từng giá trị của từng host; (c) năm khoá **không thuộc** đường đọc file phải trả
lời **giống nhau** trên hai host, vì một khả năng chỉ có ở một host là một pipeline thứ hai. Mutation:
xoá dòng `webGPU` khỏi bảng → FAIL `a capability key exists in one place and not the other`; lật
`web.cloudRender` → FAIL ở spot-check trước đó (đúng thứ tự — spot-check canh giá trị, matrix canh
tập khoá). Cả hai mutation đã revert, file khớp md5.

### 56.4 Bảng gate

| Gate | Lệnh | Kết quả | Bằng chứng |
|---|---|---|---|
| Build core | `pnpm build:core` | PASS | exit 0 |
| 1 Types | `npx nuxt typecheck` | PASS | exit 0, **0** × `error TS` |
| 2 Lint | `npx eslint <file chạm>` sau gate 1 | PASS | 0 problem |
| 3 Core types | `pnpm typecheck:core` | PASS | exit 0 |
| 4 Boundaries | `pnpm check:core` | PASS | core không import gì platform-specific |
| 5 Core tests | `pnpm test:core` | PASS | **906/906** |
| 6 Unit suite | `npx tsx tests/unit/run-all.mts` | PASS | **125/125** (thêm `tmcut_release_surface`) |
| 7 Live | 5 route trên `:4003` | PASS | 200 ×5, console 0 `[error]`/`[warn]`/`[issue]` |
| 8 Doc guards | 6 guard | PASS | xem §56.5 |

### 56.5 Doc guards

| Guard | Kết quả |
|---|---|
| `tmcut_docs_link_integrity` | **4/4** exit 0 |
| `tmcut_doc_citations` | **5/5** exit 0 |
| `tmcut_doc_table_shape` | **3/3** exit 0 |
| `tmcut_doc_line_length` | **4/4** exit 0 |
| `tmcut_doc_charset` | **3/3** exit 0 |
| `docs_markdown` | **12** check exit 0 |

### 56.6 Còn mở trong slice K

Brief K còn ba mục chưa đóng, và không mục nào là "code đã xong, chỉ thiếu tick":

- **Mục 1–3 (fixture + so sánh frame cũ/mới)**: bốn fixture container thật đã có
  (`tests/fixtures/containers/`), và `tmcut_real_containers.spec.ts` đọc chúng qua demuxer thật. Nhưng
  phép so **pixel giữa engine cũ và engine mới** thì không chạy được nữa: binary đã xoá ở slice I, nên
  không còn bên "cũ" để render. Bằng chứng parity hiện có là §53.11 (WebCodecs vs FFmpeg đo **trước**
  khi xoá) — một con số lịch sử, không phải một gate chạy lại được.
- **Mục 8 (docs consolidation/archive)**: bộ V4 roadmap vẫn nằm nguyên trong `docs/`; mục 4 §10 của ADR
  register đã quyết định archive cả bộ ở slice K. Việc này chạm nhiều file tài liệu của **chủ repo**
  (`docs/video-editor-stack.md`, `docs/design/`), nên nó cần một lượt riêng chứ không gộp vào đây.
- **Mục 9 phần "release artifacts"**: `npx nuxt build` xong (exit 0, 54.2 s, output 25 MB).
  `npx electron-builder --dir --win` chạy lại sau khi owner bật Developer Mode vẫn **fail** — không phải
  vì cấu hình project mà vì quyền symlink của tiến trình. Bằng chứng đo được: registry
  `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock` **không tồn tại** (giá trị
  `AllowDevelopmentWithoutDevLicense` rỗng), `mklink /D` trả "You do not have sufficient privilege", và
  token hiện tại không có `SeCreateSymbolicLinkPrivilege` (`whoami /priv` không liệt kê). UAC đang bật
  (`EnableLUA=1`), Defender bật real-time nhưng **không** phải nguyên nhân: lỗi là `EPERM` ở syscall
  `symlink`, do `@electron/asar` 3.4.1 (`lib/disk.js:212-217`) ném ra đúng nhánh đó khi hệ thống từ chối
  tạo symlink. Không có file lock nào can thiệp — asar ghi bình thường tới bước symlink.
  Dù build dừng, `release/win-unpacked/resources/app.asar` **đã ghi xong** (363 090 003 byte, 30 829
  entry) nên đây là bằng chứng **output**, không phải input: `asar.listPackage` cho kết quả 62 file
  `packages/core/src/*.mjs`, **không** có `probe.mjs`/`stabilize.mjs`, **0** tên chứa `ffmpeg`/
  `ffprobe`, và `.exe` duy nhất là ba `esbuild.exe` của build tooling trong `node_modules`. File
  `ffmpeg.dll` nằm ở gốc `win-unpacked` (không trong asar) và byte-identical
  (md5 `aa60b6cbd14cf6e670090ff8a7680008`) với `node_modules/electron/dist/ffmpeg.dll` — thư viện
  Chromium của Electron, không phải engine đã nghỉ hưu ở slice I.
  Hai lần thử (trước và sau Developer Mode) đều **BLOCKED**; CI Linux vẫn có thể chạy như kiểm thử bổ
  sung nhưng không thay thế được gói Windows thật. `release/` bị gitignore nên các số đo này không đi
  theo commit.

## 57. Slice L — hai capability, hai chủ (2026-11-08)

Sáu blocker mở ở §55.6/§56.6 đã có quyết định của chủ repo. Ba trong số đó là **code** và đã đóng; ba
còn lại là quyết định giữ nguyên hoặc giới hạn được ghi lại chứ không phải việc phải làm.

### 57.1 Badge effect không còn nói quá

`fxCapabilities` từng trả một boolean `exportSupported` lấy từ `renderReady` — cờ **độ đầy đủ định
nghĩa** (registry có params + preview descriptor + grade ops). Cờ đó trả lời "preview có mặt để sơn
không", không trả lời "file có nung effect này không", nhưng tên `exportSupported` khiến badge đọc nó
như câu thứ hai. Kết quả: mọi effect hiện "xuất được" trong khi `planEncodeContent` từ chối **mọi**
clip mang effect.

Tách thành hai câu, hai chủ:

| Câu hỏi | Chủ | Giá trị hôm nay |
|---|---|---|
| Preview sơn được effect này? | `fxCapabilities().previewReady` (registry) | true cho cả 29 |
| File nung được effect này? | `exportBakesEffect(type)` (`exportContent.mjs`) | false cho cả 29 |

`exportBakesEffect` đọc một `Set` rỗng có chủ đích: painter hiện chỉ `drawImage` tấm plate đã decode.
Khi một leg painter học nung một effect, effect đó vào Set **trong đúng commit** chuyển luôn lời từ chối
`'effects'` — test `a refused effect is named, once per type` và `the exporter answers export support
itself` giữ hai vế khớp nhau.

Badge của `TmcutFxThumb` đổi copy từ "Not in export" (chỉ hiện khi định nghĩa thiếu) sang **"Preview
only — not exportable yet"** (hiện cho mọi effect exporter từ chối, `urgent: true` nên luôn hiện, không
chờ hover). Một trạng thái `previewReady: false` mới hiện "No preview for this item".

### 57.2 Export nói tên thứ chặn nó

`planEncodeContent` trả thêm `blockedEffects`: tên từng loại effect đứng giữa project và file, sắp xếp
và khử trùng (hai clip cùng `blur` → một tên), **rỗng** khi `effects` không nằm trong `reasons`. Nhờ vậy
`TmcutExportModal` in được `Effects the file cannot bake: Blur, Vignette` trước khi người dùng bấm render,
thay vì để họ tự dò từng clip sau khi thất bại.

Banner cũ ở vị trí đó — *"{n} transition(s) will be blended … using xfade & acrossfade"* — đã **gỡ**.
Nó hứa hai emitter mà slice I đã xoá, trên đúng loại project mà painter từ chối (`'transition'` cũng nằm
trong `ENCODE_REFUSAL_REASONS`). Copy `transitionsTitle`/`transitionsDesc` gỡ khỏi cả hai locale.

### 57.3 Pan: control đi, dữ liệu ở lại

Mixer Web Audio không có panner, và filter `pan` của FFmpeg đã nghỉ hưu ở slice J. Vậy control Pan trên
hàng track audio chỉ sửa một con số không có đường nào đọc — đúng loại control mà chính comment trong
`TmcutExportModal.vue` gọi là "worse than no control".

| Thứ | Hành động | Lý do |
|---|---|---|
| Input Pan trên timeline | **Gỡ** | playback/export không áp dụng giá trị |
| `pan?: number` trong schema v3 | **Giữ** | project cũ chứa nó; xoá field là phá dữ liệu |
| `updateTrackPan` trong store | **Giữ** | dữ liệu cũ còn đường đi; test pin sự tồn tại |
| `pan ≠ 0` khi mở project | **Cảnh báo** (`i-lucide-triangle-alert` + `tmcut.tracks.panNotApplied`) | nói thật thay vì im lặng |
| Reset `pan` về 0 | **Không** | đó là xoá việc của người dùng |

Pan trở lại UI khi có một leg stereo thật trong mixer, kèm test playback/mix/export — không phải việc
của slice này.

### 57.4 Gate

| Gate | Lệnh | Kết quả | Bằng chứng |
|---|---|---|---|
| Build core | `pnpm build:core` | PASS | exit 0 |
| 1 Types | `npx nuxt typecheck` | PASS | exit 0, **0** × `error TS` |
| 2 Lint | `npx eslint <6 file chạm>` sau gate 1 | PASS | exit 0, 0 problem |
| 3 Core types | `pnpm typecheck:core` | PASS | exit 0 |
| 4 Boundaries | `pnpm check:core` | PASS | exit 0 |
| 5 Core tests | `pnpm test:core` | PASS | **909/909** (thêm 2 test slice L) |
| 6 Unit suite | `npx tsx tests/unit/run-all.mts` | PASS | **126/126** (thêm `tmcut_capability_honesty`) |
| 7 Build | `npx nuxt build` | PASS | exit 0, 54.2 s, 25 MB |
| 8 Live | 5 route trên `:4003` | **PARTIAL** | 200 ×5; console 0 `[warn]`/`[issue]`, nhưng `/tmcut/editor`, `/tmcut/templates`, `/tmcut/factory` có `[error] 401 error.invalidToken` từ `/api/v1/ai/relay/catalog` |
| 9 Package | `npx electron-builder --dir --win` | **BLOCKED** | xem §56.6 mục 9: quyền symlink, asar vẫn ghi xong |

Gate 8 ghi **PARTIAL**, không PASS: tôi không biến một 401 thành "sạch" chỉ vì nó giải thích được. Nguyên
nhân đã đo, không suy đoán — `curl` vào `/api/v1/ai/relay/catalog` trả `401 error.tokenMissing`
("Missing authorization token"), và browser context của lần quét này **không có** khoá token nào trong
`localStorage` (đếm tên khoá, không đọc giá trị). Đây là điều kiện môi trường đã biết từ trước slice này,
không phải hồi quy do thay đổi capability: ba route ấy gọi catalog AI khi mount, mà không có phiên thì
relay từ chối đúng như thiết kế. Cái đo được là **thay đổi của slice L sống trên DOM thật**: ở
`/tmcut/editor`, `[id^="track-volume-"]` đếm được **1**, `[id^="track-pan-"]` đếm được **0**, và chrome
của editor (Timeline/Preview) render bình thường. `/tmcut` và `/tmcut/autocut` sạch hoàn toàn ngoài noise
`<Suspense>`.

Hai spec cũ đã **đổi assertion** vì hợp đồng đổi có chủ đích, không phải để test xanh:
`tmcut_fx_preview.spec.ts` (dòng `exportSupported` → `previewReady`/`exportReady`) và
`tmcut_component_hygiene.spec.ts` (khẳng định control Pan tồn tại → khẳng định nó **không** tồn tại, kèm
con trỏ sang spec mới giữ vế dữ liệu).

### 57.5 Parity pixel: bằng chứng lịch sử, không phải gate chạy lại

- **Historical parity evidence**: có, ở §53.11 (WebCodecs vs FFmpeg đo **trước** khi xoá binary).
- **Reproducible old/new pixel comparison**: **không có** — engine cũ đã xoá ở slice I, không dựng lại
  theo quyết định của chủ repo.
- **Exact pixel parity**: **chưa được kiểm độc lập.** Con số §53.11 là một lần đo trong điều kiện của
  nó, không phải một bất biến mà suite hôm nay tái lập được.
- **Current engine regression/visual tests**: chạy theo kết quả thực tế ở §57.4 — 909 core spec + 126
  unit spec đều xanh, nhưng chúng kiểm **luật** (hình học plate, grid frame, mix packet), không kiểm
  từng pixel của một file render thật.

## 58. Báo cáo cuối Zero-FFmpeg A–K (đo lại ngày 2026-11-08)

§57 đóng slice L. Mục này không mở slice mới: nó đo lại **toàn bộ** chương trình trên cây hiện tại và nói
rõ ba loại sự thật khác nhau — cái **đã ship và đã đo**, cái là **giới hạn sản phẩm** (chủ ý, không phải
thiếu sót), và cái **còn mở** vì chưa có bằng chứng hoặc vì chờ chủ repo quyết. Mọi con số dưới đây lấy
từ lượt chạy hôm nay trên `HEAD 7ec21e4`, không phải từ trí nhớ của phiên trước.

### 58.1 Thang gate trên cây được đo

| Gate | Lệnh | Kết quả | Bằng chứng |
|---|---|---|---|
| Build core | `pnpm build:core` | PASS | exit 0 |
| 1 Types | `npx nuxt typecheck` | PASS | exit 0, **0** × `error TS`; `.nuxt/eslint.config.mjs` sinh lại 26 290 byte lúc 19:41 |
| 2 Lint | `npx eslint` trên 7 file của slice L, chạy **sau** gate 1 | PASS | exit 0, 0 problem |
| 3 Core types | `pnpm typecheck:core` | PASS | exit 0 |
| 4 Boundaries | `pnpm check:core` | PASS | exit 0 |
| 5 Core tests | `pnpm test:core` | PASS | **909/909**, 135 suite |
| 6 Unit suite | `npx tsx tests/unit/run-all.mts` | PASS | **126/126** spec, exit 0 |
| 7 Electron | `pnpm test:electron` | PASS | **59/59**, 13 suite |
| 8 Build | `npx nuxt build` | PASS | exit 0, 52,1 s, `.output` **25 MB** (9,8 MB gzip), 32 MB trên đĩa |
| 9 Doc guards | 6 guard chạy riêng | PASS | xem §58.1.1 |
| 10 Live | 5 route trên `:4003` | **PARTIAL** | xem §58.1.2 |
| 11 Package | `npx electron-builder --dir --win` | **BLOCKED** | xem §58.1.3 |

#### 58.1.1 Sáu doc guard, chạy sau khi văn bản cuối đã viết

| Guard | Kết quả |
|---|---|
| `tmcut_doc_table_shape` | exit 0 |
| `tmcut_docs_link_integrity` | exit 0 |
| `tmcut_doc_line_length` | exit 0 (trần 1356, bảng được miễn) |
| `tmcut_doc_citations` | exit 0 |
| `tmcut_doc_charset` | exit 0 |
| `docs_markdown` | 12/12 check, exit 0 |

#### 58.1.2 Live sweep: 4 sạch, 1 có lỗi môi trường

| Route | Console `[error]`/`[warn]`/`[issue]` |
|---|---|
| `/tmcut` | **0** |
| `/tmcut/autocut` | **0** |
| `/tmcut/editor` | 1 dòng: `401 error.invalidToken` từ `/api/v1/ai/relay/catalog`, lặp 4 lần |
| `/tmcut/templates` | 1 dòng `401 error.invalidToken`, lặp 2 lần |
| `/tmcut/factory` | 1 dòng `401 error.invalidToken`, 1 lần |

Ba route ấy gọi catalog AI lúc mount, và browser context của lượt quét **không có phiên hub** — đây là điều
kiện môi trường đã biết từ trước slice L, không phải hồi quy. Gate ghi **PARTIAL** chứ không PASS, vì không
biến một 401 thành "sạch" chỉ vì nó giải thích được.

Phần **thay đổi của slice L đo được trên DOM thật** ở `/tmcut/editor`: `[id^="track-volume-"]` = **1**,
`[id^="track-pan-"]` = **0**, và mở modal Export in ra đúng ba câu:

```text
This project cannot be exported yet
This export cannot bake clip effects — remove them
Effects the file cannot bake: Vignette
```

Đó là slice L tự chứng minh trên trình duyệt thật: badge/copy capability đã đổi, control pan đã đi, và
export **nói tên** thứ chặn nó thay vì render một video sai.

#### 58.1.3 Package: vẫn BLOCKED, và lý do không đổi sau khi đo lại

Đo lại hôm nay: `reg query` trên `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock` trả
`EXIT=1` với "Invalid syntax" (khoá không tồn tại), và `whoami /priv` **không** liệt kê
`SeCreateSymbolicLinkPrivilege`. Nghĩa là Developer Mode **chưa được bật trên máy này**, nên lần thử của
chủ repo chưa xảy ra — không phải nó đã chạy và vẫn hỏng.

Nguyên nhân đã đo ở §56.6 mục 9 và không thay đổi: `@electron/asar` 3.4.1 ném `EPERM` ở syscall `symlink`
(`lib/disk.js:212-217`), không phải file lock, không phải antivirus; `app.asar` (363 090 003 byte, 30 829
entry) **vẫn ghi xong** trước bước symlink, nên đó là bằng chứng output chứ không phải input. Gói Windows
thật vì thế chưa có; CI Linux vẫn chỉ là kiểm thử bổ sung.

### 58.2 DoD §25 — 25 mục, đo từng mục

| # | Mục | Kết quả | Bằng chứng đo hôm nay |
|---|---|---|---|
| 1 | Không FFmpeg/FFprobe trong dependency tree | **PASS** | `grep` trên `package.json` + `pnpm-lock.yaml`: **0** hit |
| 2 | Không binary trong repo/build | **PASS** | `git ls-files "*.exe"` = **0**; `.output` sau build: **0** `.exe`, **0** tên chứa ffmpeg/ffprobe |
| 3 | Không spawn/exec media | **PASS** | 3 file import `child_process`: MCP server, dev launcher, và `execFile` của yt-dlp `--version` — không cái nào xử lý media |
| 4 | Không FFmpeg IPC/config/env | **PASS** | `main.cjs`/`preload.cjs`/`media-protocol.cjs`/`ipcPolicy.cjs`: **0** hit; không biến môi trường nào còn đọc |
| 5 | Không docs hướng dẫn cài FFmpeg | **PARTIAL** | tài liệu zero-FFmpeg chỉ nói lệnh cấm; `docs/video-editor-stack.md` (chủ repo) còn lệnh cài `@ffmpeg/ffmpeg` |
| 6 | Không FFmpeg/FFmpeg.wasm fallback | **PASS** | 0 hit `@ffmpeg`/`ffmpeg.wasm` trong code, dep và build |
| 7 | Probe bằng MediaProbeService | **PASS** | slice B, dùng trên cả hai host |
| 8 | Unknown metadata biểu diễn đúng | **PASS** | `mediaInfo.mjs` phát `DURATION_UNKNOWN`, `VIDEO_NOT_DECODABLE`, `frame-rate-unknown` thay vì đoán |
| 9 | Capability detection | **PASS** | `PLATFORM_CAPABILITIES` + matrix spec §56.3, 7 khoá, đếm theo từng khoá |
| 10 | Compatibility tests | **PASS** | `tmcut_real_containers.spec.ts`, 7 check trên 4 fixture thật (mp4/mkv/mov/webm) |
| 11 | Thumbnail/preview/transform không cần FFmpeg | **PASS** | `CanvasSink` trong `frameDecode.ts`; không binary nào trong đường này |
| 12 | WebCodecs encode khi supported | **PASS** | export MVP chạy thật, file mp4 §52.5 |
| 13 | JavaScript muxer | **PASS** | mediabunny `Mp4OutputFormat` |
| 14 | Deterministic frame timing | **PASS** | `createFrameScheduler`, grid đếm theo `canvas.fps` |
| 15 | Audio/video sync | **PASS** | §52.5: offset **0,000 ms**, dung sai đo được 22,68 µs |
| 16 | Backpressure | **PASS** | `planEncodeQueue` + `inFlight`; writer await `add()` |
| 17 | Cancel/cleanup | **PASS** | abort trước/sau khi chạy, `dispose()` trong `finally`, reader+mixer đóng mọi nhánh |
| 18 | MediaRecorder không phải offline export chính | **PASS** | chỉ còn ở `useTmcutRecorder` (thu micro), không ở đường export |
| 19 | Unsupported codec báo rõ | **PASS** | `runtime-refused` mang câu của chính capability, không thay bằng chữ chung |
| 20 | Web hoạt động không cần native media tool | **PASS** | build web exit 0, 25 MB, không binary media |
| 21 | Electron dùng chung engine | **PASS** | desktop đọc `packages/core/src` (ADR-022), matrix parity §56.3 |
| 22 | Project trao đổi được trong phạm vi capability | **PASS (có phạm vi)** | schema v3 khoá bằng guard; phạm vi = project không effect/transition/text/mask/blend/rotation, và phần ngoài phạm vi được **gọi tên** chứ không bị bỏ im |
| 23 | Unit/integration/visual tests pass | **PASS** | 909 core + 126 unit + 59 electron + 6 doc guard, tất cả exit 0 |
| 24 | Large-file/memory tests | **ĐÃ ĐO (§59.5)** | 4 lượt trên Electron 44.10.0: 720p/30 s, 1080p/60 s, 1080p/45 s đủ 6 chặng, và **file 1 GiB** (1080p/286,8 s, 30 Mbps). Decode 240/240 frame ở 61–88 fps, heap phẳng 22–30 MB, RSS đỉnh 389/451/523/**602** MB, huỷ giữa encode +1 MB, OPFS 64 MB ghi/đọc/xoá về 0. File 1 GiB ghi thẳng ra đĩa nên RSS đứng ~380 MB suốt 115 s encode |
| 25 | Browser compatibility report | **ĐÃ CÓ (§59.6)** | một trang 32 phép thử, bốn runtime: Chrome 156 **32/32**, Edge 157 **32/32**, Electron 44.10.0 **32/32**, Firefox 159 **30/32** (thiếu encode AAC và WebGPU adapter) |

Hai mục 24 và 25 là **chưa**, không phải "đã xong". Không có phép đo nào bị đổi tên để chúng thành xanh.

### 58.3 Ba loại sự thật

**Đã ship và có bằng chứng chạy:** engine thay thế hoàn chỉnh cho import → probe → thumbnail → preview
composite → audio mix → encode → mux → download, không binary, không spawn media, chạy cùng một core ở web
và Electron. 187 commit, trong đó 67 commit thuộc chương trình này.

**Giới hạn sản phẩm (chủ ý, đã ghi tên trong code và UI):**

| Giới hạn | Vì sao | Người dùng thấy gì |
|---|---|---|
| Effect chưa được nung vào file | painter chỉ `drawImage` tấm plate; quyết định 4 của chủ repo: **không mở rộng exporter lượt này** | banner "This project cannot be exported yet" + tên effect; badge "Preview only — not exportable yet" |
| Transition chưa export | hai plate cross-fade là một compositor | `transition` nằm trong danh sách từ chối, có câu giải thích |
| Text overlay chưa export | lớp chữ vẽ bằng DOM, canvas painter chưa có bản sao | `text` nằm trong danh sách từ chối |
| Mask / blend / rotation / reverse / stabilize / stacked rows | chưa có twin đo được trên canvas | mỗi cái một lý do có tên, cùng một câu giải thích |
| Pan | mixer Web Audio không có panner | control **đã gỡ**; project có `pan ≠ 0` hiện cảnh báo, **không** reset |
| Stabilization | không có tương đương WebCodecs/Web Audio | tính năng đã khai tử khi cắt engine, ghi ở ADR-028 |

**Còn mở vì thiếu bằng chứng, không phải vì thiếu code:** gate package Windows (§58.1.3), DoD 24 và 25,
parity pixel tái lập được (§57.5), và báo cáo live sạch trên ba route cần phiên hub.

### 58.4 Sáu quyết định của chủ repo — thi hành tới đâu

| # | Quyết định | Trạng thái |
|---|---|---|
| 1 | Giữ `backup/ffmpeg-engine-2026-11-03/` | **Giữ nguyên, không xoá, không di chuyển.** Nhưng xem §58.5 mục A: thư mục này **đang được track** trong git |
| 2 | Thử lại packaging sau khi bật Developer Mode | **Chưa thử lại được** — Developer Mode vẫn tắt (§58.1.3). Không đổi `asar=false`, không sửa config để né lỗi |
| 3 | V4 docs: chưa di chuyển | **Giữ nguyên vị trí**; register §10 mục 4 đã ghi `DEFERRED / OWNER APPROVAL REQUIRED` |
| 4 | Badge xuống "Preview only", tách hai capability, export nói tên effect | **Xong ở slice L** và đo được trên DOM thật (§58.1.2) |
| 5 | Ẩn pan, giữ dữ liệu, cảnh báo khi `pan ≠ 0` | **Xong ở slice L**; spec giữ cả vế "field còn" và vế "input không còn" |
| 6 | Chấp nhận bằng chứng parity lịch sử §53.11 | **Đã ghi đúng** ở §57.5, kèm câu "chưa kiểm độc lập" |

### 58.5 Còn chờ chủ repo quyết (danh sách gộp, một lượt)

**A. `backup/` đang được track, khác với giả định của quyết định 1.** `git ls-files backup/` trả **76**
file; chúng vào repo ở commit `36e4c0a` ngày 2026-11-05, trước khi có quyết định giữ-untracked. Không có
`.gitignore` nào phủ thư mục này. Tôi **không** tự `git rm --cached` (đó là thao tác khó đảo và chạm lịch
sử). Cần một trong hai: (a) chấp nhận nó là lịch sử đã commit, hoặc (b) cho phép gỡ khỏi index bằng
`git rm -r --cached backup/` + thêm một dòng `.gitignore`.

**B. `docs/video-editor-stack.md` vẫn dạy cài `@ffmpeg/ffmpeg`.** Tài liệu thuộc quyền chủ repo, nên theo
quyết định 3 tôi để nguyên. Đây là chỗ duy nhất khiến DoD 5 còn `PARTIAL`. Sửa hay giữ là quyết định của
chủ repo.

**C. Developer Mode chưa bật.** Không có gì để sửa trong repo cho tới khi máy có
`SeCreateSymbolicLinkPrivilege`; sau đó chỉ cần chạy lại `npx electron-builder --dir --win` với cấu hình
asar hiện tại.

**D. Có làm exporter nung effect không, và theo thứ tự nào.** Quyết định 4 chốt **không** mở rộng lượt này,
nên slice L dừng ở việc nói thật. Nếu mở lại, thứ tự rẻ nhất trước: nhóm effect chỉ là một chuỗi filter
trên plate (blur/sharpen/negate/sepia/mono/vivid…) → nhóm cần overlay (vignette/letterbox/grain) → nhóm cần
compositor phụ (chromatic/afterimage). Mỗi effect chuyển khỏi danh sách từ chối **trong cùng commit** với
leg painter và test preview/export của nó.

**E. DoD 24 và 25.** Cần quyết định có làm hay không: một phép đo file lớn (ví dụ 1 GB) với trần bộ nhớ,
và một báo cáo tương thích trình duyệt dạng artifact (Chromium web đã đo; Electron 44.10.0 chưa).

## 59. Bảy quyết định của chủ repo, thi hành và đo lại (2026-11-09)

Mục này thay thế §58.5 bằng trạng thái thật sau khi chủ repo trả lời cả bảy mục. Mỗi mục ghi đúng việc đã
làm, bằng chứng lấy từ lần chạy trên máy này, và phần còn hở.

### 59.1 Quyết định 1 — `backup/ffmpeg-engine-2026-11-03/` bỏ tracking, giữ file và lịch sử

`git rm -r --cached -- backup/ffmpeg-engine-2026-11-03/` ở commit `d57be97`; `.gitignore` có mục
`backup/` kèm lý do. Kiểm lại sau commit:

| Kiểm | Kết quả |
|---|---|
| `git ls-files backup/` | 0 file (đã untrack) |
| File vật lý còn trên đĩa | **76** file, không đổi byte (MD5 trước/sau trùng, `backup-before.md5` = `backup-after.md5` = 7632 byte) |
| Lịch sử | commit `36e4c0a` còn nguyên; không `reset`, không `clean`, không filter-branch |
| File bị di chuyển hay sửa | không có |

### 59.2 Quyết định 2 — đóng gói Windows: PASS, và lý do cũ không phải lý do thật

Lần đo trước (§58.1.3) nói Developer Mode tắt, `@electron/asar` ném `EPERM` ở syscall `symlink`. Đo lại
hôm nay: Developer Mode **đã bật** nên bước asar qua được, và lỗi còn lại nằm ở chỗ khác —
`tm-studio-0.1.0-setup.exe` (bước NSIS tự chạy chính nó để nhả uninstaller) trả mã 2.

Chuỗi phép đo tách được nguyên nhân, và **không phải** cấu hình project:

| Phép đo | Kết quả |
|---|---|
| File NSIS tự viết 37 515 byte (không liên quan repo) chạy từ `%TEMP%` trên C: | exit 0 sau 260 ms, marker ghi được |
| Cùng file đó chép vào `D:\Applications\tm-tools` rồi chạy | exit 0 sau 254 ms |
| Cùng file đó chép vào `D:\Applications\tm-studio` (bất kỳ thư mục con) | treo, không chạy `.onInit`, bị kill sau 60 s |
| `tm-tools-1.0.0-setup.exe` (bản build thật, đã cài được) chép sang `tm-studio` | cùng hành vi treo |
| `icacls` trên thư mục | `tm-tools` = `Medium Mandatory Level`; `tm-studio` = `Low Mandatory Level` |
| `icacls` trên chính các `.exe` | `tm-tools` exe = Medium; `tm-studio` exe = Low |

Kết luận: `D:\Applications` mang nhãn integrity **Low** (`Everyone:(CI)(DENY)(S,DC)` cộng
`Mandatory Label\Low Mandatory Level`), nên mọi file mới dưới `tm-studio` thừa kế Low. Một NSIS installer
không chạy được ở Low integrity — nó treo trước cả `.onInit`. Đây là thuộc tính của ổ đĩa/thư mục, không
phải của `electron-builder.yml`, không phải antivirus (`Get-MpThreatDetection` không có bản ghi nào khớp,
ASR rules rỗng, Controlled Folder Access = 0), và không phải file lock.

Cách xử lý đã dùng, tối thiểu và đảo được: nâng nhãn của riêng thư mục đầu ra lên Medium
(`icacls release /setintegritylevel "(OI)(CI)M"`), rồi build lại. Không đổi `asar`, không thêm
`asar: false`, không sửa `files`/`extraResources` để né lỗi.

Bằng chứng sau khi nâng nhãn:

| Kiểm | Kết quả |
|---|---|
| `npx electron-builder --win nsis` | **exit 0** (`PKG_EXIT=0` trong `pkg-final2.txt`) |
| Artifact | `tm-studio-0.1.0-setup.exe` **219 173 763 byte** + `.blockmap` 224 769 byte (bản cũ chỉ 602 876 byte vì thiếu khối dữ liệu) |
| `app.asar` | 30 829 entry; có `packages/core/src/index.mjs`, `shared/`, `electron/main.cjs`, `.output/server`; **0** entry khớp mẫu `ffmpeg` hoặc `ffprobe` |
| `extraResources` | `resources/resources/` có `fontmanager.node` và `tmcut-catalog/` (không có `yt-dlp.exe` vì file không tồn tại trên đĩa máy này) |
| Cài silent vào thư mục tạm | exit 0 sau 20,6 s, 871 MB, có `TMCut Studio.exe` và `Uninstall TMCut Studio.exe` |
| Khởi chạy bản đã cài | chạy được, giữ tiến trình (đo bằng `Get-Process` sau 12 s) |

Điều này **chưa** chứng minh: cài trên máy sạch, ký số (không có certificate), tự cập nhật, và ổ đĩa
không mang nhãn Low. Ba mục đó ghi ở §59.8.

### 59.3 Quyết định 3 — `docs/video-editor-stack.md` sửa tại chỗ

Commit `a6ab42f`, 96 dòng đổi, **không** archive/đổi tên/di chuyển. §1 viết lại thành stack chính thức
2026-11-08: TMCut không có FFmpeg/FFprobe/FFmpeg.wasm/wrapper/binary media nào (ADR-028), không fallback;
một Media Engine dùng chung Browser + Electron; bảng lớp = `tmcut-core` / `mediabunny` / WebCodecs /
Web Audio / Canvas 2D + WebGL2 (+ WebGPU khi có) / OPFS-IndexedDB. Mục `@ffmpeg/ffmpeg` đổi thành
"ĐÃ NGHỈ HƯU" và **không còn dòng cài đặt**. §6 ghi rõ combo JSON là ứng viên cho prototype mới, không
mô tả repo này.

Sáu doc guard chạy lại sau khi viết xong, tất cả exit 0 (log `stack-*.txt`):
`tmcut_doc_table_shape`, `tmcut_docs_link_integrity`, `tmcut_doc_line_length` (trần 1356, bảng được miễn),
`tmcut_doc_citations`, `tmcut_doc_charset`, `docs_markdown` (12/12).

### 59.4 Quyết định 4 — effect vẫn chỉ ở preview, exporter không mở

Không đổi phạm vi A–K, không thêm painter cho effect nào. Trạng thái giữ nguyên như slice L:
`exportBakesEffect(type)` trả `false` cho mọi type đang có, `planEncodeContent` trả `reasons` chứa
`effects` và `blockedEffects` nêu đúng tên từng type, badge đọc **Preview Only** (không dùng
`exportSupported`), và modal liệt kê effect bị chặn. Spec
`packages/core/test/export-content-eligibility.test.mjs` giữ cả vế "từ chối" và vế "nêu tên".

Mở rộng exporter thành roadmap riêng, chia theo nhóm effect, mỗi nhóm cần so sánh pixel preview/export
trước khi chuyển khỏi danh sách từ chối. Thứ tự nhóm **chưa** chốt — đúng như quyết định 4.

### 59.5 DoD 24 — file lớn và bộ nhớ: đã đo, bằng số thật

Thiết bị: `Windows 10.0.19045`, x64, Xeon E5-2680 v4, 28 logical core, RAM hệ thống 64 GB
(`deviceMemory` trình duyệt báo 32 GB). Runtime đo: **chính Electron của app** (Electron 44.10.0 /
Chromium 152.0.7977.169 / Node 24.22.1 / V8 15.2.124.45-electron.0). Mỗi lượt sinh file bằng đúng đường
đóng gói của sản phẩm (`VideoSample` → `VideoEncoder` qua mediabunny `VideoSampleSource` +
`Mp4OutputFormat`), rồi probe, decode bằng `CanvasSink`, huỷ giữa encode, và đo lại.

| Lượt | File | Encode | Probe | Decode 240 frame | Heap (đầu → cuối) | RSS đỉnh tiến trình |
|---|---|---|---|---|---|---|
| 720p/30 s | 3 MB | 5,25 s (5,7× realtime) | 21 ms | 240/240, **86,6 fps**, 2,77 s | 14 → 15 MB | **389 MB** |
| 1080p/60 s | 10 MB | 19,15 s (3,1×) | 37 ms | 240/240, **61,1 fps**, 3,93 s | 28 → 29 MB | **451 MB** |
| 1080p/45 s (đủ 6 chặng) | 7 MB | 14,65 s (3,1×) | 39 ms | 240/240, **61,6 fps**, 3,89 s | 22 → 23 MB | **523 MB** |
| **1080p/286,8 s (file 1 GiB)** | **1026,5 MB** | 115,80 s (2,48×) | **29 ms** | 240/240, **86,2 fps**, 2,79 s | 3,1 → 17,4 MB | **602 MB** |

Chi tiết từng chặng của lượt đủ:

| Chặng | Số đo |
|---|---|
| Encode video | 45 s / 30 fps, 7 MB ra, queue encoder đỉnh 0 chunk, heap đỉnh 10 MB |
| Probe | MP4, 44,967 s, 1920×1080, `avc`, 39 ms |
| Decode bền | 240/240 frame; heap 22 → 23 MB qua 4 mốc (0 s / 11,1 s / 22,2 s / 33,4 s) — **không tăng theo thời gian** |
| Huỷ giữa encode | 90 frame đã đẩy, `output.cancel()`, heap 23 → 24 MB (+1 MB), không rò rỉ giữ canvas |
| Audio (đường sản phẩm) | `OfflineAudioContext` render 20 s trong 46 ms; `AudioEncoder` 938 chunk / 288 KB trong 217 ms; `allocationSize` lớn nhất **8 192 byte** mỗi `AudioData`; heap sau chặng 39 MB |
| WebGL2 churn | 200 texture + 200 framebuffer tạo/xoá, heap **39 → 39 MB** (không đổi), `gl.getError()` = 0 trước `loseContext()` |
| OPFS | ghi 64 MB trong 155 ms, đọc lại đúng kích thước, xoá xong `usage` về **0 MB**; quota 151 572 MB |
| Backpressure | queue encoder đỉnh 0 chunk ở cả ba lượt (producer chờ `source.add`, không dồn) |

Lượt thứ tư nhắm đúng chỗ ba lượt đầu bỏ trống — **file 1 GiB**. File được sinh bằng chính đường đóng gói của
sản phẩm nhưng ghi thẳng ra đĩa qua `StreamTarget` → OPFS (`file.createWritable()`), nên 1 GiB không bao giờ
nằm trong RAM; sau đó đọc lại bằng `handle.getFile()` và probe/decode qua đúng `BlobSource` mà file người dùng
chọn đi qua.

| Chặng của file 1 GiB | Số đo |
|---|---|
| Sinh file | 8 604 frame, 1 076 338 175 byte (**1026,5 MB**), 115,80 s encode, 2,48× realtime |
| RSS suốt encode | **377–383 MB** đứng yên từ giây thứ 5 đến giây 116 (24 mốc) — **không tăng theo số byte đã ghi** |
| Probe | MP4, 286,767 s, 1920×1080, `avc`, bitrate trung bình **30,3 Mbps**, `canDecode=true`, **29 ms** |
| Decode 240 frame **từ giữa file** (giây 143,4) | 240/240, **86,2 fps**, 2,79 s; heap 29,1 → 24,8 MB (đỉnh 35,9 MB) |
| Seek rải rác 30 mốc khắp file | 30/30 canvas, 6,36 s |
| RSS đỉnh cả lượt | **602 MB** (chạm ở lúc finalize + decode), tiến trình lớn nhất 310 MB |
| OPFS sau khi xoá | `usage` về **0 MB**; quota 153 220 MB |
| Heap | 3,1 MB lúc bắt đầu → 17,4 MB sau finalize → 24,8 MB sau decode |

Trần thật đọc được từ số đo: decode 1080p giữ **~1 frame/canvas pool** (heap phẳng 22–30 MB ở mọi độ dài
file), nên chi phí decode không phụ thuộc độ dài file; cái tăng theo file là bộ nhớ của **Blob nguồn** và
RSS của tiến trình renderer (389 → 523 → 602 MB khi thêm phân giải, chặng audio/WebGL/OPFS, và file 1 GiB).

**Không** đặt ngưỡng PASS tuỳ ý: bốn lượt này là mốc đo, không phải hạn mức. Giới hạn của phép đo 1 GiB:
file do trang đo sinh ra (nội dung nhiễu tổng hợp ở 30 Mbps), ghi vào OPFS trên **cùng ổ** — chưa đo file
1 GiB nằm trên ổ mạng/ổ ngoài, và chưa đo khi RAM hệ thống bị ép (máy này 64 GB).

### 59.6 DoD 25 — tương thích trình duyệt: bốn runtime, đo bằng cùng một trang

Cùng một trang đo (32 phép thử: WebCodecs decode/encode, codec, VideoFrame, OffscreenCanvas, WebGL2,
WebGPU, Web Audio, OPFS, IndexedDB, quota, demux 4 container thật, mux MP4 + WebM, làn tải file), chạy
trong bốn môi trường:

| Runtime | Phiên bản | Kết quả | Cụ thể |
|---|---|---|---|
| Chrome | 156.0.0.0 trên Windows 10 | **32/32 Supported** | WebGL2 "OpenGL ES 3.0 Chromium", max texture 16384; WebGPU có adapter; demux MP4/MKV/MOV/WebM đều `canDecode=true`; mux MP4 1 775 B, WebM 1 430 B |
| Edge | 157.0.0.0 (`157.0.4341.42`) trên Windows 10 | **32/32 Supported** | giống Chrome ở mọi dòng, mux MP4 1 775 B, WebM 1 430 B |
| **Electron của app** | 44.10.0 (Chromium 152.0.7977.169) | **32/32 Supported** | đủ codec decode+encode kể cả audio `mp4a.40.2` và `opus`; mux MP4 1 775 B, WebM 1 430 B; quota 152 478 MB |
| Firefox | 159.0.1 trên Windows 10 | **30/32 Supported, 2 Unsupported** | thiếu **encode audio AAC (`mp4a.40.2`)**, và **WebGPU không có adapter**; mọi dòng còn lại OK, kể cả demux 4 container và mux MP4/WebM |

Ghi chú đo:

- Electron lần đầu báo 3 dòng storage `Unsupported` — đó là do profile Electron mặc định đang bị khoá
  (`Access is denied` trên quota DB trong log). Chạy lại với `--user-data-dir` riêng thì 32/32. Con số
  trong bảng là lần chạy sạch; lần hỏng là bằng chứng về môi trường, không phải về sản phẩm.
- Edge phải chạy lại một lần với GPU bật mới đủ 32/32; lần đầu thiếu WebGL2 ở chế độ headless.
- **Chrome headless không dùng được cho phép đo nặng**: cùng trang DoD 24, headless Chrome 156 treo ở
  chặng encode (không qua `heap_start_mb` trong 120 s), trong khi Electron 44 chạy xong cùng trang. Đó là
  giới hạn của headless, ghi lại để lần sau không đoán.
- **Firefox**: 2 dòng `Unsupported` là thật và có tên. Nếu Firefox vào phạm vi sản phẩm thì export phải
  hoặc chọn codec audio khác (Opus) hoặc báo `Partially Supported` cho file có audio AAC; WebGPU chỉ là
  đường tăng tốc tuỳ chọn nên không chặn.

### 59.7 Ba trạng thái giữ nguyên như chủ repo yêu cầu

| Trạng thái | Cách ghi trong tài liệu này |
|---|---|
| 3/5 route live trả `401 error.invalidToken` (không có phiên TM Hub) | **PARTIAL**, không phải hồi quy. Đo lại khi có phiên hợp lệ. |
| `ffmpeg.dll` cùng MD5 với bản Electron phân phối | Là thư viện Chromium của Electron, **không** xoá, **không** gọi là engine cũ. |
| §53.11 parity pixel lịch sử | **Giữ nguyên tính lịch sử**, không tuyên bố tái lập được. |

### 59.8 Còn mở vì thiếu bằng chứng, không vì thiếu code

1. **File 1 GiB — đã đo, còn hai biến thể chưa đo.** §59.5 có số cho file 1 GiB do trang đo sinh ra và ghi
   vào OPFS trên cùng ổ. Chưa đo: file 1 GiB nằm trên ổ mạng/ổ ngoài (đường đọc khác `BlobSource`), và chạy
   khi RAM hệ thống bị ép (máy này 64 GB nên chưa chạm trần).
2. **Cài trên máy sạch và ký số.** Bản cài đã chạy trên máy này; chưa thử máy không có Developer Mode,
   chưa có certificate nên installer không được ký, và tự cập nhật chưa kiểm.
3. **Nhãn integrity của ổ đĩa.** Máy này có `D:\Applications` ở Low integrity; đó là lý do phải nâng nhãn
   thư mục `release/` mới build được. Máy khác không có vấn đề này thì không cần bước đó. Ghi lại để lần
   sau không nhầm là lỗi project.
4. **Firefox trong phạm vi sản phẩm hay không.** Báo cáo đã có số; quyết định hỗ trợ Firefox và cách xử
   lý audio AAC là của chủ repo.
5. **Ba route cần phiên hub** vẫn PARTIAL như §59.7.

## 60. Build script đầy đủ và hai cảnh báo build (2026-11-09)

### 60.1 Bộ script build

`package.json` có thêm bốn lệnh, port từ `tm-tools`:

| Lệnh | Việc làm |
|---|---|
| `pnpm build:electron` | `pnpm build` rồi `electron-builder --config electron-builder.yml --publish never` |
| `pnpm build:electron:win` | Như trên, thêm `--win` → NSIS installer trong `release/` |
| `pnpm build:electron:dir` | Như trên, thêm `--dir` → app chưa đóng gói trong `release/win-unpacked` |
| `pnpm check:hygiene` | Fail nếu có `.js` nằm cạnh `.ts` nguồn trong `app/`, `server/`, `shared/` |

`--publish never` là bắt buộc, không phải phòng xa: `electron-builder.yml` khai một repo GitHub, và chính
sách mặc định của electron-builder 26 là `onTagOrDraft` — chạy trên một tag sẽ tạo release thật.

`tests/unit/tmcut_build_scripts.spec.ts` giữ 13 điều kiện, gồm cả thứ tự (Nuxt build phải chạy trước
electron-builder). Spec đã đỏ trước khi thêm script và đỏ lần nữa khi đảo thứ tự.

### 60.2 Cảnh báo `Gradient has outdated direction syntax`

Nguyên nhân không phải CSS viết sai. `lightningcss@1.32.0` (minifier của Nuxt) rút gọn
`ellipse 58% 50% at 50% 50%` thành `58% 50%` vì cả `ellipse` lẫn `at 50% 50%` đều là mặc định CSS; sau đó
`autoprefixer@10.6.2` đọc `radial-gradient(58% 50%, …)` như cú pháp tiền-2012 `0 0, closest-side` và cảnh báo.

Đã đo bốn cách chữa, chỉ một cách đúng:

| Cách | Kết quả |
|---|---|
| Viết thêm `ellipse` | Minifier bỏ lại lần nữa → vẫn cảnh báo |
| `circle 58% 50%` | Hết cảnh báo nhưng khai báo sai (`CSS.supports` = false) |
| `/* autoprefixer: ignore next */` | lightningcss xoá comment trong chế độ minify |
| Radii trong custom property | Hết cảnh báo, `CSS.supports` = true |

Chọn cách cuối: `.tm-streak` đọc `--tm-lens-radius: 58% 50%`, vì minifier không hằng-hoá được `var()`.
Giá trị tính toán trong Chromium vẫn là `radial-gradient(58% 50%, rgb(0,0,0) 0%, rgba(0,0,0,0) 76%)` —
đúng byte-for-byte như trước, nên hình không đổi.

### 60.3 Cảnh báo `fs/promises externalized`

Cảnh báo này là thật và nó che một lỗi chẩn đoán. `runHealthChecks()` gọi `fs.stat` trên module rỗng do
bundler externalise, phép gọi ném lỗi, và bảng Support trong Settings hiện `disk-access: fail` đỏ trên
mọi phiên browser/Electron khoẻ mạnh.

Hai thay đổi: trạng thái "không có filesystem" là `warn` kèm lý do (chỉ stat ném lỗi mới là `fail`), và
builtin được lấy qua `process.getBuiltinModule('fs/promises')` — Node 22.3+ trả module thật, renderer trả
`undefined`, bundler không còn gì để externalise. Bundle client chỉ còn chuỗi `fs/promises` làm đối số.

### 60.4 Kết quả đo

| Cổng | Lệnh | Kết quả |
|---|---|---|
| Types | `npx nuxt typecheck` | exit 0, 0 × `error TS`; config ESLint regenerated |
| Lint | `npx eslint` trên 4 file đã sửa | exit 0 cho spec/script; 9 lỗi còn lại trong `crashRecovery.mjs` là có sẵn trên dòng không sửa (HEAD có 10) |
| Core | `node --test packages/core/test/*.test.mjs` | 910/910 |
| Unit | `npx tsx tests/unit/run-all.mts` | 128/128, gồm 6 doc guard |
| Electron | `node --test electron/tools/*.test.mjs` | 59/59 |
| Build web | `pnpm build` | exit 0, **0 cảnh báo** (trước đó 3) |
| Đóng gói | `pnpm build:electron:dir` | exit 0, `release/win-unpacked` |
| Asar | liệt kê `app.asar` | 30 828 mục, 516 mục `.output/server`, `\electron\main.cjs` + `\packages\core\src\index.mjs`, **0** mục ffmpeg |
| Hygiene | `pnpm check:hygiene` | exit 0 |
| Boundary | `node packages/core/tools/check-boundaries.mjs` | PASS |
| Live | `/login`, `/tmcut`, `/tmcut/autocut`, `/tmcut/editor`, `/tmcut/templates`, `/tmcut/factory` | chỉ `[info] <Suspense>` và 401 đã biết của §59.7 |

### 60.5 Chưa chứng minh

- Cảnh báo `npm warn Unknown project config "node-linker"` đến từ `npx` (npm đọc `.npmrc` của pnpm), không
  phải từ `pnpm build`: chạy `pnpm build` cho ra 0 dòng notice.
- Chín lỗi lint có sẵn trong `crashRecovery.mjs` (empty `catch`, ba tham chiếu `no-undef`,
  `eol-last`) vẫn còn; chúng nằm ngoài phần đã sửa và không thuộc lượt này.
- 401 trên ba route cần phiên hub vẫn là PARTIAL như §59.7, không phải hồi quy.
- `electron-builder` in cảnh báo phụ thuộc optional nền tảng (oxc/sharp/rollup cho arm64, linux, …). Đó là
  danh sách nền tảng khác, không phải thiếu gói cho win32-x64.

## 61. Support bundle và avatar: hai chỗ báo sai, sửa bằng test (2026-11-09)

Hai lỗi này không lộ ra ở typecheck hay ở bất kỳ suite nào — chúng chỉ hiện khi đọc code và khi nhìn console
của trình duyệt thật.

### 61.1 Support bundle luôn báo rỗng

`generateSupportBundle` viết `typeof getTelemetryEvents === 'function' ? … : []` nhưng chưa bao giờ import
ba hàm đó. Điều kiện `typeof` vì thế **luôn sai**, nên mọi bundle đều nói "0 sự kiện, không có usage" dù
phiên làm việc đã ghi bao nhiêu. Đây đúng là loại lỗi tệ nhất trong một support bundle: không phải trống,
mà là trống một cách trông-có-vẻ-đúng.

Đã import `getTelemetryEvents`, `isTelemetryEnabled` từ `telemetry.mjs` và `getUsageSummary` từ
`usageTracker.mjs`. Hai module đó không import gì nên không tạo vòng lặp.

Test mới ghi 2 sự kiện + 2500 token, rồi đòi bundle trả đúng số đó. Đo trên trình duyệt thật:
`{"telemetryEventCount":2,"telemetryEnabled":true,"aiTokens":2500}`.

### 61.2 Avatar của mọi người dùng là ảnh của người lạ

`UserMenu.vue` đọc `auth.user.value?.avatar`, nhưng `useAuth()` chỉ gán `avatarUrl` (`avatar?` có trong type
nên typecheck vẫn qua). Biểu thức luôn `undefined`, nên **mọi** người dùng đăng nhập đều rơi vào ảnh
hardcode `https://github.com/benjamincanac.png` — avatar GitHub của tác giả Nuxt UI, sót lại từ template.

Hai hệ quả, một trong đó hiện trong console:

1. Ảnh của chính tài khoản không bao giờ hiện.
2. Chromium chặn response cross-origin đó bằng CORB, nên mỗi trang có app shell ghi
   `[issue] Response was blocked by CORB (Cross-Origin Read Blocking)`.

Sửa: đọc `avatarUrl`, không có thì để trống — `UAvatar` tự rơi về chữ cái đầu của tên. Đo lại 5 route:
CORB hết, chỉ còn 401 đã biết; bundle production không còn chuỗi `benjamincanac`.

### 61.3 Kết quả đo

| Cổng | Lệnh | Kết quả |
|---|---|---|
| Types | `npx nuxt typecheck` | exit 0, 0 × `error TS`; config regenerated (12:22:42) |
| Lint | `npx eslint` 4 file | `crashRecovery.mjs` 0 lỗi; `UserMenu.vue` 24 lỗi có sẵn = HEAD (thêm 0); `phase10.test.mjs` 7 lỗi có sẵn = HEAD (thêm 0); spec mới 0 |
| Core | `node --test packages/core/test/*.test.mjs` | 911/911 |
| Unit | `npx tsx tests/unit/run-all.mts` | 129/129 |
| Electron | `node --test electron/tools/*.test.mjs` | 59/59 |
| Build | `pnpm build` | exit 0, 0 cảnh báo |
| Live | 5 route | CORB 0, chỉ `[info] <Suspense>` + 401 của §59.7 |
| Bundle | grep `benjamincanac` trong `.output/public` | 0 |

### 61.4 Chưa chứng minh

- Chưa đăng nhập được bằng tài khoản thật (không dùng credential hub), nên "avatar của tài khoản hiện ra"
  chỉ chứng minh được bằng code + test, không bằng ảnh chụp có ảnh thật.
- Lỗi lint có sẵn trong `UserMenu.vue` (24) và `phase10.test.mjs` (7) vẫn còn. Chúng nhiều hơn một lần sửa
  gọn, và nằm ngoài phạm vi hai lỗi này; sửa cả file là một lượt định dạng riêng.

