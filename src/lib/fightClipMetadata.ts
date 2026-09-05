export type FightClipAiMetadata = {
  discipline?: string
  sport?: string
  clipType?: string
}

export type FightClipOption = {
  value: string
  label: string
  hint: string
}

/**
 * Sport picker options. Values route through the coach-brain sport router
 * (src/lib/coachBrain/coachBrain.ts) AND the legacy discipline prompts, so
 * they must stay alias-compatible with both.
 */
export const SPORT_OPTIONS: FightClipOption[] = [
  { value: 'boxing', label: 'Boxing', hint: 'Hands, angles, ring craft' },
  { value: 'kickboxing', label: 'Kickboxing', hint: 'Kicks + hands, checks' },
  { value: 'muay_thai', label: 'Muay Thai', hint: '8 limbs, clinch, teeps' },
  { value: 'mma', label: 'MMA', hint: 'Transitions, cage, all ranges' },
  { value: 'wrestling', label: 'Wrestling', hint: 'Shots, sprawls, rides' },
  { value: 'bjj', label: 'BJJ / Grappling', hint: 'Position, frames, subs' },
  { value: 'judo', label: 'Judo', hint: 'Grips, throws, transitions' },
  { value: 'karate', label: 'Karate', hint: 'Distance, blitz, point craft' },
  { value: 'taekwondo', label: 'Taekwondo', hint: 'Leg fencing, cut kicks' },
  { value: 'fencing', label: 'Fencing', hint: 'Measure, tempo, priority' },
]

export const CLIP_TYPE_OPTIONS: FightClipOption[] = [
  { value: 'sparring', label: 'Sparring', hint: 'Live partner rounds' },
  { value: 'competition', label: 'Competition', hint: 'Bout, match, tournament' },
  { value: 'bag_work', label: 'Bag work', hint: 'Heavy bag or solo striking' },
  { value: 'pad_work', label: 'Pad work', hint: 'Coach-held mitts or pads' },
  { value: 'drilling', label: 'Drilling', hint: 'Reps, flow, positional work' },
  { value: 'rolling_grappling', label: 'Rolling / grappling', hint: 'Ground or clinch rounds' },
  { value: 'striking_exchange', label: 'Striking exchange', hint: 'Entry, counters, exit' },
  { value: 'takedown', label: 'Takedown', hint: 'Setup, shot, finish, defense' },
  { value: 'guard_passing', label: 'Guard passing', hint: 'Frames, knee line, control' },
  { value: 'submission', label: 'Submission', hint: 'Control, attack, defense' },
]

export function sportLabelFor(value: string): string {
  return SPORT_OPTIONS.find((s) => s.value === value)?.label ?? 'Auto-detect'
}

export function clipTypeLabelFor(value: string): string {
  return CLIP_TYPE_OPTIONS.find((t) => t.value === value)?.label ?? 'Clip context'
}

export function buildFightClipAiMetadata(args: {
  sport?: string | null
  clipType?: string | null
}): FightClipAiMetadata {
  const sport = String(args.sport || '').trim()
  const clipType = String(args.clipType || '').trim()
  return {
    ...(sport ? { discipline: sport, sport } : {}),
    ...(clipType ? { clipType } : {}),
  }
}
