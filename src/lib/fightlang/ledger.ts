/**
 * BROWSER-SIDE FRAME ACCUMULATOR LEDGER
 *
 * This file defines the lightweight, real-time frame accumulator that runs in
 * the browser as the video plays. It holds recent frames + rolling P50 stats.
 *
 * ⚠️  THIS IS NOT THE CANONICAL COMPILED LEDGER.
 *
 * The canonical server-side compiled ledger (with events, faults, patterns,
 * geometry, kinematics, etc.) is defined in:
 *   @/lib/fightlang/fightlang.types → FightEvidenceLedger (fightlang.types.ts)
 *
 * This accumulator ledger is used for:
 *   - Browser-side real-time preview (CoachSidebar, FightOverlay)
 *   - /api/coach chat endpoint (quick single-turn coaching)
 *
 * The compiled ledger (fightlang.types.ts) is used for:
 *   - /api/fight/analyze (full pipeline + Gemini coaching)
 *   - All LLM grounding and overlay annotation
 */

import { z } from 'zod'

export const FightLangFrameEvidenceSchema = z.object({
  tMs: z.number().int().nonnegative(),
  videoTimeSec: z.number().nonnegative().nullable(),
  fighters: z.object({
    A: z
      .object({
        torsoAngleDeg: z.number().nullable(),
        stanceWidthSw: z.number().nullable(),
        compromisedBaseScoreSw: z.number().nullable(),
        compromisedBase: z.boolean().nullable(),
      })
      .nullable(),
    B: z
      .object({
        torsoAngleDeg: z.number().nullable(),
        stanceWidthSw: z.number().nullable(),
        compromisedBaseScoreSw: z.number().nullable(),
        compromisedBase: z.boolean().nullable(),
      })
      .nullable(),
  }),
})

export type FightLangFrameEvidence = z.infer<typeof FightLangFrameEvidenceSchema>

export const FightEvidenceLedgerSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  constants: z.object({
    compromisedBaseThresholdSw: z.number(),
  }),
  // Keep this small and citeable. Store recent samples + simple rollups.
  recentFrames: z.array(FightLangFrameEvidenceSchema).max(120),
  aggregates: z.object({
    A: z
      .object({
        torsoAngleDegP50: z.number().nullable(),
        stanceWidthSwP50: z.number().nullable(),
        compromisedBaseRate: z.number().nullable(), // 0..1
      })
      .nullable(),
    B: z
      .object({
        torsoAngleDegP50: z.number().nullable(),
        stanceWidthSwP50: z.number().nullable(),
        compromisedBaseRate: z.number().nullable(),
      })
      .nullable(),
  }),
})

export type FightEvidenceLedger = z.infer<typeof FightEvidenceLedgerSchema>

