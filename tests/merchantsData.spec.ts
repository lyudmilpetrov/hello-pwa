import { expect, test } from '@playwright/test'
import {
  DEFAULT_MERCHANTS,
  MERCHANTS_STORAGE_KEY,
  findMerchantCategory,
  loadMerchants,
  normalizeMerchantKey,
  saveMerchants,
} from '../src/lib/merchants'
import merchantsReducer, { merchantSaved } from '../src/store/merchantsSlice'
import { memoryCleared, store } from '../src/store'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem(key: string) { return values.get(key) ?? null },
    setItem(key: string, value: string) { values.set(key, value) },
  }
}

test('categorizes the four defaults within receipt merchant names, ignoring case and whitespace', () => {
  expect(findMerchantCategory('Магазин dns Бишкек', DEFAULT_MERCHANTS)).toBe('electronics')
  expect(findMerchantCategory('ОсОО «ГЛОБУС»', DEFAULT_MERCHANTS)).toBe('groceries')
  expect(findMerchantCategory('Аптека неман № 4', DEFAULT_MERCHANTS)).toBe('pharmacy')
  expect(findMerchantCategory('АЗС BISHKEK   Petroleum № 1', DEFAULT_MERCHANTS)).toBe('fuel')
  expect(findMerchantCategory('Unknown shop', DEFAULT_MERCHANTS)).toBeNull()
  expect(findMerchantCategory('', DEFAULT_MERCHANTS)).toBeNull()
})

test('normalizes Unicode and favors the longest matching merchant key regardless of order', () => {
  expect(normalizeMerchantKey('  ＤＮＳ\t Shop\n')).toBe('dns shop')
  expect(normalizeMerchantKey('  Cafe\u0301 ')).toBe(normalizeMerchantKey('CAFÉ'))
  const mappings = [
    { id: 'general', key: 'DNS', category: 'electronics' },
    { id: 'specific', key: 'DNS Service', category: 'repairs' },
    { id: 'empty', key: ' ', category: 'must not match' },
  ]
  expect(findMerchantCategory('DNS Service Center', mappings)).toBe('repairs')
  expect(findMerchantCategory('DNS Service Center', [...mappings].reverse())).toBe('repairs')
})

test('defaults are provided only initially and saved edits replace rather than merge with defaults', () => {
  const storage = memoryStorage()
  const initial = loadMerchants(storage)
  expect(initial).toEqual(DEFAULT_MERCHANTS)
  const renamed = initial.map(mapping => mapping.key === 'DNS'
    ? { ...mapping, key: 'Tech Store', category: 'computers' }
    : mapping)
  saveMerchants(storage, renamed)
  expect(JSON.parse(storage.getItem(MERCHANTS_STORAGE_KEY)!)).toEqual({ version: 1, merchants: renamed })
  expect(loadMerchants(storage)).toEqual(renamed)
  expect(findMerchantCategory('DNS', loadMerchants(storage))).toBeNull()
  saveMerchants(storage, [])
  expect(loadMerchants(storage)).toEqual([])
})

test('recovers valid stored mappings and ignores corrupt or duplicate records', () => {
  const storage = memoryStorage()
  storage.setItem(MERCHANTS_STORAGE_KEY, JSON.stringify({
    version: 1,
    merchants: [
      { id: ' first ', key: '  Shop  ', category: '  food ', extra: 'discard' },
      { id: 'blank', key: ' ', category: 'food' },
      { id: 'bad-category', key: 'Pharmacy', category: null },
      { id: 'duplicate-key', key: 'ＳＨＯＰ', category: 'other' },
      { id: 'first', key: 'Other shop', category: 'other' },
      { id: 'last', key: 'Fuel shop', category: 'fuel' },
    ],
  }))
  expect(loadMerchants(storage)).toEqual([
    { id: 'first', key: 'Shop', category: 'food' },
    { id: 'last', key: 'Fuel shop', category: 'fuel' },
  ])
})

test('uses independent defaults for missing, malformed, unsupported, or blocked storage', () => {
  expect(loadMerchants(undefined)).toEqual(DEFAULT_MERCHANTS)
  expect(() => saveMerchants(undefined, DEFAULT_MERCHANTS)).not.toThrow()
  const initial = loadMerchants(undefined)
  initial[0].category = 'changed locally'
  expect(loadMerchants(undefined)).toEqual(DEFAULT_MERCHANTS)
  const storage = memoryStorage()
  for (const value of ['{broken JSON', 'null', '[]', JSON.stringify({ version: 2, merchants: [] })]) {
    storage.setItem(MERCHANTS_STORAGE_KEY, value)
    expect(loadMerchants(storage)).toEqual(DEFAULT_MERCHANTS)
  }
  const blockedStorage = {
    getItem() { throw new Error('Storage access denied') },
    setItem() { throw new Error('Storage quota exceeded') },
  }
  expect(loadMerchants(blockedStorage)).toEqual(DEFAULT_MERCHANTS)
  expect(() => saveMerchants(blockedStorage, DEFAULT_MERCHANTS)).not.toThrow()
})

test('adds and edits trimmed mappings while rejecting blank fields and duplicate normalized keys', () => {
  let state = merchantsReducer(undefined, { type: 'initialize' })
  const initial = state
  for (const mapping of [
    { id: 'blank-key', key: ' ', category: 'food' },
    { id: 'blank-category', key: 'Shop', category: '\t' },
    { id: ' ', key: 'Shop', category: 'food' },
    { id: 'duplicate-dns', key: '  ｄｎｓ ', category: 'food' },
  ]) state = merchantsReducer(state, merchantSaved(mapping))
  expect(state).toBe(initial)

  state = merchantsReducer(state, merchantSaved({ id: ' shop ', key: ' My Shop ', category: ' food ' }))
  expect(state.items.at(-1)).toEqual({ id: 'shop', key: 'My Shop', category: 'food' })
  const added = state
  state = merchantsReducer(state, merchantSaved({ id: 'other', key: 'MY\tSHOP', category: 'other' }))
  expect(state).toBe(added)
  state = merchantsReducer(state, merchantSaved({ id: 'shop', key: 'MY SHOP', category: 'groceries' }))
  expect(state.items).toHaveLength(DEFAULT_MERCHANTS.length + 1)
  expect(state.items.at(-1)?.category).toBe('groceries')
  const edited = state
  state = merchantsReducer(state, merchantSaved({ id: 'shop', key: 'DNS', category: 'groceries' }))
  expect(state).toBe(edited)
})

test('clearing app memory restores the default merchant mappings', () => {
  store.dispatch(merchantSaved({ id: 'custom', key: 'Custom merchant', category: 'other' }))
  store.dispatch(merchantSaved({ ...DEFAULT_MERCHANTS[0], key: 'Renamed DNS' }))
  expect(store.getState().merchants.items).not.toEqual(DEFAULT_MERCHANTS)
  store.dispatch(memoryCleared())
  expect(store.getState().merchants.items).toEqual(DEFAULT_MERCHANTS)
})
