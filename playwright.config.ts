import { defineConfig } from '@playwright/test'

const baseURL = `http://127.0.0.1:4174${process.env.BASE_PATH || '/'}`

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL,
    browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4174 --strictPort',
    url: baseURL,
    reuseExistingServer: false,
    // Keep the integration tests on their own Node API even when development
    // uses a deployed Worker through a proxy setting in the shell or env files.
    env: { API_PORT: process.env.API_PORT || '4185', RECEIPT_API_PROXY_TARGET: '' },
  },
})
