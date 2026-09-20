import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import QRCode from 'qrcode'

const receiptUrl = 'https://tax.salyk.kg/tax-web-control/client/api/v1/ticket?date=20260917T175623&sum=91950&fn_number=000000000000002&regNumber=000000000000003&tin=00000000000001&type=3&operation_type=1&fd_number=172045&fm=000000000000004'
const promotionUrl = 'https://promotion.example.test/'
const receiptFixture = JSON.parse(readFileSync(new URL('./fixtures/receipt.json', import.meta.url), 'utf8'))

type PositionedCode = { value: string; x: number; y: number; size: number; eraseCenter?: number }

async function receiptImage(page: Page, codes: PositionedCode[]) {
  const images = await Promise.all(codes.map(async ({ value, ...position }) => ({
    ...position,
    url: await QRCode.toDataURL(value, { width: position.size }),
  })))
  const dataUrl = await page.evaluate(async (images) => {
    const canvas = document.createElement('canvas')
    canvas.width = 600
    canvas.height = 1200
    const context = canvas.getContext('2d')!
    context.fillStyle = 'white'
    context.fillRect(0, 0, canvas.width, canvas.height)
    for (const { url, x, y, size, eraseCenter } of images) {
      const image = new Image()
      image.src = url
      await image.decode()
      context.drawImage(image, x, y)
      if (eraseCenter) {
        context.fillRect(x + (size - eraseCenter) / 2, y + (size - eraseCenter) / 2, eraseCenter, eraseCenter)
      }
    }
    return canvas.toDataURL('image/png').split(',')[1]
  }, images)
  return Buffer.from(dataUrl, 'base64')
}

async function chooseImage(page: Page, buffer: Buffer, name = 'receipt.png', mimeType = 'image/png') {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Upload file' }).click()
  await (await chooser).setFiles({ name, mimeType, buffer })
}

async function stubReceiptPage(page: Page, url = receiptUrl) {
  await page.route('**/api/receipts', (route) => {
    expect(route.request().method()).toBe('POST')
    expect(route.request().postDataJSON()).toEqual({ url })
    return route.fulfill({ json: receiptFixture })
  })
}

async function expectImported(page: Page) {
  await expect(page.getByRole('status')).toHaveText('Receipt added.')
  await expect(page.getByRole('cell', { name: 'Sample Market 1 Example Street, Bishkek' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'View receipt' })).toHaveAttribute('href', receiptUrl)
}

test('upload imports the decoded receipt into the table without leaving the app', async ({ page, context }) => {
  await stubReceiptPage(page)
  await page.goto('./')
  const appUrl = page.url()
  await chooseImage(page, await QRCode.toBuffer(receiptUrl, { width: 500 }), 'чек 01.png')
  await expectImported(page)
  await expect(page.getByRole('columnheader', { name: 'Feed', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'File - чек 01.png', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('cell', { name: 'File - чек 01.png', exact: true })).toBeVisible()
  await expect(page).toHaveURL(appUrl)
  expect(context.pages()).toHaveLength(1)
})

test('saved receipts are available after reloading offline', async ({ page, context }) => {
  await stubReceiptPage(page)
  await page.goto('./')
  await chooseImage(page, await QRCode.toBuffer(receiptUrl, { width: 400 }))
  await expectImported(page)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
    }
  })
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('cell', { name: 'Sample Market 1 Example Street, Bishkek' })).toBeVisible()
  await expect(page.getByRole('cell', { name: '97,65', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '191', exact: true })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Imported receipt information', exact: true }).locator('time')).toHaveText('17.09.2026')
})

test('prefers the receipt QR below a promotional QR', async ({ page }) => {
  await stubReceiptPage(page)
  await page.goto('./')
  await chooseImage(page, await receiptImage(page, [
    { value: promotionUrl, x: 350, y: 100, size: 180 },
    { value: receiptUrl, x: 110, y: 780, size: 380 },
  ]))
  await expectImported(page)
})

test('imports the bottom QR when both codes are in the lower half of the photo', async ({ page }) => {
  await stubReceiptPage(page)
  await page.goto('./')
  await chooseImage(page, await receiptImage(page, [
    { value: promotionUrl, x: 350, y: 620, size: 180 },
    { value: receiptUrl, x: 110, y: 850, size: 280 },
  ]))
  await expectImported(page)
})

test('imports the bottom QR when it crosses the middle of the photo', async ({ page }) => {
  await stubReceiptPage(page)
  await page.goto('./')
  await chooseImage(page, await receiptImage(page, [
    { value: promotionUrl, x: 350, y: 100, size: 180 },
    { value: receiptUrl, x: 110, y: 490, size: 300 },
  ]))
  await expectImported(page)
})

for (const value of ['1234567890', 'javascript:alert(1)']) {
  test(`does not open the promotion when the bottom QR is not a website: ${value}`, async ({ page }) => {
    await stubReceiptPage(page, promotionUrl)
    await page.goto('./')
    const appUrl = page.url()
    await chooseImage(page, await receiptImage(page, [
      { value: promotionUrl, x: 350, y: 100, size: 180 },
      { value, x: 110, y: 780, size: 380 },
    ]))
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Upload file' })).toBeEnabled()
    await expect(page).toHaveURL(appUrl)
  })
}

test('does not open the promotion when the bottom QR has a checksum error', async ({ page }) => {
  await stubReceiptPage(page, promotionUrl)
  await stubReceiptPage(page)
  await page.goto('./')
  const appUrl = page.url()
  await chooseImage(page, await receiptImage(page, [
    { value: promotionUrl, x: 350, y: 100, size: 180 },
    // Keep the finder squares visible while erasing enough data to fail its checksum.
    { value: receiptUrl, x: 110, y: 780, size: 380, eraseCenter: 160 },
  ]))
  await expect(page.getByRole('alert')).toContainText('The bottom QR code could not be read')
  await expect(page.getByRole('button', { name: 'Upload file' })).toBeEnabled()
  await expect(page).toHaveURL(appUrl)
})

for (const value of ['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/receipt', '1234567890']) {
  test(`rejects a QR payload that is not a website: ${value}`, async ({ page }) => {
    await page.goto('./')
    const appUrl = page.url()
    await chooseImage(page, await QRCode.toBuffer(value, { width: 400 }))
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Upload file' })).toBeEnabled()
    await expect(page).toHaveURL(appUrl)
  })
}

test('shows an error for an image without a QR code and allows another upload', async ({ page }) => {
  await stubReceiptPage(page)
  await page.goto('./')
  const blankImage = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 600
    canvas.height = 800
    const context = canvas.getContext('2d')!
    context.fillStyle = 'white'
    context.fillRect(0, 0, 600, 800)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await chooseImage(page, Buffer.from(blankImage, 'base64'))
  await expect(page.getByRole('alert')).toContainText(/QR|barcode/i)
  await expect(page.getByRole('button', { name: 'Upload file' })).toBeEnabled()
  await chooseImage(page, await QRCode.toBuffer(receiptUrl, { width: 400 }))
  await expectImported(page)
})

test('handles a corrupt image and lets the same file be selected again', async ({ page }) => {
  await page.goto('./')
  for (let attempt = 0; attempt < 2; attempt++) {
    await chooseImage(page, Buffer.from('not an image'))
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Upload file' })).toBeEnabled()
    await expect(page.getByLabel('Receipt image')).toHaveValue('')
  }
})

test('rejects a non-image file', async ({ page }) => {
  await page.goto('./')
  await chooseImage(page, Buffer.from('receipt text'), 'receipt.txt', 'text/plain')
  await expect(page.getByRole('alert')).toContainText(/image|photo/i)
  await expect(page.getByRole('button', { name: 'Upload file' })).toBeEnabled()
})

test('imports all receipt fields and purchased items into Redux and durable storage', async ({ page }) => {
  await stubReceiptPage(page)
  await page.goto('./')
  await page.getByLabel('Or paste a receipt link').fill(receiptUrl)
  await page.getByRole('button', { name: 'Import receipt', exact: true }).click()
  await expectImported(page)
  await expect(page.getByRole('columnheader', { name: 'Чек №', exact: true })).toBeVisible()
  for (const value of ['191', '919,50', '97,65', '00000000000001', '000000000000003', '000000000000002', '000000000000004', '172045']) {
    await expect(page.getByRole('cell', { name: value, exact: true })).toBeVisible()
  }
  await expect(page.getByRole('table', { name: 'Imported receipt information', exact: true }).locator('time')).toHaveText('17.09.2026')
  await page.getByText('Purchased items (3)', { exact: true }).click()
  await expect(page.getByRole('cell', { name: 'Shaving foam', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '509,70', exact: true })).toBeVisible()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('taxes.receipts.v1')!))
  expect(saved.receipts[0]).toMatchObject({
    sourceUrl: receiptUrl, ticketNumber: '191', merchant: 'Sample Market', totalAmountMinor: 91950,
    vatAmountMinor: 9765, tin: '00000000000001', kkmNumber: '000000000000003',
    fmNumber: '000000000000002', fpd: '000000000000004', fdNumber: '172045',
  })
  expect(saved.receipts[0].items).toHaveLength(3)
  await page.reload()
  await expect(page.getByRole('cell', { name: 'Sample Market 1 Example Street, Bishkek' })).toBeVisible()
})

test('reimport updates the existing receipt instead of adding a duplicate', async ({ page }) => {
  let imports = 0
  await page.route('**/api/receipts', (route) => route.fulfill({
    json: { ...receiptFixture, ticketTotalSum: ++imports === 1 ? 91950 : 100000 },
  }))
  await page.goto('./')
  for (let i = 0; i < 2; i++) {
    await page.getByLabel('Or paste a receipt link').fill(receiptUrl)
    await page.getByRole('button', { name: 'Import receipt', exact: true }).click()
    await expectImported(page)
  }
  await expect(page.getByRole('heading', { name: 'Receipts (1)', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: /1\s000,00/, exact: true })).toBeVisible()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('taxes.receipts.v1')!))
  expect(saved.receipts).toHaveLength(1)
  expect(saved.receipts[0].totalAmountMinor).toBe(100000)
})

test('failed receipt fetch can be retried without adding a partial record', async ({ page }) => {
  let attempts = 0
  await page.route('**/api/receipts', (route) => ++attempts === 1
    ? route.fulfill({ status: 502, json: { error: 'The receipt website is unavailable. Please try again.' } })
    : route.fulfill({ json: receiptFixture }))
  await page.goto('./')
  await page.getByLabel('Or paste a receipt link').fill(receiptUrl)
  await page.getByRole('button', { name: 'Import receipt', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('unavailable')
  await expect(page.getByRole('heading', { name: 'Receipts (0)', exact: true })).toBeVisible()
  await expect(page.getByLabel('Or paste a receipt link')).toHaveValue(receiptUrl)
  await page.getByRole('button', { name: 'Import receipt', exact: true }).click()
  await expectImported(page)
})

test('malformed receipt data does not create a table row', async ({ page }) => {
  await page.route('**/api/receipts', (route) => route.fulfill({ json: { error: 'Receipt not found' } }))
  await page.goto('./')
  await page.getByLabel('Or paste a receipt link').fill(receiptUrl)
  await page.getByRole('button', { name: 'Import receipt', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Receipts (0)', exact: true })).toBeVisible()
})

test('a populated receipt table scrolls inside a small viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await stubReceiptPage(page)
  await page.goto('./')
  await page.getByLabel('Or paste a receipt link').fill(receiptUrl)
  await page.getByRole('button', { name: 'Import receipt', exact: true }).click()
  await expectImported(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.getByRole('table', { name: 'Imported receipt information', exact: true }).evaluate((table) => {
    const container = table.parentElement!
    return container.scrollWidth > container.clientWidth
  })).toBe(true)
})

// Personal sample photos stay local. Generated QR tests above run in every checkout.
const samplesDirectory = fileURLToPath(new URL('../samples/', import.meta.url))
const samples = existsSync(samplesDirectory)
  ? readdirSync(samplesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(jpe?g|png|webp)$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  : []

for (const sample of samples) {
  const samplePath = join(samplesDirectory, sample)
  test(`imports the fiscal receipt from local receipt sample ${sample}`, async ({ page }) => {
    test.skip(!existsSync(samplePath), 'Local receipt sample is not present in this checkout.')
    let decodedUrl = ''
    await page.route('**/api/receipts', async (route) => {
      decodedUrl = route.request().postDataJSON().url
      await route.fulfill({ json: receiptFixture })
    })
    await page.goto('./')
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Upload file' }).click()
    await (await chooser).setFiles(samplePath)
    const receiptPage = page.getByRole('cell', { name: 'Sample Market 1 Example Street, Bishkek' })
    const scanError = page.getByRole('alert')
    await expect(receiptPage.or(scanError)).toBeVisible({ timeout: 20000 })
    const errorMessage = await scanError.count() ? await scanError.textContent() : null
    expect(errorMessage, `Could not decode ${sample}`).toBeNull()
    const url = new URL(decodedUrl)
    expect(['http:', 'https:']).toContain(url.protocol)
    expect(url.hostname).toBe('tax.salyk.kg')
    expect(url.pathname).toBe('/tax-web-control/client/api/v1/ticket')
    for (const key of ['date', 'sum', 'fn_number', 'regNumber', 'tin', 'fd_number', 'fm']) {
      expect(url.searchParams.has(key)).toBe(true)
    }
  })
}
