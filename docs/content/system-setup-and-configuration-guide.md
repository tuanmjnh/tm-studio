# Hướng Dẫn Cài Đặt & Cấu Hình Hệ Thống TM Studio

Tài liệu này hướng dẫn thiết lập môi trường, biến môi trường và cấu hình kết nối giữa **TM Studio** và **TM Hub Control Plane**.

---

## 1. Tổng Quan Kiến Trúc

Hệ sinh thái TM Platform hoạt động theo mô hình **Control Plane – Satellite**:

```
┌────────────────────────────────────────────────────────┐
│                   TM HUB CONTROL PLANE                 │
│                      (Port: 4000)                      │
│                                                        │
│  - Supabase PostgreSQL: IAM, Users, Roles, RBAC Routes │
│  - MongoDB (tm-hub-logs): Audit Logging                │
│  - MongoDB (tm-hub-app): Docs & Dynamic Content        │
│  - AI provider catalog & relay                         │
└──────────────────────────┬─────────────────────────────┘
                           │ API: useHub() / X-App-Id
                           ▼
┌────────────────────────────────────────────────────────┐
│                  TM STUDIO DESKTOP APP                 │
│                      (Port: 4003)                      │
│                                                        │
│  - Nuxt 4 (UI) + Nuxt UI v4 + Electron                 │
│  - Video Timeline & Rendering Studio (TMCut Engine)    │
│  - Templates, Video Factory, HTML Video, Voice Studio  │
│  - Tải dynamic routes, configs & docs từ TM Hub        │
└────────────────────────────────────────────────────────┘
```

---

## 2. Phân Bổ Cổng Dịch Vụ (Port Allocation)

| Ứng dụng | Cổng (Port) | Vai trò |
| :--- | :--- | :--- |
| **TM Hub** | `http://localhost:4000` | Control Plane trung tâm: IAM, Roles, Routes, Configs, AI relay |
| **TM Trading** | `http://localhost:4001` | Automated Trade Desk & Quantitative Signal Engine |
| **TM Tools** | `http://localhost:4002` | Desktop utility app: Browser Hub, Downloader, FFmpeg tools |
| **TM Studio** | `http://localhost:4003` | Video timeline editor, templates, automation rendering |

---

## 3. Cấu Hình Biến Môi Trường (.env)

Tạo file `.env` tại thư mục gốc `tm-studio/`:

```env
PORT=4003
APP_PORT=3456
APP_URL=http://localhost:4003

# Kết nối Control Plane TM Hub
AUTH_PROVIDER=hub
NUXT_PUBLIC_HUB_URL=http://localhost:4000
NUXT_PUBLIC_HUB_APP_ID=tm-studio_<suffix>

# Xác thực access token bằng khoá công khai của Hub (không phải secret)
AUTH_JWT_JWKS_URL=http://localhost:4000/api/v1/auth/jwks
# hoặc dán trực tiếp public JWK set nếu client đóng gói không gọi được Hub lúc verify:
# AUTH_JWT_PUBLIC_KEYS=[{"kty":"RSA","kid":"...","n":"...","e":"AQAB"}]
```

> **`NUXT_PUBLIC_HUB_APP_ID` không phải giá trị cố định.** Hub seed sinh hậu tố ngẫu nhiên cho mỗi môi
> trường (`tm-studio_vhvrhn` ở máy hiện tại, ghi ở `resources/public-config.json` của bản đóng gói). Lấy
> giá trị thật bằng `pnpm seed:studio` trong `tm-hub` — lệnh in ra dòng
> `🔑 tm-studio NUXT_PUBLIC_HUB_APP_ID=…` và ghi thẳng vào `.env` của studio. Code chỉ rơi về
> `tm-studio_749app` khi biến môi trường **không được đặt**, nên một `.env` thiếu biến sẽ trỏ nhầm app.

> **Không cần `AUTH_JWT_SECRET` trong bản desktop.** Hub ký RS256 và công bố public key tại
> `GET /api/v1/auth/jwks`. `AUTH_JWT_SECRET` (HS256) chỉ còn để xác thực token Hub mint **trước** khi
> rotate; một deployment web có thể đặt nó nếu còn token cũ. Nếu không có key material cục bộ, app hỏi
> `POST /api/v1/auth/introspect` thay vì từ chối mọi request.

> **Relay AI không còn App Secret trong app đóng gói.** Lần đăng nhập đầu tiên trên Electron đăng ký
> thiết bị với Hub; credential theo thiết bị (`HUB_DEVICE_ID`/`HUB_DEVICE_SECRET`) do Main nhận một lần,
> lưu trong OS keychain và dùng cho `X-Device-Id` / `X-Device-Secret` ở route relay. `NUXT_HUB_APP_SECRET`
> chỉ dành cho một deployment server tin cậy, không dành cho installer. Xem thiết bị đã đăng ký tại
> `/system/settings/devices`.

> **Lưu ý bảo mật**: Không commit `.env`. Khoá API cho AI provider có **hai** chỗ lưu, và tài liệu cũ
> gộp chúng làm một:
>
> - **Hub connection** (`/resources/connections`): credential do Hub giữ; studio chỉ đọc catalogue và gọi
>   qua relay.
> - **Local vault** (`/system/ai-keys`, chỉ trên Electron): key nằm trong `config.env` ở `userData`, mã hoá
>   bằng `safeStorage` của OS (`electron/tools/ai-secure.cjs`). Nếu keychain không dùng được, trang hiện
>   banner cảnh báo và key được ghi ở dạng plaintext — đọc trạng thái đó trước khi nhập key thật.
>
> Tài nguyên media upload lên route nội bộ của studio; không có đường upload lên Hub hay bên thứ ba.

---

## 4. Khởi Tạo Cơ Sở Dữ Liệu & Seed Dữ Liệu

Từ thư mục `tm-hub`, chạy lệnh seed để đồng bộ ứng dụng, quyền và dynamic routes cho TM Studio:

```bash
cd d:\Applications\tm-hub

# Seed toàn bộ, hoặc chỉ apps/tm-studio
pnpm seed
pnpm seed:studio
# tương đương (entrypoint nhận `--app=` và cả đối số vị trí — đo 2026-11-12: exit 0):
pnpm seed --app=studio
# seed lại từ đầu cho riêng studio, khi cần đồng bộ route/role đã xoá:
pnpm seed:studio:reset
```

Seed ở chế độ thường là **upsert**: app đã tồn tại thì giữ nguyên `id` và `secret_key`, chỉ đồng bộ
route/role/config. Nó ghi `AUTH_JWT_SECRET` mới **chỉ khi** chạy `--reset`, và mỗi lần chạy còn ghi
`NUXT_HUB_APP_SECRET` của các satellite vào `.env` tương ứng — vì vậy đừng chạy seed từ một thư mục khác
nếu không muốn sửa `.env` của app khác.

Tài khoản mặc định:

* **Root**: `root@example.com`, super-admin toàn hệ thống.
* **Admin**: `admin@example.com`, quản trị thường.
* **Studio**: `studio-root@example.com` và `studio-admin@example.com` — hai tài khoản riêng của app
  studio, cùng mật khẩu root/admin.

Mật khẩu **không** được ghi trong tài liệu này. Chúng là hằng số `BUILTIN_USER_PASSWORDS` trong
`tm-hub/scripts/seed/shared.ts`, và seed ghi lại hash mỗi lần chạy. Đọc giá trị từ đó; đổi mật khẩu thì
sửa hằng số rồi seed lại. Tài liệu cũ từng in mật khẩu ở đây và đã sai so với seed hiện tại.

---

## 5. Khởi Chạy Ứng Dụng

### Terminal 1: TM Hub Control Plane (Cần chạy trước)
```bash
cd d:\Applications\tm-hub
pnpm dev            # http://localhost:4000
```

### Terminal 2: TM Studio
```bash
cd d:\Applications\tm-studio
pnpm dev:electron   # Chạy trên môi trường Electron Desktop
# hoặc khởi chạy bản web:
pnpm dev            # http://localhost:4003
```

---

## 6. Xem & Quản Lý Tài Liệu

### 6.1. Xem tài liệu trong TM Studio
* Mở **System** > **Docs** (`/system/docs`).
* Hệ thống tự động fetch bài viết từ TM Hub (`GET /api/v1/apps/:appId/docs`).
* Nếu Hub chưa khởi động hoặc mất kết nối, hệ thống sẽ fallback đọc dữ liệu tĩnh được đóng gói sẵn tại `docs/content/system_docs.json` và `docs/content/user-guide.md`.

### 6.2. Quản lý tài liệu từ TM Hub
* Truy cập **TM Hub** > **Administration** > **Content & Docs** (`/administration/content`).
* Có thể cập nhật trực tiếp nội dung Markdown, JSON cho App ID `tm-studio_...` mà không cần build lại client.

---

## 7. Kiểm Tra Chất Lượng Code

```bash
cd d:\Applications\tm-studio
pnpm typecheck      # vue-tsc
pnpm lint           # eslint
```

