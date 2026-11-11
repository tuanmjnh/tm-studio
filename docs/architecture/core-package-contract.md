# `tmcut-core` as a package: what a consumer can rely on

Status: **technical note, measured 2026-11-11**. This records how `tmcut-core` is resolved today
by each consumer, what is stable, and what would have to change before any second package could
depend on it. It is the prerequisite that
[package-boundaries.md](file:///D:/Applications/tm-studio/docs/architecture/package-boundaries.md)
§2.2 names, and it authorises no code change.

The measurement behind it: `docs/audit/repository-package-architecture-audit.md` §2 and §15.

---

## 1. What exists

| Question | Answer | Evidence |
|---|---|---|
| What is the package called? | `tmcut-core` | `packages/core/package.json:2` |
| Is it published? | No publish has happened; `files: ["dist"]` is the npm surface | `packages/core/package.json:27-29` |
| Is it installed as a dependency? | **No, deliberately.** Neither `dependencies` nor `devDependencies` names it | `package.json:38-82`; guard at `tests/unit/tmcut_core_source.spec.ts:235-241` |
| Does `dist/` exist on this machine? | Yes, and it is **not** a source dependency. gitignored; no source file may resolve into it | `tests/unit/tmcut_core_source.spec.ts:80` |
| How many modules? | 63 `.mjs` on disk, of which 62 are re-exported by the barrel (two appear twice); 432 named exports | `packages/core/src/index.mjs` |

The consequence that matters for every row below: `tmcut-core` is consumed **as source**, not as a
built artifact. Anything that changes where that source is found is a change to all four consumers
at once.

## 2. Public exports

| Entry | Target | Consumers |
|---|---|---|
| `tmcut-core` (bare) | `packages/core/src/index.mjs` via alias, or `dist/index.js` if resolved as a package | app (63 files), tests (35 specs), Electron by relative path |
| `./generationAdapter` | `src/generationAdapter.mjs` | `electron/tools/video-generation/controller.mjs:25` |
| `./providerAdapter` | `src/providerAdapter.mjs` | `electron/tools/video-generation/controller.mjs:30` |

Subpath imports through the **alias** are forbidden and guarded: a Vite object alias is a prefix, so
`tmcut-core/foo` would resolve to `.../index.mjs/foo`, a path that cannot exist
(`tests/unit/tmcut_core_source.spec.ts:261`). `./generationAdapter` is therefore reached by relative
path from Electron, never by alias subpath.

## 3. Resolution, per consumer — the eight answers

This is the table a second package would have to satisfy. Each row is today's mechanism, measured.

| # | Concern | Mechanism today | Stable for a second package? |
|---|---|---|---|
| 1 | **Workspace identity** | one workspace glob, `packages/*`; exactly one member | yes |
| 2 | **Public exports** | barrel + two subpath entries (§2) | yes, guarded |
| 3 | **Workspace dependency resolution** | *not used.* The `file:` dependency was removed (ADR-022/G13); nothing imports the scoped name | **no** — a second package there would need either the retired dependency or a relative hop |
| 4 | **Build order** | none needed: every consumer reads `src/`. `pnpm build:core` exists only for npm | yes, because nothing depends on the build |
| 5 | **TypeScript declarations** | `src/index.d.ts` + `types/`, checked by `tsc --noEmit -p packages/core/tsconfig.check.json`; `dist/*.d.ts` produced by `prepare-dist.mjs` for npm only | yes for consumers that use the alias path |
| 6 | **Nuxt/Vite alias** | `nuxt.config.ts:21` (Nuxt) and `:107` (Vite), both → `packages/core/src/index.mjs` | yes for files under `app/` |
| 7 | **Node test resolution** | `tsconfig.test.json` `paths: { "tmcut-core": ["./packages/core/src/index.mjs"] }` | yes for specs; **no** for a `.ts` module outside the alias |
| 8 | **Electron consumer** | relative path `../../../packages/core/src/*.mjs`; the packaging closure is asserted by `tests/unit/tmcut_core_source.spec.ts:252` | yes, guarded |

## 4. The two facts that decide a second package

**(a) The alias does not reach into a new package.** `nuxt.config.ts` maps the exact string
`tmcut-core` to one file. A module at `packages/media-core/*.ts` that writes `import … from
'tmcut-core'` is not covered by that mapping, is not in `tsconfig.test.json`'s `paths`, and cannot
resolve through `node_modules` because the package is deliberately uninstalled. It would require
one of: the retired `file:` dependency (which re-opens G13), a relative hop across a package
boundary, or a new alias entry per package — and each is a new mechanism, not an existing one.

**(b) The app's typecheck program does not include `packages/`.** `.nuxt/tsconfig.app.json` carries
the `tmcut-core` **path mapping** in its `paths`, but its 19-entry `include` array lists `../app/**`,
`../shared/**.d.ts`, `../i18n/**` and Nuxt-generated files — **not** `../packages/**`. That file is
generated and gitignored, so it is cited by key name rather than by line. A `.ts` module moved under
`packages/` therefore leaves the program that `nuxt typecheck` runs. Core escapes this today because
it is `.mjs`, consumed through the mapping and checked by its own `tsconfig.check.json`.

## 5. What would have to be true before extraction

Ordered by dependency, not preference. None of these is authorised by this note.

1. **A browser decode proof exists.** Done — `tests/e2e/browser_media_integration.mts` measures
   probe, capability, three distinct frames, PCM, error and cancel behaviour in a real Chromium.
   See §6 for what it does not cover.
2. **A dependency mechanism a package can use is chosen and regression-tested.** Either the
   consumers agree on a package specifier that resolves in Nuxt, Vite, plain Node and Electron, or
   the "source by relative path" model is kept and no package boundary is drawn. The current
   mechanism serves one package and would have to be extended, not reused.
3. **Type checking covers package sources.** Either `packages/**` joins the app program, or every
   package carries its own `tsconfig` and CI runs each, and the app's declarations come from the
   package's `dist/*.d.ts` rather than from `src/`.
4. **The 27 path occurrences are preserved or migrated by approval.** They are the guards that keep
   one module per responsibility (`tmcut_frame_service.spec.ts:419-431`,
   `tmcut_media_probe.spec.ts:354-375`). A move breaks 23 of them — 17 literals and 6 import
   specifiers; the other 4 are prose comments. Editing them to follow a move converts a regression
   guard into a description of wherever the file happens to live.
5. **The move buys something measurable** — a second consumer, an independent publish, or a build
   that can be tested alone. Relocating four modules inside one app buys none of these.

## 6. What the browser check proves, and what it does not

Proven, in Chromium, against the real modules: probe reads a container; WebCodecs is present and
core reports 6 capability keys; start/middle/end decode to three byte-distinct PNGs; a generated WAV
decodes to 8000 Hz mono PCM at the authored amplitude (0.366 ≈ 12000/32768); a corrupt container
answers `null`; an aborted ask returns `null` on both seams.

The harness also builds a **multi-packet Opus stream in the page** — `AudioBufferSource` over the
mediabunny the app already depends on, so no new dependency and no committed fixture — and ranges it
five ways. Its four blocks descend 0.8 / 0.4 / 0.2 / 0.1, which is what makes the measurement
discriminating: an untrimmed head leaks the louder block before the ask and the head amplitude
doubles. Measured on 2026-11-11 in Edge: all five ranges start at the block they asked for
(0.81 / 0.40 / 0.80 / 0.20 / 0.20 against 0.8 / 0.4 / 0.8 / 0.2 / 0.2), and every answer runs 3–13 ms
past its ask — never more than one packet. Removing `pcmHeadTrim` from a scratch copy fails two of
the five, so the check tests the trim rather than the decoder.

Not proven by it:

- **Tail trimming.** There is none, by design: `decodePcm` trims the head only, and the harness now
  asserts the tail overrun stays inside one packet rather than pretending it is exact. A consumer
  that needs sample-exact ends would need a tail law this seam does not have.
- **Audio from a committed container fixture.** All four `tests/fixtures/containers/*` are
  video-only, so that check reports a declared SKIP rather than a pass. The multi-packet stream is
  built at run time instead of committed.
- **AAC.** The in-page fixture encodes Opus, the one lossy codec this browser will encode. AAC would
  need a committed file and an encoder the browser does not offer.
- **The Electron renderer.** The check runs in a Chromium launched by `playwright-core`; the packaged
  app is a separate runtime.
- **CI.** The repository has no CI configuration, so this runs where a browser and a dev server
  exist and reports SKIP elsewhere. When a CI job is added, set `TMCUT_BROWSER_REQUIRED=1` in it:
  the harness then exits non-zero on a skip instead of green over nothing. That switch is
  regression-tested by `tests/unit/tmcut_browser_harness.spec.ts`, which runs the harness against a
  dead port and asserts both outcomes.

## 7. Restart conditions for the `media-core` extraction

All five, in this order. Until then `packages/media-core` is `BLOCKED / DEFERRED`, not failed.

1. The browser integration check runs green in the environment where the extraction is reviewed.
2. A dependency mechanism exists that a package can use, with a regression test (item 4.2).
3. Typecheck and build handle package sources and declarations explicitly (item 4.3).
4. The 27 path occurrences are preserved as-is, or a migration is approved in writing (item 4.4).
5. The extraction has a stated consumer or publish target beyond "the tree looks like the blueprint".
