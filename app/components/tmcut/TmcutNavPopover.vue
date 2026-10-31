<script setup lang="ts">
import type { RouteTreeNode } from '#shared/types/rbac'

const route = useRoute()
const { t } = useI18n()
const colorMode = useColorMode()
const nav = useNavMenu()
const isNavOpen = ref(false)

interface StudioLink {
  label: string
  to: string
  icon: string
}

type StudioRouteNode = Pick<RouteTreeNode, 'path' | 'name' | 'label' | 'icon' | 'isVisible'> & {
  readonly children?: readonly StudioRouteNode[]
}

function collectLinks(nodes: readonly StudioRouteNode[], out: StudioLink[] = []): StudioLink[] {
  for (const node of nodes) {
    if (node.isVisible === false || node.name === 'settings') continue
    if (node.path && node.path !== '/') {
      out.push({
        label: nav.translateRouteLabel(node.label, node.name) || node.path,
        to: node.path,
        icon: node.icon || 'i-lucide-circle'
      })
    }
    if (node.children?.length) collectLinks(node.children, out)
  }
  return out
}

const links = computed(() => collectLinks(nav.allowedRoutes.value))
const workspaceLinks = computed(() => links.value.filter(link => link.to === '/tmcut' || link.to.startsWith('/tmcut/')))
const resourceLinks = computed(() => links.value.filter(link => link.to.startsWith('/resources/')))
const systemLinks = computed(() => links.value.filter(link => link.to.startsWith('/system/')))

const currentLabel = computed(() => {
  const exact = links.value.find(link => link.to === route.path)
  if (exact) return exact.label
  return workspaceLinks.value.find(link => link.to === '/tmcut')?.label ?? t('studio.nav.workspace')
})

const isDark = computed(() => colorMode.value === 'dark')

function toggleTheme() {
  colorMode.preference = isDark.value ? 'light' : 'dark'
}
</script>

<template>
  <UPopover
    v-model:open="isNavOpen"
    :content="{ align: 'start', side: 'bottom', sideOffset: 8 }"
    :ui="{ content: 'w-[min(36rem,calc(100vw-1.5rem))] max-h-[min(34rem,calc(100vh-5rem))] overflow-y-auto glass-surface p-4 z-50' }"
  >
    <UButton
      color="neutral"
      variant="ghost"
      size="sm"
      square
      class="rounded-xl border border-default bg-elevated/60 hover:bg-primary/10 hover:border-primary/40"
      :aria-label="t('studio.nav.openMenu')"
      :title="currentLabel"
    >
      <UIcon
        name="i-lucide-menu"
        class="size-4 transition-colors"
        :class="isNavOpen ? 'text-primary' : 'text-muted'"
      />
    </UButton>

    <template #content>
      <div class="grid grid-cols-1 sm:grid-cols-12 gap-4">
        <div class="sm:col-span-7 min-w-0 space-y-2 sm:border-r border-default sm:pr-3">
          <div class="flex items-center justify-between px-2 pb-1">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-primary">
              {{ t('studio.nav.workspace') }}
            </span>
            <NuxtLink
              to="/"
              class="text-[11px] text-muted hover:text-highlighted flex items-center gap-1 transition-colors"
              @click="isNavOpen = false"
            >
              <UIcon name="i-lucide-home" class="size-3" />
              <span>{{ t('studio.nav.home') }}</span>
            </NuxtLink>
          </div>

          <div class="grid grid-cols-1 gap-1">
            <NuxtLink
              v-for="item in workspaceLinks"
              :key="item.to"
              :to="item.to"
              class="group flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs transition-all duration-150 border"
              :class="route.path === item.to
                ? 'bg-primary/15 text-highlighted border-primary/40'
                : 'text-toned hover:bg-muted hover:text-highlighted border-transparent'"
              @click="isNavOpen = false"
            >
              <div
                class="size-7 rounded-lg flex items-center justify-center shrink-0 border transition-colors"
                :class="route.path === item.to
                  ? 'bg-primary/20 border-primary/40 text-primary'
                  : 'bg-muted border-default text-primary group-hover:border-primary/30'"
              >
                <UIcon :name="item.icon" class="size-4" />
              </div>
              <span class="font-medium truncate">{{ item.label }}</span>
            </NuxtLink>
          </div>
        </div>

        <div class="sm:col-span-5 min-w-0 flex flex-col justify-between">
          <div class="space-y-3">
            <div v-if="resourceLinks.length">
              <p class="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-dimmed">
                {{ $t('nav.resources') }}
              </p>
              <div class="space-y-0.5">
                <NuxtLink
                  v-for="item in resourceLinks"
                  :key="item.to"
                  :to="item.to"
                  class="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors"
                  :class="route.path === item.to
                    ? 'bg-primary/10 text-highlighted'
                    : 'text-muted hover:bg-muted hover:text-highlighted'"
                  @click="isNavOpen = false"
                >
                  <UIcon :name="item.icon" class="size-3.5 text-dimmed" />
                  <span class="truncate">{{ item.label }}</span>
                </NuxtLink>
              </div>
            </div>

            <div v-if="systemLinks.length">
              <p class="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-dimmed">
                {{ $t('nav.system') }}
              </p>
              <div class="space-y-0.5">
                <NuxtLink
                  v-for="item in systemLinks"
                  :key="item.to"
                  :to="item.to"
                  class="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors"
                  :class="route.path === item.to
                    ? 'bg-primary/10 text-highlighted'
                    : 'text-muted hover:bg-muted hover:text-highlighted'"
                  @click="isNavOpen = false"
                >
                  <UIcon :name="item.icon" class="size-3.5 text-dimmed" />
                  <span class="truncate">{{ item.label }}</span>
                </NuxtLink>
              </div>
            </div>
          </div>

          <div class="pt-2.5 border-t border-default flex items-center justify-end px-2">
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              :icon="isDark ? 'i-lucide-moon' : 'i-lucide-sun'"
              :aria-label="t('studio.nav.toggleTheme')"
              @click="toggleTheme"
            />
          </div>
        </div>
      </div>
    </template>
  </UPopover>
</template>
