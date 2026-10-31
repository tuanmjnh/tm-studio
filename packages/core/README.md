# @tmcut/core

Pure TMCut editing engine — Phase 1 of docs/TMCut Architecture v3.md.

- Zero dependencies. Runs on plain Node: `node --test test/`
- No Vue / Nuxt / Electron / Node builtins / browser globals.
  Enforced by `node tools/check-boundaries.mjs` (docs §57).
- Time base: integer ticks, `TICKS_PER_SECOND = 120_000` (docs §2).
  Ticks are `number`, not `bigint`, so projects stay JSON-serializable
  (project files, localStorage, IPC). Precision holds far beyond any
  editable duration.
- Ports (behavior-identical, covered by tests): `app/utils/tmcut/media.ts`,
  `recovery.ts`, `waveform.ts`; timeline add/split/move/trim math mirrors
  `useTmcutProject` but computes in ticks on DSL v3 objects.

Layout: `src/` (engine) · `test/` (node:test) · `tools/` (arch checks) ·
`types/` (Timeline DSL v3 types — logical `@tmcut/types`, versioned together).
`src/index.d.mts` binds the types to the engine API; consistency is enforced
by `tsconfig.check.json` (`pnpm typecheck:core`).
