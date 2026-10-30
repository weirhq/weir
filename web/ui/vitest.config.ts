import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true
  },
  // Under Bazel, test files resolve to paths outside the runfiles root.
  server: { fs: { strict: process.env.BAZEL_TEST !== '1' } }
})
