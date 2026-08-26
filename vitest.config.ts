import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { transformWithOxc } from 'vite'
import { defineConfig, type Plugin } from 'vitest/config'

function transform_cts(): Plugin {
  return {
    name: 'transform-cts-as-typescript',
    enforce: 'pre',
    async transform(code, id) {
      const file_path = id.split('?', 1)[0]
      if (!file_path.endsWith('.cts')) return null

      const result = await transformWithOxc(code, file_path, { lang: 'ts' })
      return {
        code: result.code,
        map: result.map,
      }
    },
  }
}

export default defineConfig({
  plugins: [transform_cts(), react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    projects: [
      {
        extends: true,
        test: {
          name: 'app',
          setupFiles: ['./tests/setup.ts'],
          include: ['tests/*.test.ts', 'tests/*.test.tsx'],
        },
      },
      {
        extends: true,
        test: {
          name: 'platform',
          setupFiles: ['./tests/runtimeSetup.ts'],
          include: ['tests/platform/**/*.test.ts', 'tests/backend/**/*.test.ts'],
        },
      },
    ],
  },
})
