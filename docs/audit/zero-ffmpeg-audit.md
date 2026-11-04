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
| C | Asset cache fingerprint (IndexedDB/OPFS), trạng thái `queued\|probing\|ready\|partial\|unsupported\|error` — **tách ba phần: C1 (audit §16) dựng tầng dữ liệu — sáu trạng thái vào record, fingerprint đúng bằng `cacheKeyForPath`, relink reset mọi thứ probe cũ học và giữ nguyên reference theo Q6; C2 (audit §17) dựng tầng chữ — bảng nhìn state → chữ/icon/tone, predicate `isMediaOffline`, plate Media Offline trên library + timeline + preview, một dòng relink dùng chung cho ba bề mặt; C2b (audit §18) dựng một nửa — store + write (import/relink) + reconcile-on-open + panel row, luật pure ở `byteCache.mjs`; đường đọc (playback/probe/thumb/waveform/export lấy bytes từ cache) chưa có nên ADR-033 vẫn **CHỜ**** | `useTmcutMedia.ts`, `assetImport.ts`, `useTmcutRelink.ts`, `byteStore.ts` mới, `packages/core/src/byteCache.mjs` mới | relink test; không serialize File object — **C1: 16 check ở `tmcut_asset_import.spec.ts`; C2: 13 check ở `tmcut_media_offline.spec.ts` (bảng nhìn + locale hai chiều + truth table offline + hành vi huỷ/relink); C2b: 26 check ở `tmcut_byte_cache.spec.ts` (9 core law, 10 store/backends, 1 boundary, 6 integration)** | B |
| D | Thumbnail + filmstrip bằng `VideoDecoder`/Canvas; bỏ `-ss` IPC — **tách ba phần: D1 (audit §19) dựng danh tính và luật đua trong core (`frameRequestKey`/`frameTimeWithinMedia`/`createFrameSlotLedger`/`planFrameCacheEviction`), pin cả parity với template key của desktop bằng cách đọc file controller; D2 dựng service giải frame một cho hai host (Mediabunny `CanvasSink`) và là chỗ **đường đọc đầu tiên** của byte cache xuất hiện; D3 nối `useTmcutFrames.ts` + ba consumer và trả nợ fixture video §13.4. IPC `-ss` vẫn còn cho tới slice I (build-then-cut, rule 11)** | `useTmcutFrames.ts`, `frames.mjs` | thumb test theo timestamp; cancel stale request — **D1: 11 check ở `tmcut_frame_cache.spec.ts` (danh tính theo ms, clamp, ledger thắng-thua, cache bound). Chưa đạt phần "cancel" ở mặt hành vi: chưa có `AbortController`/`dispose` nào, tức chưa hủy một decode thật nào — việc của D2** | B |
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
| [packages/core/src/index.mjs:23](file:///D:/Applications/tm-studio/packages/core/src/index.mjs#L23) + [packages/core/src/index.d.ts:1937](file:///D:/Applications/tm-studio/packages/core/src/index.d.ts#L1937) | luật được export **và** có khối khai kiểu viết tay (tsup chỉ build runtime; `.d.ts` do `scripts/prepare-dist.mjs` sao sang `dist`, và app type-check lấy `dist`) | check "core declares the byte-cache law to the app": năm tên cộng `TmcutByteCachePlan` phải có trong `.d.ts`. Check này **fail trước** khi khối được viết, và `nuxt typecheck` lúc đó báo 4 × TS2305 |
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
