import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

const GA_MEASUREMENT_ID = 'G-ESE5C2PLME'

function trackPageView() {
  if (typeof window.gtag !== 'function') return
  window.gtag('event', 'page_view', {
    page_path: window.location.pathname + window.location.search,
    page_location: window.location.href,
    send_to: GA_MEASUREMENT_ID,
  })
}

if (import.meta.env.PROD) {
  window.addEventListener('load', trackPageView)

  const originalPushState = window.history.pushState
  const originalReplaceState = window.history.replaceState

  window.history.pushState = function pushStatePatched(...args) {
    originalPushState.apply(this, args)
    trackPageView()
  }

  window.history.replaceState = function replaceStatePatched(...args) {
    originalReplaceState.apply(this, args)
    trackPageView()
  }

  window.addEventListener('popstate', trackPageView)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('Service worker registration failed:', error)
    })
  })
}
