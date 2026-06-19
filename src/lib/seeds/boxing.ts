import type { DisciplineSeedData, CatSeed, EntrySeed, SeqSeed, CounterSeed } from '../taxonomySeed'

const id = (name: string) => `box_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '')}`

export function getBoxingData(): DisciplineSeedData {
  const categories: CatSeed[] = [
    { id: 'box_cat_punches', discipline: 'boxing', name: 'Punches', parentId: null, description: 'All punch types', sortOrder: 1 },
    { id: 'box_cat_defense', discipline: 'boxing', name: 'Defense', parentId: null, description: 'Defensive techniques and head movement', sortOrder: 2 },
    { id: 'box_cat_footwork', discipline: 'boxing', name: 'Footwork', parentId: null, description: 'Movement and ring control', sortOrder: 3 },
    { id: 'box_cat_combos', discipline: 'boxing', name: 'Combinations', parentId: null, description: 'Multi-punch sequences', sortOrder: 4 },
    { id: 'box_cat_body', discipline: 'boxing', name: 'Body Work', parentId: null, description: 'Body shots and setups', sortOrder: 5 },
  ]

  const entries: EntrySeed[] = [
    {
      id: id('jab'), categoryId: 'box_cat_punches', discipline: 'boxing', name: 'Jab',
      japaneseName: null, koreanName: null,
      description: 'Lead hand straight punch. Primary range finder and setup tool. Extends from guard, snaps back quickly.',
      keyPoints: ['Extend from chin', 'Snap back to guard', 'Step with the jab', 'Turn fist over at extension'],
      commonMistakes: ['Dropping hand before throwing', 'Not returning to guard', 'Leaning forward off balance'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['punch', 'lead-hand', 'fundamental', 'range-finder'], metadata: { range: 'long' }, effectivenessScore: 0.8,
    },
    {
      id: id('cross'), categoryId: 'box_cat_punches', discipline: 'boxing', name: 'Cross',
      japaneseName: null, koreanName: null,
      description: 'Rear hand power punch. Rotate hips, pivot rear foot, drive through the target. Primary power weapon.',
      keyPoints: ['Rotate hips fully', 'Pivot rear foot', 'Keep chin behind shoulder', 'Drive through target'],
      commonMistakes: ['No hip rotation', 'Dropping lead hand', 'Over-reaching'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['punch', 'rear-hand', 'power', 'fundamental'], metadata: { range: 'long' }, effectivenessScore: 0.9,
    },
    {
      id: id('lead_hook'), categoryId: 'box_cat_punches', discipline: 'boxing', name: 'Lead Hook',
      japaneseName: null, koreanName: null,
      description: 'Short-range horizontal arc punch with lead hand. Elbow at 90 degrees, power from hip rotation.',
      keyPoints: ['Elbow at 90 degrees', 'Rotate on ball of lead foot', 'Compact arc', 'Dont wind up'],
      commonMistakes: ['Winding up', 'Dropping rear hand', 'Arm too straight'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['punch', 'lead-hand', 'power', 'close-range', 'hook'], metadata: { range: 'close' }, effectivenessScore: 0.9,
    },
    {
      id: id('rear_hook'), categoryId: 'box_cat_punches', discipline: 'boxing', name: 'Rear Hook',
      japaneseName: null, koreanName: null,
      description: 'Rear hand hook. Powerful when opponent circles into it. Often thrown after a lead hook.',
      keyPoints: ['Shift weight to lead foot first', 'Rotate hips back', 'Short compact arc'],
      commonMistakes: ['Telegraphing the shift', 'Too wide an arc', 'Off balance'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['punch', 'rear-hand', 'power', 'hook'], metadata: { range: 'close' }, effectivenessScore: 0.85,
    },
    {
      id: id('lead_uppercut'), categoryId: 'box_cat_punches', discipline: 'boxing', name: 'Lead Uppercut',
      japaneseName: null, koreanName: null,
      description: 'Vertical punch driven upward from a slight crouch. Targets chin or body at close range.',
      keyPoints: ['Dip slightly before throwing', 'Drive upward from legs', 'Palm faces you at impact', 'Short compact motion'],
      commonMistakes: ['Dropping hand too low', 'Leaning back', 'Too much arm not enough legs'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['punch', 'lead-hand', 'uppercut', 'close-range'], metadata: { range: 'close' }, effectivenessScore: 0.85,
    },
    {
      id: id('rear_uppercut'), categoryId: 'box_cat_punches', discipline: 'boxing', name: 'Rear Uppercut',
      japaneseName: null, koreanName: null,
      description: 'Power uppercut from rear hand. Maximum damage at close range. Set up by hooks or body shots.',
      keyPoints: ['Rotate hips into punch', 'Drive upward from legs and hips', 'Keep elbow tight', 'Aim for chin'],
      commonMistakes: ['Winding up from too low', 'Squaring up', 'No hip rotation'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['punch', 'rear-hand', 'uppercut', 'power', 'close-range'], metadata: { range: 'close' }, effectivenessScore: 0.88,
    },
    {
      id: id('body_jab'), categoryId: 'box_cat_body', discipline: 'boxing', name: 'Jab to the Body',
      japaneseName: null, koreanName: null,
      description: 'Jab aimed at the midsection. Bend knees to change level. Brings opponents guard down.',
      keyPoints: ['Bend knees to change level', 'Same mechanics as head jab', 'Target solar plexus', 'Return to head level quickly'],
      commonMistakes: ['Leaning instead of bending knees', 'Dropping rear hand', 'Staying low too long'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['punch', 'body', 'jab', 'level-change'], metadata: { range: 'long', target: 'body' }, effectivenessScore: 0.78,
    },
    {
      id: id('liver_shot'), categoryId: 'box_cat_body', discipline: 'boxing', name: 'Liver Shot',
      japaneseName: null, koreanName: null,
      description: 'Left hook to the liver. One of boxings most devastating attacks. Causes delayed pain and can drop fighters.',
      keyPoints: ['Target right side of opponents body', 'Dig hook under the elbow', 'Set up by going to head first', 'Commit to body level'],
      commonMistakes: ['Hitting too high', 'Not setting it up', 'Telegraphing level change'],
      difficulty: 'advanced', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['punch', 'body', 'hook', 'liver', 'power', 'finishing'], metadata: { range: 'close', target: 'body' }, effectivenessScore: 0.95,
    },
    {
      id: id('slip'), categoryId: 'box_cat_defense', discipline: 'boxing', name: 'Slip',
      japaneseName: null, koreanName: null,
      description: 'Move head off centerline to evade straight punches. Rotate torso, bend at waist slightly. Sets up counters.',
      keyPoints: ['Bend at waist not just neck', 'Keep eyes on opponent', 'Rotate torso to load counter', 'Small movement'],
      commonMistakes: ['Moving too far', 'Closing eyes', 'Not loading a counter'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['defense', 'head-movement', 'slip', 'counter-setup'], metadata: {}, effectivenessScore: 0.88,
    },
    {
      id: id('roll'), categoryId: 'box_cat_defense', discipline: 'boxing', name: 'Roll (Bob and Weave)',
      japaneseName: null, koreanName: null,
      description: 'U-shaped head movement under hooks. Bend knees, dip under punch, come up on other side.',
      keyPoints: ['Bend knees not waist', 'U-shape motion', 'Come up with counter ready', 'Keep hands up'],
      commonMistakes: ['Bending at waist', 'Rolling too slowly', 'Not countering after'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['defense', 'head-movement', 'bob-and-weave', 'roll'], metadata: {}, effectivenessScore: 0.86,
    },
    {
      id: id('parry'), categoryId: 'box_cat_defense', discipline: 'boxing', name: 'Parry',
      japaneseName: null, koreanName: null,
      description: 'Deflect incoming punch with small hand movement. Minimal energy, keeps you in range to counter.',
      keyPoints: ['Small deflection', 'Redirect dont block', 'Immediately counter', 'Stay in range'],
      commonMistakes: ['Over-committing', 'Reaching out too far', 'Not countering'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['defense', 'parry', 'fundamental', 'counter-setup'], metadata: {}, effectivenessScore: 0.82,
    },
    {
      id: id('shoulder_roll'), categoryId: 'box_cat_defense', discipline: 'boxing', name: 'Shoulder Roll (Philly Shell)',
      japaneseName: null, koreanName: null,
      description: 'Lead shoulder absorbs/deflects punches while rear hand stays ready to counter. Requires excellent timing.',
      keyPoints: ['Lead shoulder high protecting chin', 'Rear hand by cheek', 'Roll with the punch', 'Immediate pull counter'],
      commonMistakes: ['Dropping rear hand', 'Not rolling with punch', 'Vulnerable to body shots'],
      difficulty: 'advanced', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['defense', 'shoulder-roll', 'philly-shell', 'advanced'], metadata: {}, effectivenessScore: 0.9,
    },
    {
      id: id('pivot'), categoryId: 'box_cat_footwork', discipline: 'boxing', name: 'Pivot',
      japaneseName: null, koreanName: null,
      description: 'Rotate on lead foot to change angle. Creates new attacking angles and escapes the pocket.',
      keyPoints: ['Pivot on ball of lead foot', 'Push off rear foot', 'Maintain guard', 'End in balanced stance'],
      commonMistakes: ['Crossing feet', 'Losing balance', 'Pivoting without purpose'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['footwork', 'pivot', 'angle', 'fundamental'], metadata: {}, effectivenessScore: 0.8,
    },
    {
      id: id('cut_off_ring'), categoryId: 'box_cat_footwork', discipline: 'boxing', name: 'Cutting Off the Ring',
      japaneseName: null, koreanName: null,
      description: 'Use lateral movement and positioning to trap opponent against ropes or corner.',
      keyPoints: ['Move laterally not forward', 'Anticipate escape route', 'Use jab to herd them', 'Control center ring'],
      commonMistakes: ['Chasing in straight lines', 'Lunging forward', 'Leaving escape routes'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['footwork', 'ring-control', 'pressure', 'strategy'], metadata: {}, effectivenessScore: 0.85,
    },
    {
      id: id('check_hook'), categoryId: 'box_cat_punches', discipline: 'boxing', name: 'Check Hook',
      japaneseName: null, koreanName: null,
      description: 'Lead hook thrown while pivoting away from aggressive opponent. Catches them coming in.',
      keyPoints: ['Pivot on lead foot as you throw', 'Time it as opponent steps in', 'Short compact hook', 'End at new angle'],
      commonMistakes: ['Throwing without pivoting', 'Bad timing', 'Not enough rotation'],
      difficulty: 'advanced', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['punch', 'hook', 'counter', 'pivot', 'advanced'], metadata: {}, effectivenessScore: 0.88,
    },
    {
      id: id('pull_counter'), categoryId: 'box_cat_defense', discipline: 'boxing', name: 'Pull Counter',
      japaneseName: null, koreanName: null,
      description: 'Pull head straight back to avoid jab/cross, then immediately fire back a cross.',
      keyPoints: ['Slight lean back', 'Keep weight centered', 'Fire cross immediately', 'Dont lean too far'],
      commonMistakes: ['Leaning too far back', 'Slow counter', 'Off balance after pulling'],
      difficulty: 'advanced', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['defense', 'counter', 'pull-counter', 'advanced'], metadata: {}, effectivenessScore: 0.87,
    },
  ]

  const sequences: SeqSeed[] = [
    {
      id: 'box_seq_1_2', discipline: 'boxing', name: 'Jab-Cross (1-2)', description: 'The fundamental boxing combination.',
      steps: [
        { techniqueId: id('jab'), notes: 'Jab to measure distance', transitionCue: 'Retract jab as cross extends' },
        { techniqueId: id('cross'), notes: 'Cross with full hip rotation', transitionCue: 'Return to guard' },
      ],
      difficulty: 'beginner', tags: ['combo', 'fundamental'],
    },
    {
      id: 'box_seq_1_2_3', discipline: 'boxing', name: 'Jab-Cross-Hook (1-2-3)', description: 'Classic three-punch combination.',
      steps: [
        { techniqueId: id('jab'), notes: 'Jab to occupy vision', transitionCue: 'Into cross' },
        { techniqueId: id('cross'), notes: 'Cross turns their head', transitionCue: 'Weight shifts to lead side' },
        { techniqueId: id('lead_hook'), notes: 'Hook catches exposed chin', transitionCue: 'Return to guard' },
      ],
      difficulty: 'intermediate', tags: ['combo', 'classic'],
    },
    {
      id: 'box_seq_body_head', discipline: 'boxing', name: 'Jab-Cross-Body Hook-Head Hook', description: 'Level-changing four-punch combination.',
      steps: [
        { techniqueId: id('jab'), notes: 'Jab high', transitionCue: 'Into cross' },
        { techniqueId: id('cross'), notes: 'Cross high', transitionCue: 'Dip level' },
        { techniqueId: id('liver_shot'), notes: 'Hook to body', transitionCue: 'Come back up' },
        { techniqueId: id('lead_hook'), notes: 'Hook to head', transitionCue: 'Exit angle' },
      ],
      difficulty: 'advanced', tags: ['combo', 'level-change', 'body-head'],
    },
    {
      id: 'box_seq_jab_slip_cross', discipline: 'boxing', name: 'Jab-Slip-Cross Counter', description: 'Offensive-defensive combination.',
      steps: [
        { techniqueId: id('jab'), notes: 'Throw jab to draw counter', transitionCue: 'Anticipate their cross' },
        { techniqueId: id('slip'), notes: 'Slip outside their cross', transitionCue: 'Load rear hand' },
        { techniqueId: id('cross'), notes: 'Counter cross while extended', transitionCue: 'Return to guard' },
      ],
      difficulty: 'intermediate', tags: ['combo', 'counter', 'defense-offense'],
    },
    {
      id: 'box_seq_1_6_3_2', discipline: 'boxing', name: 'Jab-Rear Uppercut-Hook-Cross', description: 'Mixed-angle four-punch combination.',
      steps: [
        { techniqueId: id('jab'), notes: 'Jab to set range', transitionCue: 'Dip slightly' },
        { techniqueId: id('rear_uppercut'), notes: 'Uppercut through guard', transitionCue: 'Rotate into hook' },
        { techniqueId: id('lead_hook'), notes: 'Hook as they react', transitionCue: 'Shift weight back' },
        { techniqueId: id('cross'), notes: 'Finish with cross', transitionCue: 'Exit' },
      ],
      difficulty: 'advanced', tags: ['combo', 'angles', 'advanced'],
    },
  ]

  const counters: CounterSeed[] = [
    { id: 'box_ctr_1', techniqueId: id('jab'), counterTechniqueId: id('parry'), effectiveness: 'high', notes: 'Parry and counter with cross' },
    { id: 'box_ctr_2', techniqueId: id('jab'), counterTechniqueId: id('slip'), effectiveness: 'high', notes: 'Slip outside and counter' },
    { id: 'box_ctr_3', techniqueId: id('cross'), counterTechniqueId: id('slip'), effectiveness: 'high', notes: 'Slip inside, counter with hook' },
    { id: 'box_ctr_4', techniqueId: id('cross'), counterTechniqueId: id('pull_counter'), effectiveness: 'high', notes: 'Pull back and fire cross' },
    { id: 'box_ctr_5', techniqueId: id('lead_hook'), counterTechniqueId: id('roll'), effectiveness: 'high', notes: 'Roll under hook, come up with counter' },
    { id: 'box_ctr_6', techniqueId: id('lead_hook'), counterTechniqueId: id('rear_uppercut'), effectiveness: 'medium', notes: 'Dip under hook and uppercut' },
    { id: 'box_ctr_7', techniqueId: id('rear_uppercut'), counterTechniqueId: id('jab'), effectiveness: 'medium', notes: 'Straight punch beats uppercut at range' },
    { id: 'box_ctr_8', techniqueId: id('liver_shot'), counterTechniqueId: id('lead_uppercut'), effectiveness: 'medium', notes: 'Uppercut as they dip to body' },
  ]

  return { categories, entries, sequences, counters }
}
