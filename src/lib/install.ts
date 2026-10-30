import { useSyncExternalStore } from 'react'

// Installation as an app (PWA) and updates of the installed copy.
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

/** `manual`: the browser has no install prompt; the user adds the app from its menu (Safari). */
export type InstallState = { canPrompt: boolean; installed: boolean; manual: 'ios' | 'mac-safari' | null; updateReady: boolean }

const isStandalone = () => typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)

function manualPlatform(): InstallState['manual'] {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent
  const iOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (iOS) return 'ios'
  const safari = /safari/i.test(ua) && !/chrome|chromium|crios|fxios|edg|opr|android/i.test(ua)
  return safari && /macintosh/i.test(ua) ? 'mac-safari' : null
}

let deferred: InstallPromptEvent | null = null
let state: InstallState = { canPrompt: false, installed: isStandalone(), manual: manualPlatform(), updateReady: false }
const listeners = new Set<() => void>()
const set = (patch: Partial<InstallState>) => { state = { ...state, ...patch }; listeners.forEach((listener) => listener()) }

export const useInstallState = () => useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => state, () => state)

// The prompt event fires early, often before React renders: listen at import time.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); deferred = event as InstallPromptEvent; set({ canPrompt: true }) })
  window.addEventListener('appinstalled', () => { deferred = null; set({ canPrompt: false, installed: true }) })
  window.matchMedia('(display-mode: standalone)').addEventListener('change', () => set({ installed: isStandalone() }))
}

/** Opens the browser's install dialog. Returns true when the user accepted. */
export async function promptInstall() {
  if (!deferred) return false
  const event = deferred
  deferred = null
  set({ canPrompt: false })
  await event.prompt()
  return (await event.userChoice).outcome === 'accepted'
}

let waiting: ServiceWorker | null = null

/**
 * Registers the service worker (production builds only: in development a cache
 * would hide code changes). A new version waits until the user accepts it, so a
 * sale in progress is never interrupted by a reload.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  const watch = (worker: ServiceWorker | null) => {
    if (!worker) return
    const check = () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) { waiting = worker; set({ updateReady: true }) } }
    worker.addEventListener('statechange', check)
    check()
  }
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').then((registration) => {
      watch(registration.waiting)
      registration.addEventListener('updatefound', () => watch(registration.installing))
      // Installed apps stay open for days: look for a new version regularly.
      const update = () => { if (navigator.onLine) void registration.update().catch(() => undefined) }
      setInterval(update, 30 * 60_000)
      window.addEventListener('online', update)
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') update() })
    }).catch(() => undefined)
  })
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading && waiting) { reloading = true; window.location.reload() } })
}

/** Activates the waiting version; the page reloads once it has taken over. */
export function applyUpdate() {
  waiting?.postMessage('skip-waiting')
}
