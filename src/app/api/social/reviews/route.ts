import { NextResponse } from 'next/server'
import { enforceUsage } from '@/lib/musashiUsage'
import { getDb } from '@/lib/db'

const newId = () => {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

// GET: Fetch reviews for a target (user/product) or by coaching session
export async function GET(req: Request) {
  try {
    await enforceUsage(req, 'chat')

    const { searchParams } = new URL(req.url)
    const targetId = searchParams.get('targetId')
    const targetType = searchParams.get('targetType')
    const coachingSessionId = searchParams.get('coachingSessionId')
    const reviewPhase = searchParams.get('reviewPhase')
    const limit = Math.min(Number(searchParams.get('limit') || 50), 200)

    const db = getDb()
    const where: string[] = []
    const params: any[] = []

    if (targetId) {
      where.push('r.target_id = ?')
      params.push(targetId)
    }

    if (targetType && ['user', 'product'].includes(targetType)) {
      where.push('r.target_type = ?')
      params.push(targetType)
    }

    if (coachingSessionId) {
      where.push('r.coaching_session_id = ?')
      params.push(coachingSessionId)
    }

    if (reviewPhase && ['pre_fight', 'post_fight'].includes(reviewPhase)) {
      where.push('r.review_phase = ?')
      params.push(reviewPhase)
    }

    const query = `
      SELECT r.*,
        fp.display_name as reviewer_name,
        fp.is_verified as reviewer_verified
      FROM reviews r
      LEFT JOIN fighter_profiles fp ON fp.user_id = r.reviewer_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY r.created_at DESC
      LIMIT ?
    `
    params.push(limit)

    const results = await db.prepare(query).bind(...params).all()

    const reviews = (results.results || []).map((row: any) => ({
      id: row.id,
      reviewerId: row.reviewer_id,
      reviewerName: row.reviewer_name || '',
      reviewerVerified: Boolean(row.reviewer_verified),
      targetId: row.target_id,
      targetType: row.target_type,
      rating: Number(row.rating),
      comment: row.comment || '',
      reviewPhase: row.review_phase || null,
      fightOutcome: row.fight_outcome || null,
      coachingSessionId: row.coaching_session_id || null,
      adviceEffectiveness: row.advice_effectiveness ? Number(row.advice_effectiveness) : null,
      createdAt: row.created_at,
    }))

    // Calculate aggregate stats
    const totalReviews = reviews.length
    const avgRating = totalReviews > 0 ? reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews : 0
    const preFightReviews = reviews.filter(r => r.reviewPhase === 'pre_fight')
    const postFightReviews = reviews.filter(r => r.reviewPhase === 'post_fight')
    const avgPreFightRating = preFightReviews.length > 0
      ? preFightReviews.reduce((sum, r) => sum + r.rating, 0) / preFightReviews.length : 0
    const avgPostFightRating = postFightReviews.length > 0
      ? postFightReviews.reduce((sum, r) => sum + r.rating, 0) / postFightReviews.length : 0
    const avgEffectiveness = postFightReviews.filter(r => r.adviceEffectiveness != null).length > 0
      ? postFightReviews.filter(r => r.adviceEffectiveness != null)
          .reduce((sum, r) => sum + (r.adviceEffectiveness || 0), 0) /
        postFightReviews.filter(r => r.adviceEffectiveness != null).length
      : 0
    const wins = postFightReviews.filter(r => r.fightOutcome === 'win').length
    const losses = postFightReviews.filter(r => r.fightOutcome === 'loss').length
    const draws = postFightReviews.filter(r => r.fightOutcome === 'draw').length

    return NextResponse.json({
      reviews,
      stats: {
        totalReviews,
        avgRating: Math.round(avgRating * 10) / 10,
        avgPreFightRating: Math.round(avgPreFightRating * 10) / 10,
        avgPostFightRating: Math.round(avgPostFightRating * 10) / 10,
        avgEffectiveness: Math.round(avgEffectiveness * 10) / 10,
        preFightCount: preFightReviews.length,
        postFightCount: postFightReviews.length,
        outcomes: { wins, losses, draws },
      },
    })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Failed to fetch reviews' }, { status: 500 })
  }
}

// POST: Submit a review (standard, pre-fight, or post-fight)
export async function POST(req: Request) {
  try {
    const user = await enforceUsage(req, 'chat')
    const body = await req.json() as Record<string, any>

    const targetId = String(body?.targetId || '').trim()
    const targetType = String(body?.targetType || '').trim()
    const rating = Number(body?.rating)
    const comment = String(body?.comment || '').trim()

    if (!targetId || !['user', 'product'].includes(targetType)) {
      return NextResponse.json({ error: 'Missing or invalid targetId/targetType' }, { status: 400 })
    }

    if (!rating || rating < 1 || rating > 5) {
      return NextResponse.json({ error: 'Rating must be between 1 and 5' }, { status: 400 })
    }

    // Cannot review yourself
    if (targetType === 'user' && targetId === user.id) {
      return NextResponse.json({ error: 'Cannot review yourself' }, { status: 400 })
    }

    // Optional two-phase fields
    const reviewPhase = ['pre_fight', 'post_fight'].includes(body?.reviewPhase) ? body.reviewPhase : null
    const fightOutcome = ['win', 'loss', 'draw'].includes(body?.fightOutcome) ? body.fightOutcome : null
    const coachingSessionId = body?.coachingSessionId ? String(body.coachingSessionId).trim() : null
    const adviceEffectiveness = body?.adviceEffectiveness
      ? Math.min(5, Math.max(1, Number(body.adviceEffectiveness)))
      : null

    // Validate post-fight specific fields
    if (reviewPhase === 'post_fight' && !fightOutcome) {
      return NextResponse.json({ error: 'Post-fight reviews require a fight outcome' }, { status: 400 })
    }

    const db = getDb()

    // Check for duplicate review (same reviewer, target, phase, session)
    if (coachingSessionId && reviewPhase) {
      const existing = await db
        .prepare(
          'SELECT id FROM reviews WHERE reviewer_id = ? AND target_id = ? AND coaching_session_id = ? AND review_phase = ?'
        )
        .bind(user.id, targetId, coachingSessionId, reviewPhase)
        .first()

      if (existing) {
        return NextResponse.json({
          error: `You already submitted a ${reviewPhase.replace('_', '-')} review for this session`,
        }, { status: 400 })
      }
    }

    const id = newId()
    const now = new Date().toISOString()

    await db
      .prepare(
        `INSERT INTO reviews (
          id, reviewer_id, target_id, target_type, rating, comment,
          review_phase, fight_outcome, coaching_session_id, advice_effectiveness, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id, user.id, targetId, targetType, rating, comment,
        reviewPhase, fightOutcome, coachingSessionId, adviceEffectiveness, now
      )
      .run()

    return NextResponse.json({
      id,
      reviewPhase,
      message: reviewPhase
        ? `${reviewPhase.replace('_', '-')} review submitted`
        : 'Review submitted',
    })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Failed to submit review' }, { status: 500 })
  }
}
