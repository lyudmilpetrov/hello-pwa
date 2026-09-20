import { createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'
import { DEFAULT_MERCHANTS, normalizeMerchantKey, sanitizeMerchantMapping } from '../lib/merchants'
import type { MerchantMapping } from '../lib/merchants'

export interface MerchantsState {
  items: MerchantMapping[]
}

const initialState: MerchantsState = {
  items: DEFAULT_MERCHANTS.map(mapping => ({ ...mapping })),
}

const merchantsSlice = createSlice({
  name: 'merchants',
  initialState,
  reducers: {
    merchantSaved(state, action: PayloadAction<MerchantMapping>) {
      const mapping = sanitizeMerchantMapping(action.payload)
      if (!mapping) return
      const key = normalizeMerchantKey(mapping.key)
      if (state.items.some(item => item.id !== mapping.id && normalizeMerchantKey(item.key) === key)) return

      const existingIndex = state.items.findIndex(item => item.id === mapping.id)
      if (existingIndex === -1) state.items.push(mapping)
      else state.items[existingIndex] = mapping
    },
  },
})

export const { merchantSaved } = merchantsSlice.actions
export default merchantsSlice.reducer
