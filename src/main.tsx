import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './styles.css'

registerSW({
  immediate: true,
  onRegisterError(error) {
    console.error('Offline support could not be registered:', error)
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
)
