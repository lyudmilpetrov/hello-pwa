import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

function readPreference(): Theme | null {
  try {
    const value = localStorage.getItem('theme')
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

function ThemeIcon({ dark }: { dark: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {dark ? <path d="M20.5 13a8.5 8.5 0 0 1-9.5-9.5A8.5 8.5 0 1 0 20.5 13Z" /> : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>}
    </svg>
  )
}

export default function App() {
  const [preference, setPreference] = useState<Theme | null>(readPreference)
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const dark = preference ? preference === 'dark' : systemDark

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

  function toggleTheme() {
    const next = dark ? 'light' : 'dark'
    setPreference(next)
    try { localStorage.setItem('theme', next) } catch { /* Theme still works without storage. */ }
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-7 sm:px-10 sm:py-9">
        <a href="./" className="inline-flex items-center gap-2.5 text-lg font-semibold tracking-tight" aria-label="Hello home">
          <span className="flex size-8 items-center justify-center rounded-xl bg-violet-600 text-xl text-white" aria-hidden="true">✳</span>
          hello<span className="-ml-2 text-violet-600 dark:text-violet-400">.</span>
        </a>
        <button onClick={toggleTheme} type="button" aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`} className="inline-flex items-center gap-2.5 rounded-full border border-black/10 bg-white/60 px-4 py-2.5 text-xs font-medium text-stone-600 transition-colors hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-stone-300 dark:hover:bg-white/10">
          <ThemeIcon dark={dark} />
          <span>{dark ? 'Dark' : 'Light'} mode</span>
        </button>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-12 text-center sm:py-16">
        <div className="w-full max-w-xl">
          <div className="relative mx-auto mb-10 flex size-44 items-center justify-center" aria-hidden="true">
            <div className="absolute inset-0 rounded-full border border-violet-300/35 dark:border-violet-400/15" />
            <div className="absolute inset-5 rounded-full border border-violet-300/40 dark:border-violet-400/20" />
            <div className="absolute right-4 top-6 size-3 rounded-full bg-violet-300 ring-8 ring-[#faf9f6] dark:bg-violet-400 dark:ring-[#141419]" />
            <div className="flex size-24 -rotate-6 items-center justify-center rounded-[30px] border border-violet-200 bg-violet-100 text-5xl text-violet-600 shadow-[0_12px_40px_-12px_#8b5cf650] dark:border-violet-400/25 dark:bg-violet-400/15 dark:text-violet-300">✳</div>
            <div className="absolute bottom-6 left-3 size-2 rounded-full bg-violet-400" />
          </div>

          <p className="mb-5 text-[11px] font-semibold uppercase tracking-[0.23em] text-violet-600 dark:text-violet-400">A fresh start</p>
          <h1 className="text-5xl font-semibold tracking-[-0.065em] sm:text-7xl">Hello, world<span className="text-violet-600 dark:text-violet-400">.</span></h1>
          <p className="mx-auto mt-6 max-w-sm text-base leading-7 text-stone-500 dark:text-stone-400">A small beginning for your next big idea.<br />Make yourself at home. Make it your own.</p>

          <div className="mt-9 inline-flex flex-wrap justify-center gap-2" aria-label="Built with">
            {['React', 'Tailwind CSS', 'PWA'].map((label) => (
              <span key={label} className="rounded-full border border-black/8 px-3 py-1.5 text-[11px] font-medium text-stone-500 dark:border-white/10 dark:text-stone-400">{label}</span>
            ))}
          </div>
          <div className="mx-auto mt-12 h-px w-12 bg-stone-200 dark:bg-stone-800" />
          <p className="mt-6 text-xs leading-6 text-stone-400 dark:text-stone-500">Your blank canvas is ready.</p>
        </div>
      </main>

      <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-[11px] text-stone-400 sm:px-10 sm:py-8 dark:text-stone-500">
        <span>Less setup. More possibility.</span>
        <span className="inline-flex items-center gap-2"><span className="size-1.5 rounded-full bg-violet-400" aria-hidden="true" /> Built to go anywhere</span>
      </footer>
    </div>
  )
}
