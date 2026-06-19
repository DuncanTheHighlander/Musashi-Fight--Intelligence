import type { DisciplineSeedData, CatSeed, EntrySeed, SeqSeed, CounterSeed } from '../taxonomySeed'

const id = (name: string) => `sumo_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '')}`

export function getSumoData(): DisciplineSeedData {
  const categories: CatSeed[] = [
    { id: 'sumo_cat_tachiai', discipline: 'sumo', name: 'Tachi-ai (Initial Charge)', parentId: null, description: 'Opening charge techniques', sortOrder: 1 },
    { id: 'sumo_cat_oshi', discipline: 'sumo', name: 'Oshi/Tsuki (Pushing/Thrusting)', parentId: null, description: 'Push and thrust techniques', sortOrder: 2 },
    { id: 'sumo_cat_yotsu', discipline: 'sumo', name: 'Yotsu-zumo (Belt Wrestling)', parentId: null, description: 'Grip fighting and belt techniques', sortOrder: 3 },
    { id: 'sumo_cat_kimarite', discipline: 'sumo', name: 'Kimarite (Winning Techniques)', parentId: null, description: 'Official winning moves', sortOrder: 4 },
  ]

  const entries: EntrySeed[] = [
    {
      id: id('tachiai'), categoryId: 'sumo_cat_tachiai', discipline: 'sumo', name: 'Tachi-ai (Initial Charge)',
      japaneseName: 'Tachi-ai', koreanName: null,
      description: 'The explosive initial charge at the start of a bout. Low, powerful, and decisive. Winning the tachi-ai often determines the match.',
      keyPoints: ['Get lower than opponent', 'Explosive forward drive', 'Hands strike chest/throat', 'Win inside position'],
      commonMistakes: ['Standing too high', 'Slow reaction', 'False start (matta)', 'Not committing'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['tachi-ai', 'charge', 'fundamental', 'opening'], metadata: {}, effectivenessScore: 0.92,
    },
    {
      id: id('oshi_dashi'), categoryId: 'sumo_cat_oshi', discipline: 'sumo', name: 'Oshi-dashi (Push Out)',
      japaneseName: 'Oshi-dashi', koreanName: null,
      description: 'Push opponent out of the ring using open-hand thrusts to the chest. Most common winning technique.',
      keyPoints: ['Low center of gravity', 'Drive forward with legs', 'Open-hand thrusts to chest', 'Keep pushing until they are out'],
      commonMistakes: ['Standing too high', 'Pushing with arms only', 'Letting them get belt grip'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['push', 'oshi', 'fundamental', 'kimarite'], metadata: {}, effectivenessScore: 0.88,
    },
    {
      id: id('tsuki_dashi'), categoryId: 'sumo_cat_oshi', discipline: 'sumo', name: 'Tsuki-dashi (Thrust Out)',
      japaneseName: 'Tsuki-dashi', koreanName: null,
      description: 'Thrust opponent out with rapid open-hand strikes to face and chest. More aggressive than oshi-dashi.',
      keyPoints: ['Rapid thrusting strikes', 'Target face and upper chest', 'Keep opponent off balance', 'Drive them backward'],
      commonMistakes: ['Overextending', 'Opponent gets inside', 'Losing balance'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['thrust', 'tsuki', 'aggressive', 'kimarite'], metadata: {}, effectivenessScore: 0.85,
    },
    {
      id: id('yori_kiri'), categoryId: 'sumo_cat_yotsu', discipline: 'sumo', name: 'Yori-kiri (Force Out)',
      japaneseName: 'Yori-kiri', koreanName: null,
      description: 'Force opponent out while maintaining belt grip. Second most common winning technique. Requires strong grip and forward drive.',
      keyPoints: ['Secure mawashi (belt) grip', 'Chest-to-chest pressure', 'Drive forward with legs', 'Dont let them break grip'],
      commonMistakes: ['Grip too loose', 'Not enough forward drive', 'Opponent breaks grip'],
      difficulty: 'beginner', positionContext: 'clinch', videoUrl: null, thumbnailUrl: null,
      tags: ['belt', 'yotsu', 'force-out', 'fundamental', 'kimarite'], metadata: {}, effectivenessScore: 0.9,
    },
    {
      id: id('uwate_nage'), categoryId: 'sumo_cat_kimarite', discipline: 'sumo', name: 'Uwate-nage (Overarm Throw)',
      japaneseName: 'Uwate-nage', koreanName: null,
      description: 'Throw using an overarm belt grip. Rotate and throw opponent using the outside grip on their mawashi.',
      keyPoints: ['Secure overarm belt grip', 'Pull and rotate', 'Use hip as fulcrum', 'Follow through with throw'],
      commonMistakes: ['Grip not deep enough', 'Not using hips', 'Opponent counters with inside grip'],
      difficulty: 'intermediate', positionContext: 'clinch', videoUrl: null, thumbnailUrl: null,
      tags: ['throw', 'overarm', 'belt', 'kimarite'], metadata: {}, effectivenessScore: 0.85,
    },
    {
      id: id('shitate_nage'), categoryId: 'sumo_cat_kimarite', discipline: 'sumo', name: 'Shitate-nage (Underarm Throw)',
      japaneseName: 'Shitate-nage', koreanName: null,
      description: 'Throw using an underarm belt grip. Inside grip throw. Generally considered stronger position than overarm.',
      keyPoints: ['Secure underarm belt grip', 'Pull and rotate', 'Inside position advantage', 'Drive through the throw'],
      commonMistakes: ['Grip too shallow', 'Not rotating enough', 'Opponent blocks with overarm'],
      difficulty: 'intermediate', positionContext: 'clinch', videoUrl: null, thumbnailUrl: null,
      tags: ['throw', 'underarm', 'belt', 'kimarite', 'inside-position'], metadata: {}, effectivenessScore: 0.87,
    },
    {
      id: id('hataki_komi'), categoryId: 'sumo_cat_kimarite', discipline: 'sumo', name: 'Hataki-komi (Slap Down)',
      japaneseName: 'Hataki-komi', koreanName: null,
      description: 'Slap opponent down to the ground by pulling their head/shoulder down. Often used as a counter to an aggressive charge.',
      keyPoints: ['Time it on their forward charge', 'Slap down on head or shoulder', 'Step to the side', 'Let their momentum carry them down'],
      commonMistakes: ['Attempting without their forward momentum', 'Not stepping aside', 'Opponent recovers'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['slap-down', 'counter', 'kimarite', 'timing'], metadata: {}, effectivenessScore: 0.78,
    },
    {
      id: id('henka'), categoryId: 'sumo_cat_tachiai', discipline: 'sumo', name: 'Henka (Side Step)',
      japaneseName: 'Henka', koreanName: null,
      description: 'Side-stepping at the tachi-ai to let opponent charge past. Considered unsportsmanlike but effective. Often combined with slap-down.',
      keyPoints: ['Step to the side at tachi-ai', 'Let opponent charge past', 'Slap down or push from side', 'Timing is critical'],
      commonMistakes: ['Moving too early (opponent adjusts)', 'Not following up', 'Considered dishonorable'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['sidestep', 'henka', 'tachi-ai', 'controversial'], metadata: {}, effectivenessScore: 0.7,
    },
    {
      id: id('mawashi_grip'), categoryId: 'sumo_cat_yotsu', discipline: 'sumo', name: 'Mawashi Grip Fighting',
      japaneseName: null, koreanName: null,
      description: 'Fighting for belt grips. Inside grip (shitate) vs outside grip (uwate). Grip position determines available techniques.',
      keyPoints: ['Fight for inside position', 'Deep grip on mawashi', 'Deny opponent their preferred grip', 'Use grip to control their movement'],
      commonMistakes: ['Passive gripping', 'Letting opponent get preferred grip', 'Not using grip offensively'],
      difficulty: 'intermediate', positionContext: 'clinch', videoUrl: null, thumbnailUrl: null,
      tags: ['grip', 'mawashi', 'belt', 'control', 'fundamental'], metadata: {}, effectivenessScore: 0.85,
    },
  ]

  const sequences: SeqSeed[] = [
    {
      id: 'sumo_seq_tachiai_oshi', discipline: 'sumo', name: 'Tachi-ai to Oshi-dashi', description: 'Win the charge and push out.',
      steps: [
        { techniqueId: id('tachiai'), notes: 'Win the initial charge', transitionCue: 'Drive forward' },
        { techniqueId: id('oshi_dashi'), notes: 'Push them out of the ring', transitionCue: 'Win' },
      ],
      difficulty: 'beginner', tags: ['fundamental', 'push'],
    },
    {
      id: 'sumo_seq_tachiai_yori', discipline: 'sumo', name: 'Tachi-ai to Belt Grip to Yori-kiri', description: 'Charge, secure belt, force out.',
      steps: [
        { techniqueId: id('tachiai'), notes: 'Win the charge', transitionCue: 'Secure belt grip' },
        { techniqueId: id('mawashi_grip'), notes: 'Fight for inside belt grip', transitionCue: 'Drive forward' },
        { techniqueId: id('yori_kiri'), notes: 'Force them out with belt grip', transitionCue: 'Win' },
      ],
      difficulty: 'intermediate', tags: ['belt', 'force-out', 'complete'],
    },
  ]

  const counters: CounterSeed[] = [
    { id: 'sumo_ctr_1', techniqueId: id('oshi_dashi'), counterTechniqueId: id('hataki_komi'), effectiveness: 'high', notes: 'Slap down as they push forward' },
    { id: 'sumo_ctr_2', techniqueId: id('tachiai'), counterTechniqueId: id('henka'), effectiveness: 'high', notes: 'Side-step their charge' },
    { id: 'sumo_ctr_3', techniqueId: id('yori_kiri'), counterTechniqueId: id('uwate_nage'), effectiveness: 'medium', notes: 'Counter with overarm throw as they drive' },
    { id: 'sumo_ctr_4', techniqueId: id('uwate_nage'), counterTechniqueId: id('shitate_nage'), effectiveness: 'high', notes: 'Inside grip throw beats outside grip' },
    { id: 'sumo_ctr_5', techniqueId: id('tsuki_dashi'), counterTechniqueId: id('hataki_komi'), effectiveness: 'high', notes: 'Slap down as they thrust forward' },
  ]

  return { categories, entries, sequences, counters }
}
