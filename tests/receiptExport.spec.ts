import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Download, Page } from '@playwright/test'
import ExcelJS from 'exceljs'
import { DEFAULT_MERCHANTS } from '../src/lib/merchants'
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
    fpd: '254486752077560123', fdNumber: '000172045', ticketNumber: '00011677',
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
    ticketNumber: null, dateTime: '2026-09-17T17:59:59.000Z',
    totalAmountMinor: 12345, items: [{ name: 'Хлеб', quantity: 2, unitPriceMinor: 6172, totalAmountMinor: 12345 }] })
  const exportDateFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bishkek' })
  const exportDateBefore = exportDateFormat.format(new Date())
  const exported = createReceiptWorkbook([first, second])
  const exportDateAfter = exportDateFormat.format(new Date())
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await exported.xlsx.writeBuffer())
  expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(['Receipts', 'Purchased items', 'Final'])
  const receipts = workbook.getWorksheet('Receipts')!
  const items = workbook.getWorksheet('Purchased items')!
  const final = workbook.getWorksheet('Final')!
  expect(receipts.rowCount).toBe(3)
  expect(items.rowCount).toBe(3)
  expect(receipts.getCell('A2').type).toBe(ExcelJS.ValueType.Date)
  expect((receipts.getCell('A2').value as Date).toISOString()).toBe('2026-09-18T00:00:00.000Z')
  expect((receipts.getCell('A3').value as Date).toISOString()).toBe('2026-09-17T00:00:00.000Z')
  expect(receipts.getCell('A2').numFmt).toBe('dd.mm.yyyy')
  expect(receipts.getCell('B1').value).toBe('Чек №')
  expect(receipts.getCell('B2').numFmt).toBe('@')
  expect(receipts.getCell('B3').value).toBeNull()
  expect(receipts.getCell('C2').value).toBe(first.merchant)
  expect(receipts.getCell('C2').type).toBe(ExcelJS.ValueType.String)
  expect(receipts.getCell('D2').value).toBe(first.merchantAddress)
  expect(receipts.getCell('E2').value).toBe(2.5)
  expect(receipts.getCell('E2').type).toBe(ExcelJS.ValueType.Number)
  expect(receipts.getCell('E2').numFmt).toMatch(/0\.00/)
  expect(receipts.getCell('E3').value).toBe(123.45)
  expect(receipts.getCell('F2').value).toBeNull()
  expect(receipts.getCell('F3').value).toBe(0)
  for (const [column, value] of Object.entries({ B: first.ticketNumber, G: first.tin, H: first.kkmNumber,
    I: first.fmNumber, J: first.fpd, K: first.fdNumber, M: first.id })) {
    expect(receipts.getCell(`${column}2`).value).toBe(value)
    expect(receipts.getCell(`${column}2`).type).toBe(ExcelJS.ValueType.String)
  }
  expect(receipts.getCell('L2').value).toMatchObject({ hyperlink: first.sourceUrl })
  expect(items.getCell('A2').value).toBe(first.id)
  expect(items.getCell('A3').value).toBe(second.id)
  expect(items.getCell('B2').value).toEqual(receipts.getCell('A2').value)
  expect(items.getCell('B2').numFmt).toBe('dd.mm.yyyy')
  expect(items.getCell('C1').value).toBe('Чек №')
  expect(items.getCell('C2').value).toBe(first.ticketNumber)
  expect(items.getCell('C2').type).toBe(ExcelJS.ValueType.String)
  expect(items.getCell('C2').numFmt).toBe('@')
  expect(items.getCell('C3').value).toBeNull()
  expect(items.getCell('D2').value).toBe(first.merchant)
  expect(items.getCell('E2').value).toBe('=Чай')
  expect(items.getCell('E2').type).toBe(ExcelJS.ValueType.String)
  expect(items.getCell('F2').value).toBe(0.25)
  expect(items.getCell('G2').value).toBe(10)
  expect(items.getCell('H2').value).toBe(2.5)
  expect(final.columnCount).toBe(7)
  expect(final.getRow(1).values).toEqual([undefined, 'No.', 'Type of Service', 'Merchant-INN',
    'Check Number', 'Date', 'Total amount (сом)', 'VAT amount (сом)'])
  expect(final.getCell('A2').value).toBe(1)
  expect(final.getCell('A3').value).toBe(2)
  expect(final.getCell('B2').value).toBeNull()
  expect(final.getCell('B3').value).toBeNull()
  expect(final.getCell('C2').value).toBe(`${first.merchant} - ${first.tin}`)
  expect(final.getCell('C2').type).toBe(ExcelJS.ValueType.String)
  expect(final.getCell('C3').value).toBe(`${second.merchant} - ${second.tin}`)
  expect(final.getCell('D2').value).toBe('00011677')
  expect(final.getCell('D2').type).toBe(ExcelJS.ValueType.String)
  expect(final.getCell('D2').numFmt).toBe('@')
  expect(final.getCell('D3').value).toBeNull()
  expect(final.getCell('E2').type).toBe(ExcelJS.ValueType.Date)
  expect(final.getCell('E2').value).toEqual(receipts.getCell('A2').value)
  expect(final.getCell('E3').value).toEqual(receipts.getCell('A3').value)
  expect(final.getCell('E2').numFmt).toBe('dd.mm.yyyy')
  expect(final.getCell('F2').value).toBe(2.5)
  expect(final.getCell('F2').type).toBe(ExcelJS.ValueType.Number)
  expect(final.getCell('F2').numFmt).toMatch(/0\.00/)
  expect(final.getCell('F3').value).toBe(123.45)
  expect(final.getCell('G2').value).toBeNull()
  expect(final.getCell('G3').value).toBe(0)
  expect(final.getCell('G3').type).toBe(ExcelJS.ValueType.Number)
  expect(final.getCell('G3').numFmt).toMatch(/0\.00/)
  expect(final.autoFilter).toBe('A1:G3')
  for (const row of [4, 5, 6]) expect(final.getRow(row).actualCellCount).toBe(0)
  expect(final.rowCount).toBe(8)
  expect(final.getCell('B7').value).toBe("Employee's signature:")
  expect(final.getCell('E7').value).toBe('Date')
  expect(final.getCell('E8').type).toBe(ExcelJS.ValueType.Date)
  expect(final.getCell('E8').numFmt).toBe('dd.mm.yyyy')
  expect([exportDateBefore, exportDateAfter]).toContain(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC' }).format(final.getCell('E8').value as Date),
  )
  for (const cell of ['B7', 'E7', 'E8']) {
    expect(final.getCell(cell).fill).not.toEqual(expect.objectContaining({ type: 'pattern', pattern: 'solid' }))
  }
})

test('Download Excel is disabled when empty and downloads imported data on a small screen', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-20T21:15:00.000Z'))
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
  expect((receipts.getCell('A2').value as Date).toISOString()).toBe('2026-09-17T00:00:00.000Z')
  expect(receipts.getCell('A2').numFmt).toBe('dd.mm.yyyy')
  expect(receipts.getCell('B2').value).toBe('191')
  expect(receipts.getCell('C2').value).toBe('Sample Market')
  expect(receipts.getCell('E2').value).toBe(919.5)
  expect(receipts.getCell('F2').value).toBe(97.65)
  expect(workbook.getWorksheet('Purchased items')!.rowCount).toBe(4)
  const final = workbook.getWorksheet('Final')!
  for (const [column, value] of Object.entries({ A: 1, B: null, C: 'Sample Market - 00000000000001',
    D: '191', E: new Date('2026-09-17T00:00:00.000Z'), F: 919.5, G: 97.65 })) {
    expect(final.getCell(`${column}2`).value).toEqual(value)
  }
  expect(final.getCell('B6').value).toBe("Employee's signature:")
  expect(final.getCell('E6').value).toBe('Date')
  expect((final.getCell('E7').value as Date).toISOString()).toBe('2026-09-21T00:00:00.000Z')
  expect(final.getCell('E7').numFmt).toBe('dd.mm.yyyy')
  expect(final.autoFilter).toBe('A1:G2')
  expect(final.getCell('B6').fill).not.toEqual(expect.objectContaining({ type: 'pattern', pattern: 'solid' }))
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
  expect(workbook.getWorksheet('Receipts')!.getCell('B2').value).toBe('191')
  expect(workbook.getWorksheet('Receipts')!.getCell('G2').value).toBe('00000000000001')
  expect(workbook.getWorksheet('Purchased items')!.getCell('C2').value).toBe('191')
  expect(workbook.getWorksheet('Purchased items')!.getCell('E2').value).toBe('Shaving foam')
  const final = workbook.getWorksheet('Final')!
  expect(final.getCell('A2').value).toBe(1)
  expect(final.getCell('B2').value).toBeNull()
  expect(final.getCell('C2').value).toBe('Sample Market - 00000000000001')
  expect(final.getCell('D2').value).toBe('191')
  expect(final.getCell('F2').value).toBe(919.5)
  expect(final.getCell('G2').value).toBe(97.65)
  expect(final.getCell('B6').value).toBe("Employee's signature:")
})

test('Final exports default, edited and custom merchant categories while leaving unknown merchants blank', async () => {
  const names = ['Магазин dns № 2', 'ОсОО «ГЛОБУС»', 'Аптека неман № 5',
    'АЗС BISHKEK   PETROLEUM № 7', 'Sample Market']
  const receipts = names.map((merchant, index) => receipt({ id: `category-${index}`, merchant }))
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await createReceiptWorkbook(receipts).xlsx.writeBuffer())
  const final = workbook.getWorksheet('Final')!
  for (const [index, category] of ['electronics', 'groceries', 'pharmacy', 'fuel', null].entries()) {
    expect(final.getCell(`B${index + 2}`).value).toBe(category)
  }

  const mappings = DEFAULT_MERCHANTS.map(mapping => mapping.key === 'DNS'
    ? { ...mapping, category: 'equipment' } : { ...mapping })
  mappings.push({ id: 'custom-market', key: 'Sample Market', category: 'office supplies' })
  const editedWorkbook = new ExcelJS.Workbook()
  await editedWorkbook.xlsx.load(await createReceiptWorkbook(receipts, mappings).xlsx.writeBuffer())
  expect(editedWorkbook.getWorksheet('Final')!.getCell('B2').value).toBe('equipment')
  expect(editedWorkbook.getWorksheet('Final')!.getCell('B6').value).toBe('office supplies')
})
