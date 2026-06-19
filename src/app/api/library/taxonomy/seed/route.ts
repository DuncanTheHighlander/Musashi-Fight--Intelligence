import { NextResponse } from 'next/server'
import { seedTaxonomy } from '@/lib/taxonomyService'
import { getAllSeedData } from '@/lib/taxonomySeed'
import { createDocument } from '@/lib/musashiLibrary'

/**
 * POST /api/library/taxonomy/seed
 *
 * Seeds the taxonomy tables with structured technique data for all disciplines.
 * Also pushes each technique entry into the knowledge base for vector search.
 * Admin-only in production.
 */
export async function POST(req: Request) {
  try {
    // Only allow in dev or for admin users
    const isDev = process.env.NODE_ENV === 'development'
    if (!isDev) {
      const { requireUser } = await import('@/lib/musashiAuth')
      await requireUser(req, { role: 'shogun' })
    }

    const data = getAllSeedData()

    // Step 1: Seed taxonomy tables
    const counts = await seedTaxonomy(data)

    // Step 2: Push technique entries into knowledge base for vector search
    let knowledgeSynced = 0
    for (const entry of data.entries) {
      try {
        const content = [
          entry.description,
          '',
          `Key Points: ${entry.keyPoints.join('; ')}`,
          entry.commonMistakes.length > 0 ? `Common Mistakes: ${entry.commonMistakes.join('; ')}` : '',
          entry.positionContext ? `Position: ${entry.positionContext}` : '',
          `Difficulty: ${entry.difficulty}`,
          `Effectiveness: ${(entry.effectivenessScore * 100).toFixed(0)}%`,
        ].filter(Boolean).join('\n')

        await createDocument({
          title: `${entry.name} (${entry.discipline})`,
          content,
          sourceType: 'api',
          tags: [...entry.tags, entry.discipline, entry.difficulty, ...(entry.positionContext ? [entry.positionContext] : [])],
          metadata: {
            taxonomyId: entry.id,
            discipline: entry.discipline,
            categoryId: entry.categoryId,
            difficulty: entry.difficulty,
            positionContext: entry.positionContext,
            effectivenessScore: entry.effectivenessScore,
            type: 'technique',
          },
        })
        knowledgeSynced++
      } catch {
        // Skip duplicates or errors — non-fatal
      }
    }

    return NextResponse.json({
      success: true,
      taxonomy: counts,
      knowledgeBase: { synced: knowledgeSynced, total: data.entries.length },
    })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Login required' }, { status: 401 })
    }
    if (code === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }
    console.error('Taxonomy seed error:', e)
    return NextResponse.json(
      { error: 'Taxonomy seed failed', details: code },
      { status: 500 }
    )
  }
}
