import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Orbitron } from 'next/font/google'
import { Toaster } from '@/components/ui/toaster'
import { ThemeProvider } from '@/components/providers/ThemeProvider'
import { RootErrorBoundary } from '@/components/RootErrorBoundary'
import { ChunkLoadRecovery } from '@/components/ChunkLoadRecovery'
import { DebugCapture } from '@/components/DebugCapture'
import { MediaPipeLogFilter } from '@/components/MediaPipeLogFilter'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin']
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin']
})

const orbitron = Orbitron({
  variable: '--font-orbitron',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900']
})

export const metadata: Metadata = {
  title: 'Musashi - AI Combat Coach & Social Platform',
  description: 'AI-powered fight analysis, coaching, and combat sports community',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, title: 'Musashi' },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#8b7355' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1816' },
  ],
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${orbitron.variable} min-h-screen bg-background text-foreground antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider>
          <MediaPipeLogFilter />
          <ChunkLoadRecovery />
          <DebugCapture />
          <RootErrorBoundary>
            {children}
            <Toaster />
          </RootErrorBoundary>
        </ThemeProvider>
      </body>
    </html>
  )
}
