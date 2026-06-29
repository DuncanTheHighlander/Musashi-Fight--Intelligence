import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Orbitron } from 'next/font/google'
import Script from 'next/script'
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
  applicationName: 'Musashi',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, title: 'Musashi' },
  icons: {
    icon: [
      { url: '/musashi-icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/musashi-icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/musashi-icon-192.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#8b7355' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1816' },
  ],
}

const gtmId = process.env.NEXT_PUBLIC_GTM_ID?.trim()

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      {gtmId ? (
        <Script id="google-tag-manager" strategy="afterInteractive">
          {`
            (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
            new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
            j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
            'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
            })(window,document,'script','dataLayer','${gtmId}');
          `}
        </Script>
      ) : null}
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${orbitron.variable} min-h-screen bg-background text-foreground antialiased`}
        suppressHydrationWarning
      >
        {gtmId ? (
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${gtmId}`}
              height="0"
              width="0"
              style={{ display: 'none', visibility: 'hidden' }}
            />
          </noscript>
        ) : null}
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
