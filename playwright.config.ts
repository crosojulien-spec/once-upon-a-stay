import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const browsers = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const localBrowser =
  process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
  (process.platform === 'win32' ? browsers.find(existsSync) : undefined);
export default defineConfig({
  testDir: 'tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  reporter: 'list',
  outputDir: '.local/browser-results',
  use: {
    baseURL: 'http://127.0.0.1:4321',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath: localBrowser },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node --import tsx server/index.ts',
    url: 'http://127.0.0.1:4321/api/health',
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      PORT: '4321',
      HOST: '127.0.0.1',
      CANOPIA_ORIGIN: 'http://127.0.0.1:4321',
      CANOPIA_AI_MODE: 'simulation',
      CANOPIA_ALLOW_AI_CALLS: 'false',
      CANOPIA_ALLOW_EMAIL: 'false',
      CANOPIA_ALLOW_REAL_STAYS: 'false',
      DATABASE_URL: '',
      CANOPIA_SERVE_BUILD: 'true',
      CANOPIA_DATA_DIR: `.local/e2e-${randomUUID()}`,
    },
  },
});
