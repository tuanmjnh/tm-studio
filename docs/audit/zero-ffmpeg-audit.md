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
  autocut page, MCP bridge ([app/composables/useMcpRendererBridge.ts:173](file:///D:/Applications/tm-studio/app/composables/useMcpRendererBridge.ts#L173)
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

Hai site burn-in: [electron/tools/ffmpeg.controller.cjs:422](file:///D:/Applications/tm-studio/electron/tools/ffmpeg.controller.cjs#L422)
và [dòng 723](file:///D:/Applications/tm-studio/electron/tools/ffmpeg.controller.cjs#L723) (một cho render đơn, một cho batch),
cùng dùng filter `subtitles='<path>'` của libass; đầu vào là `config.subtitle` khai ở
[shared/types/electron.ts:224](file:///D:/Applications/tm-studio/shared/types/electron.ts#L224).
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
| Platform Adapter | [packages/core/types/platform.ts:84](file:///D:/Applications/tm-studio/packages/core/types/platform.ts#L84), [platform.mjs](file:///D:/Applications/tm-studio/packages/core/src/platform.mjs) | `TmcutPlatformAdapter {info, media, capture, encoder}` + capability flags — đúng hình §16; `media.probe` ở [dòng 47](file:///D:/Applications/tm-studio/packages/core/types/platform.ts#L47) |
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
| [canvas.mjs:286](file:///D:/Applications/tm-studio/packages/core/src/canvas.mjs#L286) | `buildFfmpegFitFilters`, và `buildFfmpegTransform` (373), `stillImageInputFlags` (45), `buildBackgroundSource` (103) | Fit/crop/rotate vẫn còn `computeFitObjectStyle` cho DOM; background/still input không còn nguồn nào khác |
| [mask.mjs:70](file:///D:/Applications/tm-studio/packages/core/src/mask.mjs#L70) | `maskAlphaExpr` — biểu thức `geq` alpha per-pixel | Luật mask chỉ tồn tại dưới dạng `geq`; phải viết lại thành shader/destination-out |
| [audio.mjs:79](file:///D:/Applications/tm-studio/packages/core/src/audio.mjs#L79) | `volumeExpr` (fade theo `t`), `panFilter` (108) phát filter `stereotools` | Còn `gainAt` (số học) để Web Audio dùng; phần filter string bỏ |
| [keyframes.mjs:155](file:///D:/Applications/tm-studio/packages/core/src/keyframes.mjs#L155) | `keyframeExpr` — FFmpeg math expression cho property theo thời gian | Cần bản "evaluate at tick" cho renderer (interpolation đã có) |
| [retime.mjs:401](file:///D:/Applications/tm-studio/packages/core/src/retime.mjs#L401) | `rampSetptsExpr` — `setpts` cho speed curve phi tuyến | Source-time mapping phải tự tính từ cùng curve — đã có `sourceTicks` trong evaluate |
| [effects.mjs:512](file:///D:/Applications/tm-studio/packages/core/src/effects.mjs#L512) | `buildFfmpegEffectFilters` + `lut3dChain` (782): 20 preset → chuỗi grade | §8 "Color effects cơ bản" cần shader tương ứng |
| [textStyle.mjs:6](file:///D:/Applications/tm-studio/packages/core/src/textStyle.mjs#L6) | Module chỉ giữ **số dùng chung** (borderw/shadow/boxborderw ↔ CSS); chuỗi `drawtext` thật nằm ở engine | Giữ CSS, bỏ `drawtext` — và thấy luôn rằng text không có emitter nào trong core để xóa |
| [transitions.mjs:253](file:///D:/Applications/tm-studio/packages/core/src/transitions.mjs#L253) | `XFADE_POSITION_LAWS` / `XFADE_PREVIEW` — hình học đo từ binary. **Tên spelling FFmpeg không ở đây**: nó sống ở [app/utils/tmcut/fxCatalog.ts:5](file:///D:/Applications/tm-studio/app/utils/tmcut/fxCatalog.ts#L5), bên ngoài core | **Semantics giữ được** (window, progress, vùng), spelling bỏ mà không đụng core |
| [probe.mjs:32](file:///D:/Applications/tm-studio/packages/core/src/probe.mjs#L32) | `normalizeProbe` theo shape JSON của ffprobe | MediaInfo schema §4.1 rộng hơn nhiều → viết contract mới |
| [stabilize.mjs:83](file:///D:/Applications/tm-studio/packages/core/src/stabilize.mjs#L83) | `buildVidstabDetectArgs` / `buildVidstabTransformArgs` (108): argv 2-pass | Không có thay thế → tính năng phải khai tử (xem §10) |
| [cache.mjs:52](file:///D:/Applications/tm-studio/packages/core/src/cache.mjs#L52) | `buildProxyArgs` | Bỏ được, proxy là optional |
| [analysis.mjs:14](file:///D:/Applications/tm-studio/packages/core/src/analysis.mjs#L14) | `parseSceneOutput` / `parseSilenceOutput` (41): parse stderr FFmpeg | Autocut mất đầu vào; cần decoder-side scene/silence |
| [platform.mjs:18](file:///D:/Applications/tm-studio/packages/core/src/platform.mjs#L18) | Capability flag `nativeFFmpeg` | Xóa flag khi engine gone; **đây là flag duy nhất cần giữ lại là `webCodecs`** |
| [crashRecovery.mjs:159](file:///D:/Applications/tm-studio/packages/core/src/crashRecovery.mjs#L159) | Health check `{name:'ffmpeg'}` | Thay bằng check WebCodecs/muxer capability |

Bảng trên chạm **14 module**, nhưng đo kỹ thì FFmpeg sống trong core ở **bốn mức khác nhau**, và chỉ hai mức đầu là việc của slice J:

| Mức | Module | Ý nghĩa với migration |
|---|---|---|
| **Emit văn bản FFmpeg** | `canvas`, `mask`, `audio` (`stereotools` ở [dòng 114](file:///D:/Applications/tm-studio/packages/core/src/audio.mjs#L114)), `keyframes`, `retime`, `effects`, `stabilize`, `cache` — **8 module** | phải viết lại thành instruction cho GPU/canvas/Web Audio. Đây là khối việc thật |
| **Parse output FFmpeg** | `probe` (JSON ffprobe), `analysis` (stderr) — **2 module** | phải đổi sang schema MediaInfo mới; không có "bản dịch" nào khác |
| **Mang tên FFmpeg trong metadata** | `platform` (flag `nativeFFmpeg`), `crashRecovery` (health check `'ffmpeg'`) — **2 module** | xóa tên là xong, không đụng semantics |
| **Chỉ nhắc trong comment** | `textStyle`, `transitions` — **2 module** | **không có gì để gỡ**: `textStyle` chỉ export số dùng chung, còn spelling `xfade=` nằm ở [fxCatalog.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/fxCatalog.ts) phía app. Sửa comment là đủ |

Con số định hình lại slice J: **10** module thật sự phải đổi phát ngôn (8 emit + 2 parse), không phải 14.

### 5.2 Probe web không dám nói sự thật về FPS

[app/utils/tmcut/webProbe.ts:48](file:///D:/Applications/tm-studio/app/utils/tmcut/webProbe.ts#L48) trả `fps: 0`
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
| ADR-006 | [docs/tmcut-v4-universal-rendering-multiplatform-roadmap.md:1503](file:///D:/Applications/tm-studio/docs/tmcut-v4-universal-rendering-multiplatform-roadmap.md#L1503) | "FFmpeg optional backend — giữ khả năng tương thích native khi cần" | **Bị supersede** — rule 1 và 3 không cho tồn tại backend tùy chọn |
| ADR-015 | [docs/v4-phase-0-audit.md:235](file:///D:/Applications/tm-studio/docs/v4-phase-0-audit.md#L235) | "Giữ làm backend 'compat' desktop + server; WebCodecs là backend web mặc định khi đủ codec" | **Bị supersede** — và đây là ADR đã được *áp dụng vào code*, nên xóa FFmpeg mà không ghi lệnh supersede thì lịch sử quyết định sẽ nói code đang sai |

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
  còn [docs/v4-phase-0-audit.md:233](file:///D:/Applications/tm-studio/docs/v4-phase-0-audit.md#L233) mở đầu dãy ADR-013…ADR-027.
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
| G | Web Audio engine: mixer, gain/mute/solo, waveform PCM, volume keyframe | mới trong `app/composables` | gap/overlap/crossfade test; 0 hit `extractAudio` | F |
| H | Export MVP: capability matrix, frame scheduler → `VideoEncoder` → `Mp4OutputFormat` finalize, backpressure, cancel | `packages/core/src/export/*` mới | output play được, A/V sync, 0 spawn | F, G |
| I | **Cut FFmpeg**: xóa `app/utils/tmcut/render/`, `ffmpegHelper.ts`, `ffmpeg.controller.cjs`, 3 route media, namespace IPC, 3 bảng DB, binary, updater — kèm **hai site subtitle burn-in** (§2.4) | 2.2 + 2.3 | DoD §25 pass; witness group A đã chuyển thành behavior test ở H; quyết định 9 đã chốt | H |
| J | Cú pháp FFmpeg trong core: **8 emitter + 2 parser** (§5.1) → semantics + shader/canvas instruction | `canvas/mask/audio/keyframes/retime/effects/stabilize/cache` + `probe/analysis`; `textStyle`/`transitions` chỉ sửa comment | group B vẫn xanh; group A đã thay; **11** file core test phải **tách assertion** (§2.3: + `analysis`, − `platform`/`transitions` thuộc hai mức việc khác), không xóa cả file | I |
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
   ([useTmcutMedia.ts:864-873](file:///D:/Applications/tm-studio/app/composables/useTmcutMedia.ts#L864)), trong khi export cần
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
| Nơi duy nhất đọc `timeline.version` | [packages/core/src/timeline.mjs:344](file:///D:/Applications/tm-studio/packages/core/src/timeline.mjs#L344) — luật của DSL core. Không một dòng `app/` nào đọc nhãn `1` của file app, khớp nguyên văn câu "chỉ là nhãn cũ; **không** phải DSL version" ở [docs/v4-phase-0-audit.md:114](file:///D:/Applications/tm-studio/docs/v4-phase-0-audit.md#L114) |

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
| Thu thập | `app/composables/useTmcutMedia.ts` | `probeAssetInfo` probe file **đã lưu** qua URL; `probePickedFile` probe **bytes** picker vừa đưa, lúc chưa tồn tại URL nào; `applyMediaInfo` ([useTmcutMedia.ts:332](file:///D:/Applications/tm-studio/app/composables/useTmcutMedia.ts#L332)) MediaInfo → meta + fingerprint; `applyVerdict` ([useTmcutMedia.ts:348](file:///D:/Applications/tm-studio/app/composables/useTmcutMedia.ts#L348)) verdict → `importStatus` + `status` + `probedAt` |
| Consumer | `useTmcutMedia.ts` | `analyzeAsset` cả hai nhánh đều đi qua verdict ([useTmcutMedia.ts:354](file:///D:/Applications/tm-studio/app/composables/useTmcutMedia.ts#L354)); `importFiles` xếp hàng **đủ** rồi mới probe từng cái; `importWebFiles` chạy upload và demux **song song** trên cùng một file; `checkMissing` bỏ `fnv1aHex` tự nối, gọi `cacheKeyForPath` và backfill fingerprint |
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

`relink` ([useTmcutMedia.ts:817](file:///D:/Applications/tm-studio/app/composables/useTmcutMedia.ts#L817)) xoá **mọi** thứ probe cũ
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
| [packages/core/src/index.mjs:23](file:///D:/Applications/tm-studio/packages/core/src/index.mjs#L23) + [packages/core/src/index.d.ts:1937](file:///D:/Applications/tm-studio/packages/core/src/index.d.ts#L2063) | luật được export **và** có khối khai kiểu viết tay (tsup chỉ build runtime; `.d.ts` do `scripts/prepare-dist.mjs` sao sang `dist`, và app type-check lấy `dist`) | check "core declares the byte-cache law to the app": năm tên cộng `TmcutByteCachePlan` phải có trong `.d.ts`. Check này **fail trước** khi khối được viết, và `nuxt typecheck` lúc đó báo 4 × TS2305 |
| [app/utils/tmcut/byteStore.ts:90](file:///D:/Applications/tm-studio/app/utils/tmcut/byteStore.ts#L90) | `byteStoreBackend()`: thang OPFS → IndexedDB → `none`, probe memoised; `none` là **một trạng thái**, không phải exception | checks "the store names the backend it actually reached" và "the store off is a state, not an exception" đo cả ba nhánh; "only one module in the app opens a browser byte store" quét **toàn bộ** cây `app/`: đúng **một** file gọi `getDirectory()` (`byteStore.ts`), và `indexedDB` chỉ xuất hiện ở `byteStore.ts` cùng `useSystemStorage.ts` — file sau xoá database chứ không bao giờ cất một byte |
| [app/utils/tmcut/byteStore.ts:129](file:///D:/Applications/tm-studio/app/utils/tmcut/byteStore.ts#L129) | index `tmcut_byte_index_v1` (Map) là **authority** về việc cache đang mang tên những gì — budget đọc từ nó, panel đọc từ nó | check "the storage layer asks core for every decision": mọi quyết định của store đi qua `byteCacheBudgetBytes`/`isByteCacheKey`/`byteCacheFits`/`planByteCacheEviction`, không một ngưỡng nào tự chế trong `app/` |
| [app/utils/tmcut/byteStore.ts:266](file:///D:/Applications/tm-studio/app/utils/tmcut/byteStore.ts#L266) + [:299](file:///D:/Applications/tm-studio/app/utils/tmcut/byteStore.ts#L299) | `putCachedBytes` chỉ nhận key hợp lệ và file vừa ngân sách; `readCachedBytes` **tự lành**: row nói có mà bytes không còn thì quên row, trả `null`. Cả hai không bao giờ throw | checks "a stored revision reads back as the same bytes", "a read the cache cannot serve is forgotten, not trusted", "an unknown or illegal key never reaches the filesystem", "a file bigger than the budget stays uncached" |
| [app/utils/tmcut/byteStore.ts:326](file:///D:/Applications/tm-studio/app/utils/tmcut/byteStore.ts#L326) | `pruneByteCache` đối chiếu **hai chiều** trước khi chạy luật core: row mất bytes → quên; bytes index không gọi tên → xoá; backend không liệt kê được → **không free gì** lượt đó thay vì đoán | checks "the index and the bytes are reconciled both ways" (dựng cả hai phía vết lệch: row ma và file mồ côi) và "over budget, the least recently used revision is the one freed" |
| [app/utils/tmcut/byteStore.ts:364](file:///D:/Applications/tm-studio/app/utils/tmcut/byteStore.ts#L364) + [:377](file:///D:/Applications/tm-studio/app/utils/tmcut/byteStore.ts#L377) | `byteCacheInfo` (backend, available, entries, usedBytes, budgetBytes) cho panel; `clearCachedBytes` trả lại hết — index luôn rỗng kể cả khi backend từ chối xoá, vì index là authority | check "the IndexedDB fallback really stores and really evicts" khép lại bằng `clearCachedBytes()`: **0** key trong backend và **{}** trong index ("the clear control empties the backend / and the index with it"); check "the store off is a state, not an exception" đo `byteCacheInfo` khi không có store (`backend: 'none'`, `available: false`, `entries: 0`, `prune().dropped === 0`) |
| [app/composables/useTmcutMedia.ts:678](file:///D:/Applications/tm-studio/app/composables/useTmcutMedia.ts#L678) + [app/composables/useTmcutRelink.ts:48](file:///D:/Applications/tm-studio/app/composables/useTmcutRelink.ts#L48) | **đúng hai** chỗ ghi: ngay sau `assets.value.unshift(asset)` khi import web, và `if (ok)` sau `const ok = await relink(...)` khi relink thật sự được probe nhận | RED đo được trước khi nối đường ghi: check này (tên lúc đó "the library keeps a copy under the fingerprint it wrote", nay là "an import keeps its own copy of the bytes") fail với `false !== true`; hai check hành vi assert `cachedByteKeys().has(asset.fingerprint)` — và với relink, key được giữ là fingerprint **mới**, không phải của file đã chết |
| [app/composables/useTmcutMedia.ts:103](file:///D:/Applications/tm-studio/app/composables/useTmcutMedia.ts#L103) + [:285](file:///D:/Applications/tm-studio/app/composables/useTmcutMedia.ts#L285) | `liveByteKeys()` = tập fingerprint library đang thực sự gọi tên; `loadLibrary()` nhánh web chạy `pruneByteCache(liveByteKeys())` rồi `refreshByteCache()` | check "bytes the library stopped naming are freed on the next open": import hai asset, `removeAsset` một, `libraryLoaded = false`, `loadLibrary()` → bytes của asset đã xoá **không còn** trong store, asset kia vẫn còn |
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
| [packages/core/src/index.d.ts:339](file:///D:/Applications/tm-studio/packages/core/src/index.d.ts#L339) | khối khai kiểu viết tay cho chín tên mới + hai shape có tên (`TmcutFrameCachePlan`, `TmcutFrameSlotLedger`) — app type-check lấy `index.d.ts`, không lấy runtime | check "core declares the frame-request law to the app" đọc thẳng file `.d.ts`; nó RED trước khi khối được viết (check 1 cũng RED vì `frameRequestMillis` còn `undefined`), nên "export rồi mới khai" không lọt được tới gate 1 |
| [tests/unit/tmcut_frame_cache.spec.ts:53](file:///D:/Applications/tm-studio/tests/unit/tmcut_frame_cache.spec.ts#L53)→[:200](file:///D:/Applications/tm-studio/tests/unit/tmcut_frame_cache.spec.ts#L200) | **11** checks, chạy trong **441 ms**, không cần fixture và không cần trình duyệt: toàn bộ là số học và một lần đọc file | suite **100/100** specs (99 → 100), `TEST_EXIT=0`, `PASS tmcut_frame_cache.spec.ts (441ms) === All 11 frame request checks passed ===` |

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
| [app/pages/tmcut/autocut.vue:351](file:///D:/Applications/tm-studio/app/pages/tmcut/autocut.vue#L351) + [:366](file:///D:/Applications/tm-studio/app/pages/tmcut/autocut.vue#L366) | Lưới thumbnail theo segment đi qua `extractFrames` với slot `thumb:<assetId>#<i>`; service trả **object URL** nên không còn bước "đường dẫn file cache → `mediaUrl`" mà một session web không bao giờ có | cùng check trên assert `autocut.vue` vẫn gọi `mediaUrl` (để phân giải thứ nó được đưa), và `extractFrames` không còn bị chặn sau cờ IPC |
| [app/components/tmcut/TmcutTimeline.vue:687](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutTimeline.vue#L687) + [:886](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutTimeline.vue#L886) | Hai picker "add video" / "add audio" lấy độ dài clip từ `platform.media.probeInfo` — cùng một service hai host — thay vì chân `platform.media.probe` (ffprobe). Không có độ dài trong container thì giữ nguyên fallback cũ (10 s video, 15 s audio), không đoán | check "the desktop pickers size a clip from the demuxer, not the binary leg" trong [tests/unit/tmcut_media_probe.spec.ts:308](file:///D:/Applications/tm-studio/tests/unit/tmcut_media_probe.spec.ts#L308): `platform.media.probe(` **cấm** trong timeline, đúng **2** call-site `probeInfo`, và một walk toàn cây `app/` assert **không** module nào còn gọi chân đó |
| [app/utils/tmcut/mediaProbe.ts:238](file:///D:/Applications/tm-studio/app/utils/tmcut/mediaProbe.ts#L238) + `tests/fixtures/containers/` | Bốn container **thật** (h264.mp4 **4448** B brand `isom`, h264.mov **4395** B brand `qt  `, h264.mkv **4252** B, vp9.webm **2909** B — cùng 64×36, 0.600000 s, 10 fps) được commit, nên một lần demux không còn phụ thuộc vào máy nào sinh ra nó | **9** checks của [tests/unit/tmcut_real_containers.spec.ts:120](file:///D:/Applications/tm-studio/tests/unit/tmcut_real_containers.spec.ts#L120): mỗi file trả đúng container + codec + duration + raster + **1** video track; `.mov` **không** bị gọi là WebM và ngược lại; cùng file đọc qua **ranged HTTP** trả lời y như đọc bytes (`served.stats.partial > 0`) |
| [tests/unit/tmcut_real_containers.spec.ts:156](file:///D:/Applications/tm-studio/tests/unit/tmcut_real_containers.spec.ts#L156) | Node (không WebCodecs) phải nói **thật** những gì nó làm được: demux vẫn đúng, chỉ vẽ frame là không | check đo `hasWebCodecs === false`, `canDecode === false`, `importStatus === 'partial'`, warning `VIDEO_NOT_DECODABLE` **ghi tên codec thật** (`avc`), và bốn warning bịa (`CONTAINER_UNDEMODABLE`, `DIMENSIONS_UNKNOWN`, `DURATION_UNKNOWN`, `SIZE_UNKNOWN`) **không** xuất hiện |
| [tests/unit/tmcut_frame_service.spec.ts:72](file:///D:/Applications/tm-studio/tests/unit/tmcut_frame_service.spec.ts#L72) | Check "both hosts run the same number of decoders" được viết **lại** thành "the app runs one decoder pool, sized by core": D1/D2 so sánh pool của service với semaphore `-ss` private trong `useTmcutFrames.ts`; D3 chuyển leg đó sang service nên giữ phép so sánh cũ là **khoanh dung hai pool** | check giờ walk `app/` và assert danh sách file chứa `MAX_CONCURRENT_FRAMES\|activeFrameJobs` == `[]` — một pool duy nhất là **cấu trúc**, không phải hai con số trùng nhau |
| [tests/unit/tmcut_platform_adapter.spec.ts:216](file:///D:/Applications/tm-studio/tests/unit/tmcut_platform_adapter.spec.ts#L216) | Pin cũ của slice B ("timeline gọi `media.probe`") đã **cũ đi vì luật đổi có chủ đích**, nên sửa **test**, không sửa code: timeline gọi `probeInfo`, và không còn `tempVideo`/`tempAudio` (đo độ dài bằng `<video>`) | `assert.match(timeline, /platform\.media\.probeInfo\(filePath\)/)` + `doesNotMatch(/tempVideo\|tempAudio/)`; lệnh cấm `media.probe` nằm ở `tmcut_media_probe.spec.ts` để một chỗ khai báo một luật |

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
([shared/utils/detection-args.cjs:19](file:///D:/Applications/tm-studio/shared/utils/detection-args.cjs#L19),
[:24](file:///D:/Applications/tm-studio/shared/utils/detection-args.cjs#L24),
[:29](file:///D:/Applications/tm-studio/shared/utils/detection-args.cjs#L29)), còn hình dạng câu trả
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
| [packages/core/src/detection.mjs:147](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L147) | `sceneScore` = mean abs delta trên lưới luma, chia 255, scale 0..1. Con số **0.4** lấy từ `select='gt(scene,X)'` ([:42](file:///D:/Applications/tm-studio/shared/utils/detection-args.cjs#L42)) nhưng **thang thì không chung** — §23 đo trên clip thật: một cut hard cho core **0.2626** còn FFmpeg cho **0.694299**, nên 0.4 hiện **bỏ sót** chính cut mà nó được kế thừa sang. Lưới **không so sánh được** thì trả `null`, không trả `0` | check [:47](file:///D:/Applications/tm-studio/packages/core/test/scene-silence-detection.test.mjs#L47) đo `0` / `1` / `0.5` (nửa số ô đổi hết dải) và tính **đối xứng** `sceneScore(b,a) === sceneScore(a,b)`; check [:61](file:///D:/Applications/tm-studio/packages/core/test/scene-silence-detection.test.mjs#L61) buộc `null` khi độ dài khác nhau, lưới rỗng, hoặc một ô là `NaN` |
| [packages/core/src/detection.mjs:193](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L193) | `cutsToShots`: sắp xếp, bỏ cut ≤ 0 và ≥ duration, chống rung `minGapSec` **0.04**, bỏ shot dưới `minShotSec` **0.2**, đóng đuôi bằng duration — hoặc bằng cut cuối khi **không biết** duration, vì đó là câu trả lời trung thực chứ không phải một con số đoán | **6** assert của check [:68](file:///D:/Applications/tm-studio/packages/core/test/scene-silence-detection.test.mjs#L68): shot liền mạch, input lộn thứ tự == input đã sắp xếp, shot 0.1 s bị bỏ, `3.00` và `3.02` gộp thành **một** cut, `cutsToShots([4], 0) === [{0,4}]`, `cutsToShots([], 8) === [{0,8}]`, `cutsToShots([], 0) === []` |
| [packages/core/src/detection.mjs:217](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L217) + [:227](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L227) + [:256](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L305) | Thang im lặng: `dbfsOf` (RMS → dBFS, sàn −120 thay cho −Infinity), `levelSeries` (một mức cho mỗi cửa sổ, **cả cửa sổ đuôi cụt**, mẫu không phải số thì bỏ qua chứ không tính là im), `silenceSpans` (chuỗi cửa sổ ≤ ngưỡng, giữ khi đủ dài, đóng ở duration). Hình dạng output **giống hệt** reader stderr để không module phía dưới nào phải học shape mới | checks [:93](file:///D:/Applications/tm-studio/packages/core/test/scene-silence-detection.test.mjs#L93) (`dbfsOf(1) === 0`, `dbfsOf(0.5) === -6.02`, sàn cho 0/âm/NaN), [:103](file:///D:/Applications/tm-studio/packages/core/test/scene-silence-detection.test.mjs#L103) (225 mẫu @100 Hz → **5** cửa sổ `[0,0,sàn,sàn,sàn]`, `[]` khi mẫu rỗng hoặc rate 0), [:117](file:///D:/Applications/tm-studio/packages/core/test/scene-silence-detection.test.mjs#L117) (giữ/bỏ theo độ dài, ngưỡng **bao gồm** `<=`, `NaN` **không** im), [:155](file:///D:/Applications/tm-studio/packages/core/test/scene-silence-detection.test.mjs#L155) (vòng round-trip ticks↔seconds mà app dùng) |
| [packages/core/src/analysis.mjs:29](file:///D:/Applications/tm-studio/packages/core/src/analysis.mjs#L29) | `parseSceneOutput` vẫn đọc `pts_time:` nhưng **không còn tự dựng shot list**: nó giao phần đó cho `cutsToShots`. Từ lượt này một cut chỉ có **một** cách biến thành shot, dù nó sinh ra từ stderr hay từ hai khung hình | [packages/core/test/scene-shot-law.test.mjs:16](file:///D:/Applications/tm-studio/packages/core/test/scene-shot-law.test.mjs#L16): cùng những khoảnh khắc, reader stderr và scan-frame trả về **cùng một** shot list |
| [packages/core/src/index.mjs:38](file:///D:/Applications/tm-studio/packages/core/src/index.mjs#L38) + [packages/core/src/index.d.ts:392](file:///D:/Applications/tm-studio/packages/core/src/index.d.ts#L392) | Barrel export + khai báo tay cho **năm** hàm và **năm** hằng số, dùng lại `CoreSceneSegment` ([:169](file:///D:/Applications/tm-studio/packages/core/src/index.d.ts#L169)) và `CoreSilenceRange` ([:174](file:///D:/Applications/tm-studio/packages/core/src/index.d.ts#L174)) thay vì chế type trùng — `parseSceneOutput` và `cutsToShots` trả đúng một shape | `tsc --noEmit -p packages/core/tsconfig.check.json` (strict + `noUnusedLocals`) exit **0**, 0 `error TS`; file declaration tăng **81706 → 83727** byte |

### 22.2 Một luật dùng chung phơi ra một lỗi thật của đường cũ

Check thứ hai của `scene-shot-law.test.mjs` là RED **không chủ định**. Nó đưa cho reader một dòng
`pts_time:12` và một file dài 10 s. Trước E1, vòng dựng shot inline trong `parseSceneOutput` cắt đuôi
bằng cách **đo** `stop - start` chứ không khoá `stop` vào duration, nên kết quả là
`[{ start: 0, end: 12 }]` — một shot **dài hơn chính file**. Sau E1, `[{ start: 0, end: 10 }]`
([:24](file:///D:/Applications/tm-studio/packages/core/test/scene-shot-law.test.mjs#L24)).

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
| [packages/core/src/index.d.ts:410](file:///D:/Applications/tm-studio/packages/core/src/index.d.ts#L410)→[:423](file:///D:/Applications/tm-studio/packages/core/src/index.d.ts#L423) | **Bốn** khai báo mới (`TMCUT_SCENE_GRID_CELLS`, `lumaOf`, `lumaCells`, `sceneCuts`) — `npx tsc --noEmit -p packages/core/tsconfig.check.json` là chỗ duy nhất hợp đồng này được kiểm, vì core là `.mjs` | exit **0**, **0** `error TS` (§23.4 gate 3b) |
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
   đo, và [packages/core/src/index.d.ts:397](file:///D:/Applications/tm-studio/packages/core/src/index.d.ts#L397)
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
| [packages/core/src/index.d.ts:439](file:///D:/Applications/tm-studio/packages/core/src/index.d.ts#L439) + [:445](file:///D:/Applications/tm-studio/packages/core/src/index.d.ts#L445) + [:447](file:///D:/Applications/tm-studio/packages/core/src/index.d.ts#L447) + [:449](file:///D:/Applications/tm-studio/packages/core/src/index.d.ts#L449) | Ba khai báo mới (`loudestLevelSeries`, `pcmHeadTrim`, và `offsetSec` trong options của `silenceSpans`) — `.d.ts` viết tay nên chỉ `tsc -p packages/core/tsconfig.check.json` mới kiểm được | exit **0**, **0** `error TS` (§24.4 gate 3b) |
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
và [index.d.ts:2063](file:///D:/Applications/tm-studio/packages/core/src/index.d.ts#L2063) (khối khai
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
| (a) FFmpeg làm **media work** | **14** call site, trong **8** file — **12** chạy `ffmpeg`, **2** chỉ verify binary | Electron: [tmcut.controller.cjs:194](file:///D:/Applications/tm-studio/electron/tools/tmcut.controller.cjs#L194) `runFfmpeg`, [:511](file:///D:/Applications/tm-studio/electron/tools/tmcut.controller.cjs#L511) `runFfmpegLog`, `ffmpeg.controller.cjs:65`/`:80`/`:90`/`:100` (4 `execSync` probe `nvenc`/`amf`/`qsv`), [task-manager.cjs:208](file:///D:/Applications/tm-studio/electron/tools/task-manager.cjs#L208)/[:284](file:///D:/Applications/tm-studio/electron/tools/task-manager.cjs#L284) `spawn(task.command)`; server: [analyze.post.ts:39](file:///D:/Applications/tm-studio/server/api/v1/media/analyze.post.ts#L39), [proxy.post.ts:109](file:///D:/Applications/tm-studio/server/api/v1/media/proxy.post.ts#L109), [render.post.ts:122](file:///D:/Applications/tm-studio/server/api/v1/media/render.post.ts#L122), [htmlVideoRender.ts:177](file:///D:/Applications/tm-studio/server/utils/htmlVideoRender.ts#L177); verify: `paths.cjs:70`, `ffmpeg.controller.cjs:124` | xoá sau khi H có output hợp lệ; **không** xoá trước |
| (b) **ffprobe-only** | **8** chỗ | [tmcut.controller.cjs:230](file:///D:/Applications/tm-studio/electron/tools/tmcut.controller.cjs#L230) (duration) và [:457](file:///D:/Applications/tm-studio/electron/tools/tmcut.controller.cjs#L457) (JSON), [video-probe.mjs:86](file:///D:/Applications/tm-studio/electron/tools/video-generation/video-probe.mjs#L86), [analyze.post.ts:109](file:///D:/Applications/tm-studio/server/api/v1/media/analyze.post.ts#L109), `ffmpeg.controller.cjs:1224`/`:1333`/`:221`/`:573` | thay bằng `MediaProbeService` (đã dựng ở slice B, §13) — **kể cả chỗ probe video của provider adapter**, không chỉ chỗ của editor |
| (c) spawn **không liên quan media** | **6** call site, trong **4** file | ngoài 9 file media: `electron/main.cjs:606` (`spawn(process.execPath)` cho MCP server), `dev-electron-launcher.cjs:92` (khởi động Electron — dòng `:28` chỉ là `require`), `updater.cjs:152`/`:159` (`tar.exe`/`powershell.exe`); nằm TRONG file media nhưng không chạm FFmpeg: `task-manager.cjs:18` (`taskkill`), `ffmpeg.controller.cjs:70` (`powershell` hỏi `Win32_VideoController`) | **GIỮ** — brief §3 slice I mục 3 cấm xoá bừa; `updater` chỉ đổi vai (nó cài binary mà sản phẩm không còn cần) |
| (d) `backup/ffmpeg-engine-2026-11-03/` | 20 file import `child_process` | ảnh chụp chính các file ở (a)/(b) | **không tính**; Q8 giữ untracked tới hết slice I, và mọi `grep` phải loại nó ra nếu không muốn **đôi** mọi con số |
| (e) test dùng FFmpeg làm **oracle** | **11** spec — **10** cái tự `spawnSync` binary media (**20** call site), cộng `tmcut_html_video_smoke` đi qua route server | `tmcut_render_smoke`, `tmcut_detect_smoke`, `tmcut_svg_still`, `tmcut_golden_frame`, `tmcut_render_parity`, `tmcut_text_pixel`, `tmcut_export_paint_stack`, [tmcut_export_gap_placement.spec.ts:62](file:///D:/Applications/tm-studio/tests/unit/tmcut_export_gap_placement.spec.ts#L62), `tmcut_fx_catalog`, `tmcut_transition_preview`, `tmcut_html_video_smoke` | **tách assertion** theo §8 hàng J, không xoá cả file — đây là chỗ duy nhất pixel/duration từng được đo thật |

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
[tmcut_server_media_boundary.spec.ts:27](file:///D:/Applications/tm-studio/tests/unit/tmcut_server_media_boundary.spec.ts#L27)
kê khai `SPAWN_SITES` và [:59](file:///D:/Applications/tm-studio/tests/unit/tmcut_server_media_boundary.spec.ts#L59)
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
   [htmlVideoRender.ts:237](file:///D:/Applications/tm-studio/server/utils/htmlVideoRender.ts#L237).
2. **Encode — **chính** cái `spawn` ở :177.** [htmlVideoRender.ts:177](file:///D:/Applications/tm-studio/server/utils/htmlVideoRender.ts#L177):
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
| scene + silence analysis | [analyze.post.ts:102](file:///D:/Applications/tm-studio/server/api/v1/media/analyze.post.ts#L102) và [tmcut.controller.cjs:511](file:///D:/Applications/tm-studio/electron/tools/tmcut.controller.cjs#L511) qua [useTmcutAutocut.ts:79](file:///D:/Applications/tm-studio/app/composables/useTmcutAutocut.ts#L79) / [:83](file:///D:/Applications/tm-studio/app/composables/useTmcutAutocut.ts#L83) | **đã dựng xong ở E1–E3**: `sceneScan` + `silenceScan` + `audioDecode` (§22–§24); E4 **nối** hai nhánh IPC/web vào đường này | **E4** | parity `silencedetect` ở **sát** ngưỡng chưa hiệu chuẩn (§24.5) |
| frame tại một timestamp | [tmcut.controller.cjs:1127](file:///D:/Applications/tm-studio/electron/tools/tmcut.controller.cjs#L1127) `extractFrame`, `-ss` IPC | `frameDecode`/`frameStore` + Mediabunny `CanvasSink` (§20–§21) — **đã có consumer** | đã đóng ở D3 | — |
| thumbnail + filmstrip tile 8x1 | `extractThumbnail` (chạy trong `analyzeAsset`) | cùng pipeline D; tile là chuyện composition, không phải decoder | **F** | filmstrip tile hiện là `tile=8x1` do FFmpeg xếp, cần một luật xếp ô trong core |
| waveform peaks (`-f s16le`) | [tmcut.controller.cjs:1421](file:///D:/Applications/tm-studio/electron/tools/tmcut.controller.cjs#L1421) `generateProxy` và `extractWaveform` | `decodePcm` (E3) + bucket min/max/RMS trong core, cache theo fingerprint | **G** | — |
| proxy để preview nhẹ | [proxy.post.ts:79](file:///D:/Applications/tm-studio/server/api/v1/media/proxy.post.ts#L79) và [:1421](file:///D:/Applications/tm-studio/electron/tools/tmcut.controller.cjs#L1421) | **không có tương đương trong phạm vi này**: re-encode một stream nhẹ cần `VideoEncoder` + muxer, tức là cần H; cho tới H, preview đi thẳng nguồn local | **H** | proxy cho file 4K trên máy yếu; UI phải nói "proxy chưa khả dụng", không âm thầm render gốc |
| export timeline | [render.post.ts:121](file:///D:/Applications/tm-studio/server/api/v1/media/render.post.ts#L121) (web) và `task-manager.cjs:208`/`:284` (desktop, `compileTimelineToFfmpeg`) | slice H: scheduler của core → `renderAt`/paint stack → `VideoEncoder` → Mediabunny muxer. Hai host **một** exporter | **H** | toàn bộ argv do `compileTimelineToFfmpeg` dựng — đó là §5.1, việc của J |
| HTML-video encode | [htmlVideoRender.ts:177](file:///D:/Applications/tm-studio/server/utils/htmlVideoRender.ts#L177) | **A** (WebCodecs + muxer, leg dời sang client) hoặc **B** (preview-only) — chờ đo `isConfigSupported` | **H**, rồi chủ repo chốt | xem §25.2 |
| caption audio extract (`mp3` mono 16 k) | `extractAudio` [:1127](file:///D:/Applications/tm-studio/electron/tools/tmcut.controller.cjs#L1127) | `decodePcm` (E3) + Web Audio; **mp3 không phải định dạng mà WebCodecs encode**, nên nếu下游 cần mp3 thì đó là `unsupported`, không phải tự đổi container | **G** | file `.mp3` cho service phiên âm ngoài phạm vi |
| stabilize (vidstab 2 pass) | [tmcut.controller.cjs:1427](file:///D:/Applications/tm-studio/electron/tools/tmcut.controller.cjs#L1427) | **Q1 đã chốt: bỏ hẳn** — xoá nút + key i18n, project cũ giữ nguyên dữ liệu và đánh dấu unsupported | **I/J** | tính năng, **có chủ đích** |
| subtitle burn-in (libass) | emitter `subtitles` trong `render/` | **Q2 đã chốt: sơn bằng text track qua `paintStack`**; không parser ASS | **F/J** | các tag ASS nâng cao, phải khai rõ |
| probe duration/streams | 8 chỗ nhóm (b) | `MediaProbeService` (§13). Field không lấy được → `undefined` + warning, **không** sentinel 0 | đã đóng ở B | `bitrate`/`fps` trung bình của VFR — phải đo lại trên fixture, không đoán |

### 25.4 Sáu rủi ro mà việc gỡ binary **không** tự giải quyết

1. **`execSync` nội suy đường dẫn vào shell string.** [ffmpeg.controller.cjs:221](file:///D:/Applications/tm-studio/electron/tools/ffmpeg.controller.cjs#L221)
   và [:573](file:///D:/Applications/tm-studio/electron/tools/ffmpeg.controller.cjs#L573) dựng
   `"${ffprobe}" … "${filePath}"` rồi cho `execSync` chạy **qua shell**, tức một tên file có dấu `"` thoát khỏi
   quoting; [:65](file:///D:/Applications/tm-studio/electron/tools/ffmpeg.controller.cjs#L65) và :80/:90/:100 còn
   chạy tới **4 phép probe GPU đồng bộ trên main process**. slice I xoá cả nhóm này là **xóa luôn lỗi**, không
   chỉ xoá engine — nhưng phải ghi để không ai "port" nguyên argv builder sang engine mới.
2. **Gỡ binary ≠ hết spawn.** `config.tools.ffmpegPath \|\| 'ffmpeg'` ở 5 chỗ
   ([render.post.ts:121](file:///D:/Applications/tm-studio/server/api/v1/media/render.post.ts#L121),
   [analyze.post.ts:102](file:///D:/Applications/tm-studio/server/api/v1/media/analyze.post.ts#L102),
   [proxy.post.ts:79](file:///D:/Applications/tm-studio/server/api/v1/media/proxy.post.ts#L79),
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
4. **`render.post.ts` nhận nguyên argv từ client** (`body.args`, [:69](file:///D:/Applications/tm-studio/server/api/v1/media/render.post.ts#L69),
   chỉ giới hạn 400 arg / 20 000 ký tự; route chỉ rewrite các giá trị `-i` và token cuối). Nghĩa là caller phía
   web hôm nay khiến server đọc đường dẫn tùy ý dưới danh tính của chính app. Engine thay thế **không được kế
   thừa trust model đó**: client phải gửi project, server không nhận lệnh.
5. **Hai kênh IPC mồ côi và một kênh tự gây spawn.** `tmcut:extractThumbnail` và `tmcut:extractWaveform` có
   **0** file trong `app/` nhắc tới (chỉ `electron/preload.cjs:119` exposes; `grep -rln` trong `app/` trả rỗng) —
   retirement gần như miễn phí. Ngược lại [useMcpRendererBridge.ts:173](file:///D:/Applications/tm-studio/app/composables/useMcpRendererBridge.ts#L173)
   đặt `command: 'ffmpeg'` cho `export.add_job` với `input.mp4` **không tồn tại**, một tool call là spawn thật.
6. **`maxBuffer` đặt cho `spawn` là vô nghĩa.** Nó chỉ được `exec`/`execFile` tôn trọng; các wrapper ở
   [tmcut.controller.cjs:194](file:///D:/Applications/tm-studio/electron/tools/tmcut.controller.cjs#L194) và
   [:511](file:///D:/Applications/tm-studio/electron/tools/tmcut.controller.cjs#L511) vẫn nối chuỗi stdout/stderr
   không trần, nên comment "chống OOM" mô tả một bảo vệ không tồn tại.

Bề mặt mà slice I phải chạm, cũng đo lại lần này: **30** invoke handler + **10** event của module
`tools:ffmpeg` (đếm từ `ipcMain.handle(\`${moduleName}:…\``), **42** handler của `tmcut` trong đó **10** gọi tới
binary, `tools:ffmpeg:*` sinh từ [ipcPolicy.cjs:25](file:///D:/Applications/tm-studio/electron/ipcPolicy.cjs#L25)
danh sách `TASK_EVENT_NAMES`, và **3** bảng SQLite
(`ffmpeg_configs` [sqlite.cjs:186](file:///D:/Applications/tm-studio/electron/tools/sqlite.cjs#L186),
`ffmpeg_batch_configs` [:225](file:///D:/Applications/tm-studio/electron/tools/sqlite.cjs#L225),
`ffmpeg_history` [:235](file:///D:/Applications/tm-studio/electron/tools/sqlite.cjs#L235)) — bảng history **có dữ
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
[tmcut_export_gap_placement.spec.ts:62](file:///D:/Applications/tm-studio/tests/unit/tmcut_export_gap_placement.spec.ts#L62)
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
| [useTmcutAutocut.ts:85](file:///D:/Applications/tm-studio/app/composables/useTmcutAutocut.ts#L85)→[:88](file:///D:/Applications/tm-studio/app/composables/useTmcutAutocut.ts#L88) | **Một** detector dựng từ ba seam có thật của app: `decodeLumaSeries`, `decodePcm`, `hasFrameDecoder`. Hai leg IPC `analyzeScenes`/`analyzeSilence` bị **xoá khỏi composable** — `grep` cả `app/` không còn một chỗ gọi nào | check [:77](file:///D:/Applications/tm-studio/tests/unit/tmcut_autocut_analyze.spec.ts#L77) (composable dựng một detector từ hai seam) và [:310](file:///D:/Applications/tm-studio/tests/unit/tmcut_autocut_detect.spec.ts#L310) (nó hỏi **trình duyệt**, không hỏi main process hay server) |
| [useTmcutAutocut.ts:107](file:///D:/Applications/tm-studio/app/composables/useTmcutAutocut.ts#L107) + [:110](file:///D:/Applications/tm-studio/app/composables/useTmcutAutocut.ts#L110) + [:120](file:///D:/Applications/tm-studio/app/composables/useTmcutAutocut.ts#L120) | `running: AbortController` đặt **trong composable** nên `cancel()` tới được tận decoder, không chỉ tới `await` — một lượt quét đang mở demuxer thì Promise `await` tự nó không dừng lại | check [:122](file:///D:/Applications/tm-studio/tests/unit/tmcut_autocut_analyze.spec.ts#L122) + phép đo huỷ thật §26.2 |
| [autocut.vue:414](file:///D:/Applications/tm-studio/app/pages/tmcut/autocut.vue#L414)→[:422](file:///D:/Applications/tm-studio/app/pages/tmcut/autocut.vue#L422) | Bốn câu khác nhau cho bốn lý do rỗng: `cancelled` có **khung riêng** ([:929](file:///D:/Applications/tm-studio/app/pages/tmcut/autocut.vue#L929), "không có gì bị thay đổi"), ba lỗi kia chung một khung lỗi với **đúng một** dòng chữ (`no-decoder` ≠ `no-video`) | **6** khoá i18n mới trên **cả hai** locale: [vi.json:352](file:///D:/Applications/tm-studio/i18n/locales/vi.json#L352)→[:355](file:///D:/Applications/tm-studio/i18n/locales/vi.json#L355) (cancelScan / scanCancelled / errNoDecoder / errNoVideo) và [:1329](file:///D:/Applications/tm-studio/i18n/locales/vi.json#L1329)→[:1331](file:///D:/Applications/tm-studio/i18n/locales/vi.json#L1331) |
| [autocut.vue:1330](file:///D:/Applications/tm-studio/app/pages/tmcut/autocut.vue#L1330) + [:1342](file:///D:/Applications/tm-studio/app/pages/tmcut/autocut.vue#L1342) + [en.json:1329](file:///D:/Applications/tm-studio/i18n/locales/en.json#L1329) | `windows`/`sampled`/`missing` **có chỗ hiển thị** — câu hỏi §24.5 để ngỏ: `metricScenesSub` Nay nói "Read {sampled} frames in the browser" (không còn là "FFmpeg scene detection"), `metricFramesMissing` nói bao nhiêu frame không đọc được, `metricNoAudio` nói **không nghe thấy gì** chứ không nói "file im lặng" | hai dòng template trên, và `audioHeard` là cột phân biệt chúng — xem 8 dòng đo live §26.2 |
| [detection.mjs:251](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L251) `peakLevelSeries` + [:280](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L280) `loudestPeakSeries` | **Đổi thước đo, không chỉ đổi số**: một cửa sổ được tính bằng **sample to nhất** của nó (`20·log10` của trị tuyệt đối lớn nhất), không bằng năng lượng. `silencedetect` so **từng sample** với `noise=`; một cửa sổ RMS trả lời một câu hỏi khác | **11** check trong [silence-peak-law.test.mjs](file:///D:/Applications/tm-studio/packages/core/test/silence-peak-law.test.mjs): [:39](file:///D:/Applications/tm-studio/packages/core/test/silence-peak-law.test.mjs#L39) peak chứ không energy, [:49](file:///D:/Applications/tm-studio/packages/core/test/silence-peak-law.test.mjs#L49) full-scale = 0 dBFS và im tuyệt đối = sàn, [:62](file:///D:/Applications/tm-studio/packages/core/test/silence-peak-law.test.mjs#L62) mặc định **20 ms**, [:77](file:///D:/Applications/tm-studio/packages/core/test/silence-peak-law.test.mjs#L77) sample NaN không biến thành im, [:89](file:///D:/Applications/tm-studio/packages/core/test/silence-peak-law.test.mjs#L89) kênh to nhất, [:108](file:///D:/Applications/tm-studio/packages/core/test/silence-peak-law.test.mjs#L108) một click ở **đầu** run quiet không bị nuốt |
| [detection.mjs:48](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L48) `TMCUT_SILENCE_WINDOW_SEC = 0.02` + [:40](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L40) `MIN_DURATION 0.5` (giữ nguyên) | Cửa sổ hẹp lại **25 lần** (0.5 s → 0.02 s) còn độ dài tối thiểu một run **không đổi**: cửa sổ là đơn vị định vị biên, `d=` là đơn vị quyết định run có được tính không — hai thứ mà bản cũ gộp làm một | bảng 12 file §26.2: **cùng số span** với oracle trên **cả 12** file, sai số biên mean **7 ms** / worst **16 ms** |
| [detection.mjs:30](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L30) `TMCUT_SCENE_THRESHOLD = 0.18` (từ 0.2) + [:36](file:///D:/Applications/tm-studio/packages/core/src/detection.mjs#L36) `SAMPLE_HZ = 5` (giữ) | Ngưỡng đặt **giữa dải đo được trên geometry mà app thật chạy**, không phải giữa hai số trong bảng notes (§26.3.3) | sweep 8 file trong browser §26.2: `fast-motion` (motion liên tục, không cut) đạt **0.1558**, `cuts-4` (3 cut thật) thấp nhất **0.1988** — 0.20 mất một cut thật, 0.15 sinh 3 cut giả |
| [silenceScan.ts:24](file:///D:/Applications/tm-studio/app/utils/tmcut/silenceScan.ts#L24) + [:71](file:///D:/Applications/tm-studio/app/utils/tmcut/silenceScan.ts#L71) + [audioDecode.ts:11](file:///D:/Applications/tm-studio/app/utils/tmcut/audioDecode.ts#L11) | Đổi tên luật **không đổi** cấu trúc glue: seam vẫn chỉ giao sample, glue vẫn chỉ gọi đúng một hàm core | check [:185](file:///D:/Applications/tm-studio/tests/unit/tmcut_silence_scan.spec.ts#L185) cấm seam gọi `silenceSpans(`, `loudestPeakSeries(`, `peakLevelSeries(`, `dbfsOf(` — danh sách được **cập nhật cùng lượt**, không phải để nguyên tên đã mất |
| [index.d.ts:405](file:///D:/Applications/tm-studio/packages/core/src/index.d.ts#L405)→[:406](file:///D:/Applications/tm-studio/packages/core/src/index.d.ts#L406) + [:436](file:///D:/Applications/tm-studio/packages/core/src/index.d.ts#L436)→[:441](file:///D:/Applications/tm-studio/packages/core/src/index.d.ts#L441) | Khai báo viết tay theo đúng luật mới: `TMCUT_SILENCE_WINDOW_SEC` được khai báo riêng (không còn chung dòng với `MIN_DURATION`), `levelSeries` → `peakLevelSeries`, `loudestLevelSeries` → `loudestPeakSeries` | `tsc -p packages/core/tsconfig.check.json` exit **0**, **0** `error TS` (§26.4 gate 3b) — `.d.ts` tay thì chỉ tsc mới kiểm được |
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

- **`realcuts.mp4` là một缺口 thật**: hai cut trong footage 720×1280 mà luật luma của core không tìm thấy ở bất
  kỳ ngưỡng nào không bịa cut giả (§26.3.4). Muốn đóng phải thêm một luật histogram/chroma vào core — việc của
  một lượt khác, không phải việc chỉnh ngưỡng.
- **`flash.mp4` trả hai cut cho một sự thật**: burst một frame ngắn hơn chu kỳ lấy mẫu, nên **cả** cạnh vào và
  cạnh ra đều là thay đổi thật (điểm 0.5121, `shippedCuts` 2.904 và 3.096). Với EDL thì đây là **đúng** hành vi
  (khoanh vùng闪光), nhưng nó có nghĩa là số cut **không** bằng số cut thật trên nội dung có hiệu ứng một-frame.
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
- **Slice I còn nguyên**: `shared/types/electron.ts:878`→[:879](file:///D:/Applications/tm-studio/shared/types/electron.ts#L879)
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
| Cái gì **phủ lên toàn stack** (chữ overlay ở mọi hàng text đang hiện) | app `activeTextClips` [:181](file:///D:/Applications/tm-studio/app/composables/useTmcutPlayback.ts#L181), còn export thì tự quyết ở [render/clip.ts:155](file:///D:/Applications/tm-studio/app/utils/tmcut/render/clip.ts#L155) | core [composite.mjs:98](file:///D:/Applications/tm-studio/packages/core/src/composite.mjs#L98) |

Ô thứ nhất của dòng cuối là **nguồn của nợ F3**: `selectExportTracks` vẫn tự bổ hàng `videoRows[0]` thành
`videoBase` và `videoRows.slice(1)` thành `extraVideoTracks`
([clip.ts:161](file:///D:/Applications/tm-studio/app/utils/tmcut/render/clip.ts#L161)) — tức export đang
**re-decide** cái luật mà core đã có từ §23. F1 chưa đụng file app nào; nó chỉ dựng chỗ đúng để F2 và F3
chuyển về.

### 27.2 Luật mới

`compositePlan(evaluation) → { at, slots }` ([composite.mjs:53](file:///D:/Applications/tm-studio/packages/core/src/composite.mjs#L53)),
declaration trong [index.d.ts:1962](file:///D:/Applications/tm-studio/packages/core/src/index.d.ts#L1962).
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

- [tmcut_paint_stack.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_paint_stack.spec.ts#L186) check 2 từng
  khoá `/selectPaintRows/` và `/tracks?.[base.trackIndex]/` **ngay trong file preview**; F2a làm cả hai thành **false**.
  Pin mới ([:186-197](file:///D:/Applications/tm-studio/tests/unit/tmcut_paint_stack.spec.ts#L186)): preview phải khớp
  `/compositePlan/`, **không được** chứa `selectPaintRows` (luật hàng chỉ đi qua core **một** lần, qua plan, chứ không
  phải hai cửa vào), không còn `videoEvaluations`, và join back bằng `tracks[slot.trackIndex]`.
- Helper `currentPreviewRow` trong cùng spec đổi tên thành
  [`coreBaseRow`](file:///D:/Applications/tm-studio/tests/unit/tmcut_paint_stack.spec.ts#L125): nó mô tả **câu trả lời
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
[tmcut_paint_stack.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_paint_stack.spec.ts),
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
  của [tmcut_shared_model.spec.ts:309](file:///D:/Applications/tm-studio/tests/unit/tmcut_shared_model.spec.ts#L309).
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

- [tmcut_footage_row_rule.spec.ts:158](file:///D:/Applications/tm-studio/tests/unit/tmcut_footage_row_rule.spec.ts#L158)
  đổi tên check 6 từ "preview vẫn chỉ một hàng" thành **"the warning says the file stacks and never claims the screen
  does not"**. Assertion cũ **đúng** cho tới hôm qua và **sai** từ hôm nay; nó được chuyển thành `doesNotMatch` bắt mọi
  cách nói "màn hình chưa xếp chồng", còn phần "screen" do `tmcut_preview_stack_dom` check 6
  ([:146](file:///D:/Applications/tm-studio/tests/unit/tmcut_preview_stack_dom.spec.ts#L146)) giữ.
- Copy `parallelTracksWarning` sửa ở **cả hai** locale: [en.json:1050](file:///D:/Applications/tm-studio/i18n/locales/en.json#L1050)
  và [vi.json:1050](file:///D:/Applications/tm-studio/i18n/locales/vi.json#L1050). Check 6 khoá **cả** khẳng định mới
  ("composites / stacks / theo thứ tự vẽ") **và** cấm khẳng định cũ ("preview still / màn hình vẫn chỉ").
- Comment trong [TmcutExportModal.vue:404](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutExportModal.vue#L404)
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
[TmcutExportModal.vue](file:///D:/Applications/tm-studio/app/components/tmcut/TmcutExportModal.vue),
[tmcut_preview_stack_dom.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_preview_stack_dom.spec.ts) (mới),
[tmcut_footage_row_rule.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_footage_row_rule.spec.ts),
[tmcut_shared_model.spec.ts](file:///D:/Applications/tm-studio/tests/unit/tmcut_shared_model.spec.ts),
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
