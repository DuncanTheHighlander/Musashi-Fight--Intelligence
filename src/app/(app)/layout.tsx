'use client'

import { AuthProvider } from '@/contexts/AuthContext'
import { SectionProvider } from '@/contexts/SectionContext'
import { PageErrorBoundary } from '@/components/PageErrorBoundary'
import { MobileAppFrame } from '@/components/mobile/MobileAppFrame'
import { OnboardingGate } from '@/components/auth/OnboardingGate'

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthProvider>
      <SectionProvider>
        <OnboardingGate>
          <MobileAppFrame>
            <PageErrorBoundary>
              {children}
            </PageErrorBoundary>
          </MobileAppFrame>
        </OnboardingGate>
      </SectionProvider>
    </AuthProvider>
  )
}
