// =============================================================================
//  @tmcut/core — architecture boundary check (docs section 57).
//  The core must never import: vue, nuxt, electron, node builtins,
//  browser globals or IPC. Run: pnpm --filter @tmcut/core check
// =============================================================================
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

const FORBIDDEN = [
  /from\s+['"]vue['"]/,
  /from\s+['"]nuxt/,
  /from\s+['"]electron['"]/,
  /from\s+['"]node:/,
  /require\(\s*['"]electron['"]\s*\)/,
  /require\(\s*['"]node:/,
  /\bwindow\./,
  /\bdocument\./,
  /\blocalStorage\b/,
  /ipcRenderer/,
  /ipcMain/,
  /@nuxt\//,
  /~\//
]

function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

let failures = 0
for (const file of readdirSync(ROOT).filter(name => name.endsWith('.mjs'))) {
  const rawText = readFileSync(join(ROOT, file), 'utf8')
  const text = stripComments(rawText)
  for (const pattern of FORBIDDEN) {
    if (pattern.test(text)) {
      failures += 1
      console.error(`boundary violation in ${file}: ${pattern}`)
    }
  }
}

if (failures > 0) {
  console.error(`check-boundaries: ${failures} violation(s)`)
  process.exit(1)
}
console.log('check-boundaries: PASS — core imports nothing platform-specific')
