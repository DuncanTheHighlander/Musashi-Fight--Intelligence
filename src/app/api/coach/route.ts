import { NextResponse } from 'next/server'
import { z } from 'zod'
import { generateCoachNarrative } from '@/lib/ai/gemini'
import { FightEvidenceLedgerSchema } from '@/lib/fightlang/ledger'
import { aiGuard } from '@/lib/ai/aiGuard'

const CoachRequestSchema = z.object({
  question: z.string().min(1).max(2000),
  ledger: FightEvidenceLedgerSchema,
})

function buildStrictSystemPrompt(): string {
  return [
    'You are a world-class MMA analyst and coach.',
    'You are working inside a system called FightLang.',
    '',
    'CRITICAL EVIDENCE CONTRACT:',
    '- You MUST base every claim strictly on the provided JSON ledger.',
    '- Do NOT infer or invent physics, biomechanics, strikes, tactics, or events that are not explicitly supported by the ledger.',
    '- Do NOT guess missing values. If the ledger does not contain evidence for a claim, say: "Insufficient evidence in the ledger."',
    '- When you reference a metric, you MUST cite the exact ledger field name and the numeric value you used.',
    '- If you discuss a fighter, specify A or B (matching ledger ids).',
    '',
    'OUTPUT RULES:',
    '- Be concise, high-signal, and actionable.',
    '- Use short sections: What_the_data_says, What_to_fix, One_drill.',
    '- Every bullet must contain at least one ledger citation like: recentFrames[n].fighters.A.torsoAngleDeg=25.',
    '',
    'FORBIDDEN:',
    '- No new numbers. No made-up angles, distances, or causal explanations.',
    '- No claims about what was thrown/landed unless the ledger directly contains that.',
  ].join('\n')
}

export async function POST(req: Request) {
  try {
    const guard = await aiGuard(req, 'chat')
    if (!guard.ok) return guard.response

    const body = await req.json().catch(() => null)
    const parsed = CoachRequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { question, ledger } = parsed.data

    const system = buildStrictSystemPrompt()
    const user = [
      'User_question:',
      question.trim(),
      '',
      'FightEvidenceLedger_JSON:',
      JSON.stringify(ledger, null, 2),
      '',
      'Answer now, obeying the evidence contract.',
    ].join('\n')

    const narrative = await generateCoachNarrative(`${system}\n\n${user}`)

    return NextResponse.json({ narrative })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

