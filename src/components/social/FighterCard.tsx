'use client'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Check } from 'lucide-react'

interface FighterCardProps {
  profile: {
    id: string
    display_name: string
    fighting_style?: string
    weight_class?: string
    win_record?: number
    loss_record?: number
    draw_record?: number
    bio?: string
    verified: boolean
  }
}

export function FighterCard({ profile }: FighterCardProps) {
  const initial = profile.display_name.charAt(0).toUpperCase()
  const record = `${profile.win_record || 0}-${profile.loss_record || 0}-${profile.draw_record || 0}`

  const hasRecord =
    (profile.win_record || 0) + (profile.loss_record || 0) + (profile.draw_record || 0) > 0

  return (
    <Card className="group flex flex-col border-border/60 bg-card/60 backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5">
      <CardContent className="flex-1 p-5">
        <div className="mb-4 flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xl font-bold text-primary ring-1 ring-primary/20">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <h3 className="truncate text-base font-semibold text-foreground">
                {profile.display_name}
              </h3>
              {profile.verified && (
                <Badge className="border-primary/30 bg-primary/15 text-primary text-[10.5px] px-1.5 py-0">
                  <Check className="mr-1 h-3 w-3" />
                  Verified
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              {profile.fighting_style && <span>{profile.fighting_style}</span>}
              {profile.fighting_style && profile.weight_class && <span>•</span>}
              {profile.weight_class && <span>{profile.weight_class}</span>}
            </div>
          </div>
        </div>

        <div className="mb-3">
          {hasRecord ? (
            <Badge variant="outline" className="border-primary/30 text-primary">
              Record: {record}
            </Badge>
          ) : (
            <Badge variant="outline" className="border-border/40 text-muted-foreground">
              No recorded fights yet
            </Badge>
          )}
        </div>

        {profile.bio ? (
          <p className="line-clamp-3 text-sm text-muted-foreground">{profile.bio}</p>
        ) : (
          <p className="text-xs italic text-muted-foreground/70">No bio yet.</p>
        )}
      </CardContent>
    </Card>
  )
}
