/**
 * Vision-first rollout flag.
 *
 * Server: MUSASHI_VISION_FIRST_ENABLED=1
 * Client bundle: NEXT_PUBLIC_MUSASHI_VISION_FIRST_ENABLED=1
 *   (Next.js only inlines NEXT_PUBLIC_* into client code, so the flag has two
 *   spellings; set BOTH when enabling. Server code checks both so a single
 *   NEXT_PUBLIC value also works in local dev.)
 *
 * OFF (default): the pre-rebuild pipeline runs unchanged — full rollback path.
 * ON: Gemini vision is the primary fight-understanding source for every sport:
 *   one full-video evidence pass, coaching from evidence JSON (no video
 *   re-send), no pose gates over Coach Cards.
 */

function flagOn(value: string | undefined): boolean {
  return value === '1' || value === 'true'
}

/** Server-side check (API routes, lib code). */
export function visionFirstEnabled(): boolean {
  return (
    flagOn(process.env.MUSASHI_VISION_FIRST_ENABLED) ||
    flagOn(process.env.NEXT_PUBLIC_MUSASHI_VISION_FIRST_ENABLED)
  )
}

/** Client-side check (components). Only the NEXT_PUBLIC spelling is inlined. */
export function visionFirstClientEnabled(): boolean {
  return flagOn(process.env.NEXT_PUBLIC_MUSASHI_VISION_FIRST_ENABLED)
}
