'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type JobStatus =
  | 'CREATED'
  | 'FUNDED'
  | 'CLAIMED'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'RELEASED'
  | 'DISPUTED'
  | 'RESOLVED_REFUND'
  | 'RESOLVED_RELEASE'
  | 'RESOLVED_SPLIT'
  | 'CANCELLED'
  | 'EXPIRED'

const STATUS_STYLE: Record<JobStatus, { label: string; className: string }> = {
  CREATED:          { label: 'Draft',            className: 'bg-gray-500/10 text-gray-600 dark:text-gray-300 border-gray-500/30' },
  FUNDED:           { label: 'Open',             className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/30' },
  CLAIMED:          { label: 'Claimed',          className: 'bg-blue-500/10 text-blue-600 dark:text-blue-300 border-blue-500/30' },
  IN_PROGRESS:      { label: 'In Progress',      className: 'bg-blue-500/10 text-blue-600 dark:text-blue-300 border-blue-500/30' },
  SUBMITTED:        { label: 'Awaiting Review',  className: 'bg-amber-500/10 text-amber-600 dark:text-amber-300 border-amber-500/30' },
  APPROVED:         { label: 'Approved',         className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/30' },
  RELEASED:         { label: 'Paid',             className: 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 border-emerald-600/40' },
  DISPUTED:         { label: 'Disputed',         className: 'bg-red-500/10 text-red-600 dark:text-red-300 border-red-500/30' },
  RESOLVED_REFUND:  { label: 'Refunded',         className: 'bg-gray-500/15 text-gray-700 dark:text-gray-300 border-gray-500/40' },
  RESOLVED_RELEASE: { label: 'Resolved · Paid',  className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40' },
  RESOLVED_SPLIT:   { label: 'Resolved · Split', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40' },
  CANCELLED:        { label: 'Cancelled',        className: 'bg-gray-500/10 text-gray-500 dark:text-gray-400 border-gray-500/30' },
  EXPIRED:          { label: 'Expired',          className: 'bg-gray-500/10 text-gray-500 dark:text-gray-400 border-gray-500/30' },
}

export function JobStatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  const s = STATUS_STYLE[status] || { label: status, className: 'bg-gray-500/10 text-gray-600 dark:text-gray-300' }
  return (
    <Badge variant="outline" className={cn('font-medium border', s.className, className)}>
      {s.label}
    </Badge>
  )
}
