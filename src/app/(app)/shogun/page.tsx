'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { PromptPreviewModal } from '@/components/ui/prompt-preview-modal'
import { Eye, AlertCircle, CheckCircle } from 'lucide-react'
import { parseApiResponse } from '@/lib/safeJson'

type MeResponse = {
  user: null | { id: string; email: string; role: string }
}

type LimitsRow = {
  id: string
  email: string
  role: string
  daily_analyze_limit: number | null
  daily_chat_limit: number | null
  daily_reflex_limit: number | null
  daily_track_limit: number | null
  per_minute_limit: number | null
  updated_at: string | null
}

type PromptsBundle = {
  template: null | { id: string; key: string; name: string; description: string | null }
  active: null | { id: string; templateId: string; version: number; content: string; createdByUserId: string | null; createdAt: string }
  versions: Array<{ id: string; templateId: string; version: number; content: string; createdByUserId: string | null; createdAt: string }>
  auditLogs?: Array<{
    id: string
    action: string
    user_id: string | null
    user_email: string | null
    metadata: string | null
    created_at: string
    version_id: string
  }>
}

const toNumberOrNull = (v: string): number | null => {
  const s = v.trim()
  if (!s) return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return n
}

type PromptKey = 'fight_chat_system' | 'fight_preset_gameplan' | 'fight_preset_counters' | 'fight_preset_corner'

const promptKeyOptions: Array<{ key: PromptKey; label: string }> = [
  { key: 'fight_chat_system', label: 'Fight Chat System' },
  { key: 'fight_preset_gameplan', label: 'Preset: Gameplan' },
  { key: 'fight_preset_counters', label: 'Preset: Counters' },
  { key: 'fight_preset_corner', label: 'Preset: Corner talk' },
]

const defaultsForPromptKey = (key: PromptKey): { name: string; description: string; content: string } => {
  if (key === 'fight_preset_gameplan') {
    return {
      name: 'Fight Preset: Gameplan',
      description: 'Template used by the Gameplan preset button. Supports {{context}} and {{pov}} placeholders.',
      content:
        '{{context}}\n' +
        '{{pov}}\n' +
        'Give me a Round 1 gameplan for THIS ruleset and styles. Include:\n' +
        '- Range + tempo control\n' +
        '- 1 primary win condition\n' +
        '- 2 setups to enter safely\n' +
        '- 2 exits/resets to stay safe\n' +
        '- 2 “if they adjust…” branches\n' +
        '- 1 drill to install it\n' +
        'Be specific: name the triggers (lead hand battle, stance matchup, angle, timing window).',
    }
  }

  if (key === 'fight_preset_counters') {
    return {
      name: 'Fight Preset: Counters',
      description: 'Template used by the Counters preset button. Supports {{context}} and {{pov}} placeholders.',
      content:
        '{{context}}\n' +
        '{{pov}}\n' +
        'Read the opponent: what are they trying to make me do (trap)?\n' +
        'Give a simple IF→THEN decision tree (3 branches) and 2 high-percentage punish sequences that match the ruleset and their style archetype.\n' +
        'Include one counter that punishes footwork/angle, not just the hands.',
    }
  }

  if (key === 'fight_preset_corner') {
    return {
      name: 'Fight Preset: Corner talk',
      description: 'Template used by the Corner talk preset button. Supports {{context}} and {{pov}} placeholders.',
      content:
        '{{context}}\n' +
        '{{pov}}\n' +
        'Corner talk between rounds: give me 3 priorities (10 seconds), 1 tactical adjustment, and 1 mental cue.\n' +
        'Make it realistic for this ruleset and style matchup. No fluff.',
    }
  }

  return {
    name: 'Fight Chat System',
    description: 'System prompt for /api/fight/chat',
    content:
      'You are Musashi Fight Coach: elite corner, analyst, and strategist.\n' +
      'Be high-signal and practical. No fluff, no disclaimers, no generic motivation.\n' +
      'Always blend tactics + strategy in the SAME answer (do not treat "strategy" as separate).\n' +
      'When possible, structure responses as:\n' +
      '1) Immediate fixes (1-3 short cues)\n' +
      '2) Plan (range + tempo + primary win condition)\n' +
      '3) Counters/setups (2-4 concrete options)\n' +
      '4) Drill (one drill to install it)\n' +
      'If context includes an analysis with fighter candidates, reference Fighter A/B and the selected fighter.\n',
  }
}

export default function ShogunPage() {
  const [me, setMe] = useState<MeResponse['user']>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [users, setUsers] = useState<LimitsRow[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string>('')

  const [dailyAnalyze, setDailyAnalyze] = useState('')
  const [dailyChat, setDailyChat] = useState('')
  const [dailyReflex, setDailyReflex] = useState('')
  const [dailyTrack, setDailyTrack] = useState('')
  const [perMinute, setPerMinute] = useState('')

  const [selectedPromptKey, setSelectedPromptKey] = useState<PromptKey>('fight_chat_system')
  const [promptBundle, setPromptBundle] = useState<PromptsBundle | null>(null)
  const [promptName, setPromptName] = useState('Fight Chat System')
  const [promptDescription, setPromptDescription] = useState('System prompt for /api/fight/chat')
  const [promptContent, setPromptContent] = useState(
    'You are Musashi Fight Coach: elite corner, analyst, and strategist.\n' +
      'Be high-signal and practical. No fluff, no disclaimers, no generic motivation.\n' +
      'Always blend tactics + strategy in the SAME answer (do not treat "strategy" as separate).\n' +
      'When possible, structure responses as:\n' +
      '1) Immediate fixes (1-3 short cues)\n' +
      '2) Plan (range + tempo + primary win condition)\n' +
      '3) Counters/setups (2-4 concrete options)\n' +
      '4) Drill (one drill to install it)\n' +
      'If context includes an analysis with fighter candidates, reference Fighter A/B and the selected fighter.\n'
  )
  const [promptReason, setPromptReason] = useState('')
  const [validationResult, setValidationResult] = useState<{ valid: boolean; errors: string[] } | null>(null)
  const [validationLoading, setValidationLoading] = useState(false)

  const selectedUser = useMemo(() => users.find((u) => u.id === selectedUserId) || null, [users, selectedUserId])

  const loadMe = useCallback(async () => {
    const res = await fetch('/api/auth/me', { method: 'GET' })
    if (!res.ok) {
      setMe(null)
      return
    }
    const data: any = await parseApiResponse(res)
    setMe(data?.user || null)
  }, [])

  const loadUsers = useCallback(async () => {
    const res = await fetch('/api/shogun/limits', { method: 'GET' })
    if (res.status === 401) {
      window.location.href = '/login'
      return
    }
    if (res.status === 403) {
      window.location.href = '/'
      return
    }
    const data: any = await parseApiResponse(res)
    const list: LimitsRow[] = Array.isArray(data?.users) ? data.users : []
    setUsers(list)
    if (!selectedUserId && list.length > 0) {
      setSelectedUserId(String(list[0].id))
    }
  }, [selectedUserId])

  const loadPrompt = useCallback(async (key: PromptKey) => {
    const defaults = defaultsForPromptKey(key)
    setPromptName(defaults.name)
    setPromptDescription(defaults.description)
    setPromptContent(defaults.content)
    setPromptReason('')
    setValidationResult(null)

    const res = await fetch(`/api/shogun/prompts?key=${encodeURIComponent(key)}&audit=1`, { method: 'GET' })
    if (res.status === 401) {
      window.location.href = '/login'
      return
    }
    if (res.status === 403) {
      window.location.href = '/'
      return
    }
    const data: any = await parseApiResponse(res)
    setPromptBundle(data as PromptsBundle)

    const activeContent = data?.active?.content
    if (typeof activeContent === 'string' && activeContent.trim()) {
      setPromptContent(activeContent)
    }

    const tName = data?.template?.name
    if (typeof tName === 'string' && tName.trim()) setPromptName(tName)

    const tDesc = data?.template?.description
    if (typeof tDesc === 'string') setPromptDescription(tDesc)
  }, [])

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        await loadMe()
        await loadUsers()
        await loadPrompt(selectedPromptKey)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    }
    void run()
  }, [loadMe, loadPrompt, loadUsers, selectedPromptKey])

  useEffect(() => {
    if (!selectedUser) return

    setDailyAnalyze(selectedUser.daily_analyze_limit == null ? '' : String(selectedUser.daily_analyze_limit))
    setDailyChat(selectedUser.daily_chat_limit == null ? '' : String(selectedUser.daily_chat_limit))
    setDailyReflex(selectedUser.daily_reflex_limit == null ? '' : String(selectedUser.daily_reflex_limit))
    setDailyTrack(selectedUser.daily_track_limit == null ? '' : String(selectedUser.daily_track_limit))
    setPerMinute(selectedUser.per_minute_limit == null ? '' : String(selectedUser.per_minute_limit))
  }, [selectedUser])

  const onSaveLimits = async () => {
    if (!selectedUserId) return
    setError(null)
    try {
      const res = await fetch('/api/shogun/limits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedUserId,
          dailyAnalyze: toNumberOrNull(dailyAnalyze),
          dailyChat: toNumberOrNull(dailyChat),
          dailyReflex: toNumberOrNull(dailyReflex),
          dailyTrack: toNumberOrNull(dailyTrack),
          perMinute: toNumberOrNull(perMinute),
        }),
      })

      const data: any = await parseApiResponse(res)
      if (!res.ok) throw new Error(data?.error || 'Failed to save')
      await loadUsers()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    }
  }

  const validatePrompt = async () => {
    setValidationLoading(true)
    setValidationResult(null)
    try {
      const res = await fetch('/api/shogun/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'validate', key: selectedPromptKey, content: promptContent }),
      })
      const data: any = await parseApiResponse(res)
      if (!res.ok) throw new Error(data?.error || 'Validation failed')
      setValidationResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Validation failed')
    } finally {
      setValidationLoading(false)
    }
  }

  const onSavePrompt = async () => {
    setError(null)
    try {
      const res = await fetch('/api/shogun/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: selectedPromptKey,
          name: promptName,
          description: promptDescription,
          content: promptContent,
          reason: promptReason,
        }),
      })

      const data: any = await parseApiResponse(res)
      if (!res.ok) throw new Error(data?.error || 'Failed to save prompt')
      await loadPrompt(selectedPromptKey)
      setPromptReason('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save prompt')
    }
  }

  const onActivateVersion = async (versionId: string) => {
    const reason = window.prompt('Reason for activating this version? (optional)')
    setError(null)
    try {
      const res = await fetch('/api/shogun/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'activate', key: selectedPromptKey, versionId, reason }),
      })

      const data: any = await parseApiResponse(res)
      if (!res.ok) throw new Error(data?.error || 'Failed to activate')
      await loadPrompt(selectedPromptKey)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to activate')
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <div className="container mx-auto max-w-5xl px-4 py-10">
          <div className="text-sm text-muted-foreground">Loading…</div>
        </div>
      </main>
    )
  }

  if (!me) {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <div className="container mx-auto max-w-5xl px-4 py-10">
          <Card>
            <CardHeader>
              <CardTitle>Shogun</CardTitle>
              <CardDescription>Login required.</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button asChild>
                <Link href="/login">Login</Link>
              </Button>
            </CardFooter>
          </Card>
        </div>
      </main>
    )
  }

  if (me.role !== 'shogun') {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <div className="container mx-auto max-w-5xl px-4 py-10">
          <Card>
            <CardHeader>
              <CardTitle>Forbidden</CardTitle>
              <CardDescription>You need Shogun access.</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button asChild variant="outline">
                <Link href="/">Back to Fight Lab</Link>
              </Button>
            </CardFooter>
          </Card>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto max-w-5xl px-4 py-10">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Shogun</h1>
            <div className="mt-1 text-sm text-muted-foreground">Admin controls for Musashi.</div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/">Fight Lab</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/pricing">Pricing</Link>
            </Button>
          </div>
        </div>

        {error && <div className="mb-4 text-sm text-destructive">{error}</div>}

        <Tabs defaultValue="limits">
          <TabsList>
            <TabsTrigger value="limits">Limits</TabsTrigger>
            <TabsTrigger value="prompts">Prompts</TabsTrigger>
          </TabsList>

          <TabsContent value="limits">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Users</CardTitle>
                  <CardDescription>Click a user to edit their limits.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((u) => (
                        <TableRow
                          key={u.id}
                          className={u.id === selectedUserId ? 'bg-muted/50' : ''}
                          onClick={() => setSelectedUserId(u.id)}
                        >
                          <TableCell className="cursor-pointer">{u.email}</TableCell>
                          <TableCell className="cursor-pointer">{u.role}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Limits</CardTitle>
                  <CardDescription>Leave blank to use defaults.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <Label>User</Label>
                    <div className="text-sm text-muted-foreground">{selectedUser ? selectedUser.email : 'None'}</div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="dailyAnalyze">Daily analyze</Label>
                      <Input id="dailyAnalyze" value={dailyAnalyze} onChange={(e) => setDailyAnalyze(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="perMinute">Per minute</Label>
                      <Input id="perMinute" value={perMinute} onChange={(e) => setPerMinute(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="dailyChat">Daily chat</Label>
                      <Input id="dailyChat" value={dailyChat} onChange={(e) => setDailyChat(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="dailyReflex">Daily reflex</Label>
                      <Input id="dailyReflex" value={dailyReflex} onChange={(e) => setDailyReflex(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="dailyTrack">Daily track</Label>
                      <Input id="dailyTrack" value={dailyTrack} onChange={(e) => setDailyTrack(e.target.value)} />
                    </div>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button disabled={!selectedUserId} onClick={onSaveLimits}>
                    Save limits
                  </Button>
                </CardFooter>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="prompts">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Edit active prompt</CardTitle>
                  <CardDescription>Creates a new version and activates it.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="pkey">Prompt</Label>
                    <select
                      id="pkey"
                      value={selectedPromptKey}
                      onChange={(e) => {
                        const key = String(e.target.value) as PromptKey
                        setSelectedPromptKey(key)
                        void loadPrompt(key)
                      }}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                    >
                      {promptKeyOptions.map((opt) => (
                        <option key={opt.key} value={opt.key}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="pname">Name</Label>
                    <Input id="pname" value={promptName} onChange={(e) => setPromptName(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="pdesc">Description</Label>
                    <Input id="pdesc" value={promptDescription} onChange={(e) => setPromptDescription(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="pcontent">Content</Label>
                    <Textarea
                      id="pcontent"
                      value={promptContent}
                      onChange={(e) => setPromptContent(e.target.value)}
                      className="min-h-[340px]"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="preason">Reason (optional)</Label>
                    <Input id="preason" value={promptReason} onChange={(e) => setPromptReason(e.target.value)} placeholder="Why are you changing this prompt?" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={validatePrompt} disabled={validationLoading}>
                      {validationLoading ? 'Validating...' : 'Validate'}
                    </Button>
                    <PromptPreviewModal templateKey={selectedPromptKey} content={promptContent}>
                      <Button variant="outline" size="sm">
                        <Eye className="w-4 h-4 mr-2" />
                        Preview
                      </Button>
                    </PromptPreviewModal>
                  </div>
                  {validationResult && (
                    <div className={`text-sm p-2 rounded ${validationResult.valid ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'}`}>
                      {validationResult.valid ? (
                        <div className="flex items-center gap-2">
                          <CheckCircle className="w-4 h-4" />
                          <span>Valid</span>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <AlertCircle className="w-4 h-4" />
                            <span>Validation errors:</span>
                          </div>
                          <ul className="list-disc list-inside ml-6">
                            {validationResult.errors.map((err, i) => (
                              <li key={i}>{err}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
                <CardFooter>
                  <Button onClick={onSavePrompt}>Save new version</Button>
                </CardFooter>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Versions</CardTitle>
                  <CardDescription>Activate any previous version.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Version</TableHead>
                        <TableHead>Active</TableHead>
                        <TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(promptBundle?.versions || []).map((v) => {
                        const isActive = Boolean(promptBundle?.active?.id && promptBundle.active.id === v.id)
                        return (
                          <TableRow key={v.id}>
                            <TableCell>v{v.version}</TableCell>
                            <TableCell>{isActive ? 'yes' : ''}</TableCell>
                            <TableCell>
                              <Button
                                size="sm"
                                variant={isActive ? 'secondary' : 'outline'}
                                disabled={isActive}
                                onClick={() => onActivateVersion(v.id)}
                              >
                                Activate
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {(promptBundle?.auditLogs && promptBundle.auditLogs.length > 0) && (
                <Card>
                  <CardHeader>
                    <CardTitle>Audit Log</CardTitle>
                    <CardDescription>Recent changes to this prompt.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Action</TableHead>
                          <TableHead>User</TableHead>
                          <TableHead>Metadata</TableHead>
                          <TableHead>Time</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {promptBundle.auditLogs.map((log) => (
                          <TableRow key={log.id}>
                            <TableCell>
                              <Badge variant={log.action === 'created' ? 'default' : log.action === 'activated' ? 'secondary' : 'outline'}>
                                {log.action}
                              </Badge>
                            </TableCell>
                            <TableCell>{log.user_email || log.user_id || 'system'}</TableCell>
                            <TableCell className="max-w-xs truncate text-xs">
                              {log.metadata ? JSON.stringify(JSON.parse(log.metadata), null, 1) : ''}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {new Date(log.created_at).toLocaleString()}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  )
}
