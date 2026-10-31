// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  rules: {
    'vue/no-multiple-template-root': 'off',
    'vue/max-attributes-per-line': ['error', { singleline: 3 }],
    'tailwindcss/enforces-shorthand': 'off'
  }
}, {
  // E2E/QA harnesses poke dev-only `window` hooks from page.evaluate
  // callbacks that have no ambient types — `any` is intentional there.
  files: ['tests/**/*.mts', 'tests/e2e/**/*.cjs'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off'
  }
})
