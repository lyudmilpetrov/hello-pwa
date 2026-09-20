import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import QRCode from 'qrcode'

type CameraHarness = {
  requests: MediaStreamConstraints[]
  created: number
  stopped: number
  frameReads: number
  releasePermission: () => void
}

declare global {
  interface Window {
    cameraHarness: CameraHarness
    reportCameraStopped?: () => Promise<void>
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
      releasePermission: () => {},
    }
    window.cameraHarness = harness
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
              void window.reportCameraStopped?.()
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

test('decodes a camera QR, stops the camera, and opens its website once in the current tab', async ({ page, context }) => {
  const receiptUrl = 'https://receipts.example.test/camera-receipt?total=219.00&source=qr'
  let receiptNavigations = 0
  let stoppedTracks = 0
  await page.exposeFunction('reportCameraStopped', () => { stoppedTracks += 1 })
  await page.route(receiptUrl, async (route) => {
    if (route.request().isNavigationRequest()) receiptNavigations += 1
    await route.fulfill({ contentType: 'text/html', body: '<h1>Camera receipt website</h1>' })
  })
  await installCamera(page, { payload: receiptUrl })
  await page.goto('./')
  await page.getByRole('button', { name: 'Take an image' }).click()
  await expect(page).toHaveURL(receiptUrl)
  await expect(page.getByRole('heading', { name: 'Camera receipt website' })).toBeVisible()
  await expect.poll(() => stoppedTracks).toBe(1)
  expect(receiptNavigations).toBe(1)
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
