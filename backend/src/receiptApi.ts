import type { IncomingMessage, ServerResponse } from 'node:http'

const RECEIPT_ENDPOINT = 'https://tax.salyk.kg/tax-web-control/client/api/v1/ticket'
const QUERY_KEYS = ['date', 'sum', 'fn_number', 'regNumber', 'tin', 'type', 'operation_type', 'fd_number', 'fm']
const MAX_REQUEST_BYTES = 8192
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

type FetchReceipt = typeof fetch
type ApiOptions = { basePath?: string; allowedOrigins?: string[]; fetchImpl?: FetchReceipt; timeoutMs?: number }

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function normalizeBasePath(value = '/'): string {
  if (!value.startsWith('/') || value.includes('..') || /[?#\\]/.test(value)) {
    throw new Error('BASE_PATH must be an absolute URL path, such as /hello-pwa/.')
  }
  return value.endsWith('/') ? value : `${value}/`
}

export function normalizeReceiptUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || /\s/.test(value)) {
    throw new ApiError(400, 'Choose a QR code containing a valid Kyrgyz tax receipt link.')
  }
  let url: URL
  try { url = new URL(value) } catch {
    throw new ApiError(400, 'Choose a QR code containing a valid Kyrgyz tax receipt link.')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.host !== 'tax.salyk.kg'
    || url.pathname !== '/tax-web-control/client/api/v1/ticket'
    || url.username || url.password || url.hash) {
    throw new ApiError(400, 'Only links to the Kyrgyz tax receipt service are supported.')
  }
  if ([...url.searchParams.keys()].some((key) => !QUERY_KEYS.includes(key))) {
    throw new ApiError(400, 'The receipt link contains unsupported parameters.')
  }
  // Rebuild from a fixed destination; incoming identifiers keep their leading zeros.
  const normalized = new URL(RECEIPT_ENDPOINT)
  for (const key of QUERY_KEYS) {
    const values = url.searchParams.getAll(key)
    // Let the tax service determine whether the supplied receipt fields suffice.
    if (values.length === 0) continue
    const valid = key === 'date' ? /^\d{8}T\d{6}$/ : /^\d{1,32}$/
    if (values.length !== 1 || !valid.test(values[0])) {
      throw new ApiError(400, 'The receipt link is missing valid receipt parameters.')
    }
    normalized.searchParams.set(key, values[0])
  }
  return normalized.href
}

function readBody(request: IncomingMessage, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let length = 0
    const timer = setTimeout(() => fail(new ApiError(408, 'The upload request took too long. Please try again.')), timeoutMs)
    function cleanup() {
      clearTimeout(timer)
      request.off('data', onData)
      request.off('end', onEnd)
      request.off('error', onError)
      request.off('aborted', onAborted)
    }
    function fail(error: Error) {
      cleanup()
      request.resume()
      reject(error)
    }
    function onData(chunk: Buffer) {
      length += chunk.length
      if (length > MAX_REQUEST_BYTES) return fail(new ApiError(413, 'The request is too large. Send only the receipt link.'))
      chunks.push(chunk)
    }
    function onEnd() { cleanup(); resolve(Buffer.concat(chunks).toString('utf8')) }
    function onError() { fail(new ApiError(400, 'The request could not be read. Please try again.')) }
    function onAborted() { fail(new ApiError(400, 'The request was interrupted. Please try again.')) }
    request.on('data', onData)
    request.once('end', onEnd)
    request.once('error', onError)
    request.once('aborted', onAborted)
  })
}

async function fetchReceipt(url: string, fetchImpl: FetchReceipt, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      method: 'GET', headers: { Accept: 'application/json' }, redirect: 'manual', signal: controller.signal,
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new ApiError(502, 'The tax service could not return this receipt. Please try again later.')
    }
    if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
      await response.body?.cancel()
      throw new ApiError(502, 'The tax service returned a receipt that is too large.')
    }
    const reader = response.body?.getReader()
    if (!reader) throw new ApiError(502, 'The tax service returned an empty receipt.')
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > MAX_RESPONSE_BYTES) {
          await reader.cancel()
          throw new ApiError(502, 'The tax service returned a receipt that is too large.')
        }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    let data: unknown
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
      throw new ApiError(502, 'The tax service returned an unreadable receipt. Please try again later.')
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new ApiError(502, 'The tax service returned an unreadable receipt. Please try again later.')
    }
    return data
  } catch (error) {
    if (controller.signal.aborted) throw new ApiError(504, 'The tax service took too long to respond. Please try again.')
    if (error instanceof ApiError) throw error
    throw new ApiError(502, 'The tax service is unavailable. Please try again later.')
  } finally { clearTimeout(timer) }
}

function json(response: ServerResponse, status: number, data: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.end(JSON.stringify(data))
}

export function createReceiptMiddleware(options: ApiOptions = {}) {
  const route = `${normalizeBasePath(options.basePath)}api/receipts`
  const allowedOrigins = new Set(options.allowedOrigins ?? [])
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 12000
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (request.url?.split('?')[0] !== route) { next(); return }
    try {
      const origin = request.headers.origin
      const protocol = (request.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http'
      const sameOrigin = `${protocol}://${request.headers.host}`
      if (origin && origin !== sameOrigin && !allowedOrigins.has(origin)) {
        throw new ApiError(403, 'This website is not allowed to use the receipt service.')
      }
      response.setHeader('Vary', 'Origin')
      if (origin) response.setHeader('Access-Control-Allow-Origin', origin)
      if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
        response.setHeader('Access-Control-Max-Age', '600')
        response.statusCode = 204
        response.end()
        return
      }
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST, OPTIONS')
        throw new ApiError(405, 'Use POST to read a receipt.')
      }
      if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        throw new ApiError(415, 'Send the receipt link as JSON.')
      }
      if (Number(request.headers['content-length']) > MAX_REQUEST_BYTES) {
        request.resume()
        throw new ApiError(413, 'The request is too large. Send only the receipt link.')
      }
      let body: unknown
      try { body = JSON.parse(await readBody(request, timeoutMs)) } catch (error) {
        if (error instanceof ApiError) throw error
        throw new ApiError(400, 'The receipt request is not valid JSON.')
      }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'url')) {
        throw new ApiError(400, 'Send a JSON object containing only the receipt URL.')
      }
      const url = normalizeReceiptUrl((body as { url?: unknown }).url)
      json(response, 200, await fetchReceipt(url, fetchImpl, timeoutMs))
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError(500, 'The receipt could not be loaded. Please try again.')
      json(response, apiError.status, { error: apiError.message })
    }
  }
}

export function configuredAllowedOrigins(): string[] {
  const origins = (process.env.RECEIPT_ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean)
  for (const origin of origins) {
    let parsed: URL
    try { parsed = new URL(origin) } catch { throw new Error('RECEIPT_ALLOWED_ORIGINS must contain full origins separated by commas.') }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new Error('RECEIPT_ALLOWED_ORIGINS must contain exact HTTP or HTTPS origins, without paths or wildcards.')
    }
  }
  return origins
}
