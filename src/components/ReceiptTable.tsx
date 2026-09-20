import { Fragment } from 'react'
import type { Receipt } from '../types/receipt'

const money = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const receiptDate = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Bishkek',
})
const cell = 'px-4 py-4 text-left align-top'
const numberCell = `${cell} whitespace-nowrap font-mono text-xs`

export function ReceiptTable({ receipts }: { receipts: Receipt[] }) {
  return (
    <section aria-label="Imported receipts" className="w-full min-w-0">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold">Receipts <span className="text-sm font-normal text-black/50 dark:text-white/50">({receipts.length})</span></h2>
        <p className="text-xs text-black/50 dark:text-white/50">Amounts in сом · Time in Bishkek</p>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-[#1e1e25]">
        <table className="w-full text-sm">
          <caption className="sr-only">Imported receipt information</caption>
          <thead className="border-b border-black/10 bg-black/[0.025] text-xs text-black/60 dark:border-white/10 dark:bg-white/[0.025] dark:text-white/60">
            <tr>
              {['Date', 'Merchant', 'Total amount', 'НДС amount', 'ИНН', 'ККМ №', 'ФМ №', 'ФПД', 'ФД №', 'Source'].map((heading) => (
                <th key={heading} scope="col" className="whitespace-nowrap px-4 py-3 text-left font-medium">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!receipts.length && (
              <tr><td colSpan={10} className="px-6 py-12 text-center text-black/50 dark:text-white/50">Upload a receipt image or paste its link to add the receipt here.</td></tr>
            )}
            {receipts.map((receipt) => (
              <Fragment key={receipt.id}>
                <tr>
                  <td className={`${cell} whitespace-nowrap`}><time dateTime={receipt.dateTime}>{receiptDate.format(new Date(receipt.dateTime))}</time></td>
                  <td className={`${cell} min-w-56`}>
                    <p className="font-medium">{receipt.merchant}</p>
                    {receipt.merchantAddress && <p className="mt-1 text-xs text-black/50 dark:text-white/50">{receipt.merchantAddress}</p>}
                  </td>
                  <td className={`${cell} whitespace-nowrap font-medium tabular-nums`}>{money.format(receipt.totalAmountMinor / 100)}</td>
                  <td className={`${cell} whitespace-nowrap tabular-nums`}>{receipt.vatAmountMinor === null ? <span title="VAT was not provided by the receipt">—</span> : money.format(receipt.vatAmountMinor / 100)}</td>
                  <td className={numberCell}>{receipt.tin}</td>
                  <td className={numberCell}>{receipt.kkmNumber}</td>
                  <td className={numberCell}>{receipt.fmNumber}</td>
                  <td className={numberCell}>{receipt.fpd}</td>
                  <td className={numberCell}>{receipt.fdNumber}</td>
                  <td className={cell}><a href={receipt.sourceUrl} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap text-violet-700 underline underline-offset-4 dark:text-violet-300">View receipt</a></td>
                </tr>
                <tr className="border-b border-black/10 last:border-0 dark:border-white/10">
                  <td colSpan={10} className="px-4 pb-4">
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
