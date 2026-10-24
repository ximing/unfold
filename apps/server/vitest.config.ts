import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 40000,
    testTimeout: 40000,
    env: { UNFOLD_INDEX: 'off' },
  },
});
