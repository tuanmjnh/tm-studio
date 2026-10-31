import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.mjs',
    generationAdapter: 'src/generationAdapter.mjs',
    providerAdapter: 'src/providerAdapter.mjs'
  },
  format: ['cjs', 'esm'],
  clean: true,
  splitting: false,
  sourcemap: true,
  minify: false,
  target: 'es2022',
  outExtension({ format }) {
    return {
      js: format === 'cjs' ? '.cjs' : '.js'
    }
  }
})
