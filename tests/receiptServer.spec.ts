import type { AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import { createReceiptServer } from '../backend/src/index.ts'
import { normalizeReceiptUrl } from '../backend/src/receiptApi.ts'

const receiptUrl = 'https://tax.salyk.kg/tax-web-control/client/api/v1/ticket?date=20260917T175623&sum=91950&fn_number=0000000002369707&regNumber=0000000000229871&tin=01007200310037&type=3&operation_type=1&fd_number=172045&fm=254486752077560'
const shortReceiptUrl = 'https://tax.salyk.kg/tax-web-control/client/api/v1/ticket?type=3&fn_number=0000000002420437&fd_number=23086&fm=56512701996055&tin=01007200310037&regNumber=0000000000293799'
const receipt = { id: 'example-receipt', ticketTotalSum: 91950, items: [{ goodName: 'Test item', goodQuantity: 1, goodCost: 91950 }] }
const successfulFetch: typeof fetch = async () => Response.json(receipt)

async function withServer(
  options: Parameters<typeof createReceiptServer>[0],
  run: (baseUrl: string) => Promise<void>,
) {
  const server = createReceiptServer({ basePath: '/', allowedOrigins: [], fetchImpl: successfulFetch, ...options })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

function post(baseUrl: string, body: unknown = { url: receiptUrl }, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/api/receipts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  })
}

test('receipt API upgrades HTTP and preserves receipt identifiers without following redirects', async () => {
  let requestedUrl = ''
  let redirectMode: RequestRedirect | undefined
  await withServer({ fetchImpl: async (input, options) => {
    requestedUrl = String(input)
    redirectMode = options?.redirect
    return Response.json(receipt)
  } }, async (baseUrl) => {
    const response = await post(baseUrl, { url: receiptUrl.replace('https:', 'http:') })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(receipt)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
  expect(requestedUrl).toBe(receiptUrl)
  expect(redirectMode).toBe('manual')
})

for (const protocol of ['https:', 'http:']) {
  test(`receipt API accepts a six-parameter ${protocol} link and requests JSON`, async () => {
    let requestedUrl = ''
    let requestOptions: RequestInit | undefined
    await withServer({ fetchImpl: async (input, options) => {
      requestedUrl = String(input)
      requestOptions = options
      return Response.json(receipt)
    } }, async (baseUrl) => {
      const response = await post(baseUrl, { url: shortReceiptUrl.replace('https:', protocol) })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(receipt)
      expect(response.headers.get('cache-control')).toBe('no-store')
    })
    expect(requestedUrl).toBe('https://tax.salyk.kg/tax-web-control/client/api/v1/ticket?fn_number=0000000002420437&regNumber=0000000000293799&tin=01007200310037&type=3&fd_number=23086&fm=56512701996055')
    expect(requestOptions?.method).toBe('GET')
    expect(new Headers(requestOptions?.headers).get('Accept')).toBe('application/json')
    expect(requestOptions?.redirect).toBe('manual')
  })
}

test('supplied receipt parameters still require exactly one valid value', () => {
  for (const [key, value] of new URL(receiptUrl).searchParams) {
    const duplicate = new URL(receiptUrl)
    duplicate.searchParams.append(key, value)
    expect(() => normalizeReceiptUrl(duplicate.href), `duplicate ${key}`).toThrow()

    for (const invalid of ['', '-1', 'abc', '1'.repeat(33)]) {
      const malformed = new URL(receiptUrl)
      malformed.searchParams.set(key, invalid)
      expect(() => normalizeReceiptUrl(malformed.href), `invalid ${key}: ${invalid}`).toThrow()
    }
  }
  expect(() => normalizeReceiptUrl(`${shortReceiptUrl}&unexpected=1`)).toThrow()
})

test('receipt API forwards supplied fields when any recognized parameter is absent', async () => {
  const missingParameters = [...new URL(receiptUrl).searchParams.keys()]
  let requestedUrl = ''
  await withServer({ fetchImpl: async (input) => {
    requestedUrl = String(input)
    return Response.json(receipt)
  } }, async (baseUrl) => {
    for (const missingKey of [...missingParameters, 'all']) {
      const partial = new URL(receiptUrl)
      if (missingKey === 'all') partial.search = ''
      else partial.searchParams.delete(missingKey)
      requestedUrl = ''

      const response = await post(baseUrl, { url: partial.href })
      expect(response.status, `missing ${missingKey}`).toBe(200)
      expect(await response.json()).toEqual(receipt)
      expect(requestedUrl).not.toContain('undefined')
      expect([...new URL(requestedUrl).searchParams].sort()).toEqual([...partial.searchParams].sort())
    }
  })
})

test('receipt API forwards all partially supplied metadata combinations', async () => {
  const metadata = ['date=20260829T154846', 'sum=295864', 'operation_type=1']
  let requestedUrl = ''
  await withServer({ fetchImpl: async (input) => {
    requestedUrl = String(input)
    return Response.json(receipt)
  } }, async (baseUrl) => {
    for (const indices of [[0], [1], [2], [0, 1], [0, 2], [1, 2]]) {
      const partial = indices.map((index) => metadata[index]).join('&')
      const url = new URL(`${shortReceiptUrl}&${partial}`)
      requestedUrl = ''

      const response = await post(baseUrl, { url: url.href })
      expect(response.status, partial).toBe(200)
      expect(await response.json()).toEqual(receipt)
      expect(requestedUrl).not.toContain('undefined')
      expect([...new URL(requestedUrl).searchParams].sort()).toEqual([...url.searchParams].sort())
    }
  })
})

test('receipt URL validation rejects arbitrary destinations and malformed parameters', () => {
  for (const url of [
    'not a URL',
    receiptUrl.replace('tax.salyk.kg', '127.0.0.1'),
    receiptUrl.replace('tax.salyk.kg', '169.254.169.254'),
    receiptUrl.replace('tax.salyk.kg', 'tax.salyk.kg.attacker.example'),
    receiptUrl.replace('https:', 'file:'),
    receiptUrl.replace('tax.salyk.kg', 'user:secret@tax.salyk.kg'),
    receiptUrl.replace('tax.salyk.kg', 'tax.salyk.kg:8080'),
    receiptUrl.replace('/api/v1/ticket', '/api/v1/other'),
    `${receiptUrl}#fragment`,
    `${receiptUrl}&redirect=https://127.0.0.1`,
    `${receiptUrl}&sum=1`,
    receiptUrl.replace('sum=91950', 'sum=-1'),
    receiptUrl.replace('date=20260917T175623', 'date=bad-date'),
  ]) expect(() => normalizeReceiptUrl(url)).toThrow()
})

test('receipt API rejects a bad URL before contacting the tax service', async () => {
  let called = false
  await withServer({ fetchImpl: async () => { called = true; return Response.json(receipt) } }, async (baseUrl) => {
    const response = await post(baseUrl, { url: 'http://127.0.0.1/private' })
    expect(response.status).toBe(400)
    expect(await response.json()).toHaveProperty('error')
    expect(called).toBe(false)
  })
})

test('receipt API rejects malformed JSON, unexpected fields and oversized request bodies', async () => {
  await withServer({}, async (baseUrl) => {
    const malformed = await fetch(`${baseUrl}/api/receipts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    })
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toHaveProperty('error')
    expect((await post(baseUrl, { url: receiptUrl, extra: true })).status).toBe(400)
    expect((await post(baseUrl, { url: 'x'.repeat(9000) })).status).toBe(413)
    expect((await post(baseUrl, {}, { 'Content-Type': 'text/plain' })).status).toBe(415)
  })
})

test('receipt API accepts receipt JSON larger than the request body limit', async () => {
  const largeReceipt = {
    ...receipt,
    items: Array.from({ length: 100 }, (_, index) => ({
      ...receipt.items[0], goodName: `Test item ${index}: ${'x'.repeat(100)}`,
    })),
  }
  const responseBytes = Buffer.byteLength(JSON.stringify(largeReceipt))
  expect(Buffer.byteLength(JSON.stringify({ url: shortReceiptUrl }))).toBeLessThan(8192)
  expect(responseBytes).toBeGreaterThan(8192)
  expect(responseBytes).toBeLessThan(2 * 1024 * 1024)

  await withServer({ fetchImpl: async () => Response.json(largeReceipt) }, async (baseUrl) => {
    const response = await post(baseUrl, { url: shortReceiptUrl })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(largeReceipt)
  })
})

for (const status of [302, 500]) {
  test(`receipt API returns a JSON error for upstream status ${status}`, async () => {
    let calls = 0
    await withServer({ fetchImpl: async () => {
      calls++
      return new Response('Unavailable', { status, headers: { Location: 'http://127.0.0.1/private' } })
    } }, async (baseUrl) => {
      const response = await post(baseUrl)
      expect(response.status).toBe(502)
      expect(await response.json()).toHaveProperty('error')
      expect(calls).toBe(1)
    })
  })
}

test('receipt API rejects HTML and oversized upstream responses', async () => {
  for (const body of ['<html>Service unavailable</html>', 'x'.repeat(2 * 1024 * 1024 + 1)]) {
    await withServer({ fetchImpl: async () => new Response(body) }, async (baseUrl) => {
      const response = await post(baseUrl)
      expect(response.status).toBe(502)
      expect(await response.json()).toHaveProperty('error')
    })
  }
})

test('receipt API aborts a timed out tax request and returns a retryable error', async () => {
  await withServer({ timeoutMs: 30, fetchImpl: async (_input, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  }) }, async (baseUrl) => {
    const response = await post(baseUrl)
    expect(response.status).toBe(504)
    expect((await response.json()).error).toContain('too long')
  })
})

test('receipt API permits only the configured cross-origin frontend', async () => {
  const allowedOrigin = 'https://lyudmilpetrov.github.io'
  await withServer({ allowedOrigins: [allowedOrigin] }, async (baseUrl) => {
    const denied = await post(baseUrl, { url: receiptUrl }, { Origin: 'https://other.example' })
    expect(denied.status).toBe(403)
    expect(denied.headers.get('access-control-allow-origin')).toBeNull()
    const preflight = await fetch(`${baseUrl}/api/receipts`, { method: 'OPTIONS', headers: { Origin: allowedOrigin } })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe(allowedOrigin)
    const response = await post(baseUrl, { url: receiptUrl }, { Origin: allowedOrigin })
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe(allowedOrigin)
  })
})

test('standalone server serves only the receipt API under the configured base path', async () => {
  await withServer({ basePath: '/hello-pwa/' }, async (baseUrl) => {
    const page = await fetch(`${baseUrl}/hello-pwa/`)
    expect(page.status).toBe(404)
    expect(page.headers.get('content-type')).toContain('application/json')
    expect(await page.json()).toEqual({ error: 'Not found.' })
    const response = await post(`${baseUrl}/hello-pwa`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(receipt)
    expect((await post(baseUrl)).status).toBe(404)
    expect((await fetch(`${baseUrl}/hello-pwa/.env`)).status).toBe(404)
    expect((await fetch(`${baseUrl}/hello-pwa/C:/Windows/win.ini`)).status).toBe(404)
    expect((await fetch(`${baseUrl}/hello-pwa/missing.js`)).status).toBe(404)
  })
})

test('standalone server exposes a root health check without contacting the tax service', async () => {
  let upstreamCalls = 0
  await withServer({ basePath: '/hello-pwa/', fetchImpl: async () => {
    upstreamCalls++
    return Response.json(receipt)
  } }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ status: 'ok' })
    const head = await fetch(`${baseUrl}/health`, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-length')).toBe(response.headers.get('content-length'))
    expect(await head.text()).toBe('')
    const wrongMethod = await fetch(`${baseUrl}/health`, { method: 'POST' })
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.get('allow')).toBe('GET, HEAD')
    expect(upstreamCalls).toBe(0)
  })
})
