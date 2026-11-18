// A helper for specs that need to read one engine module. The published package
// is a bundle: dist/index.js concatenates every source file, and each one keeps
// its `// src/<name>.mjs` banner. Slicing between two banners returns exactly
// what the spec used to read from src/<name>.mjs, so an assertion about "this
// module contains X" keeps its meaning.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..', '..')
const BUNDLE = join(ROOT, 'node_modules', '@tuanmjnh', 'tm-cut-core', 'index.js')

let cached = null
function bundle() {
  if (!cached) cached = readFileSync(BUNDLE, 'utf8')
  return cached
}

/** The source of one module, as concatenated into the published bundle. */
export function moduleSource(name) {
  const text = bundle()
  const marker = `// src/${name}.mjs`
  const start = text.indexOf(marker)
  if (start === -1) throw new Error(`module ${name} is not in the bundle`)
  // The next banner is the end of this module. A banner is a line starting with
  // `// src/` and ending in `.mjs`, so the search starts past this one.
  const next = text.indexOf('\n// src/', start + marker.length)
  return next === -1 ? text.slice(start) : text.slice(start, next)
}

/** The package's type declarations. dist/index.d.ts is what a consumer sees. */
export function typeDeclarations() {
  return readFileSync(join(ROOT, 'node_modules', '@tuanmjnh', 'tm-cut-core', 'index.d.ts'), 'utf8')
}
