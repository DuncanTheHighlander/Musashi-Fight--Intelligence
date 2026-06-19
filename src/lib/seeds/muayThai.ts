import type { DisciplineSeedData, CatSeed, EntrySeed, SeqSeed, CounterSeed } from '../taxonomySeed'

const id = (name: string) => `mt_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '')}`

export function getMuayThaiData(): DisciplineSeedData {
  const categories: CatSeed[] = [
    { id: 'mt_cat_kicks', discipline: 'muay_thai', name: 'Kicks', parentId: null, description: 'Shin and foot strikes', sortOrder: 1 },
    { id: 'mt_cat_punches', discipline: 'muay_thai', name: 'Punches', parentId: null, description: 'Boxing adapted for Muay Thai', sortOrder: 2 },
    { id: 'mt_cat_elbows', discipline: 'muay_thai', name: 'Elbows (Sok)', parentId: null, description: 'Elbow strikes', sortOrder: 3 },
    { id: 'mt_cat_knees', discipline: 'muay_thai', name: 'Knees (Khao)', parentId: null, description: 'Knee strikes', sortOrder: 4 },
    { id: 'mt_cat_clinch', discipline: 'muay_thai', name: 'Clinch', parentId: null, description: 'Clinch work and sweeps', sortOrder: 5 },
    { id: 'mt_cat_defense', discipline: 'muay_thai', name: 'Defense', parentId: null, description: 'Checks, catches, blocks', sortOrder: 6 },
  ]

  const entries: EntrySeed[] = [
    {
      id: id('teep'), categoryId: 'mt_cat_kicks', discipline: 'muay_thai', name: 'Teep (Push Kick)',
      japaneseName: null, koreanName: null,
      description: 'Front push kick to midsection. Primary range management tool. Snap hip forward, extend leg, retract quickly.',
      keyPoints: ['Chamber knee high', 'Push through with hip', 'Ball of foot or flat foot', 'Retract quickly'],
      commonMistakes: ['Kicking instead of pushing', 'Not chambering', 'Leaving leg out too long'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['kick', 'teep', 'range-control', 'fundamental'], metadata: { range: 'long' }, effectivenessScore: 0.85,
    },
    {
      id: id('roundhouse'), categoryId: 'mt_cat_kicks', discipline: 'muay_thai', name: 'Roundhouse Kick (Tae)',
      japaneseName: null, koreanName: null,
      description: 'Signature Muay Thai weapon. Rotate on support foot, swing shin through target like a baseball bat.',
      keyPoints: ['Turn hip completely over', 'Kick through the target', 'Shin is striking surface', 'Arm swings for momentum'],
      commonMistakes: ['Snapping the knee', 'Not turning hip', 'Kicking with foot', 'No follow-through'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['kick', 'roundhouse', 'power', 'fundamental', 'shin'], metadata: { range: 'mid' }, effectivenessScore: 0.95,
    },
    {
      id: id('low_kick'), categoryId: 'mt_cat_kicks', discipline: 'muay_thai', name: 'Low Kick (Leg Kick)',
      japaneseName: null, koreanName: null,
      description: 'Roundhouse targeting the thigh. Accumulative damage reduces mobility. Target outer thigh or inner thigh.',
      keyPoints: ['Same mechanics as roundhouse', 'Target above the knee', 'Set up with punches', 'Angle slightly downward'],
      commonMistakes: ['Kicking too low (hits knee)', 'Not setting it up', 'Telegraphing'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['kick', 'low-kick', 'leg', 'attrition'], metadata: { range: 'mid', target: 'leg' }, effectivenessScore: 0.88,
    },
    {
      id: id('head_kick'), categoryId: 'mt_cat_kicks', discipline: 'muay_thai', name: 'Head Kick',
      japaneseName: null, koreanName: null,
      description: 'High roundhouse targeting the head. Fight-ending power. Set up with body kicks and punches.',
      keyPoints: ['Same mechanics higher target', 'Set up by going low first', 'Commit fully', 'Flexibility required'],
      commonMistakes: ['Telegraphing', 'Not setting up', 'Losing balance'],
      difficulty: 'advanced', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['kick', 'head-kick', 'power', 'finishing', 'knockout'], metadata: { range: 'mid', target: 'head' }, effectivenessScore: 0.93,
    },
    {
      id: id('horizontal_elbow'), categoryId: 'mt_cat_elbows', discipline: 'muay_thai', name: 'Horizontal Elbow (Sok Tat)',
      japaneseName: null, koreanName: null,
      description: 'Elbow strike thrown horizontally. Cuts easily due to sharp bone edge. Devastating at close range.',
      keyPoints: ['Step into range', 'Rotate hips into strike', 'Sharp edge of elbow', 'Follow through'],
      commonMistakes: ['Throwing from too far', 'No hip rotation', 'Hitting with forearm'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['elbow', 'close-range', 'cutting', 'power'], metadata: { range: 'close' }, effectivenessScore: 0.92,
    },
    {
      id: id('uppercut_elbow'), categoryId: 'mt_cat_elbows', discipline: 'muay_thai', name: 'Uppercut Elbow (Sok Ngat)',
      japaneseName: null, koreanName: null,
      description: 'Elbow driven upward targeting the chin. Extremely powerful at close range. Often used in clinch breaks.',
      keyPoints: ['Drive upward from legs', 'Target chin', 'Works great on clinch break', 'Short explosive motion'],
      commonMistakes: ['Too much arm not enough body', 'Missing target', 'Off balance'],
      difficulty: 'intermediate', positionContext: 'clinch', videoUrl: null, thumbnailUrl: null,
      tags: ['elbow', 'uppercut', 'close-range', 'clinch'], metadata: { range: 'close' }, effectivenessScore: 0.9,
    },
    {
      id: id('spinning_elbow'), categoryId: 'mt_cat_elbows', discipline: 'muay_thai', name: 'Spinning Elbow (Sok Klap)',
      japaneseName: null, koreanName: null,
      description: 'Full rotation spinning elbow. High risk, high reward. Enormous power from rotational momentum.',
      keyPoints: ['Spin on lead foot', 'Spot the target', 'Commit fully', 'Use as surprise weapon'],
      commonMistakes: ['Losing sight of opponent', 'Off balance', 'Telegraphing the spin'],
      difficulty: 'advanced', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['elbow', 'spinning', 'power', 'advanced', 'knockout'], metadata: { range: 'close' }, effectivenessScore: 0.85,
    },
    {
      id: id('straight_knee'), categoryId: 'mt_cat_knees', discipline: 'muay_thai', name: 'Straight Knee (Khao Trong)',
      japaneseName: null, koreanName: null,
      description: 'Drive knee straight upward into opponents body or chin. From clinch or at range with a step.',
      keyPoints: ['Drive hip forward', 'Rise on support foot', 'Pull opponent into knee', 'Target solar plexus or chin'],
      commonMistakes: ['Not driving hip', 'Knee goes sideways', 'Off balance'],
      difficulty: 'intermediate', positionContext: 'clinch', videoUrl: null, thumbnailUrl: null,
      tags: ['knee', 'clinch', 'power', 'body'], metadata: { range: 'close' }, effectivenessScore: 0.93,
    },
    {
      id: id('flying_knee'), categoryId: 'mt_cat_knees', discipline: 'muay_thai', name: 'Flying Knee',
      japaneseName: null, koreanName: null,
      description: 'Jump and drive knee into opponent. Spectacular finish technique. Requires setup and timing.',
      keyPoints: ['Explosive jump off rear foot', 'Drive knee upward', 'Grab their head to pull in', 'Commit fully'],
      commonMistakes: ['Telegraphing', 'Jumping too early', 'Missing and being off balance'],
      difficulty: 'advanced', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['knee', 'flying', 'power', 'knockout', 'advanced'], metadata: { range: 'mid' }, effectivenessScore: 0.88,
    },
    {
      id: id('plum_clinch'), categoryId: 'mt_cat_clinch', discipline: 'muay_thai', name: 'Plum Clinch (Double Collar Tie)',
      japaneseName: null, koreanName: null,
      description: 'Both hands clasped behind opponents head, elbows tight against collarbones. Control posture, deliver knees and elbows.',
      keyPoints: ['Elbows tight together', 'Hands clasped behind head', 'Pull head down', 'Fight for inside position'],
      commonMistakes: ['Elbows too wide', 'Hands on top of head', 'Not using off-balancing'],
      difficulty: 'intermediate', positionContext: 'clinch', videoUrl: null, thumbnailUrl: null,
      tags: ['clinch', 'plum', 'control', 'grappling'], metadata: { range: 'close' }, effectivenessScore: 0.9,
    },
    {
      id: id('sweep'), categoryId: 'mt_cat_clinch', discipline: 'muay_thai', name: 'Muay Thai Sweep (Dump)',
      japaneseName: null, koreanName: null,
      description: 'Off-balance and dump opponent from clinch or after catching a kick.',
      keyPoints: ['Timing on their step', 'Hip placement', 'Pull them over your hip', 'Works after catching kick'],
      commonMistakes: ['Forcing without setup', 'Bad hip position', 'Off balance yourself'],
      difficulty: 'intermediate', positionContext: 'clinch', videoUrl: null, thumbnailUrl: null,
      tags: ['sweep', 'clinch', 'dump', 'technique'], metadata: { range: 'close' }, effectivenessScore: 0.78,
    },
    {
      id: id('kick_check'), categoryId: 'mt_cat_defense', discipline: 'muay_thai', name: 'Kick Check',
      japaneseName: null, koreanName: null,
      description: 'Lift shin to block incoming roundhouse kick. Shin-on-shin contact. Essential defense.',
      keyPoints: ['Lift knee high', 'Turn shin outward slightly', 'Stay balanced', 'Hands stay up'],
      commonMistakes: ['Lifting too late', 'Not turning shin out', 'Losing balance'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['defense', 'check', 'kick-defense', 'fundamental'], metadata: {}, effectivenessScore: 0.88,
    },
    {
      id: id('catch_kick'), categoryId: 'mt_cat_defense', discipline: 'muay_thai', name: 'Catch and Counter',
      japaneseName: null, koreanName: null,
      description: 'Catch opponents roundhouse kick and counter with sweep, punch, or kick.',
      keyPoints: ['Absorb with body then trap', 'Scoop under the leg', 'Immediately counter', 'Options: sweep, cross, low kick'],
      commonMistakes: ['Reaching for the kick', 'Holding too long', 'Not countering immediately'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['defense', 'catch', 'counter', 'kick-defense'], metadata: {}, effectivenessScore: 0.82,
    },
    {
      id: id('long_guard'), categoryId: 'mt_cat_defense', discipline: 'muay_thai', name: 'Long Guard',
      japaneseName: null, koreanName: null,
      description: 'Extended lead arm frames against opponents face/shoulder to control distance. Classic Muay Thai defensive posture.',
      keyPoints: ['Lead arm extended, palm on their face', 'Rear hand ready to strike', 'Control their head position', 'Use to set up kicks'],
      commonMistakes: ['Arm too stiff', 'Not using it offensively', 'Leaving body exposed'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['defense', 'long-guard', 'range-control', 'frame'], metadata: {}, effectivenessScore: 0.83,
    },
  ]

  const sequences: SeqSeed[] = [
    {
      id: 'mt_seq_jab_cross_kick', discipline: 'muay_thai', name: 'Jab-Cross-Low Kick', description: 'Fundamental Muay Thai combination. Hands set up the kick.',
      steps: [
        { techniqueId: 'box_jab', notes: 'Jab to occupy vision', transitionCue: 'Into cross' },
        { techniqueId: 'box_cross', notes: 'Cross to turn head', transitionCue: 'Pivot into kick' },
        { techniqueId: id('low_kick'), notes: 'Low kick while they recover', transitionCue: 'Return to stance' },
      ],
      difficulty: 'beginner', tags: ['combo', 'fundamental', 'hands-to-kick'],
    },
    {
      id: 'mt_seq_teep_roundhouse', discipline: 'muay_thai', name: 'Teep-Roundhouse', description: 'Teep to gauge distance, follow with power kick.',
      steps: [
        { techniqueId: id('teep'), notes: 'Teep to push them back', transitionCue: 'Step forward' },
        { techniqueId: id('roundhouse'), notes: 'Body kick as they reset', transitionCue: 'Return to stance' },
      ],
      difficulty: 'beginner', tags: ['combo', 'kicks'],
    },
    {
      id: 'mt_seq_clinch_knee_elbow', discipline: 'muay_thai', name: 'Clinch-Knee-Elbow', description: 'Close distance, clinch, deliver knees and elbows.',
      steps: [
        { techniqueId: id('plum_clinch'), notes: 'Secure plum clinch', transitionCue: 'Pull head down' },
        { techniqueId: id('straight_knee'), notes: 'Drive knee to body', transitionCue: 'On break' },
        { techniqueId: id('horizontal_elbow'), notes: 'Elbow on clinch break', transitionCue: 'Reset' },
      ],
      difficulty: 'intermediate', tags: ['combo', 'clinch', 'close-range'],
    },
    {
      id: 'mt_seq_catch_sweep', discipline: 'muay_thai', name: 'Catch Kick-Sweep', description: 'Defensive counter into dominant position.',
      steps: [
        { techniqueId: id('catch_kick'), notes: 'Catch their roundhouse', transitionCue: 'Step in' },
        { techniqueId: id('sweep'), notes: 'Dump them', transitionCue: 'Follow up' },
      ],
      difficulty: 'intermediate', tags: ['counter', 'sweep', 'defense-offense'],
    },
    {
      id: 'mt_seq_body_head_kick', discipline: 'muay_thai', name: 'Body Kick-Head Kick', description: 'Set up head kick with body kick.',
      steps: [
        { techniqueId: id('roundhouse'), notes: 'Body kick to lower guard', transitionCue: 'Same leg or switch' },
        { techniqueId: id('head_kick'), notes: 'Head kick as guard drops', transitionCue: 'Follow through' },
      ],
      difficulty: 'advanced', tags: ['combo', 'kicks', 'setup', 'knockout'],
    },
  ]

  const counters: CounterSeed[] = [
    { id: 'mt_ctr_1', techniqueId: id('roundhouse'), counterTechniqueId: id('kick_check'), effectiveness: 'high', notes: 'Check with shin, counter with cross' },
    { id: 'mt_ctr_2', techniqueId: id('roundhouse'), counterTechniqueId: id('catch_kick'), effectiveness: 'high', notes: 'Catch and sweep or counter' },
    { id: 'mt_ctr_3', techniqueId: id('teep'), counterTechniqueId: id('catch_kick'), effectiveness: 'medium', notes: 'Parry teep to side, counter' },
    { id: 'mt_ctr_4', techniqueId: id('plum_clinch'), counterTechniqueId: id('uppercut_elbow'), effectiveness: 'high', notes: 'Uppercut elbow on clinch entry' },
    { id: 'mt_ctr_5', techniqueId: id('low_kick'), counterTechniqueId: id('kick_check'), effectiveness: 'high', notes: 'Check and counter with cross' },
    { id: 'mt_ctr_6', techniqueId: id('head_kick'), counterTechniqueId: id('kick_check'), effectiveness: 'high', notes: 'High check or duck under' },
  ]

  return { categories, entries, sequences, counters }
}
