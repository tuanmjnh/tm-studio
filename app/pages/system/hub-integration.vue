<script setup lang="ts">
import { getErrorMessage } from '~/shared/utils/errors'

definePageMeta({
  alias: ['/system/hub-config', '/system/hub-data']
})

const { t } = useI18n()
const notify = useNotify()
const { hubUrl, appId, hubFetch, client } = useHub()
const auth = useAuth()
const { copy } = useClipboard()

const title = computed(() => t('nav.hub_integration'))
const description = computed(() => t('hub_integration.desc'))

useHead({ title })

// Live testing state
const testing = ref(false)
const testResults = ref<{
  health: { ok: boolean, latencyMs?: number, data?: unknown, error?: string }
  configs: { ok: boolean, count?: number, error?: string }
  routes: { ok: boolean, count?: number, error?: string }
  docs: { ok: boolean, version?: number, error?: string }
} | null>(null)

const copiedKey = ref('')
async function copyCode(key: string, code: string) {
  await copy(code)
  copiedKey.value = key
  setTimeout(() => {
    if (copiedKey.value === key) copiedKey.value = ''
  }, 1500)
}

async function runLiveTest() {
  testing.value = true
  testResults.value = {
    health: { ok: false },
    configs: { ok: false },
    routes: { ok: false },
    docs: { ok: false }
  }

  // 1. Test Health / Ping
  const t0 = Date.now()
  try {
    const res = await $fetch<{ success?: boolean, status?: string }>(`${hubUrl}/api/v1/health`, {
      headers: { 'X-App-Id': appId }
    })
    testResults.value.health = { ok: true, latencyMs: Date.now() - t0, data: res }
  } catch (err) {
    testResults.value.health = { ok: false, error: getErrorMessage(err, k => t(k)) }
  }

  // 2. Test Public Configs
  try {
    const res = await client.configs.getPublic(appId)
    const keysCount = Object.keys(res.data || {}).length
    testResults.value.configs = { ok: true, count: keysCount }
  } catch (err) {
    testResults.value.configs = { ok: false, error: getErrorMessage(err, k => t(k)) }
  }

  // 3. Test Dynamic Routes
  try {
    const res = await hubFetch<{ success: boolean, data: unknown[] }>(`/api/v1/apps/${encodeURIComponent(appId)}/routes`)
    testResults.value.routes = { ok: true, count: Array.isArray(res.data) ? res.data.length : 0 }
  } catch (err) {
    testResults.value.routes = { ok: false, error: getErrorMessage(err, k => t(k)) }
  }

  // 4. Test Dynamic Docs from Hub
  try {
    const res = await hubFetch<{ success: boolean, data: { version: number } }>(`/api/v1/apps/${encodeURIComponent(appId)}/docs`)
    testResults.value.docs = { ok: true, version: res.data?.version }
  } catch (err) {
    testResults.value.docs = { ok: false, error: getErrorMessage(err, k => t(k)) }
  }

  testing.value = false
  notify.success(t('common.success'), t('hub_integration.test_success'))
}

const envSnippet = `# tm-tools/.env - Cấu hình kết nối Control Plane
PORT=4002
APP_PORT=3456
AUTH_PROVIDER=hub

# 1. URL của TM Hub (chạy local trên 4000 hoặc URL triển khai cloud)
NUXT_PUBLIC_HUB_URL=${hubUrl}

# 2. Định danh AppId đã đăng ký trong bảng apps của TM Hub
NUXT_PUBLIC_HUB_APP_ID=${appId}

# 3. Khóa bí mật JWT dùng chung (phải trùng khớp với AUTH_JWT_SECRET của Hub)
AUTH_JWT_SECRET=24481429ddef2654285b4906225e7f159e6d08a58105dd1231da4d5d07af90d5`

const codeUseHubSnippet = `import { useHub } from '~/composables/useHub'

// 1. Khởi tạo composable (tự động đính kèm X-App-Id và Bearer Token)
const { hubFetch, appId, client } = useHub()

// 2. Tải danh sách menu routes động theo quyền RBAC của user
const routesResponse = await hubFetch(\`/api/v1/apps/\${appId}/routes\`)

// 3. Lấy cấu hình công khai (public configs)
const publicConfigs = await client.configs.getPublic(appId)

// 4. Lấy tài liệu & nội dung động (được TM Hub quản lý trên MongoDB)
const docsResponse = await hubFetch(\`/api/v1/apps/\${appId}/docs\`)

// 5. Lấy danh sách kết nối dịch vụ bên thứ ba (AI, Cloudinary, Mail)
const connections = await client.connections.list(appId)`

const codeNavMenuSnippet = `// Tải động Navigation Tree trong tm-tools (app/composables/useNavMenu.ts)
export function useNavMenu() {
  const { hubFetch, appId } = useHub()
  const routes = ref([])

  async function fetchRoutes() {
    const res = await hubFetch(\`/api/v1/apps/\${appId}/routes\`)
    if (res.success && Array.isArray(res.data)) {
      // Lọc các route được phép hiển thị
      routes.value = res.data.filter(r => r.is_visible !== false)
    }
  }

  return { routes, fetchRoutes }
}`

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  {
    icon: 'i-lucide-activity',
    label: t('hub_integration.test_hub'),
    primary: true,
    disabled: testing.value,
    onSelect: runLiveTest
  }
]))
</script>

<template>
  <BasePage id="hub-integration" :title="title" :description="description">
    <template #right>
      <div class="flex items-center gap-2">
        <UButton
          icon="i-lucide-book-open"
          :label="t('hub_integration.api_docs')"
          variant="ghost"
          color="neutral"
          size="sm"
          to="/system/docs"
        />
        <UButton
          icon="i-lucide-activity"
          :label="t('hub_integration.test_hub')"
          color="primary"
          variant="soft"
          size="sm"
          :loading="testing"
          @click="runLiveTest"
        />
      </div>
    </template>

    <div class="space-y-6 max-w-6xl pb-24 lg:pb-8">
      <!-- 1. Live Connection Overview Card -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-radio-tower" class="w-5 h-5 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('hub_integration.live_status') }}</h3>
            </div>
            <UBadge
              :label="auth.isAuthenticated.value ? t('hub_integration.authenticated') : t('hub_integration.guest')"
              :color="auth.isAuthenticated.value ? 'success' : 'neutral'"
              variant="subtle"
              size="xs"
            />
          </div>
        </template>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div class="rounded-xl border border-default p-4 bg-elevated/40 space-y-1">
            <span class="text-xs text-muted font-medium">{{ t('hub_integration.hub_url') }}</span>
            <p class="text-sm font-semibold font-mono text-primary truncate">{{ hubUrl }}</p>
          </div>
          <div class="rounded-xl border border-default p-4 bg-elevated/40 space-y-1">
            <span class="text-xs text-muted font-medium">{{ t('hub_integration.satellite_app_id') }}</span>
            <p class="text-sm font-semibold font-mono text-highlighted truncate">{{ appId }}</p>
          </div>
          <div class="rounded-xl border border-default p-4 bg-elevated/40 space-y-1">
            <span class="text-xs text-muted font-medium">{{ t('hub_integration.auth_method') }}</span>
            <p class="text-sm font-semibold font-mono text-highlighted truncate">JWT Bearer + X-App-Id</p>
          </div>
        </div>

        <!-- Live Test Results (if run) -->
        <div v-if="testResults" class="mt-4 pt-4 border-t border-default space-y-3">
          <span class="text-xs font-semibold text-highlighted block">{{ t('hub_integration.test_results_title') }}</span>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div class="p-3 rounded-lg border border-default space-y-1 text-xs">
              <div class="flex items-center justify-between">
                <span class="text-muted">1. Hub Health</span>
                <UIcon :name="testResults.health.ok ? 'i-lucide-check-circle' : 'i-lucide-x-circle'" :class="testResults.health.ok ? 'text-success' : 'text-error'" />
              </div>
              <p class="font-mono font-medium truncate">{{ testResults.health.ok ? `${testResults.health.latencyMs}ms` : t('hub_integration.conn_error') }}</p>
            </div>

            <div class="p-3 rounded-lg border border-default space-y-1 text-xs">
              <div class="flex items-center justify-between">
                <span class="text-muted">2. Public Configs</span>
                <UIcon :name="testResults.configs.ok ? 'i-lucide-check-circle' : 'i-lucide-x-circle'" :class="testResults.configs.ok ? 'text-success' : 'text-error'" />
              </div>
              <p class="font-mono font-medium truncate">{{ testResults.configs.ok ? t('hub_integration.configs_count', { count: testResults.configs.count }) : t('hub_integration.cannot_load') }}</p>
            </div>

            <div class="p-3 rounded-lg border border-default space-y-1 text-xs">
              <div class="flex items-center justify-between">
                <span class="text-muted">3. Dynamic Routes</span>
                <UIcon :name="testResults.routes.ok ? 'i-lucide-check-circle' : 'i-lucide-x-circle'" :class="testResults.routes.ok ? 'text-success' : 'text-error'" />
              </div>
              <p class="font-mono font-medium truncate">{{ testResults.routes.ok ? t('hub_integration.routes_count', { count: testResults.routes.count }) : t('hub_integration.cannot_load') }}</p>
            </div>

            <div class="p-3 rounded-lg border border-default space-y-1 text-xs">
              <div class="flex items-center justify-between">
                <span class="text-muted">4. Dynamic Docs</span>
                <UIcon :name="testResults.docs.ok ? 'i-lucide-check-circle' : 'i-lucide-x-circle'" :class="testResults.docs.ok ? 'text-success' : 'text-error'" />
              </div>
              <p class="font-mono font-medium truncate">{{ testResults.docs.ok ? `v${testResults.docs.version || 1} (Live)` : t('hub_integration.fallback_version') }}</p>
            </div>
          </div>
        </div>
      </UCard>

      <!-- 2. Step 1: Environment Configuration -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-sliders" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('hub_integration.step1_title') }}</h3>
            </div>
            <UButton
              :icon="copiedKey === 'env' ? 'i-lucide-check' : 'i-lucide-copy'"
              variant="ghost"
              color="neutral"
              size="xs"
              :label="t('hub_integration.copy_env')"
              @click="copyCode('env', envSnippet)"
            />
          </div>
        </template>
        <div class="space-y-3">
          <p class="text-xs text-muted leading-relaxed">
            {{ t('hub_integration.step1_desc') }} <code class="font-mono text-primary font-semibold">d:\Applications\tm-tools\.env</code>:
          </p>
          <div class="overflow-hidden rounded-lg bg-neutral-900 text-neutral-100">
            <pre class="p-4 text-xs font-mono overflow-x-auto leading-relaxed"><code>{{ envSnippet }}</code></pre>
          </div>
        </div>
      </UCard>

      <!-- 3. Step 2: How Data is Loaded dynamically -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-database" class="w-4 h-4 text-primary" />
            <h3 class="font-semibold text-sm">{{ t('hub_integration.step2_title') }}</h3>
          </div>
        </template>

        <div class="space-y-4">
          <p class="text-xs text-muted leading-relaxed">
            {{ t('hub_integration.step2_desc') }} <code class="font-mono text-primary">useHub()</code>:
          </p>

          <div class="overflow-hidden rounded-lg bg-neutral-900 text-neutral-100">
            <div class="flex items-center justify-between border-b border-white/10 px-4 py-1.5">
              <span class="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">TypeScript / Vue Composable</span>
              <UButton
                :icon="copiedKey === 'useHub' ? 'i-lucide-check' : 'i-lucide-copy'"
                variant="ghost"
                color="neutral"
                size="xs"
                @click="copyCode('useHub', codeUseHubSnippet)"
              />
            </div>
            <pre class="p-4 text-xs font-mono overflow-x-auto leading-relaxed"><code>{{ codeUseHubSnippet }}</code></pre>
          </div>

          <!-- Feature Breakdown Grid -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
            <div class="p-3.5 rounded-lg border border-default space-y-2">
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-route" class="w-4 h-4 text-emerald-500" />
                <h4 class="text-xs font-bold text-highlighted">{{ t('hub_integration.feature_routes_title') }}</h4>
              </div>
              <p class="text-xs text-muted leading-relaxed">
                {{ t('hub_integration.feature_routes_desc') }}
              </p>
            </div>

            <div class="p-3.5 rounded-lg border border-default space-y-2">
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-settings-2" class="w-4 h-4 text-sky-500" />
                <h4 class="text-xs font-bold text-highlighted">{{ t('hub_integration.feature_configs_title') }}</h4>
              </div>
              <p class="text-xs text-muted leading-relaxed">
                {{ t('hub_integration.feature_configs_desc') }}
              </p>
            </div>

            <div class="p-3.5 rounded-lg border border-default space-y-2">
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-book-open" class="w-4 h-4 text-violet-500" />
                <h4 class="text-xs font-bold text-highlighted">{{ t('hub_integration.feature_docs_title') }}</h4>
              </div>
              <p class="text-xs text-muted leading-relaxed">
                {{ t('hub_integration.feature_docs_desc') }}
              </p>
            </div>

            <div class="p-3.5 rounded-lg border border-default space-y-2">
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-plug" class="w-4 h-4 text-amber-500" />
                <h4 class="text-xs font-bold text-highlighted">{{ t('hub_integration.feature_connections_title') }}</h4>
              </div>
              <p class="text-xs text-muted leading-relaxed">
                {{ t('hub_integration.feature_connections_desc') }}
              </p>
            </div>
          </div>
        </div>
      </UCard>

      <!-- 4. Step 3: Navigation Menu Loading Deep-Dive -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-code-xml" class="w-4 h-4 text-primary" />
              <h3 class="font-semibold text-sm">{{ t('hub_integration.step3_title') }}</h3>
            </div>
            <UButton
              :icon="copiedKey === 'nav' ? 'i-lucide-check' : 'i-lucide-copy'"
              variant="ghost"
              color="neutral"
              size="xs"
              :label="t('common.copy')"
              @click="copyCode('nav', codeNavMenuSnippet)"
            />
          </div>
        </template>
        <div class="space-y-3">
          <p class="text-xs text-muted leading-relaxed">
            {{ t('hub_integration.step3_desc') }}
          </p>
          <div class="overflow-hidden rounded-lg bg-neutral-900 text-neutral-100">
            <pre class="p-4 text-xs font-mono overflow-x-auto leading-relaxed"><code>{{ codeNavMenuSnippet }}</code></pre>
          </div>
        </div>
      </UCard>
    </div>
  </BasePage>
</template>
