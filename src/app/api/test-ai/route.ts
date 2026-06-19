import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'

export async function GET(req: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    await requireUser(req, { role: 'shogun' })
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const diagnostics = {
    geminiKeyPresent: !!process.env.GEMINI_API_KEY,
    openaiKeyPresent: !!process.env.OPENAI_API_KEY,
    nodeEnv: process.env.NODE_ENV ?? 'unknown',
    geminiModel: process.env.GEMINI_MODEL ?? 'not set',
  }

  return NextResponse.json(diagnostics)
}
