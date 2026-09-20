import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import QRCode from 'qrcode'

const receiptUrl = 'https://tax.salyk.kg/tax-web-control/client/api/v1/ticket?date=20260917T175623&sum=91950&fn_number=000000000000002&regNumber=000000000000003&tin=00000000000001&type=3&operation_type=1&fd_number=172045&fm=000000000000004'
const receiptFixture = JSON.parse(readFileSync(new URL('./fixtures/receipt.json', import.meta.url), 'utf8'))
const photoPath = fileURLToPath(new URL('../samples/qr/PXL_20260920_120718550.jpg', import.meta.url))
const photoReceiptUrl = 'https://tax.salyk.kg/tax-web-control/client/api/v1/ticket?date=20260907T170136&sum=406450&fn_number=0000000002427051&regNumber=0000000000300969&tin=00112200510239&type=3&operation_type=1&fd_number=45358&fm=216815068810378'

type CameraHarness = {
  requests: MediaStreamConstraints[]
  created: number
  stopped: number
  frameReads: number
  imports: { created: number; stopped: number }[]
  photoPickers: { created: number; stopped: number }[]
  appliedConstraints: MediaTrackConstraints[]
  nativeCalls: number
  nativeFormats: string[]
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
  imageData?: string
  width?: number
  height?: number
  cameraControls?: boolean
  firstError?: 'NotAllowedError' | 'NotFoundError' | 'OverconstrainedError'
  pendingPermission?: boolean
} = {}) {
  const qr = options.payload
    ? await QRCode.toDataURL(options.payload, { width: 480, margin: 4 })
    : null
  await page.addInitScript(({ qr, imageData, width, height, cameraControls, firstError, pendingPermission }) => {
    const harness: CameraHarness = {
      requests: [],
      created: Number(sessionStorage.getItem('camera-created') || 0),
      stopped: Number(sessionStorage.getItem('camera-stopped') || 0),
      frameReads: 0,
      imports: [],
      photoPickers: [],
      appliedConstraints: [],
      nativeCalls: 0,
      nativeFormats: [],
      releasePermission: () => {},
    }
    window.cameraHarness = harness
    const clickInput = HTMLInputElement.prototype.click
    HTMLInputElement.prototype.click = function () {
      if (this.type === 'file' && this.getAttribute('capture') === 'environment') {
        harness.photoPickers.push({ created: harness.created, stopped: harness.stopped })
      }
      clickInput.call(this)
    }
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
        canvas.width = width ?? 640
        canvas.height = height ?? 640
        const drawing = canvas.getContext('2d')!
        let code: HTMLImageElement | null = null
        if (imageData || qr) {
          code = new Image()
          code.src = imageData || qr!
          await code.decode()
        }
        const draw = () => {
          drawing.fillStyle = 'white'
          drawing.fillRect(0, 0, canvas.width, canvas.height)
          if (code && imageData) {
            // Show the entire photo as a camera frame. The production decoder
            // must find the receipt QR itself; the harness never crops it.
            const scale = Math.min(canvas.width / code.naturalWidth, canvas.height / code.naturalHeight)
            const imageWidth = code.naturalWidth * scale
            const imageHeight = code.naturalHeight * scale
            drawing.drawImage(code, (canvas.width - imageWidth) / 2, (canvas.height - imageHeight) / 2, imageWidth, imageHeight)
          } else if (code) drawing.drawImage(code, 80, 80, 480, 480)
        }
        draw()
        const stream = canvas.captureStream(15)
        const timer = window.setInterval(draw, 60)
        for (const track of stream.getTracks()) {
          if (cameraControls) {
            let currentConstraints: MediaTrackConstraints = {}
            let currentSettings = { focusMode: 'manual', torch: false, zoom: 1 }
            Object.defineProperties(track, {
              getCapabilities: { value: () => ({ focusMode: ['manual', 'continuous'], torch: [true, false], zoom: { min: 1, max: 4, step: 0.5 } }) },
              getSettings: { value: () => ({ ...currentSettings }) },
              getConstraints: { value: () => structuredClone(currentConstraints) },
              applyConstraints: { value: async (next: MediaTrackConstraints) => {
                harness.appliedConstraints.push(structuredClone(next))
                currentConstraints = structuredClone(next)
                currentSettings = Object.assign({}, currentSettings, ...(next.advanced ?? []))
              } },
            })
          }
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
  }, { qr, imageData: options.imageData, width: options.width, height: options.height, cameraControls: options.cameraControls, firstError: options.firstError, pendingPermission: options.pendingPermission })
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

function expectPhotoReceiptUrl(value: string) {
  const actual = new URL(value)
  const expected = new URL(photoReceiptUrl)
  expect(`${actual.origin}${actual.pathname}`).toBe(`${expected.origin}${expected.pathname}`)
  expect([...actual.searchParams.entries()].sort()).toEqual([...expected.searchParams.entries()].sort())
}

for (const [width, height] of [[960, 1280], [1280, 1707], [1920, 2560]]) {
  test(`finds the receipt QR in an uncropped real-photo camera frame at ${width}x${height}`, async ({ page }) => {
    test.skip(!existsSync(photoPath), 'The private receipt sample is not present in this checkout.')
    test.setTimeout(60000)
    const importedUrls: string[] = []
    await page.route('**/api/receipts', async (route) => {
      expect(route.request().method()).toBe('POST')
      const { url } = route.request().postDataJSON() as { url: string }
      expectPhotoReceiptUrl(url)
      importedUrls.push(url)
      await route.fulfill({ json: receiptFixture })
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await installCamera(page, {
      imageData: `data:image/jpeg;base64,${readFileSync(photoPath).toString('base64')}`,
      width,
      height,
    })
    await page.goto('./')
    const appUrl = page.url()
    await page.getByRole('button', { name: 'Take an image' }).click()
    await expect(page.getByRole('heading', { name: 'Receipts (1)', exact: true })).toBeVisible({ timeout: 45000 })
    await expect(page.getByRole('status')).toHaveText('Receipt added.')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expectStopped(page)
    expect(importedUrls).toHaveLength(1)
    expect(await page.evaluate(() => window.cameraHarness.imports)).toEqual([{ created: 1, stopped: 1 }])
    await expect(page.getByRole('link', { name: 'View receipt' })).toHaveAttribute('href', importedUrls[0])
    await expect(page).toHaveURL(appUrl)
  })
}

test('Take a photo instead releases the live camera before opening the native photo chooser and imports its photo', async ({ page }) => {
  test.skip(!existsSync(photoPath), 'The private receipt sample is not present in this checkout.')
  test.setTimeout(60000)
  const importedUrls: string[] = []
  await page.route('**/api/receipts', async (route) => {
    expect(route.request().method()).toBe('POST')
    const { url } = route.request().postDataJSON() as { url: string }
    expectPhotoReceiptUrl(url)
    importedUrls.push(url)
    await route.fulfill({ json: receiptFixture })
  })
  await installCamera(page)
  await openCamera(page)
  await expectLivePreview(page)
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Take a photo instead' }).click(),
  ])
  expect(await chooser.element().getAttribute('accept')).toBe('image/*')
  expect(await chooser.element().getAttribute('capture')).toBe('environment')
  expect(await page.evaluate(() => window.cameraHarness.photoPickers)).toEqual([{ created: 1, stopped: 1 }])
  await expectStopped(page)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await chooser.setFiles(photoPath)
  await expect(page.getByRole('status')).toHaveText('Receipt added.', { timeout: 45000 })
  await expect(page.getByRole('heading', { name: 'Receipts (1)', exact: true })).toBeVisible()
  expect(importedUrls).toHaveLength(1)
  expect(await page.evaluate(() => window.cameraHarness.requests.length)).toBe(1)
  await expect(page.getByRole('link', { name: 'View receipt' })).toHaveAttribute('href', importedUrls[0])
})

for (const status of [404, 405]) {
  test(`a camera scan explains an unavailable HTML ${status} backend and preserves the original receipt`, async ({ page }) => {
    let imports = 0
    await page.route('**/api/receipts', (route) => {
      imports += 1
      expect(route.request().postDataJSON()).toEqual({ url: receiptUrl })
      return route.fulfill({ status, contentType: 'text/html', body: '<!doctype html><title>Page not found</title>' })
    })
    await installCamera(page, { payload: receiptUrl })
    await page.goto('./')
    const appUrl = page.url()
    await page.getByRole('button', { name: 'Take an image' }).click()
    await expect(page.getByRole('alert')).toContainText('Receipt importing is not available')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expectStopped(page)
    await expect(page.getByLabel('Or paste a receipt link')).toHaveValue(receiptUrl)
    await expect(page.getByRole('link', { name: 'Open original receipt' })).toHaveAttribute('href', receiptUrl)
    await expect(page.getByRole('link', { name: 'Open original receipt' })).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(page.getByRole('heading', { name: 'Receipts (0)', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import receipt', exact: true })).toBeEnabled()
    expect(imports).toBe(1)
    await expect(page).toHaveURL(appUrl)
  })
}

for (const nativeFails of [false, true]) {
  test(nativeFails
    ? 'uses the bundled QR decoder when the native barcode API rejects a frame'
    : 'imports a QR returned by the native mobile barcode API', async ({ page }) => {
    let imports = 0
    await page.route('**/api/receipts', (route) => {
      imports += 1
      expect(route.request().postDataJSON()).toEqual({ url: receiptUrl })
      return route.fulfill({ json: receiptFixture })
    })
    await installCamera(page, { payload: nativeFails ? receiptUrl : undefined })
    await page.addInitScript(({ nativeFails, receiptUrl }) => {
      Object.defineProperty(window, 'BarcodeDetector', {
        configurable: true,
        value: class {
          static async getSupportedFormats() { return ['qr_code'] }
          constructor({ formats }: { formats: string[] }) { window.cameraHarness.nativeFormats = formats }
          async detect(source: HTMLCanvasElement) {
            window.cameraHarness.nativeCalls += 1
            if (nativeFails) throw new Error('The platform barcode service is unavailable.')
            return [{ rawValue: receiptUrl, boundingBox: { x: source.width * 0.3, y: source.height * 0.3, width: 100, height: 100 } }]
          }
        },
      })
    }, { nativeFails, receiptUrl })
    await page.goto('./')
    await page.getByRole('button', { name: 'Take an image' }).click()
    await expect(page.getByRole('status')).toHaveText('Receipt added.')
    await expect(page.getByRole('heading', { name: 'Receipts (1)', exact: true })).toBeVisible()
    await expectStopped(page)
    expect(await page.evaluate(() => window.cameraHarness.nativeFormats)).toEqual(['qr_code'])
    expect(await page.evaluate(() => window.cameraHarness.nativeCalls)).toBeGreaterThan(0)
    if (nativeFails) expect(await page.evaluate(() => window.cameraHarness.frameReads)).toBeGreaterThan(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(imports).toBe(1)
  })
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
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    },
  ])
  await expect(page.getByRole('button', { name: 'Take an image', includeHidden: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Upload file', includeHidden: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Turn light on' })).toHaveCount(0)
  await expect(page.getByRole('slider', { name: 'Zoom' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expectStopped(page)
  await expect(page.getByRole('button', { name: 'Take an image' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Take an image' })).toBeFocused()
  await expect(page.getByRole('button', { name: 'Upload file' })).toBeEnabled()
})

test('uses mobile autofocus, light and zoom when the camera supports them', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installCamera(page, { cameraControls: true })
  await openCamera(page)
  await expectLivePreview(page)
  await expect.poll(() => page.evaluate(() => window.cameraHarness.appliedConstraints))
    .toEqual([{ advanced: [{ focusMode: 'continuous' }] }])
  const lightOn = page.getByRole('button', { name: 'Turn light on' })
  await expect(lightOn).toHaveAttribute('aria-pressed', 'false')
  await lightOn.click()
  const lightOff = page.getByRole('button', { name: 'Turn light off' })
  await expect(lightOff).toBeEnabled()
  await expect(lightOff).toHaveAttribute('aria-pressed', 'true')
  const zoom = page.getByRole('slider', { name: 'Zoom' })
  await expect(zoom).toHaveAttribute('min', '1')
  await expect(zoom).toHaveAttribute('max', '4')
  await expect(zoom).toHaveAttribute('step', '0.5')
  await zoom.focus()
  await zoom.press('End')
  await expect(zoom).toHaveValue('4')
  await expect.poll(() => page.evaluate(() => window.cameraHarness.appliedConstraints.at(-1)))
    .toEqual({ advanced: [{ focusMode: 'continuous', torch: true, zoom: 4 }] })
  await lightOff.click()
  await expect(page.getByRole('button', { name: 'Turn light on' })).toBeEnabled()
  await expect.poll(() => page.evaluate(() => window.cameraHarness.appliedConstraints.at(-1)))
    .toEqual({ advanced: [{ focusMode: 'continuous', torch: false, zoom: 4 }] })
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expectStopped(page)
})

test('retries without requested dimensions when a mobile camera rejects them', async ({ page }) => {
  await installCamera(page, { firstError: 'OverconstrainedError' })
  await openCamera(page)
  await expectLivePreview(page)
  expect(await page.evaluate(() => window.cameraHarness.requests)).toEqual([
    { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
    { audio: false, video: { facingMode: { ideal: 'environment' } } },
  ])
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expectStopped(page)
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
