'use client'

import React, { useEffect, useState } from 'react'
import { Book, Plus, Search, FileText, Clock, CheckCircle, AlertCircle, Loader2, Trash2, Database, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { parseApiResponse } from '@/lib/safeJson'
import { SectionHeader, SectionShell, EmptySectionState } from '@/components/ui/section-header'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'

type LibraryDocument = {
  id: string
  title: string
  sourceType: string
  author: string | null
  tags: string[]
  status: 'pending' | 'processing' | 'ready' | 'error'
  chunkCount: number
  vectorCount: number
  createdAt: string
  updatedAt: string
}

type SearchResult = {
  id: string
  documentId: string
  content: string
  score: number
}

export default function LibrarySection() {
  const { user } = useAuth()
  const { toast } = useToast()
  const canDelete = user?.role === 'shogun'
  const [documents, setDocuments] = useState<LibraryDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [newDocTitle, setNewDocTitle] = useState('')
  const [newDocContent, setNewDocContent] = useState('')
  const [newDocTags, setNewDocTags] = useState('')
  const [adding, setAdding] = useState(false)
  const [stats, setStats] = useState<{
    documentCount: number
    chunkCount: number
    today: { library: number; chat: number; analyze: number }
  } | null>(null)

  useEffect(() => {
    loadDocuments()
    loadStats()
  }, [])

  const loadDocuments = async () => {
    try {
      const res = await fetch('/api/library')
      if (res.status === 401) {
        window.location.href = '/login'
        return
      }
      const data = await parseApiResponse(res) as Record<string, any>
      setDocuments(data.documents || [])
      setLoadError(null)
    } catch (e) {
      console.error('Failed to load documents:', e)
      setLoadError('Failed to load library documents.')
    } finally {
      setLoading(false)
    }
  }

  const loadStats = async () => {
    try {
      const res = await fetch('/api/library/stats')
      if (res.ok) {
        const data = await parseApiResponse(res) as Record<string, any>
        setStats(data.stats)
      }
    } catch (e) {
      console.error('Failed to load stats:', e)
      setLoadError((prev) => prev ?? 'Failed to load library stats.')
    }
  }

  const handleRetryLoad = () => {
    setLoadError(null)
    setLoading(true)
    loadDocuments()
    loadStats()
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    
    setSearching(true)
    try {
      const res = await fetch('/api/library/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery, topK: 10 }),
      })
      
      if (res.ok) {
        const data = await parseApiResponse(res) as Record<string, any>
        setSearchResults(data.results || [])
      }
    } catch (e) {
      console.error('Search failed:', e)
    } finally {
      setSearching(false)
    }
  }

  const handleAddDocument = async () => {
    if (!newDocTitle.trim() || !newDocContent.trim()) return
    
    setAdding(true)
    try {
      const res = await fetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newDocTitle,
          content: newDocContent,
          tags: newDocTags.split(',').map((t) => t.trim()).filter(Boolean),
        }),
      })
      
      if (res.ok) {
        const data = await parseApiResponse<{ pendingReview?: boolean; message?: string }>(res)
        setNewDocTitle('')
        setNewDocContent('')
        setNewDocTags('')
        setShowAddDialog(false)
        loadDocuments()
        toast({
          title: data.pendingReview ? 'Submitted for review' : 'Document published',
          description:
            data.message ||
            (data.pendingReview
              ? 'It will feed AI coaching once an admin approves it.'
              : 'Added to the knowledge base.'),
        })
      }
    } catch (e) {
      console.error('Failed to add document:', e)
    } finally {
      setAdding(false)
    }
  }

  const handleConfirmDelete = async () => {
    const id = deleteTargetId
    setDeleteTargetId(null)
    if (!id) return

    try {
      const res = await fetch(`/api/library?id=${id}`, { method: 'DELETE' })
      if (res.ok) {
        loadDocuments()
      }
    } catch (e) {
      console.error('Failed to delete:', e)
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'ready':
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'processing':
        return <Loader2 className="h-4 w-4 text-yellow-500 animate-spin" />
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />
    }
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      ready: 'default',
      processing: 'secondary',
      error: 'destructive',
      pending: 'outline',
    }
    return <Badge variant={variants[status] || 'outline'}>{status}</Badge>
  }

  const docCount = stats?.documentCount || documents.filter((d) => d.status === 'ready').length
  const chunkCount = stats?.chunkCount || 0
  const searchesToday = stats?.today?.library || 0
  const libraryEmpty = docCount === 0 && chunkCount === 0 && searchesToday === 0

  return (
    <SectionShell maxWidth="6xl">
      <SectionHeader
        icon={Book}
        iconAccent="purple"
        eyebrow="Musashi AI Combat Systems"
        title="Knowledge Library"
        subtitle="Curated fighting knowledge powering AI coaching with semantic search and retrieval."
      />

      {loadError && (
        <div
          role="alert"
          className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{loadError}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRetryLoad}
            className="h-8 shrink-0 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <RefreshCw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </Button>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3 mb-6">
        {[
          { icon: Database, label: 'Documents', value: docCount },
          { icon: FileText, label: 'Knowledge Chunks', value: chunkCount },
          { icon: Search, label: 'Searches Today', value: searchesToday },
        ].map((stat, i) => (
          <Card key={i} className="border-border/50 bg-card/40">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <stat.icon className="h-4 w-4" />
                {stat.label}
              </CardDescription>
              <CardTitle className={`text-3xl ${libraryEmpty ? 'text-muted-foreground/60' : ''}`}>
                {libraryEmpty ? '—' : stat.value}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card className="border-border/50 bg-card/40 mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Search className="h-5 w-5" />
            Semantic Search
          </CardTitle>
          <CardDescription>Search the knowledge base using natural language</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="e.g., How to counter a jab with footwork?"
              value={searchQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && handleSearch()}
              className="h-10 flex-1"
            />
            <Button onClick={handleSearch} disabled={searching} className="h-10">
              {searching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
              Search
            </Button>
          </div>

          {searchResults.length > 0 && (
            <div className="mt-4 space-y-3">
              <h4 className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Results</h4>
              {searchResults.map((result) => (
                <div
                  key={result.id}
                  className="rounded-lg border border-border/60 bg-background/30 p-3 text-sm"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <Badge variant="outline" className="text-[10.5px]">{(result.score * 100).toFixed(0)}% match</Badge>
                  </div>
                  <p className="text-muted-foreground line-clamp-3">{result.content}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/50 bg-card/40">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Book className="h-5 w-5" />
                  Documents
                </CardTitle>
                <CardDescription>Knowledge base documents indexed for AI retrieval</CardDescription>
              </div>
              <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Document
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[600px]">
                  <DialogHeader>
                    <DialogTitle>Add Knowledge Document</DialogTitle>
                    <DialogDescription>
                      Add fighting knowledge that will be chunked, embedded, and made searchable.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div>
                      <label className="text-sm font-medium">Title</label>
                      <Input
                        placeholder="e.g., Jab Defense Fundamentals"
                        value={newDocTitle}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewDocTitle(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Content</label>
                      <Textarea
                        placeholder="Paste or write the knowledge content here..."
                        value={newDocContent}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNewDocContent(e.target.value)}
                        className="mt-1 min-h-[200px]"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Tags (comma-separated)</label>
                      <Input
                        placeholder="e.g., boxing, defense, fundamentals"
                        value={newDocTags}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewDocTags(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleAddDocument} disabled={adding || !newDocTitle || !newDocContent}>
                      {adding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Add Document
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : documents.length === 0 ? (
            <EmptySectionState
              icon={Book}
              title="No documents yet"
              description="Add knowledge documents to power AI-assisted coaching. They'll be chunked, embedded, and made searchable."
              action={
                <Button onClick={() => setShowAddDialog(true)} className="h-10">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Document
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between rounded-lg border border-border/60 bg-background/30 p-4 transition-colors hover:border-border"
                >
                  <div className="flex items-center gap-3">
                    {getStatusIcon(doc.status)}
                    <div>
                      <h4 className="font-medium">{doc.title}</h4>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        {getStatusBadge(doc.status)}
                        <span>
                          {doc.chunkCount} chunks • {doc.vectorCount} vectors
                        </span>
                        {doc.tags.length > 0 && (
                          <span>• {doc.tags.slice(0, 3).join(', ')}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {canDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteTargetId(doc.id)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Delete document"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={deleteTargetId !== null} onOpenChange={(open) => !open && setDeleteTargetId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the document and its indexed chunks from the knowledge
              library. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionShell>
  )
}
