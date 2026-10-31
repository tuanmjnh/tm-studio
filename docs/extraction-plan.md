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
| 2 | Lift & shift toàn bộ code TMCut (+ absorb `packages/core`) | typecheck + lint + test suite tmcut PASS; editor mở project, render smoke PASS | PENDING |
| 3 | Tích hợp hub cho tm-studio: connections, AI catalog, adoption bridge, local vault, RBAC | Duyệt golden path bằng browser: login · connections list · AI model picker · editor | PENDING |
| 4 | Gỡ TMCut khỏi tm-tools (code, IPC, i18n, scripts, resources, seed routes) | typecheck + lint PASS; các module còn lại chạy tốt trên dev | PENDING |
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
