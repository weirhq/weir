import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    // @weirhq/ui depends on React too; bundle exactly one copy.
    dedupe: ['react', 'react-dom']
  },
  build: {
    target: 'es2023'
  },
  server: {
    // In development the Go server runs separately; send API calls to it.
    proxy: {
      '^/weir\\.api\\.': 'http://localhost:8320'
    },
    // Under Bazel, test files resolve to paths outside the runfiles root.
    fs: { strict: process.env.BAZEL_TEST !== '1' }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/setup.ts']
  }
})
