import { configureStore } from '@reduxjs/toolkit'
import receiptsReducer from './receiptsSlice'
import { getReceiptStorage, loadReceipts, saveReceipts } from './persistence'

const storage = getReceiptStorage()

export const store = configureStore({
  reducer: { receipts: receiptsReducer },
  preloadedState: { receipts: { items: loadReceipts(storage) } },
})

let savedReceipts = store.getState().receipts.items
store.subscribe(() => {
  const receipts = store.getState().receipts.items
  if (receipts !== savedReceipts) {
    saveReceipts(storage, receipts)
    savedReceipts = receipts
  }
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
