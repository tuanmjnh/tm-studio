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
| C | Asset cache fingerprint (IndexedDB/OPFS), trạng thái `queued\|probing\|ready\|partial\|unsupported\|error` | `useTmcutMedia.ts` | relink test; không serialize File object | B |
| D | Thumbnail + filmstrip bằng `VideoDecoder`/Canvas; bỏ `-ss` IPC | `useTmcutFrames.ts`, `frames.mjs` | thumb test theo timestamp; cancel stale request | B |
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

---

## 11. Definition of Done §25 → bằng chứng sẽ chứng minh

| Mục DoD | Bằng chứng dự kiến | Hiện tại |
|---|---|---|
| Không FFmpeg trong dependency tree | `package.json` + lockfile grep | **đã đúng** (chưa từng có package FFmpeg) |
| Không binary trong repo/build | `.gitignore` + `electron-builder.yml` | **chưa** — 471 MiB vẫn đóng gói |
| Không spawn/exec media | grep `child_process` trong `electron/`, `server/` | **chưa** — 12 file, chỉ 1 không liên quan media (`dev-electron-launcher.cjs` spawn chính Electron) |
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
| Register ADR-028…033, kèm ánh xạ từ dãy ADR-001…006 của plan §26 | `docs/adr/zero-ffmpeg-decisions.md` (file mới) | **214** dòng, đo bằng `split('\n').length` trên bản cuối cùng qua gate |
| Lệnh supersede **tại chỗ** cho ADR-006 | `docs/tmcut-v4-universal-rendering-multiplatform-roadmap.md` | hàng ADR nằm ở dòng **1503** sau slice (trước: 1501, lệch vì chèn banner) |
| Lệnh supersede **tại chỗ** cho ADR-015 | `docs/v4-phase-0-audit.md:235` | sửa trong một dòng, nên `#L229`/`#L233`/`#L235` mà audit này cite vẫn đúng |
| Prose cho phép FFmpeg tồn tại | V4 roadmap | **14** dòng rewritten + 1 banner chèn sau dòng 8; `git diff --numstat` = **16/14**, `git diff -U0` = 14 hunk một-dòng |
| Trạng thái §5.2, §5.3, §10, §11 của chính audit | file này | §5.2 và §5.3 đóng một phần; §10 trỏ sang register; DoD thêm 2 hàng "một phần" |
| Phép đo lại số witness phía core | §2.3, §7, hàng J của §8, và §14.4 (mới) | Ba con số cũ (10 / 10+2 / 11) quy về **11 + 1 + 2** trên **45** file test core; anchor `#L176` và `#L178` đều được sửa thành `#L183` vì mục 8 của register bản cuối nằm ở dòng **183** (register **214** dòng). |

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
