import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    // CI runners can take ten times as long as a laptop; the date range
    // picker's tests have gone past the default 5s there.
    testTimeout: 20000
  },
  // Under Bazel, test files resolve to paths outside the runfiles root.
  server: { fs: { strict: process.env.BAZEL_TEST !== '1' } }
})
