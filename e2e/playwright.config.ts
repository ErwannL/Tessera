import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'off',
    // Optional: reuse a preinstalled Chromium when running outside the Playwright image.
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
});
