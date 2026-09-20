import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { configuredAllowedOrigins, createReceiptMiddleware, normalizeBasePath } from '../backend/src/receiptApi.ts'

const defaultDist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist')
const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
}

async function serveStatic(request: IncomingMessage, response: ServerResponse, basePath: string, distDirectory: string) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed')
    return
  }
  let pathname: string
  try { pathname = decodeURIComponent((request.url ?? '/').split('?')[0]) } catch {
    response.writeHead(400).end('Invalid path')
    return
  }
  if (basePath !== '/' && pathname === basePath.slice(0, -1)) {
    response.writeHead(308, { Location: basePath }).end()
    return
  }
  if (!pathname.startsWith(basePath)) { response.writeHead(404).end('Not found'); return }
  const localPath = pathname.slice(basePath.length)
  if (localPath.includes('\0') || localPath.includes('\\') || localPath.includes(':') || localPath.split('/').some((part) => part.startsWith('.'))) {
    response.writeHead(404).end('Not found')
    return
  }
  let path = resolve(distDirectory, localPath || 'index.html')
  const relativePath = relative(distDirectory, path)
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) { response.writeHead(404).end('Not found'); return }
  let info = await stat(path).catch(() => null)
  if (!info?.isFile() && !extname(localPath) && request.headers.accept?.includes('text/html')) {
    path = resolve(distDirectory, 'index.html')
    info = await stat(path).catch(() => null)
  }
  if (!info?.isFile()) { response.writeHead(404).end('Not found'); return }
  response.writeHead(200, {
    'Content-Type': mimeTypes[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': info.size,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': localPath.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  if (request.method === 'HEAD') response.end()
  else await pipeline(createReadStream(path), response)
}

export function createReceiptServer(options: {
  basePath?: string; distDirectory?: string; allowedOrigins?: string[]; fetchImpl?: typeof fetch; timeoutMs?: number
} = {}) {
  const basePath = normalizeBasePath(options.basePath ?? process.env.BASE_PATH ?? '/')
  const distDirectory = resolve(options.distDirectory ?? defaultDist)
  const api = createReceiptMiddleware({ ...options, basePath, allowedOrigins: options.allowedOrigins ?? configuredAllowedOrigins() })
  const server = createServer((request, response) => {
    void api(request, response, () => {
      void serveStatic(request, response, basePath, distDirectory).catch(() => {
        if (!response.headersSent) response.writeHead(500).end('The application could not be loaded')
        else response.destroy()
      })
    })
  })
  server.requestTimeout = 15000
  server.headersTimeout = 10000
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 3000)
  const host = process.env.HOST ?? '127.0.0.1'
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.')
  createReceiptServer().listen(port, host, () => {
    console.log(`Receipt app listening on http://${host}:${port}${normalizeBasePath(process.env.BASE_PATH)}`)
  })
}
