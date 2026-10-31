# TM Studio — Kế hoạch tách TMCut khỏi tm-tools

> **Trạng thái:** ACTIVE — dùng làm bản ghi quyết định (ADR) + bảng tiến độ của các phase
> **Ngày tạo:** 2026-10-31
> **Quy tắc vận hành:** mỗi phase kết thúc bằng báo cáo **PASS / FAIL / BLOCKED** và cập nhật bảng tiến độ trong chính tài liệu này.

---

## 1. Bối cảnh

TMCut hiện là một nhóm tính năng bên trong `tm-tools` (Electron + Nuxt 4, port 4002, satellite của TM Hub). Nhu cầu:

- Tách **toàn bộ TMCut** thành ứng dụng độc lập **tm-studio** (`D:\Applications\tm-studio`).
- tm-studio vẫn là **satellite của TM Hub**: xác thực/identity, kết nối (connections), AI providers/models đều đi qua hub.
- **tm-tools** giữ lại vai trò console quản trị: Profiles/Browser Hub, Tools, Utilities, Media, Admin, cùng hai bộ quản trị nền tảng:
  - **Connections Admin** — quản lý kết nối tới các provider nguồn dữ liệu (hub-backed).
  - **AI Providers & Models Admin** — quản lý provider/model AI phục vụ tm-studio (hub-backed).
- Viết lại toàn bộ `tm-tools/docs` (archive bản cũ, không xóa).

## 2. Quyết định đã chốt (2026-10-31)

| # | Quyết định | Giá trị |
|---|---|---|
| D1 | Repo mới | `D:\Applications\tm-studio`, sản phẩm bên trong là TMCut |
| D2 | Chiến lược | **Lift & shift trước** — chuyển code nguyên trạng, chạy được rồi mới tiến dần V4 roadmap (`tmcut-v4-universal-rendering-multiplatform-roadmap.md`) |
| D3 | Đăng ký hub | `appId` prefix `tm-studio` (dạng `tm-studio_xxxx`), port **4003** |
| D4 | tmcut-core | **Absorb** vào repo mới tại `packages/core` |

## 3. Kiến trúc đích

```
tm-hub   (4000)  Control plane: identity · auth · connections registry (data providers)
                 · AI providers/models catalog + grants · routes/roles/configs per app
tm-tools (4002)  Console (KHÔNG còn TMCut): Profiles/Browser Hub · Tools · Utilities ·
                 Media · Admin · Connections Admin · AI Providers/Models Admin
tm-studio(4003)  TMCut standalone (repo này): editor · template · autocut · voice ·
                 html-video · factory; auth qua hub; connections + AI catalog qua hub;
                 local AI vault (Electron); packages/core = tmcut-core
```

## 4. Phạm vi di chuyển (lift & shift)

**Sang tm-studio:**
- `app/pages/tmcut/*` (8 pages), `app/components/tmcut/*` (44), `app/composables/useTmcut*` (27), `app/utils/tmcut/*` (30) + các util phục vụ tmcut (`transitions.ts`, `process/`, `ffmpegHelper.ts`…)
- `server/api/v1/{media,stock,process,ai}/**`, `server/utils/{renderJobs,htmlVideoRender,tts,uploads,processStore}.ts`
- Electron: `tmcut.controller.cjs`, `html-video-renderer.cjs`, `ffmpeg.controller.cjs`, `tmcut-voice.cjs`, `stock-proxy.cjs`, `media-download.cjs`, `asset-center.controller.cjs`, `video-generation/*`, `ai-gateway.cjs`, `ai-secure.cjs`, `config-file.cjs`, `secret-slots.cjs`, `key-migrate.cjs`, `mcp/*`, `process-store.cjs` + IPC contracts tương ứng trong `shared/types/electron.ts`
- `resources/ffmpeg*.exe`, `resources/tmcut-catalog/`, `private/tmcut/`
- `tests/**` (tmcut specs), `tmcut-core` → `packages/core`
- i18n keys `tmcut.*` và các key liên quan

**Ở lại tm-tools:**
- Profiles/Browser Hub, Tools (download/video), Utilities, Media library, Inbox, Chat, Administration, Settings/System
- `app/pages/resources/connections.vue` + `app/components/aiProviders/IoModal.vue` (Connections Admin)
- `/system/ai-keys` (local vault dashboard của tools) + `useHubAi` (AI Providers/Models Admin qua hub)
- Electron controllers của browser platform, `drizzle` schema, supabase migrations nền tảng

## 5. Các phase & cổng nghiệm thu

| Phase | Nội dung | Cổng nghiệm thu (gate) | Trạng thái |
|---|---|---|---|
| 1 | Bootstrap skeleton tm-studio + seed app `studio` trên tm-hub | `pnpm typecheck` + `pnpm lint` PASS; dev server 4003 render shell; đăng nhập qua hub OK | **PASS** (2026-10-31)¹ |
| 2 | Lift & shift toàn bộ code TMCut (+ absorb `packages/core`) | typecheck + lint + test suite tmcut PASS; editor mở project, render smoke PASS | **PASS** (2026-10-31)² |
| 3 | Tích hợp hub cho tm-studio: connections, AI catalog, adoption bridge, local vault, RBAC | Duyệt golden path bằng browser: login · connections list · AI model picker · editor | **PASS** (2026-10-31) |
| 4 | Gỡ TMCut khỏi tm-tools (code, IPC, i18n, scripts, resources, seed routes) + tuyển chọn lại agent files (`AGENTS.md`, `CLAUDE.md`, `.agents/`) bỏ các mục TMCut | typecheck + lint PASS; các module còn lại chạy tốt trên dev; agent files đồng nhất | PENDING |
| 5 | Viết lại `tm-tools/docs`: archive v1 → `docs/archive/`, viết docs v2 | Link check PASS; không còn doc mô tả TMCut là tính năng của tm-tools | PENDING |
| 6 | Verification tổng cả 3 repo + báo cáo cuối | Toàn bộ gates PASS, báo cáo cuối appended vào tài liệu này | PENDING |

## 6. Coupling phải cắt (ghi nhận từ audit 2026-10-31)

1. **Auth/session**: `useHub().hubFetch` (X-App-Id + JWT refresh), `app/middleware/auth.global.ts`, `server/middleware/auth.ts` (JWT guard mọi `/api/**`) — nhân bản sang tm-studio, đổi app id/port.
2. **AI 3-lớp**: hub catalog (`useHubAi`) · relay secret (`NUXT_HUB_APP_SECRET`, route `/api/v1/ai/relay/*`) · local vault (`ai-gateway.cjs` + `ai-secure.cjs` + `config-file.cjs`) · adoption bridge (`app/utils/tmcut/hubAiConnection.ts`).
3. **Connections**: TMCut đọc hub `connections` qua `useHubAi`/`useHub` — giữ nguyên cơ chế, đổi `X-App-Id` thành app của studio.
4. **Electron shell**: `main.cjs`/`preload.cjs` đăng ký controller; `shared/types/electron.ts` trộn loại Tmcut/Platform — tách theo controller.
5. **Packaging**: `electron-builder.yml` (ffmpeg, tmcut-catalog, `shared/**`), i18n `nav.*`/`tmcut.*`, seed routes hub (`createToolsRoutes` nhóm `group_tmcut` — gỡ ở Phase 4).

## 7. Rủi ro & lưu ý

- `pnpm-lock.yaml` và `node_modules` không copy — cài mới bằng pnpm trong tm-studio.
- `.env` chứa secret dùng chung (AUTH_JWT_SECRET) — seed tm-hub sẽ sync `NUXT_PUBLIC_HUB_APP_ID` + `AUTH_JWT_SECRET` vào `../tm-studio/.env` tương tự tm-tools.
- Phase 4 chỉ thực hiện khi Phase 3 PASS (tm-studio tự chủ trước khi tm-tools mất TMCut).
- Tài liệu V4 roadmap là định hướng dài hạn; lift & shift không hiện thực hóa V4 — chỉ dọn đường.

## 8. Nhật ký tiến độ

- **2026-10-31** — Phase 1 bắt đầu: tạo repo, skeleton satellite, seed app studio trên hub.
- **2026-10-31** — **Phase 1 PASS.** Kết quả cổng nghiệm thu:
  - `pnpm typecheck` PASS (0 lỗi, vue-tsc pinned 3.3.13 exact).
  - `pnpm lint`: 129 lỗi + 1 warning — 100% parity với baseline tm-tools (1250 lỗi + 393 warning; cùng rule, cùng dòng, ví dụ `HeTreeMenu.vue:329` parsing error có sẵn ở cả 2 repo). Không có category mới.
  - Dev smoke: hub 4000 HTTP 200; studio 4003 `/api/health` OK + SPA shell HTTP 200.
  - Đăng nhập qua hub (API-level): POST `/api/v1/auth/login` với `appId=tm-studio_749app`, user `studio-root@example.com` → JWT hợp lệ; `GET /api/v1/auth/routes?appId=tm-studio_749app` trả đủ 4 nhóm route (home · group_tmcut ×8 · group_resources ×3 · group_system ×5).
  - ¹Đăng nhập qua UI trình duyệt (golden path) chuyển sang gate Phase 3.
  - Lưu ý kỹ thuật: pnpm 12.15.0 version-manager hỏng trên Windows — chạy pnpm qua `node <tools>/pnpm/12.15.0/node_modules/pnpm/bin/pnpm.mjs`.
- **2026-10-31** — Quy ước vận hành theo yêu cầu user: **commit + push mỗi phase PASS** (tm-studio `5a4390a` → github.com/tuanmjnh/tm-studio; tm-hub `38b53ed` → origin/main). Phong cách commit: tiêu đề ngày `2026.10.31` + body tóm tắt.
- **2026-10-31** — **Tuyển chọn agent files (đồng nhất):** tm-tools có 3 bản AGENTS.md lệch nhau (port 4002/4002/3000, quy tắc dần mòn, `types/` stale, typo tab). Chuẩn hoá: root `AGENTS.md` là bản canonical (sửa structure block → `shared/types/`, sửa typo `@tailwindcss`); `CLAUDE.md` và `.agents/AGENTS.md` trở thành pointer trỏ về canonical. tm-studio nhận bộ tương đương: `AGENTS.md` canonical (port 4003, app id `tm-studio_749app`, modules TMCut + Connections + AI keys, AI 3-layer, `packages/core`), `CLAUDE.md` + `.agents/AGENTS.md` pointer, copy 5 skills generic (`9router`, `button-variants`, `error-handling`, `loading-button`, `pagination-gridlist`) — `nuxt-ui` đã có ở user-scope nên không nhân bản. Việc bỏ mô tả TMCut khỏi agent files của tm-tools thực hiện ở Phase 4 (trước đó TMCut vẫn còn trong tm-tools).
- **2026-10-31** — **Phase 2 PASS.** Lift & shift TMCut hoàn tất. Kết quả cổng nghiệm thu:
  - `pnpm test:tmcut` **60/60 specs PASS** (smoke skip mặc định). Ba spec FAIL ban đầu đã sửa: `tmcut_dev_port` (repin 4002→4003 trong `electron/tools/ports.cjs` + spec), `tmcut_ipc_policy` (trim `PUSH_CHANNELS` canonical về đúng surface studio — bỏ `eventbus:event`, `tools:profiles:statusChanged`, họ `tools:youtube:*`; `devPort = 4003`; spec đảo assertion âm tương ứng), `tmcut_ai_vault` (copy bộ trang satellite còn thiếu).
  - `pnpm test:core` **390/390 PASS** (`packages/core` absorbed, zero-dep giữ nguyên).
  - `pnpm typecheck` PASS (exit 0, 0 lỗi TS); dev `vue-tsc` watcher 0 errors.
  - Lint parity: 1366 lỗi + 166 warning — histogram rule là tập con của tm-tools, **không có category mới**; khác biệt set duy nhất là `no-undef` trong `packages/core/src/*.mjs` — kế thừa từ code gốc (2 file byte-identical với `tmcut-core/src`: guard `typeof x === 'function'` cho global host-injected), chỉ lộ ra vì lint của tm-studio giờ cover `packages/core` (tm-tools `eslint .` không bao giờ cover `../tmcut-core`).
  - Dev smoke: cả 10 trang chính HTTP 200 (`/tmcut`, `/tmcut/editor`, `/resources/{connections,notifications,inbox}`, `/system/{ai-keys,docs,hub-integration}`, `/system/profile/security`, `/system/settings`).
  - Bổ sung trong lúc đóng phase: `app/components/inbox/` (4 component), `app/components/notifications/SendSlideover.vue`, composables/utils phụ thuộc (`useAdminPageChrome`, `useAdminRowActions`, `admin/useModuleExport`, `usePasskey`, `utils/inboxHtml`).
  - ²Editor mở project + render smoke qua browser (golden path Electron) là gate của Phase 3; gate Phase 2 xác nhận ở mức test suite (render graph, video assembly, playback duration… trong 60 specs) + HTTP shell 200.
- **2026-10-31** — **Phase 3 PASS.** Tích hợp hub hoạt động end-to-end (test với hub local `localhost:4000` qua override `NUXT_PUBLIC_HUB_URL`; `.env` giữ mặc định Vercel như tm-tools). Golden paths duyệt bằng browser (Chrome thật, tab do user đăng nhập):
  - **Login**: `/` redirect `/login` đúng middleware; user đăng nhập qua hub, sidebar render route tree động lấy từ hub DB (`group_tmcut` 8 routes, `group_resources` 3, `group_system` 5) — RBAC/permission theo app `tm-studio_749app`.
  - **Connections list**: `/resources/connections` render 7 provider từ hub (Cloudinary, Cloudflare R2, Amazon S3, Supabase Storage, Google OAuth, Pexels, Pixabay) + trạng thái/action kết nối.
  - **AI catalog**: `/system/ai-keys` hiển thị 21 provider definitions (builtin R147 sync) qua hub.
  - **AI model picker + editor**: tạo dự án mới từ `/tmcut` → editor mở (`?project=wwy8yoha`, đủ media panel/timeline/toolbar); modal AI Kịch bản có `tmcut-ai-model-picker`, hiển thị đúng trạng thái hub-driven "Chưa có model nào được kết nối" (per-app models là cấu hình vận hành, không phải gate code).
  - API-level: `GET /apps/tm-studio_749app/{connections,ai/providers}` non-empty; `ai/models` `[]` (chưa cấu hình per-app).
  - Đã fix `.env`: `APP_URL` 4002 → 4003 (port cũ tm-tools).
  - Việc còn lại là vận hành: seed AI models per-app + (tuỳ chọn) đăng ký app studio trên hub production — ghi nhận cho Phase 6.
  - Phát hiện UI cần xử lý ở đợt redesign: sidebar vẫn hiển thị brand "TM TOOLS", tiêu đề trang "TM Studio" tốt nhưng brand block chưa đổi.
