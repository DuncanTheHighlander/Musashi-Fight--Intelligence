'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { BiometricMarketplaceCard } from '@/components/social/BiometricMarketplaceCard'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Search,
  Filter,
  TrendingUp,
  Star,
  Users,
  ShoppingCart,
  Zap,
  Target,
  Award,
  Briefcase,
  ArrowRight,
} from 'lucide-react'
import { parseApiResponse } from '@/lib/safeJson'
import { useSection, type AppSection } from '@/contexts/SectionContext'
import { useAuth } from '@/hooks/useAuth'
import { SectionHeader, SectionShell } from '@/components/ui/section-header'
import { cn } from '@/lib/utils'

interface MarketplaceProduct {
  id: string
  creatorId: string
  creatorName: string
  creatorAvatar: string
  title: string
  description: string
  type: 'technique' | 'breakdown' | 'training' | 'coaching'
  price: number
  currency: string
  videoUrl: string
  thumbnailUrl: string
  duration: number
  tags: string[]
  isPublished: boolean
  salesCount: number
  rating: number
  reviewCount: number
  creatorPerformance: {
    avgPowerIndex: number
    avgHandSpeedBwps: number
    totalSessions: number
  }
  effectivenessMetrics: {
    techniqueSuccessRate: number
    avgImprovementRate: number
    userSkillLevel: 'beginner' | 'intermediate' | 'advanced' | 'pro'
    realWorldApplication: number
    biomechanicalEfficiency: number
    totalPractitioners: number
    verifiedResults: boolean
  }
  createdAt: string
  updatedAt: string
}

const INITIAL_VISIBLE = 9

const PREVIEW_ENABLED = process.env.NEXT_PUBLIC_MUSASHI_PREVIEW_FEATURES === '1'

export default function MarketplaceSection() {
  const { toast } = useToast()
  const { user } = useAuth()
  const { setActiveSection } = useSection()
  const [products, setProducts] = useState<MarketplaceProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [purchasingId, setPurchasingId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE)
  const [previewProduct, setPreviewProduct] = useState<MarketplaceProduct | null>(null)

  useEffect(() => {
    if (!PREVIEW_ENABLED) return
    let cancelled = false
    const fetchProducts = async () => {
      try {
        const res = await fetch('/api/social/marketplace')
        if (!res.ok) throw new Error('Failed to fetch marketplace')
        const data = await parseApiResponse(res) as { products: MarketplaceProduct[] }
        if (!cancelled) {
          setProducts(data.products || [])
          setLoading(false)
        }
      } catch (err) {
        console.error('Marketplace fetch error:', err)
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    fetchProducts()
    return () => { cancelled = true }
  }, [])

  const handlePurchase = async (contentId: string) => {
    if (!user) {
      toast({ title: 'Log in required', description: 'Sign in to purchase content.', variant: 'destructive' })
      return
    }
    setPurchasingId(contentId)
    try {
      const origin = window.location.origin
      const res = await fetch(`/api/social/marketplace/${contentId}/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          successUrl: `${origin}/?section=marketplace&purchase=success&productId=${contentId}`,
          cancelUrl: `${origin}/?section=marketplace&purchase=cancelled&productId=${contentId}`,
        }),
      })
      const data = await parseApiResponse<{
        alreadyOwned?: boolean
        videoUrl?: string | null
        payment?: { requiresRedirect?: boolean; checkoutUrl?: string | null }
      }>(res)

      if (data.payment?.requiresRedirect && data.payment.checkoutUrl) {
        window.location.assign(data.payment.checkoutUrl)
        return
      }

      if (data.videoUrl) {
        window.open(data.videoUrl, '_blank', 'noopener,noreferrer')
      }

      toast({
        title: data.alreadyOwned ? 'Already purchased' : 'Purchase complete',
        description: data.videoUrl
          ? 'Your content is ready to view.'
          : 'Check your library for access.',
      })
    } catch (err) {
      toast({
        title: 'Purchase failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setPurchasingId(null)
    }
  }

  const handlePreview = (contentId: string) => {
    const product = products.find(p => p.id === contentId)
    if (product) setPreviewProduct(product)
  }

  const filteredProducts = products.filter(p => {
    if (searchQuery && !p.title.toLowerCase().includes(searchQuery.toLowerCase()) && 
        !p.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()))) {
      return false
    }
    if (selectedType && p.type !== selectedType) return false
    if (selectedLevel && p.effectivenessMetrics.userSkillLevel !== selectedLevel) return false
    return true
  })

  const visibleProducts = filteredProducts.slice(0, visibleCount)
  const hasMore = filteredProducts.length > visibleCount

  const transformedProducts = visibleProducts.map(p => ({
    id: p.id,
    title: p.title,
    creatorName: p.creatorName,
    // Real values from the API (aggregated over the creator's fight sessions).
    // Zero means "no recorded sessions yet" — the card hides the section in
    // that case instead of showing a fabricated number.
    creatorPerformance: p.creatorPerformance ?? {
      avgPowerIndex: 0,
      avgHandSpeedBwps: 0,
      totalSessions: 0,
    },
    type: p.type,
    price: p.price,
    rating: p.rating,
    salesCount: p.salesCount,
    effectivenessMetrics: {
      techniqueSuccessRate: p.effectivenessMetrics.techniqueSuccessRate / 100,
      avgImprovementRate: p.effectivenessMetrics.avgImprovementRate / 100,
      userSkillLevel: p.effectivenessMetrics.userSkillLevel,
      realWorldApplication: p.effectivenessMetrics.realWorldApplication / 20,
      biomechanicalEfficiency: p.effectivenessMetrics.biomechanicalEfficiency / 100,
      totalPractitioners: p.effectivenessMetrics.totalPractitioners,
      verifiedResults: p.effectivenessMetrics.verifiedResults,
    },
    tags: p.tags,
    videoUrl: p.videoUrl,
    thumbnailUrl: p.thumbnailUrl,
  }))

  const typeFilters = ['technique', 'breakdown', 'training', 'coaching']
  const levelFilters = ['beginner', 'intermediate', 'advanced', 'pro']

  // Stats grid empty-state: when there are no products yet, the Verified /
  // Practitioners / Avg Rating / Total Sales tiles should not show four
  // bold "0"s — that reads as "abandoned product". We render a muted em-dash
  // until real data exists, matching the home-page hero treatment.
  const totalVerified = products.filter(p => p.effectivenessMetrics.verifiedResults).length
  const totalPractitioners = products.reduce((acc, p) => acc + p.effectivenessMetrics.totalPractitioners, 0)
  const avgRating = products.length > 0
    ? (products.reduce((acc, p) => acc + p.rating, 0) / products.length)
    : 0
  const totalSales = products.reduce((acc, p) => acc + p.salesCount, 0)
  const statsAllZero =
    !loading &&
    products.length === 0 &&
    totalVerified === 0 &&
    totalPractitioners === 0 &&
    avgRating === 0 &&
    totalSales === 0

  const marketplaceStats: Array<{ icon: typeof Award; label: string; value: string }> = [
    { icon: Award, label: 'Verified Content', value: totalVerified.toLocaleString() },
    { icon: Users, label: 'Total Practitioners', value: totalPractitioners.toLocaleString() },
    { icon: Star, label: 'Avg Rating', value: avgRating > 0 ? avgRating.toFixed(1) : '0' },
    { icon: TrendingUp, label: 'Total Sales', value: totalSales.toLocaleString() },
  ]

  if (!PREVIEW_ENABLED) {
    return (
      <SectionShell>
        <SectionHeader
          icon={Briefcase}
          eyebrow="Coach feedback"
          title="Get video feedback from coaches"
          subtitle="Upload a clip for technique review, or scout an opponent before your next fight."
        />
        <Card className="border-border/60 bg-card">
          <CardContent className="flex flex-col items-center gap-4 p-10 text-center sm:p-12">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Briefcase className="h-7 w-7" />
            </div>
            <div className="max-w-md space-y-2">
              <CardTitle className="text-xl">Coaches send video breakdowns back</CardTitle>
              <CardDescription>
                Post your sparring clip or scout an opponent. Verified coaches analyze your footage and upload a video response.
              </CardDescription>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button asChild size="lg" className="gap-2">
                <Link href="/marketplace/jobs/new">
                  Review my clip
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="gap-2">
                <Link href="/marketplace/scout">
                  Scout opponent
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </SectionShell>
    )
  }

  return (
    <SectionShell>
      <SectionHeader
        icon={ShoppingCart}
        eyebrow="Biometric-Verified"
        title="Marketplace"
        subtitle="Premium techniques from verified fighters with real performance metrics"
      />

      {/* Quick navigation tiles — keep them, they're a useful cross-link to
          adjacent sections, but tighten their visual weight so the eye lands
          on the marketplace content below, not the nav bar. */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {([
          { section: 'scouting', icon: Target, label: 'Fight Posts', hint: 'Get opponent breakdowns', accent: 'hover:border-primary/40' },
          { section: 'coaches', icon: Award, label: 'Coach Rankings', hint: 'Top-rated coaches', accent: 'hover:border-yellow-500/40' },
          { section: 'fighters', icon: Users, label: 'Fighters', hint: 'Browse the community', accent: 'hover:border-blue-500/40' },
          { section: 'messages', icon: Zap, label: 'Messages', hint: 'Chat with coaches', accent: 'hover:border-green-500/40' },
        ] as { section: AppSection; icon: typeof Target; label: string; hint: string; accent: string }[]).map((tile) => (
          <button
            key={tile.section}
            onClick={() => setActiveSection(tile.section)}
            className="text-left"
          >
            <Card className={cn('group cursor-pointer border-border/50 bg-card/50 transition-all', tile.accent)}>
              <CardContent className="flex items-center gap-3 p-4">
                <tile.icon className="h-5 w-5 text-primary transition-transform group-hover:scale-110" />
                <div>
                  <div className="text-sm font-semibold">{tile.label}</div>
                  <div className="text-xs text-muted-foreground">{tile.hint}</div>
                </div>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {marketplaceStats.map((stat, i) => (
          <Card key={i} className="border-border/60 bg-card">
            <CardContent className="flex items-center gap-3 p-4">
              <stat.icon className={cn('h-6 w-6', statsAllZero ? 'text-muted-foreground/40' : 'text-primary')} />
              <div>
                <div className={cn('text-2xl font-bold tabular-nums', statsAllZero && 'text-muted-foreground/60')}>
                  {statsAllZero ? '—' : stat.value}
                </div>
                <div className="text-xs text-muted-foreground">{stat.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-card border-border">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search techniques, fighters, or tags..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          
          <div className="flex flex-wrap gap-2">
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <Filter className="h-4 w-4" /> Type:
            </span>
            {typeFilters.map(type => (
              <Button
                key={type}
                variant={selectedType === type ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setSelectedType(selectedType === type ? null : type)}
                className="capitalize"
              >
                {type}
              </Button>
            ))}
            
            <span className="text-sm text-muted-foreground flex items-center gap-1 ml-4">
              <Zap className="h-4 w-4" /> Level:
            </span>
            {levelFilters.map(level => (
              <Button
                key={level}
                variant={selectedLevel === level ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setSelectedLevel(selectedLevel === level ? null : level)}
                className="capitalize"
              >
                {level}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <Card key={i} className="h-[400px] animate-pulse bg-muted" />
          ))}
        </div>
      ) : filteredProducts.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="p-12 text-center">
            <Target className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No content found</h3>
            <p className="text-muted-foreground mb-4">
              {searchQuery || selectedType || selectedLevel
                ? 'Try adjusting your filters or search query'
                : 'Be the first to share your techniques!'}
            </p>
            <Button variant="outline" onClick={() => {
              setSearchQuery('')
              setSelectedType(null)
              setSelectedLevel(null)
            }}>
              Clear Filters
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {transformedProducts.map((content) => (
              <BiometricMarketplaceCard
                key={content.id}
                content={content}
                onPurchase={handlePurchase}
                onPreview={handlePreview}
              />
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => setVisibleCount(prev => prev + INITIAL_VISIBLE)}
              >
                Load More Content ({filteredProducts.length - visibleCount} remaining)
              </Button>
            </div>
          )}
        </>
      )}

      <Dialog open={!!previewProduct} onOpenChange={(open) => !open && setPreviewProduct(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          {previewProduct && (
            <>
              <DialogHeader>
                <Badge variant="secondary" className="w-fit capitalize">{previewProduct.type}</Badge>
                <DialogTitle className="text-xl">{previewProduct.title}</DialogTitle>
                <DialogDescription>{previewProduct.description}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span>by {previewProduct.creatorName}</span>
                  <span className="flex items-center gap-1">
                    <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                    {previewProduct.rating}
                  </span>
                  <span>{previewProduct.salesCount} sales</span>
                </div>
                {(previewProduct.thumbnailUrl || previewProduct.videoUrl) && (
                  <div className="aspect-video bg-muted rounded-lg overflow-hidden flex items-center justify-center">
                    {previewProduct.videoUrl ? (
                      <video
                        src={previewProduct.videoUrl}
                        poster={previewProduct.thumbnailUrl || undefined}
                        controls
                        className="w-full h-full object-contain"
                      />
                    ) : previewProduct.thumbnailUrl ? (
                      // Remote marketplace thumbnails come from mixed user/provider sources,
                      // so we intentionally keep a plain img here instead of next/image.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={previewProduct.thumbnailUrl}
                        alt={previewProduct.title}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover"
                      />
                    ) : null}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {previewProduct.tags.map(tag => (
                    <Badge key={tag} variant="outline" className="capitalize">{tag}</Badge>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-primary" />
                    <span>Success rate: {previewProduct.effectivenessMetrics.techniqueSuccessRate}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    <span>Improvement: {previewProduct.effectivenessMetrics.avgImprovementRate}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-primary" />
                    <span className="capitalize">{previewProduct.effectivenessMetrics.userSkillLevel}</span>
                  </div>
                  {previewProduct.effectivenessMetrics.verifiedResults && (
                    <div className="flex items-center gap-2 col-span-2">
                      <Award className="h-4 w-4 text-amber-500" />
                      <span>Biometric-verified results</span>
                    </div>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPreviewProduct(null)}>Close</Button>
                <Button
                  onClick={() => { void handlePurchase(previewProduct.id); setPreviewProduct(null) }}
                  disabled={purchasingId === previewProduct.id}
                >
                  <ShoppingCart className="h-4 w-4 mr-2" />
                  {purchasingId === previewProduct.id ? 'Processing…' : `Purchase $${previewProduct.price}`}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </SectionShell>
  )
}
