import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { parseReceipt } from '../src/lib/receiptData'

const sourceUrl = 'https://tax.salyk.kg/tax-web-control/client/api/v1/ticket?fixture=001'
const fixture = JSON.parse(readFileSync(new URL('./fixtures/receipt.json', import.meta.url), 'utf8'))
const fresh = () => structuredClone(fixture)

test('normalizes the fiscal API shape, minor units, IDs, and UTC date', () => {
  const before = Date.now()
  const receipt = parseReceipt(fresh(), sourceUrl)
  expect(receipt).toMatchObject({
    id: 'receipt-fixture-001',
    sourceUrl,
    dateTime: '2026-09-17T11:56:23.000Z',
    merchant: 'Sample Market',
    merchantAddress: '1 Example Street, Bishkek',
    totalAmountMinor: 91950,
    vatAmountMinor: 9765,
    currency: 'KGS',
    tin: '00000000000001',
    kkmNumber: '000000000000003',
    fmNumber: '000000000000002',
    fpd: '000000000000004',
    fdNumber: '172045',
    items: [
      { name: 'Shaving foam', quantity: 1, unitPriceMinor: 29990, totalAmountMinor: 29990 },
      { name: 'Paper roll', quantity: 3, unitPriceMinor: 16990, totalAmountMinor: 50970 },
      { name: 'Razor', quantity: 1, unitPriceMinor: 10990, totalAmountMinor: 10990 },
    ],
  })
  expect(Date.parse(receipt.importedAt)).toBeGreaterThanOrEqual(before)
  expect(Date.parse(receipt.importedAt)).toBeLessThanOrEqual(Date.now())
  expect(receipt.items.reduce((sum, item) => sum + item.totalAmountMinor, 0)).toBe(91950)
})

test('retains zero-leading identifiers and decimal quantities without changing minor units', () => {
  const data = fresh()
  data.fdNumber = '000001'
  data.items = [{ goodName: 'Weighted item', goodQuantity: 0.25, goodPrice: 1000, goodCost: 250 }]
  data.ticketTotalSum = 250
  const receipt = parseReceipt(data, sourceUrl)
  expect(receipt.fdNumber).toBe('000001')
  expect(receipt.items).toEqual([{ name: 'Weighted item', quantity: 0.25, unitPriceMinor: 1000, totalAmountMinor: 250 }])
})

test('combines multiple VAT rates and excludes sales tax', () => {
  const data = fresh()
  data.taxCounters = [
    { type: 'ST', rate: 1, sum: 813 },
    { type: 'VAT', rate: 0, sum: 0 },
    { type: 'VAT', rate: 12, sum: 9765 },
    { type: 'VAT', rate: 6, sum: 200 },
  ]
  expect(parseReceipt(data, sourceUrl).vatAmountMinor).toBe(9965)
})

test('distinguishes missing VAT from an explicit zero VAT amount', () => {
  for (const counters of [undefined, null, [], [{ type: 'ST', sum: 813 }]]) {
    const data = fresh()
    data.taxCounters = counters
    expect(parseReceipt(data, sourceUrl).vatAmountMinor).toBeNull()
  }
  const data = fresh()
  data.taxCounters = [{ type: 'VAT', rate: 0, sum: 0 }]
  expect(parseReceipt(data, sourceUrl).vatAmountMinor).toBe(0)
})

test('accepts diagnostic errors alongside valid receipt data', () => {
  expect(parseReceipt(fresh(), sourceUrl).id).toBe('receipt-fixture-001')
})

test('normalizes a timezone offset to UTC and permits an absent address', () => {
  const data = fresh()
  data.dateTime = '2026-09-17T17:56:23+06:00'
  delete data.crData.locationAddress
  const receipt = parseReceipt(data, sourceUrl)
  expect(receipt.dateTime).toBe('2026-09-17T11:56:23.000Z')
  expect(receipt.merchantAddress).toBeNull()
})

test('rejects unknown JSON and API error bodies', () => {
  for (const data of [null, [], 'server error', 500, {}, { errors: { missing: ['receipt'] } }, { message: 'Not found' }]) {
    expect(() => parseReceipt(data, sourceUrl)).toThrow(/receipt/i)
  }
})

test('rejects malformed or unsafe monetary values instead of rounding or coercing', () => {
  for (const amount of ['91950', null, -1, 919.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    for (const field of ['ticketTotalSum', 'goodPrice', 'goodCost', 'VAT']) {
      const data = fresh()
      if (field === 'ticketTotalSum') data.ticketTotalSum = amount
      else if (field === 'VAT') data.taxCounters = [{ type: 'VAT', sum: amount }]
      else data.items[0][field] = amount
      expect(() => parseReceipt(data, sourceUrl)).toThrow(/invalid/i)
    }
  }
  const data = fresh()
  data.taxCounters = [{ type: 'VAT', sum: Number.MAX_SAFE_INTEGER }, { type: 'VAT', sum: 1 }]
  expect(() => parseReceipt(data, sourceUrl)).toThrow(/VAT/i)
})

test('rejects malformed identifiers, dates, quantities, and item collections', () => {
  for (const [key, value] of [
    ['tin', Number.MAX_SAFE_INTEGER + 1],
    ['documentFiscalMark', 'not-a-fiscal-mark'],
    ['dateTime', '2026-02-30T11:56:23Z'],
    ['dateTime', '2026-09-17T11:56:23'],
    ['dateTime', 'yesterday'],
    ['items', {}],
  ] as const) {
    const data = fresh()
    data[key] = value
    expect(() => parseReceipt(data, sourceUrl)).toThrow(/invalid/i)
  }
  for (const quantity of ['1', 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const data = fresh()
    data.items[0].goodQuantity = quantity
    expect(() => parseReceipt(data, sourceUrl)).toThrow(/quantity/i)
  }
})

test('rejects malformed or non-web source links', () => {
  for (const url of ['javascript:alert(1)', 'file:///receipt.json', 'not a URL']) {
    expect(() => parseReceipt(fresh(), url)).toThrow(/website link/i)
  }
})
