import { Fragment, useRef, useState } from 'react'
import type { Receipt } from '../types/receipt'
import { findMerchantCategory } from '../lib/merchants'
import type { MerchantMapping } from '../lib/merchants'

const money = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const receiptDate = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Bishkek',
})
const cell = 'px-4 py-4 text-left align-top'
const numberCell = `${cell} whitespace-nowrap font-mono text-xs`

export function ReceiptTable({ receipts, merchants, onClearMemory, clearDisabled }: {
  receipts: Receipt[]
  merchants: MerchantMapping[]
  onClearMemory: () => void
  clearDisabled: boolean
}) {
  const exporting = useRef(false)
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  async function downloadExcel() {
    if (exporting.current || !receipts.length) return
    exporting.current = true
    setIsExporting(true)
    setExportError(null)
    try {
      const { downloadReceipts } = await import('../lib/receiptExport')
      await downloadReceipts(receipts, merchants)
    } catch {
      setExportError('Could not create the Excel file. Please try again.')
    } finally {
      exporting.current = false
      setIsExporting(false)
    }
  }

  return (
    <section aria-label="Imported receipts" className="w-full min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Receipts <span className="text-sm font-normal text-black/50 dark:text-white/50">({receipts.length})</span></h2>
          <p className="mt-1 text-xs text-black/50 dark:text-white/50">Amounts in сом</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={downloadExcel} disabled={!receipts.length || isExporting} aria-busy={isExporting} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-violet-700/20 bg-white px-4 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-50 disabled:cursor-default disabled:opacity-50 dark:border-violet-300/25 dark:bg-[#1e1e25] dark:text-violet-300 dark:hover:bg-violet-400/10">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12m-5-5 5 5 5-5M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
          </svg>
          {isExporting ? 'Preparing Excel…' : 'Download Excel'}
        </button>
        <button type="button" onClick={() => {
          if (exporting.current || clearDisabled) return
          setExportError(null)
          onClearMemory()
        }} disabled={clearDisabled || isExporting} title="Erase all receipts and saved preferences from this browser" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-700/20 bg-white px-4 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-default disabled:opacity-50 dark:border-red-300/25 dark:bg-[#1e1e25] dark:text-red-300 dark:hover:bg-red-400/10">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6m4-6v6" />
          </svg>
          Clear Memory
        </button>
        </div>
      </div>
      {exportError && <p role="alert" className="mb-3 text-sm text-red-700 dark:text-red-300">{exportError}</p>}
      <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-[#1e1e25]">
        <table className="w-full text-sm">
          <caption className="sr-only">Imported receipt information</caption>
          <thead className="border-b border-black/10 bg-black/[0.025] text-xs text-black/60 dark:border-white/10 dark:bg-white/[0.025] dark:text-white/60">
            <tr>
              {['Date', 'Чек №', 'Merchant', 'Category', 'Total amount', 'НДС amount', 'ИНН', 'ККМ №', 'ФМ №', 'ФПД', 'ФД №', 'Source', 'Feed'].map((heading) => (
                <th key={heading} scope="col" className="whitespace-nowrap px-4 py-3 text-left font-medium">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!receipts.length && (
              <tr><td colSpan={13} className="px-6 py-12 text-center text-black/50 dark:text-white/50">Scan a receipt with your camera, upload an image, or paste its link to add it here.</td></tr>
            )}
            {receipts.map((receipt) => (
              <Fragment key={receipt.id}>
                <tr>
                  <td className={`${cell} whitespace-nowrap`}><time dateTime={receipt.dateTime}>{receiptDate.format(new Date(receipt.dateTime))}</time></td>
                  <td className={numberCell}>{receipt.ticketNumber ?? <span title="Receipt number is unavailable. Reimport an older receipt to retrieve it.">—</span>}</td>
                  <td className={`${cell} min-w-56`}>
                    <p className="font-medium">{receipt.merchant}</p>
                    {receipt.merchantAddress && <p className="mt-1 text-xs text-black/50 dark:text-white/50">{receipt.merchantAddress}</p>}
                  </td>
                  <td className={`${cell} min-w-36 wrap-anywhere`}>{findMerchantCategory(receipt.merchant, merchants) ?? <span className="text-black/50 dark:text-white/50">Uncategorized</span>}</td>
                  <td className={`${cell} whitespace-nowrap font-medium tabular-nums`}>{money.format(receipt.totalAmountMinor / 100)}</td>
                  <td className={`${cell} whitespace-nowrap tabular-nums`}>{receipt.vatAmountMinor === null ? <span title="VAT was not provided by the receipt">—</span> : money.format(receipt.vatAmountMinor / 100)}</td>
                  <td className={numberCell}>{receipt.tin}</td>
                  <td className={numberCell}>{receipt.kkmNumber}</td>
                  <td className={numberCell}>{receipt.fmNumber}</td>
                  <td className={numberCell}>{receipt.fpd}</td>
                  <td className={numberCell}>{receipt.fdNumber}</td>
                  <td className={cell}><a href={receipt.sourceUrl} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap text-violet-700 underline underline-offset-4 dark:text-violet-300">View receipt</a></td>
                  <td className={`${cell} min-w-40 wrap-anywhere`}>{receipt.feed ?? '—'}</td>
                </tr>
                <tr className="border-b border-black/10 last:border-0 dark:border-white/10">
                  <td colSpan={13} className="px-4 pb-4">
                    <details>
                      <summary className="w-fit cursor-pointer text-xs text-violet-700 dark:text-violet-300">Purchased items ({receipt.items.length})</summary>
                      <table className="mt-3 w-full max-w-3xl text-xs">
                        <caption className="sr-only">Purchased items from {receipt.merchant}</caption>
                        <thead><tr>{['Item', 'Quantity', 'Unit price', 'Amount'].map((heading) => <th key={heading} scope="col" className="border-b border-black/10 px-3 py-2 text-left font-medium dark:border-white/10">{heading}</th>)}</tr></thead>
                        <tbody>{receipt.items.map((item, index) => (
                          <tr key={index}>
                            <td className="px-3 py-2">{item.name}</td>
                            <td className="px-3 py-2 tabular-nums">{item.quantity}</td>
                            <td className="whitespace-nowrap px-3 py-2 tabular-nums">{money.format(item.unitPriceMinor / 100)}</td>
                            <td className="whitespace-nowrap px-3 py-2 tabular-nums">{money.format(item.totalAmountMinor / 100)}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </details>
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
