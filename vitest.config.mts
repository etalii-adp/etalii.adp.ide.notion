import { defineConfig } from 'vitest/config';

// The shared parts without a browser, and the parts that draw in a simulated one. What only Notion
// shows (embedding, the grant of access, both appearances) is a manual pass, not a test here.
const browser = ['test/panels/**/*.test.ts', 'test/frame/**/*.test.ts', 'test/canvas/**/*.test.ts'];

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'parts', environment: 'node', include: ['test/**/*.test.ts'], exclude: browser } },
      { test: { name: 'browser', environment: 'jsdom', include: browser } },
    ],
  },
});
