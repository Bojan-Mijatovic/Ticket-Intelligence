import { defineConfig, devices } from '@playwright/test';

// The Angular dev server is started on its own port, so the tests never interfere with an app already running on 4201.
const PORT = Number(process.env.E2E_PORT ?? 4310);

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: process.env.E2E_REPORT ?? 'test-results/report.json' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npx ng serve --port ${PORT}`,
    cwd: '../frontend',
    url: `http://localhost:${PORT}`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: { NG_CLI_ANALYTICS: 'false' },
  },
});
