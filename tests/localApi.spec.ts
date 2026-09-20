import { expect, test } from '@playwright/test'

test('local frontend forwards API requests to the separate Node app', async ({ request, baseURL }) => {
  const backendUrl = `http://127.0.0.1:${process.env.API_PORT || 4185}`
  const health = await request.get(`${backendUrl}/health`)
  expect(health.status()).toBe(200)
  expect(await health.json()).toEqual({ status: 'ok' })

  // A malformed destination exercises routing/validation without a tax request.
  const body = { url: 'https://example.com/not-a-receipt' }
  const proxied = await request.post('./api/receipts', {
    data: body, headers: { Origin: new URL(baseURL!).origin },
  })
  const direct = await request.post(`${backendUrl}/api/receipts`, { data: body })
  expect(proxied.status()).toBe(400)
  expect(proxied.headers()['content-type']).toContain('application/json')
  expect(await proxied.json()).toEqual(await direct.json())

  // The deployed API app never serves frontend assets or its local files.
  const missing = await request.get(`${backendUrl}/package.json`)
  expect(missing.status()).toBe(404)
})
