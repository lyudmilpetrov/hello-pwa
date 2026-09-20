import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { configureReceiptApi } from './server/receiptApi.ts'

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  define: {
    'import.meta.env.VITE_RELEASE_TIMESTAMP': JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    configureReceiptApi(),
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
})
