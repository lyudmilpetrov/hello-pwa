import { combineReducers, configureStore, createAction } from '@reduxjs/toolkit'
import receiptsReducer from './receiptsSlice'
import merchantsReducer from './merchantsSlice'
import { getReceiptStorage, loadReceipts, saveReceipts } from './persistence'
import { loadMerchants, saveMerchants } from '../lib/merchants'

const storage = getReceiptStorage()
const appReducer = combineReducers({ receipts: receiptsReducer, merchants: merchantsReducer })
export const memoryCleared = createAction('app/memoryCleared')

export const store = configureStore({
  reducer: (state, action) => appReducer(memoryCleared.match(action) ? undefined : state, action),
  preloadedState: {
    receipts: { items: loadReceipts(storage) },
    merchants: { items: loadMerchants(storage) },
  },
})

let savedReceipts = store.getState().receipts.items
let savedMerchants = store.getState().merchants.items
store.subscribe(() => {
  const receipts = store.getState().receipts.items
  if (receipts !== savedReceipts) {
    saveReceipts(storage, receipts)
    savedReceipts = receipts
  }
  const merchants = store.getState().merchants.items
  if (merchants !== savedMerchants) {
    saveMerchants(storage, merchants)
    savedMerchants = merchants
  }
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
