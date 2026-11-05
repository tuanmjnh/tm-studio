# AGENTS.md — TM Studio (TMCut)

Guidance for AI coding agents working in this repository.

## Project Overview

**TM Studio** is an Electron + Nuxt 4 standalone video creation suite (TMCut) powered by Nuxt UI v4 (Tailwind CSS v4).

- **Technology Stack**: Electron + Nuxt 4 running on Port 4003 (`STUDIO_PORT` / `APP_PORT` config).
- **UI Framework**: Nuxt UI v4 (Tailwind CSS v4).
- **Control Plane Integration**:
  - Connects to **TM Hub** (`http://localhost:4000`) as a satellite app via `useHub()` with `X-App-Id: tm-studio_749app`.
  - Identity, authentication, user sessions, role-based access control, routes, and configs are centrally managed by TM Hub.
- **Dynamic Menu System**:
  - Sidebar navigation is built dynamically from `system_routes` fetched from TM Hub via `GET /api/v1/auth/routes?appId=...`.
  - Filtered by `isVisible !== false` at root and children.
  - Route labels are resolved via i18n keys (`nav.*`).
- **Core Modules**:
  - **TMCut Video Studio**: Dashboard (`/tmcut`), timeline editor (`/tmcut/editor`), template library (`/tmcut/templates`), autocut (`/tmcut/autocut`), HTML/CSS video (`/tmcut/html-video`), voice/TTS (`/tmcut/voice`), processing (`/tmcut/process`), factory (`/tmcut/factory`).
  - **Connections**: data-provider connections registry managed by TM Hub, consumed via `useHubAi` / `useHub` (`/resources/connections`).
  - **AI Keys**: local Electron AI vault dashboard (`/system/ai-keys`) fed by the hub AI provider/model catalog.
- **AI 3-layer architecture**:
  - Hub catalog (`useHubAi`) — provider/model definitions and connections from TM Hub.
  - Relay secret (`NUXT_HUB_APP_SECRET`) — server-side relay `/api/v1/ai/relay/*`.
  - Local Electron vault (`ai-gateway.cjs` + `ai-secure.cjs` + `config-file.cjs`) — `config.env` in userData; adoption bridge in `app/utils/tmcut/hubAiConnection.ts`.
- **Push Notifications**:
  - Unified Firebase FCM & VAPID Web Push via `app/composables/useWebPush.ts` synchronized with Service Worker (`public/push-sw.js`).

## Commands

```bash
pnpm install        # Install dependencies (pnpm is the package manager)
pnpm dev            # Nuxt dev server on http://localhost:4003 (--port 4003)
pnpm dev:electron   # Nuxt dev + Electron together
pnpm typecheck      # Run typecheck (vue-tsc) — always run after type changes
pnpm lint           # ESLint check on modified files
pnpm build          # Nuxt production build

# Central Seeding via tm-hub:
# cd ../tm-hub && pnpm seed --app=studio        # update routes, roles, & configs
# cd ../tm-hub && pnpm seed:studio:reset        # reset and recreate studio data
```

## Project Structure

```
app/                 Nuxt 4 app (pages, layouts, components, composables, middleware)
app/pages/           Route pages (/index, /login, /tmcut/*)
app/pages/tmcut/     TMCut suite pages (dashboard, editor, templates, autocut, html-video, voice, process, factory)
app/composables/     Client composables (useAuth, useHub, useHubAi, useTmcut*)
app/components/tmcut/ TMCut editor/UI components
app/utils/tmcut/     TMCut client utils (incl. hubAiConnection.ts adoption bridge)
app/layouts/         Layouts (default.vue with sidebar navigation)
app/middleware/      Client route guards (auth.global.ts)
electron/            Electron main process & preload scripts (main.cjs, preload.cjs + tmcut controllers)
i18n/locales/        i18n files (en.json, vi.json)
packages/core/       tmcut-core — zero-dependency editing engine (deterministic timeline core), read from src by every host
server/api/          Local Nitro API endpoints (media, stock, process, ai relay)
server/config/       Local runtime environment config
shared/types/        Types used by BOTH the Vue app and the Nitro server (import via #shared/types/<file>)
```

## Architecture & Integration Notes

### Satellite Connection to TM Hub
- Satellite requests to TM Hub are handled via `useHub()`, using `hubFetch` which automatically attaches JWT bearer tokens and `X-App-Id`.
- Login, registration, token refresh, and user profile updates go directly to TM Hub.
- Routes are fetched at runtime via `nav.fetchRoutes()`, mapped into `NavigationMenuItem[]` by `useNavMenu.ts`.

### Page & Layout Conventions
- **Open Source First**: Đối với những chức năng chưa quen thuộc, đừng viết từ con số 0, hãy tìm kiếm các dự án mã nguồn mở trên GitHub để so sánh ý tưởng trước khi bắt tay vào làm.
- **BasePage Mandatory**:
  - All new pages/modules MUST wrap their content in `<BasePage :title="..." :description="...">` (`app/components/base/Page.vue`).
  - Left slot: Displays title and optional description.
  - Right slot: Secondary action buttons belong in `template #right`. Overflow options should be grouped in `UDropdownMenu` with `i-lucide-ellipsis-vertical`.
- **Page Padding**:
  - Standard dashboard pages keep default padding.
  - Studio & editor pages (such as `/tmcut/editor`) MUST pass the `flush` prop (`<BasePage flush ...>`) to remove padding and gap, giving 100% of the viewport to canvas, timelines, and inspectors.
- **Button Variants**:
  - Primary action buttons (save, create, run, confirm, launch, export, …) use `color="primary" variant="soft"` — exactly one per surface.
  - Dismissal / secondary buttons (cancel, back, close, skip, dismiss, …) use `variant="ghost"` (usually `color="neutral"`) — they must never compete visually with the primary action.
  - Destructive confirmations use `color="error"`; their cancel counterpart stays `variant="ghost"`.
- **Form Controls & Inputs**:
  - Always add class `w-full` for inputs (`UInput`, `USelect`, `USelectMenu`, `UTextarea`, etc.) to ensure consistent responsive layout across all forms.
- **GridList & Batch Operations**:
  - Prefer `LazyGridList` over `BaseTable`. Always provide `#mobile-content` slot.
- **Animation, Status & Icons (optimized surfaces)**:
  - **Motion budget**: subtle and purposeful only — 150–200 ms ease transitions for hover/focus/press (`transition-colors`, `duration-200`); entrance motion is owned by Nuxt UI (modal/sheet/drawer built-ins). Never hand-roll `animate-*` for decoration: the only legitimate loops are skeleton `pulse`, live-recording pulse, and canvas/WebGPU scenes (use the `threejs-*` skills for those, never for hover feedback).
  - **Triple state rule**: every async surface (lists, panels, dialogs) renders ALL of loading (skeleton/`pulse`, ≥1 line), empty (dashed card + one icon + one-line hint + CTA), and error (inline banner + retry) — a surface must never flash raw "No data" or a permanently blank box while wiring resolves.
  - **Status language**: one lucide icon + ≤2-word label in `UBadge variant="subtle"` — `i-lucide-circle-check` (emerald) / `i-lucide-triangle-alert` (amber) / `i-lucide-circle-alert` or `i-lucide-circle-x` (red) / `i-lucide-info` (primary) / `i-lucide-clock` (neutral pending). Color must never be the only signal; a "connected/online/OK" badge without its icon is a bug. Progress states show the measurable value (`{done}/{total}`, `{ms}`) instead of repeating "loading…".
  - **Icon economy**: single family (`i-lucide-*`). Decorative icons ride text (`size-3.5`–`size-4` in labels, `size-5`–`size-6` in headers). One icon per verb/button; an icon that duplicates the adjacent word is redundant — drop the icon or shorten the label, not both. Icon-only controls MUST carry `:title`/`:aria-label`. Misaligned leading icons (e.g. `size-3` inside a `size-6` header box) is a layout bug, fix the container not the icon.
  - **Redundancy check (text)**: a header's `description` must add information the title doesn't already say; card sections must not echo the page description; unit chips like "1920×1080 · 30fps" appear at most once per card. When a list state already explains itself ("2 projects"), don't repeat a counter badge next to it.
- **Lazy components (code splitting)**:
  - Any component that mounts on demand (modals, slidesovers, drawers, heavy panels, tab content) MUST be referenced with the Nuxt `Lazy` prefix (e.g. `<LazyBaseResponsiveModal>`, `<LazyBaseConfirmModal>`). The Lazy prefix puts the component in its own chunk and defers loading until it is actually rendered.
  - Direct (non-lazy) references are reserved for always-visible, above-the-fold chrome (BasePage, nav, grid list).
- **Nuxt 4 Directory Structure & Path Aliases Standard**:
  - According to official Nuxt 4 documentation, frontend code is separated into the `app/` directory (`srcDir`).
  - `~/` or `@/`: Points to `<rootDir>/app` (`srcDir`). Internal frontend application files (components, composables, pages, layouts, assets, app-only utils/types).
  - `~~/` or `@@/`: Points to `<rootDir>` (Root Project). Files located at project root outside `app/` (e.g. `~~/config/...`, `~~/scripts/...`, `~~/layers/...`). Never use `~~/app/...`.
  - `#shared/`: Points to `<rootDir>/shared`. Code, utilities, constants, and TypeScript types shared across BOTH App (Frontend) and Nitro Server (Backend) (e.g. `#shared/types/...`, `#shared/utils/...`). Never use relative traversal like `../../shared` or `~/../shared`.
  - `#server/`: Points to `<rootDir>/server`. Internal Nitro Server files (services, modules, database, server-only utils/types). Used strictly within `server/`. ALWAYS prefer `#server/...` over fragile deep relative imports like `../../../../modules/...` or `../../../../utils/...` inside `server/api/` or `server/modules/`.
  - `#imports`, `#app`, `#build`: Points to `<rootDir>/.nuxt/...`. Virtual modules and build artifacts generated by Nuxt.
  - **Strict Architectural Boundaries**:
    1. NEVER use `~/server/...` or `@/server/...` (since `~/` points to `app/`, this looks in `app/server`).
    2. Frontend (`app/`) MUST NEVER import from `server/` (no `~~/server/...`, `#server/...`, or relative paths into `server/`).
    3. Server (`server/`) MUST NEVER import from `app/` (no `~~/app/...` or `~/...`).
    4. Server API routes and modules MUST use `#server/...` (e.g. `#server/modules/...`, `#server/utils/...`, `#server/config`) instead of multi-level relative traversals (`../../../../`).
    5. Any shared type, contract, validation schema, or utility MUST live in `shared/` and be imported via `#shared/...`.
- **Type placement (Nuxt 4 standard)**:
  - Types used by BOTH the Vue app and the Nitro server live in `shared/types/` (import via the built-in `#shared/types/<file>` alias).
  - App-only types live in `app/types/`; server-only types live in `server/types/`. There is NO root-level `types/` folder.
  - One canonical definition per type name across the auto-imported surfaces (`app/types`, `server/types`, `shared/types`) — duplicated interface names across those folders trip the unimport "Duplicated imports" warnings.
  - Values (type guards, status consts) belong in `shared/utils/` or `app/utils/`, not in types folders.
- **Tailwind CSS Conventions**:
  - Explicit pixel values using arbitrary brackets (e.g. max-h-[200px], w-[320px]) are acceptable for clarity. Shorthand scale enforcement (@tailwindcss/enforces-shorthand) and canonical class warnings are disabled.

### i18n & Language Conventions
- All user-facing text MUST reside in `i18n/locales/en.json` and `i18n/locales/vi.json` and be accessed via `t()`.
- **No Inline i18n Fallbacks**: NEVER pass fallback text as a second string argument to `t()` (e.g. `t('key', 'Fallback text')` is strictly forbidden). Always define keys directly in both `i18n/locales/en.json` and `i18n/locales/vi.json`, and invoke `t('key')` without inline fallback string arguments.
- Source code comments, technical logs, constants, and commit messages MUST ALWAYS be written in English.

## Testing & Verification

Verification is manual: `pnpm typecheck` + `pnpm lint` + `pnpm dev` (or `pnpm dev:electron`).
