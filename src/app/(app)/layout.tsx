'use client'

import Navigation from '@/components/layout/Navigation'
import { ProfileCompletionBanner } from '@/components/layout/ProfileCompletionBanner'
import { AuthProvider } from '@/contexts/AuthContext'
import { SectionProvider } from '@/contexts/SectionContext'
import { PageErrorBoundary } from '@/components/PageErrorBoundary'

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthProvider>
      <SectionProvider>
        <div className="min-h-screen flex flex-col bg-background">
          <Navigation />
          <ProfileCompletionBanner />
          <main className="flex-1 bg-background">
            <PageErrorBoundary>
              {children}
            </PageErrorBoundary>
          </main>
        </div>
      </SectionProvider>
    </AuthProvider>
  )
}
