import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getPendingIngestions, processIngestion } from '@/lib/musashiLibrary'

export async function POST(req: Request) {
  try {
    const user = await requireUser(req, { role: 'shogun' })
    
    const body = await req.json() as Record<string, any>
    const { ingestionId, processAll } = body
    
    if (ingestionId) {
      await processIngestion(ingestionId)
      return NextResponse.json({ success: true, processed: 1 })
    }
    
    if (processAll) {
      const pending = await getPendingIngestions(10)
      let processed = 0
      const errors: string[] = []
      
      for (const ingestion of pending) {
        try {
          await processIngestion(ingestion.id)
          processed++
        } catch (e) {
          errors.push(`${ingestion.id}: ${e instanceof Error ? e.message : 'Unknown error'}`)
        }
      }
      
      return NextResponse.json({ success: true, processed, errors })
    }
    
    return NextResponse.json({ error: 'Specify ingestionId or processAll' }, { status: 400 })
    
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Login required' }, { status: 401 })
    }
    if (code === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Ingestion failed' }, { status: 500 })
  }
}

export async function GET(req: Request) {
  try {
    await requireUser(req, { role: 'shogun' })
    
    const pending = await getPendingIngestions(50)
    
    return NextResponse.json({ pending })
    
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Login required' }, { status: 401 })
    }
    if (code === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to fetch pending ingestions' }, { status: 500 })
  }
}
