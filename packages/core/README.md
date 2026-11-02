# tmcut-core

Pure TMCut editing engine — Phase 1 of the TMCut Architecture v3 spec.
The `docs §N` references in this package point into that spec, which is not
tracked here (it lives in tm-tools, archived under
`docs/archive/2026-10-31-v1-pre-tmcut-extraction/`).

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
`types/` (Timeline DSL v3 types, versioned with the engine — they are not a
second package and have no second name).
`src/index.d.ts` binds the types to the engine API; consistency is enforced
by `tsconfig.check.json` (`pnpm typecheck:core`).

`src/` is the artifact every host in this repository reads: the app and the
tests through the `tmcut-core` alias, the Electron main process by relative
path, and `electron-builder.yml` ships the whole `src/` tree. `dist/` is only
what `pnpm build && pnpm publish` sends to npm, so it may lag `src` and must
never be a source dependency (docs `v4-phase-0-audit.md`, ADR-022).
