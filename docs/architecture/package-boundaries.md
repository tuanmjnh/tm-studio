# TM Studio — Package boundaries and extraction roadmap

Status: **proposal**. Nothing in this document has been executed. It records the boundary rules
the repository follows today and the order in which packages *could* be extracted, with the exit
criteria each extraction must meet first.

The measurement behind every statement here is
[docs/audit/repository-package-architecture-audit.md](file:///D:/Applications/tm-studio/docs/audit/repository-package-architecture-audit.md).

---

## 1. Dependency rules

The direction is one-way. A layer may import only the layers listed in its column.

| Layer | May import | Must never import |
|---|---|---|
| `packages/*` (runtime packages) | `packages/core` | `app/`, `server/`, `electron/`, `shared/`, Vue, Nuxt, Electron, DOM, Node builtins |
| `packages/core` | nothing outside itself | everything above |
| `app/` | `packages/core`, runtime packages, `shared/` via `#shared/` | `server/`, `electron/` by import |
| `server/` | `shared/` via `#shared/` | `app/`, `electron/` |
| `electron/` | `packages/core/src` by relative path; `shared/` is permitted but **not used today** | `app/`, `server/` |
| `shared/` | nothing above it | `app/`, `server/`, `electron/`, `packages/*` |

These rules are not aspirational — they hold today, measured in the audit's §5. The only
mechanical enforcement is `packages/core/tools/check-boundaries.mjs`, which covers the core.
The app/server and app/electron rules are currently upheld by convention and would be worth a
guard if a second package ever appears.

### 1.1 What a package may not do

- A package may not read `process.env`, a file, a URL, or a global. It receives values.
- A package may not own a timer, a request, or a decoder. It returns a plan; the host executes it.
- A package may not import `mediabunny`, even `import type`. The demuxer is host IO.

### 1.2 What `core` specifically forbids, and why

`packages/core/tools/check-boundaries.mjs:12-24` forbids `vue`, `nuxt`, `electron`, `node:`,
`window.`, `document.`, `localStorage`, `ipcRenderer`, `ipcMain`, `@nuxt/` and `~/`. The reason
is testability: 919 core tests run under plain `node --test` with no bundler, no DOM, and no
Electron main. A single `window.` reference would make that impossible.

---

## 2. Package contracts

Each entry below states the contract a package would have to satisfy **before** the directory may
be created. An entry with no implementation in the repository says so.

### 2.1 `core` (exists)

| Field | Value |
|---|---|
| Single responsibility | pure domain decisions for TMCut: time, evaluation, composition plans, editing laws, media facts, export planning |
| Public API | `packages/core/src/index.mjs` barrel, plus `./generationAdapter` and `./providerAdapter` sub-entries |
| Internal modules | 63 `.mjs` files, freely importing each other by relative path |
| Runtime dependencies | none |
| May import | itself |
| Must not import | everything else (§1.2) |
| Build | `tsup` to `dist/` for npm only; the app and Electron read `src/` |
| Test | `node --test "test/*.test.mjs"` (919 tests) |
| App integration | Nuxt alias `tmcut-core` → `packages/core/src/index.mjs` (`nuxt.config.ts:21,107`) |

### 2.2 `media-core` (proposed — step 1)

| Field | Value |
|---|---|
| Single responsibility | turn bytes into one decoded frame, one decoded PCM window, or one probe answer |
| Material | `app/utils/tmcut/mediaProbe.ts`, `frameDecode.ts`, `audioDecode.ts`, `mediaElement.ts` (818 lines) |
| Public API | `probeMedia(source)`, `decodeFrame(ask)`, `decodePcm(ask)`, `openMedia(read)`, `releaseMedia(element)` |
| Internal modules | mediabunny wiring, canvas sink, audio buffer sink, element release |
| Runtime dependencies | `mediabunny` (the only package that may import it besides the Electron probe) |
| May import | `core` (for `buildMediaInfo`, `frameRequestKey`, `pcmHeadTrim`, `lumaCells`) |
| Must not import | `app/` composables, Vue, the project store, the export session |
| Build | plain ESM `.ts` compiled by the host; no separate bundler needed today |
| Test | a headless spec that decodes one frame and one PCM window from a committed fixture |
| App integration | `frameStore`, `frameStrip`, `waveformService`, `exportMixLeg` import the package instead of the local files |
| Exit criteria | (a) no module in the set imports anything from `app/`; (b) one fixture decodes headlessly; (c) the three existing consumers keep passing their specs unchanged |

Measured prerequisite: `webExportHost.ts:28-29` imports `createPlateReader` and
`createExportMixLeg`, and `exportMixLeg.ts:26` imports `decodePcm`. The dependency already points
one way, which is why this is step 1.

**Status 2026-11-11: `BLOCKED / DEFERRED` — not extracted, not failed.** The owner reviewed the
measurements below and decided not to move the four modules while the exit criteria cannot be met.
Nothing was relocated, no `packages/media-core` directory was created, and the specs were not edited.

| Criterion | What was measured | Verdict |
|---|---|---|
| (a) no module imports from `app/` | the four modules import only `mediabunny`, `tmcut-core` and each other | already true — no move needed |
| (b) one fixture decodes headlessly | under plain Node 24.22.2, `probeMedia` on `tests/fixtures/containers/h264.mp4` answers **1 video track** (`avc`, 64x36), but `VideoDecoder` and `AudioDecoder` are `undefined`, so `decodeFrame` and `decodePcm` both return `null` | **not met in Node** — now measured in Chromium by `tests/e2e/browser_media_integration.mts` (`pnpm test:browser`, 11 checks) |
| (c) the three existing consumers pass their specs unchanged | **27 path occurrences across 9 spec files** name `app/utils/tmcut/{frameDecode,audioDecode,mediaProbe,mediaElement}.ts`: 17 as string literals a test compares against, 6 as import specifiers, 4 in prose comments. Moving the files breaks all but the last group | **not met** — a move breaks them, and repointing them is the "spec edited to fit the extraction" that §5 rule 2 forbids |

Two further facts make the move a net loss today, independent of the gate:

- **Core resolution.** `tmcut-core` reaches `src` through a Nuxt alias (`nuxt.config.ts:21,107`) and
  a `tsconfig.test.json` path. Neither reaches a file under `packages/media-core/`, and the package
  is deliberately **not** installed (`tests/unit/tmcut_core_source.spec.ts:235-241` pins that). A
  package there would need either the retired `file:` dependency (ADR-022) or a relative import
  across the package boundary.
- **Type checking.** `.nuxt/tsconfig.app.json` maps `tmcut-core` in `paths` but its `include` array
  holds `../app/**`, `../shared/**.d.ts` and `../i18n/**` — not `../packages/**`. A `.ts` module moved
  there leaves the program `nuxt typecheck` runs. The file is generated and gitignored, so it is
  cited by key name, not by line.

The lesson is the one §2.5 already states for `platform-adapters`: while there is one consumer, this
is a file move, not a boundary. The dependency mechanism a second package could actually use, the
eight per-consumer resolution rows, and the five restart conditions are in
[core-package-contract.md](file:///D:/Applications/tm-studio/docs/architecture/core-package-contract.md).

### 2.3 `export` (proposed — step 2)

| Field | Value |
|---|---|
| Single responsibility | turn a project into one muxed file through WebCodecs |
| Material | `exportEncodeSession.ts` (929), `webCodecsExport.ts` (316), `webExportHost.ts` (227), `exportEncodePlan.ts`, `exportMixLeg.ts` (182), `webExportChoice.ts` |
| Public API | `createWebCodecsExport(deps)`, `createEncodeSession(ports)`, `createEncodeCapability()`, `exportMixLeg` |
| Internal modules | capability probe cache, encode loop, muxer call, PCM leg |
| Runtime dependencies | `mediabunny` (muxer), WebCodecs (host global, injected) |
| May import | `core` (`planEncode*`, `planExportMixPacket`), `media-core` (`createPlateReader`, `decodePcm`) |
| Must not import | `app/` components, the export modal, the project store |
| Build | ESM, compiled by the host |
| Test | one real encode against a fixture with a measured A/V offset; the unit suite's existing export specs unchanged |
| App integration | `TmcutExportModal.vue` calls one factory; the refusal path reads `core`'s plan |
| Exit criteria | (a) `webExportHost` stays the single assembly point; (b) a real file is produced; (c) the modal's refusal copy and disabled state are unchanged |

### 2.4 `rendering` (proposed — step 3)

| Field | Value |
|---|---|
| Single responsibility | project core's composition plan onto a surface, and describe an effect's CSS face |
| Material (pure part) | `fxCatalog.ts` (218), `fxLibrary.ts` (325), `exportEffectPaint.ts` |
| Material (joins) | `paintSurfaces.ts` |
| Public API | `surfacesAt(evaluation)`, `effectCssParts(...)`, `exportEffectFilter(...)`, `TRANSITION_CATALOG` |
| Internal modules | CSS filter grammar, transition geometry keys |
| Runtime dependencies | none for the pure part; `paintSurfaces` needs the media read interface |
| May import | `core`, `media-core` |
| Must not import | `TmcutPreviewPlayer.vue`, Vue reactivity |
| Build | ESM |
| Test | golden-frame comparison across the DOM leg and the canvas leg |
| App integration | the player imports `surfacesAt`; the effect tile imports the CSS face |
| Exit criteria | (a) the three pure modules move with zero code changes; (b) `paintSurfaces` takes the media interface as a parameter instead of importing `frameDecode` directly; (c) the pixel gate passes on both legs |

`renderer-dom`, `renderer-webgl` and `renderer-webgpu` are **not** proposed. The DOM renderer is a
2 460-line Vue component, and the two GPU renderers do not exist. A package directory with no
implementation would be a claim, not a boundary.

### 2.5 `platform-adapters` (proposed — step 4)

| Field | Value |
|---|---|
| Single responsibility | the host surface both runtimes implement: files, storage, worker, download |
| Material | `app/composables/useTmcutPlatform.ts`, `app/utils/tmcut/hostBridge.ts`, `mediaProbe.ts`'s source resolution |
| Public API | `useTmcutPlatform()`, `tmcutHostIpc()` |
| Runtime dependencies | none (the host injects) |
| May import | `core` (`createPlatformInfo`, `platformSupports`) |
| Must not import | Electron, Vue |
| Exit criteria | a second concrete consumer exists (headless CLI, a second host) |

Until step 4 there is one consumer, and `useTmcutPlatform.ts` already answers the question in one
place. Extracting it would move a file, not create a boundary.

---

## 3. Extraction order, with the reason for each position

| Step | Package | Depends on | Reason for the position |
|---|---|---|---|
| 0 | `core` | — | everything depends on it; already stable |
| 1 | `media-core` | core | deepest seam; `export` imports it |
| 2 | `export` | core, media-core | its only app-side consumers are the modal and the host assembly |
| 3 | `rendering` | core, media-core | needs the decoded-surface interface from step 1 |
| 4 | `platform-adapters` | core | needs a second host to justify the interface |
| 5 | renderers | step 3 | needs an implementation and a test per renderer |

If the dependency graph changes, the order changes with it. The order above is derived from the
import edges in the audit's §5 and §14, not from a blueprint.

---

## 4. What must not be extracted

| Thing | Why not |
|---|---|
| `effects` / `animation` from `core` | `keyframes.mjs` is the evaluator's own tick arithmetic; `effects.mjs` is read by `evaluate.mjs` and `exportContent.mjs`. Splitting creates a cycle or a re-export chain |
| `muxing` from `export` | about 40 lines (`exportEncodeSession.ts:336-338`) inside a session that owns the encoder lifecycle; one consumer, no independent test |
| `packages/shared` | root `shared/` already serves app + server + electron, is aliased, and has a spec guarding the alias |
| `renderer-webgl` / `renderer-webgpu` | no implementation exists in the repository |
| Electron media engine | ADR-032 forbids it; both hosts call the same app services |

---

## 5. Gate for every future extraction

An extraction merges only when all four hold:

1. **Boundary**: the new package imports nothing from the layer it came out of, proven by a
   grep-level spec in the style of `tests/unit/tmcut_core_source.spec.ts`.
2. **Parity**: the existing consumer specs pass unchanged. A spec edited to fit the extraction is
   a spec that stopped protecting the behaviour.
3. **Package closure**: if `electron/` or the packaged app loads the new package, the whole
   transitive closure is listed in `electron-builder.yml` `files:`. The existing
   `tests/unit/tmcut_core_source.spec.ts:252` check is the template.
4. **One name**: one package name, one alias, one specifier. The retired-name guard
   (`tests/unit/tmcut_core_source.spec.ts:162`) is the template, because a second name for one
   module is how two copies of an engine appear in one process.

---

## 6. Relationship to the existing documents

| Document | Relationship |
|---|---|
| `docs/adr/zero-ffmpeg-decisions.md` | binding decisions; this document may not contradict it |
| `docs/audit/zero-ffmpeg-audit.md` | measurements; this document cites it but does not repeat it |
| `docs/tmcut-v4-universal-rendering-multiplatform-roadmap.md` | architecture **proposal**, partly superseded; its package list is a target, not a state |
| `docs/audit/repository-package-architecture-audit.md` | the audit that produced this proposal |

No package is created by this document. The audit and this file are descriptions of a possible
future, and the repository as it stands is described in the root README.
