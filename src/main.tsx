import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { Provider } from 'react-redux'
import App from './App'
import { store } from './store'
import './styles.css'

registerSW({
  immediate: true,
  onRegisterError(error) {
    console.error('Offline support could not be registered:', error)
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode><Provider store={store}><App /></Provider></StrictMode>,
)
