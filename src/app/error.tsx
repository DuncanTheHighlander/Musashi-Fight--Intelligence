'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AlertCircle } from 'lucide-react'

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Root segment error:', error)
  }, [error])

  return (
    <html>
      <body>
        <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 bg-background text-foreground">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-muted-foreground text-center max-w-md">
            The page failed to load. Try again, or return to the home page.
          </p>
          <div className="flex gap-2">
            <Button onClick={reset}>Try again</Button>
            <Button variant="outline" onClick={() => (window.location.href = '/')}>
              Go home
            </Button>
          </div>
        </main>
      </body>
    </html>
  )
}
