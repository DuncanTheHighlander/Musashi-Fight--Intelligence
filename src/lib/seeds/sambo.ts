import type { DisciplineSeedData, CatSeed, EntrySeed, SeqSeed, CounterSeed } from '../taxonomySeed'

const id = (name: string) => `sambo_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '')}`

export function getSamboData(): DisciplineSeedData {
  const categories: CatSeed[] = [
    { id: 'sambo_cat_throws', discipline: 'sambo', name: 'Throws', parentId: null, description: 'Judo-style throws adapted for sambo jacket', sortOrder: 1 },
    { id: 'sambo_cat_takedowns', discipline: 'sambo', name: 'Takedowns', parentId: null, description: 'Wrestling-style takedowns', sortOrder: 2 },
    { id: 'sambo_cat_leglocks', discipline: 'sambo', name: 'Leg Locks', parentId: null, description: 'Sambo specialty — leg submissions', sortOrder: 3 },
    { id: 'sambo_cat_ground', discipline: 'sambo', name: 'Ground Control', parentId: null, description: 'Pins and ground transitions', sortOrder: 4 },
  ]

  const entries: EntrySeed[] = [
    {
      id: id('jacket_throw'), categoryId: 'sambo_cat_throws', discipline: 'sambo', name: 'Kurtka Throw (Jacket Throw)',
      japaneseName: null, koreanName: null,
      description: 'Throw using the sambo jacket (kurtka) for grips. Similar to judo throws but adapted for the shorter sambo jacket and belt.',
      keyPoints: ['Grip the kurtka sleeve and belt', 'Break balance forward or backward', 'Turn in and throw', 'Follow to ground for control'],
      commonMistakes: ['Grip too high on jacket', 'Not breaking balance first', 'Not following to ground'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['throw', 'jacket', 'kurtka', 'fundamental'], metadata: {}, effectivenessScore: 0.85,
    },
    {
      id: id('hip_throw'), categoryId: 'sambo_cat_throws', discipline: 'sambo', name: 'Sambo Hip Throw',
      japaneseName: null, koreanName: null,
      description: 'Hip throw adapted for sambo. Use jacket grips to load opponent on hip and throw. Transition immediately to ground.',
      keyPoints: ['Secure jacket grips', 'Turn in and load on hip', 'Throw with rotation', 'Immediately transition to ground control'],
      commonMistakes: ['Not loading on hip', 'Slow transition to ground', 'Opponent takes back'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['throw', 'hip-throw', 'transition'], metadata: {}, effectivenessScore: 0.86,
    },
    {
      id: id('leg_trip'), categoryId: 'sambo_cat_takedowns', discipline: 'sambo', name: 'Leg Trip (Podnozhka)',
      japaneseName: null, koreanName: null,
      description: 'Trip opponents leg while controlling their upper body. Multiple variations: front, back, and side trips.',
      keyPoints: ['Control upper body with grips', 'Place leg behind theirs', 'Drive them over your leg', 'Follow to ground'],
      commonMistakes: ['No upper body control', 'Leg placement wrong', 'Not driving through'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['takedown', 'trip', 'fundamental'], metadata: {}, effectivenessScore: 0.83,
    },
    {
      id: id('single_leg'), categoryId: 'sambo_cat_takedowns', discipline: 'sambo', name: 'Sambo Single Leg',
      japaneseName: null, koreanName: null,
      description: 'Single leg takedown adapted for sambo. Use jacket grips to set up the shot. Finish with trip or lift.',
      keyPoints: ['Use jacket grip to control', 'Level change and grab leg', 'Finish with trip or lift', 'Transition to leg lock or pin'],
      commonMistakes: ['No jacket grip setup', 'Head position wrong', 'Not transitioning after takedown'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['takedown', 'single-leg', 'fundamental'], metadata: {}, effectivenessScore: 0.87,
    },
    {
      id: id('knee_bar'), categoryId: 'sambo_cat_leglocks', discipline: 'sambo', name: 'Sambo Knee Bar',
      japaneseName: null, koreanName: null,
      description: 'Knee bar — sambo specialty. Hyperextend the knee joint. Often entered from scrambles or after takedowns.',
      keyPoints: ['Control the foot/ankle', 'Pinch knees around their leg', 'Hips tight against knee', 'Extend hips to finish'],
      commonMistakes: ['Not controlling foot', 'Knees too wide', 'Opponent pulls free'],
      difficulty: 'intermediate', positionContext: 'leg_entanglement', videoUrl: null, thumbnailUrl: null,
      tags: ['submission', 'knee-bar', 'leg-lock', 'specialty'], metadata: {}, effectivenessScore: 0.9,
    },
    {
      id: id('ankle_lock'), categoryId: 'sambo_cat_leglocks', discipline: 'sambo', name: 'Sambo Ankle Lock',
      japaneseName: null, koreanName: null,
      description: 'Straight ankle lock. Wrap arm around ankle, blade of wrist on Achilles, arch back. Legal at all levels in sambo.',
      keyPoints: ['Wrist blade on Achilles', 'Pinch knees around leg', 'Arch back to finish', 'Control hip with legs'],
      commonMistakes: ['Wrist not on Achilles', 'Not controlling hip', 'Opponent pulls free'],
      difficulty: 'beginner', positionContext: 'leg_entanglement', videoUrl: null, thumbnailUrl: null,
      tags: ['submission', 'ankle-lock', 'leg-lock', 'fundamental'], metadata: {}, effectivenessScore: 0.82,
    },
    {
      id: id('toe_hold'), categoryId: 'sambo_cat_leglocks', discipline: 'sambo', name: 'Toe Hold',
      japaneseName: null, koreanName: null,
      description: 'Grab the foot and twist, attacking the ankle and knee. Legal in sport sambo. Effective from many positions.',
      keyPoints: ['Grab the foot with figure-four grip', 'Twist toward their outside', 'Control their hip', 'Slow steady pressure'],
      commonMistakes: ['Grip too loose', 'Twisting wrong direction', 'No hip control'],
      difficulty: 'intermediate', positionContext: 'leg_entanglement', videoUrl: null, thumbnailUrl: null,
      tags: ['submission', 'toe-hold', 'leg-lock'], metadata: {}, effectivenessScore: 0.8,
    },
    {
      id: id('calf_slicer'), categoryId: 'sambo_cat_leglocks', discipline: 'sambo', name: 'Calf Slicer (Calf Crush)',
      japaneseName: null, koreanName: null,
      description: 'Compress the calf muscle against the shin bone using your shin as a fulcrum. Extremely painful.',
      keyPoints: ['Place shin behind their knee', 'Fold their leg over your shin', 'Pull their foot toward you', 'Squeeze and extend'],
      commonMistakes: ['Shin not positioned correctly', 'Not folding the leg enough', 'Opponent straightens leg'],
      difficulty: 'advanced', positionContext: 'leg_entanglement', videoUrl: null, thumbnailUrl: null,
      tags: ['submission', 'calf-slicer', 'leg-lock', 'compression'], metadata: {}, effectivenessScore: 0.78,
    },
    {
      id: id('arm_lock'), categoryId: 'sambo_cat_ground', discipline: 'sambo', name: 'Sambo Armbar',
      japaneseName: null, koreanName: null,
      description: 'Armbar from sambo. Often entered directly from throws. Quick transition from standing to submission.',
      keyPoints: ['Transition from throw to armbar', 'Control the arm', 'Pinch knees', 'Extend hips'],
      commonMistakes: ['Slow transition', 'Losing arm control', 'Opponent escapes during transition'],
      difficulty: 'intermediate', positionContext: 'ground_top', videoUrl: null, thumbnailUrl: null,
      tags: ['submission', 'armbar', 'transition', 'ground'], metadata: {}, effectivenessScore: 0.88,
    },
    {
      id: id('pin_control'), categoryId: 'sambo_cat_ground', discipline: 'sambo', name: 'Sambo Pin (Hold Down)',
      japaneseName: null, koreanName: null,
      description: 'Pin opponent on their back for points. Similar to judo pins but with sambo-specific grips using the kurtka.',
      keyPoints: ['Chest pressure', 'Control with jacket grips', 'Spread base wide', 'Transition to submission if they escape'],
      commonMistakes: ['Not enough pressure', 'Base too narrow', 'Not transitioning when they move'],
      difficulty: 'beginner', positionContext: 'ground_top', videoUrl: null, thumbnailUrl: null,
      tags: ['pin', 'control', 'ground', 'fundamental'], metadata: {}, effectivenessScore: 0.8,
    },
  ]

  const sequences: SeqSeed[] = [
    {
      id: 'sambo_seq_throw_leglock', discipline: 'sambo', name: 'Throw to Leg Lock', description: 'Classic sambo sequence: throw then immediately attack legs.',
      steps: [
        { techniqueId: id('hip_throw'), notes: 'Throw opponent', transitionCue: 'Immediately grab their leg' },
        { techniqueId: id('knee_bar'), notes: 'Transition to knee bar', transitionCue: 'Finish' },
      ],
      difficulty: 'intermediate', tags: ['chain', 'throw-to-submission', 'specialty'],
    },
    {
      id: 'sambo_seq_trip_ankle', discipline: 'sambo', name: 'Leg Trip to Ankle Lock', description: 'Trip then attack the ankle.',
      steps: [
        { techniqueId: id('leg_trip'), notes: 'Trip them to ground', transitionCue: 'Control their leg' },
        { techniqueId: id('ankle_lock'), notes: 'Straight ankle lock', transitionCue: 'Finish' },
      ],
      difficulty: 'beginner', tags: ['chain', 'takedown-to-submission'],
    },
    {
      id: 'sambo_seq_scramble_leglock', discipline: 'sambo', name: 'Scramble to Leg Lock Chain', description: 'Attack legs during scrambles.',
      steps: [
        { techniqueId: id('ankle_lock'), notes: 'Attack ankle lock', transitionCue: 'If they defend, switch' },
        { techniqueId: id('knee_bar'), notes: 'Switch to knee bar', transitionCue: 'If they defend, switch' },
        { techniqueId: id('toe_hold'), notes: 'Switch to toe hold', transitionCue: 'Finish' },
      ],
      difficulty: 'advanced', tags: ['chain', 'leg-lock-chain', 'scramble'],
    },
  ]

  const counters: CounterSeed[] = [
    { id: 'sambo_ctr_1', techniqueId: id('knee_bar'), counterTechniqueId: id('ankle_lock'), effectiveness: 'medium', notes: 'Counter-attack their leg while defending' },
    { id: 'sambo_ctr_2', techniqueId: id('ankle_lock'), counterTechniqueId: id('knee_bar'), effectiveness: 'medium', notes: 'Roll and attack their knee' },
    { id: 'sambo_ctr_3', techniqueId: id('hip_throw'), counterTechniqueId: id('leg_trip'), effectiveness: 'high', notes: 'Block the throw and counter-trip' },
    { id: 'sambo_ctr_4', techniqueId: id('single_leg'), counterTechniqueId: id('knee_bar'), effectiveness: 'high', notes: 'Sprawl and attack their leg' },
  ]

  return { categories, entries, sequences, counters }
}
