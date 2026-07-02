'use client'

import { AuthProvider } from '@/contexts/AuthContext'
import { SectionProvider } from '@/contexts/SectionContext'
import { PageErrorBoundary } from '@/components/PageErrorBoundary'
import { MobileAppFrame } from '@/components/mobile/MobileAppFrame'

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthProvider>
      <SectionProvider>
        <MobileAppFrame>
          <PageErrorBoundary>
            {children}
          </PageErrorBoundary>
        </MobileAppFrame>
      </SectionProvider>
    </AuthProvider>
  )
}
