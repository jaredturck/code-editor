import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { hydrateDurableStore } from '@/platform/localStorageStore'
import './index.css'

function render_fatal_startup(message: string) {
  const root = document.getElementById('root')

  if (!root) {
    return
  }

  root.innerHTML = `
    <div role="alert" style="min-height:100vh;display:grid;place-items:center;padding:32px;background:#111113;color:#f4f4f5;font-family:system-ui,sans-serif">
      <div style="max-width:620px;text-align:center">
        <h1 style="font-size:20px;margin:0 0 12px">Secure AI platform unavailable</h1>
        <p data-startup-error style="line-height:1.55;margin:0;color:#a1a1aa"></p>
      </div>
    </div>
  `
  const error_message = root.querySelector('[data-startup-error]')
  if (error_message) error_message.textContent = message
}

async function start_renderer() {
  try {
    await hydrateDurableStore()
  } catch (error) {
    render_fatal_startup(
      error instanceof Error
        ? error.message
        : 'The encrypted local AI platform could not initialize.',
    )
    return
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void start_renderer()
