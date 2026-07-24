/**
 * Fighter naming — the ONE mapping between tracker actors (A/B), corner
 * colors (Blue/Red), and screen positions (left/right).
 *
 * Rules (vision-first rebuild):
 *   - Internal actor ids are always 'A' | 'B'.
 *   - "Blue"/"Red" display names are used ONLY when the vision evidence
 *     visually confirmed corner colors. Otherwise "Fighter A"/"Fighter B".
 *   - Screen position (left/right) is a descriptor, never an identity.
 *   - A referee, spectator, coach, or cameraman can never be a focus fighter
 *     (enforced upstream by sanitizeVisionEvidence; re-checked here).
 *   - When assignment confidence is low, the UI must ask the user to tap
 *     their fighter once (`needsIdentityConfirmation`).
 */

import type { VisionEvidence, VisionPerson } from '@/lib/evidence/visionEvidence'

export type ActorId = 'A' | 'B'

/** Below this assignment confidence the UI asks the user to confirm by tap. */
export const IDENTITY_CONFIRMATION_THRESHOLD = 0.6

export type FighterIdentity = {
  actorId: ActorId
  /** Person id in the vision evidence, when assigned. */
  personId: string | null
  /** Display name: "Blue" / "Red" only when confirmed; else "Fighter A"/"Fighter B". */
  displayName: string
  /** Visible-traits description from the evidence ("tall fighter in black shorts"). */
  description: string | null
  /** Dominant screen position — a descriptor, never an identity. */
  screenPosition: string | null
  cornerColor: 'blue' | 'red' | null
  confidence: number
}

export type FighterNaming = {
  A: FighterIdentity
  B: FighterIdentity
  /** True when the user should be shown a frame and asked to tap their fighter. */
  needsIdentityConfirmation: boolean
  /** Why confirmation is needed (for UI copy / logs). */
  confirmationReason: string | null
}

function personById(evidence: VisionEvidence, id: string | null): VisionPerson | null {
  if (!id) return null
  const p = evidence.people.find((x) => x.id === id)
  // Defense in depth: only a fighter may back an actor identity.
  return p && p.role === 'fighter' ? p : null
}

function identityFor(
  actorId: ActorId,
  evidence: VisionEvidence | null,
): FighterIdentity {
  const fallback: FighterIdentity = {
    actorId,
    personId: null,
    displayName: `Fighter ${actorId}`,
    description: null,
    screenPosition: null,
    cornerColor: null,
    confidence: 0,
  }
  if (!evidence) return fallback

  const assignment = evidence.fighterAssignment
  const personId = actorId === 'A' ? assignment.fighterA_personId : assignment.fighterB_personId
  const person = personById(evidence, personId)
  if (!person) return fallback

  const rawCorner = assignment.cornerColors?.[actorId]
  const cornerColor = rawCorner === 'blue' || rawCorner === 'red' ? rawCorner : null
  return {
    actorId,
    personId: person.id,
    // Blue/Red ONLY when visually confirmed by the evidence pass.
    displayName: cornerColor ? cornerColor[0].toUpperCase() + cornerColor.slice(1) : `Fighter ${actorId}`,
    description: person.description || null,
    screenPosition: person.screenPosition || null,
    cornerColor,
    confidence: Math.min(assignment.confidence ?? 0, person.confidence ?? 0),
  }
}

/** Resolve the unified naming for a clip from its vision evidence. */
export function resolveFighterNaming(evidence: VisionEvidence | null): FighterNaming {
  const A = identityFor('A', evidence)
  const B = identityFor('B', evidence)

  let confirmationReason: string | null = null
  if (!evidence) {
    confirmationReason = 'No vision evidence yet.'
  } else if (!A.personId || !B.personId) {
    confirmationReason = 'The evidence pass could not confidently identify two fighters.'
  } else if ((evidence.fighterAssignment.confidence ?? 0) < IDENTITY_CONFIRMATION_THRESHOLD) {
    confirmationReason = `Fighter assignment confidence ${evidence.fighterAssignment.confidence.toFixed(2)} is below ${IDENTITY_CONFIRMATION_THRESHOLD}.`
  }

  return {
    A,
    B,
    needsIdentityConfirmation: confirmationReason !== null,
    confirmationReason,
  }
}

/**
 * Normalize any legacy focus value (A/B/blue/red/both/unsure, any case) to the
 * internal actor vocabulary. Blue→A / Red→B is the app's fixed corner order
 * UNLESS evidence-confirmed colors say otherwise.
 */
export function normalizeFocusTarget(
  focus: string | null | undefined,
  naming?: FighterNaming | null,
): 'A' | 'B' | 'both' | 'unsure' {
  const f = String(focus ?? '').trim().toLowerCase()
  if (f === 'a') return 'A'
  if (f === 'b') return 'B'
  if (f === 'both') return 'both'
  if (f === 'blue' || f === 'red') {
    const wanted = f as 'blue' | 'red'
    if (naming) {
      if (naming.A.cornerColor === wanted) return 'A'
      if (naming.B.cornerColor === wanted) return 'B'
    }
    // Legacy fixed mapping (A=blue, B=red) when colors are unconfirmed.
    return wanted === 'blue' ? 'A' : 'B'
  }
  return 'unsure'
}

/** Short prompt block that pins the naming for coaching / chat. */
export function formatFighterNamingBlock(naming: FighterNaming): string {
  const line = (id: FighterIdentity) => {
    const bits = [
      `${id.displayName} (actorId "${id.actorId}")`,
      id.description ? `= ${id.description}` : null,
      id.screenPosition ? `mostly on the ${id.screenPosition} of the screen` : null,
      id.cornerColor ? `corner confirmed ${id.cornerColor}` : 'corner color NOT confirmed — never call them Blue/Red',
    ].filter(Boolean)
    return `- ${bits.join(', ')}`
  }
  return [
    'FIGHTER NAMING (unified — use these names EXACTLY):',
    line(naming.A),
    line(naming.B),
    '- Screen position describes where they stand, it is not an identity. Never rename fighters mid-answer.',
    '- Never coach or address the referee, spectators, coaches, or the camera operator.',
    ...(naming.needsIdentityConfirmation
      ? ['- Identity confidence is LOW: avoid strong identity claims; describe fighters by visible traits.']
      : []),
  ].join('\n')
}
