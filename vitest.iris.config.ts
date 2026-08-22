import { existsSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

function resolve_migrated_iris_path(source: string) {
  const mappings = [
    ['../../server/', './backend/'],
    ['../../src/lib/providers/', './src/platform/providers/'],
  ]

  for (const [prefix, destination] of mappings) {
    if (!source.startsWith(prefix)) continue

    const relative = source.slice(prefix.length).replace(/\.js$/, '')
    for (const extension of ['.ts', '.tsx', '.cts', '.js', '']) {
      const path = fileURLToPath(new URL(`${destination}${relative}${extension}`, import.meta.url))
      if (existsSync(path)) return path
    }
  }

  return null
}

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    {
      name: 'migrated-iris-test-paths',
      enforce: 'pre',
      resolveId(source) {
        return resolve_migrated_iris_path(source)
      },
    },
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./migrated-tests/iris/setup.ts'],
    include: [
      'migrated-tests/iris/lib/**/*.test.ts',
      'migrated-tests/iris/server/**/*.test.ts',
    ],
    exclude: [
      'migrated-tests/iris/lib/localProfileClient.test.ts',
      'migrated-tests/iris/lib/orbTextures.test.ts',
      'migrated-tests/iris/lib/runtimeModularization.test.ts',
      'migrated-tests/iris/lib/screenCaptureErrors.test.ts',
      'migrated-tests/iris/lib/workspaceResize.test.ts',
    ],
  },
})
