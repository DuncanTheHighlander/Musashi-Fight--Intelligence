import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/db'

const newId = () => {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

// GET: Fetch breakdown offers for a scouting request, or all offers by a coach
export async function GET(req: Request) {
  try {
    await requireUser(req)

    const { searchParams } = new URL(req.url)
    const requestId = searchParams.get('requestId')
    const coachId = searchParams.get('coachId')
    const status = searchParams.get('status')
    const limit = Math.min(Number(searchParams.get('limit') || 50), 200)

    const db = getDb()
    const where: string[] = []
    const params: any[] = []

    if (requestId) {
      where.push('bo.request_id = ?')
      params.push(requestId)
    }

    if (coachId) {
      where.push('bo.coach_id = ?')
      params.push(coachId)
    }

    if (status && ['pending', 'accepted', 'completed', 'declined'].includes(status)) {
      where.push('bo.status = ?')
      params.push(status)
    }

    const query = `
      SELECT bo.*,
        fp.display_name as coach_name,
        fp.is_verified as coach_verified,
        fp.is_pro as coach_pro,
        fp.discipline as coach_discipline,
        sr.opponent_name,
        sr.author_id as requester_id,
        sr.budget as request_budget
      FROM breakdown_offers bo
      JOIN fighter_profiles fp ON fp.user_id = bo.coach_id
      JOIN scouting_requests sr ON sr.id = bo.request_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY bo.created_at DESC
      LIMIT ?
    `
    params.push(limit)

    const results = await db.prepare(query).bind(...params).all()

    const offers = (results.results || []).map((row: any) => ({
      id: row.id,
      requestId: row.request_id,
      coachId: row.coach_id,
      coachName: row.coach_name || '',
      coachVerified: Boolean(row.coach_verified),
      coachPro: Boolean(row.coach_pro),
      coachDiscipline: row.coach_discipline || '',
      opponentName: row.opponent_name || '',
      requesterId: row.requester_id || '',
      requestBudget: Number(row.request_budget || 0),
      price: Number(row.price || 0),
      description: row.description || '',
      estimatedDelivery: row.estimated_delivery || '',
      status: row.status as 'pending' | 'accepted' | 'completed' | 'declined',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))

    return NextResponse.json({ offers })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Failed to fetch offers' }, { status: 500 })
  }
}

// POST: Coach submits a breakdown offer on a scouting request
export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const body = await req.json() as Record<string, any>

    const requestId = String(body?.requestId || '').trim()
    const description = String(body?.description || '').trim()
    const price = Math.max(0, Number(body?.price) || 0)
    const estimatedDelivery = String(body?.estimatedDelivery || '').trim()

    if (!requestId || !description) {
      return NextResponse.json({ error: 'Missing requestId or description' }, { status: 400 })
    }

    const db = getDb()

    // Verify the scouting request exists and is open
    const request = await db
      .prepare('SELECT id, author_id, status FROM scouting_requests WHERE id = ?')
      .bind(requestId)
      .first()

    if (!request) {
      return NextResponse.json({ error: 'Scouting request not found' }, { status: 404 })
    }

    if (request.status !== 'open') {
      return NextResponse.json({ error: 'This request is no longer accepting offers' }, { status: 400 })
    }

    // Coach cannot offer on their own request
    if (request.author_id === user.id) {
      return NextResponse.json({ error: 'Cannot submit an offer on your own request' }, { status: 400 })
    }

    // Check for duplicate offer
    const existing = await db
      .prepare('SELECT id FROM breakdown_offers WHERE request_id = ? AND coach_id = ? AND status != ?')
      .bind(requestId, user.id, 'declined')
      .first()

    if (existing) {
      return NextResponse.json({ error: 'You already have an active offer on this request' }, { status: 400 })
    }

    const id = newId()
    const now = new Date().toISOString()

    await db
      .prepare(
        `INSERT INTO breakdown_offers (
          id, request_id, coach_id, price, description, estimated_delivery, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      )
      .bind(id, requestId, user.id, price, description, estimatedDelivery || null, now, now)
      .run()

    return NextResponse.json({ id, status: 'pending' })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Failed to create offer' }, { status: 500 })
  }
}

// PATCH: Accept, decline, or complete an offer
export async function PATCH(req: Request) {
  try {
    const user = await requireUser(req)
    const body = await req.json() as Record<string, any>

    const offerId = String(body?.offerId || '').trim()
    const action = String(body?.action || '').trim()

    if (!offerId || !['accept', 'decline', 'complete'].includes(action)) {
      return NextResponse.json({ error: 'Missing offerId or invalid action' }, { status: 400 })
    }

    const db = getDb()

    // Get the offer and its associated request
    const offer = await db
      .prepare(`
        SELECT bo.*, sr.author_id as requester_id, sr.budget as request_budget
        FROM breakdown_offers bo
        JOIN scouting_requests sr ON sr.id = bo.request_id
        WHERE bo.id = ?
      `)
      .bind(offerId)
      .first()

    if (!offer) {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
    }

    const now = new Date().toISOString()

    if (action === 'accept') {
      // Only the requester can accept
      if (offer.requester_id !== user.id) {
        return NextResponse.json({ error: 'Only the requester can accept offers' }, { status: 403 })
      }
      if (offer.status !== 'pending') {
        return NextResponse.json({ error: 'Offer is not pending' }, { status: 400 })
      }

      // Accept this offer
      await db
        .prepare('UPDATE breakdown_offers SET status = ?, updated_at = ? WHERE id = ?')
        .bind('accepted', now, offerId)
        .run()

      // Decline all other pending offers on this request
      await db
        .prepare('UPDATE breakdown_offers SET status = ?, updated_at = ? WHERE request_id = ? AND id != ? AND status = ?')
        .bind('declined', now, offer.request_id, offerId, 'pending')
        .run()

      // Update scouting request status
      await db
        .prepare('UPDATE scouting_requests SET status = ?, updated_at = ? WHERE id = ?')
        .bind('in_progress', now, offer.request_id)
        .run()

      // Create purchase record if there's a price
      if (Number(offer.price) > 0) {
        const purchaseId = newId()
        await db
          .prepare(
            `INSERT INTO purchases (id, buyer_id, product_id, amount, currency, status, created_at)
             VALUES (?, ?, ?, ?, 'USD', 'pending', ?)`
          )
          .bind(purchaseId, user.id, offerId, Number(offer.price), now)
          .run()
      }

      return NextResponse.json({ status: 'accepted' })
    }

    if (action === 'decline') {
      // Requester or coach can decline
      if (offer.requester_id !== user.id && offer.coach_id !== user.id) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
      }

      await db
        .prepare('UPDATE breakdown_offers SET status = ?, updated_at = ? WHERE id = ?')
        .bind('declined', now, offerId)
        .run()

      return NextResponse.json({ status: 'declined' })
    }

    if (action === 'complete') {
      // Only the coach can mark as complete
      if (offer.coach_id !== user.id) {
        return NextResponse.json({ error: 'Only the coach can complete the offer' }, { status: 403 })
      }
      if (offer.status !== 'accepted') {
        return NextResponse.json({ error: 'Offer must be accepted before completing' }, { status: 400 })
      }

      await db
        .prepare('UPDATE breakdown_offers SET status = ?, updated_at = ? WHERE id = ?')
        .bind('completed', now, offerId)
        .run()

      // Update scouting request
      await db
        .prepare('UPDATE scouting_requests SET status = ?, updated_at = ? WHERE id = ?')
        .bind('completed', now, offer.request_id)
        .run()

      // Update purchase status if exists
      await db
        .prepare('UPDATE purchases SET status = ? WHERE product_id = ? AND status = ?')
        .bind('completed', offerId, 'pending')
        .run()

      return NextResponse.json({ status: 'completed' })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Failed to update offer' }, { status: 500 })
  }
}
