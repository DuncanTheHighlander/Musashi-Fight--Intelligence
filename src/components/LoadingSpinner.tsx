'use client'

import { MusashiIcon } from '@/components/icons/MusashiIcon'

export function LoadingSpinner() {
  return (
    <div className="min-h-[60vh] w-full bg-background container mx-auto p-6">
      <div className="h-[600px] flex flex-col items-center justify-center gap-6">
        <div className="relative">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-20 h-20 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
          </div>
          <div className="relative flex items-center justify-center p-2">
            <MusashiIcon size={48} className="animate-pulse" />
          </div>
        </div>
        <div className="text-center space-y-1">
          <div className="text-muted-foreground text-sm font-medium">Loading Musashi</div>
          <div className="flex justify-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" />
          </div>
        </div>
      </div>
    </div>
  )
}
