import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { configuredAllowedOrigins, createReceiptMiddleware, normalizeBasePath } from './receiptApi.ts'

export function createReceiptServer(options: {
  basePath?: string; allowedOrigins?: string[]; fetchImpl?: typeof fetch; timeoutMs?: number
} = {}) {
  const basePath = normalizeBasePath(options.basePath ?? process.env.BASE_PATH ?? '/')
  const api = createReceiptMiddleware({ ...options, basePath, allowedOrigins: options.allowedOrigins ?? configuredAllowedOrigins() })
  const server = createServer((request, response) => {
    void api(request, response, () => {
      const isHealth = request.url?.split('?')[0] === '/health'
      const canRead = request.method === 'GET' || request.method === 'HEAD'
      const status = isHealth ? (canRead ? 200 : 405) : 404
      const body = JSON.stringify(isHealth && canRead ? { status: 'ok' } : {
        error: isHealth ? 'Use GET or HEAD to check service health.' : 'Not found.',
      })
      response.statusCode = status
      response.setHeader('Content-Type', 'application/json; charset=utf-8')
      response.setHeader('Content-Length', Buffer.byteLength(body))
      response.setHeader('Cache-Control', 'no-store')
      response.setHeader('X-Content-Type-Options', 'nosniff')
      if (isHealth && !canRead) response.setHeader('Allow', 'GET, HEAD')
      response.end(request.method === 'HEAD' ? undefined : body)
    })
  })
  server.requestTimeout = 15000
  server.headersTimeout = 10000
  return server
}

function start() {
  const port = Number(process.env.PORT ?? 3001)
  const host = process.env.HOST ?? '0.0.0.0'
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.')
  const server = createReceiptServer()
  server.on('error', (error) => {
    console.error('Receipt API failed:', error.message)
    process.exitCode = 1
  })
  let shuttingDown = false
  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    console.log('Stopping receipt API...')
    const deadline = setTimeout(() => server.closeAllConnections(), 10000)
    deadline.unref()
    server.close((error) => {
      clearTimeout(deadline)
      if (error) {
        console.error('Receipt API shutdown failed:', error.message)
        process.exitCode = 1
      }
    })
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
  server.listen(port, host, () => {
    console.log(`Receipt API listening on http://${host}:${port}${normalizeBasePath(process.env.BASE_PATH)}api/receipts`)
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { start() } catch (error) {
    console.error('Receipt API failed to start:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
