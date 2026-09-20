import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Download, Page } from '@playwright/test'
import ExcelJS from 'exceljs'
import { createReceiptWorkbook } from '../src/lib/receiptExport'
import type { Receipt } from '../src/types/receipt'

const receiptUrl = 'https://tax.salyk.kg/tax-web-control/client/api/v1/ticket?date=20260917T175623&sum=91950&fn_number=000000000000002&regNumber=000000000000003&tin=00000000000001&type=3&operation_type=1&fd_number=172045&fm=000000000000004'
const receiptFixture = JSON.parse(readFileSync(new URL('./fixtures/receipt.json', import.meta.url), 'utf8'))

function receipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    id: 'receipt-001', sourceUrl: receiptUrl, importedAt: '2026-09-20T11:00:00.000Z',
    dateTime: '2026-09-17T21:56:23.000Z', merchant: '=Магазин «Достор»',
    merchantAddress: 'Бишкек, улица Примерная, 1', totalAmountMinor: 250,
    vatAmountMinor: null, currency: 'KGS', tin: '00000000000001',
    kkmNumber: '0000000000229871', fmNumber: '0000000002369707',
    fpd: '254486752077560123', fdNumber: '000172045',
    items: [{ name: '=Чай', quantity: 0.25, unitPriceMinor: 1000, totalAmountMinor: 250 }],
    ...overrides,
  }
}

async function importReceipt(page: Page) {
  await page.route('**/api/receipts', route => route.fulfill({ json: receiptFixture }))
  await page.goto('./')
  await page.getByLabel('Or paste a receipt link').fill(receiptUrl)
  await page.getByRole('button', { name: 'Import receipt', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Receipt added.')
}

async function downloadedWorkbook(download: Download) {
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/i)
  expect(await download.failure()).toBeNull()
  const path = await download.path()
  expect(path).not.toBeNull()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(path!)
  return workbook
}

test('Excel round trip preserves receipt values, identifiers and item relationships', async () => {
  const first = receipt()
  const second = receipt({ id: 'receipt-002', merchant: 'Другой магазин', vatAmountMinor: 0,
    totalAmountMinor: 12345, items: [{ name: 'Хлеб', quantity: 2, unitPriceMinor: 6172, totalAmountMinor: 12345 }] })
  const exported = createReceiptWorkbook([first, second])
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await exported.xlsx.writeBuffer())
  expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(['Receipts', 'Purchased items'])
  const receipts = workbook.getWorksheet('Receipts')!
  const items = workbook.getWorksheet('Purchased items')!
  expect(receipts.rowCount).toBe(3)
  expect(items.rowCount).toBe(3)
  expect(receipts.getCell('A2').type).toBe(ExcelJS.ValueType.Date)
  expect((receipts.getCell('A2').value as Date).toISOString()).toBe('2026-09-18T03:56:23.000Z')
  expect(receipts.getCell('B2').value).toBe(first.merchant)
  expect(receipts.getCell('B2').type).toBe(ExcelJS.ValueType.String)
  expect(receipts.getCell('C2').value).toBe(first.merchantAddress)
  expect(receipts.getCell('D2').value).toBe(2.5)
  expect(receipts.getCell('D2').type).toBe(ExcelJS.ValueType.Number)
  expect(receipts.getCell('D2').numFmt).toMatch(/0\.00/)
  expect(receipts.getCell('D3').value).toBe(123.45)
  expect(receipts.getCell('E2').value).toBeNull()
  expect(receipts.getCell('E3').value).toBe(0)
  for (const [column, value] of Object.entries({ F: first.tin, G: first.kkmNumber,
    H: first.fmNumber, I: first.fpd, J: first.fdNumber, L: first.id })) {
    expect(receipts.getCell(`${column}2`).value).toBe(value)
    expect(receipts.getCell(`${column}2`).type).toBe(ExcelJS.ValueType.String)
  }
  expect(receipts.getCell('K2').value).toMatchObject({ hyperlink: first.sourceUrl })
  expect(items.getCell('A2').value).toBe(first.id)
  expect(items.getCell('A3').value).toBe(second.id)
  expect(items.getCell('B2').value).toEqual(receipts.getCell('A2').value)
  expect(items.getCell('C2').value).toBe(first.merchant)
  expect(items.getCell('D2').value).toBe('=Чай')
  expect(items.getCell('D2').type).toBe(ExcelJS.ValueType.String)
  expect(items.getCell('E2').value).toBe(0.25)
  expect(items.getCell('F2').value).toBe(10)
  expect(items.getCell('G2').value).toBe(2.5)
})

test('Download Excel is disabled when empty and downloads imported data on a small screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('./')
  const button = page.getByRole('button', { name: 'Download Excel', exact: true })
  await expect(button).toBeDisabled()
  await importReceipt(page)
  await expect(button).toBeEnabled()
  expect(await button.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return bounds.left >= 0 && bounds.right <= window.innerWidth
  })).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const pendingDownload = page.waitForEvent('download')
  await button.click()
  const workbook = await downloadedWorkbook(await pendingDownload)
  const receipts = workbook.getWorksheet('Receipts')!
  expect(receipts.getCell('B2').value).toBe('Sample Market')
  expect(receipts.getCell('D2').value).toBe(919.5)
  expect(receipts.getCell('E2').value).toBe(97.65)
  expect(workbook.getWorksheet('Purchased items')!.rowCount).toBe(4)
  await expect(button).toBeEnabled()
})

test('saved receipts can be exported for the first time after reloading offline', async ({ page, context }) => {
  await importReceipt(page)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
    }
  })
  await context.setOffline(true)
  await page.reload()
  const button = page.getByRole('button', { name: 'Download Excel', exact: true })
  await expect(button).toBeEnabled()
  const pendingDownload = page.waitForEvent('download')
  await button.click()
  const workbook = await downloadedWorkbook(await pendingDownload)
  expect(workbook.getWorksheet('Receipts')!.getCell('F2').value).toBe('00000000000001')
  expect(workbook.getWorksheet('Purchased items')!.getCell('D2').value).toBe('Shaving foam')
})
