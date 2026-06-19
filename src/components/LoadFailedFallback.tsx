'use client'

import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

export function LoadFailedFallback() {
  return (
    <div className="container mx-auto p-6">
      <div className="flex flex-col items-center justify-center gap-4 min-h-[400px] text-center">
        <AlertTriangle className="h-12 w-12 text-destructive" />
        <h2 className="text-xl font-semibold">Failed to load</h2>
        <p className="text-muted-foreground max-w-md">
          The app could not load. This may be due to a slow connection or blocked resources (e.g. CDN for pose detection).
        </p>
        <Button onClick={() => window.location.reload()}>Reload page</Button>
      </div>
    </div>
  )
}
