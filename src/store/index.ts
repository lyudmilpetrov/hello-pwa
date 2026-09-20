import { combineReducers, configureStore, createAction } from '@reduxjs/toolkit'
import receiptsReducer from './receiptsSlice'
import { getReceiptStorage, loadReceipts, saveReceipts } from './persistence'

const storage = getReceiptStorage()
const appReducer = combineReducers({ receipts: receiptsReducer })
export const memoryCleared = createAction('app/memoryCleared')

export const store = configureStore({
  reducer: (state, action) => appReducer(memoryCleared.match(action) ? undefined : state, action),
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
