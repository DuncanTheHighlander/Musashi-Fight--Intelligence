'use client'

/**
 * MobileAppFrame — Phase 2 of the front-end reboot.
 *
 * Every (app) page renders inside the MobileShell from design/musashi-reboot:
 * crest top bar, --ms-* tokens, and the 5-tab bottom nav (Analyze / Market /
 * Library / Inbox / Profile). On wide screens the shell centers as a
 * phone-width column over the page gradient — the same presentation as the
 * design spec. The old desktop Navigation chrome is retired from this group.
 *
 * The screens themselves are still the existing ones — per the reboot plan
 * they get reskinned tab by tab, while the shell makes the app feel like the
 * reboot design immediately.
 */

import { ProfileCompletionBanner } from '@/components/layout/ProfileCompletionBanner'
import { MobileShell } from '@/components/mobile/MobileShell'
import { useAuth } from '@/contexts/AuthContext'

export function MobileAppFrame({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const source = (user?.display_name || user?.email || 'M').trim()
  const initials = source.slice(0, 2).toUpperCase()

  return (
    <MobileShell userInitials={initials} isAdmin={user?.role === 'shogun'}>
      <ProfileCompletionBanner />
      {children}
    </MobileShell>
  )
}
