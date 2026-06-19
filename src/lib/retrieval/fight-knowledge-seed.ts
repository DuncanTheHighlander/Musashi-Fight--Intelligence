import { embedText } from '@/lib/ai/gemini-embed'
import type { RetrievalStore } from './retrieval'

const FIGHT_KNOWLEDGE: Array<{ id: string; text: string; namespace: 'style_drill_library' }> = [
  {
    id: 'fk_guard_drop_counter',
    namespace: 'style_drill_library',
    text: `When a fighter drops their guard (hands fall below chin line), it creates a window for the opponent to land a straight punch through the opening. The counter-cross or overhand becomes high-percentage. The fighter dropping their guard should focus on keeping elbows tight and hands at temple height, especially after throwing combinations. A common cause is fatigue — fighters let hands drift down between exchanges.`,
  },
  {
    id: 'fk_chin_exposure_tactic',
    namespace: 'style_drill_library',
    text: `Chin exposure happens when a fighter leans forward with their head past their lead foot line, or tilts the chin up during exchanges. This is a knockout risk — the jaw becomes the easiest target. Tactical fix: tuck chin behind lead shoulder, use head movement (slips/rolls) instead of leaning. An opponent seeing chin exposure should attack with hooks and uppercuts to the exposed jaw angle.`,
  },
  {
    id: 'fk_overextension_punish',
    namespace: 'style_drill_library',
    text: `Overextension occurs when a fighter reaches too far with punches, pushing their weight past their base. This compromises balance and recovery time. An overextended jab leaves the fighter vulnerable to a pull-counter (lean back, counter straight). Overextended hooks leave the body open. The fix is to punch within range — step in first, then punch, rather than reaching.`,
  },
  {
    id: 'fk_stance_switch_read',
    namespace: 'style_drill_library',
    text: `A stance switch (orthodox to southpaw or vice versa) changes the angles of attack completely. When a fighter switches stance, they briefly have a narrower base and less power from the rear hand. An opponent should recognize the switch and attack during the transition. However, a skilled stance-switcher uses this to create new angles for the lead hook or lead uppercut. The key read: watch the feet — when feet cross or align, that's the vulnerable moment.`,
  },
  {
    id: 'fk_range_management',
    namespace: 'style_drill_library',
    text: `Range is the most fundamental tactical concept. At long range (outside jab distance), the fighter who controls distance wins. At mid range, combinations and counters dominate. At close range (clinch/infighting), body work and uppercuts are key. When one fighter consistently closes range while the other retreats, the pressure fighter is controlling the pace. The retreating fighter should use lateral movement (circling) rather than backing up straight, and use push kicks or jabs to manage distance.`,
  },
  {
    id: 'fk_rhythm_break',
    namespace: 'style_drill_library',
    text: `Rhythm in fighting is the cadence of movement — bouncing, feinting, stepping. When a fighter has steady rhythm, they're predictable. A rhythm break (sudden freeze, speed change, or unexpected timing) creates openings. If analysis shows consistent bounce Hz, the opponent can time attacks to land between bounces. Conversely, the bouncing fighter should vary their cadence to avoid being timed. A sudden stop followed by an explosive combination is a classic rhythm break tactic.`,
  },
  {
    id: 'fk_pressure_vs_counter',
    namespace: 'style_drill_library',
    text: `Pressure fighting means constantly moving forward, cutting angles, throwing volume. Counter fighting means waiting for the opponent to initiate, then exploiting openings. When the ledger shows one fighter consistently at closer range with higher hand speed, that's the pressure fighter. The counter fighter should show high guard, use angles, and look for pull-counters and check hooks. If both fighters are pressing, the one with better inside position (head placement, underhooks) controls exchanges.`,
  },
  {
    id: 'fk_combination_flow',
    namespace: 'style_drill_library',
    text: `Effective combinations flow: jab sets up the cross, cross sets up the hook, hook sets up the uppercut. Hand burst speed (high hand speed in a short window) indicates combination punching. When burst is detected on one fighter, analyze what happens to the OTHER fighter's guard and position during that burst — are they shelling up, moving back, or countering? The response to pressure tells you who's winning the tactical exchange.`,
  },
  {
    id: 'fk_base_compromise',
    namespace: 'style_drill_library',
    text: `A compromised base means the fighter's weight distribution is unbalanced — feet too close together, weight too far forward or back, or hips misaligned with feet. This makes them vulnerable to sweeps, push kicks, and power shots that knock them off balance. Signs: narrow stance width relative to shoulder width, hip center far from foot midpoint. The fix is resetting stance between exchanges — feet shoulder-width apart, weight centered.`,
  },
  {
    id: 'fk_defensive_shell',
    namespace: 'style_drill_library',
    text: `A high guard / tight shell (hands at temples, elbows protecting body) is defensive but limits vision and offense. Fighters in shell position are often absorbing pressure. Tactically, the attacker should target the body (elbows create gaps at the ribs) or use uppercuts to split the guard. The defender should fire back between incoming shots rather than just blocking — passive defense loses rounds on scorecards.`,
  },
  {
    id: 'fk_lateral_movement',
    namespace: 'style_drill_library',
    text: `Lateral movement (circling) is more effective than linear retreating. A fighter who only moves backward gets trapped against the ropes/cage. Circling toward the opponent's weak side (away from their power hand) limits their offense. When analysis shows one fighter with more foot speed and angular movement, they're likely controlling the ring/cage. The stationary fighter needs to cut off the ring by stepping at angles rather than chasing.`,
  },
  {
    id: 'fk_feint_recognition',
    namespace: 'style_drill_library',
    text: `Feints are deceptive movements that draw a reaction without committing. A hand burst followed immediately by a return to guard (no impact) suggests feinting activity. When one fighter consistently feints and the other reacts (flinches, shells up, backs away), the feinting fighter is establishing psychological control. The reactive fighter should stand ground and only respond to fully committed attacks.`,
  },
]

let seeded = false
let seedPromise: Promise<void> | null = null

async function embedWithRetry(
  texts: string[],
  maxRetries = 3
): Promise<number[] | number[][]> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await embedText(texts, { taskType: 'RETRIEVAL_DOCUMENT' })
    } catch (e) {
      lastErr = e
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`[FightLang] Embed attempt ${attempt}/${maxRetries} failed: ${msg}`)
      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)))
      }
    }
  }
  throw lastErr
}

export async function seedFightKnowledge(store: RetrievalStore): Promise<void> {
  if (seeded) return
  if (seedPromise) return seedPromise

  seedPromise = (async () => {
    try {
      const texts = FIGHT_KNOWLEDGE.map((k) => k.text)
      // Batch in groups of 4 to avoid hitting request size limits
      const BATCH_SIZE = 4
      const allVecs: number[][] = []
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE)
        const result = await embedWithRetry(batch)
        if (batch.length === 1) {
          allVecs.push(result as number[])
        } else {
          allVecs.push(...(result as number[][]))
        }
      }

      const model = (process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-2-preview') as string

      for (let i = 0; i < FIGHT_KNOWLEDGE.length; i++) {
        const k = FIGHT_KNOWLEDGE[i]!
        const vec = allVecs[i]
        if (!vec || !Array.isArray(vec)) continue
        await store.upsert({
          id: k.id,
          namespace: k.namespace,
          text: k.text,
          embedding: vec,
          embeddingModel: model,
        })
      }
      seeded = true
      console.log(`[FightLang] Seeded ${FIGHT_KNOWLEDGE.length} fight knowledge docs (${allVecs.length} vectors, dim=${allVecs[0]?.length ?? 0}) into retrieval store.`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[FightLang] Failed to seed fight knowledge:', msg)
      // Allow retry on next request
      seeded = false
      seedPromise = null
    }
  })()

  return seedPromise
}
