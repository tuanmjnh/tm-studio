// `@tuanmjnh/tm-ui` ships precompiled components (dist/*.js) that resolve their
// UI primitives with `resolveComponent('UBadge' | 'UIcon' | ...)`. Nuxt only
// injects auto-imports into files it compiles itself, so for that package the
// lookup falls through to the app's global registry. Without these
// registrations the primitives render as empty `<ubadge>` / `<uselectmenu>`
// custom elements while the build and typecheck stay green.
import { UBadge, UIcon, UButton, USelectMenu, UTooltip, UPopover } from '#components'

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.component('UBadge', UBadge)
  nuxtApp.vueApp.component('UIcon', UIcon)
  nuxtApp.vueApp.component('UButton', UButton)
  nuxtApp.vueApp.component('USelectMenu', USelectMenu)
  nuxtApp.vueApp.component('UTooltip', UTooltip)
  nuxtApp.vueApp.component('UPopover', UPopover)
})
