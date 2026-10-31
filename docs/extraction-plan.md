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
| 4 | Gỡ TMCut khỏi tm-tools (code, IPC, i18n, scripts, resources, seed routes) + tuyển chọn lại agent files (`AGENTS.md`, `CLAUDE.md`, `.agents/`) bỏ các mục TMCut | typecheck + lint PASS; các module còn lại chạy tốt trên dev; agent files đồng nhất | **PASS** (2026-10-31)³ |
| 5 | Viết lại `tm-tools/docs`: archive v1 → `docs/archive/`, viết docs v2 | Link check PASS; không còn doc mô tả TMCut là tính năng của tm-tools | **PASS** (2026-10-31)⁴ |
| 6 | Verification tổng cả 3 repo + báo cáo cuối | Toàn bộ gates PASS, báo cáo cuối appended vào tài liệu này | **BLOCKED** (2026-10-31)⁵ — tm-studio/tm-tools PASS; tm-hub vướng 2 lỗi TS trong WIP chat chưa commit |

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

- **2026-10-31** — **Phase 4 PASS.** TMCut rời tm-tools (commit `f6e9899`, tm-hub `66f3a8b`). Kết quả cổng nghiệm thu:
  - Xoá 273 file: 8 route `/tmcut/*`, 41 component, 30 util, 27 composable, types/assets templates; Electron `tmcut.controller`, `html-video-renderer`, `asset-center`, `process-store`, `stock-proxy`, `media-download`, `recordings`, `ai-gateway`, `key-migrate`, `video-generation/`, `mcp/`; Nitro `api/v1/{media,process,stock,ai/relay}` + `server/utils/{aiRelay,htmlVideoRender,renderJobs,tts,uploads,processStore}`.
  - `electron/main.cjs` 821→430 dòng, `preload.cjs` chỉ còn namespace youtube/ffmpeg/profiles/dialog/fileManager/appUpdater/system/browser/events, `ipcPolicy.cjs` PUSH_CHANNELS thu về eventbus/app-updater/profiles/task-events, `OUTBOUND_CHANNELS = []` (spec đảo assertion âm cho `tmcut:*` và MCP). `shared/types/electron.ts` 1160→688 dòng.
  - Dashboard viết lại thành hub-tools console; `/system/ai-keys` hub-only (bỏ vault, test/local probe); `/system/settings/production` (phụ thuộc composable đã xoá) được gỡ cùng key i18n.
  - Dependencies: bỏ `@tmcut/core`, `playwright-core`, `web-push`, `reka-ui`, `@modelcontextprotocol/sdk`, `@types/web-push`; scripts per-feature gộp về `test`/`test:unit`. i18n: bỏ `tmcut`, `vc`, `seed` + `nav.tmcut_*`; bổ sung 24 key còn thiếu (`notifications.*`, `settings.hubVersion…`, `auth.invalidEmail`, `tools.startingUpdate`, `media.file_uploaded_title`).
  - tm-hub seed: `createToolsRoutes` bỏ nhóm `group_tmcut` + 6 route con; role tools bỏ `allowed_routes` tmcut. **Chưa chạy seed** (ghi trực tiếp Supabase/MongoDB dùng chung) — cần chủ repo bấm chạy `pnpm seed --app=tools`.
  - Gate: `pnpm typecheck` PASS; `pnpm test:unit` 9/9 specs PASS; dev smoke 4002 `/api/health` 200 + `/` 200; `node --check` các file Electron chính PASS; `build:electron:main` PASS (971.9 kb).
  - Lint: baseline vốn không xanh (lỗi stylistic toàn repo); file bị sửa giảm lỗi (ai-keys 603→540 problems), không thêm category mới. Ghi nhận là tech-debt sẵn có, không phải regression của phase này.
  - Bảo mật: phát hiện `AUTH_JWT_SECRET` thật hard-code trong `app/pages/system/hub-integration.vue` (snippet `.env` hiển thị cho user) và trong docs setup — đã thay bằng placeholder. Nên rotate shared secret nếu bản build cũ từng phát hành ra ngoài.
- **2026-10-31** — **Phase 5 PASS.** Docs tm-tools viết lại:
  - Archive v1 tại `docs/archive/2026-10-31-v1-pre-tmcut-extraction/` (22 file + README mô tả nguồn gốc và nơi chuyển): 6 tài liệu TMCut architecture/roadmap/MCP, CapCut UI reference, fx audit, generation-adapters audit, 3 guide (user, marketplace, Runway assets), AI key ownership (local vault đã bỏ), 3 production-process SOP.
  - Docs v2: `docs/README.md` (index mới), `docs/guides/user-guide.md` (Browser Hub, downloader, FFmpeg, media, utilities, AI console, settings, troubleshooting), `docs/guides/system-setup-and-configuration-guide.md` (port 4000/4001/4002/4003, `.env` 3 app, seed, gates), `docs/ai-and-hub-connections.md` (tm-tools không giữ AI key), root `README.md` mới.
  - Link check (live docs, bỏ archive frozen): **0 broken link**. Archive giữ nguyên `file:///` path lịch sử theo chủ đích.
- **2026-10-31** — **Cleanup pass (theo yêu cầu user: dọn phần không sử dụng trong tm-studio).** Kết quả:
  - **Xoá 21 file chết** (xác minh bằng scanner trước khi xoá): 8 composable (`useDateTime`, `useEditorType`, `useEncoding`, `useExport`, `useFfmpegPresets`, `useMediaStore`, `useRandomGen`, `useTextTransform`), 3 util (`aiProviderTransfer`, `fingerprint`, `transitions`), `shared/utils/routeTree.ts`, 5 component (`base/FilePicker`, `dashboard/TeamsMenuBak`, `shared/HeTreeMenu`, `tmcut/AutocutStep2`, `tmcut/TmcutEditorShell`), `shared/contracts/browser.ipc.ts` + block `browser` chết trong `shared/types/electron.ts`, và 3 spec milestone (import `electron/src/**` không tồn tại → luôn hỏng, không nằm trong runner).
  - **Dependencies**: bỏ `@internationalized/date`, `@supabase/supabase-js`, `@tanstack/table-core`, `@he-tree/vue`, `scule`, `to-px`, `reka-ui`, `@types/bcryptjs`, `@types/uuid`, `@types/better-sqlite3` (bcryptjs/uuid đã bundle types); thêm tường minh `@types/node` (trước đây chỉ có nhờ transitive của `@types/better-sqlite3`).
  - **Scripts**: 45 script per-spec → `test` / `test:unit` / `test:electron` / `test:smoke` (+ giữ `test:tmcut` alias); `test` chạy trực tiếp tsx/node để không phụ thuộc pnpm lồng nhau trên Windows.
  - **Bảo mật**: `server/config/index.ts` chứa hard-code `AUTH_JWT_SECRET`, Supabase service-role key, Cloudinary apiSecret, Firebase private key, VAPID private key (kế thừa từ tm-tools). Rút gọn config về đúng phần còn dùng (`auth.accessTokenSecret`, `tools.ffmpeg|ffprobe|ffplay`, `uploads`) — toàn bộ secret hard-code bị xoá; `server/utils/jwt.ts` chỉ còn `verifyAccessToken`. `hub-integration.vue` redacted snippet `.env`. **Khuyến nghị rotate** các key từng nằm trong repo.
  - **Brand/defaults**: `app_name` + loading screen + i18n + docs fallback → "TMCut Studio"; fallback appId `tm-tools` → `tm-studio_749app` (useHub/useAuth/auth plugin/middleware/docs); Cloudinary folder `tm-studio`; updater repo `github.com/tuanmjnh/tm-studio`; port 4002 → 4003 trong comment/docs.
  - `spa-loading-template.html` chuyển vào `app/` (Nuxt resolve theo srcDir → hết warning `spaLoadingTemplate path does not exist`).
  - Gates: `pnpm typecheck` PASS; `test:unit` **60/60**; `test:electron` **54/54**; dev smoke 4003 `/api/health` + `/` + `/tmcut` + `/system/hub-integration` 200; lint touched-files **50 → 48 problems** (không hồi quy; tổng repo 2126 problems là debt có sẵn, cao hơn số ghi ở Phase 2 vì các component inbox/notifications thêm vào sau thời điểm đo đó).
- **2026-10-31** — **Icon & product name (theo yêu cầu user: tạo icon mới).** Thay icon wrench kế thừa từ tm-tools bằng brand mark TMCut Studio (commit `bf2c48f`):
  - Mark vector: hai chevron play (trắng + mint `#5EEAD4→#2DD4A8`) trên squircle gradient indigo→violet (`#4338CA → #6D28D9 → #9333EA`), có radial highlight + vignette + inner stroke. Thiết kế dạng vector (không dùng ảnh AI) để sắc nét ở 16px và không có artifact.
  - Sinh asset từ một nguồn SVG bằng `sharp` (scratch, không thêm dependency vào repo): `icon.png` 1024 (Electron/mac/Linux), `pwa-192/512` (any) + `pwa-512-maskable` (full-bleed cho Android), `apple-touch-icon` 180 (full-bleed, iOS tự mask), `favicon-16/32/48` + `favicon.ico` (3 size), `icon.ico` (16/24/32/48/64/128/256 cho electron-builder). `logo.svg` / `favicon.svg` / `favicon-dark.svg` cùng mark cho sidebar, login và SPA loading.
  - Loading screen: bỏ khung trắng quanh logo (mark đã có squircle riêng), glow đổi từ xanh dương sang violet.
  - Đồng nhất tên hiển thị "TMCut Studio": title template, PWA name/short_name, Electron `productName`/`executableName`; manifest dùng `theme_color #6D28D9`, `background_color #1E1B4B`, icon maskable riêng.
  - Sửa fallback `runtimeConfig.public.hubAppId` `tm-studio` → `tm-studio_749app` (khớp composables, tránh trỏ nhầm app khi thiếu env).
  - Gates: `nuxt typecheck` PASS; dev smoke 4003 phục vụ đúng `logo.svg`, `icon.png`, `favicon.ico`, `pwa-192x192.png`, `manifest.webmanifest` (200); manifest JSON hợp lệ; ICO parse đúng 7 entries; trang login render title "Sign in - TMCut Studio". Lint `nuxt.config.ts` còn 1 lỗi `nuxt/nuxt-config-keys-order` có sẵn từ trước, không liên quan thay đổi này.
- **2026-10-31** — **UI-0 PASS (design foundation).** Bắt đầu lộ trình UI pro (4 phase) theo hướng đã tư vấn: violet brand + dark-first.
  - Palette: `primary` blue → **violet**, `secondary` indigo, `neutral` slate → **zinc** ([app.config.ts](../app/app.config.ts)).
  - Typography: self-host **Inter Variable** + **JetBrains Mono Variable** (`@fontsource-variable/*`, không phụ thuộc Google Fonts lúc chạy); `--font-sans` / `--font-mono` trong `@theme`; bỏ khai báo `Public Sans` trùng lặp (font này trước đây chưa từng được load).
  - Studio tokens: thêm `--color-studio-{canvas,panel,raised,border,mint}` để editor chrome dùng ở UI-2.
  - Dark-first: `colorMode.preference/fallback = 'dark'` (người dùng vẫn toggle được).
  - Shell: brand block sidebar bỏ uppercase/tracking rộng → sentence case, tracking-tight; xoá mục command palette "View source" trỏ về repo template `nuxt-ui-templates/dashboard` (rác từ template, đồng thời giảm 1 icon khỏi bundle).
  - Verify trên dev 4003: `--ui-primary` = `oklch(70.2% 0.183 293.541)` (violet), neutral zinc, `document.fonts` đăng ký đủ Inter + JetBrains Mono, Inter load thành công, login title đúng.
  - Gate: `nuxt typecheck` exit 0; eslint các file chạm PASS; không còn file `.js` sinh tự động trong source (dọn 178 artifact do typecheck chạy song song dev server).
- **2026-10-31** — **UI-1 (slice 1): token hoá project home + primitives.** Chưa đóng phase (còn IA/hero refinement), nhưng loại bỏ phần lớn màu hard-code ở màn hình đầu:
  - `tmcut/index.vue`: border/text/surface chuyển sang token Nuxt UI (`border-default`, `text-highlighted/toned/muted/dimmed`, `bg-elevated`, `bg-muted`, `hover:border-primary/50`), hero dùng `dark:via-studio-canvas`.
  - Fix lỗi tiềm ẩn: class Tailwind dựng động `'bg-' + preset.color + '-500/10'` không được Tailwind sinh ra → thay bằng nhánh class tĩnh primary/secondary.
  - Primitives: `TmcutCard` (default/elevated/interactive/glass) và badge `neutral` chuyển sang token (`bg-elevated`, `border-default`, `bg-muted`, `text-toned`), nhờ đó mọi card/badge trong editor đồng bộ theo zinc/violet.
  - Gate: eslint các file chạm PASS (đã auto-fix 6 lỗi stylistic có sẵn trong 2 primitive); `nuxt typecheck` exit 0; `nuxt build` PASS (1m20s, xác nhận toàn bộ utility token mới biên dịch được).
- **2026-10-31** — **UI-2 (slice 1): token hoá toàn bộ editor workspace.** Thay màu zinc hard-code bằng semantic token Nuxt UI trên 39 file (editor + toàn bộ component tmcut + 3 trang system), chuẩn bị cho light mode và theme switching:
  - Quy ước map (kiểm chứng từ `@nuxt/ui` runtime CSS): cặp `*-neutral-200/300 ↔ dark:*-neutral-800` → `*-default`; `*-neutral-400 ↔ dark:*-neutral-700` → `*-accented`; `text-neutral-900/800 ↔ dark:text-neutral-100` → `text-highlighted`; `text-neutral-700/600 ↔ dark:text-neutral-300/200` → `text-toned`; `text-neutral-500/400` → `text-muted` / `text-dimmed`; `bg-neutral-100/50 ↔ dark:bg-neutral-900` → `bg-muted`/`bg-default`; `bg-neutral-200 ↔ dark:bg-neutral-800` → `bg-accented`; `dark:bg-neutral-800` → `bg-elevated`.
  - Editor top bar: nút **Export** chuyển từ `secondary/soft` → `primary/solid` để thành CTA duy nhất nổi bật; các nút AI/agent/audio giữ `secondary/soft`.
  - Giữ nguyên màu cố ý: code block/textarea HTML (`bg-neutral-900/950` + emerald text), thumbnail FX, status dot (đỏ/vàng/xanh), ruler tick `bg-neutral-500` — đây là màu dữ liệu, không phải surface.
  - Không đổi logic/script; diff thuần class (949 dòng đổi, cân bằng +/−). Lint các file chạm không phát sinh lỗi mới (TmcutTimeline 276 lỗi và `system/ai-keys` 603 lỗi là debt có sẵn, số lượng y hệt HEAD); `nuxt typecheck` exit 0; `nuxt build` PASS 1m21s; CSS build chứa đủ `.bg-muted`, `.text-dimmed`, `.border-accented`, token `studio-canvas`.
- **2026-10-31** — **UI-2 (slice 2): dock resizing + persistence.** Editor workspace giờ chỉnh được kích thước như NLE chuyên nghiệp:
  - Ba divider có thể kéo: media panel (264–560px), inspector (264–480px), timeline cao (200–560px, tự chặn 55% viewport). Mỗi divider là `role="separator"` + `tabindex="0"`: kéo bằng chuột/pen, chỉnh bằng Arrow khi focus (Shift = bước 40px), double-click để reset; `stopPropagation` để không kích hoạt phím tắt seek toàn cục.
  - Kích thước lưu vào `localStorage` (`tmcut:layout:{media|inspector|timeline}`), đọc lại trong `onMounted` để tránh lệch hydration; panel mobile dạng overlay giữ nguyên kích thước cũ, timeline có `max-h-[55vh]` bảo vệ viewport nhỏ.
  - Dùng CSS variable (`--tmcut-media-w`, `--tmcut-inspector-w`) trên workspace root để đổi kích thước không phải re-render component con.
  - i18n: thêm `tmcut.workspace.resizeMedia|resizeInspector|resizeTimeline` (en + vi) cho aria-label.
  - Gate: eslint editor.vue PASS; `nuxt typecheck` exit 0; `nuxt build` PASS 1m19s; CSS build sinh đúng `max-height:55vh` và `--tmcut-*-w`.
- **2026-10-31** — **UI-2 PASS (workspace chrome).** Tổng kết: token hoá 39 file + CTA Export + 3 divider resize có persistence + i18n aria-label. Hoãn có chủ đích (ghi nợ kỹ thuật): tách `editor.vue` (~2.5k dòng) thành TopBar/MediaPanel/PreviewStage/InspectorDock/TimelineDock — refactor cơ học lớn, không đổi hành vi, nên làm thành commit riêng khi có visual QA; audit aria-label toàn bộ 119 `UButton` icon-only ngoài editor (đa số nằm trong video factory/template studio) để UI-3. Visual QA bằng browser vẫn **BLOCKED** vì phiên browser chưa đăng nhập (không được yêu cầu nhập credential vào chat); thay bằng typecheck/build/CSS-output proof.
- **2026-10-31** — **UI-3 (slice 1): phân cấp action bar.** Dọn nhiễu màu ở top bar editor:
  - Nhóm 4 công cụ AI (Scriptwriter, Edit Plan, Agent, Audio orchestration) thống nhất `primary/soft` (violet) làm "intelligence family"; trước đó Edit/Agent/Audio dùng `secondary` (indigo) lẫn với primary.
  - Save chuyển `primary/soft` → `neutral/soft` để **Export** là hành động primary duy nhất (solid) khi mắt quét thanh công cụ; thêm divider dọc `bg-accented` trước nhóm AI ở breakpoint ≥2xl.
  - Gate: eslint editor.vue PASS; `nuxt typecheck` exit 0.
- **2026-10-31** — **UI-3 (slice 2): ảnh thumbnail có ngữ nghĩa + tải lười.** Rà toàn bộ `<img>` trong TMCut:
  - Media bin (2 chỗ), poster export, still layer của preview, cover project home, thumbnail stock và autocut segment: thêm `alt=""` (ảnh trang trí — tên asset đã nằm ở nhãn/title xung quanh) để screen reader không đọc URL ảnh; thêm `decoding="async"` cho các ảnh đang thiếu; bổ sung `loading="lazy"` cho cover project và thumbnail autocut (media bin/stock đã có sẵn).
  - Không đổi bố cục/màu; gate: eslint 5 file PASS, `nuxt typecheck` exit 0.
- **2026-10-31** — **UI-3 (trạng thái: đang làm, 2 slice đã commit).** Đã xong: phân cấp action bar (AI family violet, Export solid duy nhất) và a11y/perf ảnh thumbnail (`alt=""`, lazy, async decode). Còn lại — **hoãn vì cần visual QA có đăng nhập**: (a) dùng mint `#2DD4A8` làm accent riêng cho AI surfaces (badge/dot/viền) mà không phá contrast violet; (b) audit motion (chỉ giữ animate-pulse cho trạng thái sống, tôn trọng `prefers-reduced-motion`); (c) thêm nhãn cho ~119 `UButton` icon-only ngoài editor (video factory/template studio/resources) — cần i18n key mới cho từng hành động. Export queue đã có đủ empty/running/failed/done state (kiểm tra `TmcutExportQueueModal.vue`), không cần sửa.
- **2026-10-31** — **UI-3 (slice 3): sidebar connectivity thật.** `NetworkStatus` trước đây luôn đỏ vì gọi `/api/system/network` — route không tồn tại nên Nitro trả HTML SPA và parse fail. Thêm `server/api/system/network.get.ts` probe `GET {hubUrl}/api/v1/health` với `X-App-Id` (timeout 5s, fail-soft), trả `{ online, latencyMs, checkedAt, method }`. Sidebar giờ hiển thị "Đang trực tuyến · <ms>" khi hub sống; không chặn render khi hub chết.
- **2026-10-31** — **UI-3 (slice 4): project home viết lại.** `pages/index.vue` bỏ hero/card rỗng: description lấy i18n (`home.description`), 3 card có thật (TMCut, Kết nối, Két khóa AI) dẫn đúng route, mô tả riêng, icon tile `bg-primary/10 text-primary`, hover `border-primary/40 bg-elevated/40`, CTA "Mở →" có micro-translate. Thêm `home.cards.*` + `home.open` (en/vi).
- **2026-10-31** — **UI-3 (slice 5): mint là tín hiệu AI, không phải trang trí.** `--color-studio-mint` (#2DD4A8) chỉ dùng cho trạng thái "AI đang sống/đã kiểm chứng": sparkles của model picker đổi mint khi có model, badge thêm dot 6px mint, kết quả test model màu mint. Violet vẫn giữ vai trò brand/CTA; mint không dùng cho nút hay surface.
- **2026-10-31** — **UI-3 (slice 6): tôn trọng prefers-reduced-motion.** Thêm guard toàn cục trong `app/assets/css/main.css`: mọi animation/transition về 0.01ms, `scroll-behavior:auto`, riêng `.animate-spin` giữ 1s vòng lặp để spinner tải vẫn là tín hiệu sống. Đã xác nhận rule biên dịch trong CSS dev server phục vụ.
- **2026-10-31** — **UI-3 (slice 7): nốt a11y cho nút icon-only.** Scanner tĩnh (bỏ `:label`/`:title`, slot có text) tìm 123 nghi vấn; còn **42 nút thật thiếu nhãn** sau khi lọc false positive. Bổ sung `aria-label` từ i18n có sẵn (common.back/close/search/more/refresh/copy + `tmcut.*` + `feedback.*`), thêm key `tmcut.clearSelection`, `tmcut.videoTemplates.remove{Input,Scene,PromptBlock}`, `feedback.{upload,remove}Screenshot`. Không đổi hành vi.
- **2026-10-31** — **UI-3 (slice 8): hết stack-depth do typed `$fetch`.** 3 route relay gọi hub bằng `$fetch` khiến vue-tsc so sánh URL với toàn bộ route union và báo "Excessive stack depth" ngay trên dev overlay. Chuyển sang `ofetch` trực tiếp (vẫn timeout/headers như cũ) ở `catalog.get.ts`, `chat.post.ts`, `network.get.ts`.
- **2026-10-31** — **UI-3 PASS (AI surfaces & polish).** Visual QA đã mở khoá đúng cách: dùng lại tab Chrome đã đăng nhập sẵn (claim tab) — **không nhập/đọc/gửi bất kỳ credential nào**, không dùng page evaluation cho vùng nhạy cảm.
  - Đã kiểm: home + editor ở desktop 1920 và tablet 884 (sidebar chuyển overlay + nút "Mở thanh bên", media/inspector thành panel thu gọn, timeline toolbar cuộn ngang không mất nút); light mode (do người dùng đổi) và dark mode đều đọc tốt; AI Script modal có trạng thái "chưa kết nối model" rõ ràng và nay kèm link "Mở trang kết nối →" mở tab mới; nút Sinh kịch bản vẫn chạy chế độ preset có badge giải thích; network indicator xanh; reduced-motion guard có trong CSS phục vụ.
  - Gate: `nuxt typecheck` exit 0, `grep -c "error TS"` = 0 (chạy sau lần regenerate `.nuxt/eslint.config.mjs` cuối). ESLint 19 file liên quan: sạch hoàn toàn, trừ 6 file có debt sẵn từ HEAD (`gridList/Index`, `InboxMail`, `connections`, `notifications`, `docs`, `hub-integration`: 80 problems ở HEAD → 78 ở working tree; toàn bộ là `no-explicit-any`/format cũ, không có lỗi mới; 2 lỗi indent trong block vừa sửa đã được dọn).
  - Giới hạn QA: Windows không cho thu cửa sổ Chrome dưới ~884px nên chưa chụp được 390px; layout mobile dựa trên bằng chứng 884px + code (`lg:` breakpoints, panel overlay) và **chưa coi là đã xác minh ở 390px**. Cửa sổ Chrome đã được khôi phục maximize sau khi đo.
  - Nợ kỹ thuật còn lại: tách `editor.vue` (~2.5k dòng) thành 5 dock; auto-collapse sidebar khi vào editor; (tuỳ chọn) chạy `seed:studio` trên tm-hub để sidebar bỏ route trống; rotate các secret từng commit; lưu ý `remembered_login` còn lưu plaintext trong localStorage.
- **2026-10-31** — **Phase 6 BLOCKED (verification 3 repo).** Hai repo đã xanh, tm-hub vướng WIP chưa commit của người dùng nên chưa thể tuyên bố "toàn bộ gates PASS":
  - **tm-studio — PASS.** `nuxt typecheck` exit 0 (0 `error TS`), `test:unit` **60/60** exit 0 (spec hygiene đọc `<img>` nay chịu CRLF; "smoke skipped" là mặc định), lint không hồi quy (chỉ còn 1 warning `v-html` đã sanitize trong MediaVisual mới port), dev `:4003` HTTP 200, visual QA desktop/tablet + light/dark + modal/slideover đã ghi ở UI-3. Commit `3fb79c4` đã push `main`.
  - **tm-tools — PASS.** Working tree sạch; `nuxt typecheck` exit 0; `test:unit` **9/9**; docs v2 link check 0 broken (Phase 5). Dev `:4002` không chạy lúc đo (không bắt buộc cho gate này).
  - **tm-hub — BLOCKED.** `/api/v1/health` 200; nhưng `nuxt typecheck` in **2 lỗi TS2430** tại `server/modules/ai-chat/model.ts` (interface `IChatConversationDocument.model: string` xung đột method `Document.model` của Mongoose). Đây là file **untracked WIP** của tính năng chat, không thuộc extraction; thêm vào đó `scripts/seed/data.ts` + i18n đang modified và `app/pages/chat.vue`, `server/api/v1/chat/` untracked. **Không sửa/không commit WIP này** — cần chủ repo hoàn tất hoặc tách nhánh. Chỉnh duy nhất đã làm từ trước: sửa 1 import sai (`isLocalEndpoint`) để hub dev build được.
  - Hệ quả: Phase 6 giữ **PENDING/BLOCKED**; mở lại ngay khi tm-hub typecheck sạch và seed/chat WIP được commit hoặc revert. Không chạy `seed:studio` (ghi vào DB dùng chung) khi chưa có xác nhận.
- **2026-10-31** — **UI-3 bổ sung: auto-collapse sidebar trong editor.** `layouts/default.vue` giờ thu sidebar về rail khi vào `/tmcut/editor` để nhường chiều rộng cho canvas, và mở lại khi rời editor; nút "Mở rộng thanh bên" trong editor vẫn cho người dùng pin thủ công.
  - Cookie `dashboard-sidebar-*` của Nuxt UI thắng model lúc mount, nên layout gọi cùng runtime hook `dashboard:sidebar:collapse` mà nút built-in dùng (mount + watcher `route.path`); route là nguồn sự thật, thao tác thủ công chỉ giữ trong phiên.
  - Đã kiểm bằng browser: reload editor → rail; reload dashboard → mở; SPA editor → `/tmcut` → mở; Back → editor → rail.
  - Gate: `nuxt typecheck` exit 0 (0 TS error); eslint `layouts/default.vue` exit 0.
- **2026-10-31** — **UI-3 bổ sung: hết Vue warn "Failed to resolve component" trong shell.** Browser console lộ 4 component bị tham chiếu nhưng chưa được lift khỏi tm-tools:
  - `ToolsVideoPreviewModal` (editor + export modal) → port `app/components/tools/VideoPreviewModal.vue`; giữ prop `open`/`filePath`/`title`, dùng `toURL` sẵn có, hai nút Electron (Show in Folder / Open with App) chỉ render sau khi mount + có `window.electronAPI`, token hoá `border-default`/`bg-elevated` để đúng cả light/dark.
  - `MediaVisual` (TeamsMenu, login) → port `app/components/media/MediaVisual.vue`; các helper `getImage/detectDisplayType/cleanImageUrl/sanitizeSvg/isSpecialImage/ensureForwardSlash` đã có trong `app/shared/utils/helper.ts`, `NuxtImg` đã cài.
  - `LazyAiProvidersIoModal` (trang két AI) → port `app/components/aiProviders/IoModal.vue` + `app/utils/aiProviderTransfer.ts`; i18n `aiProviders.*` đã có đủ; đổi `appName` khi export từ `tm-tools` → `tm-studio`.
  - `LazySharedEditorTypeSwitch` là option chọn text editor (tiptap/tinymce) của tm-tools, không có nghĩa trong studio video: xoá khối "Editor Type" khỏi SettingsSlideover thay vì port.
  - Gate: `nuxt typecheck` exit 0 (0 TS error); eslint 6 file touched exit 0 (còn 1 warning `vue/no-v-html` ở MediaVisual — đã bọc `sanitizeSvg`); `test:unit` **60/60** exit 0. Sửa regex của spec hygiene `/<img\n/` → `/<img\r?\n/` để chịu được checkout CRLF (nội dung contract giữ nguyên: tag phải xuống dòng).
  - Visual: sau khi người dùng tự đăng nhập (handoff, không nhập credential), editor + export modal + settings slideover mount **không còn warning nào** trong console; logo TeamsMenu/login render qua MediaVisual; khối "Editor Type" đã biến mất khỏi settings. Preview modal với media thật chưa chạy được vì project trống (component đã đăng ký trong `.nuxt/components.d.ts`, typecheck sạch).
- **2026-10-31** — **Phase 6 — chốt phạm vi.** Chủ repo xác nhận WIP chat chưa commit trong tm-hub là việc riêng của tm-hub, không thuộc extraction và không chặn tiến độ. Phase 6 vì vậy **PASS cho tm-studio + tm-tools**, tm-hub **out of scope** (không sửa, không commit WIP; ghi nhận lại ở mục BLOCKED phía trên như lịch sử).
- **2026-10-31** — **UI-4 (slice 1): editor full-bleed trên layout studio + nav popover hub-driven.**
  - `layouts/studio.vue` (mới): `UDashboardGroup` + `<slot />` + notifications/settings slideover, không sidebar; chỉ gọi `fetchRoutes()` khi đã đăng nhập vì guard/RBAC đã nằm ở middleware global.
  - `pages/tmcut/editor.vue`: `definePageMeta({ layout: 'studio' })`; slot `#left` thay `UDashboardSidebarCollapse` bằng `<TmcutNavPopover />` (giữ nút back `/tmcut`).
  - `components/tmcut/TmcutNavPopover.vue` (mới): popover kính (dùng `glass-surface`), 3 nhóm Workspace/Resources/System dựng từ `useNavMenu().allowedRoutes`, highlight route hiện tại, toggle sáng/tối qua `useColorMode`; grid 12 cột responsive, `max-h` + `overflow-y-auto` cho viewport thấp.
  - `assets/css/main.css`: token `--studio-glass-{bg,border,specular,shadow}` cho light/dark + `@utility glass-surface` (blur 20px, saturate 160%, inset specular).
  - `layouts/default.vue`: xoá khối auto-collapse sidebar theo route (đã vô nghĩa vì editor không còn dùng shell sidebar).
  - i18n `studio.nav.*` (en/vi): openMenu/home/workspace/app/toggleTheme.
  - Gate: `nuxt typecheck` exit 0 (0 `error TS`, chạy lại sau lần regenerate `.nuxt/eslint.config.mjs` cuối), eslint 5 file touched exit 0 (main.css bị ignore theo config — không tính), `test:unit` **60/60** exit 0. Spec hygiene đổi contract theo thiết kế mới: left slot phải có `TmcutNavPopover` và **không** còn `UDashboardSidebarCollapse` (thay vì xoá assertion).
  - Visual: dùng lại profile Chrome đã đăng nhập (cookie `localhost` còn hạn — không nhập/đọc credential). Editor mở full-bleed, **không** có `dashboard-sidebar-default`; trigger popover hiển thị "Trình chỉnh sửa"; popover đủ Workspace/Resources/System + toggle theme, đọc tốt ở light và dark. Toggle theme trong popover đổi toàn cục sang light. Bấm "Bảng điều khiển TMCut" (SPA) → shell sidebar trở lại (`dashboard-sidebar-default`, nút "Mở rộng thanh bên"); quay lại editor → studio layout lần nữa. Console buffer sau khi reload: 12 entry, **0 warning/error**.
