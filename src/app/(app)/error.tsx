'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AlertCircle } from 'lucide-react'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('App segment error:', error)
  }, [error])

  return (
    <div className="container mx-auto p-6">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-12 text-center">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <h2 className="text-xl font-semibold">This page hit a snag</h2>
          <p className="text-muted-foreground max-w-md">
            Something went wrong loading this section. You can retry or return home.
          </p>
          <div className="flex gap-2">
            <Button onClick={reset}>Try again</Button>
            <Button variant="outline" onClick={() => (window.location.href = '/')}>
              Go home
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
