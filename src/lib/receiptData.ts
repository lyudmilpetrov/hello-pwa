import type { Receipt, ReceiptItem } from '../types/receipt'

type JsonObject = Record<string, unknown>

function invalid(field: string): never {
  throw new Error(`The receipt contains an invalid ${field}. Try another receipt link.`)
}

function object(value: unknown, field: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(field)
  return value as JsonObject
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) invalid(field)
  return value.trim()
}

function identifier(value: unknown, field: string): string {
  // Never coerce an unsafe JSON number: its fiscal digits may already be lost.
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value)
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return value.trim()
  return invalid(field)
}

function money(value: unknown, field: string): number {
  // This API supplies tiyin, including fields such as goodPrice that look decimal
  // in JSON. Keep those minor units intact; multiplying by 100 would inflate them.
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(field)
  return value
}

function dateTime(value: unknown): string {
  const input = text(value, 'receipt date')
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(input)
  if (!parts) invalid('receipt date')
  const [, year, month, day, hour, minute, second] = parts
  const daysInMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate()
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > daysInMonth
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) invalid('receipt date')
  const timestamp = Date.parse(input)
  if (!Number.isFinite(timestamp)) invalid('receipt date')
  return new Date(timestamp).toISOString()
}

function receiptUrl(value: string): string {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href
  } catch {
    // Treat an invalid source the same way as malformed receipt data.
  }
  return invalid('website link')
}

function item(value: unknown): ReceiptItem {
  const data = object(value, 'item')
  const quantity = data.goodQuantity
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) invalid('item quantity')
  return {
    name: text(data.goodName, 'item name'),
    quantity,
    unitPriceMinor: money(data.goodPrice, 'item price'),
    totalAmountMinor: money(data.goodCost, 'item total'),
  }
}

function vatAmount(value: unknown): number | null {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value)) invalid('tax details')
  let total: number | null = null
  for (const entry of value) {
    const counter = object(entry, 'tax details')
    const type = text(counter.type, 'tax type')
    // Sales tax (ST) is a separate tax and must never be included in VAT.
    if (type !== 'VAT') continue
    total = money((total ?? 0) + money(counter.sum, 'VAT amount'), 'VAT amount')
  }
  return total
}

/** Normalizes the fiscal API payload without guessing missing tax or item values. */
export function parseReceipt(data: unknown, sourceUrl: string): Receipt {
  const receipt = object(data, 'receipt response')
  const location = object(receipt.crData, 'merchant details')
  if (!Array.isArray(receipt.items)) invalid('item list')
  const address = location.locationAddress
  if (address !== undefined && address !== null && typeof address !== 'string') invalid('merchant address')

  // The service includes an `errors` metadata object even in valid receipts.
  // Validate the receipt fields themselves rather than rejecting that property.
  return {
    id: text(receipt.id, 'receipt identifier'),
    sourceUrl: receiptUrl(sourceUrl),
    importedAt: new Date().toISOString(),
    dateTime: dateTime(receipt.dateTime),
    ticketNumber: receipt.ticketNumber == null ? null : identifier(receipt.ticketNumber, 'receipt number'),
    merchant: text(location.locationName, 'merchant name'),
    merchantAddress: typeof address === 'string' && address.trim() ? address.trim() : null,
    totalAmountMinor: money(receipt.ticketTotalSum, 'receipt total'),
    vatAmountMinor: vatAmount(receipt.taxCounters),
    currency: 'KGS',
    tin: identifier(receipt.tin, 'TIN'),
    kkmNumber: identifier(receipt.crRegisterNumber, 'KKM number'),
    fmNumber: identifier(receipt.fnSerialNumber, 'FM number'),
    fpd: identifier(receipt.documentFiscalMark, 'FPD'),
    fdNumber: identifier(receipt.fdNumber, 'FD number'),
    items: receipt.items.map(item),
  }
}
