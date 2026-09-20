import type { Receipt, ReceiptItem } from '../types/receipt'

export const RECEIPTS_STORAGE_KEY = 'taxes.receipts.v1'

type ReceiptStorage = Pick<Storage, 'getItem' | 'setItem'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isMinorAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function parseItem(value: unknown): ReceiptItem | null {
  if (
    !isRecord(value) ||
    !isText(value.name) ||
    typeof value.quantity !== 'number' ||
    !Number.isFinite(value.quantity) ||
    !isMinorAmount(value.unitPriceMinor) ||
    !isMinorAmount(value.totalAmountMinor)
  ) return null

  return {
    name: value.name,
    quantity: value.quantity,
    unitPriceMinor: value.unitPriceMinor,
    totalAmountMinor: value.totalAmountMinor,
  }
}

function parseReceipt(value: unknown): Receipt | null {
  if (
    !isRecord(value) ||
    !isText(value.id) ||
    !isText(value.sourceUrl) ||
    !isText(value.importedAt) ||
    !Number.isFinite(Date.parse(value.importedAt)) ||
    !isText(value.dateTime) ||
    !Number.isFinite(Date.parse(value.dateTime)) ||
    !(value.ticketNumber == null || (typeof value.ticketNumber === 'string' && /^\d+$/.test(value.ticketNumber))) ||
    !isText(value.merchant) ||
    !(value.merchantAddress === null || typeof value.merchantAddress === 'string') ||
    !isMinorAmount(value.totalAmountMinor) ||
    !(value.vatAmountMinor === null || isMinorAmount(value.vatAmountMinor)) ||
    value.currency !== 'KGS' ||
    !isText(value.tin) ||
    !isText(value.kkmNumber) ||
    !isText(value.fmNumber) ||
    !isText(value.fpd) ||
    !isText(value.fdNumber) ||
    !Array.isArray(value.items)
  ) return null

  try {
    const url = new URL(value.sourceUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  } catch {
    return null
  }

  const items = value.items.map(parseItem)
  if (items.some(item => item === null)) return null

  // Rebuild known fields so persisted data cannot add arbitrary state properties.
  return {
    id: value.id,
    sourceUrl: value.sourceUrl,
    ...(isText(value.feed) ? { feed: value.feed } : {}),
    importedAt: value.importedAt,
    dateTime: value.dateTime,
    // Older saved receipts did not include the number; reimporting fills it in.
    ticketNumber: typeof value.ticketNumber === 'string' ? value.ticketNumber : null,
    merchant: value.merchant,
    merchantAddress: value.merchantAddress,
    totalAmountMinor: value.totalAmountMinor,
    vatAmountMinor: value.vatAmountMinor,
    currency: value.currency,
    tin: value.tin,
    kkmNumber: value.kkmNumber,
    fmNumber: value.fmNumber,
    fpd: value.fpd,
    fdNumber: value.fdNumber,
    items: items as ReceiptItem[],
  }
}

export function getReceiptStorage(): ReceiptStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    // Browsers can block localStorage; imports still work for the current session.
    return undefined
  }
}

export function loadReceipts(storage: ReceiptStorage | undefined): Receipt[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(RECEIPTS_STORAGE_KEY)
    if (!raw) return []
    const saved: unknown = JSON.parse(raw)
    if (!isRecord(saved) || saved.version !== 1 || !Array.isArray(saved.receipts)) return []

    const receiptsById = new Map<string, Receipt>()
    for (const entry of saved.receipts) {
      const receipt = parseReceipt(entry)
      // One invalid record must not prevent recovery of the other receipts.
      if (receipt) receiptsById.set(receipt.id, receipt)
    }
    return [...receiptsById.values()]
  } catch {
    return []
  }
}

export function saveReceipts(storage: ReceiptStorage | undefined, receipts: Receipt[]): void {
  if (!storage) return
  try {
    storage.setItem(RECEIPTS_STORAGE_KEY, JSON.stringify({ version: 1, receipts }))
  } catch {
    // A full or unavailable storage area must not interrupt a successful import.
  }
}
