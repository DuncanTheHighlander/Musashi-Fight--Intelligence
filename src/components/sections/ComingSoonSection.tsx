'use client'

import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Sparkles } from 'lucide-react'

interface ComingSoonSectionProps {
  title: string
  icon: LucideIcon
  description: string
  details?: string
}

export function ComingSoonSection({
  title,
  icon: Icon,
  description,
  details,
}: ComingSoonSectionProps) {
  return (
    <div className="container mx-auto p-4 lg:p-6">
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
        <CardContent className="flex flex-col items-center gap-4 p-12 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/20">
            <Icon className="h-8 w-8" />
          </div>
          <div className="space-y-2">
            <Badge variant="secondary" className="border-0 bg-primary/15 text-primary">
              <Sparkles className="mr-1 h-3 w-3" />
              Preview
            </Badge>
            <h2 className="text-2xl font-semibold">{title}</h2>
            <p className="max-w-md text-muted-foreground">{description}</p>
            {details && (
              <p className="max-w-md text-sm text-muted-foreground/80">{details}</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
