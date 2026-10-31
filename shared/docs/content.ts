// SATELLITE COPY of tm-hub/shared/docs/content.ts — serves as frozen fallback when the Hub is unreachable. Refresh by copying the hub file.
// =============================================================================
//  Docs reference content — SINGLE SOURCE OF TRUTH for the /admin-system (docs)
//  page across the TM platform (tm-hub + satellites tm-tools / tm-trading).
//
//  Served to satellites via GET /api/v1/apps/:appId/docs, so a content update
//  here is enough — satellite pages fetch at runtime and only fall back to
//  their frozen copy when the hub is unreachable.
//
//  Placeholders rendered by the consumer page:
//   - sdk.description `{app}` → satellite app name
//   - sdk.usageCode `appId: '{appId}'` → satellite runtime appId
// =============================================================================

export type DocsRoadmapStatus = 'shipped' | 'in_progress' | 'planned'

export interface DocsArchitectureCard {
  icon: string
  iconClass: string
  hoverClass: string
  title: string
  desc: string
}

export interface DocsRoadmapItem {
  phase: string
  status: DocsRoadmapStatus
  statusLabel: string
  title: string
  desc: string
}

export interface DocsRoadmapSection {
  title: string
  description: string
  updatedLabel: string
  items: DocsRoadmapItem[]
}

export interface DocsSdkInstallCommand {
  label: string
  code: string
}

export interface DocsSdkSection {
  title: string
  description: string
  install: string
  installHint: string
  usage: string
  copyLabel: string
  copiedLabel: string
  githubLabel: string
  githubUrl: string
  installCommands: DocsSdkInstallCommand[]
  usageCode: string
}

export interface DocsApiSection {
  title: string
  prefixLabel: string
  headers: { module: string, method: string, endpoint: string, description: string }
}

export interface DocsApiReference {
  module: string
  method: string
  path: string
  desc: string
}

export interface DocsSetupStep {
  title: string
  desc: string
  code?: string
  lang?: string
}

export interface DocsSetupSection {
  title: string
  description: string
  steps: DocsSetupStep[]
}

export interface DocsContentLocale {
  architecture: DocsArchitectureCard[]
  roadmap: DocsRoadmapSection
  setupGuide?: DocsSetupSection
  sdk: DocsSdkSection
  api: DocsApiSection
  apis: DocsApiReference[]
}

export interface HubDocsContent {
  version: number
  updatedAt: string
  en: DocsContentLocale
  vi: DocsContentLocale
}

export const HUB_DOCS_VERSION = 1
export const HUB_DOCS_UPDATED_AT = '2026-10-21'

/** Replace the placeholders in the SDK sample code. */
export function docsUsageCodeFor(usageCode: string, appId: string, hubEnvVar: string): string {
  return usageCode
    .replace(/\{HUB_URL_ENV\}/g, hubEnvVar)
    .replace("{ appId: '{appId}' }", `appId: '${appId}'`)
}

/** Replace the `{app}` placeholder inside the SDK description sentence. */
export function docsSdkDescriptionFor(description: string, appName: string): string {
  return description.replace('{app}', appName)
}

const SDK_USAGE_CODE = `import { createHubClient } from 'tm-hub-client'

export const hub = createHubClient({
  baseUrl: process.env.{HUB_URL_ENV} || 'http://localhost:4000',
  appId: '{appId}'
})

// 1. Fetch Remote Configs
const configs = await hub.configs.getAll()

// 2. IAM Login
const session = await hub.auth.login({ email: 'admin@example.com', password: 'password' })

// 3. AI providers, credentials & models
const providers = await hub.ai.providers()
const models = await hub.ai.models.list({ isEnabled: true })`

const SDK_DESCRIPTION_EN = 'Client applications in the ecosystem (such as {app}) connect to TM Hub via the unified client library:'
const SDK_DESCRIPTION_VI = 'Các ứng dụng client trong hệ sinh thái (như {app}) kết nối với TM Hub thông qua thư viện thống nhất:'

export const HUB_DOCS_CONTENT: HubDocsContent = {
  version: HUB_DOCS_VERSION,
  updatedAt: HUB_DOCS_UPDATED_AT,
  en: {
    architecture: [
      {
        icon: 'i-lucide-shield-check',
        iconClass: 'bg-primary/10 text-primary',
        hoverClass: 'hover:border-primary/40',
        title: '1. Identity (IAM)',
        desc: 'Accounts, JWT access/refresh rotation, TOTP/passkeys/OAuth, and RBAC-driven dynamic routes.'
      },
      {
        icon: 'i-lucide-sliders',
        iconClass: 'bg-emerald-500/10 text-emerald-500',
        hoverClass: 'hover:border-emerald-500/40',
        title: '2. Remote Configs',
        desc: 'Per-app configuration for Cloudinary, Firebase, Push, mail and other integrations, including encrypted secrets and public delivery.'
      },
      {
        icon: 'i-lucide-sparkles',
        iconClass: 'bg-violet-500/10 text-violet-500',
        hoverClass: 'hover:border-violet-500/40',
        title: '3. AI Providers & Models',
        desc: 'Provider catalogue, multiple encrypted credentials per app, model discovery, health checks, grants and per-model enablement.'
      },
      {
        icon: 'i-lucide-plug-zap',
        iconClass: 'bg-sky-500/10 text-sky-500',
        hoverClass: 'hover:border-sky-500/40',
        title: '4. Connections Registry',
        desc: 'Canonical OAuth and manual integration inventory with provider tests, health state and revocation across apps.'
      },
      {
        icon: 'i-lucide-cloud-upload',
        iconClass: 'bg-amber-500/10 text-amber-500',
        hoverClass: 'hover:border-amber-500/40',
        title: '5. Media Gateway',
        desc: 'Manage Cloudinary media assets and generate secure backend upload signatures.'
      },
      {
        icon: 'i-lucide-bell-ring',
        iconClass: 'bg-rose-500/10 text-rose-500',
        hoverClass: 'hover:border-rose-500/40',
        title: '6. Notification Hub',
        desc: 'Manage push device subscriptions and orchestrate Web Push notifications by user account.'
      },
      {
        icon: 'i-lucide-mail',
        iconClass: 'bg-cyan-500/10 text-cyan-500',
        hoverClass: 'hover:border-cyan-500/40',
        title: '7. Mail & Inbox',
        desc: 'Transactional mail, templates, queue/jobs, analytics and per-app inbox delivery.'
      },
      {
        icon: 'i-lucide-arrow-down-up',
        iconClass: 'bg-lime-500/10 text-lime-500',
        hoverClass: 'hover:border-lime-500/40',
        title: '8. Import / Export',
        desc: 'Preview, validate and execute CSV/JSON/Sheets imports; export module data and job results.'
      }
    ],
    roadmap: {
      title: 'Provider & Connections Roadmap',
      description: 'Delivery status for the central provider/connection plan. Hub-owned credentials can be granted to child apps; app-owned AI credentials stay isolated (D35).',
      updatedLabel: `Updated ${HUB_DOCS_UPDATED_AT}`,
      items: [
        { phase: '0', status: 'shipped', statusLabel: 'Shipped', title: 'Audit & data inventory', desc: 'Repository, schema and provider inventory audit.' },
        { phase: '1', status: 'shipped', statusLabel: 'Shipped', title: 'Provider & credential contracts', desc: 'Provider, connection, credential, model and grant contracts with explicit security boundaries.' },
        { phase: '2', status: 'shipped', statusLabel: 'Shipped', title: 'AI Providers & Models UI', desc: 'Management UI with multiple credentials per provider and per-model controls.' },
        { phase: '3', status: 'shipped', statusLabel: 'Shipped', title: 'Discovery & health checks', desc: 'OpenAI-compatible model discovery, manual fallback and live credential tests.' },
        { phase: '4', status: 'in_progress', statusLabel: 'In progress', title: 'Connections Registry', desc: 'Canonical integration inventory with category-based add and reconnect flows.' },
        { phase: '5', status: 'in_progress', statusLabel: 'In progress', title: 'Grants & app ownership', desc: 'Hub-owned connection grants and app-owned AI credential isolation.' },
        { phase: '6', status: 'planned', statusLabel: 'Planned', title: 'Child app integration', desc: 'Child apps consume providers with read-only and sandbox-first permissions.' },
        { phase: '7', status: 'planned', statusLabel: 'Planned', title: 'Operations & observability', desc: 'Scheduled sync, quotas, health dashboard and audit diagnostics.' },
        { phase: '8', status: 'planned', statusLabel: 'Planned', title: 'Native adapters & MCP', desc: 'Additional native adapters, media generation APIs and an MCP registry.' }
      ]
    },
    setupGuide: {
      title: 'System Installation & Configuration Guide',
      description: 'Step-by-step setup for TM Hub control plane, MongoDB integration, and satellite client applications.',
      steps: [
        {
          title: '1. Ports & Ecosystem Architecture',
          desc: 'TM Hub runs on Port 4000 as the central IAM & Control Plane. Satellite apps (TM Tools on 4002, TM Trading on 4001) connect via tm-hub-client.',
          code: `# TM Hub Control Plane: http://localhost:4000\n# TM Tools Desktop:     http://localhost:4002\n# TM Trading Engine:    http://localhost:4001`
        },
        {
          title: '2. TM Hub Environment (.env)',
          desc: 'Configure TM Hub with Supabase (Auth/Roles), dual MongoDB connections (Audit Logs & App Data), and shared JWT signing secret.',
          code: `# tm-hub/.env\nPORT=4000\nAPP_ID=tm-hub_hqmnrn\nSUPABASE_URL=https://your-project.supabase.co\nSUPABASE_KEY=your-supabase-service-role-key\nAUTH_JWT_SECRET=super-secure-shared-secret-key-32-chars-min\n\n# MongoDB Audit Logging:\nMONGODB_LOG_URI=mongodb://admin:pass@host:27017/...\nMONGODB_LOG_DB_NAME=tm-hub-logs\n\n# MongoDB App Data & Custom Documents:\nMONGODB_APP_URI=mongodb+srv://admin:pass@cluster0...mongodb.net\nMONGODB_APP_DB_NAME=tm-hub-app`
        },
        {
          title: '3. Satellite Client Configuration (.env)',
          desc: 'Configure satellite apps (e.g. tm-tools) to point to TM Hub with their registered appId and matching AUTH_JWT_SECRET.',
          code: `# tm-tools/.env\nPORT=4002\nAUTH_PROVIDER=hub\nNUXT_PUBLIC_HUB_URL=http://localhost:4000\nNUXT_PUBLIC_HUB_APP_ID=tm-tools_bbx58v\nAUTH_JWT_SECRET=super-secure-shared-secret-key-32-chars-min\n\n# Video Generation (Runway Gen-3):\nRUNWAY_API_KEY=key_your_runway_api_key\nRUNWAY_BASE_URL=https://api.runwayml.com/v1`
        },
        {
          title: '4. Database Provisioning & Seed',
          desc: 'Provision system routes, roles, permissions and app configs across all applications with the central CLI.',
          code: `cd tm-hub\npnpm seed`
        },
        {
          title: '5. Launching Applications',
          desc: 'Start the TM Hub dev server, then start TM Tools desktop application.',
          code: `# Terminal 1 - Start TM Hub:\ncd tm-hub && pnpm dev\n\n# Terminal 2 - Start TM Tools:\ncd tm-tools && pnpm dev:electron`
        }
      ]
    },
    sdk: {
      title: 'Client SDK Integration (tm-hub-client)',
      description: SDK_DESCRIPTION_EN,
      install: 'Install the client',
      installHint: 'Add the package to your client project with pnpm or npm.',
      usage: 'Usage & import',
      copyLabel: 'Copy code',
      copiedLabel: 'Copied',
      githubLabel: 'GitHub repository',
      githubUrl: 'https://github.com/tuanmjnh/tm-hub-client',
      installCommands: [
        { label: 'pnpm', code: 'pnpm add tm-hub-client' },
        { label: 'npm', code: 'npm install tm-hub-client' }
      ],
      usageCode: SDK_USAGE_CODE
    },
    api: {
      title: 'REST API Specifications (v1)',
      prefixLabel: 'Prefix: /api/v1',
      headers: { module: 'Module', method: 'Method', endpoint: 'Endpoint', description: 'Function Description' }
    },
    apis: [
      { module: 'Auth (IAM)', method: 'POST', path: '/api/v1/auth/login', desc: 'Authenticate user with email/password, returns Access & Refresh Tokens' },
      { module: 'Auth (IAM)', method: 'POST', path: '/api/v1/auth/refresh', desc: 'Refresh Access Token using a valid Refresh Token' },
      { module: 'Auth (IAM)', method: 'GET', path: '/api/v1/auth/me', desc: 'Fetch currently authenticated user account profile' },
      { module: 'Auth (IAM)', method: 'GET', path: '/api/v1/auth/routes', desc: 'Fetch navigation route tree filtered by user role (RBAC)' },
      { module: 'Remote Configs', method: 'GET', path: '/api/v1/apps/:appId/configs', desc: 'Retrieve all third-party configs (Cloudinary, Firebase, Push, mail)' },
      { module: 'Remote Configs', method: 'PUT', path: '/api/v1/apps/:appId/configs', desc: 'Update service configuration parameters for the application' },
      { module: 'Remote Configs', method: 'GET', path: '/api/v1/apps/:appId/configs/public', desc: 'Retrieve public configuration (without API secrets)' },
      { module: 'AI Providers', method: 'GET', path: '/api/v1/apps/:appId/ai/providers', desc: 'List provider definitions joined with this app\'s managed credentials' },
      { module: 'AI Providers', method: 'POST', path: '/api/v1/apps/:appId/ai/providers', desc: 'Create a custom AI provider definition' },
      { module: 'AI Providers', method: 'POST', path: '/api/v1/apps/:appId/ai/connections/manual', desc: 'Add or rotate an encrypted credential for a provider account' },
      { module: 'AI Providers', method: 'PATCH', path: '/api/v1/apps/:appId/ai/connections/:connectionId', desc: 'Rename, enable/disable or re-scope a credential' },
      { module: 'AI Providers', method: 'DELETE', path: '/api/v1/apps/:appId/ai/connections/:connectionId', desc: 'Delete a credential without exposing its secret' },
      { module: 'AI Providers', method: 'POST', path: '/api/v1/apps/:appId/ai/discover', desc: 'Discover the live model catalogue and optionally persist it' },
      { module: 'AI Providers', method: 'GET', path: '/api/v1/apps/:appId/ai/models', desc: 'List enabled and disabled models for the app' },
      { module: 'AI Providers', method: 'POST', path: '/api/v1/apps/:appId/ai/models', desc: 'Add a model manually when discovery is unavailable' },
      { module: 'AI Providers', method: 'PATCH', path: '/api/v1/apps/:appId/ai/models/:modelId', desc: 'Enable or disable a model in the routing catalogue' },
      { module: 'AI Providers', method: 'DELETE', path: '/api/v1/apps/:appId/ai/models/:modelId', desc: 'Remove a model from the app catalogue' },
      { module: 'AI Providers', method: 'GET', path: '/api/v1/apps/:appId/ai/grants', desc: 'List shared connections granted to this app' },
      { module: 'AI Providers', method: 'POST', path: '/api/v1/apps/:appId/ai/grants', desc: 'Grant a hub-owned connection to another app' },
      { module: 'AI Providers', method: 'DELETE', path: '/api/v1/apps/:appId/ai/grants/:grantId', desc: 'Revoke a previously granted shared connection' },
      { module: 'Connections', method: 'GET', path: '/api/v1/apps/:appId/connections', desc: 'List provider definitions and this app\'s connection state' },
      { module: 'Connections', method: 'POST', path: '/api/v1/apps/:appId/connections/manual', desc: 'Save and test manual provider credentials' },
      { module: 'Connections', method: 'POST', path: '/api/v1/apps/:appId/connections/quick', desc: 'Create a connection from existing app configs' },
      { module: 'Connections', method: 'POST', path: '/api/v1/apps/:appId/connections/test', desc: 'Run a live health check for one provider account' },
      { module: 'Connections', method: 'DELETE', path: '/api/v1/apps/:appId/connections/:provider', desc: 'Delete a provider connection for the app' },
      { module: 'Media Gateway', method: 'GET', path: '/api/v1/apps/:appId/media/folders', desc: 'List Cloudinary folders for the specified appId' },
      { module: 'Media Gateway', method: 'GET', path: '/api/v1/apps/:appId/media/resources', desc: 'List media assets inside a specific folder' },
      { module: 'Media Gateway', method: 'POST', path: '/api/v1/apps/:appId/media/signature', desc: 'Generate secure backend signature for direct client uploads to Cloudinary' },
      { module: 'Media Gateway', method: 'DELETE', path: '/api/v1/apps/:appId/media/resources', desc: 'Delete media resource by public_id' },
      { module: 'Notifications', method: 'POST', path: '/api/v1/apps/:appId/notifications/subscribe', desc: 'Register Web Push subscription for the authenticated user' },
      { module: 'Notifications', method: 'GET', path: '/api/v1/apps/:appId/notifications', desc: 'Retrieve notifications list for the user' },
      { module: 'Notifications', method: 'POST', path: '/api/v1/apps/:appId/notifications/send', desc: 'Dispatch Web Push notification to target users' },
      { module: 'Mail', method: 'POST', path: '/api/v1/apps/:appId/mail/send', desc: 'Queue and send transactional mail' },
      { module: 'Mail', method: 'GET', path: '/api/v1/apps/:appId/mail/templates', desc: 'List mail templates available to the app' },
      { module: 'Mail', method: 'GET', path: '/api/v1/apps/:appId/mail/inbox/messages', desc: 'List inbound messages in the app inbox' },
      { module: 'Import / Export', method: 'POST', path: '/api/v1/apps/:appId/import/preview', desc: 'Parse and validate an import file without writing data' },
      { module: 'Import / Export', method: 'POST', path: '/api/v1/apps/:appId/import/execute', desc: 'Execute a confirmed import job' },
      { module: 'Import / Export', method: 'POST', path: '/api/v1/apps/:appId/export/:module', desc: 'Export a module dataset as a background job' }
    ]
  },
  vi: {
    architecture: [
      {
        icon: 'i-lucide-shield-check',
        iconClass: 'bg-primary/10 text-primary',
        hoverClass: 'hover:border-primary/40',
        title: '1. Identity (IAM)',
        desc: 'Tài khoản, xoay JWT access/refresh, TOTP/passkey/OAuth và menu động theo quyền RBAC.'
      },
      {
        icon: 'i-lucide-sliders',
        iconClass: 'bg-emerald-500/10 text-emerald-500',
        hoverClass: 'hover:border-emerald-500/40',
        title: '2. Remote Configs',
        desc: 'Cấu hình theo app cho Cloudinary, Firebase, Push, mail và các tích hợp khác, gồm secret mã hóa và cấu hình public.'
      },
      {
        icon: 'i-lucide-sparkles',
        iconClass: 'bg-violet-500/10 text-violet-500',
        hoverClass: 'hover:border-violet-500/40',
        title: '3. AI Providers & Models',
        desc: 'Danh mục provider, nhiều credential mã hóa cho mỗi app, tự dò model, kiểm tra sức khỏe, grant và bật/tắt từng model.'
      },
      {
        icon: 'i-lucide-plug-zap',
        iconClass: 'bg-sky-500/10 text-sky-500',
        hoverClass: 'hover:border-sky-500/40',
        title: '4. Connections Registry',
        desc: 'Kho tích hợp OAuth và thủ công tập trung với kiểm tra provider, trạng thái sức khỏe và thu hồi giữa các app.'
      },
      {
        icon: 'i-lucide-cloud-upload',
        iconClass: 'bg-amber-500/10 text-amber-500',
        hoverClass: 'hover:border-amber-500/40',
        title: '5. Media Gateway',
        desc: 'Quản lý tài nguyên media Cloudinary, sinh upload signature phía backend an toàn tuyệt đối.'
      },
      {
        icon: 'i-lucide-bell-ring',
        iconClass: 'bg-rose-500/10 text-rose-500',
        hoverClass: 'hover:border-rose-500/40',
        title: '6. Notification Hub',
        desc: 'Quản lý thiết bị đăng ký nhận thông báo và điều phối Web Push theo tài khoản người dùng.'
      },
      {
        icon: 'i-lucide-mail',
        iconClass: 'bg-cyan-500/10 text-cyan-500',
        hoverClass: 'hover:border-cyan-500/40',
        title: '7. Mail & Inbox',
        desc: 'Gửi mail giao dịch, quản lý template, queue/job, thống kê và hộp thư đến theo từng app.'
      },
      {
        icon: 'i-lucide-arrow-down-up',
        iconClass: 'bg-lime-500/10 text-lime-500',
        hoverClass: 'hover:border-lime-500/40',
        title: '8. Import / Export',
        desc: 'Xem trước, kiểm tra và thực thi import CSV/JSON/Sheets; export dữ liệu module và kết quả job.'
      }
    ],
    roadmap: {
      title: 'Lộ Trình Provider & Connections',
      description: 'Trạng thái triển khai kế hoạch provider/connection tập trung. Credential thuộc Hub có thể grant cho app con; credential AI thuộc app được cô lập (D35).',
      updatedLabel: `Cập nhật ${HUB_DOCS_UPDATED_AT}`,
      items: [
        { phase: '0', status: 'shipped', statusLabel: 'Đã hoàn thành', title: 'Kiểm tra & kiểm kê dữ liệu', desc: 'Rà soát repository, schema và danh mục provider.' },
        { phase: '1', status: 'shipped', statusLabel: 'Đã hoàn thành', title: 'Hợp đồng provider & credential', desc: 'Chuẩn hóa provider, connection, credential, model và grant với ranh giới bảo mật rõ ràng.' },
        { phase: '2', status: 'shipped', statusLabel: 'Đã hoàn thành', title: 'Giao diện AI Providers & Models', desc: 'Quản lý nhiều credential cho mỗi provider và điều khiển từng model.' },
        { phase: '3', status: 'shipped', statusLabel: 'Đã hoàn thành', title: 'Dò model & health check', desc: 'Tự dò model tương thích OpenAI, thêm thủ công và kiểm tra credential trực tiếp.' },
        { phase: '4', status: 'in_progress', statusLabel: 'Đang triển khai', title: 'Connections Registry', desc: 'Kho tích hợp tập trung với luồng thêm theo danh mục và kết nối lại.' },
        { phase: '5', status: 'in_progress', statusLabel: 'Đang triển khai', title: 'Grant & quyền sở hữu app', desc: 'Grant connection thuộc Hub và cô lập credential AI thuộc app.' },
        { phase: '6', status: 'planned', statusLabel: 'Kế hoạch', title: 'Tích hợp app con', desc: 'App con sử dụng provider với quyền chỉ đọc và sandbox trước.' },
        { phase: '7', status: 'planned', statusLabel: 'Kế hoạch', title: 'Vận hành & quan sát', desc: 'Đồng bộ định kỳ, quota, dashboard sức khỏe và chẩn đoán audit.' },
        { phase: '8', status: 'planned', statusLabel: 'Kế hoạch', title: 'Adapter native & MCP', desc: 'Bổ sung adapter native, API tạo media và MCP registry.' }
      ]
    },
    setupGuide: {
      title: 'Hướng Dẫn Cài Đặt & Cấu Hình Hệ Thống',
      description: 'Quy trình thiết lập từng bước cho TM Hub Control Plane, kết nối MongoDB và các ứng dụng vệ tinh.',
      steps: [
        {
          title: '1. Kiến Trúc & Cổng Dịch Vụ',
          desc: 'TM Hub chạy trên Port 4000 đóng vai trò là Control Plane trung tâm. Các app vệ tinh (TM Tools chạy trên 4002, TM Trading trên 4001) kết nối qua tm-hub-client.',
          code: `# TM Hub Control Plane: http://localhost:4000\n# TM Tools Desktop:     http://localhost:4002\n# TM Trading Engine:    http://localhost:4001`
        },
        {
          title: '2. Cấu Hình TM Hub (.env)',
          desc: 'Cấu hình TM Hub với Supabase (Auth/Roles), 2 cụm MongoDB riêng biệt (Audit Logs & App Data), và khóa ký JWT dùng chung.',
          code: `# tm-hub/.env\nPORT=4000\nAPP_ID=tm-hub_hqmnrn\nSUPABASE_URL=https://your-project.supabase.co\nSUPABASE_KEY=your-supabase-service-role-key\nAUTH_JWT_SECRET=super-secure-shared-secret-key-32-chars-min\n\n# MongoDB Audit Logging:\nMONGODB_LOG_URI=mongodb://admin:pass@host:27017/...\nMONGODB_LOG_DB_NAME=tm-hub-logs\n\n# MongoDB App Data & Custom Documents:\nMONGODB_APP_URI=mongodb+srv://admin:pass@cluster0...mongodb.net\nMONGODB_APP_DB_NAME=tm-hub-app`
        },
        {
          title: '3. Cấu Hình Ứng Dụng Vệ Tinh (tm-tools/.env)',
          desc: 'Cấu hình client vệ tinh trỏ về TM Hub với đúng appId đã đăng ký, AUTH_JWT_SECRET khớp với Hub và các API key dịch vụ media/AI.',
          code: `# tm-tools/.env\nPORT=4002\nAUTH_PROVIDER=hub\nNUXT_PUBLIC_HUB_URL=http://localhost:4000\nNUXT_PUBLIC_HUB_APP_ID=tm-tools_bbx58v\nAUTH_JWT_SECRET=super-secure-shared-secret-key-32-chars-min\n\n# Video Generation (Runway Gen-3):\nRUNWAY_API_KEY=key_your_runway_api_key\nRUNWAY_BASE_URL=https://api.runwayml.com/v1`
        },
        {
          title: '4. Khởi Tạo & Seed Dữ Liệu',
          desc: 'Khởi tạo route động, phân quyền RBAC, người dùng mẫu và cấu hình ứng dụng trên toàn hệ thống.',
          code: `cd tm-hub\npnpm seed`
        },
        {
          title: '5. Khởi Chạy Hệ Thống',
          desc: 'Khởi động dev server TM Hub trước, sau đó khởi chạy ứng dụng Electron Desktop TM Tools.',
          code: `# Terminal 1 - Chạy TM Hub:\ncd tm-hub && pnpm dev\n\n# Terminal 2 - Chạy TM Tools (Desktop):\ncd tm-tools && pnpm dev:electron`
        }
      ]
    },
    sdk: {
      title: 'Tích Hợp Client SDK (tm-hub-client)',
      description: SDK_DESCRIPTION_VI,
      install: 'Cài đặt client',
      installHint: 'Thêm package vào dự án client bằng pnpm hoặc npm.',
      usage: 'Sử dụng & import',
      copyLabel: 'Sao chép mã',
      copiedLabel: 'Đã sao chép',
      githubLabel: 'GitHub repository',
      githubUrl: 'https://github.com/tuanmjnh/tm-hub-client',
      installCommands: [
        { label: 'pnpm', code: 'pnpm add tm-hub-client' },
        { label: 'npm', code: 'npm install tm-hub-client' }
      ],
      usageCode: SDK_USAGE_CODE
    },
    api: {
      title: 'Đặc Tả REST API (v1)',
      prefixLabel: 'Prefix: /api/v1',
      headers: { module: 'Module', method: 'Phương thức', endpoint: 'Endpoint', description: 'Mô Tả Chức Năng' }
    },
    apis: [
      { module: 'Auth (IAM)', method: 'POST', path: '/api/v1/auth/login', desc: 'Đăng nhập người dùng bằng email/password, trả về Access & Refresh Token' },
      { module: 'Auth (IAM)', method: 'POST', path: '/api/v1/auth/refresh', desc: 'Làm mới Access Token thông qua Refresh Token hợp lệ' },
      { module: 'Auth (IAM)', method: 'GET', path: '/api/v1/auth/me', desc: 'Lấy thông tin tài khoản người dùng đang đăng nhập' },
      { module: 'Auth (IAM)', method: 'GET', path: '/api/v1/auth/routes', desc: 'Lấy danh sách navigation routes theo vai trò (RBAC)' },
      { module: 'Remote Configs', method: 'GET', path: '/api/v1/apps/:appId/configs', desc: 'Lấy toàn bộ cấu hình dịch vụ bên thứ ba (Cloudinary, Firebase, Push, mail)' },
      { module: 'Remote Configs', method: 'PUT', path: '/api/v1/apps/:appId/configs', desc: 'Cập nhật thông số cấu hình dịch vụ cho ứng dụng' },
      { module: 'Remote Configs', method: 'GET', path: '/api/v1/apps/:appId/configs/public', desc: 'Lấy cấu hình public (không chứa API secret)' },
      { module: 'AI Providers', method: 'GET', path: '/api/v1/apps/:appId/ai/providers', desc: 'Lấy danh mục provider kèm credential mà app đang quản lý' },
      { module: 'AI Providers', method: 'POST', path: '/api/v1/apps/:appId/ai/providers', desc: 'Tạo định nghĩa provider AI tùy chỉnh' },
      { module: 'AI Providers', method: 'POST', path: '/api/v1/apps/:appId/ai/connections/manual', desc: 'Thêm hoặc xoay credential mã hóa cho một tài khoản provider' },
      { module: 'AI Providers', method: 'PATCH', path: '/api/v1/apps/:appId/ai/connections/:connectionId', desc: 'Đổi tên, bật/tắt hoặc đổi phạm vi credential' },
      { module: 'AI Providers', method: 'DELETE', path: '/api/v1/apps/:appId/ai/connections/:connectionId', desc: 'Xóa credential mà không lộ secret' },
      { module: 'AI Providers', method: 'POST', path: '/api/v1/apps/:appId/ai/discover', desc: 'Dò danh mục model trực tiếp và tùy chọn lưu lại' },
      { module: 'AI Providers', method: 'GET', path: '/api/v1/apps/:appId/ai/models', desc: 'Lấy danh sách model đang bật và đã tắt của app' },
      { module: 'AI Providers', method: 'POST', path: '/api/v1/apps/:appId/ai/models', desc: 'Thêm model thủ công khi không thể tự dò' },
      { module: 'AI Providers', method: 'PATCH', path: '/api/v1/apps/:appId/ai/models/:modelId', desc: 'Bật hoặc tắt một model trong danh mục định tuyến' },
      { module: 'AI Providers', method: 'DELETE', path: '/api/v1/apps/:appId/ai/models/:modelId', desc: 'Xóa model khỏi danh mục của app' },
      { module: 'AI Providers', method: 'GET', path: '/api/v1/apps/:appId/ai/grants', desc: 'Lấy các connection dùng chung đã grant cho app này' },
      { module: 'AI Providers', method: 'POST', path: '/api/v1/apps/:appId/ai/grants', desc: 'Grant một connection thuộc Hub cho app khác' },
      { module: 'AI Providers', method: 'DELETE', path: '/api/v1/apps/:appId/ai/grants/:grantId', desc: 'Thu hồi connection dùng chung đã grant' },
      { module: 'Connections', method: 'GET', path: '/api/v1/apps/:appId/connections', desc: 'Lấy danh mục provider và trạng thái connection của app' },
      { module: 'Connections', method: 'POST', path: '/api/v1/apps/:appId/connections/manual', desc: 'Lưu và kiểm tra credential provider thủ công' },
      { module: 'Connections', method: 'POST', path: '/api/v1/apps/:appId/connections/quick', desc: 'Tạo connection từ cấu hình có sẵn của app' },
      { module: 'Connections', method: 'POST', path: '/api/v1/apps/:appId/connections/test', desc: 'Chạy health check trực tiếp cho một tài khoản provider' },
      { module: 'Connections', method: 'DELETE', path: '/api/v1/apps/:appId/connections/:provider', desc: 'Xóa connection provider của app' },
      { module: 'Media Gateway', method: 'GET', path: '/api/v1/apps/:appId/media/folders', desc: 'Lấy danh sách thư mục Cloudinary theo appId' },
      { module: 'Media Gateway', method: 'GET', path: '/api/v1/apps/:appId/media/resources', desc: 'Lấy danh sách file media trong thư mục cụ thể' },
      { module: 'Media Gateway', method: 'POST', path: '/api/v1/apps/:appId/media/signature', desc: 'Sinh chữ ký upload an toàn trực tiếp từ client lên Cloudinary' },
      { module: 'Media Gateway', method: 'DELETE', path: '/api/v1/apps/:appId/media/resources', desc: 'Xóa tài nguyên media theo public_id' },
      { module: 'Notifications', method: 'POST', path: '/api/v1/apps/:appId/notifications/subscribe', desc: 'Đăng ký nhận Web Push subscription theo user' },
      { module: 'Notifications', method: 'GET', path: '/api/v1/apps/:appId/notifications', desc: 'Lấy danh sách thông báo của user' },
      { module: 'Notifications', method: 'POST', path: '/api/v1/apps/:appId/notifications/send', desc: 'Gửi Web Push notification đến danh sách user mục tiêu' },
      { module: 'Mail', method: 'POST', path: '/api/v1/apps/:appId/mail/send', desc: 'Đưa vào hàng đợi và gửi mail giao dịch' },
      { module: 'Mail', method: 'GET', path: '/api/v1/apps/:appId/mail/templates', desc: 'Lấy danh sách template mail khả dụng cho app' },
      { module: 'Mail', method: 'GET', path: '/api/v1/apps/:appId/mail/inbox/messages', desc: 'Lấy danh sách thư đến trong hộp thư của app' },
      { module: 'Import / Export', method: 'POST', path: '/api/v1/apps/:appId/import/preview', desc: 'Phân tích và kiểm tra file import mà không ghi dữ liệu' },
      { module: 'Import / Export', method: 'POST', path: '/api/v1/apps/:appId/import/execute', desc: 'Thực thi job import đã được xác nhận' },
      { module: 'Import / Export', method: 'POST', path: '/api/v1/apps/:appId/export/:module', desc: 'Export dữ liệu module dưới dạng job nền' }
    ]
  }
}
