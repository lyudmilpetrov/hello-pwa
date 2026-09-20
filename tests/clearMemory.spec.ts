import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { parseReceipt } from '../src/lib/receiptData'
import { RECEIPTS_STORAGE_KEY } from '../src/store/persistence'

const receiptUrl = 'https://tax.salyk.kg/tax-web-control/client/api/v1/ticket?date=20260917T175623&sum=91950&fn_number=000000000000002&regNumber=000000000000003&tin=00000000000001&type=3&operation_type=1&fd_number=172045&fm=000000000000004'
const fixture = JSON.parse(readFileSync(new URL('./fixtures/receipt.json', import.meta.url), 'utf8'))

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  await page.evaluate(({ key, receipt }) => {
    localStorage.setItem(key, JSON.stringify({ version: 1, receipts: [receipt] }))
    localStorage.setItem('theme', 'dark')
    localStorage.setItem('old-cache', 'cached information')
  }, { key: RECEIPTS_STORAGE_KEY, receipt: parseReceipt(fixture, receiptUrl) })
  await page.reload()
  await expect(page.getByRole('link', { name: 'View receipt' })).toBeVisible()
})

test('clears loaded state and all local storage, stays empty after reload, and allows new imports', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.getByLabel('Or paste a receipt link').fill(receiptUrl)
  await page.getByRole('button', { name: 'Clear Memory' }).click()
  await expect(page.getByRole('heading', { name: 'Receipts (0)' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download Excel' })).toBeDisabled()
  await expect(page.getByLabel('Or paste a receipt link')).toHaveValue('')
  await expect(page.locator('html')).not.toHaveClass('dark')
  await expect(page.getByRole('status')).toContainText('Memory cleared.')
  expect(await page.evaluate(() => localStorage.length)).toBe(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Receipts (0)' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.length)).toBe(0)

  await page.route('**/api/receipts', route => route.fulfill({ json: fixture }))
  await page.getByLabel('Or paste a receipt link').fill(receiptUrl)
  await page.getByRole('button', { name: 'Import receipt', exact: true }).click()
  await expect(page.getByRole('link', { name: 'View receipt' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('link', { name: 'View receipt' })).toBeVisible()
})

test('reports storage failures while still clearing current Redux state', async ({ page }) => {
  await page.evaluate(() => {
    Storage.prototype.clear = () => { throw new Error('Storage access denied') }
  })
  await page.getByRole('button', { name: 'Clear Memory' }).click()
  await expect(page.getByRole('heading', { name: 'Receipts (0)' })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('browser storage could not be cleared')
})

test('prevents clearing while an import is in progress', async ({ page }) => {
  let finishImport!: () => void
  const pendingImport = new Promise<void>(resolve => { finishImport = resolve })
  await page.route('**/api/receipts', async route => {
    await pendingImport
    await route.fulfill({ json: fixture })
  })
  await page.getByLabel('Or paste a receipt link').fill(receiptUrl)
  await page.getByRole('button', { name: 'Import receipt', exact: true }).click()
  try {
    await expect(page.getByRole('button', { name: 'Clear Memory' })).toBeDisabled()
  } finally {
    finishImport()
  }
  await expect(page.getByRole('status')).toHaveText('Receipt added.')
  await expect(page.getByRole('button', { name: 'Clear Memory' })).toBeEnabled()
})
