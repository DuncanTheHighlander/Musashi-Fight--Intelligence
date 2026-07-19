'use client'

/**
 * MobileShell — the shared frame for the Musashi reboot mobile front-end.
 *
 * Renders the top bar (crest + wordmark, theme toggle, profile avatar), a
 * scrolling body for screen content, the bottom 5-tab bar, and the "voice is
 * coming soon" toast. Visuals are ported verbatim from design/musashi-reboot;
 * tokens come from the --ms-* design system in globals.css.
 *
 * This is Phase 1 of the front-end reboot: the foundation that each tab screen
 * is migrated into. Tabs route to the existing (app) pages, so the real app
 * keeps working while screens are reskinned one at a time.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'

// ── Voice "coming soon" affordance ─────────────────────────────────────────
// Any screen (e.g. a chat input mic button) can call showVoiceSoon() to flash
// the toast rendered by the shell.
type VoiceSoonContextValue = { showVoiceSoon: () => void }
const VoiceSoonContext = createContext<VoiceSoonContextValue>({ showVoiceSoon: () => {} })
export const useVoiceSoon = () => useContext(VoiceSoonContext)

// ── Tabs ────────────────────────────────────────────────────────────────────
type Tab = { label: string; href: string; icon: (active: boolean) => React.ReactNode; dot?: boolean }

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const TABS: Tab[] = [
  {
    label: 'Analyze',
    href: '/fight',
    icon: () => (
      <svg width="22" height="22" viewBox="0 0 24 24" {...stroke}>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 1.5v3M12 19.5v3M22.5 12h-3M4.5 12h-3" />
      </svg>
    ),
  },
  {
    label: 'Market',
    href: '/marketplace',
    icon: () => (
      <svg width="22" height="22" viewBox="0 0 24 24" {...stroke}>
        <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <path d="M16 10a4 4 0 0 1-8 0" />
      </svg>
    ),
  },
  {
    label: 'Library',
    href: '/library',
    icon: () => (
      <svg width="22" height="22" viewBox="0 0 24 24" {...stroke}>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  {
    label: 'Inbox',
    href: '/messages',
    dot: true,
    icon: () => (
      <svg width="22" height="22" viewBox="0 0 24 24" {...stroke}>
        <path d="M21 11.5a8.38 8.38 0 0 1-9 8.5 8.38 8.38 0 0 1-4-1L3 21l1-4a8.5 8.5 0 1 1 17-5.5z" />
      </svg>
    ),
  },
  {
    label: 'Profile',
    href: '/profile',
    icon: () => (
      <svg width="22" height="22" viewBox="0 0 24 24" {...stroke}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" />
      </svg>
    ),
  },
]

/** Shogun-only sixth tab — the admin console. Appended when isAdmin. */
const ADMIN_TAB: Tab = {
  label: 'Admin',
  href: '/shogun',
  icon: () => (
    <svg width="22" height="22" viewBox="0 0 24 24" {...stroke}>
      <path d="M2 8l4 4 6-8 6 8 4-4v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" />
    </svg>
  ),
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" {...stroke} strokeWidth={2}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" {...stroke} strokeWidth={2}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
    </svg>
  )
}

function VoiceWaveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" {...stroke} strokeWidth={2}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" />
    </svg>
  )
}

export function MobileShell({
  children,
  userInitials = 'M',
  isAdmin = false,
}: {
  children: React.ReactNode
  userInitials?: string
  isAdmin?: boolean
}) {
  const tabs = isAdmin ? [...TABS, ADMIN_TAB] : TABS
  const pathname = usePathname() || ''
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const [soon, setSoon] = useState(false)
  const soonTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showVoiceSoon = useCallback(() => {
    if (soonTimer.current) clearTimeout(soonTimer.current)
    setSoon(true)
    soonTimer.current = setTimeout(() => setSoon(false), 2600)
  }, [])
  useEffect(() => () => { if (soonTimer.current) clearTimeout(soonTimer.current) }, [])

  const isDark = !mounted || resolvedTheme !== 'light'
  const toggleTheme = () => setTheme(isDark ? 'light' : 'dark')

  return (
    <VoiceSoonContext.Provider value={{ showVoiceSoon }}>
      <div
        // h-screen fallback; 100dvh (where supported) tracks mobile browser
        // chrome so the tab bar stays pinned to the visible viewport.
        className="flex h-screen w-full items-stretch justify-center font-hanken"
        style={{ background: 'var(--ms-grad-page)', height: '100dvh' }}
      >
        <div className="relative flex w-full max-w-[440px] flex-col overflow-hidden bg-ms-bg text-ms-text">
          {/* ===== TOP BAR ===== */}
          <header
            className="z-[5] flex flex-shrink-0 items-center justify-between border-b px-5 pb-3 pt-6 backdrop-blur-md"
            style={{ borderColor: 'var(--ms-line06)', background: 'var(--ms-bg60)' }}
          >
            <Link href="/" className="flex items-center gap-3">
              <Image
                src={isDark ? '/brand/crest-bone.png' : '/brand/crest-ink.png'}
                alt="Musashi"
                width={27}
                height={27}
                className="h-[27px] w-auto opacity-95"
                priority
              />
              <span className="font-marcellus text-[17px] tracking-[0.32em] text-ms-bone">MUSASHI</span>
            </Link>
            <div className="flex items-center gap-2.5">
              <button
                onClick={toggleTheme}
                aria-label="Toggle theme"
                className="flex h-[34px] w-[34px] items-center justify-center rounded-full border bg-ms-surface3 text-ms-muted"
                style={{ borderColor: 'var(--ms-line12)' }}
              >
                {isDark ? <SunIcon /> : <MoonIcon />}
              </button>
              <Link
                href="/profile"
                className="flex h-[34px] w-[34px] items-center justify-center rounded-full border bg-ms-surface3 font-jbmono text-xs font-medium text-ms-gold"
                style={{ borderColor: 'var(--ms-line18)' }}
              >
                {userInitials}
              </Link>
            </div>
          </header>

          {/* ===== SCROLL BODY ===== */}
          <main className="ms-scroll flex-1 overflow-y-auto overflow-x-hidden">{children}</main>

          {/* ===== VOICE-SOON TOAST ===== */}
          {soon && (
            <div
              className="absolute bottom-[108px] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2.5 rounded-[13px] border px-4 py-2.5 shadow-2xl"
              style={{
                background: 'var(--ms-toast)',
                borderColor: 'rgba(201,162,76,0.3)',
                animation: 'ms-toast 0.25s ease both',
              }}
            >
              <span className="text-ms-gold">
                <VoiceWaveIcon />
              </span>
              <span className="text-[12.5px] text-ms-text">
                Voice replies — Musashi will speak. <span className="text-ms-gold">Coming soon.</span>
              </span>
            </div>
          )}

          {/* ===== BOTTOM TAB BAR ===== */}
          <nav
            className="flex flex-shrink-0 border-t px-1.5 pb-6 pt-2.5 backdrop-blur-xl"
            style={{ background: 'var(--ms-bg88)', borderColor: 'var(--ms-line08)' }}
          >
            {tabs.map((tab) => {
              const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`)
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={cn(
                    'relative flex flex-1 flex-col items-center gap-1 py-1',
                    active ? 'text-ms-orange' : 'text-ms-faint',
                  )}
                >
                  {tab.icon(active)}
                  <span className="text-[9.5px] font-medium tracking-[0.02em]">{tab.label}</span>
                  {tab.dot && (
                    <span
                      className="absolute right-6 top-0.5 h-[7px] w-[7px] rounded-full bg-ms-orange"
                      style={{ border: '1.5px solid var(--ms-bg)' }}
                    />
                  )}
                </Link>
              )
            })}
          </nav>
        </div>
      </div>
    </VoiceSoonContext.Provider>
  )
}
