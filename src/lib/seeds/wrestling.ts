import type { DisciplineSeedData, CatSeed, EntrySeed, SeqSeed, CounterSeed } from '../taxonomySeed'

const id = (name: string) => `wr_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '')}`

export function getWrestlingData(): DisciplineSeedData {
  const categories: CatSeed[] = [
    { id: 'wr_cat_takedowns', discipline: 'wrestling', name: 'Takedowns', parentId: null, description: 'Shots and throws from standing', sortOrder: 1 },
    { id: 'wr_cat_defense', discipline: 'wrestling', name: 'Takedown Defense', parentId: null, description: 'Sprawls and counters', sortOrder: 2 },
    { id: 'wr_cat_control', discipline: 'wrestling', name: 'Control & Rides', parentId: null, description: 'Top position control', sortOrder: 3 },
    { id: 'wr_cat_escapes', discipline: 'wrestling', name: 'Escapes', parentId: null, description: 'Bottom position escapes', sortOrder: 4 },
    { id: 'wr_cat_handfighting', discipline: 'wrestling', name: 'Hand Fighting & Ties', parentId: null, description: 'Neutral position control', sortOrder: 5 },
  ]

  const entries: EntrySeed[] = [
    {
      id: id('double_leg'), categoryId: 'wr_cat_takedowns', discipline: 'wrestling', name: 'Double Leg Takedown',
      japaneseName: null, koreanName: null,
      description: 'Change levels, penetrate with deep step, wrap both legs behind knees, drive through. Most fundamental wrestling takedown.',
      keyPoints: ['Level change first', 'Penetration step between legs', 'Head on inside', 'Drive through with legs'],
      commonMistakes: ['Shooting without setup', 'Head down (guillotine risk)', 'Not changing levels', 'Reaching instead of stepping'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['takedown', 'fundamental', 'double-leg', 'shooting'], metadata: { range: 'mid' }, effectivenessScore: 0.92,
    },
    {
      id: id('single_leg'), categoryId: 'wr_cat_takedowns', discipline: 'wrestling', name: 'Single Leg Takedown',
      japaneseName: null, koreanName: null,
      description: 'Grab one leg while changing levels. Head inside (safer) or outside (more power). Multiple finishes available.',
      keyPoints: ['Level change', 'Secure leg tight to chest', 'Head position matters', 'Multiple finishes: run pipe, trip, lift'],
      commonMistakes: ['Not securing the leg', 'Head on wrong side', 'Stalling with the leg'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['takedown', 'fundamental', 'single-leg', 'shooting'], metadata: { range: 'mid' }, effectivenessScore: 0.9,
    },
    {
      id: id('high_crotch'), categoryId: 'wr_cat_takedowns', discipline: 'wrestling', name: 'High Crotch',
      japaneseName: null, koreanName: null,
      description: 'Penetrate and lift opponents leg at hip crease. Versatile — finish as single, double, or lift.',
      keyPoints: ['Deep penetration step', 'Head on inside', 'Lift at hip crease', 'Multiple finish options'],
      commonMistakes: ['Not deep enough', 'Stalling in position', 'Bad head position'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['takedown', 'high-crotch', 'versatile'], metadata: { range: 'mid' }, effectivenessScore: 0.88,
    },
    {
      id: id('ankle_pick'), categoryId: 'wr_cat_takedowns', discipline: 'wrestling', name: 'Ankle Pick',
      japaneseName: null, koreanName: null,
      description: 'Snap opponents head down, grab their ankle, pull toward you while pushing head. Low-energy takedown.',
      keyPoints: ['Snap head down first', 'Reach for ankle as they post', 'Pull ankle toward you', 'Push head away simultaneously'],
      commonMistakes: ['Reaching without snapping', 'Not controlling head', 'Grabbing too high'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['takedown', 'ankle-pick', 'snap-down', 'low-energy'], metadata: { range: 'mid' }, effectivenessScore: 0.82,
    },
    {
      id: id('firemans_carry'), categoryId: 'wr_cat_takedowns', discipline: 'wrestling', name: 'Firemans Carry',
      japaneseName: null, koreanName: null,
      description: 'Duck under opponents arm, load them across shoulders, dump to mat. Spectacular and effective.',
      keyPoints: ['Duck under the arm', 'Load across shoulders', 'Drop to knee', 'Dump and follow to top'],
      commonMistakes: ['Not loading properly', 'Opponent sprawls before load', 'Ending up on bottom'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['takedown', 'firemans-carry', 'spectacular'], metadata: { range: 'close' }, effectivenessScore: 0.85,
    },
    {
      id: id('body_lock'), categoryId: 'wr_cat_takedowns', discipline: 'wrestling', name: 'Body Lock Takedown',
      japaneseName: null, koreanName: null,
      description: 'Secure tight grip around torso, use hip pressure to lift or trip. Effective against the cage in MMA.',
      keyPoints: ['Chest-to-chest pressure', 'Lock hands tight', 'Heavy hips', 'Trip the far leg'],
      commonMistakes: ['Grip too loose', 'Not using hips', 'Trying to muscle it'],
      difficulty: 'intermediate', positionContext: 'clinch', videoUrl: null, thumbnailUrl: null,
      tags: ['takedown', 'body-lock', 'clinch', 'power'], metadata: { range: 'close' }, effectivenessScore: 0.87,
    },
    {
      id: id('sprawl'), categoryId: 'wr_cat_defense', discipline: 'wrestling', name: 'Sprawl',
      japaneseName: null, koreanName: null,
      description: 'Primary takedown defense. Kick legs back, drop hips onto opponents shoulders. Creates whizzer opportunity.',
      keyPoints: ['React early', 'Kick legs back explosively', 'Heavy hips on their back', 'Crossface or whizzer'],
      commonMistakes: ['Reacting too late', 'Hips too high', 'Not following up'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['defense', 'sprawl', 'takedown-defense', 'fundamental'], metadata: {}, effectivenessScore: 0.9,
    },
    {
      id: id('whizzer'), categoryId: 'wr_cat_defense', discipline: 'wrestling', name: 'Whizzer (Overhook)',
      japaneseName: null, koreanName: null,
      description: 'Overhook opponents arm and apply downward pressure. Defends single legs and creates scramble opportunities.',
      keyPoints: ['Hook over their arm deep', 'Apply downward hip pressure', 'Circle away from attack', 'Can lead to go-behind'],
      commonMistakes: ['Not deep enough overhook', 'No hip pressure', 'Standing still with it'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['defense', 'whizzer', 'overhook', 'counter'], metadata: {}, effectivenessScore: 0.85,
    },
    {
      id: id('front_headlock'), categoryId: 'wr_cat_control', discipline: 'wrestling', name: 'Front Headlock',
      japaneseName: null, koreanName: null,
      description: 'Control position with arm around opponents neck from front. Leads to go-behinds, chokes, snap downs.',
      keyPoints: ['Chin strap or arm around neck', 'Sprawl hips back', 'Heavy chest pressure', 'Circle for go-behind'],
      commonMistakes: ['Not enough pressure', 'Letting them stand up', 'Stalling'],
      difficulty: 'intermediate', positionContext: 'front_headlock', videoUrl: null, thumbnailUrl: null,
      tags: ['control', 'front-headlock', 'transition', 'dominant'], metadata: {}, effectivenessScore: 0.85,
    },
    {
      id: id('underhook'), categoryId: 'wr_cat_handfighting', discipline: 'wrestling', name: 'Underhook',
      japaneseName: null, koreanName: null,
      description: 'Arm under opponents armpit, hand on their back. Most important clinch position in wrestling.',
      keyPoints: ['Fight for inside position', 'Hand high on their back', 'Keep elbow tight', 'Use to set up attacks'],
      commonMistakes: ['Arm too loose', 'Not using offensively', 'Letting opponent pummel through'],
      difficulty: 'beginner', positionContext: 'clinch', videoUrl: null, thumbnailUrl: null,
      tags: ['clinch', 'underhook', 'control', 'fundamental'], metadata: {}, effectivenessScore: 0.88,
    },
    {
      id: id('collar_tie'), categoryId: 'wr_cat_handfighting', discipline: 'wrestling', name: 'Collar Tie (Snap Down)',
      japaneseName: null, koreanName: null,
      description: 'Hand behind opponents neck for control. Use to snap their head down, set up shots, or create angles.',
      keyPoints: ['Hand behind neck, not on top', 'Pull down and to the side', 'Use to set up shots', 'Combine with other ties'],
      commonMistakes: ['Hand on top of head (no control)', 'Static grip', 'Not using it to attack'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['clinch', 'collar-tie', 'snap-down', 'setup'], metadata: {}, effectivenessScore: 0.8,
    },
    {
      id: id('standup_escape'), categoryId: 'wr_cat_escapes', discipline: 'wrestling', name: 'Stand-Up Escape',
      japaneseName: null, koreanName: null,
      description: 'From bottom: base up to tripod, clear hands, stand up and turn to face opponent.',
      keyPoints: ['Explosive base-up', 'Clear their hands from waist', 'Stand up tall', 'Turn to face immediately'],
      commonMistakes: ['Not explosive enough', 'Not clearing hands', 'Turning wrong way'],
      difficulty: 'beginner', positionContext: 'ground_bottom', videoUrl: null, thumbnailUrl: null,
      tags: ['escape', 'stand-up', 'bottom', 'fundamental'], metadata: {}, effectivenessScore: 0.85,
    },
    {
      id: id('sit_out'), categoryId: 'wr_cat_escapes', discipline: 'wrestling', name: 'Sit-Out Turn-In',
      japaneseName: null, koreanName: null,
      description: 'From bottom: sit through, turn into opponent, come to top position. Quick reversal.',
      keyPoints: ['Post on hand and opposite foot', 'Sit through explosively', 'Turn into opponent', 'Secure top position'],
      commonMistakes: ['Not explosive enough', 'Sitting out without turning', 'Losing position during turn'],
      difficulty: 'intermediate', positionContext: 'ground_bottom', videoUrl: null, thumbnailUrl: null,
      tags: ['escape', 'sit-out', 'reversal', 'bottom'], metadata: {}, effectivenessScore: 0.82,
    },
    {
      id: id('switch'), categoryId: 'wr_cat_escapes', discipline: 'wrestling', name: 'Switch',
      japaneseName: null, koreanName: null,
      description: 'From bottom: reach back between opponents legs, switch hips, end up behind them. Classic reversal.',
      keyPoints: ['Reach back between their legs', 'Switch hips explosively', 'Come out behind them', 'Secure control'],
      commonMistakes: ['Not reaching deep enough', 'Slow hip switch', 'Not finishing the move'],
      difficulty: 'intermediate', positionContext: 'ground_bottom', videoUrl: null, thumbnailUrl: null,
      tags: ['escape', 'switch', 'reversal', 'bottom'], metadata: {}, effectivenessScore: 0.83,
    },
    {
      id: id('cradle'), categoryId: 'wr_cat_control', discipline: 'wrestling', name: 'Cradle',
      japaneseName: null, koreanName: null,
      description: 'Lock opponents head and knee together with clasped hands. Powerful pinning combination from top.',
      keyPoints: ['Lock head and near knee together', 'Clasp hands tight', 'Drive them to their back', 'Squeeze for the pin'],
      commonMistakes: ['Hands not locked tight', 'Not driving to their back', 'Opponent postures out'],
      difficulty: 'intermediate', positionContext: 'ground_top', videoUrl: null, thumbnailUrl: null,
      tags: ['control', 'cradle', 'pin', 'top'], metadata: {}, effectivenessScore: 0.86,
    },
  ]

  const sequences: SeqSeed[] = [
    {
      id: 'wr_seq_snap_single', discipline: 'wrestling', name: 'Snap Down to Single Leg', description: 'Use snap down to set up single leg.',
      steps: [
        { techniqueId: id('collar_tie'), notes: 'Snap their head down', transitionCue: 'As they post, change level' },
        { techniqueId: id('single_leg'), notes: 'Shoot single on reaction', transitionCue: 'Finish takedown' },
      ],
      difficulty: 'intermediate', tags: ['chain-wrestling', 'setup'],
    },
    {
      id: 'wr_seq_single_to_double', discipline: 'wrestling', name: 'Single to Double', description: 'Switch from single to double when they defend.',
      steps: [
        { techniqueId: id('single_leg'), notes: 'Shoot single leg', transitionCue: 'If they whizzer, switch' },
        { techniqueId: id('double_leg'), notes: 'Wrap second leg and drive', transitionCue: 'Finish takedown' },
      ],
      difficulty: 'intermediate', tags: ['chain-wrestling', 're-attack'],
    },
    {
      id: 'wr_seq_sprawl_front_head', discipline: 'wrestling', name: 'Sprawl to Front Headlock', description: 'Defensive chain into offense.',
      steps: [
        { techniqueId: id('sprawl'), notes: 'Sprawl on their shot', transitionCue: 'Secure front headlock' },
        { techniqueId: id('front_headlock'), notes: 'Control with front headlock', transitionCue: 'Circle for go-behind' },
      ],
      difficulty: 'intermediate', tags: ['defense-to-offense', 'chain-wrestling'],
    },
    {
      id: 'wr_seq_underhook_single', discipline: 'wrestling', name: 'Underhook to Single Leg', description: 'Use underhook to set up shot.',
      steps: [
        { techniqueId: id('underhook'), notes: 'Secure underhook', transitionCue: 'Circle and level change' },
        { techniqueId: id('single_leg'), notes: 'Drop to single leg', transitionCue: 'Finish' },
      ],
      difficulty: 'beginner', tags: ['setup', 'fundamental'],
    },
  ]

  const counters: CounterSeed[] = [
    { id: 'wr_ctr_1', techniqueId: id('double_leg'), counterTechniqueId: id('sprawl'), effectiveness: 'high', notes: 'Sprawl and crossface' },
    { id: 'wr_ctr_2', techniqueId: id('single_leg'), counterTechniqueId: id('whizzer'), effectiveness: 'high', notes: 'Whizzer and hip pressure' },
    { id: 'wr_ctr_3', techniqueId: id('single_leg'), counterTechniqueId: id('sprawl'), effectiveness: 'high', notes: 'Sprawl and circle' },
    { id: 'wr_ctr_4', techniqueId: id('double_leg'), counterTechniqueId: id('front_headlock'), effectiveness: 'medium', notes: 'Stuff shot into front headlock' },
    { id: 'wr_ctr_5', techniqueId: id('firemans_carry'), counterTechniqueId: id('whizzer'), effectiveness: 'high', notes: 'Whizzer to prevent load' },
    { id: 'wr_ctr_6', techniqueId: id('body_lock'), counterTechniqueId: id('underhook'), effectiveness: 'medium', notes: 'Pummel for underhook to deny lock' },
  ]

  return { categories, entries, sequences, counters }
}
