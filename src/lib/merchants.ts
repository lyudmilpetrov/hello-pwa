export interface MerchantMapping {
  id: string
  key: string
  category: string
}

export const DEFAULT_MERCHANTS: readonly MerchantMapping[] = [
  { id: 'default-dns', key: 'DNS', category: 'electronics' },
  { id: 'default-globus', key: 'Глобус', category: 'groceries' },
  { id: 'default-neman', key: 'Неман', category: 'pharmacy' },
  { id: 'default-bishkek-petroleum', key: 'Bishkek Petroleum', category: 'fuel' },
]

export const MERCHANTS_STORAGE_KEY = 'taxes.merchants.v1'
export type MerchantStorage = Pick<Storage, 'getItem' | 'setItem'>

export function normalizeMerchantKey(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Prefer the most specific key when a merchant name matches several mappings. */
export function findMerchantCategory(merchant: string, mappings: readonly MerchantMapping[]): string | null {
  const name = normalizeMerchantKey(merchant)
  let longestKeyLength = 0
  let category: string | null = null
  for (const mapping of mappings) {
    const key = normalizeMerchantKey(mapping.key)
    if (key.length > longestKeyLength && mapping.category.trim() && name.includes(key)) {
      longestKeyLength = key.length
      category = mapping.category
    }
  }
  return category
}

export function sanitizeMerchantMapping(value: unknown): MerchantMapping | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const entry = value as Record<string, unknown>
  if (typeof entry.id !== 'string' || !entry.id.trim()
    || typeof entry.key !== 'string' || !normalizeMerchantKey(entry.key)
    || typeof entry.category !== 'string' || !entry.category.trim()) return null

  return { id: entry.id.trim(), key: entry.key.trim(), category: entry.category.trim() }
}

function defaultMerchants(): MerchantMapping[] {
  return DEFAULT_MERCHANTS.map(mapping => ({ ...mapping }))
}

export function loadMerchants(storage: MerchantStorage | undefined): MerchantMapping[] {
  if (!storage) return defaultMerchants()
  try {
    const raw = storage.getItem(MERCHANTS_STORAGE_KEY)
    if (!raw) return defaultMerchants()
    const saved: unknown = JSON.parse(raw)
    if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return defaultMerchants()
    const data = saved as Record<string, unknown>
    if (data.version !== 1 || !Array.isArray(data.merchants)) return defaultMerchants()

    const mappings: MerchantMapping[] = []
    const ids = new Set<string>()
    const keys = new Set<string>()
    for (const entry of data.merchants) {
      const mapping = sanitizeMerchantMapping(entry)
      if (!mapping) continue
      const key = normalizeMerchantKey(mapping.key)
      if (ids.has(mapping.id) || keys.has(key)) continue
      ids.add(mapping.id)
      keys.add(key)
      mappings.push(mapping)
    }
    // Saved mappings replace defaults, so renaming a default stays renamed.
    return mappings
  } catch {
    return defaultMerchants()
  }
}

export function saveMerchants(storage: MerchantStorage | undefined, merchants: readonly MerchantMapping[]): void {
  if (!storage) return
  try {
    storage.setItem(MERCHANTS_STORAGE_KEY, JSON.stringify({ version: 1, merchants }))
  } catch {
    // Changes remain usable for this session if storage is blocked or full.
  }
}
