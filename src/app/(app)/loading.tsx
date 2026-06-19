import { Card, CardContent } from '@/components/ui/card'

export default function AppLoading() {
  return (
    <div className="container mx-auto p-6">
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
          <div
            className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin"
            aria-label="Loading"
          />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </CardContent>
      </Card>
    </div>
  )
}
