'use client'

import { useEffect } from 'react'

const STORAGE_KEY = 'musashi_chunk_recovery'

function isChunkLoadFailure(reason: unknown, message: string): boolean {
  if (reason && typeof reason === 'object' && 'name' in reason) {
    if ((reason as { name?: string }).name === 'ChunkLoadError') return true
  }
  const m = message.toLowerCase()
  return (
    m.includes('chunkloaderror') ||
    m.includes('loading chunk') ||
    m.includes('failed to fetch dynamically imported module')
  )
}

/**
 * After a dev-server rebuild or HMR, the browser may request old chunk URLs → ChunkLoadError.
 * Reload once; if chunks still fail after that, log recovery steps.
 */
export function ChunkLoadRecovery() {
  useEffect(() => {
    const state = sessionStorage.getItem(STORAGE_KEY)
    if (state === 'reloading') {
      sessionStorage.setItem(STORAGE_KEY, 'after-reload')
      window.setTimeout(() => sessionStorage.removeItem(STORAGE_KEY), 6000)
    } else if (state !== 'after-reload') {
      sessionStorage.removeItem(STORAGE_KEY)
    }

    const tryReload = (source: string) => {
      if (sessionStorage.getItem(STORAGE_KEY) === 'after-reload') {
        sessionStorage.removeItem(STORAGE_KEY)
        console.warn(
          '[ChunkLoadRecovery] Chunks still failing after reload. Try: Ctrl+Shift+R (hard refresh), or stop dev server and run: pnpm run dev:clean'
        )
        return
      }
      sessionStorage.setItem(STORAGE_KEY, 'reloading')
      console.info('[ChunkLoadRecovery] Stale webpack chunk (' + source + ') — reloading once…')
      window.location.reload()
    }

    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason
      const msg =
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
            ? reason
            : String(reason ?? '')
      if (!isChunkLoadFailure(reason, msg)) return
      e.preventDefault()
      tryReload('promise')
    }

    const onError = (e: ErrorEvent) => {
      const msg = e.message || ''
      if (!isChunkLoadFailure(null, msg)) return
      e.preventDefault()
      tryReload('error')
    }

    window.addEventListener('unhandledrejection', onRejection)
    window.addEventListener('error', onError)
    return () => {
      window.removeEventListener('unhandledrejection', onRejection)
      window.removeEventListener('error', onError)
    }
  }, [])

  return null
}
