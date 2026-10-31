// tmcut-core is linted with the tm-studio root flat config as the single
// source of truth. Run from tm-studio: pnpm lint:core
import { createRequire } from 'node:module'
import base from '../../eslint.config.mjs'

// The base config's TS parser block does not reach workspace packages,
// so assign the same parser explicitly for our TypeScript sources.
// Resolved from the workspace root store (this package stays
// dependency-free). pnpm keeps transitive deps under version-pinned
// store dirs, so locate the parser dynamically instead of hardcoding
// its path.
import { readdirSync } from 'node:fs'

function resolveTsParser() {
  const store = new URL('../../node_modules/.pnpm/', import.meta.url)
  const match = readdirSync(store).find(name => name.startsWith('@typescript-eslint+parser@'))
  if (!match) throw new Error('cannot locate @typescript-eslint/parser in workspace store')
  const anchor = new URL(`../../node_modules/.pnpm/${match}/node_modules/@typescript-eslint/parser/package.json`, import.meta.url)
  return createRequire(anchor)('@typescript-eslint/parser')
}

const tsParser = resolveTsParser()

export default base.append({
  files: ['types/**/*.ts', 'src/**/*.d.ts'],
  languageOptions: {
    parser: tsParser
  },
  rules: {
    // Ambient declarations never "use" their parameters; the tsc
    // noUnusedParameters check (tsconfig.check.json) is the real guard.
    'no-unused-vars': 'off'
  }
})
