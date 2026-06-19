'use client'

import React, { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { useAuth } from '@/hooks/useAuth'
import { User, Mail, Shield, Calendar, Activity } from 'lucide-react'
import { useSection } from '@/contexts/SectionContext'
import { SectionShell } from '@/components/ui/section-header'

export default function ProfileSection() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const { setActiveSection } = useSection()

  useEffect(() => {
    if (!loading && !user) router.push('/login')
  }, [loading, router, user])

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="h-[600px] flex items-center justify-center">
          <div className="animate-pulse text-muted-foreground">Loading profile...</div>
        </div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  const initials = user.display_name
    ? user.display_name.substring(0, 2).toUpperCase()
    : user.email.substring(0, 2).toUpperCase()

  return (
    <SectionShell maxWidth="6xl">
      <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
        <Avatar className="h-20 w-20 ring-2 ring-primary/20">
          <AvatarFallback className="bg-primary/20 text-primary text-2xl font-semibold">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="mb-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground/80">Your Account</div>
          <h1 className="text-3xl font-bold tracking-tight truncate">{user.display_name}</h1>
          <p className="text-sm text-muted-foreground truncate">{user.email}</p>
        </div>
      </header>

      <div className="grid lg:grid-cols-2 gap-5 mb-5">
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <User className="h-5 w-5" />
              Account Information
            </CardTitle>
            <CardDescription>Your account details and status</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Email</span>
              </div>
              <span className="font-medium">{user.email}</span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Role</span>
              </div>
              <Badge variant={user.role === 'shogun' ? 'default' : 'secondary'}>
                {user.role || 'user'}
              </Badge>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Display Name</span>
              </div>
              <span className="font-medium">{user.display_name}</span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Status</span>
              </div>
              <Badge variant="secondary" className="border-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                Active
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Activity className="h-5 w-5" />
              Activity
            </CardTitle>
            <CardDescription>Your platform activity and stats</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {[
              { label: 'Videos Analyzed', value: 0 },
              { label: 'AI Conversations', value: 0 },
              { label: 'Techniques Saved', value: 0 },
              { label: 'Training Sessions', value: 0 },
            ].map((row, i, arr) => (
              <div
                key={row.label}
                className={`flex items-center justify-between py-3 ${i < arr.length - 1 ? 'border-b border-border/40' : ''}`}
              >
                <span className="text-sm text-muted-foreground">{row.label}</span>
                <span className={`text-2xl font-bold tabular-nums ${row.value === 0 ? 'text-muted-foreground/60' : ''}`}>
                  {row.value === 0 ? '—' : row.value}
                </span>
              </div>
            ))}
            <p className="pt-3 text-xs text-muted-foreground/80">
              Activity totals update after your first analysis, conversation, or saved technique.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-lg">Quick Actions</CardTitle>
          <CardDescription>Manage your account and preferences</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Button variant="outline" className="justify-start h-10" onClick={() => setActiveSection('coach')}>
              Start Analysis
            </Button>
            <Button variant="outline" className="justify-start h-10" onClick={() => setActiveSection('library')}>
              View Library
            </Button>
            <Button variant="outline" className="justify-start h-10" disabled>
              Account Settings (Coming Soon)
            </Button>
          </div>
        </CardContent>
      </Card>
    </SectionShell>
  )
}
