# TM Studio — Kế hoạch tách TMCut khỏi tm-tools & Lộ trình UI Spatial Glass 3D (Dark/Light Nuxt UI v4)

> **Trạng thái:** ACTIVE — Dùng làm bản ghi quyết định kiến trúc (ADR) + bảng tiến độ tổng thể của dự án
> **Ngày tạo:** 2026-10-31
> **Cập nhật lần cuối:** 2026-10-31 (Cập nhật hệ thống 7 Semantic Colors Nuxt UI v4 trong `app.config.ts`, Dual-Theme Dark/Light & Studio Full-Bleed Layout)
> **Quy tắc vận hành:** Mỗi phase kết thúc bằng báo cáo **PASS / FAIL / BLOCKED** và cập nhật bảng tiến độ trong chính tài liệu này.

---

## 1. Bối cảnh

TMCut ban đầu là một nhóm tính năng bên trong `tm-tools` (Electron + Nuxt 4, port 4002, satellite của TM Hub). Mục tiêu của kế hoạch này:

- Tách **toàn bộ TMCut** thành ứng dụng độc lập **TMCut Studio** (`D:\Applications\tm-studio`).
- `tm-studio` hoạt động như một **satellite độc lập của TM Hub**: xác thực/identity, kết nối (connections), AI providers/models đều đi qua hub.
- **tm-tools** giữ lại vai trò console quản trị: Profiles/Browser Hub, Tools, Utilities, Media, Admin, cùng hai bộ quản trị nền tảng:
  - **Connections Admin** — quản lý kết nối tới các provider nguồn dữ liệu (hub-backed).
  - **AI Providers & Models Admin** — quản lý provider/model AI phục vụ `tm-studio` (hub-backed).
- Viết lại toàn bộ `tm-tools/docs` (archive bản cũ, không xóa).
- Chuẩn hóa hệ thống màu sắc tập trung của **Nuxt UI v4 + Tailwind CSS v4** trong `app/app.config.ts` (hỗ trợ cả **Dark Mode** và **Light Mode**), nâng cấp lên phong cách **Spatial 3D Glassmorphism + Three.js**, đồng thời tách biệt **Console Layout** (có Sidebar) và **Studio Full-Bleed Layout** (ẩn Sidebar, dùng Floating Glass Popover Menu).

---

## 2. Quyết định đã chốt (2026-10-31)

| # | Quyết định | Giá trị |
|---|---|---|
| D1 | Repo mới | `D:\Applications\tm-studio`, sản phẩm hiển thị là **TMCut Studio** |
| D2 | Chiến lược | **Lift & shift trước** — chuyển code nguyên trạng, chạy ổn định rồi tiến hành làm sạch, chuẩn hóa UI Glass 3D và tiến dần lên V4 roadmap (`tmcut-v4-universal-rendering-multiplatform-roadmap.md`) |
| D3 | Đăng ký hub | `appId` = `tm-studio_749app` (prefix `tm-studio`), port **4003** |
| D4 | tmcut-core | **Absorb** vào repo mới tại `packages/core` |
| D5 | Hệ thống Màu sắc (`app.config.ts`) | Quản lý tập trung qua 7 Semantic Colors của Nuxt UI v4: `primary: 'violet'`, `secondary: 'indigo'`, `neutral: 'zinc'`, `info: 'cyan'`, `success: 'teal'`, `warning: 'yellow'`, `error: 'red'` (hỗ trợ đầy đủ cả **Dark Mode** & **Light Mode**) |
| D6 | Kiến trúc Layout | Tách 2 layout: `default.vue` (Sidebar cố định 260px cho `/`, `/resources/*`, `/system/*`) và `studio.vue` (Full-bleed không Sidebar, điều hướng bằng **Glass Popover Menu** góc trái trên cho toàn bộ `/tmcut/*`) |
| D7 | Đồ họa 3D & GPU | Áp dụng **Spatial 3D Glassmorphism + Three.js** tự thích ứng Dark/Light qua `useStudioThemeColors()`; tự động ngắt/dispose Three.js khi vào `/tmcut/*` để nhường 100% GPU cho WebGL2/WebGPU Video Compositor |

---

## 3. Kiến trúc đích

```text
tm-hub   (4000)  Control plane: identity · auth · connections registry (data providers)
                 · AI providers/models catalog + grants · routes/roles/configs per app
tm-tools (4002)  Console (KHÔNG còn TMCut): Profiles/Browser Hub · Tools · Utilities ·
                 Media · Admin · Connections Admin · AI Providers/Models Admin
tm-studio(4003)  TMCut Studio standalone (repo này): editor · template · autocut · voice ·
                 html-video · process · factory; auth qua hub; connections + AI catalog qua hub;
                 local AI vault (Electron); packages/core = tmcut-core;
                 Nuxt UI v4 Dual-Theme (Dark/Light) · Dual-Layout (Sidebar vs Full-Bleed Popover)
```

---

## 4. Phạm vi di chuyển (Lift & Shift)

### 4.1. Sang `tm-studio`
- `app/pages/tmcut/*` (8 pages), `app/components/tmcut/*` (44), `app/composables/useTmcut*` (27), `app/utils/tmcut/*` (30) + các util phục vụ tmcut (`process/`, `ffmpegHelper.ts`…)
- `server/api/v1/{media,stock,process,ai}/**`, `server/utils/{renderJobs,htmlVideoRender,tts,uploads,processStore}.ts`
- Electron: `tmcut.controller.cjs`, `html-video-renderer.cjs`, `ffmpeg.controller.cjs`, `tmcut-voice.cjs`, `stock-proxy.cjs`, `media-download.cjs`, `asset-center.controller.cjs`, `video-generation/*`, `ai-gateway.cjs`, `ai-secure.cjs`, `config-file.cjs`, `secret-slots.cjs`, `key-migrate.cjs`, `mcp/*`, `process-store.cjs` + IPC contracts tương ứng trong `shared/types/electron.ts`
- `resources/ffmpeg*.exe`, `resources/tmcut-catalog/`, `private/tmcut/`
- `tests/**` (tmcut specs), `tmcut-core` → `packages/core`
- i18n keys `tmcut.*` và các key liên quan

### 4.2. Ở lại `tm-tools`
- Profiles/Browser Hub, Tools (download/video), Utilities, Media library, Inbox, Chat, Administration, Settings/System
- `app/pages/resources/connections.vue` + `app/components/aiProviders/IoModal.vue` (Connections Admin)
- `/system/ai-keys` (hub-only console trên tools) + `useHubAi` (AI Providers/Models Admin qua hub)
- Electron controllers của browser platform, `drizzle` schema, supabase migrations nền tảng

---

## 5. Các Phase & Cổng nghiệm thu (Gates)

| Phase | Nội dung | Cổng nghiệm thu (Gate) | Trạng thái |
|---|---|---|---|
| **Phase 1** | Bootstrap skeleton `tm-studio` + seed app `studio` trên `tm-hub` | `pnpm typecheck` + `pnpm lint` PASS; dev server 4003 render shell; đăng nhập qua hub OK | **PASS** (2026-10-31) |
| **Phase 2** | Lift & shift toàn bộ code TMCut (+ absorb `packages/core`) | typecheck + lint + test suite tmcut PASS; editor mở project, render smoke PASS | **PASS** (2026-10-31) |
| **Phase 3** | Tích hợp hub cho `tm-studio`: connections, AI catalog, adoption bridge, local vault, RBAC | Duyệt golden path bằng browser: login · connections list · AI model picker · editor | **PASS** (2026-10-31) |
| **Phase 4** | Gỡ TMCut khỏi `tm-tools` (code, IPC, i18n, scripts, resources, seed routes) + chuẩn hóa agent files (`AGENTS.md`, `CLAUDE.md`, `.agents/`) | typecheck + lint PASS; các module còn lại chạy tốt trên dev; agent files đồng nhất | **PASS** (2026-10-31) |
| **Phase 5** | Viết lại `tm-tools/docs`: archive v1 → `docs/archive/`, viết docs v2 | Link check PASS; không còn doc mô tả TMCut là tính năng của `tm-tools` | **PASS** (2026-10-31) |
| **UI-0 → UI-3** | Chuẩn hóa Brand Icon, 7 Semantic Colors Nuxt UI v4 (`violet`, `indigo`, `zinc`, `cyan`, `teal`, `yellow`, `red`), Inter/JetBrains Mono, Token hóa 39 file Workspace cho cả Dark & Light mode, Resizable Docks | `nuxt typecheck` PASS; `nuxt build` PASS; toàn bộ surface dùng semantic token | **PASS** (2026-10-31) |
| **UI-4** | Thiết kế **Spatial 3D Glassmorphism (Dark/Light) + Three.js** & Tách **Studio Full-Bleed Layout** (ẩn Sidebar, mở menu bằng `TmcutNavPopover`) | Đặc tả UI + Stitch Prompts + AI Agent Rules hoàn tất (`stitch-glass-3d-ui-spec.md`); đồng bộ màu qua `app.config.ts` | **ACTIVE** (2026-10-31) |
| **Phase 6** | Verification tổng cả 3 repo (`tm-hub`, `tm-tools`, `tm-studio`) + đóng gói báo cáo cuối | Toàn bộ gates PASS, báo cáo cuối appended vào tài liệu này | **PENDING** |

---

## 6. Nhật ký tiến độ chi tiết

- **2026-10-31 — Phase 1 → Phase 5 PASS:** Hoàn tất tách repo `tm-studio` (port 4003, `tm-studio_749app`), absorb `packages/core` (390/390 tests PASS), vượt qua 60/60 specs TMCut, tích hợp end-to-end với `tm-hub`, gỡ sạch 273 file TMCut khỏi `tm-tools` và viết lại toàn bộ tài liệu v2 cho `tm-tools`.
- **2026-10-31 — Cleanup Pass & Brand Identity PASS:** Xóa 21 file chết, gỡ 10 dependencies thừa, loại bỏ toàn bộ hard-coded secrets trong `server/config/index.ts`, thiết kế bộ icon squircle vector mới và đồng nhất tên sản phẩm **"TMCut Studio"**.
- **2026-10-31 — UI-0 → UI-3 PASS:**
  - Thiết lập 7 bảng màu ngữ nghĩa tập trung trong `app/app.config.ts`: `primary: 'violet'`, `secondary: 'indigo'`, `neutral: 'zinc'`, `info: 'cyan'`, `success: 'teal'`, `warning: 'yellow'`, `error: 'red'`.
  - Token hóa 39 file giao diện sang semantic classes của Nuxt UI v4 (`bg-default`, `bg-elevated`, `text-highlighted`, `text-muted`, `border-default`...) đảm bảo hoạt động hoàn hảo ở cả **Dark Mode** và **Light Mode**.
  - Bổ sung 3 thanh kéo thay đổi kích thước (Resizable Docks) cho Media Panel, Inspector và Timeline có lưu `localStorage`.
- **2026-10-31 — UI-4 ACTIVE:**
  - Cập nhật đặc tả `docs/stitch-glass-3d-ui-spec.md` với bộ Prompt Google Stitch cho cả **Dark Mode** (`Dark.PNG`) và **Light Mode** (`Light.PNG`), kèm Master Prompt buộc AI Coding Agent luôn tuân thủ màu sắc từ `app/app.config.ts`.
  - Triển khai kiến trúc tách `layouts/default.vue` (có Sidebar) và `layouts/studio.vue` (Full-bleed không Sidebar, mở menu qua `TmcutNavPopover.vue`).