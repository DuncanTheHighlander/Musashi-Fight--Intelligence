'use client'

import React, { useState } from 'react'
import { Clapperboard, Search, Loader2, AlertCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SectionShell, SectionHeader } from '@/components/ui/section-header'
import { parseApiResponse } from '@/lib/safeJson'

type ClipResult = {
  id: string
  techniqueId: string
  techniqueName: string
  discipline: string
  sourceType: 'youtube' | 'owned'
  startSec: number
  endSec: number
  label: string
  confidence: number | null
  verified: boolean
  difficulty: string | null
  playbackUrl: string | null
}

const DISCIPLINES = [
  { value: 'bjj', label: 'BJJ' },
  { value: 'wrestling', label: 'Wrestling' },
  { value: 'judo', label: 'Judo' },
  { value: 'boxing', label: 'Boxing' },
  { value: 'kickboxing', label: 'Kickboxing' },
  { value: 'mma', label: 'MMA' },
]

export default function ClipLibrarySection() {
  const [discipline, setDiscipline] = useState('bjj')
  const [query, setQuery] = useState('')
  const [clips, setClips] = useState<ClipResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const handleSearch = async () => {
    setSearching(true)
    setLoadError(null)
    try {
      const params = new URLSearchParams({ discipline })
      if (query.trim()) params.set('q', query.trim())

      const res = await fetch(`/api/library/taxonomy/clips/search?${params.toString()}`)
      const data = (await parseApiResponse(res)) as Record<string, any>
      if (!res.ok) throw new Error(data?.error || 'Search failed')

      setClips(data.clips || [])
      setSearched(true)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Clip search failed.')
    } finally {
      setSearching(false)
    }
  }

  return (
    <SectionShell maxWidth="6xl">
      <SectionHeader
        icon={Clapperboard}
        iconAccent="blue"
        eyebrow="Musashi AI Combat Systems"
        title="Clip Library"
        subtitle="AI-tagged technique clips across disciplines, searchable by natural language."
      />
      <Card className="border-border/50 bg-card/40 mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clapperboard className="h-5 w-5" />
            Technique Clip Search
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Select value={discipline} onValueChange={setDiscipline}>
              <SelectTrigger className="h-10 w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DISCIPLINES.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder='e.g. "K-guard entries that are not from closed guard"'
              value={query}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && handleSearch()}
              className="h-10 flex-1 min-w-[240px]"
            />
            <Button onClick={handleSearch} disabled={searching} className="h-10">
              {searching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
              Search
            </Button>
          </div>

          {loadError && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{loadError}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {searched && clips.length === 0 && !loadError && (
        <p className="text-center text-sm text-muted-foreground py-12">
          No clips tagged for this discipline/query yet.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {clips.map((clip) => (
          <Card key={clip.id} className="border-border/50 bg-card/40 overflow-hidden">
            <div className="aspect-video bg-black/40">
              {clip.sourceType === 'youtube' && clip.playbackUrl ? (
                <iframe
                  src={clip.playbackUrl}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  title={clip.label}
                />
              ) : clip.sourceType === 'owned' && clip.playbackUrl ? (
                <video src={clip.playbackUrl} controls className="h-full w-full" />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  Preview unavailable
                </div>
              )}
            </div>
            <CardContent className="p-4">
              <p className="text-sm font-medium leading-snug">{clip.label}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="text-[10.5px]">{clip.techniqueName}</Badge>
                {clip.difficulty && (
                  <Badge variant="secondary" className="text-[10.5px]">{clip.difficulty}</Badge>
                )}
                {clip.confidence != null && (
                  <Badge variant="outline" className="text-[10.5px]">
                    {(clip.confidence * 100).toFixed(0)}% confidence
                  </Badge>
                )}
                {clip.verified && (
                  <Badge className="text-[10.5px]">verified</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </SectionShell>
  )
}
