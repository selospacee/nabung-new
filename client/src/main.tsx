import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { consumeStartRedirect } from './lib/startRoute'

// Layar utama (standalone) tidak boleh mendarat di /settings pada pembukaan awal sesi.
if (consumeStartRedirect(window.location.pathname)) {
  window.history.replaceState(window.history.state, '', '/')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
