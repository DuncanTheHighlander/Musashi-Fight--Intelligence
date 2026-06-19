import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Compass } from 'lucide-react'

export default function NotFound() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-4 overflow-hidden bg-background p-6 text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/5" />
      <div className="pointer-events-none absolute inset-0 bg-[url('/grid.svg')] opacity-[0.05]" />

      <div className="relative flex flex-col items-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/20">
          <Compass className="h-8 w-8" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="max-w-md text-muted-foreground">
          We couldn&apos;t find what you&apos;re looking for. It may have moved or been removed.
        </p>
        <Button className="h-10 px-6" asChild>
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </main>
  )
}
