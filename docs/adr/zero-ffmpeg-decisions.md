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
| ADR-028 | FFmpeg/FFprobe bị loại khỏi repo, build và dependency tree | **CHỜ** — engine vẫn là đường render duy nhất | slice I, và slice I chờ H có output đầu tiên |
| ADR-029 | Mediabunny đảm nhận demux + mux, không phải "FFprobe clone" | **MỘT PHẦN** — leg probe đã code ở slice B, commit `1b57ca1`, và **đã có consumer** từ slice C1: verdict của nó là thứ quyết định `importStatus`/`status` của asset trong library (audit §16) | leg mux thuộc slice H |
| ADR-030 | decode/encode qua WebCodecs, hỏi capability trước khi dùng | **MỘT PHẦN** — probe đã đọc `isConfigSupported`/codec table; từ lượt H1, **luật** của leg encode đã ở core và test được mà không cần browser: preset phải đến từ câu trả lời đã ghi (`unmeasured` ≠ `supported`, codec bị runtime đổi là `substituted` = thất bại), timestamp đến từ index × FPS hữu tỉ chứ không từ `canvasFpsValue` hay wall clock, và bound in-flight không được phép thành 0 (audit §48). Từ lượt H2, **câu hỏi** cũng là luật (`planEncodePresets`: level theo Annex A, container theo codec family, cả hai spelling AAC), seam app gọi `isConfigSupported` cho từng preset (audit §49.3), và **ma trận encode của máy này đã đo thật** — Chrome 156, §49.4. Từ lượt H3a, **đồng hồ audio** cũng là luật: packet đặt theo số sample, duration là hiệu hai vị trí, packet cuối mang phần còn lại (audit §50). Hai điều ADR-030 nói thẳng: `hardwareAcceleration` không phân biệt được phần mềm/phần cứng trên máy này nên **hardware H.264 vẫn chưa chứng minh**; và runtime nhận config mà Annex A cấm (§49.5) nên `supported: true` không đồng nghĩa "file hợp pháp". Chưa encoder nào chạy, chưa file nào xuất. | slice H (leg encode + mux) |
| ADR-031 | một timeline evaluator + một composition model cho hai host | **ĐÃ ÁP DỤNG** — `evaluateTimeline`, `renderAt`, `createFrameScheduler`, `paintStack` | slice J phải trả nốt phần core đang in văn bản FFmpeg |
| ADR-032 | Electron là shell, không sở hữu media engine thứ hai | **MỘT PHẦN** — engine HTML-video thứ hai đã xoá (ADR-023); engine FFmpeg desktop còn tới slice I. Slice C1 cộng thêm một bằng chứng "một service cho hai host": nhánh desktop và nhánh web của `analyzeAsset` cùng đi qua một verdict table (audit §16.2) | slice I |
| ADR-033 | media đi trong máy mặc định; rời máy là một lựa chọn hiển thị | **CHỜ** — web host vẫn stream file đã chọn lên server (`server/api/v1/media/upload.post.ts`), và **upload vẫn bắt buộc**. C1 dựng **điều kiện** (fingerprint dẫn xuất từ path + revision, audit §16.2); C2 dựng **chữ** cho cùng điều kiện đó (`isMediaOffline` + plate Media Offline trên ba bề mặt, §17); C2b dựng **cache vật lý** (`byteCache.mjs` luật + `byteStore.ts` OPFS/IndexedDB, ghi khi import/relink, đối chiếu khi mở library, §18). **Đường đọc giờ có bốn leg**: pixels (§20/D2), silence (§33/E4), waveform (§44/G2 — artifact đọc lại sau reload mà không chạm file), và **playback** (**G4b**, đo 2026-11-06, §47: `app/utils/tmcut/playbackBytes.ts` + `useTmcutPlaybackBytes.ts` thay stream URL bằng `blob:` dựng từ byte cache, luật từ chối vẫn nằm ở core). G3 và G4a không đổi mục này — chúng đổi **mức** (§45) và **thời gian** (§46), không đổi nguồn bytes. Còn mở: **export** vẫn đi `/uploads/` (desktop còn đọc từ đĩa), và `currentSrc` của element mà editor mount cùng console sweep năm route cần một session đăng nhập mà tôi không cầm credentials (§47.6). ADR-033 vì thế vẫn **CHỜ**: code đã ship, đường đọc playback đã đo trên origin `:4003` với store thật, còn thiếu phép đo trên element mount thật. | G #140 / H |

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
Probe cũ của web trả `fps: 0` khi không đo được ([app/utils/tmcut/webProbe.ts:34](file:///D:/Applications/tm-studio/app/utils/tmcut/webProbe.ts#L34)) —
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
Cái còn nợ là một lớp: **core vẫn phát hành cú pháp FFmpeg như API công khai** — 8 module in văn bản filtergraph, 2 module parse output FFmpeg (audit §5.1).

**Quyết định.** Semantics là thứ thuộc core và **mô tả ý định**, không mô tả cú pháp của một binary cụ thể.
`paintStack` quyết định lớp nào sơn; `renderAt` quyết định state tại một timestamp; `createFrameScheduler` quyết định frame nào tồn tại.
Bộ sinh cú pháp FFmpeg — `setpts`, `xfade`, `geq`, `drawtext` — bị thay bằng instruction mà compositor và exporter cùng đọc được (slice J).
Hai module chỉ nhắc FFmpeg trong comment (`textStyle`, `transitions`) không thuộc khối việc này.

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
| 4 | V4 roadmap | **Sửa prose ngay, archive cả bộ ở slice K.** Lý do: DoD §25 của plan có mục "không docs hướng dẫn cài FFmpeg" — dán nhãn supersede mà để nguyên **14** dòng prose còn cho phép fallback (đo ở audit §5.3) thì mục đó vẫn fail khi grep. | 028 |
| 5 | Số ADR | **028…033**, ánh xạ ở §0. | — |
| 6 | `backup/ffmpeg-engine-2026-11-03/` | **Giữ untracked tới slice I**, rồi xoá. Nó là bản soi chiếu để kiểm tra lại, không phải lịch sử; lịch sử đã có git (source commit `92a4818`). | — |
| 7 | `resources/*.exe` (471 MiB) | **Xoá ở slice I**, và chỉ sau khi chủ repo duyệt; đây là thao tác khó đảo và là điểm không quay lại. | 028 |
| 8 | ADR-025 (font vendoring) | **Vẫn mở.** Sau khi `drawtext` về hưu, nó có thể tự đóng vì chữ sẽ do renderer của app sơn bằng WOFF2 đang có; phải đo ở slice J rồi mới khai. | 031 |
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
| 1 | Stabilization | **Bỏ hẳn** khỏi TMCut Browser Edition: xoá nút trong UI và key i18n, không làm optical-flow. | Project cũ còn dữ liệu stabilization phải **giữ nguyên và đánh dấu unsupported**, không im lặng xoá. UI + i18n ở slice I, emitter `stabilize` ở slice J. Xác nhận hàng 1 của §8. |
| 2 | Subtitle burn-in | **Sơn bằng text track** qua `paintStack` đã có; không parser ASS, không libass. | Feature ASS không hỗ trợ phải khai rõ ràng. Slice H cho export, slice J cho emitter `subtitles`. Xác nhận hàng 9 của §8. |
| 3 | Binary FFmpeg trong package | **Gỡ khỏi package ở slice I**, nhưng giữ file trên máy dev cho tới khi slice H xong và parity đã đo thật. | Không xoá binary hay bản backup nào trước mốc đó. |
| 4 | FFmpeg phía server | **Server chỉ là storage.** Bỏ render, analyze, proxy phía server; render = WebCodecs + TMCut Core, analyze = MediaProbeService + Mediabunny + Web API, proxy và thumbnail = pipeline local trong browser. | `upload.post.ts` **không mất** khả năng Web upload: nó là Storage Upload API thuần, không FFmpeg, không binary xử lý media. Media ở local mặc định, chỉ upload khi user yêu cầu rõ (Cloud Library, Stock Library). Không cloud render ở bản này. Luật này đã có guard: `tests/unit/tmcut_server_media_boundary.spec.ts`. |
| 5 | Project schema | **Khoá schema v3 thật**: `version: 3` với `timeline.tracks`; sửa roadmap và interface mẫu cho khớp repo. | Không migrate sang `tracks` và `sequences` khi chưa có yêu cầu chức năng thật; migration cũ phải tiếp tục chạy. **Đã khoá 2026-11-04** bằng `tests/unit/tmcut_project_schema_v3.spec.ts`: shape app file (12 key top-level, `timeline` 4 key, `schemaVersion: 3`, `timeline.version: 1` chỉ là nhãn), shape core (`version: 3`, `timeline.version: 3`, `validateTimeline` nhận), `sequences` **0** hit trong toàn bộ code shipped, và `timeline.version` đúng **một** chỗ đọc. Hai chỗ đã khớp sẵn: `docs/v4-phase-0-audit.md` §4.1 mô tả đúng cả hai model. Sample `sequences` chỉ tồn tại ở `docs/tmcut-zero-ffmpeg-zero-ffprobe-browser-first-roadmap.md:339-347` — file plan **untracked của chủ repo**, không commit, không tự sửa; bản đó đang sai và chủ repo quyết định xoá hay ghi chú. |
| 6 | Đường dẫn media chết | **Media Offline / Missing Media kèm nút Relink.** | Không tự mở dialog, không xoá asset reference khỏi project khi đường dẫn hỏng. **Cả hai vế đã code**: tầng dữ liệu ở C1 (audit §16.3 — relink hỏng đích vẫn giữ asset, `usedBy` và clip reference, chỉ trả `false`), tầng UI ở C2 (audit §17 — plate Media Offline trên library + timeline + preview, ba check hành vi đo đúng: huỷ thì im lặng, hỏng thì báo, và `assets.length` vẫn là 1 sau cả hai). Guard: `tmcut_media_offline.spec.ts` 13 check, gồm check quét không file `.vue` nào tự gọi `relink(` hay tự branching trên `importStatus` |
| 7 | Font | **Chỉ font đi cùng app** tới slice J; không quảng bá import font khi chưa làm. | Đánh giá FontFace + OPFS ở slice J, rồi mới nói tới ADR-025. |
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
