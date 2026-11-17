# Cấu Hình AI Cục Bộ (App-local AI Configuration)

Mỗi app trong nền tảng TM tự lưu **kết nối AI của riêng nó**, theo từng tài khoản, trong cơ sở dữ liệu
của chính app đó. TM Studio lưu các kết nối này trong MongoDB của studio (collection `ai_connections`) và
niêm phong khoá API bằng `AI_CONFIG_SECRET`. Tài liệu này mô tả ba chỗ lưu khoá, hợp đồng biến môi trường,
migration và cách triển khai web.

Trang quản lý: `/system/ai-keys`, tab **Key Vault & Surfaces** (`AiLocalConnectionsCard`).

---

## 1. Ba chỗ lưu khoá AI

1. **Hub connection** (`/resources/connections`): credential do TM Hub giữ; studio chỉ đọc catalogue và gọi
   qua relay. Hub vẫn là nơi trung tâm cho các provider dùng chung.
2. **App-local row** (`ai_connections`, theo từng tài khoản, trong MongoDB của studio): mỗi dòng thuộc về
   một user; chỉ cột `apiKeyCipher` chứa khoá, đã niêm phong AES-256-GCM (`sealSecret`).
3. **Local vault trên Electron** (`config.env` trong `userData`): các slot của gateway (`AI_API_KEY*`,
   `TMCUT_GEMINI_API_KEY`), được mã hoá bằng `safeStorage` của OS (`electron/tools/ai-secure.cjs`). Nếu
   keychain không dùng được, trang hiện banner cảnh báo và key được ghi ở dạng plaintext — đọc trạng thái đó
   trước khi nhập key thật.

Ba chỗ này không thay thế nhau: hub connection dùng cho provider dùng chung, app-local row dùng cho kết nối
riêng của từng tài khoản, còn local vault là di sản của bản desktop trước migration.

---

## 2. Biến môi trường

| Biến | Đặt ở đâu | Ai đặt | Ghi chú |
| :--- | :--- | :--- | :--- |
| `MONGODB_URI` | `.env` khi chạy local, hoặc Project Settings → Environment Variables trên Vercel | người vận hành | **Bắt buộc** cho tính năng AI cục bộ; thiếu thì API trả 503 `error.mongoMissing` |
| `MONGODB_DB` | cùng chỗ với `MONGODB_URI` | người vận hành | Tên database; mặc định `tm_studio`. Collection `ai_connections` nằm trong database này |
| `AI_CONFIG_SECRET` | Desktop: tự sinh ở lần chạy đầu và ghi vào `config.env` (một secret slot, được `safeStorage` mã hoá, Main giải mã vào `process.env` khi khởi động qua `loadUserConfig`). Web: người vận hành đặt tay | desktop tự sinh / người vận hành | 32 byte ngẫu nhiên, dạng base64. **Không commit.** Mất khoá này thì các key đã lưu không đọc được nữa và phải nhập lại từng dòng |

> **Mất `AI_CONFIG_SECRET` là mất key.** Cipher trong `ai_connections` không thể giải mã bằng một secret
> khác, nên cách xử lý duy nhất là nhập lại khoá cho từng kết nối. Hãy sao lưu secret ở nơi quản lý bí mật
> của bạn trước khi đổi máy hoặc tạo deployment mới.

> **Dev khác bản desktop đóng gói.** `pnpm dev:electron` chạy `nuxt dev` như một tiến trình riêng, đọc
> `.env` của project chứ không đọc `userData/config.env`, nên muốn lưu khoá ở chế độ dev thì người vận hành
> phải tự đặt `AI_CONFIG_SECRET` trong `.env` (tooling không bao giờ sửa `.env`).

---

## 3. Khoá AI không rời máy chủ

- Renderer **không bao giờ** nhận khoá. API `/api/v1/ai/connections` chỉ trả `hasKey` (đúng/sai) cùng các
  trường không bí mật (`connectionId`, `providerKey`, `baseUrl`, `apiKeyEnv`, `models`).
- Khoá được niêm phong AES-256-GCM ngay khi ghi và chỉ được mở trên server trong thời gian một lần gọi.
- Không ghi khoá vào log, không đưa khoá vào `NUXT_PUBLIC_*`, không đưa khoá vào tài liệu hay seed.

---

## 4. Triển khai Vercel + MongoDB Atlas

- `MONGODB_URI`, `MONGODB_DB` và `AI_CONFIG_SECRET` đều là biến **server-only**; không biến nào được đặt
  tiền tố `NUXT_PUBLIC_`.
- Vercel đọc biến môi trường khi tạo deployment, nên sau khi đổi giá trị phải **redeploy** thì giá trị mới
  mới có hiệu lực.
- MongoDB Atlas phải chấp nhận dải IP egress của Vercel (Atlas **Network Access**; với serverless thường
  dùng `0.0.0.0/0`). Nếu Atlas chặn kết nối, mọi endpoint AI cục bộ trả **503**.

Khi thiếu cấu hình, API trả 503 với một trong ba mã sau, và tab **Key Vault & Surfaces** hiện đúng thông
điệp đó phía trên editor:

| Mã lỗi | Khi nào |
| :--- | :--- |
| `error.mongoMissing` | Chưa đặt `MONGODB_URI` |
| `error.mongoUnavailable` | Có `MONGODB_URI` nhưng không kết nối được tới MongoDB |
| `error.aiConfigSecretMissing` | Chưa có `AI_CONFIG_SECRET` trên server |

---

## 5. Migration từ cấu hình gateway cũ

Các preset gateway đã có trên bản desktop **vẫn nằm trong config của Electron**; chúng không bị xoá và
không được tự động import. Người dùng nhập lại khoá một lần trong phần kết nối AI cục bộ (tab
**Key Vault & Surfaces**), sau đó các dòng trong `ai_connections` là nguồn sự thật. Lý do không auto-import:
config của gateway gắn với **máy** (một `config.env` cho cả máy), còn các dòng trong database gắn với
**tài khoản**, nên một bản import tự động sẽ gán khoá của máy cho một user cụ thể mà không có sự đồng ý.

---

## 6. Liên quan

- Hướng dẫn cài đặt chung và các biến môi trường khác: [`content/system-setup-and-configuration-guide.md`](./content/system-setup-and-configuration-guide.md).
- Driver lưu trữ dùng chung (`createMongoAIConfigStore`, …): `tm-platform/packages/tm-ai-client/README.md`.
