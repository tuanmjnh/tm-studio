# ADR-034 — tm-cut-core is consumed from its published `dist`

Supersedes **ADR-022** (one artifact: `src` for every host).

Date: 2026-11-16
Status: **applied**

## Context

ADR-022 chose `src` as the single artifact every host reads, and ruled out
"build `dist` first" because a build step does not prove `dist == src` — G13 had
measured a `dist` that silently lagged by a whole release.

That decision assumed the engine lived in this repo and was reached through a
Vite alias. Both facts changed:

- The engine moved to `tm-platform/packages/tm-cut-core` and is installed from
  npm like every other shared package.
- The published tarball is **the contents of `dist`**. There is no `src` inside
  an installed copy, so the alias `'tm-cut-core' → node_modules/@tuanmjnh/tm-cut-core/dist/index.js`
  resolves to a file that does not exist.

Measured on the registry install (`tm-cut-core@0.1.1`):

```
$ pnpm build
[UNLOADABLE_DEPENDENCY] Could not load node_modules/@tuanmjnh/tm-cut-core/dist/index.js
  app/pages/tmcut/editor.vue:27  import { instantiateTemplate } from "tm-cut-core"
```

Copying `src` into the installed package to keep the alias working made it
worse, not better — `src` is `.mjs` with no declarations beside it:

```
TS7016: Could not find a declaration file for module 'tm-cut-core'
  8 files, all implicit any
```

The package itself is fine. In plain Node, `import('tm-cut-core')` returns 433
exports, and both subpaths resolve: `tm-cut-core/generationAdapter` (11),
`tm-cut-core/providerAdapter` (6).

## Decision

**`dist` is the artifact.** The package `exports` map is the only entry point;
this repo keeps no alias, and the app, the tests and the Electron main process
all resolve the package by name.

ADR-022's reopen condition was written for exactly this case: *"if the app
really uses the published npm build, a gate comparing `dist` with `src` is
needed."* That gate exists now and is stronger than the alias was:

| Concern ADR-022 raised | How it is answered now |
|---|---|
| `dist` silently lags `src` | `dist` is what npm published; there is no second copy to lag behind |
| "a build step does not prove equality" | no build step — the installed artifact **is** the released one |
| two copies of one engine | one resolution path (package exports); no alias, no `src` beside it |

## What changed

| Surface | Before (ADR-022) | Now |
|---|---|---|
| App + tests | alias → `src/index.mjs` | `import … from 'tm-cut-core'` |
| Electron main | relative path to `src/*.mjs` | relative path to the packaged `*.js` |
| Packaging | `node_modules/@tuanmjnh/tm-cut-core/src/**/*` | `node_modules/@tuanmjnh/tm-cut-core/**/*` |
| `tsconfig.test.json` | `paths['tm-cut-core']` | no entry; Node resolution applies |

## Specs that read engine source

Six specs read one engine module's text to assert something about *that*
module (no wall clock in the scheduler, no Node builtin anywhere, the content
law refuses a blend mode by name). The bundle keeps one `// src/<name>.mjs`
banner per module, so a slice between banners returns exactly the bytes those
specs used to read:

```
$ node -e "…slice src/scheduler.mjs…"
scheduler slice length: 2124
has evaluateTimeline: true
has Date.now: false
```

`tests/unit/helpers/core-module.ts` does that slicing, so the assertions keep
their meaning rather than weakening to "somewhere in the bundle".

Two assertions did change shape and are worth naming:

- **"the core has one name: alias equals package name"** — there is no alias
  now, so the guard asserts the stronger fact: nothing configures a path for
  the package, and `import … from 'tm-cut-core'` resolves inside `node_modules`.
- **"no core module imports a Node builtin"** — scans the one bundle instead of
  62 files. Same rule, coarser granularity, no loss.

## Consequences

- `tm-cut-core` must be published before this app can build. That is the normal
  contract for a library dependency, and it removes "which copy is running?"
  from the set of possible bugs.
- A change to the engine reaches the app by `pnpm add tm-cut-core@<version>`,
  not by editing a sibling checkout. Slower to iterate, and the reason `link:`
  existed — but `link:` is what confined tm-cut-core to one consumer while the
  other two packages shipped.
- The 11-assertion guard in `tmcut_core_source.spec.ts` keeps its purpose
  (one name, one artifact, no path outside the repo); four of its assertions
  were rewritten to name the new mechanism, none were removed.
