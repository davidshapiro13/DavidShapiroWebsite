import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/browser',
  fullyParallel: true,
  use: { baseURL: 'http://localhost:8080', channel: 'chrome', headless: true },
  webServer: { command: 'node scripts/preview.mjs', url: 'http://localhost:8080/shop.html', reuseExistingServer: false },
});
