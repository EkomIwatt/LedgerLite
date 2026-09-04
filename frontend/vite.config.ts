/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev proxy is load-bearing, not a convenience: routing /api through the Vite
// origin makes every auth request same-origin, which is the only reason the
// SameSite=Lax development refresh cookie is sent at all (Contract 1).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: false,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
    // Vitest's default `forks` pool cannot start a worker when the project
    // lives under a path containing spaces (a OneDrive-synced folder, here) -
    // it times out waiting for the child to respond. Threads have no such
    // trouble and the suite has no cross-test global state that needs process
    // isolation, since each file resets the mock backend itself.
    pool: 'threads',
    // The dashboard is a lazily-imported chunk that pulls in Recharts, and
    // Vitest transforms it on first use inside the test run. That one import
    // can take several seconds on a cold run, which has nothing to do with the
    // behaviour under test - so the default 5s ceiling is raised rather than
    // the code being un-split to suit the test runner.
    testTimeout: 20000,
  },
});
