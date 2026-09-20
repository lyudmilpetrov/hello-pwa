import { createServer } from 'vite'
import { chromium } from '@playwright/test'

const server = await createServer({ configFile: false, cacheDir: '.qr-decoder-cache', optimizeDeps: { noDiscovery: true, include: ['zxing-wasm/reader'] }, server: { host: '127.0.0.1', port: 4186, strictPort: true } })
await server.listen()
let browser
try {
  browser = await chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage()
  await page.route('http://127.0.0.1:4186/', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }))
  await page.goto('http://127.0.0.1:4186/')
  const results = await page.evaluate(async () => {
    const { readReceiptUrl, createReceiptFrameReader } = await import('/src/lib/receiptBarcode.ts')
    const { prepareZXingModule, readBarcodes } = await import('/node_modules/zxing-wasm/dist/es/reader/index.js')
    await prepareZXingModule({ overrides: { locateFile: () => '/node_modules/zxing-wasm/dist/reader/zxing_reader.wasm' }, fireImmediately: true })
    const sample = await (await fetch('/samples/qr/PXL_20260920_120718550.jpg')).blob()
    const expected = 'https://tax.salyk.kg/tax-web-control/client/api/v1/ticket?date=20260907T170136&sum=406450&fn_number=0000000002427051&regNumber=0000000000300969&tin=00112200510239&type=3&operation_type=1&fd_number=45358&fm=216815068810378'
    const results = { native: 'BarcodeDetector' in window, upload: null, frames: [] }
    const start = performance.now()
    try { results.upload = { matched: (await readReceiptUrl(new File([sample], 'receipt.jpg', { type: 'image/jpeg' }))) === expected, milliseconds: Math.round(performance.now() - start) } }
    catch (error) { results.upload = { error: error.message } }
    const image = new Image()
    image.src = URL.createObjectURL(sample)
    await image.decode()
    for (const width of [720, 960, 1280, 1920, 3000]) {
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = Math.round(width * 4 / 3)
      const context = canvas.getContext('2d')
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const stream = canvas.captureStream(10)
      const video = document.createElement('video')
      video.muted = true; video.srcObject = stream
      await video.play()
      const reader = await createReceiptFrameReader()
      const started = performance.now()
      try { results.frames.push({ width, height: canvas.height, matched: (await reader(video)) === expected, milliseconds: Math.round(performance.now() - started) }) }
      catch (error) { results.frames.push({ width, error: error.message }) }
      const matrix = []
      for (const [x, y, w, h] of [[0, 0, 1, 1], [0, .5, 1, .5], [0, .4, 1, .6], [0, .4, .6, .6]]) {
        for (const maxSide of [960, 1280, 1400, 1600, 1800]) {
          const scan = document.createElement('canvas')
          const dw = canvas.width * w, dh = canvas.height * h
          const scale = Math.min(1, maxSide / Math.max(dw, dh))
          scan.width = Math.round(dw * scale); scan.height = Math.round(dh * scale)
          const scanContext = scan.getContext('2d')
          scanContext.drawImage(video, canvas.width*x, canvas.height*y, dw, dh, 0, 0, scan.width, scan.height)
          const codes = await readBarcodes(scanContext.getImageData(0,0,scan.width,scan.height), { formats:['QRCode'],tryHarder:true,tryDenoise:true,returnErrors:true })
          matrix.push({region:[x,y,w,h], maxSide, found: codes.map(c => ({valid:c.isValid,match:c.text===expected,error:c.error, position:c.position}))})
          if(scale === 1) break
        }
      }
      results.frames[results.frames.length-1].matrix = matrix
      stream.getTracks().forEach((track) => track.stop())
    }
    URL.revokeObjectURL(image.src)
    return results
  })
  console.log(JSON.stringify(results, null, 2))
} finally {
  await browser?.close()
  await server.close()
}
