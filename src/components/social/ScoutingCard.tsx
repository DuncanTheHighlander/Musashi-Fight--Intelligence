'use client'

import React, { useState, useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Calendar,
  MapPin,
  User,
  ChevronDown,
  ChevronUp,
  Send,
  DollarSign,
  Clock,
  Check,
  X,
  Star,
  MessageSquare,
  Shield,
  Loader2,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { parseApiResponse } from '@/lib/safeJson'

interface Offer {
  id: string
  requestId: string
  coachId: string
  coachName: string
  coachVerified: boolean
  coachPro: boolean
  coachDiscipline: string
  price: number
  description: string
  estimatedDelivery: string
  status: 'pending' | 'accepted' | 'completed' | 'declined'
  createdAt: string
}

interface ScoutingCardProps {
  request: {
    id: string
    authorId?: string
    opponentName: string
    authorName: string
    description?: string
    location: string
    status: 'open' | 'in_progress' | 'completed'
    responseCount: number
    budget?: number
    createdAt: string
    updatedAt: string
  }
  currentUserId?: string
  onRefresh?: () => void
}

const statusColors = {
  open: 'bg-green-500/20 text-green-400 border-green-500/30',
  in_progress: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  completed: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
}

const statusLabels = {
  open: 'Open',
  in_progress: 'In Progress',
  completed: 'Completed',
}

export function ScoutingCard({ request, currentUserId, onRefresh }: ScoutingCardProps) {
  const { toast } = useToast()
  const [showOfferForm, setShowOfferForm] = useState(false)
  const [showOffers, setShowOffers] = useState(false)
  const [showReviewForm, setShowReviewForm] = useState(false)
  const [offers, setOffers] = useState<Offer[]>([])
  const [loadingOffers, setLoadingOffers] = useState(false)

  // Offer form state
  const [offerPrice, setOfferPrice] = useState('')
  const [offerDescription, setOfferDescription] = useState('')
  const [offerDelivery, setOfferDelivery] = useState('')
  const [submittingOffer, setSubmittingOffer] = useState(false)

  // Review form state
  const [reviewRating, setReviewRating] = useState(0)
  const [reviewComment, setReviewComment] = useState('')
  const [reviewPhase, setReviewPhase] = useState<'pre_fight' | 'post_fight'>('pre_fight')
  const [fightOutcome, setFightOutcome] = useState<'win' | 'loss' | 'draw' | ''>('')
  const [adviceEffectiveness, setAdviceEffectiveness] = useState(0)
  const [submittingReview, setSubmittingReview] = useState(false)

  // Action loading
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const isOwner = currentUserId && request.authorId === currentUserId

  const fetchOffers = async () => {
    try {
      setLoadingOffers(true)
      const res = await fetch(`/api/social/offers?requestId=${request.id}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = (await parseApiResponse(res)) as Record<string, any>
      setOffers(data.offers || [])
    } catch {
      toast({ title: 'Error', description: 'Failed to load offers', variant: 'destructive' })
    } finally {
      setLoadingOffers(false)
    }
  }

  const toggleOffers = () => {
    if (!showOffers) fetchOffers()
    setShowOffers(!showOffers)
  }

  const handleSubmitOffer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!offerDescription.trim()) {
      toast({ title: 'Missing info', description: 'Please describe your breakdown offer', variant: 'destructive' })
      return
    }
    try {
      setSubmittingOffer(true)
      const res = await fetch('/api/social/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: request.id,
          description: offerDescription.trim(),
          price: parseFloat(offerPrice) || 0,
          estimatedDelivery: offerDelivery.trim() || null,
        }),
      })
      if (!res.ok) {
        const err = (await parseApiResponse(res)) as Record<string, any>
        throw new Error(err.error || 'Failed')
      }
      toast({ title: 'Offer sent!', description: 'Your breakdown offer has been submitted' })
      setShowOfferForm(false)
      setOfferPrice('')
      setOfferDescription('')
      setOfferDelivery('')
      if (showOffers) fetchOffers()
      onRefresh?.()
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to submit offer', variant: 'destructive' })
    } finally {
      setSubmittingOffer(false)
    }
  }

  const handleOfferAction = async (offerId: string, action: 'accept' | 'decline' | 'complete') => {
    try {
      setActionLoading(offerId)
      const res = await fetch('/api/social/offers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offerId, action }),
      })
      if (!res.ok) {
        const err = (await parseApiResponse(res)) as Record<string, any>
        throw new Error(err.error || 'Failed')
      }
      toast({ title: 'Done', description: `Offer ${action}ed successfully` })
      fetchOffers()
      onRefresh?.()
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Action failed', variant: 'destructive' })
    } finally {
      setActionLoading(null)
    }
  }

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault()
    if (reviewRating < 1 || reviewRating > 5) {
      toast({ title: 'Missing rating', description: 'Please select a rating (1-5)', variant: 'destructive' })
      return
    }
    if (reviewPhase === 'post_fight' && !fightOutcome) {
      toast({ title: 'Missing outcome', description: 'Post-fight reviews require a fight outcome', variant: 'destructive' })
      return
    }

    // Find the accepted/completed offer to get the coach ID
    const targetOffer = offers.find(o => o.status === 'accepted' || o.status === 'completed')
    if (!targetOffer) {
      toast({ title: 'Error', description: 'No accepted offer found to review', variant: 'destructive' })
      return
    }

    try {
      setSubmittingReview(true)
      const res = await fetch('/api/social/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetId: targetOffer.coachId,
          targetType: 'user',
          rating: reviewRating,
          comment: reviewComment.trim(),
          reviewPhase,
          fightOutcome: reviewPhase === 'post_fight' ? fightOutcome : null,
          coachingSessionId: targetOffer.id,
          adviceEffectiveness: reviewPhase === 'post_fight' && adviceEffectiveness > 0 ? adviceEffectiveness : null,
        }),
      })
      if (!res.ok) {
        const err = (await parseApiResponse(res)) as Record<string, any>
        throw new Error(err.error || 'Failed')
      }
      toast({ title: 'Review submitted!', description: `Your ${reviewPhase.replace('_', '-')} review has been saved` })
      setShowReviewForm(false)
      setReviewRating(0)
      setReviewComment('')
      setFightOutcome('')
      setAdviceEffectiveness(0)
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to submit review', variant: 'destructive' })
    } finally {
      setSubmittingReview(false)
    }
  }

  const StarRating = ({ value, onChange }: { value: number; onChange: (v: number) => void }) => (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          className="focus:outline-none"
        >
          <Star
            className={`h-6 w-6 transition-colors ${
              star <= value ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600 hover:text-yellow-400/50'
            }`}
          />
        </button>
      ))}
    </div>
  )

  return (
    <Card className="border-border/60 bg-card/60 backdrop-blur-sm transition-all duration-200 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5">
      <CardContent className="p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="mb-2 truncate text-lg font-semibold leading-tight text-foreground">
              {request.opponentName}
            </h3>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <User className="h-3.5 w-3.5" />
              <span>Requested by <span className="text-foreground/80">{request.authorName}</span></span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              <span className="truncate">{request.location}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <Badge variant="outline" className={statusColors[request.status]}>
              {statusLabels[request.status]}
            </Badge>
            {request.responseCount > 0 && (
              <Badge className="border-blue-500/30 bg-blue-500/15 text-blue-400 text-[10.5px]">
                {request.responseCount} response{request.responseCount !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>
        </div>

        {request.description && (
          <p className="mb-4 line-clamp-2 text-sm text-muted-foreground">
            {request.description}
          </p>
        )}

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            <span>{new Date(request.createdAt).toLocaleDateString()}</span>
          </div>
          {request.budget && request.budget > 0 && (
            <div className="flex items-center gap-1 text-yellow-400">
              <DollarSign className="h-3.5 w-3.5" />
              <span className="font-medium">${request.budget} budget</span>
            </div>
          )}
        </div>
      </CardContent>

      <CardFooter className="p-6 pt-0 flex flex-col gap-3">
        {/* Action buttons row */}
        <div className="flex gap-2 w-full">
          {/* Make Offer button — only for non-owners on open requests */}
          {request.status === 'open' && !isOwner && (
            <Button
              onClick={() => { setShowOfferForm(!showOfferForm); setShowOffers(false); setShowReviewForm(false) }}
              className="flex-1"
            >
              <Send className="h-4 w-4 mr-2" />
              {showOfferForm ? 'Cancel' : 'Make Offer'}
            </Button>
          )}

          {/* View Offers button */}
          <Button
            variant="outline"
            onClick={() => { toggleOffers(); setShowOfferForm(false); setShowReviewForm(false) }}
            className="flex-1"
          >
            <MessageSquare className="h-4 w-4 mr-2" />
            View Offers
            {showOffers ? <ChevronUp className="h-4 w-4 ml-1" /> : <ChevronDown className="h-4 w-4 ml-1" />}
          </Button>

          {/* Leave Review button — for owners on in_progress or completed requests */}
          {isOwner && (request.status === 'in_progress' || request.status === 'completed') && (
            <Button
              variant="outline"
              onClick={() => {
                setShowReviewForm(!showReviewForm)
                setShowOfferForm(false)
                if (!showOffers) { fetchOffers(); setShowOffers(true) }
              }}
              className="flex-1 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
            >
              <Star className="h-4 w-4 mr-2" />
              {showReviewForm ? 'Cancel' : 'Leave Review'}
            </Button>
          )}
        </div>

        {/* Make Offer Form */}
        {showOfferForm && (
          <form onSubmit={handleSubmitOffer} className="w-full space-y-3 rounded-lg border border-border/40 bg-muted/30 p-4">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Send className="h-4 w-4 text-primary" />
              Submit Your Breakdown Offer
            </h4>
            <textarea
              placeholder="Describe what you'll provide — game plan, video analysis, technique breakdown, etc."
              value={offerDescription}
              onChange={(e) => setOfferDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-background/50 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Your Price ($)</label>
                <Input
                  type="number"
                  min="0"
                  step="5"
                  placeholder="0 = free"
                  value={offerPrice}
                  onChange={(e) => setOfferPrice(e.target.value)}
                  className="bg-background/50"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Delivery Time</label>
                <Input
                  placeholder="e.g. 2 days"
                  value={offerDelivery}
                  onChange={(e) => setOfferDelivery(e.target.value)}
                  className="bg-background/50"
                />
              </div>
            </div>
            <Button type="submit" disabled={submittingOffer} className="w-full">
              {submittingOffer ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting...</> : 'Submit Offer'}
            </Button>
          </form>
        )}

        {/* Offers List */}
        {showOffers && (
          <div className="w-full space-y-2">
            {loadingOffers ? (
              <div className="flex items-center justify-center py-4 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading offers...
              </div>
            ) : offers.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground text-sm">
                No offers yet. {request.status === 'open' && !isOwner && 'Be the first to make one!'}
              </div>
            ) : (
              offers.map((offer) => (
                <div
                  key={offer.id}
                  className={`rounded-lg border p-3 transition-all ${
                    offer.status === 'accepted'
                      ? 'border-green-500/30 bg-green-500/10'
                      : offer.status === 'completed'
                      ? 'border-blue-500/30 bg-blue-500/10'
                      : offer.status === 'declined'
                      ? 'border-red-500/20 bg-red-500/5 opacity-60'
                      : 'border-border/40 bg-muted/30'
                  }`}
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{offer.coachName}</span>
                      {offer.coachVerified && <Shield className="h-3.5 w-3.5 text-blue-400" />}
                      {offer.coachPro && (
                        <Badge className="border-yellow-500/30 bg-yellow-500/15 text-yellow-400 text-[10px] px-1.5 py-0">
                          PRO
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {offer.price > 0 && (
                        <span className="text-sm font-semibold text-green-400">${offer.price}</span>
                      )}
                      <Badge
                        variant="outline"
                        className={`text-[10px] capitalize ${
                          offer.status === 'accepted' ? 'border-green-500/30 bg-green-500/15 text-green-400'
                          : offer.status === 'completed' ? 'border-blue-500/30 bg-blue-500/15 text-blue-400'
                          : offer.status === 'declined' ? 'border-red-500/30 bg-red-500/15 text-red-400'
                          : 'border-border/50 text-muted-foreground'
                        }`}
                      >
                        {offer.status}
                      </Badge>
                    </div>
                  </div>
                  <p className="mb-2 text-xs text-muted-foreground">{offer.description}</p>
                  {offer.estimatedDelivery && (
                    <div className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>Delivery: {offer.estimatedDelivery}</span>
                    </div>
                  )}

                  {isOwner && offer.status === 'pending' && (
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleOfferAction(offer.id, 'accept')}
                        disabled={actionLoading === offer.id}
                        className="h-8 flex-1 bg-emerald-600 text-xs hover:bg-emerald-500"
                      >
                        {actionLoading === offer.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Check className="mr-1 h-3 w-3" /> Accept</>}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOfferAction(offer.id, 'decline')}
                        disabled={actionLoading === offer.id}
                        className="h-8 flex-1 border-red-500/30 text-xs text-red-400 hover:bg-red-500/10"
                      >
                        <X className="mr-1 h-3 w-3" /> Decline
                      </Button>
                    </div>
                  )}

                  {currentUserId === offer.coachId && offer.status === 'accepted' && (
                    <Button
                      size="sm"
                      onClick={() => handleOfferAction(offer.id, 'complete')}
                      disabled={actionLoading === offer.id}
                      className="mt-2 h-8 w-full text-xs"
                    >
                      {actionLoading === offer.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Check className="mr-1 h-3 w-3" /> Mark Completed</>}
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Review Form */}
        {showReviewForm && (
          <form onSubmit={handleSubmitReview} className="w-full space-y-3 rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-4">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Star className="h-4 w-4 text-yellow-400" />
              Review the Coach
            </h4>

            {/* Phase selector */}
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={reviewPhase === 'pre_fight' ? 'default' : 'outline'}
                onClick={() => setReviewPhase('pre_fight')}
                className={reviewPhase === 'pre_fight' ? '' : ''}
              >
                Pre-Fight Review
              </Button>
              <Button
                type="button"
                size="sm"
                variant={reviewPhase === 'post_fight' ? 'default' : 'outline'}
                onClick={() => setReviewPhase('post_fight')}
                className={reviewPhase === 'post_fight' ? '' : ''}
              >
                Post-Fight Review
              </Button>
            </div>

            {/* Rating */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Rating</label>
              <StarRating value={reviewRating} onChange={setReviewRating} />
            </div>

            {/* Post-fight specific fields */}
            {reviewPhase === 'post_fight' && (
              <>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Fight Outcome *</label>
                  <div className="flex gap-2">
                    {(['win', 'loss', 'draw'] as const).map((outcome) => (
                      <Button
                        key={outcome}
                        type="button"
                        size="sm"
                        variant={fightOutcome === outcome ? 'default' : 'outline'}
                        onClick={() => setFightOutcome(outcome)}
                        className={
                          fightOutcome === outcome
                            ? outcome === 'win' ? 'bg-green-600 text-white' : outcome === 'loss' ? 'bg-red-600 text-white' : 'bg-gray-600 text-white'
                            : ''
                        }
                      >
                        {outcome.charAt(0).toUpperCase() + outcome.slice(1)}
                      </Button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Advice Effectiveness</label>
                  <StarRating value={adviceEffectiveness} onChange={setAdviceEffectiveness} />
                </div>
              </>
            )}

            {/* Comment */}
            <textarea
              placeholder={reviewPhase === 'pre_fight'
                ? 'How was the breakdown quality? Was the game plan clear and actionable?'
                : 'Did the advice help in the fight? What worked, what didn\'t?'}
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-background/50 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />

            <Button type="submit" disabled={submittingReview} className="w-full bg-yellow-600 hover:bg-yellow-500">
              {submittingReview ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting...</> : 'Submit Review'}
            </Button>
          </form>
        )}
      </CardFooter>
    </Card>
  )
}
