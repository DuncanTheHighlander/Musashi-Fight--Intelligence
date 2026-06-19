'use client'

import React, { createContext, useContext, useState, useCallback } from 'react'

export type AppSection =
  | 'coach'
  | 'fighters'
  | 'marketplace'
  | 'scouting'
  | 'coaches'
  | 'messages'
  | 'library'
  | 'profile'
  | 'dashboard'

interface SectionContextValue {
  activeSection: AppSection
  setActiveSection: (section: AppSection) => void
}

const SectionContext = createContext<SectionContextValue | null>(null)

export function SectionProvider({ children }: { children: React.ReactNode }) {
  const [activeSection, setActiveSectionRaw] = useState<AppSection>('coach')

  const setActiveSection = useCallback((section: AppSection) => {
    setActiveSectionRaw(section)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [])

  return (
    <SectionContext.Provider value={{ activeSection, setActiveSection }}>
      {children}
    </SectionContext.Provider>
  )
}

export function useSection() {
  const ctx = useContext(SectionContext)
  if (!ctx) throw new Error('useSection must be used within a SectionProvider')
  return ctx
}
