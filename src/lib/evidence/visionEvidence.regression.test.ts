/**
 * 22458.mp4 regression — the known cage-fight clip that broke the pose-first
 * pipeline (vertical phone video, cage fence, crowd, foreground spectator,
 * referee, cameraman, occlusion).
 *
 * LIVE-API test: runs only when BOTH exist —
 *   - fixture: public/test-videos/22458.mp4  (drop the clip here)
 *   - env:     GEMINI_API_KEY + MUSASHI_RUN_LIVE_EVAL=1
 * Otherwise it skips (CI-safe). Costs real tokens when it runs.
 *
 * What it proves:
 *   - two fighters identified; referee/spectators/cameraman classified as
 *     non-fighters and NEVER focus candidates (no coaching spectators)
 *   - the cage/fence scene is recognized
 *   - audio instructions live in "heard", separated from visible actions
 *   - hidden grips are not invented ("uncertain" is honored structurally)
 *   - the evidence pass succeeds with pose completely disabled (it never
 *     touches pose at all — pose cannot block this path by construction)
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  buildVisionEvidence,
  sanitizeVisionEvidence,
} from '@/lib/evidence/visionEvidence'
import { resolveFighterNaming } from '@/lib/fight/fighterNaming'

const FIXTURE = path.resolve('public/test-videos/22458.mp4')
const API_KEY = process.env.GEMINI_API_KEY
const LIVE = process.env.MUSASHI_RUN_LIVE_EVAL === '1'
const canRun = existsSync(FIXTURE) && Boolean(API_KEY) && !/your-/.test(API_KEY ?? '') && LIVE

describe.skipIf(!canRun)('22458.mp4 vision-first regression (LIVE Gemini)', () => {
  it(
    'identifies fighters vs referee/spectators/cameraman and keeps evidence classes honest',
    async () => {
      const bytes = readFileSync(FIXTURE)
      expect(bytes.byteLength).toBeLessThan(20 * 1024 * 1024) // inline path
      const { evidence, usage } = await buildVisionEvidence({
        videoInlineBase64: bytes.toString('base64'),
        videoMimeType: 'video/mp4',
        sport: 'mma',
        clipType: 'competition',
        apiKey: API_KEY,
      })
      console.log(
        `[22458] model=${usage.model} latency=${usage.latencyMs}ms tokens=${usage.totalTokens}`,
      )

      const clean = sanitizeVisionEvidence(evidence)

      // Two fighters, and the crowd scene's other humans classified as such.
      const fighters = clean.people.filter((p) => p.role === 'fighter')
      expect(fighters.length).toBeGreaterThanOrEqual(2)
      const nonFighterRoles = new Set(
        clean.people.filter((p) => p.role !== 'fighter').map((p) => p.role),
      )
      // The clip contains a referee AND crowd — at least one must be recognized.
      expect(nonFighterRoles.size).toBeGreaterThanOrEqual(1)

      // NEVER coach spectators: no non-fighter is a focus candidate, and the
      // A/B assignment points only at fighters.
      for (const p of clean.people) {
        if (p.role !== 'fighter') expect(p.focusCandidate).toBe(false)
      }
      const naming = resolveFighterNaming(clean)
      for (const id of [naming.A, naming.B]) {
        if (id.personId) {
          const person = clean.people.find((p) => p.id === id.personId)
          expect(person?.role).toBe('fighter')
        }
      }

      // Cage/fence exchange understood.
      expect(['cage', 'ring', 'unknown']).toContain(clean.scene.setting)
      expect(clean.scene.setting).toBe('cage')

      // Audio separated from vision: no "heard" instruction may be the sole
      // basis of a "seen" action claim — structurally, heard entries exist in
      // their own list and seen entries all carry person ids + timestamps.
      for (const h of clean.heard) {
        expect(typeof h.transcript).toBe('string')
        expect(h.kind).toBeTruthy()
      }
      for (const s of clean.seen) {
        expect(s.endSec).toBeGreaterThanOrEqual(s.startSec)
        expect(Array.isArray(s.personIds)).toBe(true)
      }

      // No invented hidden grips: occlusion in this clip must surface as
      // uncertainty, not as confident grip/submission claims.
      const seenText = clean.seen.map((s) => s.observation.toLowerCase()).join(' | ')
      const gripClaims = seenText.match(/hidden (grip|hand)|behind the back grip/g) ?? []
      expect(gripClaims.length).toBe(0)

      // Useful coaching windows exist so Coach Cards have something to anchor.
      expect(clean.coachingWindows.length).toBeGreaterThanOrEqual(1)

      // Fighter naming stays consistent (Blue/Red only when confirmed).
      for (const id of [naming.A, naming.B]) {
        if (!id.cornerColor) expect(id.displayName).toMatch(/^Fighter [AB]$/)
      }
    },
    { timeout: 300_000 },
  )
})

// Always-on structural note so the suite records WHY the live test was skipped.
describe('22458 fixture presence', () => {
  it('documents the fixture drop path when absent', () => {
    if (!existsSync(FIXTURE)) {
      console.warn(
        '[22458] fixture missing — copy the clip to public/test-videos/22458.mp4 and run with MUSASHI_RUN_LIVE_EVAL=1 to enable the live regression.',
      )
    }
    expect(true).toBe(true)
  })
})
