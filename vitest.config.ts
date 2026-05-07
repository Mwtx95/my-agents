import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', '.next/**'],
    setupFiles: ['tests/integration/setup.ts'],
    testTimeout: process.env.INTEGRATION_DATABASE_URL ? 30_000 : 5_000,
    globals: false,
    env: {
      NODE_ENV: 'test',
      LLM_PROVIDER: 'mock',
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
