import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * Compiler output landing next to its source shadows the real module: a `.js`
 * twin of a `.ts` file wins Vite resolution and Nuxt auto-import, which is how
 * "Cannot add property setup" build failures happen while the `.ts` file looks
 * correct. This checks the tree instead of trusting the build to be clean.
 *
 * Ported from tm-tools, where the failure was observed. Run from the repo root:
 * `pnpm check:hygiene`.
 */
const ROOTS = ['app', 'server', 'shared']
const IGNORED_DIRS = new Set([
  'node_modules', '.nuxt', '.output', '.vercel', 'dist', 'release', 'dist-electron', 'coverage', '.data'
])

interface Finding {
  file: string
  reason: 'js-twin' | 'vue-js-twin'
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }

  for (const name of entries) {
    if (IGNORED_DIRS.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

export function findPollution(roots: string[] = ROOTS): Finding[] {
  const findings: Finding[] = []

  for (const root of roots) {
    for (const file of walk(root)) {
      if (file.endsWith('.vue.js')) {
        findings.push({ file, reason: 'vue-js-twin' })
        continue
      }
      if (!file.endsWith('.js')) continue

      // `x.js` next to `x.ts` is emitted output, never a hand-written source.
      const twin = `${file.slice(0, -3)}.ts`
      try {
        if (statSync(twin).isFile()) findings.push({ file, reason: 'js-twin' })
      } catch {
        // No TypeScript twin: a legitimate JavaScript file.
      }
    }
  }

  return findings
}

const invokedDirectly = process.argv[1]?.endsWith('check-source-hygiene.mts')
if (invokedDirectly) {
  const findings = findPollution()
  if (findings.length === 0) {
    console.log('Source tree is clean: no emitted twins under app/, server/, shared/.')
  } else {
    console.error(`Found ${findings.length} emitted file(s) shadowing sources:`)
    for (const finding of findings) {
      console.error(`  ${relative(process.cwd(), finding.file).split(sep).join('/')}  (${finding.reason})`)
    }
    console.error('\nDelete these files. Fix the command that emitted them instead of ignoring the pattern.')
    process.exitCode = 1
  }
}
