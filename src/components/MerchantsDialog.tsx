import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { normalizeMerchantKey } from '../lib/merchants'
import type { MerchantMapping } from '../lib/merchants'

type MerchantsDialogProps = {
  merchants: MerchantMapping[]
  onSave: (merchant: MerchantMapping) => void
  onClose: () => void
}

export function MerchantsDialog({ merchants, onSave, onClose }: MerchantsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const keyInputRef = useRef<HTMLInputElement>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [merchantKey, setMerchantKey] = useState('')
  const [category, setCategory] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    const dialog = dialogRef.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])

  function resetForm() {
    setEditingId(null)
    setMerchantKey('')
    setCategory('')
    setError('')
  }

  function editMerchant(merchant: MerchantMapping) {
    setEditingId(merchant.id)
    setMerchantKey(merchant.key)
    setCategory(merchant.category)
    setError('')
    setStatus('')
    keyInputRef.current?.focus()
  }

  function saveMerchant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus('')
    const key = merchantKey.trim()
    const trimmedCategory = category.trim()
    if (!key || !trimmedCategory) {
      setError('Enter both a merchant key and a category.')
      return
    }
    if (merchants.some((merchant) => merchant.id !== editingId && normalizeMerchantKey(merchant.key) === normalizeMerchantKey(key))) {
      setError('This merchant key already exists. Edit its existing mapping instead.')
      return
    }
    onSave({ id: editingId ?? crypto.randomUUID(), key, category: trimmedCategory })
    setStatus(`${key} ${editingId ? 'updated' : 'added'}.`)
    resetForm()
    keyInputRef.current?.focus()
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="merchants-title"
      aria-describedby="merchants-help"
      onCancel={(event) => { event.preventDefault(); onClose() }}
      className="m-auto max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-black/10 bg-[#faf9f6] p-4 text-[#242329] shadow-xl backdrop:bg-black/60 sm:p-6 dark:border-white/10 dark:bg-[#1e1e25] dark:text-[#f1f0f4]"
    >
      <div className="flex items-center justify-between gap-3">
        <h1 id="merchants-title" className="text-lg font-semibold">Merchants</h1>
        <button type="button" autoFocus onClick={onClose} aria-label="Close merchants" className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-black/15 transition-colors hover:bg-violet-50 hover:text-violet-700 dark:border-white/15 dark:hover:bg-violet-400/10 dark:hover:text-violet-300">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <path d="m6 6 12 12M6 18 18 6" />
          </svg>
        </button>
      </div>
      <p id="merchants-help" className="mt-2 text-sm text-black/60 dark:text-white/60">
        Keys match any part of a merchant name, ignoring letter case. When several keys match, the longest key wins. Changes apply to saved receipts and exports. Mappings are stored in this browser.
      </p>

      <ul aria-label="Merchant mappings" className="mt-5 divide-y divide-black/10 overflow-hidden rounded-xl border border-black/10 bg-white dark:divide-white/10 dark:border-white/10 dark:bg-[#141419]">
        {merchants.map((merchant) => (
          <li key={merchant.id} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1 wrap-anywhere">
              <p className="text-sm font-medium">{merchant.key}</p>
              <p className="text-sm text-black/60 dark:text-white/60">{merchant.category}</p>
            </div>
            <button type="button" onClick={() => editMerchant(merchant)} aria-label={`Edit ${merchant.key}`} className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-400/10">Edit</button>
          </li>
        ))}
      </ul>

      <form onSubmit={saveMerchant} noValidate aria-labelledby="merchant-form-title" className="mt-5 border-t border-black/10 pt-5 dark:border-white/10">
        <h2 id="merchant-form-title" className="text-sm font-semibold">{editingId ? 'Edit merchant' : 'Add merchant'}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <label htmlFor="merchant-key" className="mb-1 block text-xs text-black/60 dark:text-white/60">Merchant key</label>
            <input ref={keyInputRef} id="merchant-key" value={merchantKey} onChange={(event) => { setMerchantKey(event.currentTarget.value); setError(''); setStatus('') }} required aria-describedby={error ? 'merchant-error' : undefined} autoComplete="off" className="min-h-11 w-full rounded-xl border border-black/15 bg-white px-3 text-sm dark:border-white/15 dark:bg-[#141419]" />
          </div>
          <div className="min-w-0">
            <label htmlFor="merchant-category" className="mb-1 block text-xs text-black/60 dark:text-white/60">Category</label>
            <input id="merchant-category" value={category} onChange={(event) => { setCategory(event.currentTarget.value); setError(''); setStatus('') }} required aria-describedby={error ? 'merchant-error' : undefined} autoComplete="off" className="min-h-11 w-full rounded-xl border border-black/15 bg-white px-3 text-sm dark:border-white/15 dark:bg-[#141419]" />
          </div>
        </div>
        {error && <p id="merchant-error" role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
        <p role="status" className="mt-3 wrap-anywhere text-sm text-black/60 empty:hidden dark:text-white/60">{status}</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {editingId && <button type="button" onClick={() => { resetForm(); setStatus(''); keyInputRef.current?.focus() }} className="min-h-11 rounded-xl border border-black/15 px-4 text-sm font-medium hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/5">Cancel edit</button>}
          <button type="submit" className="min-h-11 rounded-xl bg-violet-700 px-4 text-sm font-medium text-white hover:bg-violet-800 dark:bg-violet-500 dark:hover:bg-violet-600">{editingId ? 'Save changes' : 'Add merchant'}</button>
        </div>
      </form>
    </dialog>
  )
}
