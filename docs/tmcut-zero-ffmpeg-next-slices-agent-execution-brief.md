# TMCut — Next Slices Execution Brief
## Hướng dẫn AI Coding Agent tiếp tục Zero FFmpeg / Zero FFprobe

**Phạm vi:** tiếp tục queue E4 → F → G → H → I → J → K.  
**Kiến trúc đã chốt:** TMCut Browser/Electron dùng chung một Browser-first Media Engine: Mediabunny + WebCodecs + Web Audio + TMCut Core. Không có FFmpeg, FFprobe, FFmpeg.wasm, FFprobe-like WASM hoặc media CLI fallback trong sản phẩm này.

> Đây là chỉ thị triển khai tiếp theo, không thay thế audit/ADR/mã nguồn thực tế. Agent phải xác minh repository và working tree trước khi sửa.

---

# 1. Quyết định kiến trúc không được thay đổi

## 1.1 Runtime chính thức

- **Mediabunny:** media input, container/track parsing, demux và mux trong phạm vi API/format hỗ trợ.
- **WebCodecs:** decode/encode khi browser/Electron runtime hỗ trợ và capability check thành công.
- **Web Audio API:** audio decode/playback/analysis/mixing theo phạm vi hỗ trợ.
- **TMCut Core:** project, timeline evaluator, effects, transitions, filters, animations và composition semantics.
- **Canvas/WebGL2/WebGPU:** render backend của TMCut Core theo capability.
- **Browser/Electron Platform Adapter:** file access, OPFS/IndexedDB, download, workers và Electron IPC an toàn.

Không thêm FFmpeg/FFprobe native vào runtime chính thức; không thêm `@ffmpeg/ffmpeg`, FFmpeg.wasm, FFprobe-wasm hoặc thư viện tương đương làm fallback; không giữ desktop-only media engine; không tạo effect implementation thứ hai chỉ để bù preview/export mismatch.

Nếu runtime không hỗ trợ codec/container hoặc chức năng cần thiết, trả về capability/unsupported rõ ràng. Không tự đổi định dạng, không âm thầm bỏ effect, không gọi engine khác.

## 1.2 Quyết định sản phẩm Q1–Q9 đã chốt

| Mục | Quyết định |
|---|---|
| Stabilization / vidstab | Loại bỏ khỏi Browser Edition; project cũ phải giữ dữ liệu và đánh dấu unsupported |
| Subtitle burn-in | Chuyển thành text track và vẽ qua `paintStack`; không giữ libass/ASS renderer |
| Binary FFmpeg 471 MiB | Bỏ khỏi package/build ở slice I; giữ file local tới khi parity xanh và chủ dự án xác nhận |
| Server media processing | Gỡ server render/analyze/proxy bằng FFmpeg; không triển khai cloud render trong phạm vi này |
| Server upload | Giữ Storage Upload API thuần nếu cần Cloud/Stock Library; upload opt-in, không xử lý media |
| Project schema | Giữ schema v3 (`version: 3`, `timeline.tracks` theo audit); sửa plan mẫu cho khớp |
| Project cũ thiếu file | Hiện Media Offline/Missing Media + Relink; không tự mở dialog, không xóa asset reference |
| Font | Dùng font đóng gói đến slice J; slice J đánh giá import font riêng |
| FFmpeg backup | Giữ untracked tới hết slice I/parity; không `git clean` làm mất backup |
| Hai test đỏ | Được phép sửa đúng login remember-password và package `imports`; bảo toàn `tm-hub-client 1.0.9`, synthetic blob và WIP khác |

---

# 2. Blocking item: `zero-ffmpeg-audit.md:406`

Audit ghi một đường code còn `spawn ffmpeg`, nhưng engine thay thế chưa được xác định. Đây là **blocking item trước slice I**. Không để một `spawn` chưa phân loại tồn tại rồi cắt binary ở slice I.

## 2.1 Audit bắt buộc

Mở đúng file/dòng trong repository, trace toàn bộ:

1. File, function và callsite chứa `spawn`/`exec`.
2. Arguments/options chính xác truyền vào process.
3. Input/output: File, path, URL, stream, temp file, JSON, stdout/stderr.
4. Caller trực tiếp/gián tiếp: UI, composable, API route, queue, IPC.
5. Kết quả được dùng ở đâu và side effects.
6. Progress, cancel, retry, timeout, cleanup.
7. Test hiện hữu và hành vi người dùng nhìn thấy.
8. Đây là media processing hay process/file orchestration không liên quan media.

Ghi vào `docs/audit/zero-ffmpeg-audit.md` hoặc báo cáo audit hiện tại:
- Exact file + symbol + line.
- Mục đích chức năng.
- Input/output contract.
- Callers.
- Mapping thay thế.
- Behavior có thể mất.
- Test chứng minh thay thế.
- Quyết định replace/remove/defer.

## 2.2 Hướng thay thế theo chức năng — không chọn chỉ từ tên function

| Chức năng thật | Hướng thay thế được phép |
|---|---|
| Probe container/track/duration/codec | `MediaProbeService` dùng Mediabunny; field không lấy được phải unknown/undefined, không đoán |
| Demux/đọc sample/packet | Mediabunny API theo version đang cài |
| Decode video/frame sampling | WebCodecs `VideoDecoder` sau capability check; HTMLVideoElement chỉ cho preview phù hợp, không giả làm offline frame-accurate export |
| Decode/đo audio | Web Audio API hoặc WebCodecs `AudioDecoder` khi hỗ trợ; Mediabunny để đọc/demux nguồn |
| Thumbnail | Browser media pipeline + Canvas/WebCodecs/Mediabunny; worker, cancel, cache |
| Proxy | Nếu cần, tạo local bằng browser engine và lưu local; không tạo FFmpeg server proxy |
| Render/effect/transition/text | TMCut Core shared evaluator + renderer; không chuyển thành FFmpeg filtergraph |
| Export/encode/mux | WebCodecs + Mediabunny muxer; capability check, backpressure, timestamp deterministic |
| Upload/lưu trữ file | Storage Upload API thuần, chỉ khi user yêu cầu; không media-processing |
| File/process không liên quan media | Giữ nếu thật sự cần, nhưng không được mang media CLI vào sản phẩm |

Nếu tác vụ không thể thay thế trong Browser-first scope:
- Không giữ `spawn ffmpeg`.
- Không thêm native CLI hoặc WASM.
- Không giả lập kết quả hoặc âm thầm bỏ chức năng.
- Đánh dấu `unsupported`/`deferred`, giải thích UI/docs và giữ metadata project nếu cần.
- Đề xuất ADR nếu việc loại bỏ ảnh hưởng đáng kể đến sản phẩm.

## 2.3 Điều kiện đóng blocker

Chỉ đóng khi có service thay thế hoặc quyết định remove/defer; mọi caller cũ đã chuyển/loại bỏ có chủ đích; có test cho hành vi mới và unsupported; không còn đường gọi `spawn ffmpeg`; không còn server/client/IPC path ẩn gọi lại đường cũ.

---

# 3. Queue triển khai chính thức

Thứ tự đã thống nhất: **E4 (#119) → F (#103, gộp #96) → G → H → I → J → K**.

Không tự đảo thứ tự. Nếu phát hiện dependency mới, cập nhật dependency graph và giải thích trước khi đổi queue.

## Slice E4 — AutoCut + hiệu chuẩn −30 dB trên giọng nói thật (#119)

Mục tiêu:
- Nối hoàn chỉnh AutoCut với pipeline Browser-first.
- Dùng audio decode/analysis từ Web APIs, không gọi FFmpeg.
- Hiệu chuẩn ngưỡng −30 dB dựa trên giọng nói thật và ghi rõ metric đang đo.

Yêu cầu:
1. Trace import → audio decode → analysis windows → voice/activity segments → AutoCut decisions.
2. Xác nhận −30 dB là dBFS theo metric nào: sample peak, window RMS hay metric khác. Không gọi chung “volume dB” khi chưa định nghĩa.
3. Nếu dùng RMS, tài liệu hóa window size, hop size, smoothing, silence/noise floor và công thức dBFS.
4. Không hardcode một ngưỡng duy nhất nếu dữ liệu cho thấy cần calibration hoặc hysteresis.
5. Kiểm thử mẫu giọng nói thật với điều kiện khác nhau: giọng nhỏ/lớn, khoảng lặng, nền nhiễu, âm cuối câu và nhiều người nói nếu nằm trong scope.
6. Có preview segment và giải thích tại sao đoạn được giữ/cắt.
7. Có progress/cancel, không khóa UI.

Exit criteria:
- AutoCut gọi đúng browser audio analysis path.
- Threshold metric được định nghĩa và ghi trong docs.
- Có bộ đánh giá tái lập, ghi rõ false-positive/false-negative nếu đo được.
- Không dùng FFmpeg/FFprobe/CLI.
- Test trường hợp biên pass.

## Slice F — Composite Preview (#103), gộp #96

Mục tiêu:
- Hoàn thiện preview composite nhiều track/layer.
- Chỉ có một preview path.
- Dùng cùng TMCut Core evaluator/render semantics với export.

Yêu cầu:
1. Trace `paintStack` và composition pipeline hiện tại.
2. Xác định layer order, opacity, crop, transform, blend, text, shape, overlay, effect, transition và keyframe.
3. Preview timestamp T lấy scene từ cùng `evaluateTimeline(project, T)` mà export sử dụng.
4. `TmcutFxThumb` dùng đúng Effect Definition + renderer behavior của TMCut Core; không CSS animation riêng để giả lập nội dung video.
5. Thumbnail/list preview được giảm resolution/quality nhưng không đổi effect semantics.
6. Không dùng wall-clock timer làm timeline source of truth.
7. Test frame đầu/giữa/cuối clip, transition boundary và keyframe boundary.
8. Test resource lifecycle: VideoFrame, ImageBitmap, texture, object URL, worker; cancel stale preview request.

Exit criteria:
- Không còn hai luồng composite preview cạnh tranh.
- Nhiều track/layer hiển thị đúng thứ tự.
- Preview và export dùng cùng evaluator/composition rules.
- Có visual regression fixtures.
- UI responsive khi scrub và đổi effect.

## Slice G — Audio Engine + Waveform

Mục tiêu:
- Hoàn thiện audio playback/mix và waveform browser-first.
- Chứng minh local cache có đường đọc thật để hỗ trợ ADR-033.

Yêu cầu:
1. Audio decode bằng Web Audio/WebCodecs theo capability; không giả định mọi codec hỗ trợ.
2. Hỗ trợ track gain, mute/solo, volume keyframes và crossfade trong scope.
3. Waveform tính theo bucket (min/max hoặc RMS), lưu metadata gọn.
4. Cache key gắn asset fingerprint, track, resolution, algorithm/version.
5. Cache read path thật: mở lại project không phải phân tích lại vô điều kiện.
6. Có quota/eviction/clear cache và xử lý cache corruption.
7. Local-first; upload Cloud/Stock Library là thao tác riêng do user chọn.
8. Test audio gap/overlap, sync, trim, playback rate trong scope.

Exit criteria:
- Waveform tạo và đọc lại từ cache.
- Playback/mix không lệch timeline.
- Cache hoạt động offline trong phạm vi dữ liệu local còn tồn tại.
- ADR-033 có bằng chứng để quyết định status.

## Slice H — Export WebCodecs + Mediabunny muxer

Mục tiêu:
- Export offline deterministic từ TMCut Core.
- Không dùng FFmpeg, FFmpeg.wasm hay MediaRecorder làm offline exporter chính.

Yêu cầu:
1. Chạy `VideoEncoder.isConfigSupported()` trên config/preset thực tế của runtime mục tiêu; ghi kết quả, không đoán hardware H.264.
2. Kiểm tra `AudioEncoder.isConfigSupported()` tương tự nếu export audio.
3. Tạo capability matrix theo browser/Electron, codec/container, resolution, FPS.
4. Frame timestamp tính từ frame index + rational FPS/timebase, không dùng timer/sleep để quyết định thời điểm frame.
5. Lấy frame từ cùng timeline evaluator/composition renderer ở slice F.
6. Có encoder backpressure; giới hạn frames in-flight; theo dõi encode queue.
7. Close/dispose VideoFrame/AudioData đúng ownership.
8. Dùng Mediabunny muxer cho container đã xác minh.
9. Audio/video timestamp đồng bộ; flush encoder trước finalize muxer.
10. Có progress, cancel, cleanup và xử lý lỗi.
11. Ưu tiên output sink/stream nếu API thực tế hỗ trợ; nếu Blob output có giới hạn bộ nhớ, có quota/cảnh báo.
12. Unsupported config phải báo rõ, không tự đổi container/codec.

Exit criteria:
- Output mở/play được trên player mục tiêu.
- Audio/video sync đúng test.
- Preview frame và export frame có visual comparison theo tolerance đã định.
- Encode/mux/cancel/error tests pass.
- Kết quả `VideoEncoder.isConfigSupported` được ghi vào report.

## Slice I — Remove FFmpeg execution/build/runtime

Chỉ bắt đầu sau khi H đạt exit criteria và có backup/parity evidence theo Q3/Q8.

Checklist:
1. Remove FFmpeg media execution routes/server handlers và client callers đã được chuyển.
2. Remove `ffmpeg.controller.cjs` sau khi mọi caller đã thay thế/loại bỏ.
3. Audit đủ 12 `child_process` references: phân biệt media FFmpeg với process không liên quan; không xóa bừa process hợp lệ.
4. Audit đủ 10 IPC channels: trace từng channel tới caller; chỉ remove/replace channels FFmpeg.
5. Audit 3 DB tables: kiểm tra migrations, dữ liệu, foreign keys, references và rollback/retention. Không DROP dữ liệu khi chưa có backup/plan.
6. Bỏ 471 MiB binary và resources FFmpeg khỏi `electron-builder.yml`/release artifacts.
7. Giữ binary local trên máy dev đến khi parity được xác nhận và chủ dự án đồng ý xóa.
8. Giữ FFmpeg backup folder untracked; không chạy `git clean` làm mất backup.
9. Xóa dependency/package/script/config/env/docs hướng dẫn FFmpeg.
10. Remove server media routes, nhưng giữ Storage Upload API thuần theo Q4*.
11. Search toàn repo và build output để phát hiện references ẩn.
12. Bảo đảm project cũ có missing media/unsupported effect vẫn mở được.

Exit criteria:
- Build/release không chứa FFmpeg resources.
- Không còn runtime media spawn FFmpeg.
- Không còn route/IPC/UI gọi server FFmpeg.
- Storage upload thuần còn hoạt động nếu thuộc scope.
- Không mất project/data/schema.
- Có test và audit evidence.

## Slice J — 8 emitters + 2 parsers trong Core; font review

Mục tiêu:
- Chuẩn hóa 8 emitter và 2 parser vào core boundaries sau khi FFmpeg path đã gỡ.

Yêu cầu:
1. Trước khi sửa, lập bảng từng emitter/parser: file, symbol, input schema, output schema, caller, side effects, tests.
2. Xác định emitter là project serialization, command/event, render instruction hay media output; không suy luận chỉ từ tên.
3. Parser parse/validate dữ liệu, không khởi chạy process.
4. Core API deterministic, typed, có validation/error model.
5. Không import `electron`, `node:fs`, `node:child_process`, DOM hoặc UI framework trực tiếp vào pure core.
6. Thêm unit/contract tests cho từng emitter/parser và compatibility fixtures.
7. Đánh giá font import từ máy bằng FontFace + OPFS nếu hợp lý. Nếu chưa làm, ghi limitation và giữ font đóng gói.

Exit criteria:
- 8 emitters + 2 parsers được định danh và có contract.
- Có test cho từng contract.
- Core boundaries không phụ thuộc platform/UI.
- Project v3 compatibility không bị phá.

## Slice K — Parity + docs + final audit

Mục tiêu:
- Chứng minh Browser/Electron hoạt động bằng media engine mới và không còn phụ thuộc FFmpeg.

Yêu cầu:
1. Lập bộ project/media fixtures tái lập.
2. So sánh frame output cũ/new nếu backup/reference có sẵn; ghi rõ feature đã bỏ hoặc không thể so sánh.
3. Không bắt buộc byte-identical; so visual/audio semantics với tolerance công bố.
4. Test project cũ theo migration hiện hữu; giữ schema v3.
5. Test relink media và offline project.
6. Test browser/Electron parity theo capability matrix.
7. Test import/probe/thumbnail/preview/audio/waveform/export/cancel/cleanup.
8. Cập nhật ADR, audit, architecture docs, limitations và build instructions.
9. Final search dependencies, binaries, child_process, IPC, DB routes, scripts, CI và release artifacts.
10. DoD report dùng `PASS`, `FAIL`, `NOT APPLICABLE`, `NOT TESTED` kèm evidence.

Exit criteria:
- Không claim feature parity nếu chưa có test evidence.
- Không đánh dấu unsupported feature là complete.
- Mọi limitation được ghi rõ.
- DoD chỉ tick xanh theo evidence thật.

---

# 4. ADR-033 — giữ CHỜ đến G/H

ADR-033 tiếp tục `PROPOSED / PENDING VALIDATION` tới khi G/H có bằng chứng.

Nguyên tắc:
- Local-first: import và xử lý local là mặc định.
- Cache phải có đường đọc thật, không chỉ API ghi.
- Không bắt buộc upload file lên server để dùng editor.
- Cloud/Stock Library upload là opt-in, user chủ động.
- Storage Upload API không phải media-processing route.
- Không có server-side FFmpeg analyze/proxy/render.

Cuối G/H:
- Nếu cache read/reopen/offline path test tốt: đề xuất ADR-033 Accepted.
- Nếu chưa: ghi blocker, giữ Pending; không chuyển sang mandatory upload.
- Không để ADR khiến code tự upload media ngoài ý muốn.

---

# 5. DoD hiện tại — không ép xanh trước slice tương ứng

Các mục còn thiếu đã được nêu:
- 471 MiB FFmpeg resources.
- 12 `child_process` references.
- 10 IPC channels.
- 3 DB tables.
- WebCodecs encode.
- JavaScript/Mediabunny muxer.
- `ffmpeg.controller.cjs`.

Phân bổ:
- WebCodecs encode + muxer: H.
- FFmpeg routes/controller/process/IPC/build resources: I.
- Core emitters/parsers: J.
- End-to-end evidence và docs: K.

Không đánh dấu `PASS` trước slice tương ứng. Dùng `NOT DONE — scheduled for H/I/J/K`. Giữ inventory cụ thể từng child_process, IPC channel, DB table, không chỉ ghi tổng số.

---

# 6. Bảo vệ working tree và dữ liệu

1. Chạy `git status --short` trước mỗi slice.
2. Ghi file user WIP; không overwrite/revert.
3. Không `git reset --hard`, `git clean -fdx` hoặc script xóa hàng loạt.
4. Không xóa backup/binary local theo Q3/Q8.
5. DB migration phải có backup, kiểm tra references và rollback/retention plan.
6. Không xóa project fields hoặc asset references khi thay engine.
7. Không commit secret, local media, binary backup hoặc user data.
8. Mỗi slice có checkpoint riêng nếu chủ dự án cho phép.
9. Mỗi thay đổi phải chỉ ra file/symbol và lý do.
10. Nếu xung đột WIP, dừng tại file đó; không tự giải quyết bằng ghi đè.

---

# 7. Quy trình làm việc của agent

Trước mỗi slice:
- Đọc ADR/audit mới nhất.
- Kiểm tra git status và branch.
- Xác định issue/ticket và dependency.
- Viết plan ngắn gồm file sẽ sửa, behavior cần đạt, test cần chạy.
- Xác minh API thư viện theo version lockfile và type definitions thực tế.

Trong slice:
- Sửa theo lát nhỏ.
- Không refactor ngoài phạm vi.
- Không thêm engine/fallback ngoài quyết định.
- Không dùng mock để tuyên bố integration thật đã chạy.
- UI phải kiểm tra loading/error/unsupported/offline/cancel states.

Sau mỗi slice:
- Chạy targeted tests, rồi suite liên quan.
- Chạy lint/typecheck/build phù hợp.
- Ghi số test pass/fail/skipped.
- Ghi kết quả thực tế, không suy diễn.
- Ghi files changed, regressions, limitations.
- Cập nhật audit/ADR/DoD.
- Chỉ chuyển slice khi exit criteria đạt; nếu blocker, báo rõ.

---

# 8. Prompt gửi AI Coding Agent

```text
Bạn tiếp tục làm việc trên repository TMCut dựa trên audit và roadmap hiện tại.

Kiến trúc chính thức:
- Browser-first, Zero FFmpeg / Zero FFprobe.
- Mediabunny + WebCodecs + Web Audio + TMCut Core là media pipeline duy nhất.
- Web và Electron dùng chung Media Engine.
- Không FFmpeg, FFprobe, FFmpeg.wasm, FFprobe-like WASM, native media CLI hay desktop-only media engine.
- Giữ Project Schema v3 hiện tại.
- Server upload chỉ là Storage Upload API thuần, opt-in; không phải media processing.
- Các quyết định Q1–Q9 nằm trong execution brief này.

Queue bắt buộc:
E4 (#119) → F (#103, gộp #96) → G → H → I → J → K.

BLOCKER:
Mở docs/audit/zero-ffmpeg-audit.md:406 và trace lệnh spawn ffmpeg tới function, arguments, input/output, callers, side effects, progress/cancel và tests.
Không đoán engine thay thế chỉ từ dòng spawn.
Map theo chức năng:
- Probe/demux → Mediabunny.
- Decode/frame analysis → WebCodecs khi supported.
- Audio analysis → Web Audio/WebCodecs AudioDecoder.
- Preview/effects/transitions → TMCut Core shared renderer.
- Export → WebCodecs + Mediabunny muxer.
- Storage upload → API thuần, opt-in.
Nếu feature không thể thay thế trong Browser-first scope, đánh dấu unsupported/deferred, bảo toàn project metadata và báo rõ; tuyệt đối không tạo fallback engine.

Trước khi code:
1. Đọc audit/ADR liên quan.
2. Kiểm tra git status, branch, WIP và backup.
3. Inventory từng child_process, IPC channel, DB table và route.
4. Xác minh package/API version trong lockfile và type definitions.
5. Báo plan files/symbols/tests cho slice tiếp theo.

Thực hiện E4 → F → G → H → I → J → K.
Không nhảy slice nếu exit criteria chưa đạt.
ADR-033 giữ Pending đến khi G/H có bằng chứng cache read path và local-first.

Riêng slice I:
- Loại FFmpeg khỏi package/build/runtime.
- Không xóa binary local hoặc backup trước khi chủ dự án xác nhận sau parity.
- Không xóa Storage Upload API thuần.
- Không xóa child_process không liên quan media.
- Kiểm tra migration/retention trước khi xử lý 3 bảng DB.

Bảo vệ working tree:
- Không git reset --hard.
- Không git clean -fdx.
- Không ghi đè WIP.
- Không xóa backup.
- Không thay đổi tm-hub-client 1.0.9 hoặc synthetic blob ngoài phạm vi đã duyệt.

Sau mỗi slice, báo:
- Summary.
- Files/symbols changed.
- Tests/build/lint/typecheck thực chạy và kết quả.
- DoD status theo evidence.
- Known limitations/blockers.
- Slice tiếp theo.

Bắt đầu bằng việc xử lý blocker zero-ffmpeg-audit.md:406, sau đó tiếp tục E4 nếu dependency của E4 đã đủ. Không hỏi lại Q1–Q9 đã được chốt.
```

---

# 9. Mẫu báo cáo tiến độ sau mỗi slice

| Field | Nội dung |
|---|---|
| Slice | E4 / F / G / H / I / J / K |
| Status | PASS / BLOCKED / PARTIAL |
| Files changed | Danh sách file |
| Tests | Pass / Fail / Skipped |
| Build | Kết quả thực tế |
| DoD closed | ID/mục được đóng |
| DoD remaining | Mục chưa xong |
| Regression | Có/không + evidence |
| User data impact | Có/không |
| Next slice | Slice tiếp theo và dependency |

**Nguyên tắc cuối:** không chạy nhanh để có một bản build xanh giả tạo. Mục tiêu là thay media engine thật, giữ project cũ, preview/export nhất quán, local-first và loại bỏ FFmpeg khỏi đúng phạm vi sau khi đã chứng minh pipeline thay thế.
