import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/db'
import { purchaseContentProduct } from '@/lib/marketplace/contentPurchases'

type Params = { id: string }

export async function POST(req: Request, context: { params: Promise<Params> }) {
  try {
    const user = await requireUser(req)
    const { id: productId } = await context.params

    let body: Record<string, unknown> = {}
    try {
      const raw = await req.text()
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    } catch {
      body = {}
    }

    const result = await purchaseContentProduct({
      db: getDb(),
      req,
      productId,
      buyer: user,
      successUrl: body.successUrl ? String(body.successUrl) : null,
      cancelUrl: body.cancelUrl ? String(body.cancelUrl) : null,
    })

    if (result.alreadyOwned) {
      return NextResponse.json({
        productId,
        alreadyOwned: true,
        videoUrl: result.videoUrl,
      })
    }

    return NextResponse.json({
      productId,
      purchaseId: result.purchaseId,
      payment: result.payment,
      videoUrl: result.videoUrl,
    })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'STRIPE_NOT_CONFIGURED') {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 501 })
    }
    if (code === 'Product not found') {
      return NextResponse.json({ error: code }, { status: 404 })
    }
    return NextResponse.json({ error: code || 'Purchase failed' }, { status: 400 })
  }
}
