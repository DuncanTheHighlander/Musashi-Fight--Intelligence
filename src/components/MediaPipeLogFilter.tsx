'use client'

import { useEffect } from 'react'

/**
 * MediaPipe's WASM runtime writes stdout/stderr through console.error via
 * Emscripten's _fd_write. Benign INFO/WARNING lines such as
 * "INFO: Created TensorFlow Lite XNNPACK delegate for CPU." get surfaced by
 * Next.js 15's dev overlay as unhandled client errors.
 *
 * This filter runs once, intercepts console.error, and redirects those
 * specific MediaPipe log lines to console.info / console.warn. Anything
 * else is passed through untouched so real errors still show up.
 */
export function MediaPipeLogFilter() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const w = window as typeof window & { __mpLogFilterInstalled?: boolean }
    if (w.__mpLogFilterInstalled) return
    w.__mpLogFilterInstalled = true

    const originalError = console.error.bind(console)
    const originalWarn = console.warn.bind(console)

    const isMediaPipeStderr = (args: unknown[]): 'info' | 'warn' | null => {
      const first = args[0]
      if (typeof first !== 'string') return null
      if (first.startsWith('INFO: ')) return 'info'
      if (first.startsWith('W ') || first.startsWith('WARNING: ')) return 'warn'
      // onnxruntime-web (RTMPose backend) logs session warnings through
      // console.error with ANSI color codes, e.g.
      // "[0;93m2026-07-01 ... [W:onnxruntime:, session_state.cc:...]".
      // Benign — demote to warn so the dev overlay stays clean.
      if (first.includes('[W:onnxruntime')) return 'warn'
      return null
    }

    console.error = (...args: unknown[]) => {
      const level = isMediaPipeStderr(args)
      if (level === 'info') {
        console.info(...(args as Parameters<typeof console.info>))
        return
      }
      if (level === 'warn') {
        originalWarn(...(args as Parameters<typeof console.warn>))
        return
      }
      originalError(...(args as Parameters<typeof console.error>))
    }
  }, [])

  return null
}
