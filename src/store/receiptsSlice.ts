import { createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'
import type { Receipt } from '../types/receipt'

export interface ReceiptsState {
  items: Receipt[]
}

const initialState: ReceiptsState = { items: [] }

const receiptsSlice = createSlice({
  name: 'receipts',
  initialState,
  reducers: {
    receiptAdded(state, action: PayloadAction<Receipt>) {
      const existingIndex = state.items.findIndex(receipt => receipt.id === action.payload.id)
      if (existingIndex === -1) {
        state.items.unshift(action.payload)
      } else {
        state.items[existingIndex] = action.payload
      }
    },
  },
})

export const { receiptAdded } = receiptsSlice.actions
export default receiptsSlice.reducer
