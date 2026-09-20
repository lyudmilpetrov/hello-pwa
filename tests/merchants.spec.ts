import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import ExcelJS from 'exceljs'
import { DEFAULT_MERCHANTS, MERCHANTS_STORAGE_KEY } from '../src/lib/merchants'

const receiptUrl = 'https://tax.salyk.kg/tax-web-control/client/api/v1/ticket?date=20260917T175623&sum=91950&fn_number=000000000000002&regNumber=000000000000003&tin=00000000000001&type=3&operation_type=1&fd_number=172045&fm=000000000000004'
const receiptFixture = JSON.parse(readFileSync(new URL('./fixtures/receipt.json', import.meta.url), 'utf8'))

async function openMerchants(page: Page) {
  await page.getByRole('button', { name: 'Merchants', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Merchants', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

async function savedMerchants(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), MERCHANTS_STORAGE_KEY)
}

test('shows the defaults and persists added and edited merchants after reload', async ({ page }) => {
  await page.goto('./')
  const dialog = await openMerchants(page)
  const mappings = dialog.getByRole('list', { name: 'Merchant mappings' })
  for (const { key, category } of DEFAULT_MERCHANTS) {
    const row = mappings.getByRole('listitem').filter({ has: page.getByRole('button', { name: `Edit ${key}`, exact: true }) })
    await expect(row.getByText(key, { exact: true })).toBeVisible()
    await expect(row.getByText(category, { exact: true })).toBeVisible()
  }

  await dialog.getByLabel('Merchant key', { exact: true }).fill('  Coffee House  ')
  await dialog.getByLabel('Category', { exact: true }).fill('  dining  ')
  await dialog.getByRole('button', { name: 'Add merchant', exact: true }).click()
  await expect(dialog.getByRole('status')).toHaveText('Coffee House added.')
  await expect(mappings.getByRole('listitem')).toHaveCount(5)

  await dialog.getByRole('button', { name: 'Edit DNS', exact: true }).click()
  await dialog.getByLabel('Merchant key', { exact: true }).fill('DNS Store')
  await dialog.getByLabel('Category', { exact: true }).fill('equipment')
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(dialog.getByRole('status')).toHaveText('DNS Store updated.')
  await dialog.getByRole('button', { name: 'Edit Coffee House', exact: true }).click()
  await dialog.getByLabel('Category', { exact: true }).fill('unsaved change')
  await dialog.getByRole('button', { name: 'Cancel edit', exact: true }).click()
  await expect(dialog.getByLabel('Category', { exact: true })).toHaveValue('')
  await dialog.getByRole('button', { name: 'Close merchants' }).click()

  await page.reload()
  await openMerchants(page)
  await expect(mappings.getByRole('listitem')).toHaveCount(5)
  await expect(dialog.getByRole('button', { name: 'Edit DNS', exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Edit DNS Store', exact: true })).toBeVisible()
  expect(await savedMerchants(page)).toMatchObject({ version: 1, merchants: expect.arrayContaining([
    { id: 'default-dns', key: 'DNS Store', category: 'equipment' },
    { id: expect.any(String), key: 'Coffee House', category: 'dining' },
  ]) })
})

test('reclassifies an existing receipt and downloads its edited category to Excel', async ({ page }) => {
  await page.route('**/api/receipts', route => route.fulfill({ json: receiptFixture }))
  await page.goto('./')
  await page.getByLabel('Or paste a receipt link').fill(receiptUrl)
  await page.getByRole('button', { name: 'Import receipt', exact: true }).click()
  const table = page.getByRole('table', { name: 'Imported receipt information', exact: true })
  await expect(table.getByRole('cell', { name: 'Uncategorized', exact: true })).toBeVisible()

  const dialog = await openMerchants(page)
  await dialog.getByLabel('Merchant key', { exact: true }).fill('sample market')
  await dialog.getByLabel('Category', { exact: true }).fill('groceries')
  await dialog.getByRole('button', { name: 'Add merchant', exact: true }).click()
  await dialog.getByRole('button', { name: 'Close merchants' }).click()
  await expect(table.getByRole('cell', { name: 'groceries', exact: true })).toBeVisible()
  await openMerchants(page)
  await dialog.getByRole('button', { name: 'Edit sample market', exact: true }).click()
  await dialog.getByLabel('Category', { exact: true }).fill('office supplies')
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
  await dialog.getByRole('button', { name: 'Close merchants' }).click()
  await expect(table.getByRole('cell', { name: 'office supplies', exact: true })).toBeVisible()

  const pendingDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download Excel', exact: true }).click()
  const download = await pendingDownload
  expect(await download.failure()).toBeNull()
  const path = await download.path()
  expect(path).not.toBeNull()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(path!)
  expect(workbook.getWorksheet('Final')!.getCell('B2').value).toBe('office supplies')
  await page.reload()
  await expect(table.getByRole('cell', { name: 'office supplies', exact: true })).toBeVisible()
})

test('rejects duplicate keys and whitespace-only fields without changing saved mappings', async ({ page }) => {
  await page.goto('./')
  const dialog = await openMerchants(page)
  const key = dialog.getByLabel('Merchant key', { exact: true })
  const category = dialog.getByLabel('Category', { exact: true })
  const submit = dialog.getByRole('button', { name: 'Add merchant', exact: true })
  const before = await savedMerchants(page)
  await key.fill('  bishkek   PETROLEUM  ')
  await category.fill('duplicate')
  await submit.click()
  await expect(dialog.getByRole('alert')).toContainText('already exists')
  await key.fill('   ')
  await submit.click()
  await expect(dialog.getByRole('alert')).toContainText('Enter both')
  await key.fill('New merchant')
  await category.fill('   ')
  await submit.click()
  await expect(dialog.getByRole('alert')).toContainText('Enter both')

  await dialog.getByRole('button', { name: 'Edit DNS', exact: true }).click()
  await key.fill(' глобус ')
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('already exists')
  await expect(dialog.getByRole('listitem')).toHaveCount(4)
  expect(await savedMerchants(page)).toEqual(before)
})

test('Clear Memory restores default merchants immediately and after reload', async ({ page }) => {
  await page.goto('./')
  let dialog = await openMerchants(page)
  await dialog.getByRole('button', { name: 'Edit DNS', exact: true }).click()
  await dialog.getByLabel('Category', { exact: true }).fill('equipment')
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
  await dialog.getByLabel('Merchant key', { exact: true }).fill('Custom merchant')
  await dialog.getByLabel('Category', { exact: true }).fill('other')
  await dialog.getByRole('button', { name: 'Add merchant', exact: true }).click()
  await dialog.getByRole('button', { name: 'Close merchants' }).click()
  await page.getByRole('button', { name: 'Clear Memory', exact: true }).click()

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await page.reload()
    dialog = await openMerchants(page)
    await expect(dialog.getByRole('listitem')).toHaveCount(4)
    await expect(dialog.getByText('electronics', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Edit Custom merchant', exact: true })).toHaveCount(0)
    expect(await savedMerchants(page)).toBeNull()
    await dialog.getByRole('button', { name: 'Close merchants' }).click()
  }
})

test('the toolbar and dark merchant dialog fit a 320px viewport and Escape restores focus', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('./')
  const merchantButton = page.getByRole('button', { name: 'Merchants', exact: true })
  const themeButton = page.getByRole('button', { name: 'Switch to light mode' })
  const merchantBounds = (await merchantButton.boundingBox())!
  const themeBounds = (await themeButton.boundingBox())!
  expect(merchantBounds.x).toBeGreaterThanOrEqual(0)
  expect(merchantBounds.x + merchantBounds.width).toBeLessThanOrEqual(320)
  expect(merchantBounds.y).toBeLessThan(32)
  expect(merchantBounds.x + merchantBounds.width <= themeBounds.x
    || merchantBounds.y + merchantBounds.height <= themeBounds.y).toBe(true)
  const headingBounds = (await page.getByRole('heading', { name: 'Receipt collector', exact: true }).boundingBox())!
  expect(headingBounds.y).toBeGreaterThanOrEqual(Math.max(
    merchantBounds.y + merchantBounds.height, themeBounds.y + themeBounds.height,
  ))

  const dialog = await openMerchants(page)
  await expect(page.locator('html')).toHaveClass('dark')
  await expect(dialog).toHaveCSS('background-color', 'rgb(30, 30, 37)')
  expect(await dialog.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0
      && bounds.bottom <= innerHeight && element.scrollWidth <= element.clientWidth
  })).toBe(true)
  await dialog.getByRole('button', { name: 'Edit Bishkek Petroleum', exact: true }).click()
  await expect(dialog.getByLabel('Merchant key', { exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(merchantButton).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
