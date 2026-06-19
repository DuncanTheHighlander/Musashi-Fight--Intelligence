import type { DisciplineSeedData, CatSeed, EntrySeed, SeqSeed, CounterSeed } from '../taxonomySeed'

const id = (name: string) => `tkd_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '')}`

export function getTaekwondoData(): DisciplineSeedData {
  const categories: CatSeed[] = [
    { id: 'tkd_cat_kicks', discipline: 'taekwondo', name: 'Kicks (Chagi)', parentId: null, description: 'All kicking techniques', sortOrder: 1 },
    { id: 'tkd_cat_spinning', discipline: 'taekwondo', name: 'Spinning Techniques', parentId: null, description: 'Spinning kicks for bonus points', sortOrder: 2 },
    { id: 'tkd_cat_punches', discipline: 'taekwondo', name: 'Punches (Jireugi)', parentId: null, description: 'Punching techniques', sortOrder: 3 },
    { id: 'tkd_cat_footwork', discipline: 'taekwondo', name: 'Footwork & Strategy', parentId: null, description: 'Movement and tactical concepts', sortOrder: 4 },
  ]

  const entries: EntrySeed[] = [
    {
      id: id('dollyo_chagi'), categoryId: 'tkd_cat_kicks', discipline: 'taekwondo', name: 'Dollyo Chagi (Roundhouse Kick)',
      japaneseName: null, koreanName: 'Dollyo Chagi',
      description: 'Primary scoring kick. Chamber knee, rotate hip, snap kick to body or head. Body = 2pts, head = 3pts.',
      keyPoints: ['Chamber knee high', 'Rotate hip over', 'Snap the kick', 'Instep or ball of foot', 'Retract fast'],
      commonMistakes: ['No chamber', 'Kicking through instead of snapping', 'Telegraphing', 'Off balance'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['kick', 'roundhouse', 'scoring', 'fundamental'], metadata: { points_body: 2, points_head: 3 }, effectivenessScore: 0.9,
    },
    {
      id: id('ap_chagi'), categoryId: 'tkd_cat_kicks', discipline: 'taekwondo', name: 'Ap Chagi (Front Kick)',
      japaneseName: null, koreanName: 'Ap Chagi',
      description: 'Front snap kick to body. Used for scoring and distance control. Quick and hard to see coming.',
      keyPoints: ['Chamber knee', 'Snap forward with ball of foot', 'Target solar plexus', 'Retract quickly'],
      commonMistakes: ['Pushing instead of snapping', 'No chamber', 'Kicking too low'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['kick', 'front-kick', 'scoring', 'fundamental'], metadata: { points_body: 2 }, effectivenessScore: 0.82,
    },
    {
      id: id('yeop_chagi'), categoryId: 'tkd_cat_kicks', discipline: 'taekwondo', name: 'Yeop Chagi (Side Kick)',
      japaneseName: null, koreanName: 'Yeop Chagi',
      description: 'Side kick using the blade of the foot. Powerful linear kick. Good for stopping aggressive opponents.',
      keyPoints: ['Chamber knee across body', 'Thrust sideways with blade of foot', 'Lean away for balance', 'Retract'],
      commonMistakes: ['Kicking with instep instead of blade', 'No lean', 'Telegraphing'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['kick', 'side-kick', 'power', 'stopping'], metadata: { points_body: 2 }, effectivenessScore: 0.83,
    },
    {
      id: id('naeryeo_chagi'), categoryId: 'tkd_cat_kicks', discipline: 'taekwondo', name: 'Naeryeo Chagi (Axe Kick)',
      japaneseName: null, koreanName: 'Naeryeo Chagi',
      description: 'Raise leg high and bring heel down on opponents head or shoulder. Scores 3 points to head.',
      keyPoints: ['Raise leg straight up', 'Bring heel down on target', 'Flexibility required', 'Deceptive angle of attack'],
      commonMistakes: ['Not raising high enough', 'Missing the target', 'Off balance'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['kick', 'axe-kick', 'head-kick', 'scoring'], metadata: { points_head: 3 }, effectivenessScore: 0.8,
    },
    {
      id: id('bandal_chagi'), categoryId: 'tkd_cat_kicks', discipline: 'taekwondo', name: 'Bandal Chagi (Half-Moon Kick)',
      japaneseName: null, koreanName: 'Bandal Chagi',
      description: 'Quick short roundhouse targeting the body protector. Fastest scoring kick. Minimal telegraph.',
      keyPoints: ['Minimal chamber', 'Quick snap to body', 'Target the hogu (chest protector)', 'Speed over power'],
      commonMistakes: ['Too much power (slow)', 'Missing the scoring zone', 'Telegraphing'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['kick', 'half-moon', 'quick', 'scoring', 'body'], metadata: { points_body: 2 }, effectivenessScore: 0.85,
    },
    {
      id: id('cut_kick'), categoryId: 'tkd_cat_kicks', discipline: 'taekwondo', name: 'Cut Kick (Checking Kick)',
      japaneseName: null, koreanName: null,
      description: 'Quick front leg kick to stop opponents attack. Disrupts their rhythm and timing. Defensive tool.',
      keyPoints: ['Quick front leg snap', 'Target their hip or thigh', 'Stops their forward movement', 'Reset distance after'],
      commonMistakes: ['Too slow', 'Kicking too high', 'Not following up'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['kick', 'cut-kick', 'defensive', 'disruption'], metadata: {}, effectivenessScore: 0.78,
    },
    {
      id: id('dwi_chagi'), categoryId: 'tkd_cat_spinning', discipline: 'taekwondo', name: 'Dwi Chagi (Back Kick)',
      japaneseName: null, koreanName: 'Dwi Chagi',
      description: 'Spinning back kick. Turn and thrust heel backward into opponent. Powerful counter technique. Body = 4pts, head = 5pts.',
      keyPoints: ['Spot the target over your shoulder', 'Thrust heel straight back', 'Full hip extension', 'Powerful and fast'],
      commonMistakes: ['Losing sight of target', 'Kicking sideways not straight back', 'Off balance'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['kick', 'back-kick', 'spinning', 'power', 'counter', 'bonus-points'], metadata: { points_body: 4, points_head: 5 }, effectivenessScore: 0.9,
    },
    {
      id: id('spinning_hook'), categoryId: 'tkd_cat_spinning', discipline: 'taekwondo', name: 'Dwi Huryeo Chagi (Spinning Hook Kick)',
      japaneseName: null, koreanName: 'Dwi Huryeo Chagi',
      description: 'Spinning hook kick to the head. Spectacular technique. Head = 5 points. High risk, high reward.',
      keyPoints: ['Spin on support foot', 'Hook the kick around', 'Heel strikes the head', 'Spot the target'],
      commonMistakes: ['Losing sight of target', 'Missing', 'Off balance', 'Telegraphing the spin'],
      difficulty: 'advanced', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['kick', 'spinning-hook', 'head-kick', 'bonus-points', 'spectacular'], metadata: { points_head: 5 }, effectivenessScore: 0.85,
    },
    {
      id: id('tornado_kick'), categoryId: 'tkd_cat_spinning', discipline: 'taekwondo', name: 'Tornado Kick (360 Roundhouse)',
      japaneseName: null, koreanName: null,
      description: 'Full 360 rotation into a roundhouse kick. Maximum bonus points. Spectacular and powerful.',
      keyPoints: ['Step across to initiate spin', 'Full 360 rotation', 'Kick at the end of rotation', 'Spot the target throughout'],
      commonMistakes: ['Losing orientation', 'Kicking too early in rotation', 'Off balance'],
      difficulty: 'advanced', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['kick', 'tornado', 'spinning', 'spectacular', 'bonus-points'], metadata: { points_body: 4, points_head: 5 }, effectivenessScore: 0.82,
    },
    {
      id: id('bounce_step'), categoryId: 'tkd_cat_footwork', discipline: 'taekwondo', name: 'Bounce Step (Rhythm Footwork)',
      japaneseName: null, koreanName: null,
      description: 'Light bouncing footwork to maintain rhythm and readiness. Allows quick direction changes and explosive attacks.',
      keyPoints: ['Stay on balls of feet', 'Light bouncing rhythm', 'Ready to attack any direction', 'Change rhythm to deceive'],
      commonMistakes: ['Flat-footed', 'Bouncing too high', 'Predictable rhythm'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['footwork', 'bounce', 'rhythm', 'fundamental'], metadata: {}, effectivenessScore: 0.75,
    },
  ]

  const sequences: SeqSeed[] = [
    {
      id: 'tkd_seq_bandal_dollyo', discipline: 'taekwondo', name: 'Bandal Chagi - Dollyo Chagi (Body-Head)', description: 'Quick body kick to lower guard, then head kick.',
      steps: [
        { techniqueId: id('bandal_chagi'), notes: 'Quick body kick to lower guard', transitionCue: 'Same leg or switch' },
        { techniqueId: id('dollyo_chagi'), notes: 'Head kick as guard drops', transitionCue: 'Score' },
      ],
      difficulty: 'intermediate', tags: ['combo', 'body-head', 'scoring'],
    },
    {
      id: 'tkd_seq_cut_back_kick', discipline: 'taekwondo', name: 'Cut Kick - Back Kick Counter', description: 'Stop their attack then counter.',
      steps: [
        { techniqueId: id('cut_kick'), notes: 'Cut kick to stop their advance', transitionCue: 'As they recover' },
        { techniqueId: id('dwi_chagi'), notes: 'Back kick counter for bonus points', transitionCue: 'Score' },
      ],
      difficulty: 'intermediate', tags: ['counter', 'defense-offense', 'bonus-points'],
    },
    {
      id: 'tkd_seq_ap_spinning_hook', discipline: 'taekwondo', name: 'Ap Chagi - Spinning Hook Kick', description: 'Front kick feint into spinning head kick.',
      steps: [
        { techniqueId: id('ap_chagi'), notes: 'Front kick to draw their guard down', transitionCue: 'Spin immediately' },
        { techniqueId: id('spinning_hook'), notes: 'Spinning hook kick to exposed head', transitionCue: 'Score 5 points' },
      ],
      difficulty: 'advanced', tags: ['combo', 'feint', 'head-kick', 'bonus-points'],
    },
  ]

  const counters: CounterSeed[] = [
    { id: 'tkd_ctr_1', techniqueId: id('dollyo_chagi'), counterTechniqueId: id('dwi_chagi'), effectiveness: 'high', notes: 'Back kick as they commit to roundhouse' },
    { id: 'tkd_ctr_2', techniqueId: id('dollyo_chagi'), counterTechniqueId: id('cut_kick'), effectiveness: 'high', notes: 'Cut kick to stop their roundhouse' },
    { id: 'tkd_ctr_3', techniqueId: id('ap_chagi'), counterTechniqueId: id('yeop_chagi'), effectiveness: 'medium', notes: 'Side kick as they front kick' },
    { id: 'tkd_ctr_4', techniqueId: id('dwi_chagi'), counterTechniqueId: id('dollyo_chagi'), effectiveness: 'medium', notes: 'Roundhouse as they spin (timing)' },
    { id: 'tkd_ctr_5', techniqueId: id('spinning_hook'), counterTechniqueId: id('ap_chagi'), effectiveness: 'high', notes: 'Front kick into them as they spin' },
  ]

  return { categories, entries, sequences, counters }
}
