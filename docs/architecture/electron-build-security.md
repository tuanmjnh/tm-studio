# Electron build security, root-only surfaces, and the account avatar

Ngày đo: **2026-11-09**. Phạm vi: **chỉ tm-studio**. Ba quyết định trong tài liệu này thi hành theo P0→P5 của
chỉ thị kiến trúc; mọi số liệu dưới đây lấy từ lần chạy trong chính phiên làm việc, không lấy từ trí nhớ.

Quy tắc đã đọc lại trước khi sửa: không nhét `AUTH_JWT_SECRET`, `NUXT_HUB_APP_SECRET`, provider key hay DB
credential vào bản build; không "mã hoá cho có rồi gọi là bảo mật"; không xoá cơ chế cũ trước khi luồng mới
được xác minh; nếu Hub chưa có API an toàn cho public client thì báo **BLOCKED**, không nhét App Secret vào.

---

## 1. P0 — Audit: hai bí mật dùng chung, một policy rỗng

### 1.1 Bí mật đã ship trong bản build (đo, không suy đoán)

Quét 603 file dưới `.output/` bằng cách so từng literal lấy từ `.env` (giá trị không in ra):

| Khoá | Dài | Có trong `.output` trước khi sửa | Nguồn |
|---|---|---|---|
| `AUTH_JWT_SECRET` | 64 | **không** | `server/config/index.ts` đọc `process.env` lúc chạy |
| `NUXT_HUB_APP_SECRET` | 64 | **có — `.output/server/chunks/_/nitro.mjs`** | `nuxt.config.ts` đọc `process.env` lúc build |

Nguyên nhân khác nhau ở một dòng config, không ở biến môi trường: Nuxt serialize `runtimeConfig` tại thời điểm
build vào server bundle, và bundle đó nằm trong installer. Một giá trị "private" vẫn ship nếu nó được tính ở
`nuxt.config.ts`.

`release/win-unpacked/resources/app.asar.unpacked/.output/.../nitro.mjs` của bản trước đó cũng chứa literal này.

### 1.2 Bản đồ API: app-secret hay user-JWT

| Nhóm | Route | Danh tính | Ghi chú |
|---|---|---|---|
| App-secret (server→hub) | `POST /api/v1/ai/relay/chat`, `GET /api/v1/ai/relay/catalog` | user JWT **+** `X-App-Secret` | chỉ hai route này dùng app secret |
| User-JWT | toàn bộ `/api/v1/**` còn lại | user JWT | media, process, stock, TTS |
| Công khai | `/api/health`, `/api/system/network` | không | chỉ trạng thái, không dữ liệu |

### 1.3 RBAC phía server là no-op (đo)

`server/middleware/rbac.ts` khai báo `const permissionMap: Record<string, string> = {}` rồi lặp trên nó —
vòng lặp không chạy lần nào. Kiểm tra duy nhất là `auth.ts`: JWT hợp lệ và đúng `appId`. Hệ quả thật:
`POST /api/v1/ai/discover` bắt Nitro `fetch` một `baseUrl` do người gọi chọn — bất kỳ tài khoản đã đăng nhập
nào cũng biến server thành proxy vào mạng nội bộ. Renderer ẩn trang admin bằng route tree của Hub; đó là
quyết định UI, không phải kiểm tra.

### 1.4 Khởi động Nitro trong Electron (đường đi của credential)

`electron/main.cjs` → `startServer()` → `loadUserConfig()` đọc `userData/config.env`, giải mã các slot khớp
`SECRET_SLOT_RE` (safeStorage), gán vào `process.env` nếu biến chưa có → `NITRO_PORT/NITRO_HOST` → import
`.output/server/index.mjs`. Đường này là cách một credential **theo từng máy** đến được relay mà không cần
secret trong build — nhưng chỉ khi slot đó nằm trong regex.

### 1.5 Phạm vi ảnh hưởng trước khi sửa

| Thành phần | Phụ thuộc | Ảnh hưởng |
|---|---|---|
| `nuxt.config.ts` `runtimeConfig.hubAppSecret` | 2 route relay | đổi sang đọc env lúc chạy |
| `server/utils/jwt.ts` | `auth.ts`, mọi `/api/**` | giữ HS256, thêm RS256/JWKS/introspect |
| `server/middleware/rbac.ts` | mọi `/api/**` | thay map rỗng bằng policy default-deny |
| `UserMenu.vue`, `profile.vue` | `useAuth().user` | đổi fallback ảnh |
| `SECRET_SLOT_RE` | main, key-migrate, ai-gateway | thêm một slot |

---

## 2. P1 — Root-only: server quyết định, UI chỉ hiển thị

`server/utils/serverAccess.ts` là policy duy nhất, hàm thuần, **default-deny**:

- `PUBLIC_PATHS` — `/api/health`, `/api/system/network`.
- `SIGNED_IN_PREFIXES` — `/api/push/`, `/api/v1/{media,process,stock}/`, `/api/v1/ai/relay/`.
- `ADMIN_ONLY_PREFIXES` — `/api/v1/ai/discover`, đòi capability AI-management (`ai.discover`,
  `ai.providers.write|read`, hoặc dạng phẳng `ai:write` mà Hub sinh ra từ role seed).
- root (`role === 'root'` hoặc `*`) đi qua mọi route.
- còn lại: **403**, kể cả route mới chưa có quyết định.

`server/middleware/rbac.ts` chỉ còn một lời gọi policy. UI khớp lại: `auth.global.ts` chặn `/system/hub-integration`
bằng `ROOT_ONLY_PATHS` trong `shared/rbac.ts` (Hub seed route này vào role `admin`, nên route tree không đủ);
`ai-keys.vue` và `connections.vue` tự kiểm capability ở `definePageMeta` để vào thẳng URL không hiện bảng
điều khiển trả 403.

Trang `hub-integration.vue` thôi in `AUTH_JWT_SECRET=<copy từ tm-hub/.env>` trong snippet cấu hình — đó là
hướng dẫn mang hình dạng credential, đúng thứ Q1 cấm.

### Bằng chứng (dev server `:4003`, token ký cục bộ, không in secret)

```
PASS  non-root  POST /api/v1/ai/discover      -> 403 error.forbidden
PASS  admin     POST /api/v1/ai/discover      -> 200
PASS  root      POST /api/v1/ai/discover      -> 200
PASS  non-root  GET  /api/v1/process/runs     -> 200
PASS  non-root  GET  /api/v1/ai/relay/catalog -> 401 error.unauthorized (policy cho qua; Hub từ chối ở tầng trên)
PASS  non-root  GET  /api/v1/unknown-route    -> 403 error.forbidden
```

---

## 3. P2 — Avatar: tài khoản → ảnh đóng gói → chữ cái đầu

Thứ tự hiển thị trong `UserMenu.vue`:

1. `auth.user.avatarUrl` — Hub trả trong `me.get.ts` (nhánh uncommitted của tm-hub đã thêm `avatar_url` + `name`
   vào select); `useAuth()` map ở **cả** `applyAuthData` (login/register) và `fetchUser` (`/auth/me`).
2. `DEFAULT_AVATAR_URL = '/avatar-default.svg'` — ảnh SVG đóng gói trong `public/`, không tải từ host khác.
3. chữ cái đầu, tính từ `name` hoặc `email`, truyền qua `text` của `UAvatar`.

Trước đây mọi người dùng thấy ảnh GitHub của tác giả Nuxt UI (`benjamincanac.png`), và Chromium chặn nó
bằng CORB. Kiểm chứng: `tmcut_user_menu_avatar.spec.ts` (8 check) và trang profile đọc `u.avatarUrl`
không còn `u.avatar`.

---

## 4. P3 — JWT: JWKS trước, chia sẻ sau, introspect cuối

`server/utils/tokenVerify.ts` là factory thuần; `server/utils/jwt.ts` cấu hình nó và **chỉ bật
introspection khi process không có key material cục bộ** (để một token hỏng không thành một round trip).

| Bước | Vật liệu | Trạng thái |
|---|---|---|
| 1 | Public JWK inline (`AUTH_JWT_PUBLIC_KEYS`, JSON, không phải secret) | **sẵn sàng**, đây là đường của bản desktop |
| 2 | JWKS URL (`AUTH_JWT_JWKS_URL`) | code sẵn; **Hub chưa publish** endpoint này |
| 3 | Introspection (`POST /api/v1/auth/introspect`) | **có trên Hub production**, dùng khi không có key cục bộ |
| 4 | HS256 shared secret (`AUTH_JWT_SECRET`) | giữ cho giai đoạn chuyển tiếp |

Kiểm tra đã chạy: `tmcut_token_verify.spec.ts` 16 check — HS256 đúng/sai secret, token hết hạn, `purpose:
totp` bị từ chối như access token, `alg: none`, RS256 qua public JWK inline, RS256 qua JWKS, key lạ bị
từ chối, JWK có `d` bị bỏ, chuyển tiếp HS256 khi JWKS đã bật, introspection + cache tới hạn + không cache
kết quả từ chối.

### Trạng thái hai blocker cũ (đóng ở v2 — xem §8)

- **Hub đã phát hành JWKS**: `GET /api/v1/auth/jwks` trả public JWK set, `server/modules/token/jwt.ts` ký
  RS256 kèm `kid` khi `AUTH_JWT_PRIVATE_KEY` có mặt. Bước 2 bật bằng `AUTH_JWT_JWKS_URL`; bước 1 vẫn là đường
  của bản đóng gói (public key inline, không phải secret). Ghi nhận tại thời điểm §4 viết: endpoint chưa có.
- **HS256 chỉ còn là đường chuyển tiếp** cho token Hub mint trước khi rotate. `AUTH_JWT_SECRET` không cần
  có mặt trong một bản desktop mới: verifier chạy được chỉ với public key hoặc introspection.

---

## 5. P4 — Device enrollment: BLOCKED ở phía Hub, và phần tm-studio đã sẵn

Chỉ thị đòi credential **theo thiết bị** (device ID, scope, hạn, rotate, revoke) do Hub cấp sau khi đăng nhập
bằng Authorization Code + PKCE hoặc Device Authorization, lưu bằng `safeStorage` trong main process.

Đã kiểm tra tm-hub (checkout local + bản deploy):

- không có route `device/enroll`, `auth/device/code`, `devices` (mọi URL trả SPA HTML);
- không có JWKS/asymmetric signing (`server/modules/token/jwt.ts` chỉ HS256);
- `device-limit.ts` chỉ đếm session theo UA, không phát credential thiết bị;
- relay vẫn là API duy nhất nhận `X-App-Secret`; không có API user/device-scoped tương đương.

**Kết luận tại thời điểm §5 viết: BLOCKED** — không thể làm đúng Q1 trong phạm vi tm-studio mà không có API
mới phía Hub. Theo chỉ thị, tm-studio **không** được nhét app secret vào bản build để "chạy tạm"; thay vào đó:

1. Relay đọc secret từ `process.env` **lúc chạy**, không phải lúc build (đã làm) — nên bản build không mang
   secret, và một deployment web có thể đặt secret trong env của platform.
2. `NUXT_HUB_APP_SECRET` được thêm vào `SECRET_SLOT_RE`, nên nếu một máy cần nó thì nó nằm trong
   `userData/config.env` **đã mã hoá bằng safeStorage** như mọi API key khác — không phải plaintext, không
   phải hằng số trong installer.
3. Phần mà tm-studio sở hữu — xác thực token không cần secret, và policy root-only — đã xong và có test.

Phần còn thiếu để đóng P4, xếp theo thứ tự phụ thuộc: Hub phát JWKS (mở khoá bước 2 của P3) → Hub thêm
`POST /api/v1/auth/device/enroll` + route revoke/rotate → tm-studio thêm IPC `enrollDevice()` trong main,
lưu credential vào `safeStorage`, và bỏ `NUXT_HUB_APP_SECRET` khỏi đường relay (đổi sang user/device-scoped
API). Không bước nào trong ba bước đó cần sửa client trước.

Cả ba đã xong ở v2, theo một đường khác với RFC 8628 dự kiến: xem §8.

---

## 6. P5 — Build thật: không secret nào trong artifact

### 6.1 Lệnh và kết quả

| Gate | Lệnh | Kết quả |
|---|---|---|
| Typecheck | `npx nuxt typecheck` | exit 0, **0** `error TS`; `.nuxt/eslint.config.mjs` tái sinh |
| Lint | `npx eslint <20 file đã sửa>` (sau gate trên) | exit 0, 0 problem |
| Lint (nuxt.config) | `npx eslint nuxt.config.ts` | **1 lỗi có sẵn**: `nuxt-config-keys-order` báo `devtools` phải đứng trước `alias` — file này đã lỗi y hệt ở `HEAD` (kiểm bằng `git show HEAD:nuxt.config.ts \| eslint --stdin`), nên đây là nợ cũ trên dòng không sửa, không phải hồi quy của slice này |
| Unit | `npx tsx tests/unit/run-all.mts` | **132/132** spec, exit 0 |
| Electron | `node --test "electron/tools/*.test.mjs"` | 59/59 |
| Build | `pnpm build` | exit 0, "Build complete" |
| Package | `npx electron-builder --config electron-builder.yml --win --publish never` | exit 0, `tm-studio-1.0.0-setup.exe` (219 MB) |
| Live dev | 6 check policy trên `:4003` | 6/6 |
| Live built | 5 check policy trên `.output/server` chạy `:4099` | 5/5 |

### 6.2 Quét bí mật trong artifact (so literal, không in giá trị)

| Vùng | File | `AUTH_JWT_SECRET` | `NUXT_HUB_APP_SECRET` |
|---|---|---|---|
| `.output/` | 604 | không | **không** (trước khi sửa: có) |
| `release/win-unpacked/` + installer | 540 | không | **không** |
| source map (`*.map`) | 50 (nằm trong `.output`) | không | **không** |
| file env trong build | 0 | — | — |

`evaluateServerAccess` có mặt trong
`.output/server/chunks/_/nitro.mjs` của bản đóng gói — policy đã ship, không chỉ chạy ở dev.

### 6.3 Chưa chứng minh (không được đọc là PASS)

- Cài trên máy sạch, hai user Windows trên cùng máy: chưa chạy.
- First-run enrollment / logout / revoke trên **bản đóng gói**: chưa chạy. Đường code và test đã có (§8);
  phần chưa đo là hành vi của app đã cài với Hub thật.
- Ký số installer: vẫn chưa có certificate.
- Root và non-root đăng nhập thật qua Hub trên bản đóng gói: policy đã đo bằng token cục bộ cùng thuật toán,
  chưa đo bằng tài khoản Hub thật trên app đã cài.
- Avatar online/offline trên bản đóng gói: asset có trong build, chưa render trong app cài đặt.

---

## 7. Tóm tắt trạng thái

| Hạng mục | Trạng thái |
|---|---|
| Q1 — không secret trong build | **PASS** (đo trên `.output` và artifact đóng gói) |
| Q1 — bỏ hẳn shared secret khỏi quy trình | **PASS** đường code (§8); HS256 chỉ còn là chuyển tiếp |
| Q2 — root-only UI + API | **PASS** (server default-deny, 6+5 check live) |
| Q3 — avatar Hub → client | **PASS** phía tm-studio; phía Hub cần commit hai file `me.get.ts`/`me.put.ts` đã sửa |
| P4 — device enrollment | **IMPLEMENTED v2** (§8); đo trên bản đóng gói còn mở |
| P5 — build verification | **PASS** phần đo được; danh sách "chưa chứng minh" ở 6.3 |

---

## 8. Cập nhật 2026-11-10 — Device Registry v2 (P4 không còn BLOCKED)

Hub đã có (v2): `user_devices` (danh tính) + `device_credentials` (service credential),
login tự đăng ký thiết bị, và `POST /api/v1/auth/jwks`. tm-studio đã nối:

- **JWT**: `server/utils/tokenVerify.ts` đã hỗ trợ RS256 + `kid` + JWKS (`AUTH_JWT_JWKS_URL`
  hoặc `AUTH_JWT_PUBLIC_KEYS`) và từ chối `alg: none`; HS256 chỉ còn là đường chuyển tiếp.
- **Danh tính thiết bị**: `electron/tools/device-identity.cjs` (machine id đã hash, scoped
  theo app, fallback UUID `electron-installation`); Web dùng UUID trong `localStorage`.
- **Broker**: `electron/tools/hub-login-broker.cjs` — Main gửi `device` + `requestDeviceCredential`,
  nhận credential một lần, ghi vào `config.env` đã mã hoá (`HUB_DEVICE_SECRET` nằm trong
  `SECRET_SLOT_RE`), rồi **xoá** `deviceCredential` trước khi trả về renderer.
- **AI Relay**: `server/utils/hubIdentity.ts` chọn device credential trước, App Secret sau
  (chỉ deployment server); nửa cặp device thiếu → `null` (fail closed, không hạ cấp).
- **UI**: `/system/settings/devices` (danh sách, đổi tên, thu hồi) + thẻ credential cục bộ
  (metadata + "Forget this device").

Trạng thái dòng "P4 — device enrollment" ở §7 giờ là **IMPLEMENTED v2**: enrollment theo
RFC 8628 đã bị gỡ khỏi UI (credential đến từ login bình thường), và `electron-builder --dir`
đã chạy exit 0 trong lần này. `app.asar` chứa `device-identity.cjs` + `hub-login-broker.cjs`.

### 8.1 Sửa trong vòng P0–P3 (2026-11-10)

`tm-hub-client@1.2.0` **đã publish** và đã pin ở cả hai satellite — câu "chưa publish"
ở trên không còn đúng. Phần còn mở thực sự chỉ là **P0**: Hub Production chưa có
`AUTH_JWT_PRIVATE_KEY`, nên `GET /api/v1/auth/jwks` trả `{"keys":[]}` và không client nào
verify được token. Đó là việc cấu hình deployment, không phải lỗi code.

Ba lỗi trong luồng xác thực đã sửa:

1. **Credential không bị buộc vào Hub đã cấp.** `server/utils/hubIdentity.ts` trước chỉ so
   `appId`. Giờ yêu cầu khớp cả `(hubOrigin, appId)` qua
   `shared/utils/deviceCredentialScope.ts`, và báo rõ lý do từ chối
   (`hub-mismatch` / `app-mismatch` / `legacy-no-origin` / `incomplete-pair`).
2. **Broker không ghi lại Hub phát hành.** `HUB_DEVICE_HUB_ORIGIN` giờ được ghi cùng
   credential; đăng ký lại ở Hub khác sẽ thay origin cũ, không giữ cả hai.
3. **Lệch Hub bị báo thành "chưa cấu hình".** Hai route relay đi qua
   `requireHubServiceIdentity(hubUrl)` (`server/utils/aiRelay.ts`), trả
   `409 error.deviceCredentialWrongHub` thay vì `503 aiRelayNotConfigured`.

Thêm **"Forget this device" cục bộ**: `credentialStatus` / `forgetCredential` trong broker,
IPC `device:status` / `device:forget`. Thao tác này không cần root vì không rời khỏi máy;
thu hồi trên Hub vẫn là thao tác riêng, chỉ root, do Hub thực thi.

Bằng chứng đo lại: `vue-tsc` exit 0 / 0 `error TS`, lint exit 0 sau khi regenerate config,
135/135 unit + 80/80 Electron test, `nuxt build` exit 0, và `.output` không chứa giá trị
`AUTH_JWT_PRIVATE_KEY` hay `AUTH_JWT_SECRET`.
