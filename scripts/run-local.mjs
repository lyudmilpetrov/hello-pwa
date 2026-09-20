import { spawn, spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { loadEnv } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const backend = fileURLToPath(new URL('../backend/', import.meta.url))
const [command = 'dev', ...args] = process.argv.slice(2)
if (!['dev', 'preview'].includes(command)) throw new Error('Use run-local.mjs dev or preview.')

const env = loadEnv(command === 'dev' ? 'development' : 'production', root, '')
const remoteTarget = env.RECEIPT_API_PROXY_TARGET?.trim()
const children = []
let stopping = false

function stopChild(child) {
  if (!child.pid || child.exitCode !== null) return
  if (process.platform === 'win32') {
    // Node watch mode has its own child; close the tree we started, too.
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  } else {
    try { process.kill(-child.pid, 'SIGTERM') } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
  }
}

function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) stopChild(child)
  process.exitCode = code
}

function start(label, childArgs, options) {
  const child = spawn(process.execPath, childArgs, {
    stdio: 'inherit', windowsHide: true, detached: process.platform !== 'win32', ...options,
  })
  children.push(child)
  child.once('error', (error) => {
    console.error(`${label} could not start: ${error.message}`)
    stop(1)
  })
  child.once('exit', (code) => {
    if (!stopping) {
      console.error(`${label} stopped; shutting down local servers.`)
      stop(code || 1)
    }
  })
  return child
}

process.once('SIGINT', () => stop())
process.once('SIGTERM', () => stop())
process.once('exit', () => children.forEach(stopChild))

async function startLocalApi() {
  const backendEnv = await readFile(new URL('../backend/.env', import.meta.url), 'utf8')
    .then(parseEnv).catch((error) => {
      if (error.code === 'ENOENT') return {}
      throw error
    })
  const port = Number(env.API_PORT || process.env.PORT || backendEnv.PORT || 3001)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API_PORT must be an integer from 1 to 65535.')
  const target = `http://127.0.0.1:${port}`
  let apiListening = false
  let startupOutput = ''
  const api = start('Receipt API', [
    '--env-file-if-exists=.env', ...(command === 'dev' ? ['--watch'] : []), 'src/index.ts',
  ], {
    cwd: backend,
    stdio: ['inherit', 'pipe', 'inherit'],
    // Keep local servers local and independent of the frontend's Pages prefix.
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), BASE_PATH: '/' },
  })
  api.stdout.on('data', (chunk) => {
    process.stdout.write(chunk)
    startupOutput = `${startupOutput}${chunk}`.slice(-4096)
    // Watch mode stays alive after a bind error. Require this process's listen
    // message before accepting health, so an older API cannot satisfy startup.
    if (startupOutput.includes(`Receipt API listening on ${target}/api/receipts`)) apiListening = true
  })
  const deadline = Date.now() + 15000
  let ready = false
  while (!stopping && Date.now() < deadline) {
    try {
      if (apiListening) {
        const response = await fetch(`${target}/health`, { signal: AbortSignal.timeout(500) })
        const body = await response.json()
        if (response.ok && body.status === 'ok') { ready = true; break }
      }
    } catch { /* Allow the API process time to start. */ }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  if (!stopping && !ready) throw new Error(`Receipt API did not start at ${target}. Check its output or set API_PORT to an unused port.`)
  return target
}

try {
  const target = remoteTarget || await startLocalApi()
  if (!stopping) {
    console.log(`${remoteTarget ? 'Remote' : 'Local'} receipt API: ${target} (proxied by Vite)`)
    start('Vite', [
      fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)),
      ...(command === 'preview' ? ['preview'] : []), '--host', '127.0.0.1', ...args,
    ], { cwd: root, env: { ...process.env, RECEIPT_API_PROXY_TARGET: target } })
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  stop(1)
}
