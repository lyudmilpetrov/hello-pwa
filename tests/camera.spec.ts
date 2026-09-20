import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import QRCode from 'qrcode'

const receiptUrl = 'https://tax.salyk.kg/tax-web-control/client/api/v1/ticket?date=20260917T175623&sum=91950&fn_number=000000000000002&regNumber=000000000000003&tin=00000000000001&type=3&operation_type=1&fd_number=172045&fm=000000000000004'
const receiptFixture = JSON.parse(readFileSync(new URL('./fixtures/receipt.json', import.meta.url), 'utf8'))

type CameraHarness = {
  requests: MediaStreamConstraints[]
  created: number
  stopped: number
  frameReads: number
  imports: { created: number; stopped: number }[]
  releasePermission: () => void
}

declare global {
  interface Window {
    cameraHarness: CameraHarness
  }
}

// Feed actual video frames through the browser and the production QR decoder.
// Only the camera hardware and permission prompt are replaced.
async function installCamera(page: Page, options: {
  payload?: string
  firstError?: 'NotAllowedError' | 'NotFoundError'
  pendingPermission?: boolean
} = {}) {
  const qr = options.payload
    ? await QRCode.toDataURL(options.payload, { width: 480, margin: 4 })
    : null
  await page.addInitScript(({ qr, firstError, pendingPermission }) => {
    const harness: CameraHarness = {
      requests: [],
      created: Number(sessionStorage.getItem('camera-created') || 0),
      stopped: Number(sessionStorage.getItem('camera-stopped') || 0),
      frameReads: 0,
      imports: [],
      releasePermission: () => {},
    }
    window.cameraHarness = harness
    const fetchReceipt = window.fetch.bind(window)
    window.fetch = (...args) => {
      if (typeof args[0] === 'string' && args[0].endsWith('/api/receipts')) {
        // Record camera state synchronously, before the real request starts.
        harness.imports.push({ created: harness.created, stopped: harness.stopped })
      }
      return fetchReceipt(...args)
    }
    const readPixels = CanvasRenderingContext2D.prototype.getImageData
    CanvasRenderingContext2D.prototype.getImageData = function (...args) {
      harness.frameReads += 1
      return readPixels.apply(this, args)
    }
    const permission = pendingPermission
      ? new Promise<void>((resolve) => { harness.releasePermission = resolve })
      : Promise.resolve()

    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async (constraints: MediaStreamConstraints) => {
        harness.requests.push(constraints)
        if (firstError && harness.requests.length === 1) {
          throw new DOMException('Camera unavailable in this test', firstError)
        }
        await permission
        const canvas = document.createElement('canvas')
        canvas.width = 640
        canvas.height = 640
        const drawing = canvas.getContext('2d')!
        let code: HTMLImageElement | null = null
        if (qr) {
          code = new Image()
          code.src = qr
          await code.decode()
        }
        const draw = () => {
          drawing.fillStyle = 'white'
          drawing.fillRect(0, 0, canvas.width, canvas.height)
          if (code) drawing.drawImage(code, 80, 80, 480, 480)
        }
        draw()
        const stream = canvas.captureStream(15)
        const timer = window.setInterval(draw, 60)
        for (const track of stream.getTracks()) {
          harness.created += 1
          sessionStorage.setItem('camera-created', String(harness.created))
          const stop = track.stop.bind(track)
          track.stop = () => {
            const wasLive = track.readyState === 'live'
            stop()
            window.clearInterval(timer)
            if (wasLive) {
              harness.stopped += 1
              sessionStorage.setItem('camera-stopped', String(harness.stopped))
            }
          }
        }
        return stream
      },
    })
  }, { qr, firstError: options.firstError, pendingPermission: options.pendingPermission })
}

async function openCamera(page: Page) {
  await page.goto('./')
  await page.getByRole('button', { name: 'Take an image' }).click()
  await expect(page.getByRole('dialog', { name: 'Scan receipt' })).toBeVisible()
}

async function expectLivePreview(page: Page) {
  const preview = page.getByLabel('Camera preview')
  await expect(preview).toBeVisible()
  await expect.poll(() => preview.evaluate((element) => (element as HTMLVideoElement).readyState))
    .toBeGreaterThanOrEqual(2)
}

async function expectStopped(page: Page, count = 1) {
  await expect.poll(() => page.evaluate(() => Number(sessionStorage.getItem('camera-stopped') || 0)))
    .toBe(count)
  expect(await page.evaluate(() => Number(sessionStorage.getItem('camera-created') || 0))).toBe(count)
}

test('camera QR stops the camera and imports the receipt once without leaving the app', async ({ page, context }) => {
  let imports = 0
  let releaseReceipt!: () => void
  const responseReady = new Promise<void>((resolve) => { releaseReceipt = resolve })
  await page.route('**/api/receipts', async (route) => {
    imports += 1
    expect(route.request().method()).toBe('POST')
    expect(route.request().postDataJSON()).toEqual({ url: receiptUrl })
    await responseReady
    await route.fulfill({ json: receiptFixture })
  })
  // Match Upload file's normalization of receipt URLs before calling the API.
  await installCamera(page, { payload: receiptUrl.replace('https:', 'http:') })
  await page.goto('./')
  const appUrl = page.url()
  await page.getByRole('button', { name: 'Take an image' }).click()
  try {
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('status')).toHaveText('Loading receipt…')
    await expectStopped(page)
    await expect.poll(() => imports).toBe(1)
    expect(await page.evaluate(() => window.cameraHarness.imports)).toEqual([{ created: 1, stopped: 1 }])
    await expect(page.getByRole('button', { name: 'Take an image' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Upload file' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Import receipt', exact: true })).toBeDisabled()
    await expect(page.getByRole('heading', { name: 'Receipts (0)', exact: true })).toBeVisible()
    await expect(page).toHaveURL(appUrl)
  } finally {
    releaseReceipt()
  }
  await expect(page.getByRole('status')).toHaveText('Receipt added.')
  await expect(page.getByRole('heading', { name: 'Receipts (1)', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Sample Market 1 Example Street, Bishkek' })).toBeVisible()
  for (const value of ['919,50', '97,65', '00000000000001', '172045']) {
    await expect(page.getByRole('cell', { name: value, exact: true })).toBeVisible()
  }
  await expect(page.getByRole('link', { name: 'View receipt' })).toHaveAttribute('href', receiptUrl)
  await expect(page.getByLabel('Or paste a receipt link')).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Take an image' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Take an image' })).toBeFocused()
  await expect(page.getByRole('button', { name: 'Upload file' })).toBeEnabled()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('taxes.receipts.v1')!))
  expect(saved.receipts).toHaveLength(1)
  expect(saved.receipts[0]).toMatchObject({
    sourceUrl: receiptUrl, merchant: 'Sample Market', totalAmountMinor: 91950,
    vatAmountMinor: 9765, tin: '00000000000001', fdNumber: '172045',
  })
  expect(saved.receipts[0].items).toHaveLength(3)
  await expect(page).toHaveURL(appUrl)
  expect(context.pages()).toHaveLength(1)
  expect(imports).toBe(1)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Receipts (1)', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Sample Market 1 Example Street, Bishkek' })).toBeVisible()
  await expect(page.getByRole('cell', { name: '97,65', exact: true })).toBeVisible()
  expect(imports).toBe(1)
})

test('a failed camera import keeps its link for retry without scanning again', async ({ page, context }) => {
  let attempts = 0
  await page.route('**/api/receipts', (route) => {
    expect(route.request().method()).toBe('POST')
    expect(route.request().postDataJSON()).toEqual({ url: receiptUrl })
    return ++attempts === 1
      ? route.fulfill({ status: 502, json: { error: 'The receipt website is unavailable. Please try again.' } })
      : route.fulfill({ json: receiptFixture })
  })
  await installCamera(page, { payload: receiptUrl })
  await page.goto('./')
  const appUrl = page.url()
  await page.getByRole('button', { name: 'Take an image' }).click()
  await expect(page.getByRole('alert')).toContainText('unavailable')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expectStopped(page)
  await expect(page.getByRole('heading', { name: 'Receipts (0)', exact: true })).toBeVisible()
  await expect(page.getByLabel('Or paste a receipt link')).toHaveValue(receiptUrl)
  await expect(page.getByRole('button', { name: 'Take an image' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Take an image' })).toBeFocused()
  expect(await page.evaluate(() => window.cameraHarness.requests.length)).toBe(1)
  expect(attempts).toBe(1)
  await page.getByRole('button', { name: 'Import receipt', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Receipt added.')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Receipts (1)', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Sample Market 1 Example Street, Bishkek' })).toBeVisible()
  await expect(page.getByLabel('Or paste a receipt link')).toHaveValue('')
  expect(await page.evaluate(() => window.cameraHarness.requests.length)).toBe(1)
  expect(attempts).toBe(2)
  await expect(page).toHaveURL(appUrl)
  expect(context.pages()).toHaveLength(1)
})

test('an unsupported receipt website from the camera is rejected without a request or navigation', async ({ page, context }) => {
  let imports = 0
  await page.route('**/api/receipts', (route) => {
    imports += 1
    return route.fulfill({ json: receiptFixture })
  })
  await installCamera(page, { payload: 'https://promotion.example.test/' })
  await page.goto('./')
  const appUrl = page.url()
  await page.getByRole('button', { name: 'Take an image' }).click()
  await expect(page.getByRole('alert')).toContainText('This link is not a tax.salyk.kg receipt')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expectStopped(page)
  await expect(page.getByRole('heading', { name: 'Receipts (0)', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Take an image' })).toBeEnabled()
  expect(await page.evaluate(() => window.cameraHarness.imports)).toEqual([])
  expect(imports).toBe(0)
  await expect(page).toHaveURL(appUrl)
  expect(context.pages()).toHaveLength(1)
})

test('shows a rear-camera preview on mobile and stops it when cancelled', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await installCamera(page)
  await openCamera(page)
  await expectLivePreview(page)
  expect(await page.evaluate(() => window.cameraHarness.requests)).toEqual([
    {
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    },
  ])
  await expect(page.getByRole('button', { name: 'Take an image', includeHidden: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Upload file', includeHidden: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expectStopped(page)
  await expect(page.getByRole('button', { name: 'Take an image' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Take an image' })).toBeFocused()
  await expect(page.getByRole('button', { name: 'Upload file' })).toBeEnabled()
})

test('Escape closes the scanner and stops its camera', async ({ page }) => {
  await installCamera(page)
  await openCamera(page)
  await expectLivePreview(page)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expectStopped(page)
  await expect(page.getByRole('button', { name: 'Take an image' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Take an image' })).toBeFocused()
})

test('stops the camera on pagehide and allows restarting after a cached page returns', async ({ page }) => {
  await installCamera(page)
  await openCamera(page)
  await expectLivePreview(page)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })))
  await expectStopped(page)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
  await expect(page.getByRole('alert')).toContainText('Camera paused')
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  await page.getByRole('button', { name: 'Try again' }).click()
  await expectLivePreview(page)
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await page.evaluate(() => window.cameraHarness.requests.length)).toBe(2)
  expect(await page.evaluate(() => window.cameraHarness.stopped)).toBe(1)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expectStopped(page, 2)
  await expect(page.getByRole('button', { name: 'Take an image' })).toBeFocused()
})

test('stops a late camera stream when cancelled during the permission prompt', async ({ page }) => {
  await installCamera(page, { pendingPermission: true })
  await openCamera(page)
  await expect.poll(() => page.evaluate(() => window.cameraHarness.requests.length)).toBe(1)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.evaluate(() => window.cameraHarness.releasePermission())
  await expectStopped(page)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Take an image' })).toBeEnabled()
})

for (const [error, message] of [
  ['NotAllowedError', /permission|allow|denied/i],
  ['NotFoundError', /not found|no camera|unavailable/i],
] as const) {
  test(`can retry the camera after ${error}`, async ({ page }) => {
    await installCamera(page, { firstError: error })
    await openCamera(page)
    await expect(page.getByRole('alert')).toContainText(message)
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    await page.getByRole('button', { name: 'Try again' }).click()
    await expectLivePreview(page)
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(await page.evaluate(() => window.cameraHarness.requests.length)).toBe(2)
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expectStopped(page)
  })
}

for (const payload of ['1234567890', 'javascript:alert(1)']) {
  test(`keeps scanning without navigating for a non-website QR: ${payload}`, async ({ page }) => {
    await installCamera(page, { payload })
    await openCamera(page)
    const appUrl = page.url()
    await expectLivePreview(page)
    // Wait for several actual scan frames so the assertion cannot pass before
    // the decoder has inspected the non-website payload.
    await expect.poll(() => page.evaluate(() => window.cameraHarness.frameReads)).toBeGreaterThanOrEqual(3)
    await expect(page).toHaveURL(appUrl)
    expect(await page.evaluate(() => window.cameraHarness.stopped)).toBe(0)
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expectStopped(page)
  })
}
