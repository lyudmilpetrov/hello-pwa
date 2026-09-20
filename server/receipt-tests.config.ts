import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '../tests',
  testMatch: 'receiptServer.spec.ts',
  outputDir: '../test-results/receipt-server',
})
