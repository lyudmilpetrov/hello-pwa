import { prepareZXingModule, purgeZXingModule, readBarcodes } from 'zxing-wasm/reader'
import readerWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

const MAX_FILE_BYTES = 30 * 1024 * 1024
const IMAGE_EXTENSION = /\.(avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|webp)$/i

type Region = { x: number; y: number; width: number; height: number }
type DetectedCode = { bounds: Region; text: string | null }

const readerOverrides = {
  // Ship the decoder with the app, including installations under a subpath.
  locateFile: () => readerWasmUrl,
}

function webUrl(value: string): string | null {
  const text = value.trim()
  if (!/^https?:\/\//i.test(text) || /\s/.test(text)) return null

  try {
    const url = new URL(text)
    return url.hostname && (url.protocol === 'http:' || url.protocol === 'https:')
      ? url.href
      : null
  } catch {
    return null
  }
}

function overlapsCode(a: Region, b: Region): boolean {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return width * height > Math.min(a.width * a.height, b.width * b.height) * 0.6
}

function receiptLink(codes: DetectedCode[]): string {
  // A crop can turn part of a QR into a very elongated checksum-error box. If
  // that box intersects a decoded code, it is not evidence of another lower QR.
  // Keep isolated unreadable codes so they still prevent a promotional fallback.
  const candidates = codes.filter((code) => {
    const a = code.bounds
    if (code.text !== null || Math.max(a.width, a.height) <= 4 * Math.min(a.width, a.height)) return true
    return !codes.some((other) => {
      const b = other.bounds
      return other.text !== null && a.x < b.x + b.width && b.x < a.x + a.width
        && a.y < b.y + b.height && b.y < a.y + a.height
    })
  })
  // Compare positions in the original photo, independent of scan order or crop.
  const bottom = candidates.reduce<DetectedCode | undefined>((lowest, code) =>
    !lowest || code.bounds.y + code.bounds.height / 2 > lowest.bounds.y + lowest.bounds.height / 2
      ? code
      : lowest, undefined)
  if (!bottom) {
    throw new Error('No QR code could be read. Try a clearer photo with the whole receipt QR code visible.')
  }

  // A later scale may decode the same code that failed at another scale. Never
  // substitute a different code higher on the receipt if the bottom one fails.
  const decoded = codes.find((code) => code.text !== null && overlapsCode(code.bounds, bottom.bounds))
  if (!decoded || decoded.text === null) {
    throw new Error('The bottom QR code could not be read. Try a closer, clearer photo with the receipt flat.')
  }
  const url = webUrl(decoded.text)
  if (!url) {
    throw new Error('The bottom QR code does not contain a valid website link (http or https). Choose a receipt with a website QR code.')
  }
  return url
}

/** Prepares a local QR reader once and reuses its canvas for live camera frames. */
export async function createReceiptFrameReader(): Promise<(video: HTMLVideoElement) => Promise<string | null>> {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    throw new Error('Your browser could not read the camera image. Please try another browser.')
  }

  try {
    await prepareZXingModule({ overrides: readerOverrides, fireImmediately: true })
  } catch {
    purgeZXingModule()
    throw new Error('The QR reader could not start. Reload the page and try again.')
  }

  return async (video) => {
    const width = video.videoWidth
    const height = video.videoHeight
    if (video.readyState < 2 || !width || !height) return null

    // Scan the whole frame so a lower receipt code takes precedence over any
    // promotional QR above it. Keep each frame under two million pixels.
    const scale = Math.min(1, 1400 / Math.max(width, height))
    const frameWidth = Math.max(1, Math.round(width * scale))
    const frameHeight = Math.max(1, Math.round(height * scale))
    if (canvas.width !== frameWidth) canvas.width = frameWidth
    if (canvas.height !== frameHeight) canvas.height = frameHeight

    let codes: Awaited<ReturnType<typeof readBarcodes>>
    try {
      context.drawImage(video, 0, 0, frameWidth, frameHeight)
      const pixels = context.getImageData(0, 0, frameWidth, frameHeight)
      codes = await readBarcodes(pixels, {
        formats: ['QRCode'],
        tryHarder: true,
        tryDenoise: true,
        returnErrors: true,
      })
    } catch {
      throw new Error('The camera QR reader stopped working. Close the camera and try again.')
    }

    const detectedCodes: DetectedCode[] = []
    for (const code of codes) {
      const corners = Object.values(code.position)
      const left = Math.min(...corners.map((point) => point.x))
      const top = Math.min(...corners.map((point) => point.y))
      const right = Math.max(...corners.map((point) => point.x))
      const bottom = Math.max(...corners.map((point) => point.y))
      if (right <= left || bottom <= top) continue
      detectedCodes.push({
        bounds: { x: left, y: top, width: right - left, height: bottom - top },
        text: code.isValid ? code.text : null,
      })
    }

    try {
      return receiptLink(detectedCodes)
    } catch {
      // A missing, unreadable, or non-website QR is normal while framing the
      // receipt. Keep scanning without falling back to a different, higher QR.
      return null
    }
  }
}

/** Reads a receipt QR code in this browser without uploading the image anywhere. */
export async function readReceiptUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/') && (file.type || !IMAGE_EXTENSION.test(file.name))) {
    throw new Error('Choose an image file, such as JPG, PNG or WebP.')
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('This image is too large. Choose an image smaller than 30 MB.')
  }

  const objectUrl = URL.createObjectURL(file)
  const image = new Image()
  const canvas = document.createElement('canvas')

  try {
    image.src = objectUrl
    try {
      await image.decode()
    } catch {
      throw new Error('This image could not be opened. Try saving it as JPG or PNG.')
    }

    const width = image.naturalWidth
    const height = image.naturalHeight
    if (!width || !height) {
      throw new Error('This image could not be opened. Try saving it as JPG or PNG.')
    }
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Your browser could not read this image. Please try another browser.')

    try {
      await prepareZXingModule({ overrides: readerOverrides, fireImmediately: true })
    } catch {
      purgeZXingModule()
      throw new Error('The QR reader could not start. Reload the page and try again.')
    }

    // Start with the receipt area, then scan the full photo and overlapping crops
    // to find codes that straddle a crop edge or need more image detail.
    const lowerHalf: Region = { x: 0, y: height * 0.5, width, height: height * 0.5 }
    const fullImage: Region = { x: 0, y: 0, width, height }
    const regions: Region[] = [lowerHalf, fullImage]
    for (const y of [0.4, 0]) {
      for (const x of [0, 0.4]) {
        regions.push({ x: width * x, y: height * y, width: width * 0.6, height: height * 0.6 })
      }
    }

    const detectedCodes: DetectedCode[] = []
    // Bound each canvas to at most 3.24 million pixels, even for large phone photos.
    // Multiple scales help with both tiny QR modules and blurred print on receipts.
    for (const region of regions) {
      for (const maxSide of [1400, 1800]) {
        const scale = Math.min(1, maxSide / Math.max(region.width, region.height))
        canvas.width = Math.max(1, Math.round(region.width * scale))
        canvas.height = Math.max(1, Math.round(region.height * scale))
        context.fillStyle = '#fff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(image, region.x, region.y, region.width, region.height, 0, 0, canvas.width, canvas.height)
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
        const codes = await readBarcodes(pixels, {
          formats: ['QRCode'],
          tryHarder: true,
          tryDenoise: true,
          returnErrors: true,
        })
        for (const code of codes) {
          const corners = Object.values(code.position)
          const left = Math.min(...corners.map((point) => point.x))
          const top = Math.min(...corners.map((point) => point.y))
          const right = Math.max(...corners.map((point) => point.x))
          const bottom = Math.max(...corners.map((point) => point.y))
          if (right <= left || bottom <= top) continue
          detectedCodes.push({
            bounds: {
              x: region.x + left * region.width / canvas.width,
              y: region.y + top * region.height / canvas.height,
              width: (right - left) * region.width / canvas.width,
              height: (bottom - top) * region.height / canvas.height,
            },
            text: code.isValid ? code.text : null,
          })
        }
        // Let progress updates paint before the next decoding attempt.
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        if (scale === 1) break
      }
    }

    return receiptLink(detectedCodes)
  } finally {
    URL.revokeObjectURL(objectUrl)
    image.src = ''
    canvas.width = 0
    canvas.height = 0
  }
}
