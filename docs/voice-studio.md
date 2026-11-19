# Voice Studio

Voice Studio (`/tmcut/voice`) tạo lời đọc từ ba họ engine: engine cục bộ (VieNeu / CIT Voice Studio),
Gemini TTS và các nhà cung cấp cloud. Mỗi bản đọc ("take") được lưu vào thư viện media và (nếu đang mở
dự án) thêm vào audio track; panel giữ 20 take gần nhất để nghe lại hoặc mở thư mục.

Tài liệu này mô tả kiến trúc, giới hạn, luồng huỷ/tiến độ và hợp đồng khoá của phần cloud (R146–R147).

---

## 1. Engine và nơi chạy

| Engine | Chạy ở đâu | Khoá | Ghi chú |
|---|---|---|---|
| `local` (VieNeu :8000, CIT :8001) | Loopback trên máy | Không | Desktop tự tải/chạy engine; web gọi qua Nitro proxy `/api/v1/media/tts` |
| `gemini` | Main process | `TMCUT_GEMINI_API_KEY` | Chỉ desktop |
| `gtts` (Google Translate) | Main (desktop) hoặc Nitro (web) | Không | Chia câu ≤190 ký tự, ghép MP3 |
| `openai` | Main process | `TMCUT_OPENAI_API_KEY` | `gpt-4o-mini-tts`, mp3 |
| `elevenlabs` | Main process | `TMCUT_ELEVENLABS_API_KEY` | `eleven_multilingual_v2`, voice ID |
| `azure` | Main process | `TMCUT_AZURE_SPEECH_KEY` + `TMCUT_AZURE_SPEECH_REGION` | SSML, mp3 24 kHz |
| `google` (Cloud TTS) | Main process | `TMCUT_GOOGLE_TTS_API_KEY` | LINEAR16 → WAV |

Registry và các builder request thuần nằm ở `electron/tools/tmcut-cloud-voice.cjs`; không import
`electron` ở top-level nên test node chạy được mọi shape request mà không cần mạng hay khoá.

---

## 2. Kiến trúc

```
renderer (Nuxt)                    Main (Electron)                       Nhà cung cấp
  cloudVoices ──────────────────▶  catalogue + hasKey/hasRegion
  cloudSynthesize {provider,text,voice,requestId}
            ◀────────────────────  tmcut:cloudProgress {requestId,done,total}
  cloudCancel {requestId} ──────▶  AbortController.abort()
  cloudListVoices {provider} ───▶  /v1/voices (key từ config)
```

- Desktop: mọi lời gọi đi qua preload whitelist (`electron/preload.cjs`) → IPC `tmcut:*` →
  `electron/tools/tmcut.controller.cjs`. Renderer **không bao giờ** gửi khoá, URL engine hay đường dẫn file.
- Web: chỉ engine không khoá. `GET /api/v1/media/tts-cloud` trả catalogue (chỉ `gtts`),
  `POST /api/v1/media/tts-cloud` tổng hợp và trả `{ ok, url: '/uploads/<name>.mp3' }`. Cả hai yêu cầu
  phiên đăng nhập (401 nếu thiếu).
- Take được import qua `useTmcutInsertAsset`; lịch sử nằm ở `localStorage['tmcut_voice_takes']`
  (tối đa 20, mới nhất trước, dedupe theo đường dẫn).
- Dọn file cũ (tuỳ chọn): đặt `TOOLS_UPLOADS_RETENTION_DAYS=<n>` để mỗi lần upload thành công kích hoạt
  quét xoá file trong `.data/uploads` cũ hơn n lần (tối đa một lần/giờ). Mặc định `0` = giữ tất cả,
  vì một dự án đã lưu có thể vẫn tham chiếu URL `/uploads/...`.

---

## 3. Khoá và bảo mật

- Bốn slot cloud nằm trong `SECRET_SLOT_RE` (`electron/tools/secret-slots.cjs`): được mã hoá at-rest,
  che `********` khi `get-config` đọc lại, và được đẩy vào `process.env` khi `set-config`.
- Lưu khoá từ UI dùng `bridge.setConfig`, **không** dùng IPC synthesize. `TMCUT_AZURE_SPEECH_REGION`
  không phải credential nên không nằm trong `SECRET_SLOT_RE`.
- `cloudSynthesize` đọc khoá từ `process.env` theo `spec.keySlot`. Nếu upstream trả lỗi có chứa khoá,
  Main thay khoá bằng `********` trước khi trả renderer (regex pin trong
  `tests/unit/tmcut_cloud_voices.spec.ts`).
- Web không có đường nào nhận khoá: catalogue web chỉ có `gtts`, và không có tham số key/region/URL.

---

## 4. Giới hạn

| Giới hạn | Giá trị | Nơi áp dụng |
|---|---|---|
| Text chung | 5 000 ký tự | Mọi provider cloud |
| Text gtts mỗi request | 190 ký tự | Chia theo câu, cắt theo từ nếu câu quá dài |
| OpenAI | 4 096 ký tự | `validateProviderText` |
| Google Cloud | 5 000 **byte** UTF-8 | Tiếng Việt có dấu chiếm 2 byte/ký tự |
| Audio mỗi take | 64 MiB | Main + Nitro |
| Timeout mỗi request | 120 s (desktop), 60 s (web) | `AbortSignal.timeout` ghép với tín hiệu huỷ |

---

## 5. Tiến độ và huỷ (R147)

- Renderer sinh `requestId` cho mỗi lần tạo và truyền vào `cloudSynthesize`. Main gửi
  `tmcut:cloudProgress` `{ requestId, done, total }` một lần khi bắt đầu (`done=0`) và sau mỗi đoạn.
  UI hiển thị "Đoạn done/total" cạnh nút Huỷ, chỉ cho take khớp `requestId`.
- Nút **Huỷ** gọi `cloudCancel { requestId }`; Main `abort()` job. Fetch đang chạy ném `AbortError`,
  handler trả `{ ok: false, canceled: true }`, renderer báo "Đã huỷ tạo giọng đọc" và không ghi take.
- Job được đăng ký trong `cloudJobs` và luôn xoá ở `finally`; job không tồn tại trả lỗi rõ ràng.
- Web: trình duyệt không có kênh tiến độ. Nút Huỷ huỷ `$fetch`; Nitro lắng `res` `close` và
  `abort()` vòng chia đoạn, kiểm tra giữa các đoạn nên tác vụ dừng thay vì chạy tiếp vô ích.

---

## 6. Backoff 429/503

Cả Main (`fetchCloudWithRetry`) và Nitro (`fetchGtts`) thử lại tối đa 3 lần:

1. `Retry-After` (giây) nếu có, tối đa 5 s;
2. nếu không, 500 ms → 1 000 ms → 2 000 ms (trần 4 s).

Body của response bị huỷ trước khi chờ để giải phóng socket; tín hiệu huỷ vẫn có hiệu lực trong lúc chờ.

---

## 7. Danh sách giọng động

`cloudListVoices { provider }` chỉ dành cho ElevenLabs và Google Cloud (desktop, cần khoá đã lưu):

| Provider | Gọi | Chuẩn hoá |
|---|---|---|
| ElevenLabs | `GET https://api.elevenlabs.io/v1/voices` | `voice_id` + `name`, tối đa 100 |
| Google Cloud | `GET https://texttospeech.googleapis.com/v1/voices?key=…` | `name` + `languageCodes[0]`, tối đa 200 |

Kết quả thay danh sách tĩnh cho phiên hiện tại (`effectiveCloudVoices`); đổi provider sẽ xoá danh sách
đã tải. Khoá vẫn nằm ở Main — request do `cloudVoiceListRequest` dựng, renderer chỉ thấy `{ id, label }`.

---

## 8. Lịch sử, nghe lại, mở thư mục

- Mỗi take ghi `{ path, engine, text, createdAt }`; engine hiển thị qua `tmcut.voice.engines.*`.
- **Nghe** mở `LazyToolsVideoPreviewModal` (`kind="audio"`) — web phát `/uploads/...`, desktop phát qua
  `media://`.
- **Mở thư mục** chỉ hiện khi `isDesktop` và đường dẫn không phải `/uploads/` (web không có thư mục cục bộ).

---

## 9. Kiểm thử

| Lớp | Bằng chứng |
|---|---|
| Request/parse từng provider, chia đoạn, giới hạn | `tests/unit/tmcut_cloud_voices.spec.ts` (16 check) |
| Job huỷ, progress, backoff, khoá không qua IPC | Cùng spec, pin theo source + pure module |
| Web route 401 và chỉ `gtts` | Cùng spec + `GET /api/v1/media/tts-cloud` trả 401 khi thiếu phiên |
| Live web: tạo take thật, phát audio | `node_modules/.cache/gates/cloud-voice-live.mjs` — take `gtts`, `readyState 4` |
| Live web: huỷ giữa chừng + tạo lại | `node_modules/.cache/gates/cloud-cancel-live.mjs` — có toast huỷ, 0 take, take sau thành công |
| Live desktop: tiến độ, huỷ, phục hồi qua IPC thật | `node_modules/.cache/gates/desktop-cloud-live.mjs` — 0/4 → 1/4, `cloudCancel` ok, `canceled: true`, take sau ghi file 24 KB |
| Đo thời lượng tối đa (4 851 ký tự) | `node_modules/.cache/gates/desktop-cloud-timing.mjs` — 26 đoạn, 8,4 s, ~323 ms/đoạn |

**Chưa chứng minh:** OpenAI/ElevenLabs/Azure/Google chưa gọi API thật (không có khoá); danh sách giọng
động chưa gọi API thật. Tiến độ/huỷ desktop đã chứng minh trên Electron dev, chưa chạy trên bản đóng gói.

---

## 10. Việc tiếp theo

1. Chạy thử desktop với khoá thật: lưu khoá → tạo → mở thư mục; kiểm tra tiến độ nhiều đoạn và huỷ.
2. Bật `TOOLS_UPLOADS_RETENTION_DAYS` trên máy chủ web khi muốn giới hạn vòng đời file.
3. Nút tải lại danh sách giọng theo provider đã chọn (hiện phải bấm lại sau mỗi lần đổi).
4. Không cần cap số đoạn cho gtts: thuật toán gộp câu chặn số đoạn ở ⌈ký tự/190⌉ ≈ 27, đo thực tế
   4 851 ký tự = 26 đoạn/8,4 s trên desktop.
