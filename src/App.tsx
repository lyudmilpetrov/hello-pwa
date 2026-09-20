import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { CameraScanner } from './components/CameraScanner'
import { ReceiptTable } from './components/ReceiptTable'
import { loadReceipt, normalizeReceiptUrl } from './lib/receiptApi'
import { readReceiptUrl } from './lib/receiptBarcode'
import { parseReceipt } from './lib/receiptData'
import { useAppDispatch, useAppSelector } from './store/hooks'
import { receiptAdded } from './store/receiptsSlice'

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
  const cameraButton = useRef<HTMLButtonElement>(null)
  const busy = useRef(false)
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'loading'>('idle')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [receiptUrl, setReceiptUrl] = useState('')
  const [notice, setNotice] = useState('')
  const dispatch = useAppDispatch()
  const receipts = useAppSelector((state) => state.receipts.items)
  const isBusy = phase !== 'idle'
  const dark = preference ? preference === 'dark' : systemDark

  const importReceipt = useCallback(async (getUrl: () => Promise<string>, scanImage: boolean) => {
    if (busy.current) return
    busy.current = true
    setUploadError(null)
    setNotice('')
    setPhase(scanImage ? 'scanning' : 'loading')
    try {
      const url = normalizeReceiptUrl(await getUrl())
      setReceiptUrl(url)
      setPhase('loading')
      const receipt = parseReceipt(await loadReceipt(url), url)
      dispatch(receiptAdded(receipt))
      setReceiptUrl('')
      setNotice('Receipt added.')
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Could not import this receipt. Please try again.')
    } finally {
      busy.current = false
      setPhase('idle')
    }
  }, [dispatch])

  const importCameraReceipt = useCallback(async (url: string) => {
    setCameraOpen(false)
    await importReceipt(async () => url, false)
    requestAnimationFrame(() => cameraButton.current?.focus())
  }, [importReceipt])

  async function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    // Allow choosing the same image again after an unsuccessful import.
    event.currentTarget.value = ''
    if (file && !cameraOpen) await importReceipt(() => readReceiptUrl(file), true)
  }

  async function submitReceiptUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (receiptUrl.trim() && !cameraOpen) await importReceipt(async () => receiptUrl, false)
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
    <main className="mx-auto flex min-h-svh w-full max-w-7xl flex-col items-center justify-center gap-6 px-4 py-10 sm:px-6">
      <header className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Receipt collector</h1>
        <p className="mt-2 text-sm text-black/55 dark:text-white/55">Keep receipt details and VAT together.</p>
      </header>
      <div role="group" aria-label="Image actions" className="inline-flex items-center gap-1 rounded-2xl border border-black/10 bg-white p-2 shadow-sm dark:border-white/10 dark:bg-[#1e1e25]">
        <button ref={cameraButton} type="button" onClick={() => { setUploadError(null); setNotice(''); setCameraOpen(true) }} disabled={isBusy || cameraOpen} aria-haspopup="dialog" className="inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 text-sm font-medium transition-colors hover:bg-violet-50 hover:text-violet-700 disabled:cursor-wait disabled:opacity-50 sm:px-5 dark:hover:bg-violet-400/10 dark:hover:text-violet-300">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14.5 4h-5L7.5 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.5Z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          Take an image
        </button>
        <span className="h-6 w-px shrink-0 bg-black/10 dark:bg-white/10" aria-hidden="true" />
        <input ref={fileInput} type="file" accept="image/*" aria-label="Receipt image" onChange={uploadImage} disabled={isBusy || cameraOpen} hidden />
        <button type="button" onClick={() => fileInput.current?.click()} disabled={isBusy || cameraOpen} aria-busy={isBusy} className="inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 text-sm font-medium transition-colors hover:bg-violet-50 hover:text-violet-700 disabled:cursor-wait disabled:opacity-50 sm:px-5 dark:hover:bg-violet-400/10 dark:hover:text-violet-300">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
          </svg>
          Upload file
        </button>
      </div>
      <form onSubmit={submitReceiptUrl} aria-label="Import receipt link" className="flex w-full max-w-xl flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="receipt-url" className="mb-1 block text-xs text-black/60 dark:text-white/60">Or paste a receipt link</label>
          <input id="receipt-url" type="url" value={receiptUrl} onChange={(event) => setReceiptUrl(event.currentTarget.value)} placeholder="https://tax.salyk.kg/…" disabled={isBusy || cameraOpen} required className="min-h-11 w-full rounded-xl border border-black/15 bg-white px-3 text-sm disabled:opacity-50 dark:border-white/15 dark:bg-[#1e1e25]" />
        </div>
        <button type="submit" disabled={isBusy || cameraOpen || !receiptUrl.trim()} className="min-h-11 rounded-xl bg-violet-700 px-5 text-sm font-medium text-white transition-colors hover:bg-violet-800 disabled:cursor-default disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-600">Import receipt</button>
      </form>
      <p role="status" className="empty:hidden text-center text-sm text-black/60 dark:text-white/60">
        {phase === 'scanning' ? 'Reading barcode…' : phase === 'loading' ? 'Loading receipt…' : notice}
      </p>
      {uploadError && <p role="alert" className="max-w-sm text-center text-sm text-red-700 dark:text-red-300">{uploadError}</p>}
      <ReceiptTable receipts={receipts} />
      {cameraOpen && <CameraScanner onScan={importCameraReceipt} onClose={() => {
        setCameraOpen(false)
        requestAnimationFrame(() => cameraButton.current?.focus())
      }} />}
    </main>
  )
}
