import type { DisciplineSeedData, CatSeed, EntrySeed, SeqSeed, CounterSeed } from '../taxonomySeed'

const id = (name: string) => `kb_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '')}`

export function getKickboxingData(): DisciplineSeedData {
  const categories: CatSeed[] = [
    { id: 'kb_cat_kicks', discipline: 'kickboxing', name: 'Kicks', parentId: null, description: 'All kicking techniques', sortOrder: 1 },
    { id: 'kb_cat_punches', discipline: 'kickboxing', name: 'Punches', parentId: null, description: 'Boxing techniques for kickboxing', sortOrder: 2 },
    { id: 'kb_cat_combos', discipline: 'kickboxing', name: 'Punch-Kick Combinations', parentId: null, description: 'Mixed striking combos', sortOrder: 3 },
    { id: 'kb_cat_defense', discipline: 'kickboxing', name: 'Defense', parentId: null, description: 'Kick defense and counters', sortOrder: 4 },
  ]

  const entries: EntrySeed[] = [
    {
      id: id('roundhouse_body'), categoryId: 'kb_cat_kicks', discipline: 'kickboxing', name: 'Body Roundhouse Kick',
      japaneseName: null, koreanName: null,
      description: 'Roundhouse kick targeting the ribs and midsection. Primary power kick in kickboxing. Can use shin or instep.',
      keyPoints: ['Chamber knee', 'Rotate hip over', 'Kick through the target', 'Retract or follow through'],
      commonMistakes: ['No hip rotation', 'Kicking with foot not shin', 'Telegraphing', 'Off balance'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['kick', 'roundhouse', 'body', 'power', 'fundamental'], metadata: { range: 'mid' }, effectivenessScore: 0.9,
    },
    {
      id: id('head_kick'), categoryId: 'kb_cat_kicks', discipline: 'kickboxing', name: 'Head Kick',
      japaneseName: null, koreanName: null,
      description: 'High roundhouse kick targeting the head. Fight-ending power. Set up with body kicks and punches.',
      keyPoints: ['Same mechanics as body kick but higher', 'Set up by going low first', 'Flexibility and timing', 'Commit fully'],
      commonMistakes: ['Telegraphing', 'Not setting up', 'Off balance', 'Too slow'],
      difficulty: 'advanced', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['kick', 'head-kick', 'power', 'knockout', 'finishing'], metadata: { range: 'mid' }, effectivenessScore: 0.93,
    },
    {
      id: id('low_kick'), categoryId: 'kb_cat_kicks', discipline: 'kickboxing', name: 'Low Kick',
      japaneseName: null, koreanName: null,
      description: 'Roundhouse to the thigh. Accumulative damage. Dutch kickboxing staple. Set up with punches.',
      keyPoints: ['Target outer thigh', 'Set up with punches', 'Angle slightly downward', 'Follow through'],
      commonMistakes: ['Not setting up', 'Kicking too low (knee)', 'Telegraphing'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['kick', 'low-kick', 'leg', 'attrition', 'dutch'], metadata: { range: 'mid' }, effectivenessScore: 0.88,
    },
    {
      id: id('front_kick'), categoryId: 'kb_cat_kicks', discipline: 'kickboxing', name: 'Front Kick (Teep)',
      japaneseName: null, koreanName: null,
      description: 'Push kick to control distance. Can be used offensively to the body or defensively to stop advances.',
      keyPoints: ['Chamber knee', 'Push through with hip', 'Ball of foot or flat foot', 'Retract quickly'],
      commonMistakes: ['Kicking instead of pushing', 'Not chambering', 'Off balance'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['kick', 'front-kick', 'teep', 'range-control'], metadata: { range: 'long' }, effectivenessScore: 0.82,
    },
    {
      id: id('side_kick'), categoryId: 'kb_cat_kicks', discipline: 'kickboxing', name: 'Side Kick',
      japaneseName: null, koreanName: null,
      description: 'Linear kick using blade of foot. Powerful stopping technique. Good for keeping aggressive fighters at bay.',
      keyPoints: ['Chamber across body', 'Thrust sideways', 'Blade of foot strikes', 'Lean away for balance'],
      commonMistakes: ['Using instep not blade', 'No lean', 'Telegraphing'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['kick', 'side-kick', 'power', 'linear'], metadata: { range: 'long' }, effectivenessScore: 0.8,
    },
    {
      id: id('spinning_back_kick'), categoryId: 'kb_cat_kicks', discipline: 'kickboxing', name: 'Spinning Back Kick',
      japaneseName: null, koreanName: null,
      description: 'Turn and thrust heel backward. Powerful counter technique. Can end fights instantly.',
      keyPoints: ['Spot target over shoulder', 'Thrust heel straight back', 'Full hip extension', 'Commit fully'],
      commonMistakes: ['Losing sight of target', 'Kicking sideways', 'Off balance'],
      difficulty: 'advanced', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['kick', 'spinning', 'back-kick', 'power', 'counter'], metadata: { range: 'mid' }, effectivenessScore: 0.87,
    },
    {
      id: id('switch_kick'), categoryId: 'kb_cat_kicks', discipline: 'kickboxing', name: 'Switch Kick',
      japaneseName: null, koreanName: null,
      description: 'Quick stance switch into a kick with the rear leg (now front). Deceptive and fast. Dutch kickboxing specialty.',
      keyPoints: ['Quick hop to switch stance', 'Kick immediately after switch', 'Deceptive — looks like front leg kick', 'Power of rear leg kick'],
      commonMistakes: ['Switch too slow', 'Telegraphing the switch', 'Off balance'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['kick', 'switch-kick', 'deceptive', 'dutch'], metadata: { range: 'mid' }, effectivenessScore: 0.85,
    },
    {
      id: id('check_low_kick'), categoryId: 'kb_cat_defense', discipline: 'kickboxing', name: 'Check Low Kick',
      japaneseName: null, koreanName: null,
      description: 'Lift shin to block incoming low kick. Shin-on-shin contact. Essential kickboxing defense.',
      keyPoints: ['Lift knee and turn shin out', 'Stay balanced', 'Hands stay up', 'Counter immediately after'],
      commonMistakes: ['Lifting too late', 'Not turning shin', 'Losing balance'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['defense', 'check', 'low-kick-defense', 'fundamental'], metadata: {}, effectivenessScore: 0.88,
    },
    {
      id: id('catch_and_sweep'), categoryId: 'kb_cat_defense', discipline: 'kickboxing', name: 'Catch Kick and Sweep',
      japaneseName: null, koreanName: null,
      description: 'Catch opponents kick and sweep their standing leg. Scores a knockdown in many rulesets.',
      keyPoints: ['Absorb then trap the kick', 'Step in close', 'Sweep their standing leg', 'Follow up immediately'],
      commonMistakes: ['Reaching for the kick', 'Not sweeping quickly', 'Off balance'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['defense', 'catch', 'sweep', 'counter'], metadata: {}, effectivenessScore: 0.82,
    },
  ]

  const sequences: SeqSeed[] = [
    {
      id: 'kb_seq_dutch_combo', discipline: 'kickboxing', name: 'Dutch Combo: Jab-Cross-Hook-Low Kick', description: 'Classic Dutch kickboxing combination.',
      steps: [
        { techniqueId: 'box_jab', notes: 'Jab to set range', transitionCue: 'Into cross' },
        { techniqueId: 'box_cross', notes: 'Cross to turn head', transitionCue: 'Into hook' },
        { techniqueId: 'box_lead_hook', notes: 'Hook to occupy guard', transitionCue: 'Into low kick' },
        { techniqueId: id('low_kick'), notes: 'Low kick while guard is high', transitionCue: 'Reset' },
      ],
      difficulty: 'intermediate', tags: ['combo', 'dutch', 'classic', 'hands-to-kick'],
    },
    {
      id: 'kb_seq_body_head_kick', discipline: 'kickboxing', name: 'Body Kick - Head Kick', description: 'Set up head kick with body kick.',
      steps: [
        { techniqueId: id('roundhouse_body'), notes: 'Body kick to lower guard', transitionCue: 'Same leg or switch' },
        { techniqueId: id('head_kick'), notes: 'Head kick as guard drops', transitionCue: 'Follow through' },
      ],
      difficulty: 'advanced', tags: ['combo', 'kicks', 'setup', 'knockout'],
    },
    {
      id: 'kb_seq_jab_switch_kick', discipline: 'kickboxing', name: 'Jab - Switch Kick', description: 'Use jab to set up deceptive switch kick.',
      steps: [
        { techniqueId: 'box_jab', notes: 'Jab to occupy their vision', transitionCue: 'Quick switch' },
        { techniqueId: id('switch_kick'), notes: 'Switch kick to body', transitionCue: 'Reset' },
      ],
      difficulty: 'intermediate', tags: ['combo', 'deceptive', 'switch'],
    },
  ]

  const counters: CounterSeed[] = [
    { id: 'kb_ctr_1', techniqueId: id('roundhouse_body'), counterTechniqueId: id('check_low_kick'), effectiveness: 'high', notes: 'Check and counter with cross' },
    { id: 'kb_ctr_2', techniqueId: id('low_kick'), counterTechniqueId: id('check_low_kick'), effectiveness: 'high', notes: 'Check and counter immediately' },
    { id: 'kb_ctr_3', techniqueId: id('roundhouse_body'), counterTechniqueId: id('catch_and_sweep'), effectiveness: 'high', notes: 'Catch and sweep for knockdown' },
    { id: 'kb_ctr_4', techniqueId: id('head_kick'), counterTechniqueId: id('check_low_kick'), effectiveness: 'high', notes: 'High check or duck under' },
    { id: 'kb_ctr_5', techniqueId: id('front_kick'), counterTechniqueId: id('catch_and_sweep'), effectiveness: 'medium', notes: 'Parry to side and counter' },
  ]

  return { categories, entries, sequences, counters }
}
