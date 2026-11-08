# ADR-028…ADR-033: kiến trúc zero-FFmpeg, browser-first

Register này chốt sáu quyết định mà plan [docs/tmcut-zero-ffmpeg-zero-ffprobe-browser-first-roadmap.md](file:///D:/Applications/tm-studio/docs/tmcut-zero-ffmpeg-zero-ffprobe-browser-first-roadmap.md) §26 yêu cầu tạo,
và ghi lệnh supersede cho hai ADR đang giữ FFmpeg trong code. Nó là **nguồn quyết định**, không phải nhật ký công việc:
số liệu đo được nằm ở [docs/audit/zero-ffmpeg-audit.md](file:///D:/Applications/tm-studio/docs/audit/zero-ffmpeg-audit.md). Lịch thi hành nằm ở ba nơi, và phân công đã đổi từ khi file này bắt đầu:
slice zero-FFmpeg ghi ở §13–§14 của audit, slice V4 #82…#95 ghi ở dòng trạng thái của roadmap V4, còn
[docs/extraction-plan.md](file:///D:/Applications/tm-studio/docs/extraction-plan.md) là nhật ký V4 và **dừng ở entry #81 ngày 2026-11-02** (đo: 920 dòng CRLF, entry cuối mang nhãn "V4 G2").

Người duyệt: chủ repo, trong cùng phiên ra chỉ thị "xoá hết và build theo đúng hướng dự án" (2026-11-03).
Quyết định kỹ thuật (thư viện, đường đi của pipeline) agent tự chủ động; quyết định **phá sản phẩm** (khai tử tính năng, xoá binary)
ghi ở §8 kèm điều kiện phải hỏi trước khi thi hành.

---

## 0. Vì sao nhãn là 028…033, không phải 001…006

Đo **trước khi ghi register này** (2026-11-03) bằng `grep -rho` trên pattern `ADR-` theo sau là một hoặc nhiều chữ số, chạy với `docs/*.md`:
tầng một ra **27** nhãn, ADR-001…ADR-027; chạy trên cả `docs/` (kèm thư mục con) ra **28**, vì audit zero-FFmpeg đã đặt một placeholder `ADR-028` ở §5.3.

Đo **lại sau slice A2** bằng script đếm cùng pattern trên mọi file `.md` dưới `docs/`: tầng một **30** nhãn (ADR-028/030/032 giờ hiện ra vì chính
lệnh supersede trỏ vào chúng), đệ quy **33**, liền mạch 001…033, không nhãn nào trống. Hai con số đầu vẫn là căn cứ của quyết định vì chúng đo
trên cây **chưa** có register; hai con số sau xác nhận dãy 028…033 đã cắm xuống mà không tạo va chạm.

Repo đang dùng **hai gia đình số cho cùng một khoảng**:

| Gia đình | Định nghĩa ở | Ví dụ nội dung |
|---|---|---|
| ADR-001…ADR-012 | `docs/tmcut-v4-universal-rendering-multiplatform-roadmap.md` §18 | ADR-001 = "Shared Project/Timeline Core"; ADR-006 = "FFmpeg optional backend" |
| ADR-013…ADR-027 | [docs/v4-phase-0-audit.md §7](file:///D:/Applications/tm-studio/docs/v4-phase-0-audit.md#L229) | ADR-017 = tên package/alias core; ADR-027 = trim phải re-phase `speedPoints` |

Plan §26 đánh số sáu quyết định của nó là ADR-001…006. Giữ nguyên số đó sẽ tạo **hai** ADR-001 cùng tồn tại —
"Zero FFmpeg" và "Shared Project/Timeline Core" — và nhãn sau đang được source code trích dẫn, nên va chạm không chỉ là lỗi văn phong.
Vì vậy register này dùng số tiếp theo của dãy đang chạy (028…033) và giữ nguyên ánh xạ xuống dưới để ai đọc plan vẫn tra được.

| Plan §26 | Nhãn repo | Tên tắt |
|---|---|---|
| ADR-001 | **ADR-028** | Zero FFmpeg / Zero FFprobe |
| ADR-002 | **ADR-029** | Mediabunny là toolkit demux/mux |
| ADR-003 | **ADR-030** | WebCodecs ưu tiên, capability check bắt buộc |
| ADR-004 | **ADR-031** | Preview và export dùng chung semantics |
| ADR-005 | **ADR-032** | Browser-first, Electron không media engine riêng |
| ADR-006 | **ADR-033** | Local-first privacy |

---

## 1. Bảng trạng thái (đo ngày 2026-11-03)

| ADR | Quyết định | Trạng thái code | Bị chặn bởi |
|---|---|---|---|
| ADR-028 | FFmpeg/FFprobe bị loại khỏi repo, build và dependency tree | **ĐÃ ÁP DỤNG** — slice I (2026-11-08, audit §54) cắt engine: **0** `.exe` tracked/working-tree, **0** FFmpeg trong `package.json` + lockfile, **0** runtime media spawn, **0** kênh IPC FFmpeg, 3 bảng DB ngừng tạo/truy cập (không DROP/DELETE). Slice J (2026-11-08, audit §55) cắt nốt **syntax**: 12 phát ngôn (8 emitter + 2 parser + `parseFrameRate` + health-check) nghỉ hưu, `stabilize.mjs`/`probe.mjs` xoá; core chỉ còn semantics | không còn — điều kiện đóng đã đo ở §55 |
| ADR-029 | Mediabunny đảm nhận demux + mux, không phải "FFprobe clone" | **MỘT PHẦN** — leg probe đã code ở slice B, commit `1b57ca1`, và **đã có consumer** từ slice C1: verdict của nó là thứ quyết định `importStatus`/`status` của asset trong library (audit §16). Từ lượt H3b, leg mux **đã có dòng code đầu tiên**: `createEncodeSession` mở `Output` và hai `EncodedPacketSource` (audit §51). Từ lượt H3c, leg mux **có file thật**: mp4 28 305 byte đọc lại bằng chính `Input` của Mediabunny, hai track mỗi track 3,000 s, và bằng `<video>` của trình duyệt (audit §52.5) | H3d: consumer trong app (nút export → `renderAt` → session → tải file) |
| ADR-030 | decode/encode qua WebCodecs, hỏi capability trước khi dùng | **MỘT PHẦN** — mỗi lượt H đóng băng thêm một tầng thành luật ở core; số đo ở §48–§52. H1: **luật** của leg encode (preset đến từ câu trả lời đã ghi — `unmeasured` ≠ `supported`, runtime đổi codec là `substituted` = thất bại; timestamp từ index × FPS hữu tỉ, không từ `canvasFpsValue`; bound in-flight ≠ 0). H2: **câu hỏi** cũng là luật (`planEncodePresets`: level theo Annex A, container theo codec family, cả hai spelling AAC) + ma trận encode **đo thật** trên Chrome 156. H3a: **đồng hồ audio** là luật (packet theo số sample, duration là hiệu hai vị trí, packet cuối mang phần còn lại). H3b: seam `createEncodeSession` chạy cả hai đồng hồ. H3c: **encoder thật nhận sample thật và file thật đã ra**, và vì số đo mà ba chỗ phải sửa — chunk audio khớp theo `ordinal`, không theo timestamp (`AudioEncoder` tự sinh clock, §52.2), `AUDIO_PACKET_FRAMES` là **cỡ frame của chính encoder** (§52.1), AAC **không flush nổi** trên một packet, sàn 2 hand (§52.1). Phần còn lại: **chưa ai dùng trong app**, không phải "chưa ai chạy". Hai điều vẫn mở: `hardwareAcceleration` không phân biệt mềm/cứng trên máy này nên **hardware H.264 chưa chứng minh**; runtime nhận config mà Annex A cấm (§49.5) nên `supported: true` ≠ "file hợp pháp". | slice H (leg encode + mux), còn mỗi consumer |
| ADR-031 | một timeline evaluator + một composition model cho hai host | **ĐÃ ÁP DỤNG** — `evaluateTimeline`, `renderAt`, `createFrameScheduler`, `paintStack`. Từ lượt H3d, exporter có thêm **luật nội dung** và **luật chữ nhật plate** (`planEncodeContent`, `planEncodePlate`, audit §53): cả hai **không** viết lại quy tắc nào, mà đọc qua đúng `selectFileRows` / `blendModeOf` / `normalizeMask` / `resolveClipLayout` / `isTrackMuted` / `createFrameScheduler` — chỗ thứ hai tự phân loại là chỗ thứ hai có cơ chế lệch. Slice J (audit §55) trả nốt: không module core nào còn in văn bản FFmpeg, và mỗi luật chỉ còn **một** cách diễn đạt — `lutGrade`, `maskCssMaskImage`, `evalKeyframe`, `rampElapsedForConsumed`, `gainAt`, `computeFitObjectStyle`, `cutsToShots` | không còn — semantics một nguồn |
| ADR-032 | Electron là shell, không sở hữu media engine thứ hai | **ĐÃ ÁP DỤNG** — engine HTML-video thứ hai đã xoá (ADR-023); engine FFmpeg desktop đã cắt ở slice I (audit §54: `ffmpeg.controller.cjs` gone, 0 media spawn, desktop đọc `packages/core/src`). Một service cho hai host: nhánh desktop và web của `analyzeAsset` cùng đi qua một verdict table (audit §16.2) | không còn — engine thứ hai đã chết |
| ADR-033 | media đi trong máy mặc định; rời máy là một lựa chọn hiển thị | **CHỜ** — web host vẫn stream file đã chọn lên server (`server/api/v1/media/upload.post.ts`), và **upload vẫn bắt buộc**. C1 dựng **điều kiện** (fingerprint dẫn xuất từ path + revision, audit §16.2); C2 dựng **chữ** cho cùng điều kiện đó (`isMediaOffline` + plate Media Offline trên ba bề mặt, §17); C2b dựng **cache vật lý** (`byteCache.mjs` luật + `byteStore.ts` OPFS/IndexedDB, ghi khi import/relink, đối chiếu khi mở library, §18). **Đường đọc giờ có bốn leg**: pixels (§20/D2), silence (§33/E4), waveform (§44/G2 — artifact đọc lại sau reload mà không chạm file), và **playback** (**G4b**, đo 2026-11-06, §47: `app/utils/tmcut/playbackBytes.ts` + `useTmcutPlaybackBytes.ts` thay stream URL bằng `blob:` dựng từ byte cache, luật từ chối vẫn nằm ở core). G3 và G4a không đổi mục này — chúng đổi **mức** (§45) và **thời gian** (§46), không đổi nguồn bytes. Vế **export** đã đóng (§53.12). Còn mở: `currentSrc` của element mà editor mount cùng console sweep năm route cần một session đăng nhập mà tôi không cầm credentials (§47.6). ADR-033 vì thế vẫn **CHỜ**: code đã ship, đường đọc playback đã đo trên origin `:4003` với store thật, còn thiếu phép đo trên element mount thật. | G #140 / H |

---

## 2. ADR-028 — Zero FFmpeg, Zero FFprobe

**Bối cảnh.** Kiến trúc V4 cho phép FFmpeg ở lại với tư cách backend tùy chọn (ADR-006 trong roadmap, ADR-015 trong
[v4-phase-0-audit.md:235](file:///D:/Applications/tm-studio/docs/v4-phase-0-audit.md#L235)). Plan browser-first cấm tuyệt đối (rule 1, 2, 3, 11).
Audit đo footprint thật: 471 MiB binary được đóng gói, code engine, 10 kênh IPC, 3 bảng SQLite, và các surface ngoài code mà
search-and-replace sẽ bỏ sót (§2 của audit). Hai thứ này không thể cùng đúng, nên phải có một lệnh supersede viết ra.

**Quyết định.** FFmpeg và FFprobe **không còn tồn tại** trong repo, trong dependency tree, trong build, trong IPC surface và trong docs hướng dẫn.
Không có "optional backend", không có fallback, không có WASM distribution của FFmpeg (plan §0.1 và rule 2).
Quyền lựa chọn chức năng chuyển hết sang capability của runtime: WebCodecs để decode/encode, Mediabunny để demux/mux,
Web Audio để xử lý audio, canvas/WebGL2 để compositor.

**Supersede.** ADR-006 (roadmap §18) và ADR-015 (v4-phase-0-audit §7) **không còn hiệu lực** từ ngày 2026-11-03.
Cả hai hàng đều được ghi chú tại chỗ, không xoá: lịch sử quyết định phải đọc được rằng code từng tuân theo một ADR đã bị thay, nếu không
người sau kết luận sai rằng code hiện tại đang trái quyết định.

**Hệ quả với code đang chạy.** Không có đường export nào không cần FFmpeg trong repo hôm nay (đo ở audit §6: 0 dòng cho encoder, muxer, audio engine,
OffscreenCanvas/OPFS, WebGL2). Vì vậy thứ tự thi hành là **build-then-cut**: slice B → D → F → G → H rồi mới I.
Rule 11 của plan ("không xoá tính năng đang chạy trước khi cái thay thế có test xanh") thắng mọi mong muốn gỡ nhanh.

**Điều kiện mở lại.** Chỉ một: nếu một tính năng bắt buộc của sản phẩm không tồn tại được trong browser stack, nó **khai tử có ADR mới**
hoặc tách thành một phase riêng — không quay lại FFmpeg.

---

## 3. ADR-029 — Mediabunny là toolkit demux/mux, không phải FFprobe thứ hai

**Bối cảnh.** Plan §3.1 chọn Mediabunny và cảnh báo rõ: nó nằm trong phạm vi API/format nó hỗ trợ, không phải một bản FFprobe đầy đủ.
Probe cũ của web trả `fps: 0` khi không đo được (`app/utils/tmcut/webProbe.ts:34` lúc đó — file đã bị xóa ở slice I) —
audit §5.2 chỉ ra rằng dùng `0` làm sentinel là đúng cái plan §4.3 cấm: một con số có vẻ hợp lệ thay cho "không biết".

**Quyết định.** Cài `mediabunny@1.65.1` (license MPL-2.0, hai runtime dependency đều là type-only — đã xác minh ngày 2026-11-03, audit §6)
và dùng nó cho **demux** (container, track, codec, duration, frame rate, HDR, PAR) và **mux** (mp4/webm output). Ba ràng buộc đi kèm:

1. Nó là thư viện **duy nhất** trong `app/` được chạm demuxer; mọi UI đọc qua `MediaProbeService` (rule 12). Guard
   `tmcut_media_probe.spec.ts` đếm số file import mediabunny trong `app/**` và chốt bằng 1.
2. Kết quả demux không bao giờ tự nó thành `MediaInfo`. Nó đi qua `normalizeMediaInfo` trong core, và core là nơi giữ luật:
   một trường không đọc được là **thiếu**, không phải `0`; FPS chỉ có khi có số đo; duration tự nhận nguồn
   `container | track | estimated | unknown`; mỗi khoảng trống thành một warning có tên và một `importStatus`.
3. Không coi một format Mediabunny không nhận là "file hỏng". Đó là `canDemux: false` kèm lý do, và UI phải nói được khác hai case đó.

**Trạng thái.** Leg demux đã code và đã chứng minh trên cả hai host ở slice B (audit §13). Leg mux thuộc slice H.

**Điều kiện mở lại.** Nếu một container cần dùng thật sự nằm ngoài danh sách Mediabunny đọc được, phương án là thêm một toolkit đọc
**đúng capability đó** rồi đưa về cùng `normalizeMediaInfo` — không phải quay lại binary ngoài.

---

## 4. ADR-030 — WebCodecs cho decode/encode, capability check là bắt buộc

**Bối cảnh.** Plan §0.1 buộc "use WebCodecs when available" và §14 cấm Electron có media engine riêng.
Điện thoại và máy tính không bảo đảm tồn tại một codec cụ thể; vì thế "encode được gì" là sự thật của runtime, không phải của preset.

**Quyết định.** Mọi đường decode/encode đi qua WebCodecs (`VideoDecoder`, `VideoEncoder`, `AudioDecoder`, `AudioEncoder`) sau khi
**hỏi** runtime bằng `isConfigSupported`, và kết quả hỏi được lưu thành capability của host chứ không suy ra từ tên máy.
Ba luật dẫn xuất:

1. Không có preset mặc định. Export nhận một danh sách yêu cầu, cắt nó theo capability matrix của host, và báo phần nó không làm được.
2. Capability được đọc một lần cho mỗi host (`buildMediaCapabilities` trong core), không rải `typeof VideoEncoder` khắp UI.
3. Một codec nguồn **không encode được** không làm export im lặng đổi codec: nó chặn `canExportSourceCodec` và in limitation
   (`source-codec-encode`, `source-audio-encode`) mà người dùng thấy trước khi bấm Export.

**Trạng thái.** Phần "hỏi" đã có trong slice B: probe trả `compatibility` và bảng codec decode/encode của host. Phần "encode" chưa có dòng code nào — slice H.
Điều kiện tiền đề của H mà audit §8 ghi là chưa trả lời được: tổ hợp codec nào runtime thật trên máy dev encode được, phải đo bằng `isConfigSupported` thật.

**Điều kiện mở lại.** `MediaRecorder` không được tuyển làm exporter offline; nó vẫn chỉ là đường ghi realtime (mic/voiceover), đúng như DoD §25 của plan.

---

## 5. ADR-031 — Preview và export dùng chung một semantics

**Bối cảnh.** Đây là quyết định **đã áp dụng** trước khi có plan browser-first: Phase 1–2 của V4 dựng `evaluateTimeline`,
`renderAt(timestamp)`, `createFrameScheduler`, `paintStack`, ADR-018 (cửa sổ clip nửa mở `[start, end)`) và ADR-027 (trim re-phase curve).
Phần còn nợ — core phát hành cú pháp FFmpeg như API công khai, 8 module in văn bản filtergraph và 2 module parse output FFmpeg
(audit §5.1) — đã trả xong ở slice J (2026-11-08, audit §55).

**Quyết định.** Semantics là thứ thuộc core và **mô tả ý định**, không mô tả cú pháp của một binary cụ thể.
`paintStack` quyết định lớp nào sơn; `renderAt` quyết định state tại một timestamp; `createFrameScheduler` quyết định frame nào tồn tại.
Bộ sinh cú pháp FFmpeg — `setpts`, `xfade`, `geq`, `drawtext` — đã bị thay bằng instruction mà compositor và exporter cùng đọc được (slice J, §55.1).
Hai module chỉ nhắc FFmpeg trong comment (`textStyle`, `transitions`) không thuộc khối việc này, và cả hai đã được sửa ở lượt J-8.

**Ràng buộc với ADR-028.** Slice J chạy **sau** I, nhưng phạm vi của nó phải được đo trước: **11** file core test tách assertion, **1** file (`platform`) mất assertion cùng lúc flag `nativeFFmpeg` chết, và **13** spec unit phía app đang
witness chuỗi FFmpeg (audit §7, nhóm A; ba con số cũ 10 / 11 / 12 cho cùng một khối việc đã được đo lại ở §2.3 và §14.4 của audit).
Nhóm B — luật thuần — phải giữ xanh trong suốt, và mỗi file witness chuyển thành behavior test chứ không xóa cả file.

**Điều kiện mở lại.** Không có: hai host diverge semantics là lỗi, không phải phương án.

---

## 6. ADR-032 — Browser-first; Electron chỉ là shell

**Bối cảnh.** Plan §0.1: "Electron must not have its own media engine". Tiền lệ đã có: ADR-023 (2026-11-02) xoá transport HTML-video thứ hai
của desktop vì nuôi hai engine là phải chứng kiến chúng ngang nhau từng frame mãi mãi. Audit §3 cho thấy desktop còn đúng một engine riêng: FFmpeg qua IPC.

**Quyết định.** Renderer của cả hai host chạy cùng một stack: cùng probe, cùng compositor, cùng encoder, cùng muxer.
Electron được phép giữ ba thứ **không phải media engine**: quyền đọc file hệ thống (desharing qua `media://local`), window/packaging/updater,
và một persistent cache. Electron **không** được phép có một pipeline decode/encode riêng.
`TmcutPlatformMedia` là seam duy nhất: `probe` và `probeInfo` đọc từ cùng một schema, và khác biệt giữa hai host nằm ở **nguồn bytes**, không ở luật.

**Hệ quả đo được.** Trên desktop, `media://local?file=…` trả `Accept-Ranges: bytes` và 206 (đo ở slice B qua renderer thật),
nên demuxer chạy bằng HTTP ranged trên đúng file người dùng chọn — không cần một đường IPC "probe file" riêng.

**Điều kiện mở lại.** Nếu một khả năng chỉ tồn tại ở desktop (truy cập thư mục lớn, cache đĩa), nó phải được mô tả như **capability của host**
trong adapter, không như một engine. Stabilization (vidstab) là case thật đang chờ §8 mục 1.

---

## 7. ADR-033 — Local-first: bytes không rời máy mặc định

**Bối cảnh.** Plan §0.1 yêu cầu media xử lý local mặc định, cloud chỉ khi có consent. Audit §2 và code hiện tại cho thấy web host **đang** đưa bytes
lên server: file người dùng chọn được stream tới `POST /api/v1/media/upload` và ghi vào `config.uploads.dir`, vì `blob:` URL chết khi reload
(R152). Desktop thì đi thẳng ra đĩa.

**Quyết định.** Mặc định, bytes media đi trong máy: probe/thumbnail/analysis/export chạy trong runtime của trình duyệt hoặc renderer,
không gửi nguyên liệu lên server. Cache vật lý của web host dùng storage phía client (IndexedDB/OPFS — slice C), không dùng đĩa server.
Server chỉ được nhận bytes khi **người dùng chọn một tính năng rõ ràng là cloud** (render cloud, stock download, cộng tác), và tính năng đó phải
tự khai là cloud ở UI. Route `/api/v1/media/upload` tồn tại tới slice C và bị coi là **một deviation đang đóng lại**, không phải kiến trúc đích.

**Hệ quả.** Slice C phải thay chỗ upload đó bằng fingerprint + cache phía client, và `importStatus` phải phân biệt được
"đang xử lý trong máy" với "đang gửi lên server". Đây là lý do C đứng ngay sau B.

**Trạng thái.** Slice C1 làm xong nửa đầu của "fingerprint": `assetFingerprint` gọi đúng `cacheKeyForPath` của core và record mang
sáu trạng thái import (audit §16). C2 cho người dùng **biết** bytes đang ở đâu — sáu nhãn trạng thái, predicate `isMediaOffline`,
plate Media Offline trên library, timeline và preview, cùng một dòng relink dùng chung (audit §17, đo ngày 2026-11-04).
C2b (đo cùng ngày, audit §18) dựng **cache vật lý phía client**: luật thuần ở `packages/core/src/byteCache.mjs` (ngân sách theo
quota thiết bị với trần 2 GiB, key phải là một fingerprint tám hex, thứ tự eviction), storage ở `app/utils/tmcut/byteStore.ts`
(OPFS → IndexedDB → `none`, một index localStorage là authority và được đối chiếu hai chiều mỗi lần mở library), đường ghi nối
vào đúng hai chỗ — import web và relink thành công — cùng một dòng trong panel media nói đang giữ bao nhiêu file, bao nhiêu byte,
kèm nút trả lại hết. Tính đến lượt G2 (audit §44, đo ngày 2026-11-05), vế (1) **đã có ba leg** và không còn là "chưa có call-site":
`readCachedBytes` có **4** chỗ gọi thật — [frameStore.ts:196](file:///D:/Applications/tm-studio/app/utils/tmcut/frameStore.ts#L196)
(pixels, slice D2), [autocutDetect.ts:106](file:///D:/Applications/tm-studio/app/utils/tmcut/autocutDetect.ts#L106) (silence, E4), và hai
dòng trong [waveformService.ts](file:///D:/Applications/tm-studio/app/utils/tmcut/waveformService.ts#L63) — `:63` đọc **artifact**
`<fp>-wave-v1`, `:73` đọc **revision**. Bằng chứng mạnh nhất là của G2 và nó đúng cái ADR này cần: sau một lần reload, `accessedAt`
của artifact **tiến** trong khi `accessedAt` của revision **đứng nguyên**, và page **không** phát request `.wav` nào — tức trang đã đọc
bản trong máy chứ không đọc bản trên server (audit §44.5). Hai vế vẫn còn mở, và đó là lý do ADR-033 còn **CHỜ**: (1') **playback và
export** vẫn lấy bytes từ `/uploads/` (desktop: từ đĩa) — probe đã đọc metadata từ record chứ không xin bytes, nên nó không nằm trong
danh sách này; (2) **upload vẫn bắt buộc** — cache ghi *sau* bước store thành công, nên web host hôm nay vẫn gửi file lên server.
Vì vậy tính đến hôm nay: bytes nằm trong máy **đã là bytes được dùng** cho thumbnail/filmstrip, silence và waveform, và vẫn mới chỉ
**được giữ** cho playback và export. Hai vế còn lại thuộc slice G (mixer/playhead, #139) và H (export).
*(**đo lại ngày 2026-11-05, audit §45**: vế playback **hẹp đi một nửa**, và nửa còn lại có số đo. Nửa đã đóng: **mức** không còn do player
tự tính — [audioMix.mjs:48](file:///D:/Applications/tm-studio/packages/core/src/audioMix.mjs#L48) trả gain của từng layer đang sống,
[audioMixer.ts:196](file:///D:/Applications/tm-studio/app/utils/tmcut/audioMixer.ts#L196) là đường viết duy nhất của nó, nên fade,
keyframe volume, track volume và track mute của một bed giờ ramp trên màn hình đúng như trong file (trước lượt này bản sao trong player
**không** mang fade). Nửa còn mở: **nguồn bytes** của element vẫn là URL server — đo `list_network_requests` trên `/tmcut/editor` có
**3** lần `GET /uploads/… [206]`. Đóng nửa đó cần `blob:` từ byte cache, và đó là việc của #140 / slice H, không phải của mixer.)*

**Điều kiện mở lại.** Cloud render (plan §Phase 10) là tính năng tùy chọn, bật per-job, có consent, và không được âm thầm thay đường local.

---

## 8. Chín quyết định để ngỏ của audit §10 — chốt tới đâu

Audit mở §10 bằng **chín** câu "agent không được tự quyết" (đo: §10 đánh số 1…9). Chỉ thị 2026-11-03 ủy quyền cho phần kỹ thuật; phần phá sản phẩm vẫn cần chủ repo xác nhận,
nên bảng dưới ghi rõ cái nào đã chốt, cái nào là **đề xuất có điều kiện**.

| # | Câu | Chốt | Thuộc ADR |
|---|---|---|---|
| 1 | Stabilization (vidstab) | **Khai tử**, ghi là tính năng mất khi cắt. Lý do: không có tương đương trong WebCodecs/Web Audio, và giữ nghĩa là giữ engine desktop riêng — trái ADR-032. Chủ repo xác nhận trước khi slice I xoá. | 028, 032 |
| 2 | Autocut scene/silence | **Làm lại trên sample đã decode** (slice E). Không tắt tính năng vì đầu vào (frame, PCM) vẫn lấy được từ decoder. | 030, 031 |
| 3 | HTML-video export | **Không phải đường export của timeline.** HTML-video ở lại như một loại composition có UI riêng; export timeline dùng WebCodecs + muxer (slice H). Điều này cũng khớp ADR-023: một function, một engine. | 030, 031 |
| 4 | V4 roadmap | **Sửa prose ngay (đã xong); archive cả bộ: `DEFERRED / OWNER APPROVAL REQUIRED`.** Lý do sửa prose: DoD §25 của plan có mục "không docs hướng dẫn cài FFmpeg" — dán nhãn supersede mà để nguyên **14** dòng prose còn cho phép fallback (đo ở audit §5.3) thì mục đó vẫn fail khi grep. Lý do hoãn archive: thao tác này chạm tài liệu thuộc quyền chủ repo (`docs/video-editor-stack.md`, `docs/design/`, `docs/asset-sources-catalog.md`), và chủ repo quyết định **giữ nguyên vị trí** (2026-11-08). Không di chuyển, đổi tên hay xoá khi chưa có xác nhận riêng. | 028 |
| 5 | Số ADR | **028…033**, ánh xạ ở §0. | — |
| 6 | `backup/ffmpeg-engine-2026-11-03/` | **Giữ, untracked, không đưa vào build/release.** Chủ repo xác nhận 2026-11-08: đây là bản lưu trữ mã nguồn để đối chiếu lịch sử (76 file, 0 `.exe` sau slice I), chỉ xoá khi có xác nhận riêng. Không `git clean`, không script dọn nào được chạm vào thư mục này. Lịch sử vẫn có git làm nguồn thứ hai. | — |
| 7 | `resources/*.exe` (471 MiB) | **Xoá ở slice I**, và chỉ sau khi chủ repo duyệt; đây là thao tác khó đảo và là điểm không quay lại. | 028 |
| 8 | ADR-025 (font vendoring) | **Vẫn mở.** `drawtext` đã nghỉ hưu ở slice J (§55) và chữ sơn bằng DOM layer của core, nên vế cú pháp đã đóng; vế **font đi cùng app** vẫn là việc của ADR-025 (measure FontFace + OPFS). | 031 |
| 9 | Subtitle burn-in | **Đi qua text/paint renderer đã có**, không qua libass: subtitle đã là text track trong timeline, nên "burn-in" chỉ là một lớp sơn trong stack chứ không phải một pipeline. Không viết parser `.ass` đầy đủ. Chủ repo xác nhận nếu sản phẩm thật sự cần `.ass` styling ngoài phạm vi đó. | 031 |

Ba câu (1, 7, 9) có hiệu lực **phá tính năng hoặc dữ liệu**, nên chúng là điều kiện tiên quyết của slice I chứ không phải của slice này:
slice A2 chỉ ghi quyết định, chưa xoá gì.

---

## 9. Register này không quyết

- **Không** đổi hành vi code nào. Không một dòng `app/`, `server/`, `electron/` hay `packages/core/src/` bị chạm ở slice này;
  số liệu trạng thái lấy từ phép đo đã ghi ở audit §6, §13 và commit `1b57ca1`.
- **Không** xoá FFmpeg. Nó thuộc slice I, và slice I chỉ mở khi slice H tạo ra output hợp lệ đầu tiên.
- **Không** thay schema project. Plan §4.1/§7 mô tả `TMCUTProject { schemaVersion, tracks, sequences }` trong khi repo lưu `version: 3` với
  `timeline.tracks` flat; đó là một **migration**, cần ADR riêng (audit §5.4), không phải một field đổi tên.
  **Cập nhật 2026-11-04, hàng 5 của §10 đã thi hành:** chủ repo khoá nguyên dạng v3 thật nên ADR migration nói ở bullet này **không cần viết nữa**;
  hình dạng đã đóng băng bằng `tests/unit/tmcut_project_schema_v3.spec.ts` (bảy assertion, đo ở audit §15).
- **Không** cam kết ngày. Thứ tự slice và exit gate nằm ở audit §8; mỗi slice vẫn chạy đủ 5 gate của
  `tmcut-verify-gate-pipeline` rồi commit + push.

---

## 10. Chủ repo chốt ngày 2026-11-04: Q1…Q9

Ngày 2026-11-04 chủ repo trả lời **chín** câu hỏi đã đưa ra một lần, nguyên văn "mình chọn Q1a Q2b Q3b Q4a* Q5b Q6a Q7a Q8a Q9a".
Đánh số của chủ repo là đánh số trong tin nhắn quyết định, **không** trùng bảng §8 ở trên (chín câu của audit §10);
bảng dưới ghi lại đủ bộ, kèm việc mỗi câu mở ra ở slice nào. Hàng nào trùng với §8 thì §8 được xác nhận, không bị viết lại.

| Q | Câu | Chốt | Việc phải làm, và ở slice nào |
|---|---|---|---|
| 1 | Stabilization | **Bỏ hẳn** khỏi TMCut Browser Edition: xoá nút trong UI và key i18n, không làm optical-flow. | Project cũ còn dữ liệu stabilization phải **giữ nguyên và đánh dấu unsupported**, không im lặng xoá. UI + i18n ở slice I; emitter `stabilize` **đã xoá hẳn** ở slice J (§55) — không còn bản dịch nào cho nó. Xác nhận hàng 1 của §8. |
| 2 | Subtitle burn-in | **Sơn bằng text track** qua `paintStack` đã có; không parser ASS, không libass. | Feature ASS không hỗ trợ phải khai rõ ràng. Slice H cho export; emitter `subtitles` không bao giờ tồn tại trong core, nên slice J (§55) không phải gỡ gì ở đây — chữ đi qua layer, không qua filtergraph. Xác nhận hàng 9 của §8. |
| 3 | Binary FFmpeg trong package | **Gỡ khỏi package ở slice I**, nhưng giữ file trên máy dev cho tới khi slice H xong và parity đã đo thật. | Không xoá binary hay bản backup nào trước mốc đó. |
| 4 | FFmpeg phía server | **Server chỉ là storage.** Bỏ render, analyze, proxy phía server; render = WebCodecs + TMCut Core, analyze = MediaProbeService + Mediabunny + Web API, proxy và thumbnail = pipeline local trong browser. | `upload.post.ts` **không mất** khả năng Web upload: nó là Storage Upload API thuần, không FFmpeg, không binary xử lý media. Media ở local mặc định, chỉ upload khi user yêu cầu rõ (Cloud Library, Stock Library). Không cloud render ở bản này. Luật này đã có guard: `tests/unit/tmcut_server_media_boundary.spec.ts`. |
| 5 | Project schema | **Khoá schema v3 thật**: `version: 3` với `timeline.tracks`; sửa roadmap và interface mẫu cho khớp repo. | Không migrate sang `tracks` và `sequences` khi chưa có yêu cầu chức năng thật; migration cũ phải tiếp tục chạy. **Đã khoá 2026-11-04** bằng `tests/unit/tmcut_project_schema_v3.spec.ts`: shape app file (12 key top-level, `timeline` 4 key, `schemaVersion: 3`, `timeline.version: 1` chỉ là nhãn), shape core (`version: 3`, `timeline.version: 3`, `validateTimeline` nhận), `sequences` **0** hit trong toàn bộ code shipped, và `timeline.version` đúng **một** chỗ đọc. Hai chỗ đã khớp sẵn: `docs/v4-phase-0-audit.md` §4.1 mô tả đúng cả hai model. Sample `sequences` chỉ tồn tại ở `docs/tmcut-zero-ffmpeg-zero-ffprobe-browser-first-roadmap.md:339-347` — file plan **untracked của chủ repo**, không commit, không tự sửa; bản đó đang sai và chủ repo quyết định xoá hay ghi chú. |
| 6 | Đường dẫn media chết | **Media Offline / Missing Media kèm nút Relink.** | Không tự mở dialog, không xoá asset reference khỏi project khi đường dẫn hỏng. **Cả hai vế đã code**: tầng dữ liệu ở C1 (audit §16.3 — relink hỏng đích vẫn giữ asset, `usedBy` và clip reference, chỉ trả `false`), tầng UI ở C2 (audit §17 — plate Media Offline trên library + timeline + preview, ba check hành vi đo đúng: huỷ thì im lặng, hỏng thì báo, và `assets.length` vẫn là 1 sau cả hai). Guard: `tmcut_media_offline.spec.ts` 13 check, gồm check quét không file `.vue` nào tự gọi `relink(` hay tự branching trên `importStatus` |
| 7 | Font | **Chỉ font đi cùng app**; không quảng bá import font khi chưa làm. | Slice J (§55) không đụng tới font: chữ sơn bằng CSS/WOFF2 phía app, và vế font vendoring vẫn thuộc ADR-025. |
| 8 | `backup/ffmpeg-engine-2026-11-03/` | **Giữ untracked tới hết slice I**, không vào build, không xoá bằng `git clean`. | Chỉ xoá sau khi parity xác nhận không cần tới nó nữa. Xác nhận hàng 6 của §8. |
| 9 | Hai lỗi làm đỏ test suite | **Sửa đúng hai chỗ**: `app/pages/login.vue` không bao giờ lưu password trong localStorage (chỉ username, và dọn password bản cũ), `package.json` thêm `imports` map cho `#shared/utils/*` đã kiểm chứng bằng Node, TypeScript và bundler thật. | Xong ở commit `44f70c6`. Giữ nguyên dependency `tm-hub-client 1.0.9`, không đổi cách synthetic blob, không ghi đè thay đổi khác trong working tree. |

Thứ tự thực hiện chủ repo chọn: **Q9 trước**, rồi biên giới server (Q4), rồi khoá schema (Q5), rồi phạm vi Q1/Q2/Q6/Q7,
cuối cùng Q3/Q8 (binary và backup) ở slice I sau khi đã đo và xác nhận parity.

Tính đến lần sửa này, code đã chạm vì các quyết định trên gồm ba phần, đúng thứ tự chủ repo chọn: Q9 (commit `44f70c6`),
biên giới server Q4 (commit `521d050`) và khoá schema Q5. Sáu file `server/**` spawn hoặc phục vụ job FFmpeg mang marker
`ZERO-FFMPEG-LEGACY` khai rõ slice nào giết chúng, guard `tmcut_server_media_boundary.spec.ts` đóng băng danh sách đó,
và guard `tmcut_project_schema_v3.spec.ts` đóng băng hình dạng project. **Không** route nào bị xoá, **không** field nào bị đổi tên.
Xoá route, xoá binary và đổi UI là chuyện của slice I, chưa xảy ra.
Bằng chứng đo từng phần nằm ở [docs/audit/zero-ffmpeg-audit.md §15](file:///D:/Applications/tm-studio/docs/audit/zero-ffmpeg-audit.md#L619).
Lượt C1 (audit §16, commit `6d3e825`), lượt C2 (audit §17) và lượt C2b (audit §18, đo ngày 2026-11-04) nối tiếp ba phần trên theo đúng thứ tự chủ repo chọn: Q6 giờ có đủ **cả hai tầng** — dữ liệu ở C1, chữ trên màn hình ở C2. ADR-033 vẫn **CHỜ** sau C2b, nhưng vì một lý do hẹp hơn trước: cache vật lý phía client **đã tồn tại và đã ghi** (luật ở core, storage ở app, ghi khi import/relink, đối chiếu khi mở library, một dòng trong panel), còn thứ chưa có là **đường đọc** — playback/probe/thumb/waveform/export vẫn đi `/uploads/` — và **thôi bắt buộc upload**. Hai việc đó thuộc D/G/H, không thuộc C2b. *(**đo lại ngày 2026-11-05, audit §44**: vế "chưa có đường đọc" đã lỗi về ba leg — pixels (D2), silence (E4), waveform (G2) — và G2 có bằng chứng artifact được đọc lại sau reload mà không chạm file trên server. Phần còn nguyên của câu này là **playback + export** vẫn đi `/uploads/` và **upload vẫn bắt buộc**; ADR-033 vì thế vẫn **CHỜ**, và việc còn lại thuộc #139 (mixer) và slice H.)*
*(**đo lại ngày 2026-11-05, audit §45 — lượt G3**: mixer Web Audio đã thay **ba bản sao luật gain** của player bằng một câu trả lời của core, nên phần **mức** của leg audio giờ là client quyết — đó là bằng chứng của slice G3, không phải của ADR-033. Element vẫn play URL server: đo `list_network_requests` khi editor mount có **3** lần `GET /uploads/… [206]`. Hàng "Còn mở" ở bảng trên vì thế giữ nguyên, và nơi đóng nó là #140 (nguồn `blob:` từ byte cache) cùng slice H (export).)*
*(**đo lại ngày 2026-11-05, audit §46 — lượt G4a**: nửa **thời gian** của leg audio đã về core — một clip 6× không còn chạy hình 6× mà tiếng 1×, một gap không còn dựng element nằm im, và một clip reverse bị từ chối **có tên** thay vì `continue` trong im lặng. Nửa **bytes** không đổi: đo live, plan của core, list Vue mount và `<audio>`/`<video>` element trùng nhau trên từng hàng đo (§46.7), nhưng element vẫn lấy dữ liệu từ `/uploads/…`. Vì thế ADR-033 vẫn **CHỜ** với cùng một lý do hẹp như §45 ghi, và chân đóng nó là **G4b** (nguồn `blob:` từ byte cache, có read-back evidence) chứ không phải G4a.)*
*(**đo ngày 2026-11-06, audit §47 — lượt G4b**: read-back evidence giờ đã có, và nó đo trên bytes thật của máy. Seam
`createPlaybackBytes()` (app) gọi hai luật của core — `planPlaybackByteSource` cho phép chọn nguồn, `planBlobUrlLifecycle` cho
phép keep/create/revoke — rồi trả `blob:` cho mọi surface đang mount một revision đã cache; `GET /uploads/…` biến mất khỏi phép
đo (**0** resource trước và sau khi mount hai revision và đọc hết bytes của chúng). Ba hành vi mà một bản port ẩu sẽ bỏ sót đã
được đo chứ không suy ra: hai `sync` song song gộp thành **1** lần đọc, một revision rời màn hình chỉ thu hồi **URL của nó** (fetch
URL đã revoke → `TypeError`, còn URL của revision ở lại vẫn là object cũ), và cache trả `null` thì vẫn là stream chứ không phải
clip hỏng. Hai việc còn lại của hàng ADR-033 trên bảng trạng thái, cả hai không thuộc G4b: **phép đo trên element mà editor
mount** (cần session đăng nhập — `/tmcut/editor` hiện redirect `/login?redirect=/tmcut/editor`), và **export** vẫn
`/uploads/` thuộc slice H. Một phát hiện phụ: revision `717a0beb` trong cache mở đầu bằng `------WebKitForm`, tức bytes hỏng đã
được cache nguyên trạng từ đường import — seam chuyển đúng bytes, tính hợp lệ của file là chuyện lúc import, và việc xóa/thay
asset thuộc owner (§46.7).*
*(**đo ngày 2026-11-06, audit §48 — lượt H1**: slice G chỉ còn mở một phép đo cần session (§47.8), nên chương trình chuyển sang H
bằng **luật** thay vì bằng exporter. `packages/core/src/exportEncode.mjs` trả ba câu hỏi mà vòng encode sẽ tự trả lời sai nếu
không có ai giữ: `planEncodeConfig` chọn preset từ kết quả `isConfigSupported` **đã được ghi** — một preset chưa đo là
`unmeasured` chứ không phải `supported`, và runtime trả codec khác codec được hỏi là `substituted`, tức thất bại, đúng điều
ADR-030 cấm; `planEncodeSample` tính timestamp từ **index × FPS hữu tỉ** làm tròn một lần trong timescale của muxer, vì
`canvasFpsValue` (`app/utils/tmcut/canvas.ts:40`) đang làm tròn 30000/1001 thành 29,97 và 30 frame của nó là 1,001 s chứ không
phải 1,001001 s; `planEncodeQueue` chặn số frame nằm trong encoder và rơi về bound mặc định khi được hỏi một bound 0, vì loop
chờ một slot không bao giờ mở thì không encode frame nào. **Bằng chứng dừng ở mức luật**: 20 checks core, 773/773, mutation 10/11
bắt được (mutant sống là mutant tương đương, §48.4 giải thích), **không có consumer**, và **không một lần gọi
`isConfigSupported` nào đã xảy ra** trên máy này — vì thế ADR-029 vẫn MỘT PHẦN (leg mux chưa có dòng code nào) và ADR-030 vẫn
MỘT PHẦN (chưa encoder nào chạy); xuất file vẫn đi FFmpeg và vẫn `/uploads/`. Việc của lượt H2 là exporter thật: `renderAt` của
core → `VideoEncoder` → muxer, và nó phải sửa **cố ý** allowlist mà `tmcut_media_probe.spec.ts:350` đang đóng băng.*

*(**đo ngày 2026-11-06, audit §49 — lượt H2**: H1 dựng ba luật rồi dừng ở mức "chưa ai gọi", nên H2 làm đúng hai việc mà
browser không cho làm trong một luật pure: **liệt kê câu hỏi** và **chạm `isConfigSupported`**. Ở core, `planEncodePresets` trả
danh sách preset theo thứ tự đáng hỏi — level từ Annex A tính bằng macroblock/frame (`ceil(w/16) * ceil(h/16)`) và macroblock/giây,
lấy level chặt nhất hợp pháp cộng một level lỏng nhất; H.264 đi MP4, VP9/AV1 đi WebM; MP4 hỏi **cả hai** spelling AAC vì máy này
từ chối `aac` trong khi nhận `mp4a.40.2`; bitrate `0.1` bit/sample kẹp trong `[1, 40]` Mbps; cạnh lẻ, FPS float và raster không
level nào chở (8K) bị **từ chối có tên** chứ không kẹp. Ở app, `createEncodeCapability().decide(request)` là chỗ duy nhất chạm
browser: dịch sang shape của API (`framerate` float, `avc:{format:'avc'}` chỉ với `avc1.`, `numberOfChannels`), biến probe ném
thành `unmeasured` chứ không thành "từ chối", và nhớ kết quả theo **cả request** vì 30 fps không trả lời cho 60 fps; runtime không
có WebCodecs là một refusal đọc được, không phải một `VideoEncoder is not defined` giữa dialog export.
**Bằng chứng**: 22 checks core + 10 checks app, 795/795 core, 129/129 app, mutation 15/15 (core) và 11/11 (app), và lần đầu tiên
trong repo một preset export được hỏi thật — ma trận Chrome 156 nằm ở §49.4. Hai phát hiện đáng giá hơn code: **hằng số level 3.1
của tôi sai** (chép giới hạn của level 3), bị bắt khi đối chiếu số đo 720p, sửa bằng test đỏ trước (§49.2); và **runtime không
enforce Annex A** — nó nhận `avc1.640028` ở 1080p60 và `avc1.640033` ở 4K60, cả hai đều vượt trần MB/s của level chúng khai
(§49.5), nên luật chọn level theo chuẩn chứ không theo câu trả lời, vì `level_idc` ghi trong SPS là thứ decoder của máy khác đọc.
**Chưa chứng minh**: không component nào gọi seam này, chưa frame nào encode, chưa mux, chưa file, chưa A/V sync; Electron chưa đo
lại; `hardwareAcceleration` không phân biệt được trên máy này nên ADR-030 vẫn MỘT PHẦN đúng như chính nó đòi hỏi; ADR-029 vẫn
MỘT PHẦN vì leg mux chưa có dòng code nào. Lượt H3 là exporter thật và sẽ phải sửa **cố ý** allowlist `mediabunny` ở
`tmcut_media_probe.spec.ts:350`, `tmcut_silence_scan.spec.ts:189`, `tmcut_autocut_detect.spec.ts:108`.*

*(**đo ngày 2026-11-06, audit §50 — lượt H3a**: H1 và H2 dựng luật cho đường video, còn đường audio thì chưa có đồng hồ
nào. `AUDIO_PACKET_FRAMES` ghi định dạng thành hằng số: AAC-LC **là** 1024 sample/kênh/frame, Opus 960 (20 ms @ 48 kHz),
và codec ngoài bảng **không có default** — một `AudioData` dài khác đi là một codec khác, muxer sẽ nhận file không decoder
nào đồng ý đọc. `encodeAudioSampleCount` chốt chỗ làm tròn duy nhất cho câu "nội dung này bao nhiêu sample", vì
1/120 s @ 44,1 kHz là 367,5 sample và mỗi bên tự `floor`/`ceil` là hai file khác nhau. `planEncodeAudioSample` đặt packet
theo **số sample**, không theo duration nhân lên: `timestamp = round(startSample * timescale / sampleRate)`, `duration` là
**hiệu hai vị trí**, packet cuối mang phần còn lại. Bẫy này có bằng chứng đo được: ở µs, `2 × 23220 = 46440` trùng vị trí
thật nên phép nhân trông đúng; ở 90 kHz (timescale container thật dùng) ba packet nói `3 × 2090 = 6270` trong khi ranh giới
là **6269**. Phát hiện second-order đáng tiền hơn: hai đồng hồ video/audio **không** trùng khít tuyệt đối — nội dung 1000
ticks @ 44,1 kHz kết thúc ở 8333 µs (video) và 8345 µs (audio), vì audio không bắt đầu giữa hai sample. Hiệu 12 µs nhỏ hơn
một sample (22,68 µs) và đó là **toàn bộ** dung sai lượt H3c được phép tuyên bố khi đo A/V sync, không phải "0 ms".
**Bằng chứng**: 15 checks core, 810/810, `tsc -p packages/core` exit 0, boundaries PASS, unit 129/129, mutation **12/12 CAUGHT**
với nguồn restore byte-identical (md5 `749f5e94419a924688e32189cae108ca`); gate typecheck exit 0 và lint exit 0 sau khi sửa
2 lỗi `@stylistic/quote-props` do chính luật này sinh ra. Lần chạy mutation đầu tiên chỉ đạt 11/12 vì chính lệnh lint `--fix`
đổi `opus: 960` thành `'opus': 960`, nên pattern text của mutant M7 không còn áp dụng: bằng chứng mutation phải sản xuất
trên đúng md5 của nguồn sắp commit, sửa style là buộc chạy lại (audit §50.3, §50.5). **Chưa chứng minh**: chưa `AudioEncoder` thật nào nhận một
`AudioData` 1024 sample trên máy này — `AUDIO_PACKET_FRAMES` là luật của định dạng chứ không phải kết quả đo, H3c phải ghi
lại câu trả lời thật giống cách §49.4 đã làm cho video; `planEncodeAudioSample` chưa có consumer (H3b `createEncodeSession`
là consumer đã lên lịch, khai trước khi viết code chứ không phát hiện lúc viết docs); chưa mux, chưa file, chưa A/V sync thật.
ADR-030 và ADR-029 vẫn **MỘT PHẦN** đúng nguyên trạng.*

*(**đo ngày 2026-11-06, audit §51 — lượt H3b**: seam `createEncodeSession` đã tồn tại, và mọi con số của nó đi qua core:
một vòng lặp, mỗi bước là một câu trả lời của `planEncodeFinish`, và `stop` / `stalled` / `null` là `throw` chứ không
phải chờ. Ba luật chỉ hiện ra lúc viết seam. **(1)** Một packet bị giữ vì chưa có decoder description đã **rời** encoder
nên phải nhả slot queue của nó; khi description tới nó được write mà không trả slot lần hai, vì trả hai lần làm
`inFlight` âm. **(2)** `inFlight > 0` một mình không còn nghĩa "encoder còn việc": core chỉ được phép nói `wait` khi có
một sample đã đưa mà chưa vào file và cũng chưa nằm trong đống parked (`drained`), còn không thì phải nói `stalled` — chờ
một slot không ai trả nổi là một export treo vĩnh viễn, và log của nó báo đủ packet. **(3)** Chunk phải trả **đúng sample
nó sinh ra**, khớp theo timestamp, không theo FIFO, vì encoder được phép đổi thứ tự output mà không cần lý do; bản FIFO
đóng một `VideoFrame` mà encoder vẫn còn giữ, và **số phép close vẫn khớp** nên chỉ assertion về thời điểm mới thấy.
Luật thứ ba này có số đo: fake runtime in-order **không** bắt được, RED chỉ
xuất hiện khi `flush()` trả theo thứ tự decode `[0, 66_667, 33_333]` và `illegalCloses` ghi lại lần đóng sớm
(`+ [33333] - []`). **Bằng chứng**: typecheck exit 0 + 0 `error TS` (15:46), lint exit 0 trên 6 file chạm **sau** config
regenerate 15:45, core 838/838, `tsc -p packages/core` exit 0, boundaries PASS, unit **130/130**, mutation core
**18/18** (md5 `82af69d535c2fa2409c6e330052530e8`) và seam **11/11** (md5 `5bda4be0d0bbd2bc4d0e6ba63dd53169`), cả hai
restore byte-identical; một lần seam chỉ đạt 10/11 vì pattern S6 trỏ đúng câu FIFO mà luật reorder vừa xóa — §50.3 giữ
lần đó không được tính thành PASS. Hai tuyên bố cũ phải sửa: note §48 viết "leg mux chưa có dòng code nào" là **đúng của
lượt H1**, còn từ lượt này leg mux có code (`Output` + hai `EncodedPacketSource` + finalize) nên ADR-029 MỘT PHẦN vì
**chưa consumer và chưa file**, không vì chưa có dòng nào; và dự đoán §49.7 nói phải sửa **ba** allowlist — thực tế
**hai**, vì `tmcut_autocut_detect.spec.ts` assert điều phủ định về một file khác nên thêm holder không làm nó sai.
**Chưa chứng minh**: chưa `VideoEncoder`/`AudioEncoder` thật nào nhận một sample, chưa file, chưa A/V sync; Chrome có
reorder hay không là **số chưa đo**; Electron chưa đo; gate 4 N/A vì chưa route nào import seam. Lượt H3c là lượt
consumer: `renderAt` → encoder → seam này → file thật.*

*(**đo ngày 2026-11-06, audit §52 — lượt H3c**: seam của §51 chưa từng chạm một encoder thật, và lượt đó ghi hai câu là
"số chưa đo". Cả hai đã có số, ghi theo đúng cách §49.4 ghi ma trận capability, và một trong hai câu trả lời **đổi luật**:
`AudioEncoder` không echo timestamp — nó tự sinh clock của nó (đưa `[0, 21333, 42667]` nhận `[0, 21333, 42666]`; đưa tám
packet cùng stamp 12345 thì nhận một dãy tăng dần) — nên luật "khớp chunk với sample theo timestamp" của §51 chỉ đúng cho
video, và core phải nói rõ danh tính từng leg (§52.2). Chiều ngược lại, reorder vẫn là **0** trên chín run video đã đo:
luật giữ nguyên nhưng thành phòng thủ cho một tình huống chưa quan sát, không phải một hiện trường. Ba luật nữa cũng từ số
mà ra: AAC **ném** `EncodingError: Flushing error.` khi flush một luồng một packet, nên số **hand** là luật riêng với sàn
bằng 2; opus trả **dư** một packet, nên packet ngoài lịch bị bỏ với audio và làm fail cả run với video; và encoder trả
**cả một frame** cho phần đuôi, nên file 3 s thật mang 144 384 sample (= 3,008 s) trong khi metadata hứa 3,000 s.
**File đầu tiên**: 28 305 byte, 336 ms, mp4 `avc1.64001f` + `mp4a.40.2`, preset do chính `planEncodePresets` chấm trên
`isConfigSupported` thật; click và flash cùng đặt tại 1,000 s cho **A/V offset 0,000 ms**, đọc lại bằng `Input` của
Mediabunny, bằng `AudioBufferSink`/`CanvasSink`, và bằng `<video>` của trình duyệt — tức không phải bằng đúng thư viện đã
ghi file. **Hai chỗ phải nhận về thứ tự chứng minh.** Luật "nhả sample còn mở tại flush" được viết trước khi có test đỏ,
nên nó không có RED, chỉ có mutant `no-release-at-flush`. Và loạt mutation đầu của lượt này báo **8/8** vì một marker
hard-code trong `probes.sh` (`grep "All 27 ..."`): khi check thứ 28 ra đời chuỗi đó không còn được in, nên *mọi* mutant
đều được báo là caught. Đo lại bằng exit code thì còn **7/8**, và mutant lọt lộ ra một lỗ hổng hạ tầng to hơn chính nó —
seam chờ một promise không ai resolve, event loop cạn handle, Node **thoát 0 với 16 check chưa chạy**, mà `specStatus()`
(công cụ sinh ra để bắt một lần PASS giả) vẫn báo PASS vì nó chỉ nhìn exit code. Đã chặn bằng watchdog trong `main()` của
spec, mutant giờ chết **có tên**, và lượt này đóng ở **8/8**; phần chưa sửa là *mọi spec khác* của repo vẫn mở cửa đó
(§52.7). **Chưa chứng minh**: chưa có consumer trong app nên gate 4 vẫn N/A; Electron chưa đo; opus/webm, AAC 44,1 kHz và
mono chưa mở file; 0,000 ms là số của hai reader trên máy này chứ không phải cam đoan của một player phần cứng;
hardware H.264 vẫn là dấu hỏi vì `hardwareAcceleration` không phân biệt được. Lượt H3d là lượt consumer: nút export →
`renderAt` → session → tải file.*

*(**mở ngày 2026-11-06, audit §53 — increment H3d-1, chưa đóng lượt**: trước khi viết consumer, hai luật chưa từng được
viết ở đâu cả đã phải ra đời, và cả hai là luật **core** nên chạy được không cần browser. Thứ nhất,
`planEncodeContent` trả lời "project này exporter WebCodecs vẽ nổi **một cách trung thực** không" bằng một từ vựng đóng
13 lý do (`bad-canvas`, `background-image`, `empty`, `stacked-rows`, `text`, `effects`, `mask`, `blend`, `transition`,
`reverse`, `stabilize`, `fit-unsupported`, `rotation`) — và khi từ chối thì `request`/`canvas` là `null`, nên không có
đường nào đưa một phỏng đoán vào `planEncodePresets`; modal chỉ in lý do, không được tự quyết. Nó **không** sở hữu ba quy
tắc đã có chủ: kích thước chẵn, lưới frame, chọn row. Thứ hai, `planEncodePlate` trả đúng tham số của một `drawImage`,
sao từng dòng từ `computeFitObjectStyle` (CSS preview) và `buildFfmpegFitFilters`/`buildFfmpegTransform` (filtergraph
FFmpeg) thay vì nghĩ hình học thứ ba; `smart` trả `null` và rotation **không** được áp dụng — thà từ chối còn hơn vẽ nửa
vời. **Một phát hiện của lượt này**: `background-image` từng là lỗ im lặng — preview vẽ nó bằng
`backgroundImage: url(...)` và FFmpeg đăng ký nó thành input loop, còn exporter thì chưa có đường nào; nếu không từ chối
thì file ra **đổi nền thành đen** ngay khi preview đang hiện ảnh. **Nhận hai chỗ làm ngược thứ tự**: nhánh
`background-image` được viết trước test, đã xoá đi để đo RED thật (`28 pass / 1 fail`) rồi dựng lại; và một fixture sai
đã bị sửa thành đúng mô hình (lane là thuộc tính của **track**, `clip.type` chỉ là nhãn) trong khi assertion giữ nguyên —
§53.3 ghi cả ba chỗ, kể hai expectation sai của chính test plate bắt được trước khi code. **Chưa chứng minh**: con số
±1 px giữa `round` của plate và phép chẵn-hoá của FFmpeg (thuộc lượt live §53.4), consumer, file thật, parity điểm ảnh
với file FFmpeg, và việc `planEncodeContent` chưa chạy trên một project người dùng thật nào — mọi số ở đây là fixture.*

*(**đo ngày 2026-11-07, audit §53.12 + §53.13 — hai lượt H3d-6 và H3e**: vế **export** của ADR-033 đã đóng. Trước đó cả hai
chân của lần xuất mở file **theo location** (`bytes: null` ở `frameDecode.ts` và `exportMixLeg.ts`), nên một project có asset
chỉ nằm trong OPFS/IndexedDB vẫn xuất ra "no plate" dù preview phát được — đúng lỗ §53.11 nêu tên. Giờ
`createWebExportHost` nhận một port `bytesFor` và đưa **cùng** port đó cho cả hai chân, khoá theo **path tác giả** vì
revision chỉ có nghĩa với path chứ không với URL đã resolve; cache trượt, thư viện không biết path, hay storage ném lỗi đều
là fallback về location chứ không phải từ chối. Bằng chứng: unit check ở ba spec (15 plate / 12 mix leg / 13 host) cộng
harness `tests/e2e/tmcut_h3d6_cache_export.mts` **8/8** trên `:4003`, trong đó fixture **không** nằm ở `.data/uploads` và URL
trả **404**, nên chỉ cache mới vẽ được — file ra 20 336 B, 320x180 @ 30/1, 60 frame, bốn màu đúng trị; lượt **đối chứng**
không có port thì thất bại và không ghi file nào. Bảy mutation, bảy lần bị bắt; một mutation (**M4**, khoá cache bằng URL
thay vì path tác giả) **sống** ở lần chạy đầu và chỉ chết sau khi thêm check còn thiếu. Phép đo read-back §47.6 được chạy
lại hôm nay trên cache thật của profile này (**3** revision, backend OPFS): 1 lần đọc → `blob:`, `fetch(blob:)` → **200 /
4 448 B**, **0** request `/uploads/…`, 1 lần revoke, ledger rỗng sau `releaseAll()`. Nghĩa là ADR-033 giờ chỉ còn **một**
dòng chưa đóng: `currentSrc` của element mà editor mount (cần session đăng nhập). Vế thứ ba của exit gate slice H — "**0
spawn**" — cũng đã có guard riêng (§53.13, `tmcut_export_process_census.spec.ts`): đồ thị **8** module đóng băng từ entry,
không `child_process`/`spawn`/`exec` nào trong đó, không chạm được `ffmpegHelper`/`render/`/`hostBridge`, và nhánh web của
modal `return` trước `enqueueJob`. "0 spawn" ở đây là 0 trong **đồ thị module của lần xuất trình duyệt**, không phải phép
đếm tiến trình thật trên máy — dòng đó vẫn mở.)*

*(**đo ngày 2026-11-08, audit §54 — slice I cắt engine**: điều ADR-028 chờ ở H đã xong, nên lượt này **cắt** engine FFmpeg
khỏi repo/build/runtime thay vì xây thêm. Đo trên cây sẽ commit (HEAD `b0d0c44`): **118 file, +1807/−18098**; **0** `.exe`
tracked lẫn working-tree, `resources/*.exe` (471 MiB) gone, **0** FFmpeg trong `package.json`+`pnpm-lock.yaml`; **0** runtime
media spawn, **0** kênh IPC FFmpeg (namespace `tools:ffmpeg:*` + `tmcut:renderDone` + task-manager đã gỡ); 3 bảng
`ffmpeg_configs`/`ffmpeg_batch_configs`/`ffmpeg_history` ngừng tạo/truy cập bằng **pure deletion** — không DROP/DELETE nên
dữ liệu cũ trên đĩa còn nguyên, không mất project. `child_process` trong electron/+server/ chỉ còn 2 file không-media
(`main.cjs` spawn MCP server, `paths.cjs` probe `yt-dlp --version`); updater hết `extractZip`/`execFile`. **ADR-028 và
ADR-032 chuyển ĐÃ ÁP DỤNG** ở bảng trên. Gate: typecheck exit 0/0 `error TS`, core **957/957** + boundaries PASS, suite
**124/124**, electron **59/59** (13 suite); lint **0 error trên dòng chạm** (104 problem là nợ cũ owner trên dòng không đổi,
không `--fix` repo-wide). Suite bắt một regression thật — `extractFrame` snapshot rò slot vì dùng leg `request` giữ slot
vĩnh viễn — đã sửa bằng `requestFrameBatch` một phần tử, không nới assertion (§54.6). Gate binary cuối nghỉ hưu có mutation
chứng minh (§54.5). **ADR-033 vẫn CHỜ**: slice I giữ Storage Upload API thuần (brief cấm xoá) nên upload vẫn bắt buộc, và
`currentSrc` của element editor mount vẫn cần session đăng nhập mà tôi không cầm credentials. **Còn nợ**: slice K archive docs
+ parity bản đóng gói; gate 4 live BLOCKED trên bốn route authed (chỉ `/login` quét sạch). Backup `ffmpeg-engine-2026-11-03/`
(76 file, 0 exe) giữ untracked theo Q8, không xoá bằng `git clean`.)*

*(**đo ngày 2026-11-08, audit §55 — slice J cắt syntax**: phần ADR-028 để lại ở slice I đã xong. Mười hai phát ngôn FFmpeg
trong core nghỉ hưu — `buildFfmpegEffectFilters`+`lut3dChain`, `buildFfmpegFitFilters`, `buildFfmpegTransform`,
`buildBackgroundSource`+`stillImageInputFlags`, `maskAlphaExpr`, `keyframeExpr`, `rampSetptsExpr`, `volumeExpr`+`panFilter`,
`buildVidstabDetectArgs`+`buildVidstabTransformArgs`, `buildProxyArgs`, `normalizeProbe`+`parseFrameRate`,
`parseSceneOutput`+`parseSilenceOutput` — và `runHealthChecks` thôi dò `ffmpeg`. `stabilize.mjs` + `probe.mjs` **xoá**;
`stabilize.test.mjs` + `scene-shot-law.test.mjs` xoá (chỉ chứa luật chết); **11** file test còn lại **tách assertion**, giữ
phần số học sống. Cái sống thay thế là semantics đã có: `lutGrade`, `maskCssMaskImage`, `evalKeyframe`,
`rampElapsedForConsumed`, `gainAt`, `computeFitObjectStyle`/`resolveClipLayout`, `buildMediaInfo`, `cutsToShots`. Gate:
build:core 0; typecheck exit 0 / **0** `error TS`; lint **0** trên 11 file app chạm và **0 error thêm** trên core (10 error
`crashRecovery.mjs` là nợ có sẵn — HEAD cũng 10); core tsc 0; boundaries PASS; core **906/906**; suite **124/124**; 6 doc
guard exit 0. §55.2 ghi một điều phải nói rõ: `renderReady` **không** còn nghĩa "file export nung được" — badge
`exportSupported` đang nói quá so với `planEncodeContent`, và đó là blocker §55.6. Pan của track audio hiện là dữ liệu im
lặng (mixer chưa áp). Gate 4 live **đo được sau khi restart dev server** (`:4003` treo 503 do `.nuxt` vừa
regenerate): năm route **200**, console **0** `[error]`/`[warn]`/`[issue]`; nội dung authed bên trong editor vẫn cần
session nên vẫn chưa đo.)*

*(**đo ngày 2026-11-08, audit §57 — slice L "hai capability, hai chủ"**: sáu blocker của §55.6/§56.6 đã có quyết định của chủ
repo, và ba trong số đó là code. (a) `fxCapabilities` thôi phát `exportSupported`: nó chỉ trả `previewReady` (registry có mặt
xem trước hoàn chỉnh), vì câu "file có nung effect này không" thuộc exporter. Câu thứ hai có chủ riêng —
`exportBakesEffect` trong `exportContent.mjs`, hiện là một Set rỗng vì painter chưa có leg nào; khi một leg học nung một
effect, effect đó chuyển vào Set trong đúng commit chuyển luôn lời từ chối. (b) Badge của `TmcutFxThumb` đổi thành "Preview
only — not exportable yet" cho mọi effect mà exporter từ chối, thay cho "Not in export" chỉ hiện khi định nghĩa thiếu. (c)
`planEncodeContent` trả thêm `blockedEffects` — tên từng loại effect đứng giữa project và file, sắp xếp + khử trùng, rỗng
khi `effects` không nằm trong `reasons` — và `TmcutExportModal` in tên đó trước khi render. Banner cũ "transitions will be
blended with xfade & acrossfade" đã **gỡ**: nó hứa một emitter slice I đã xoá, trên đúng project mà painter từ chối. (d)
Track pan: control **gỡ** khỏi timeline, field `pan` **giữ** trong schema v3 và store setter `updateTrackPan` vẫn còn (dữ
liệu cũ không bị xoá, không bị reset về 0), và hàng track hiện cảnh báo khi giá trị khác 0. Pan trở lại khi có một leg mixer
stereo kèm test playback/mix/export. (e) Archive bộ tài liệu V4: `DEFERRED / OWNER APPROVAL REQUIRED` — xem §10 mục 4. (f)
Parity pixel cũ/mới: chấp nhận bằng chứng lịch sử §53.11, **không** dựng lại engine cũ; mục §57.5 nói rõ cái gì chưa được
kiểm độc lập.)*
