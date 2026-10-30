import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import { startBackgroundSync } from './services/syncService'
import { registerServiceWorker } from './lib/install'

function SyncBootstrap() { useEffect(() => startBackgroundSync(), []); return null }

registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider><BrowserRouter><SyncBootstrap /><App /></BrowserRouter></AuthProvider>
  </StrictMode>,
)
