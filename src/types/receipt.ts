export interface ReceiptItem {
  name: string
  quantity: number
  unitPriceMinor: number
  totalAmountMinor: number
}

export interface Receipt {
  id: string
  sourceUrl: string
  feed?: string
  importedAt: string
  dateTime: string
  ticketNumber: string | null
  merchant: string
  merchantAddress: string | null
  totalAmountMinor: number
  vatAmountMinor: number | null
  currency: 'KGS'
  tin: string
  kkmNumber: string
  fmNumber: string
  fpd: string
  fdNumber: string
  items: ReceiptItem[]
}
