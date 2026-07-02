'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Loader2, Video } from 'lucide-react'
import { useSection } from '@/contexts/SectionContext'
import { useVoiceSoon } from '@/components/mobile/MobileShell'

// FightCoachExperience pulls in MediaPipe + WASM. Loading it on the server
// (or even on the client during the initial RSC payload) crashes the dev
// server's 2 GB heap and ships ~3 MB of WASM-touching code into First Load JS.
// Dynamic + ssr:false keeps the home shell instant and defers the pose stack
// until the user actually opens the Fight Lab.
const FightCoachExperience = dynamic(() => import('@/components/fight/FightCoachExperience'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] items-center justify-center rounded-2xl border bg-ms-surface" style={{ borderColor: 'var(--ms-line10)' }}>
      <Loader2 className="h-6 w-6 animate-spin text-ms-orange" />
    </div>
  ),
})

import ProfilesSection from '@/components/sections/ProfilesSection'
import MarketplaceSection from '@/components/sections/MarketplaceSection'
import ScoutingSection from '@/components/sections/ScoutingSection'
import CoachesSection from '@/components/sections/CoachesSection'
import MessagesSection from '@/components/sections/MessagesSection'
import LibrarySection from '@/components/sections/LibrarySection'
import ProfileSection from '@/components/sections/ProfileSection'

export default function HomePage() {
  const { activeSection } = useSection()
  const router = useRouter()
  const { showVoiceSoon } = useVoiceSoon()
  const [bootstrapVideoFile, setBootstrapVideoFile] = useState<File | null>(null)
  const [autoPlayFixture, setAutoPlayFixture] = useState(false)
  const fixtureLoadedRef = useRef(false)

  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && !new URLSearchParams(window.location.search).get('qaLoop')) return
    const params = new URLSearchParams(window.location.search)
    const qaLoop = params.get('qaLoop') === '1'
    if (!qaLoop && process.env.NODE_ENV === 'production') return

    const fixtureVideo = params.get('fixtureVideo')
    const fixtureAutoPlay = params.get('fixtureAutoplay') === '1'
    if (!fixtureVideo?.startsWith('/test-videos/')) {
      if (qaLoop && !fixtureLoadedRef.current) {
        void fetch('/test-videos/clips.manifest.json')
          .then((r) => r.json())
          .then((raw: unknown) => {
            const m = raw as { clips: Array<{ url: string }> }
            const first = m.clips[0]?.url
            if (first) {
              params.set('fixtureVideo', first)
              params.set('qaClip', '0')
              window.location.search = params.toString()
            }
          })
          .catch(() => {})
      }
      return
    }

    let cancelled = false
    const loadFixture = async () => {
      const res = await fetch(fixtureVideo)
      if (!res.ok) throw new Error(`Fixture video failed to load: ${res.status}`)
      const contentType = res.headers.get('content-type') || ''
      if (!contentType.startsWith('video/')) {
        throw new Error(`Fixture did not return a video: ${contentType || 'unknown content type'}`)
      }
      const blob = await res.blob()
      if (blob.size < 1024) throw new Error('Fixture video response was empty')
      if (cancelled || fixtureLoadedRef.current) return
      const name = fixtureVideo.split('/').pop() || 'fixture-video.mp4'
      const file = new File([blob], name, { type: blob.type || 'video/mp4' })
      fixtureLoadedRef.current = true
      setAutoPlayFixture(fixtureAutoPlay)
      setBootstrapVideoFile(file)
    }

    void loadFixture().catch((error) => {
      fixtureLoadedRef.current = false
      console.warn('[fixture] video load failed', error)
    })

    return () => {
      cancelled = true
    }
  }, [])

  /** QA loop: after dense pass on clip N, auto-advance to clip N+1 (dev / ?qaLoop=1). */
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('qaLoop') !== '1') return

    const onDenseReady = async () => {
      const manifest = await fetch('/test-videos/clips.manifest.json').then((r) => r.json()) as {
        clips: Array<{ id: string; url: string; label: string }>
      }
      const idx = Number(params.get('qaClip') ?? '0')
      const current = manifest.clips[idx]
      console.log(`[qaLoop] dense pass complete — ${current?.label ?? idx}`)
      const next = idx + 1
      if (next >= manifest.clips.length) {
        console.log('[qaLoop] all clips done — loop complete')
        return
      }
      params.set('qaClip', String(next))
      params.set('fixtureVideo', manifest.clips[next]!.url)
      fixtureLoadedRef.current = false
      window.location.search = params.toString()
    }

    window.addEventListener('musashi:dense-ready', onDenseReady)
    return () => window.removeEventListener('musashi:dense-ready', onDenseReady)
  }, [])

  const scrollToFightLab = useCallback(() => {
    requestAnimationFrame(() => {
      document.getElementById('fight-lab-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  const clearBootstrapVideo = useCallback(() => setBootstrapVideoFile(null), [])
  const OFFLINE = process.env.NEXT_PUBLIC_OFFLINE_MODE === '1'

  const onHeroFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setBootstrapVideoFile(f)
    // The Fight Lab below is the real preview → processing → results surface.
    scrollToFightLab()
  }

  // The design's "ask anything, no clip needed" entry — the live AI coach chat
  // lives in the Fight Lab, so submitting brings the user to it.
  const [entryDraft, setEntryDraft] = useState('')
  const onAskCoach = (e: React.FormEvent) => {
    e.preventDefault()
    if (!entryDraft.trim()) return
    scrollToFightLab()
  }

  if (activeSection === 'fighters') return <ProfilesSection />
  if (activeSection === 'marketplace') return <MarketplaceSection />
  if (activeSection === 'scouting') return <ScoutingSection />
  if (activeSection === 'coaches') return <CoachesSection />
  if (activeSection === 'messages') return <MessagesSection />
  if (activeSection === 'library') return <LibrarySection />
  if (activeSection === 'profile') return <ProfileSection />

  return (
    <div style={{ animation: 'ms-up 0.4s ease both' }}>
      <input
        id="musashi-hero-video-input"
        type="file"
        accept="video/*,video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
        className="sr-only"
        aria-label="Upload a fight video"
        onChange={onHeroFileChange}
      />
      <input
        id="musashi-hero-record-input"
        type="file"
        accept="video/*"
        capture="environment"
        className="sr-only"
        aria-label="Record a fight video"
        onChange={onHeroFileChange}
      />

      {/* ---- ANALYZE · UPLOAD (design/musashi-reboot) ---- */}
      <div className="px-5 pb-7 pt-[26px]">
        {OFFLINE && (
          <div className="mb-4 rounded-xl border px-4 py-3 text-[12.5px] text-ms-orange-soft" style={{ borderColor: 'rgba(198,70,27,0.4)', background: 'rgba(198,70,27,0.07)' }}>
            <strong>Offline mode active.</strong> Coaching analysis is mocked and not running on Gemini.
          </div>
        )}

        <div className="mb-3.5 font-jbmono text-[11px] tracking-[0.22em] text-ms-orange">AI FIGHT INTELLIGENCE</div>
        <h1 className="mb-3 font-marcellus text-[34px] font-normal leading-[1.08] tracking-[-0.01em] text-ms-bright">
          Step into<br />your corner.
        </h1>
        <p className="mb-[26px] max-w-[300px] text-[14.5px] leading-[1.55] text-ms-muted">
          Upload a clip and get an elite-level tactical breakdown of your fight — in seconds.
        </p>

        <label
          htmlFor="musashi-hero-video-input"
          className="flex w-full cursor-pointer flex-col items-center gap-3 rounded-[20px] px-5 py-[34px]"
          style={{ border: '1.5px dashed rgba(198,70,27,0.5)', background: 'rgba(198,70,27,0.07)' }}
        >
          <div className="flex h-[54px] w-[54px] items-center justify-center rounded-2xl" style={{ background: '#C6461B', boxShadow: '0 8px 24px rgba(198,70,27,0.35)' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <div className="text-center">
            <div className="text-[15px] font-semibold text-ms-bone">Tap to upload your clip</div>
            <div className="mt-[5px] font-jbmono text-[11px] text-ms-faint">MP4 · MOV · WEBM — up to 60s</div>
          </div>
        </label>

        {bootstrapVideoFile && (
          <div
            role="status"
            className="mt-3 flex items-center gap-2 rounded-xl border px-4 py-3 text-[12.5px] text-ms-orange-soft"
            style={{ borderColor: 'rgba(198,70,27,0.4)', background: 'rgba(198,70,27,0.07)' }}
          >
            <Video className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate font-medium">{bootstrapVideoFile.name}</span>
            <span className="opacity-70">— loading in Fight Lab below</span>
          </div>
        )}

        <div className="mt-3.5 flex gap-3">
          <label
            htmlFor="musashi-hero-record-input"
            className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-[14px] border bg-ms-surface2 px-3 py-[13px] text-[13.5px] font-medium text-ms-text"
            style={{ borderColor: 'var(--ms-line12)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="7" />
              <circle cx="12" cy="12" r="2.5" fill="currentColor" />
            </svg>
            Record now
          </label>
          <button
            type="button"
            onClick={() => router.push('/marketplace')}
            className="flex flex-1 items-center justify-center gap-2 rounded-[14px] border bg-ms-surface2 px-3 py-[13px] text-[13.5px] font-medium text-ms-text"
            style={{ borderColor: 'var(--ms-line12)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" />
            </svg>
            Hire a coach
          </button>
        </div>

        {/* Musashi AI Coach — ask anything entry */}
        <div className="mt-3.5 overflow-hidden rounded-[18px] border" style={{ borderColor: 'var(--ms-line10)', background: 'var(--ms-chat)' }}>
          <div className="flex items-center gap-2.5 border-b px-3.5 py-3" style={{ borderColor: 'var(--ms-line07)' }}>
            <div className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full border bg-ms-surface3" style={{ borderColor: 'rgba(201,162,76,0.3)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/crest-bone.png" alt="" className="hidden h-[15px] opacity-85 dark:block" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/crest-ink.png" alt="" className="block h-[15px] opacity-75 dark:hidden" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ms-bone">
                Musashi AI Coach
                <span className="rounded px-[5px] py-px font-jbmono text-[8px] tracking-[0.06em] text-ms-gold" style={{ background: 'rgba(201,162,76,0.18)' }}>AI</span>
              </div>
              <div className="mt-px text-[11px] text-ms-faint">Ask anything — no clip needed</div>
            </div>
          </div>
          <form onSubmit={onAskCoach} className="flex items-center gap-2 px-3 py-[11px]">
            <input
              value={entryDraft}
              onChange={(e) => setEntryDraft(e.target.value)}
              placeholder="How do I stop dropping my hands?"
              className="min-w-0 flex-1 rounded-xl border bg-ms-surface2 px-[13px] py-[11px] text-[13.5px] text-ms-text outline-none placeholder:text-ms-faint"
              style={{ borderColor: 'var(--ms-line10)' }}
            />
            <button
              type="button"
              onClick={showVoiceSoon}
              title="Voice — coming soon"
              className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[11px] border bg-ms-surface2 text-ms-faint"
              style={{ borderColor: 'var(--ms-line10)' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4" />
              </svg>
            </button>
            <button
              type="submit"
              className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[11px] text-white"
              style={{ background: '#C6461B' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </form>
        </div>
      </div>

      {/* ---- FIGHT LAB — the real preview / processing / results surface ---- */}
      <section id="fight-lab-anchor" className="scroll-mt-24 px-5 pb-8 outline-none" tabIndex={-1} aria-label="Fight Lab">
        <div className="mb-4">
          <h2 className="font-marcellus text-2xl font-normal text-ms-bright">Fight Lab</h2>
          <p className="mt-1 text-[12.5px] text-ms-muted">
            Upload a clip or try the demo — choose a clip, then wait for Ready and press Play.
          </p>
        </div>
        <FightCoachExperience
          hideShellHeader
          bootstrapVideoFile={bootstrapVideoFile}
          autoPlayOnReady={autoPlayFixture}
          onBootstrapConsumed={clearBootstrapVideo}
        />
      </section>
    </div>
  )
}
