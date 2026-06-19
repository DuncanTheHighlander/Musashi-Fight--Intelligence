// Database Schema for Musashi Social Platform

export interface FighterProfile {
  id: string
  userId: string
  displayName: string
  bio: string
  location: {
    city: string
    state: string
    country: string
  }
  weightClass: string
  discipline: 'boxing' | 'kickboxing' | 'muay_thai' | 'mma' | 'other'
  record: {
    wins: number
    losses: number
    draws: number
    kos: number
  }
  stance: 'orthodox' | 'southpaw' | 'switch'
  team: string
  socialLinks: {
    instagram?: string
    twitter?: string
    youtube?: string
  }
  isVerified: boolean
  isPro: boolean
  createdAt: string
  updatedAt: string
}

export interface ScoutingRequest {
  id: string
  authorId: string
  opponentName: string
  opponentInfo: {
    weightClass: string
    record: string
    notableFights: string[]
    style: string
  }
  fightDate?: string
  location: string
  description: string
  videos: string[]
  tags: string[]
  status: 'open' | 'in_progress' | 'completed'
  responses: AnalysisResponse[]
  createdAt: string
  updatedAt: string
}

export interface AnalysisResponse {
  id: string
  requestId: string
  analystId: string
  content: string
  videoBreakdown: VideoAnalysis[]
  rating: number
  isHelpful: boolean
  createdAt: string
}

export interface VideoAnalysis {
  videoId: string
  timestamps: {
    start: number
    end: number
    technique: string
    advice: string
  }[]
}

export interface ContentProduct {
  id: string
  creatorId: string
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
  createdAt: string
  updatedAt: string
}

export interface Purchase {
  id: string
  buyerId: string
  productId: string
  amount: number
  currency: string
  stripePaymentId: string
  status: 'pending' | 'completed' | 'refunded'
  createdAt: string
}

export interface Message {
  id: string
  senderId: string
  receiverId: string
  content: string
  attachments: string[]
  isRead: boolean
  createdAt: string
}

export interface Follow {
  id: string
  followerId: string
  followingId: string
  createdAt: string
}

export interface Review {
  id: string
  reviewerId: string
  targetId: string // user or product
  targetType: 'user' | 'product'
  rating: number
  comment: string
  createdAt: string
}
