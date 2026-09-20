import type { Receipt } from '../types/receipt'

const money = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function ReceiptTotals({ receipts }: { receipts: Receipt[] }) {
  // Sum minor units before formatting to avoid rounding each receipt separately.
  const totals = receipts.reduce((sum, receipt) => ({
    amount: sum.amount + receipt.totalAmountMinor,
    vat: sum.vat + (receipt.vatAmountMinor ?? 0),
    missingVat: sum.missingVat + (receipt.vatAmountMinor === null ? 1 : 0),
  }), { amount: 0, vat: 0, missingVat: 0 })

  return (
    <dl aria-label="Collected receipt totals" className="grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="min-w-0 rounded-2xl border border-black/10 bg-white p-4 text-center shadow-sm dark:border-white/10 dark:bg-[#1e1e25]">
        <dt className="text-sm text-black/60 dark:text-white/60">Total amount</dt>
        <dd className="mt-2 wrap-anywhere text-2xl font-semibold tabular-nums">{money.format(totals.amount / 100)} <span className="text-sm font-normal text-black/55 dark:text-white/55">сом</span></dd>
      </div>
      <div className="min-w-0 rounded-2xl border border-violet-700/20 bg-violet-50 p-4 text-center shadow-sm dark:border-violet-300/25 dark:bg-violet-400/10">
        <dt className="text-sm text-violet-700 dark:text-violet-300">Vat Taxes reimbursement</dt>
        <dd className="mt-2 wrap-anywhere text-2xl font-semibold text-violet-700 tabular-nums dark:text-violet-300">
          {money.format(totals.vat / 100)} <span className="text-sm font-normal">сом</span>
          {totals.missingVat > 0 && <p className="mt-2 text-xs font-normal text-black/60 dark:text-white/60">VAT unavailable for {totals.missingVat} {totals.missingVat === 1 ? 'receipt' : 'receipts'}.</p>}
        </dd>
      </div>
    </dl>
  )
}
