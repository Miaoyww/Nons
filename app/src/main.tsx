import React from 'react'
import ReactDOM from 'react-dom/client'
import '@/styles/globals.css'
import { initializeFontSettings } from '@/features/settings/font-settings'

initializeFontSettings()

// Let custom menus handle the event first, then suppress the WebView default menu.
window.addEventListener('contextmenu', (event) => {
  event.preventDefault()
})

// Keep Tab from moving focus or triggering component-level navigation.
if (!new URLSearchParams(location.search).has('tray'))
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Tab') return
      event.preventDefault()
      event.stopImmediatePropagation()
    },
    { capture: true }
  )

async function start() {
  const tray = new URLSearchParams(location.search).has('tray')
  const { default: Root } = tray ? await import('@/features/tray/tray-menu') : await import('./App')
  if (!tray) {
    const { installPluginBridge } = await import('@/plugins/host')
    installPluginBridge()
  }
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>
  )
}
void start().catch(console.error)
