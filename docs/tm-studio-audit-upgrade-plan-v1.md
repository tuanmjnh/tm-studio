# TM Studio --- Audit sơ bộ và kế hoạch nâng cấp ổn định

-   Repository: https://github.com/tuanmjnh/tm-studio
-   Branch được kiểm tra: `main`
-   Phạm vi kiểm tra: cấu trúc repo, package/config, các source chính
    của timeline/preview/project/export, ADR zero-FFmpeg, test inventory
    và bằng chứng audit được commit trong repo.
-   Ngày kiểm tra: 2026-11-10
-   Trạng thái: **Audit source-level sơ bộ; chưa chạy app hoặc test trên
    máy người dùng.**

> Tài liệu này là kế hoạch triển khai có thứ tự. Không được hiểu các rủi
> ro suy ra từ source là lỗi đã tái hiện. Trước khi sửa phải tạo
> baseline và đo trên project fixture thực tế.

------------------------------------------------------------------------

## 1. Kết luận điều hành

Không nên viết lại TM Studio từ đầu. Repo đã có nền tảng đáng kể:

-   Nuxt 4 + Vue 3 + Nuxt UI 4 + Tailwind 4.
-   Electron 44 làm desktop shell.
-   `packages/core` độc lập UI, chứa timeline, evaluator, frame
    scheduler, `renderAt`, audio planning và export rules.
-   Mediabunny 1.65.1 + WebCodecs đã có đường encode/mux thực tế.
-   Có byte cache, OPFS/IndexedDB, media probing, frame extraction,
    waveform, recovery và project persistence.
-   Có nhiều test unit/core/Electron/E2E và các báo cáo kiểm tra runtime
    được commit.

Tuy nhiên, **có core và có encode session không đồng nghĩa với một video
editor hoàn chỉnh**. Khoảng cách lớn nhất hiện tại là: 1. Timeline chưa
có cơ chế virtualize/cull theo viewport ở bề mặt chính. 2. Preview còn
dựa vào nhiều HTML media elements và DOM/CSS; export hiện dùng một
canvas painter có giới hạn. 3. Export chủ động từ chối nhiều tính năng
người dùng có thể đã dùng trong timeline. 4. Luồng load project/media có
nhiều lớp lưu trữ và cache, cần kiểm chứng end-to-end trên app đã đăng
nhập. 5. Tài liệu kiến trúc/audit có các mốc lịch sử khác nhau, có nguy
cơ khiến coding agent hiểu nhầm trạng thái hiện tại.

**Chiến lược:** giữ kiến trúc Nuxt/Vue/Electron + `packages/core` +
Mediabunny/WebCodecs + zero-FFmpeg; ưu tiên sửa hiệu năng và hoàn thiện
render/export theo lát cắt có nghiệm thu. Không chuyển Rust hoặc thay
framework trong đợt ổn định này.

------------------------------------------------------------------------

## 2. Những gì đã xác minh từ source

### 2.1 Repository và công nghệ

`package.json` hiện khai báo: - Nuxt `^4.6.2` - Vue `^3.5.44` - Nuxt UI
`^4.12.0` - Electron `^44.9.1` - Mediabunny `1.65.1` - pnpm `12.15.0`

Các lệnh đáng chú ý: - `pnpm dev` - `pnpm dev:electron` -
`pnpm typecheck` - `pnpm lint` - `pnpm test` - `pnpm test:core` -
`pnpm test:unit` - `pnpm test:electron` - `pnpm build` -
`pnpm build:electron:win` - `pnpm build:electron:dir`

Port dev hiện tại: `4003`. TM Hub mặc định: `4000`.

### 2.2 Timeline

Các file chính: - `app/components/tmcut/TmcutTimeline.vue` --- khoảng
1,814 dòng. - `app/components/tmcut/TmcutTimelineClip.vue` --- khoảng
871 dòng. - `app/composables/useTmcutPlayback.ts` --- playback clock,
frame pacing, playhead, seek, shuttle. -
`packages/core/src/timeline.mjs` --- pure timeline operations. -
`packages/core/src/evaluate.mjs` --- evaluate timeline tại timestamp. -
`packages/core/src/scheduler.mjs` --- frame scheduler. -
`packages/core/src/renderAt.mjs` --- timestamp/frame boundary contract.

Đã xác minh: - Timeline render trực tiếp từng track và từng clip bằng
`v-for`; chưa thấy virtualized clip layer ở bề mặt chính. - `rulerTicks`
tạo danh sách tick dựa trên tổng thời lượng timeline; lượng node có thể
tăng theo độ dài project. - Clip drag/trim đã có pointer capture,
`gesturePreview` dùng để preview patch và commit vào project một lần khi
pointer kết thúc. Đây là hướng đúng, cần giữ lại và đo thay vì thay thế
tùy tiện. - `TmcutTimelineClip` mỗi clip là một Vue component lớn, có
computed/watch riêng, filmstrip, waveform, menu và gesture logic. -
Playback dùng `requestAnimationFrame`; trong mỗi frame có cập nhật
playhead, đồng bộ media element, outgoing transition và stacked video. -
Preview có deep watcher trên `currentProject.timeline` để đồng bộ media
sau các chỉnh sửa. Đây là điểm cần profiling vì deep traversal trên
project lớn có thể tạo chi phí đáng kể.

Rủi ro cần đo: - Số lượng clip DOM, ruler tick DOM, filmstrip thumbnail
DOM. - Số Vue component đang mounted khi timeline có nhiều clip/track. -
Chi phí re-render trong lúc playhead chạy và trong lúc kéo clip. - Số
lần seek `HTMLVideoElement.currentTime`, số lần đổi `src`, decode
stalls. - Chi phí deep watcher và computed evaluation trên project nhiều
track/clip.

Không được kết luận nguyên nhân lag duy nhất trước khi có profiling.

### 2.3 Preview

File chính: `app/components/tmcut/TmcutPreviewPlayer.vue` (khoảng 2,426
dòng).

Preview hiện dùng: - `HTMLVideoElement` cho footage. - Nhiều media
surface cho outgoing/crossfade và stacked tracks. - `<img>` cho still
images. - DOM/CSS overlay cho text và visual styling. - Web Audio/audio
elements cho audio mix. - Shared core evaluator/surface logic để xác
định nội dung tại timestamp.

Các điểm tốt: - Có xử lý riêng cho still image thay vì cố phát ảnh bằng
`<video>`. - Có xử lý media waiting/stalled và seek synchronization. -
Có byte-cache-backed playback path. - Có cleanup playback loop,
observer, timer và audio elements khi unmount. - Có shared evaluation
semantics trong core.

Rủi ro: - Shared timeline semantics không tự động bảo đảm pixel parity.
DOM/CSS preview và canvas export vẫn là hai đường rasterization. - Nhiều
video elements cùng hoạt động có thể gây decode contention, nhất là khi
stacked rows/crossfade/audio nhiều. - Deep watchers và per-frame
synchronization cần profiling. - Các hiệu ứng CSS phải được ánh xạ sang
cùng semantics khi export, không được chỉ tồn tại ở preview.

### 2.4 Project và media loading

File chính: - `app/composables/useTmcutProject.ts` (khoảng 1,901
dòng). - `app/composables/useTmcutMedia.ts` (khoảng 1,056 dòng). -
`app/utils/tmcut/byteStore.ts`. - `app/utils/tmcut/playbackBytes.ts` /
composable liên quan. - `app/utils/tmcut/mediaProbe.ts`. -
`app/utils/tmcut/frameStore.ts` và `frameDecode.ts`. -
`app/utils/tmcut/recovery` và local store helpers.

Project store hiện phối hợp: - Project JSON trong localStorage. -
Project file qua Electron IPC trên desktop. - Recovery
checkpoint/file. - Project index/metadata. - Media library và asset
fingerprint. - Byte cache trong OPFS/IndexedDB. - Media URL được resolve
cho preview.

Đây là một kiến trúc nhiều lớp; lỗi "load không đúng" cần phân loại
rõ: 1. Project JSON sai/migration sai. 2. Asset path không còn hợp lệ.
3. Fingerprint không khớp file revision. 4. Byte cache không tìm thấy
hoặc bị stale. 5. URL resolve sai giữa web và Electron. 6. Metadata chưa
sẵn sàng nhưng preview đã seek. 7. Decoder không hỗ trợ codec/container.
8. Race giữa load project, recovery, asset library và media element
lifecycle.

Không được chỉ sửa bằng cách tăng timeout hoặc retry mù.

### 2.5 Export/render

Các file chính: - `app/components/tmcut/TmcutExportModal.vue`. -
`app/utils/tmcut/webCodecsExport.ts`. -
`app/utils/tmcut/exportEncodeSession.ts`. -
`app/utils/tmcut/webExportHost.ts`. -
`app/utils/tmcut/exportEncodePlan.ts`. -
`packages/core/src/exportContent.mjs`. -
`packages/core/src/exportEncode.mjs`. -
`packages/core/src/exportMix.mjs`. - `packages/core/src/renderAt.mjs`.

Đã xác minh: - Export modal gọi `planEncodeContent()` trước khi
render. - Host export dùng WebCodecs để encode và Mediabunny để mux. -
Có capability check, progress, cancel, audio mixing, resource cleanup và
output Blob/download. - Core có test eligibility riêng, trong đó cố ý
kiểm tra các project bị từ chối.

Các refusal hiện có gồm: - `stacked-rows` - `text` - `effects` (với các
effect chưa được exporter bake) - `mask` - `blend` - `transition` -
`reverse` - `stabilize` - `fit-unsupported` - `rotation` -
`background-image` - `background-transparent` - `empty` - `bad-canvas`

Do đó export hiện là **MVP có điều kiện**, chưa phải full timeline
renderer.

Bằng chứng repo commit ngày 2026-11-09 cho thấy: - Chrome 156, Edge 157,
Electron 44: 32/32 capability probes supported trong ma trận đã ghi. -
Firefox 159: 30/32; thiếu AAC audio encode và WebGPU adapter. - Có bài
đo export file khoảng 1 GiB bằng WebCodecs + Mediabunny, peak RSS được
ghi nhận 602 MB trên môi trường đo. - Những phép đo này chứng minh
encode/mux runtime có thể hoạt động với workloads được đo; **không chứng
minh mọi project timeline đều export được**.

### 2.6 Governance và tài liệu

`docs/adr/zero-ffmpeg-decisions.md` ghi quyết định ADR-028...ADR-033: -
Zero FFmpeg/FFprobe. - Mediabunny là demux/mux toolkit. - WebCodecs với
capability checks. - Shared preview/export semantics. - Electron là
shell, không có media engine thứ hai. - Local-first media privacy.

Không được tự ý thêm lại FFmpeg, FFprobe, FFmpeg.wasm hoặc FFprobe.wasm.
Muốn đổi quyết định này phải có ADR mới và được chủ repo duyệt.

`docs/v4-phase-0-audit.md` còn chứa mô tả trạng thái lịch sử cũ, ví dụ
kiến trúc chỉ có FFmpeg renderer. Phải đánh dấu superseded/historical
hoặc cập nhật phần mở đầu và liên kết tới audit/ADR mới; không xóa lịch
sử bằng chứng.

------------------------------------------------------------------------

## 3. Ưu tiên nâng cấp

### P0 --- Baseline, bảo vệ dữ liệu và tái hiện lỗi

Mục tiêu: có thể biết trước/sau nâng cấp cái gì tốt hơn hoặc tệ hơn.

1.  Tạo branch riêng `stabilize/timeline-preview-export`.
2.  Ghi commit SHA hiện tại và bảo toàn working tree của người dùng.
3.  Không tự động migrate hoặc rewrite project file hàng loạt.
4.  Chạy:
    -   `pnpm install --frozen-lockfile`
    -   `pnpm typecheck`
    -   `pnpm lint`
    -   `pnpm test`
    -   `pnpm build`
    -   `pnpm build:electron:dir`
5.  Ghi log đầy đủ, không chỉ ghi PASS/FAIL.
6.  Chuẩn bị fixture:
    -   1 video H.264 MP4 + audio.
    -   1 video không có audio.
    -   1 ảnh PNG/JPG.
    -   1 file audio.
    -   1 project 3--5 phút, 20--30 clips.
    -   1 project stress 10 phút, 100--200 clips, nhiều tracks.
    -   1 project có text, transitions, masks, effects, blend.
    -   1 project thiếu media và 1 project có asset relink.
7.  Đo baseline timeline FPS, drag latency, preview seek latency,
    project load time, export eligibility và export output.

Exit criteria: - Có báo cáo baseline tái hiện được. - Không mất
project/asset khi chạy test. - Biết lỗi nào là build/test failure, lỗi
nào chỉ xảy ra trên runtime UI.

### P1 --- Timeline performance

Không viết lại timeline ngay. Tách tối ưu thành các lát nhỏ.

**P1.1 Instrumentation** - Đếm mounted track/clip components. - Đo frame
duration trong lúc playback. - Đo thời gian pointerdown → pointermove →
pointerup. - Đo số DOM nodes trong timeline. - Đo thời gian tính ruler
ticks, filmstrip và waveform. - Bật Performance marks chỉ trong
dev/diagnostic mode.

**P1.2 Viewport culling / virtualization** - Chỉ render clip nằm trong
vùng nhìn thấy cộng overscan. - Không mount hàng nghìn clip ngoài
viewport. - Ruler ticks chỉ tạo cho vùng nhìn thấy; không tạo toàn bộ
ticks cho toàn project. - Minimap vẫn đại diện toàn bộ project nhưng
dùng canvas/summary data, không mount tất cả clip nodes. - Giữ
hit-testing và drag target chính xác khi clip vào/ra viewport.

**P1.3 Render separation** - Tách static clip geometry khỏi dynamic
playhead/selection/gesture overlays. - Playhead di chuyển không được làm
toàn bộ clip components recompute. - Gesture update phải được batch theo
`requestAnimationFrame`. - Không ghi project/localStorage/recovery ở mỗi
pointermove. - Giữ nguyên commit-on-pointer-up và history semantics.

**P1.4 Filmstrip/waveform** - Dùng cache key ổn định theo asset
fingerprint + clip range + thumbnail timestamp. - Không tạo lại
thumbnail khi chỉ đổi selection hoặc playhead. - Giới hạn decode
concurrency. - Cancel decode/thumbnail jobs khi clip rời viewport. - Ưu
tiên thumbnail đã cache; tránh decode lặp từ cùng nguồn.

**P1.5 Acceptance** - Stress fixture 100--200 clips: không tăng DOM
tuyến tính theo toàn project khi viewport không đổi. - Drag/trim không
ghi store mỗi frame. - Scroll/zoom không làm clip lệch vị trí. -
Playhead không gây full timeline rerender. - Không mất snapping, ripple,
group, undo/redo, keyboard shortcuts.

### P2 --- Project/media loading reliability

**P2.1 Một load state machine rõ ràng** -
`idle → loading-project → migrating → resolving-assets → probing → ready` -
Các trạng thái lỗi: `project-invalid`, `asset-missing`,
`asset-unsupported`, `cache-miss`, `decode-failed`. - Không hiển thị
editor "ready" khi media cần thiết chưa resolve xong.

**P2.2 Project persistence** - Một nguồn revision/version rõ ràng. -
Load project A → chuyển project B phải không để delayed save của A ghi
nhầm dữ liệu B. - Save phải serialize snapshot của project được yêu cầu,
không đọc state mutable sau khi async đã bắt đầu. - Recovery không được
âm thầm ghi đè bản project mới hơn. - Có atomic write/temp file + rename
nếu host filesystem hỗ trợ. - Kiểm tra migration bằng fixtures version
cũ và version hiện tại.

**P2.3 Asset identity** - Canonical path normalization cho
Windows/macOS/Linux. - Fingerprint xác định đúng revision bytes, không
chỉ tên file. - Asset relink phải cập nhật reference và byte cache đồng
bộ. - Không ghép metadata của asset cũ với bytes của asset mới. - Phân
biệt missing, unsupported codec, decode error và cache miss.

**P2.4 Playback load** - Chỉ seek khi metadata/readyState phù hợp. -
Theo dõi `loadedmetadata`, `loadeddata`, `canplay`, `waiting`,
`stalled`, `error`, `seeked`. - Mỗi media surface có generation token;
callback từ source cũ không được ghi vào surface mới. - Khi đổi clip
nhanh, hủy/revoke object URL đúng vòng đời. - Không chạy đồng thời nhiều
decode/seek không cần thiết.

**P2.5 Acceptance** - Mở lại project đã save: clip, duration, track
order, media, transform và audio phải giống trước khi đóng. - Relink
file: preview hoạt động và export đọc đúng cùng revision. - Thiếu file:
hiện Media Offline có hành động relink, không phải khung đen không giải
thích. - Mở project lớn: có loading/progress state, không treo UI. -
Crash/restart: recovery không mất dữ liệu hoặc tự ghi đè sai.

### P3 --- Preview/export renderer parity

Đây là hạng mục quyết định để TM Studio trở thành editor có thể sử dụng
thực tế.

**P3.1 Freeze shared render contract** Core phải là nguồn sự thật cho: -
timeline evaluation tại timestamp. - frame scheduling và frame rate
rational. - source time/speed/reverse policy. - track
order/visibility/mute. - transform/crop/fit. - opacity. - text
layout/typography. - transitions. - mask/blend/effects. - audio
gain/fade/mix. - color/background semantics.

Không để Vue component tự tính lại các quy tắc quan trọng.

**P3.2 Một compositor dùng được cho preview và export** Đề xuất tiến tới
shared compositor API: - `evaluateFrame(project, frameIndex)` -
`prepareFrame(framePlan, mediaResolver)` -
`paintFrame(framePlan, renderTarget)` -
`releaseFrameResources(framePlan)`

Có thể triển khai compositor bằng Canvas 2D trước để có baseline đúng;
sau đó tối ưu bằng WebGL2/WebGPU khi profiling chứng minh cần thiết.
Không bắt buộc dùng WebGPU ngay.

Preview có thể tiếp tục dùng HTMLVideoElement làm decoder/source
provider, nhưng frame compositor phải nhận cùng render instructions như
export. Tránh hai bộ CSS/effect semantics độc lập.

**P3.3 Export capability matrix theo feature** Không mở tất cả features
cùng lúc. Mỗi feature phải có: - Core evaluation. - Preview rendering. -
Export rendering. - Unit tests. - Pixel/golden-frame tests. -
Audio/video sync tests nếu liên quan. - Capability/unsupported
explanation nếu runtime không hỗ trợ.

Thứ tự đề xuất: 1. Single video + audio + image still + background
color. 2. Multi-row compositing và z-order. 3. Text/subtitle overlays.
4. Transform: position, scale, rotation, crop, fit/fill/stretch. 5.
Opacity, fade in/out, keyframes. 6. Transitions. 7. Masks và blend
modes. 8. Effect stack: từng effect một, chỉ bật export sau khi pixel
tests đạt. 9. Reverse và retime/speed ramps. 10. Stabilization chỉ khi
có thuật toán thay thế thực tế; không giữ nút giả.

**P3.4 Export UX** - Hiển thị blockers theo clip/track cụ thể, không chỉ
tên feature chung. - Cho phép click blocker để chọn clip gây lỗi. -
Capability probe trước khi render. - Hiển thị
codec/container/resolution/FPS/audio thực sự được hỗ trợ. - Progress
theo frame/sample đã hoàn tất, không giả lập phần trăm. - Cancel phải
đóng encoder, muxer, decoder, canvas và object URL. - Output chỉ báo
thành công sau khi finalize, file được đọc/probe lại và có dung lượng
hợp lệ. - Không để nút Export trông như hoạt động khi project bị từ
chối.

**P3.5 Preview/export parity acceptance** - Cùng project + cùng frame
index → so sánh preview compositor và exported frame. - Golden image
test với ngưỡng sai lệch rõ ràng. - Test đầu, giữa, cuối clip; cut
boundary; overlap; transition; text; crop; rotation; effect. - Audio
duration và video duration không lệch quá tolerance đã định. - Không có
frame đen ngoài chủ ý, không mất frame đầu/cuối.

### P4 --- Stabilization và release

-   E2E tạo project → import → edit → save → close → reopen → preview →
    export → reopen output.
-   E2E stress project.
-   E2E media offline/relink.
-   E2E cancel export.
-   Kiểm tra Windows installer/unpacked build.
-   Kiểm tra app không mở thêm cửa sổ CMD không mong muốn.
-   Kiểm tra cleanup temporary files/cache.
-   Kiểm tra memory sau nhiều lần import/play/export.
-   Chốt release checklist và rollback plan.

------------------------------------------------------------------------

## 4. Các nguyên tắc không được vi phạm

1.  Không đưa FFmpeg/FFprobe hoặc WASM builds trở lại nếu chưa có ADR
    mới được duyệt.
2.  Không rewrite project schema nếu chưa có migration và
    backward-compatibility tests.
3.  Không để UI tự tính timeline semantics riêng với core.
4.  Không coi "file export được" là đủ; phải kiểm tra hình ảnh, âm
    thanh, duration và khả năng mở lại.
5.  Không bật feature trong UI nếu export chưa hỗ trợ mà không có trạng
    thái limitation rõ ràng.
6.  Không tối ưu timeline bằng cách bỏ undo/redo, snapping, ripple,
    keyframes hoặc gesture correctness.
7.  Không chạy full project serialization/localStorage write trong mỗi
    animation frame.
8.  Không mount mọi clip/thumbnail khi không nằm trong viewport nếu
    project lớn.
9.  Không dùng một deep watcher toàn project làm cơ chế đồng bộ cho mọi
    subsystem nếu có thể thay bằng revision/event selectors.
10. Không thay Nuxt/Electron/Rust stack trong phase ổn định này.

------------------------------------------------------------------------

## 5. Kế hoạch chia task cho AI coding agent

### Sprint 0 --- Audit reproducible baseline

Deliverables: - `docs/audit/current-baseline.md` -
`docs/audit/known-limitations.md` - `docs/audit/fixture-matrix.md` - log
test/build đầy đủ - danh sách lỗi tái hiện được với steps +
expected/actual

Không sửa feature trong sprint này trừ khi cần sửa harness để đo.

### Sprint 1 --- Timeline performance

Deliverables: - performance instrumentation - viewport
culling/virtualization - visible ruler tick generation - gesture rAF
batching - filmstrip/waveform decode cancellation/cache - stress tests

### Sprint 2 --- Project/media load

Deliverables: - load state machine - revision-safe save/load -
deterministic asset resolution - relink/cache consistency - project
reopen tests - media lifecycle tests

### Sprint 3 --- Export MVP parity

Deliverables: - shared compositor contract - single-row baseline pixel
parity - multi-row compositing - text overlay export - transform/crop
parity - robust output validation

### Sprint 4 --- Advanced renderer features

Deliverables: - transitions - masks/blend - effect-by-effect export -
reverse/retime - unsupported policy cho tính năng chưa có thuật toán

### Sprint 5 --- Release hardening

Deliverables: - full E2E - Windows packaging - memory/resource soak
test - user-facing limitations documentation - release candidate

Mỗi sprint phải kết thúc bằng commit nhỏ, tests và báo cáo. Không gom
tất cả thay đổi vào một commit lớn.

------------------------------------------------------------------------

## 6. Definition of Done tổng thể

TM Studio chỉ được coi là ổn định khi đạt đủ:

-   [ ] Dev server và Electron desktop khởi động ổn định.
-   [ ] Không có typecheck/lint/test regressions không giải thích được.
-   [ ] Timeline stress project vẫn thao tác mượt theo performance
    budget đã đo.
-   [ ] Clip drag/trim/snap/ripple/undo/redo chính xác.
-   [ ] Project save/load/recovery không mất hoặc trộn dữ liệu.
-   [ ] Asset relink và offline state rõ ràng.
-   [ ] Preview không hiển thị stale frame sau khi đổi clip/project.
-   [ ] Export hỗ trợ toàn bộ feature được đánh dấu supported.
-   [ ] Feature chưa hỗ trợ được chặn trước render và nêu rõ clip/track
    gây lỗi.
-   [ ] Exported file mở được, có audio/video đúng, duration đúng.
-   [ ] Preview/export golden-frame parity đạt ngưỡng.
-   [ ] Cancel/error không rò decoder, encoder, canvas, URL hoặc file
    tạm.
-   [ ] Windows package chạy trên máy sạch và không bật cửa sổ console
    thừa.

------------------------------------------------------------------------

## 7. Việc cần làm ngay tiếp theo

1.  Chốt baseline từ working tree thực tế của người dùng; GitHub source
    inspection không thể thay thế việc chạy app trên máy.
2.  Yêu cầu người dùng cung cấp 1 project `.tmcut`/project JSON đã gặp
    lỗi (đã loại bỏ thông tin riêng tư) và một vài media fixture có
    quyền sử dụng.
3.  Tái hiện riêng ba nhóm lỗi: timeline lag, media load sai, export bị
    từ chối/failed.
4.  Chỉ sau khi có log và project fixture mới quyết định sửa module nào
    trước.

**Kết luận:** Giữ TM Studio và nâng cấp theo lát cắt. Ưu tiên timeline
virtualization/performance, project/media load reliability và
compositor/export parity. Không bắt đầu bằng việc đổi framework hoặc
viết lại engine.
