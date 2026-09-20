import { expect, test } from '@playwright/test'
import type { Receipt } from '../src/types/receipt'
import receiptsReducer, { receiptAdded } from '../src/store/receiptsSlice'
import { loadReceipts, RECEIPTS_STORAGE_KEY, saveReceipts } from '../src/store/persistence'

function receipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    id: 'receipt-fixture-001',
    sourceUrl: 'https://tax.salyk.kg/tax-web-control/client/api/v1/ticket?fixture=001',
    importedAt: '2026-09-20T11:00:00.000Z',
    dateTime: '2026-09-17T11:56:23.000Z',
    ticketNumber: '000087',
    merchant: 'Sample Market',
    merchantAddress: null,
    totalAmountMinor: 250,
    vatAmountMinor: 0,
    currency: 'KGS',
    tin: '00000000000001',
    kkmNumber: '000000000000003',
    fmNumber: '000000000000002',
    fpd: '000000000000004',
    fdNumber: '000001',
    items: [{ name: 'Weighted item', quantity: 0.25, unitPriceMinor: 1000, totalAmountMinor: 250 }],
    ...overrides,
  }
}

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem(key: string) { return values.get(key) ?? null },
    setItem(key: string, value: string) { values.set(key, value) },
  }
}

test('upserts a reimported receipt by id while retaining other receipts', () => {
  const first = receipt()
  const second = receipt({ id: 'receipt-fixture-002' })
  const updated = receipt({ merchant: 'Updated merchant', importedAt: '2026-09-20T12:00:00.000Z' })
  let state = receiptsReducer(undefined, receiptAdded(first))
  state = receiptsReducer(state, receiptAdded(second))
  state = receiptsReducer(state, receiptAdded(updated))
  expect(state.items).toEqual([second, updated])
  expect(first.merchant).toBe('Sample Market')
})

test('persists only versioned receipt data and retains exact identifiers and minor amounts', () => {
  const storage = memoryStorage()
  const original = receipt()
  saveReceipts(storage, [original])
  expect(JSON.parse(storage.getItem(RECEIPTS_STORAGE_KEY)!)).toEqual({ version: 1, receipts: [original] })
  expect(loadReceipts(storage)).toEqual([original])
})

test('restores older receipts without a number and fills it in on reimport', () => {
  const storage = memoryStorage()
  const { ticketNumber, ...legacy } = receipt()
  storage.setItem(RECEIPTS_STORAGE_KEY, JSON.stringify({ version: 1, receipts: [legacy] }))
  const restored = loadReceipts(storage)
  expect(restored).toEqual([{ ...legacy, ticketNumber: null }])
  const state = receiptsReducer({ items: restored }, receiptAdded(receipt()))
  saveReceipts(storage, state.items)
  expect(loadReceipts(storage)).toEqual([receipt()])
  expect(state.items[0].ticketNumber).toBe(ticketNumber)
})

test('filters corrupt dates per receipt without discarding valid neighboring records', () => {
  const storage = memoryStorage()
  const first = receipt()
  const last = receipt({ id: 'receipt-fixture-002' })
  storage.setItem(RECEIPTS_STORAGE_KEY, JSON.stringify({
    version: 1,
    receipts: [
      first,
      receipt({ id: 'bad-date', dateTime: 'not a date' }),
      receipt({ id: 'bad-import-date', importedAt: 'not a date' }),
      receipt({ id: 'out-of-range-date', dateTime: '999999-01-01T00:00:00Z' }),
      last,
    ],
  }))
  expect(loadReceipts(storage)).toEqual([first, last])
})

test('keeps missing VAT distinct from zero VAT when restoring receipts', () => {
  const storage = memoryStorage()
  const missing = receipt({ id: 'missing-vat', vatAmountMinor: null })
  const zero = receipt({ id: 'zero-vat', vatAmountMinor: 0 })
  saveReceipts(storage, [missing, zero])
  expect(loadReceipts(storage).map(entry => entry.vatAmountMinor)).toEqual([null, 0])
})

test('ignores unsafe or malformed records and deduplicates valid persisted receipts', () => {
  const storage = memoryStorage()
  const original = receipt()
  const updated = receipt({ merchant: 'Updated merchant' })
  storage.setItem(RECEIPTS_STORAGE_KEY, JSON.stringify({
    version: 1,
    receipts: [
      original,
      receipt({ id: 'bad-link', sourceUrl: 'javascript:alert(1)' }),
      receipt({ id: 'fractional-minor-amount', totalAmountMinor: 2.5 }),
      receipt({ id: 'unsafe-amount', totalAmountMinor: Number.MAX_SAFE_INTEGER + 1 }),
      { ...receipt({ id: 'numeric-id' }), tin: 123 },
      { ...receipt({ id: 'bad-item' }), items: [{ name: 'Missing price', quantity: 1 }] },
      { ...updated, unexpected: 'discard me' },
    ],
  }))
  expect(loadReceipts(storage)).toEqual([updated])
})

test('handles unavailable storage, malformed JSON, and unsupported schema versions', () => {
  expect(loadReceipts(undefined)).toEqual([])
  expect(() => saveReceipts(undefined, [receipt()])).not.toThrow()
  const storage = memoryStorage()
  for (const value of ['{broken JSON', 'null', '[]', JSON.stringify({ version: 2, receipts: [receipt()] })]) {
    storage.setItem(RECEIPTS_STORAGE_KEY, value)
    expect(loadReceipts(storage)).toEqual([])
  }
  const blockedStorage = {
    getItem() { throw new Error('Storage access denied') },
    setItem() { throw new Error('Storage quota exceeded') },
  }
  expect(loadReceipts(blockedStorage)).toEqual([])
  expect(() => saveReceipts(blockedStorage, [receipt()])).not.toThrow()
})
