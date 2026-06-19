import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/db'

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const body = await req.json() as {
      sessionId: string
      status: 'completed' | 'paused' | 'cancelled'
    }

    const db = getDb()
    
    // Update session status and end time if completing
    const updateFields = ['status = ?', 'updated_at = ?']
    const updateValues = [body.status, new Date().toISOString()]
    
    if (body.status === 'completed') {
      updateFields.push('end_time = ?')
      updateValues.push(new Date().toISOString())
      
      // Calculate duration if start_time exists
      const session = await db.prepare(`
        SELECT start_time FROM fight_sessions WHERE id = ? AND user_id = ?
      `).bind(body.sessionId, user.id).first()
      
      if (session?.start_time) {
        const startTime = new Date(session.start_time).getTime()
        const endTime = Date.now()
        const durationSeconds = Math.floor((endTime - startTime) / 1000)
        
        updateFields.push('duration_seconds = ?')
        updateValues.push(String(durationSeconds))
      }
    }
    
    updateValues.push(body.sessionId, user.id)
    
    await db.prepare(`
      UPDATE fight_sessions 
      SET ${updateFields.join(', ')}
      WHERE id = ? AND user_id = ?
    `).bind(...updateValues).run()

    return NextResponse.json({ 
      sessionId: body.sessionId, 
      status: body.status,
      updatedAt: new Date().toISOString()
    })
  } catch (error) {
    console.error('Failed to update fight session:', error)
    return NextResponse.json({ error: 'Failed to update session' }, { status: 500 })
  }
}
