import { readFileSync, writeFileSync, copyFileSync, mkdirSync, cpSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dist = join(root, 'dist')
mkdirSync(dist, { recursive: true })

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

// 1. Copy types directory into dist
const typesDir = join(root, 'types')
if (existsSync(typesDir)) {
  cpSync(typesDir, join(dist, 'types'), { recursive: true })
}

// 2. Prepare dist/index.d.ts with relative imports adjusted from ../types to ./types
const srcIndexDts = join(root, 'src', 'index.d.ts')
if (existsSync(srcIndexDts)) {
  const content = readFileSync(srcIndexDts, 'utf8')
  const adjusted = content.replace(/(['"])\.\.\/types\//g, '$1./types/')
  writeFileSync(join(dist, 'index.d.ts'), adjusted)
}

// 3. Prepare dist/generationAdapter.d.ts
const genAdapterDts = `// @tmcut/core — generationAdapter declarations
export interface CapabilityManifest {
  schemaVersion: number
  providerId: string
  displayName: string
  modalities: string[]
  outputFormats: { image?: string[], video?: string[] }
  maxResolution: { image?: { width: number, height: number }, video?: { width: number, height: number } }
  maxDurationSec: number
  supportsAsync: boolean
  supportsCancel: boolean
  supportsProgress: boolean
  costModel: string
  verified?: boolean
  [key: string]: unknown
}

export interface GenerationAdapter {
  manifest(): CapabilityManifest
  submitJob(input: Record<string, unknown>): Promise<{ ok: boolean, jobId?: string, taskId?: string, error?: string }>
  pollJob(jobId: string): Promise<{ ok: boolean, status: string, progress?: number, results?: unknown[], error?: string }>
  cancelJob?(jobId: string): Promise<{ ok: boolean, error?: string }>
  downloadResult?(jobId: string, destDir?: string): Promise<{ ok: boolean, data?: unknown, error?: string }>
  estimateCost?(input: Record<string, unknown>): Promise<{ estimatedCostUsd: number, costBreakdown?: Record<string, number>, budgetWarning?: boolean }>
}

export declare function createCapabilityManifest(input?: Partial<CapabilityManifest>): CapabilityManifest
export declare function validateCapabilityManifest(manifest: unknown): { valid: boolean, errors: string[] }
export declare function createGenerationJobInput(input?: Record<string, unknown>): Record<string, unknown>
export declare function createJobStatusResponse(status: string, data?: Record<string, unknown>): Record<string, unknown>
export declare function createGenerationResult(data?: Record<string, unknown>): Record<string, unknown>
export declare function createCostEstimate(input?: Record<string, unknown>): { estimatedCostUsd: number, costBreakdown: Record<string, unknown>, budgetWarning: boolean }
export declare function registerGenerationAdapter(providerId: string, adapter: GenerationAdapter): void
export declare function getGenerationAdapter(providerId: string): GenerationAdapter | null
export declare function listGenerationAdapters(): Array<{ providerId: string, manifest: CapabilityManifest }>
export declare function isProviderVerified(providerId: string): boolean
`
writeFileSync(join(dist, 'generationAdapter.d.ts'), genAdapterDts)

// 4. Generate dist/package.json
const distPkg = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  type: pkg.type,
  main: './index.cjs',
  module: './index.js',
  types: './index.d.ts',
  exports: {
    '.': {
      types: './index.d.ts',
      import: './index.js',
      require: './index.cjs'
    },
    './generationAdapter': {
      types: './generationAdapter.d.ts',
      import: './generationAdapter.js',
      require: './generationAdapter.cjs'
    },
    './providerAdapter': {
      types: './providerAdapter.d.ts',
      import: './providerAdapter.js',
      require: './providerAdapter.cjs'
    },
    './package.json': './package.json'
  },
  files: ['*'],
  keywords: pkg.keywords || [
    'tmcut',
    'video-editor',
    'timeline',
    'editing-engine',
    'video-production'
  ],
  author: pkg.author || 'tuanmjnh',
  license: pkg.license || 'MIT',
  publishConfig: pkg.publishConfig || {
    access: 'public'
  }
}

writeFileSync(join(dist, 'package.json'), JSON.stringify(distPkg, null, 2) + '\n')

// 5. Copy README.md
const readme = join(root, 'README.md')
if (existsSync(readme)) {
  copyFileSync(readme, join(dist, 'README.md'))
}

console.log('✓ dist/package.json, types and assets prepared for publish')
