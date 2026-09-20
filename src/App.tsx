import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { readReceiptUrl } from './lib/receiptBarcode'

type Theme = 'light' | 'dark'

function readPreference(): Theme | null {
  try {
    const value = localStorage.getItem('theme')
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

export default function App() {
  const [preference, setPreference] = useState<Theme | null>(readPreference)
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const fileInput = useRef<HTMLInputElement>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const dark = preference ? preference === 'dark' : systemDark

  async function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    // Allow choosing the same image again after an unsuccessful scan.
    event.currentTarget.value = ''
    if (!file || isScanning) return

    setUploadError(null)
    setIsScanning(true)
    try {
      const url = await readReceiptUrl(file)
      window.location.assign(url)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Could not read this image. Please try another photo.')
    } finally {
      setIsScanning(false)
    }
  }

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const updateSystem = () => setSystemDark(media.matches)
    const syncPreference = (event: StorageEvent) => {
      if (event.key === 'theme' || event.key === null) setPreference(readPreference())
    }
    media.addEventListener('change', updateSystem)
    window.addEventListener('storage', syncPreference)
    return () => {
      media.removeEventListener('change', updateSystem)
      window.removeEventListener('storage', syncPreference)
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#141419' : '#faf9f6')
  }, [dark])

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-4">
      <div role="group" aria-label="Image actions" className="inline-flex items-center gap-1 rounded-2xl border border-black/10 bg-white p-2 shadow-sm dark:border-white/10 dark:bg-[#1e1e25]">
        <button type="button" onClick={() => console.log('Take an image')} className="inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 text-sm font-medium transition-colors hover:bg-violet-50 hover:text-violet-700 sm:px-5 dark:hover:bg-violet-400/10 dark:hover:text-violet-300">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14.5 4h-5L7.5 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.5Z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          Take an image
        </button>
        <span className="h-6 w-px shrink-0 bg-black/10 dark:bg-white/10" aria-hidden="true" />
        <input ref={fileInput} type="file" accept="image/*" aria-label="Receipt image" onChange={uploadImage} disabled={isScanning} hidden />
        <button type="button" onClick={() => fileInput.current?.click()} disabled={isScanning} aria-busy={isScanning} className="inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 text-sm font-medium transition-colors hover:bg-violet-50 hover:text-violet-700 disabled:cursor-wait disabled:opacity-50 sm:px-5 dark:hover:bg-violet-400/10 dark:hover:text-violet-300">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
          </svg>
          Upload file
        </button>
      </div>
      <p role="status" className="empty:hidden text-center text-sm text-black/60 dark:text-white/60">
        {isScanning ? 'Reading barcode…' : ''}
      </p>
      {uploadError && <p role="alert" className="max-w-sm text-center text-sm text-red-700 dark:text-red-300">{uploadError}</p>}
    </main>
  )
}
