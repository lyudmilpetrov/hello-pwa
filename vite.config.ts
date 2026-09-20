import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = `${(env.BASE_PATH || '/').replace(/\/+$/, '')}/`
  const target = env.RECEIPT_API_PROXY_TARGET?.trim() || `http://127.0.0.1:${env.API_PORT || 3001}`
  const proxy = {
    [`${base}api/`]: {
      target,
      changeOrigin: true,
      // This is a server-to-server request. Browser CORS is configured on the
      // deployed backend separately when the browser calls its URL directly.
      headers: { Origin: new URL(target).origin },
      rewrite: (path: string) => path.slice(base.length - 1),
    },
  }
  return {
    base,
    server: { proxy },
    preview: { proxy },
    define: {
      'import.meta.env.VITE_RELEASE_TIMESTAMP': JSON.stringify(new Date().toISOString()),
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: 'Vat-Taxes-Kyrgyzstan',
          short_name: 'Hello',
          description: 'Your minimal React and Tailwind starter.',
          id: './',
          start_url: './',
          scope: './',
          display: 'standalone',
          theme_color: '#faf9f6',
          background_color: '#faf9f6',
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,wasm}'],
          cleanupOutdatedCaches: true,
        },
      }),
    ],
  }
})
