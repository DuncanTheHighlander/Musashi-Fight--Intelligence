'use client'

import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { BeltBadge, type BeltTier } from './BeltBadge'
import { JobStatusBadge, type JobStatus } from './JobStatusBadge'
import { formatCents } from '@/lib/currency'
import { Clock, Video, Coins } from 'lucide-react'

export interface JobCardData {
  id: string
  title: string
  brief: string
  jobType: 'open_bounty' | 'direct_hire'
  requiredBeltTier: BeltTier
  amountCents: number
  currency: string
  status: JobStatus
  videos: string[]
  scoutingRequestId?: string | null
  claimDeadlineAt?: string | null
  deliveryDeadlineAt?: string | null
  createdAt: string
}

function relativeDeadline(iso?: string | null): string | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'expired'
  const hours = Math.round(ms / 3_600_000)
  if (hours < 24) return `${hours}h left`
  return `${Math.round(hours / 24)}d left`
}

export function JobCard({ job }: { job: JobCardData }) {
  const deadline = relativeDeadline(job.deliveryDeadlineAt || job.claimDeadlineAt)
  return (
    <Link href={`/marketplace/jobs/${job.id}`} className="block">
      <Card className="h-full transition-all hover:border-primary/60 hover:shadow-md">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base leading-snug line-clamp-2 flex-1">
              {job.title}
            </CardTitle>
            <JobStatusBadge status={job.status} />
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge variant="secondary" className="gap-1 text-xs">
              {job.scoutingRequestId
                ? 'Opponent scout'
                : job.jobType === 'direct_hire'
                  ? 'Direct hire'
                  : 'Clip review'}
            </Badge>
            <BeltBadge tier={job.requiredBeltTier} showLabel={false} className="text-[10px] py-0 px-2" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground line-clamp-2">
            {job.brief || 'No brief provided.'}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="flex items-center gap-1 font-semibold text-foreground">
              <Coins className="h-4 w-4 text-amber-500" />
              {formatCents(job.amountCents, job.currency)}
            </span>
            {job.videos.length > 0 && (
              <span className="flex items-center gap-1 text-muted-foreground text-xs">
                <Video className="h-3.5 w-3.5" />
                {job.videos.length} video{job.videos.length === 1 ? '' : 's'}
              </span>
            )}
            {deadline && (
              <span className="flex items-center gap-1 text-muted-foreground text-xs">
                <Clock className="h-3.5 w-3.5" />
                {deadline}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
