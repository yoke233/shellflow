import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    __GIT_HASH__: JSON.stringify('test-hash'),
  },
  resolve: {
    alias: {
      // Mock problematic xterm packages that don't work in test environment
      '@xterm/addon-ligatures': new URL('./src/test/mocks/xterm-ligatures.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
