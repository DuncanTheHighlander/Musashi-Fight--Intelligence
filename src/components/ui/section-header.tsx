'use client'

import React from 'react'
import { cn } from '@/lib/utils'
import { type LucideIcon } from 'lucide-react'

export interface SectionHeaderProps {
  icon: LucideIcon
  title: React.ReactNode
  subtitle?: React.ReactNode
  eyebrow?: React.ReactNode
  iconAccent?: 'primary' | 'gold' | 'blue' | 'green' | 'purple'
  action?: React.ReactNode
  className?: string
}

const iconAccentClasses: Record<NonNullable<SectionHeaderProps['iconAccent']>, string> = {
  primary: 'bg-primary/15 text-primary ring-primary/20',
  gold: 'bg-yellow-500/15 text-yellow-400 ring-yellow-500/20',
  blue: 'bg-blue-500/15 text-blue-400 ring-blue-500/20',
  green: 'bg-green-500/15 text-green-400 ring-green-500/20',
  purple: 'bg-purple-500/15 text-purple-400 ring-purple-500/20',
}

const stripeAccentClasses: Record<NonNullable<SectionHeaderProps['iconAccent']>, string> = {
  primary: 'bg-gradient-to-b from-primary/80 to-primary/20',
  gold: 'bg-gradient-to-b from-yellow-400/80 to-yellow-400/20',
  blue: 'bg-gradient-to-b from-blue-400/80 to-blue-400/20',
  green: 'bg-gradient-to-b from-green-400/80 to-green-400/20',
  purple: 'bg-gradient-to-b from-purple-400/80 to-purple-400/20',
}

export function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  eyebrow,
  iconAccent = 'primary',
  action,
  className,
}: SectionHeaderProps) {
  return (
    <header className={cn('relative flex items-start gap-4 mb-8', className)}>
      <span
        aria-hidden="true"
        className={cn('hidden sm:block w-1 self-stretch rounded-full', stripeAccentClasses[iconAccent])}
      />
      <div
        className={cn(
          'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ring-1',
          iconAccentClasses[iconAccent]
        )}
      >
        <Icon className="h-6 w-6" />
      </div>
      <div className="flex-1 min-w-0">
        {eyebrow ? (
          <div className="mb-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground/80">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="text-3xl font-bold tracking-tight leading-tight">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </header>
  )
}

export function SectionShell({
  children,
  className,
  maxWidth = '7xl',
}: {
  children: React.ReactNode
  className?: string
  maxWidth?: '5xl' | '6xl' | '7xl' | 'full'
}) {
  const widthClass = maxWidth === 'full' ? 'max-w-full' : `max-w-${maxWidth}`
  return (
    <div className="min-h-[calc(100vh-4rem)]">
      <div className={cn('container mx-auto px-4 py-8 lg:px-6 lg:py-10', widthClass, className)}>
        {children}
      </div>
    </div>
  )
}

export function EmptySectionState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 bg-card/30 px-6 py-16 text-center',
        className
      )}
    >
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/40 text-muted-foreground">
        <Icon className="h-7 w-7" />
      </div>
      <h3 className="mb-1 text-lg font-semibold">{title}</h3>
      {description ? (
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}
