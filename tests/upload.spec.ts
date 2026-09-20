import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import QRCode from 'qrcode'

const receiptUrl = 'https://receipts.example.test/receipt/123?total=219.00&source=qr'
const promotionUrl = 'https://promotion.example.test/'

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
  await page.route(url, (route) => route.fulfill({
    contentType: 'text/html',
    body: '<h1>Receipt website</h1>',
  }))
}

test('upload opens the decoded website in the current tab', async ({ page, context }) => {
  await stubReceiptPage(page)
  await page.goto('./')
  await chooseImage(page, await QRCode.toBuffer(receiptUrl, { width: 500 }))
  await expect(page).toHaveURL(receiptUrl)
  await expect(page.getByRole('heading', { name: 'Receipt website' })).toBeVisible()
  expect(context.pages()).toHaveLength(1)
})

test('can read a QR code offline after the app has been installed in the cache', async ({ page, context }) => {
  await stubReceiptPage(page)
  await page.goto('./')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
    }
  })
  await context.setOffline(true)
  await page.reload()
  // Intercept navigation: this verifies local scanning without requiring the website online.
  await chooseImage(page, await QRCode.toBuffer(receiptUrl, { width: 400 }))
  await expect(page).toHaveURL(receiptUrl)
})

test('prefers the receipt QR below a promotional QR', async ({ page }) => {
  await stubReceiptPage(page)
  await page.goto('./')
  await chooseImage(page, await receiptImage(page, [
    { value: promotionUrl, x: 350, y: 100, size: 180 },
    { value: receiptUrl, x: 110, y: 780, size: 380 },
  ]))
  await expect(page).toHaveURL(receiptUrl)
})

test('opens the bottom QR when both codes are in the lower half of the photo', async ({ page }) => {
  await stubReceiptPage(page)
  await page.goto('./')
  await chooseImage(page, await receiptImage(page, [
    { value: promotionUrl, x: 350, y: 620, size: 180 },
    { value: receiptUrl, x: 110, y: 850, size: 280 },
  ]))
  await expect(page).toHaveURL(receiptUrl)
})

test('opens the bottom QR when it crosses the middle of the photo', async ({ page }) => {
  await stubReceiptPage(page)
  await page.goto('./')
  await chooseImage(page, await receiptImage(page, [
    { value: promotionUrl, x: 350, y: 100, size: 180 },
    { value: receiptUrl, x: 110, y: 490, size: 300 },
  ]))
  await expect(page).toHaveURL(receiptUrl)
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
  await expect(page).toHaveURL(receiptUrl)
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
  test(`opens the fiscal receipt from sample ${sample}`, async ({ page }) => {
    test.skip(!existsSync(samplePath), 'Local receipt sample is not present in this checkout.')
    await page.route('**/*', async (route) => {
      const request = route.request()
      if (request.isNavigationRequest() && new URL(request.url()).hostname !== '127.0.0.1') {
        await route.fulfill({ contentType: 'text/html', body: '<h1>Receipt website</h1>' })
      } else {
        await route.continue()
      }
    })
    await page.goto('./')
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Upload file' }).click()
    await (await chooser).setFiles(samplePath)
    const receiptPage = page.getByRole('heading', { name: 'Receipt website' })
    const scanError = page.getByRole('alert')
    await expect(receiptPage.or(scanError)).toBeVisible({ timeout: 20000 })
    const errorMessage = await scanError.count() ? await scanError.textContent() : null
    expect(errorMessage, `Could not decode ${sample}`).toBeNull()
    const url = new URL(page.url())
    expect(['http:', 'https:']).toContain(url.protocol)
    expect(url.hostname).toBe('tax.salyk.kg')
    expect(url.pathname).toBe('/tax-web-control/client/api/v1/ticket')
    for (const key of ['date', 'sum', 'fn_number', 'regNumber', 'tin', 'fd_number', 'fm']) {
      expect(url.searchParams.has(key)).toBe(true)
    }
  })
}
