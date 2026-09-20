import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import QRCode from 'qrcode'

const receiptUrl = 'https://tax.salyk.kg/tax-web-control/client/api/v1/ticket?date=20260917T175623&sum=91950&fn_number=000000000000002&regNumber=000000000000003&tin=00000000000001&type=3&operation_type=1&fd_number=172045&fm=000000000000004'
const receiptFixture = JSON.parse(readFileSync(new URL('./fixtures/receipt.json', import.meta.url), 'utf8'))

type UploadFile = { name: string; mimeType: string; buffer: Buffer }
type ImageGate = typeof globalThis & { releaseNextReceiptImage: () => void; receiptImagesOpened: number }

function receipt(index: number) {
  const url = new URL(receiptUrl)
  url.searchParams.set('fd_number', String(172045 + index))
  return {
    url: url.href,
    data: {
      ...receiptFixture,
      id: `batch-receipt-${index}`,
      ticketNumber: 191 + index,
      fdNumber: 172045 + index,
      ticketTotalSum: 91950 + index * 100,
      crData: { ...receiptFixture.crData, locationName: `Batch Market ${index}` },
      taxCounters: [{ type: 'VAT', code: 1, sum: 9765 + index, rate: 12 }],
      items: [{ goodName: `Batch item ${index}`, goodQuantity: 2, goodPrice: 2500 + index, goodCost: 5000 + index * 2 }],
    },
  }
}

async function qrFile(url: string, name: string): Promise<UploadFile> {
  return { name, mimeType: 'image/png', buffer: await QRCode.toBuffer(url, { width: 500 }) }
}

async function chooseImages(page: Page, files: UploadFile[]) {
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Upload files', exact: true }).click()
  const chooser = await chooserPromise
  expect(chooser.isMultiple()).toBe(true)
  await chooser.setFiles(files)
}

async function expectBusy(page: Page) {
  await expect(page.getByRole('button', { name: 'Upload files', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Take an image', exact: true })).toBeDisabled()
  await expect(page.getByLabel('Receipt images', { exact: true })).toBeDisabled()
  await expect(page.getByLabel('Or paste a receipt link')).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Import receipt', exact: true })).toBeDisabled()
}

test('selects multiple images, persists each receipt and allows the same batch to be selected again', async ({ page }) => {
  const receipts = [receipt(1), receipt(2)]
  const requestedUrls: string[] = []
  await page.route('**/api/receipts', async (route) => {
    const { url } = route.request().postDataJSON()
    requestedUrls.push(url)
    expect(route.request().method()).toBe('POST')
    const match = receipts.find((entry) => entry.url === url)
    expect(match).toBeDefined()
    await route.fulfill({ json: match!.data })
  })
  await page.goto('./')
  const totals = page.getByLabel('Collected receipt totals').locator('dd')
  await expect(totals).toHaveText(['0,00 сом', '0,00 сом'])
  const files = await Promise.all(receipts.map((entry, index) => qrFile(entry.url, `receipt-${index + 1}.png`)))

  for (let attempt = 0; attempt < 2; attempt++) {
    await chooseImages(page, files)
    await expect(page.getByRole('status')).toHaveText('2 files imported.')
    await expect(page.getByRole('heading', { name: 'Receipts (2)', exact: true })).toBeVisible()
    await expect(totals).toHaveText(['1 842,00 сом', '195,33 сом'])
    await expect(page.getByLabel('Receipt images', { exact: true })).toHaveValue('')
    await expect(page.getByRole('button', { name: 'Upload files', exact: true })).toBeEnabled()
    expect(requestedUrls).toEqual(Array.from({ length: attempt + 1 }, () => receipts.map((entry) => entry.url)).flat())
  }

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('taxes.receipts.v1')!))
  expect(saved.receipts).toHaveLength(2)
  for (const [index, { url, data }] of receipts.entries()) {
    expect(saved.receipts).toContainEqual(expect.objectContaining({
      id: data.id,
      sourceUrl: url,
      feed: `File - ${files[index].name}`,
      ticketNumber: String(data.ticketNumber),
      fdNumber: String(data.fdNumber),
      merchant: data.crData.locationName,
      totalAmountMinor: data.ticketTotalSum,
      vatAmountMinor: data.taxCounters[0].sum,
      items: [{
        name: data.items[0].goodName,
        quantity: 2,
        unitPriceMinor: data.items[0].goodPrice,
        totalAmountMinor: data.items[0].goodCost,
      }],
    }))
  }
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Receipts (2)', exact: true })).toBeVisible()
  await expect(totals).toHaveText(['1 842,00 сом', '195,33 сом'])
  for (const [index, { data }] of receipts.entries()) {
    const merchant = page.getByRole('cell', { name: `${data.crData.locationName} 1 Example Street, Bishkek`, exact: true })
    await expect(merchant).toBeVisible()
    await expect(page.getByRole('row').filter({ has: merchant }).getByRole('cell', { name: `File - ${files[index].name}`, exact: true })).toBeVisible()
  }
  await expect(page.getByRole('link', { name: 'View receipt', exact: true })).toHaveCount(2)
})

test('continues after decode and API failures and keeps errors associated with their files', async ({ page }) => {
  const receipts = [receipt(1), receipt(2), receipt(3)]
  const brokenFilename = `${'broken'.repeat(17)}.png`
  const requestedUrls: string[] = []
  await page.route('**/api/receipts', async (route) => {
    const { url } = route.request().postDataJSON()
    requestedUrls.push(url)
    if (url === receipts[1].url) {
      await route.fulfill({ status: 502, json: { error: 'The receipt website is unavailable. Please try again.' } })
      return
    }
    const match = receipts.find((entry) => entry.url === url)
    expect(match).toBeDefined()
    await route.fulfill({ json: match!.data })
  })
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('./')
  await chooseImages(page, [
    await qrFile(receipts[0].url, 'first.png'),
    { name: brokenFilename, mimeType: 'image/png', buffer: Buffer.from('not an image') },
    await qrFile(receipts[1].url, 'unavailable.png'),
    await qrFile(receipts[2].url, 'last.png'),
  ])

  await expect(page.getByRole('status')).toHaveText('2 of 4 files imported. 2 failed.')
  const failures = page.getByRole('alert').getByRole('listitem')
  await expect(failures).toHaveCount(2)
  const decodeFailure = failures.filter({ hasText: brokenFilename })
  const apiFailure = failures.filter({ hasText: 'unavailable.png' })
  await expect(decodeFailure).toContainText('This image could not be opened')
  await expect(decodeFailure.getByRole('link')).toHaveCount(0)
  await expect(apiFailure).toContainText('The receipt website is unavailable. Please try again.')
  await expect(apiFailure.getByRole('link', { name: 'Open original receipt', exact: true })).toHaveAttribute('href', receipts[1].url)
  const originalLinks = page.getByRole('link', { name: 'Open original receipt', exact: true })
  await expect(originalLinks).toHaveCount(1)
  await expect(originalLinks).toHaveAttribute('href', receipts[1].url)
  await expect(page.getByRole('heading', { name: 'Receipts (2)', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Upload files', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Take an image', exact: true })).toBeEnabled()
  await expect(page.getByLabel('Or paste a receipt link')).toBeEnabled()
  await expect(page.getByLabel('Or paste a receipt link')).toHaveValue(receipts[1].url)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(requestedUrls).toEqual(receipts.map((entry) => entry.url))
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('taxes.receipts.v1')!))
  expect(saved.receipts.map((entry: { id: string }) => entry.id).sort()).toEqual([receipts[0].data.id, receipts[2].data.id])
})

test('processes files sequentially and keeps controls disabled while showing each file progress', async ({ page }) => {
  // Gate image decoding without replacing the decoder, so both scanning and API
  // phases remain observable even on fast machines.
  await page.addInitScript(() => {
    const originalDecode = HTMLImageElement.prototype.decode
    const releases: (() => void)[] = []
    const gate = globalThis as ImageGate
    gate.receiptImagesOpened = 0
    gate.releaseNextReceiptImage = () => releases.shift()?.()
    HTMLImageElement.prototype.decode = async function () {
      await originalDecode.call(this)
      if (this.src.startsWith('blob:')) {
        gate.receiptImagesOpened++
        await new Promise<void>((resolve) => releases.push(resolve))
      }
    }
  })
  const receipts = [receipt(1), receipt(2)]
  const requests: Route[] = []
  await page.route('**/api/receipts', (route) => { requests.push(route) })
  await page.goto('./')
  await chooseImages(page, await Promise.all(receipts.map((entry, index) => qrFile(entry.url, `receipt-${index + 1}.png`))))

  for (let index = 0; index < receipts.length; index++) {
    await expect(page.getByRole('status')).toHaveText(`Reading barcode… File ${index + 1} of 2: receipt-${index + 1}.png`)
    await expectBusy(page)
    await expect.poll(() => page.evaluate(() => (globalThis as ImageGate).receiptImagesOpened)).toBe(index + 1)
    expect(requests).toHaveLength(index)
    await page.evaluate(() => (globalThis as ImageGate).releaseNextReceiptImage())
    await expect.poll(() => requests.length).toBe(index + 1)
    await expect(page.getByRole('status')).toHaveText(`Loading receipt… File ${index + 1} of 2: receipt-${index + 1}.png`)
    await expectBusy(page)
    expect(await page.evaluate(() => (globalThis as ImageGate).receiptImagesOpened)).toBe(index + 1)
    expect(requests[index].request().postDataJSON()).toEqual({ url: receipts[index].url })
    await requests[index].fulfill({ json: receipts[index].data })
  }

  await expect(page.getByRole('status')).toHaveText('2 files imported.')
  await expect(page.getByRole('button', { name: 'Upload files', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Take an image', exact: true })).toBeEnabled()
  await expect(page.getByLabel('Receipt images', { exact: true })).toBeEnabled()
  await expect(page.getByLabel('Or paste a receipt link')).toBeEnabled()
  await expect(page.getByRole('heading', { name: 'Receipts (2)', exact: true })).toBeVisible()
})
