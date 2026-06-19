import type { DisciplineSeedData, CatSeed, EntrySeed, SeqSeed, CounterSeed } from '../taxonomySeed'

const id = (name: string) => `karate_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '')}`

export function getKarateData(): DisciplineSeedData {
  const categories: CatSeed[] = [
    { id: 'kar_cat_punches', discipline: 'karate', name: 'Tsuki (Punches)', parentId: null, description: 'Punching techniques', sortOrder: 1 },
    { id: 'kar_cat_kicks', discipline: 'karate', name: 'Keri (Kicks)', parentId: null, description: 'Kicking techniques', sortOrder: 2 },
    { id: 'kar_cat_sweeps', discipline: 'karate', name: 'Ashi Barai (Sweeps)', parentId: null, description: 'Foot sweeps', sortOrder: 3 },
    { id: 'kar_cat_strategy', discipline: 'karate', name: 'Strategy & Timing', parentId: null, description: 'Distance and timing concepts', sortOrder: 4 },
  ]

  const entries: EntrySeed[] = [
    {
      id: id('gyaku_zuki'), categoryId: 'kar_cat_punches', discipline: 'karate', name: 'Gyaku Zuki (Reverse Punch)',
      japaneseName: 'Gyaku Zuki', koreanName: null,
      description: 'Rear hand straight punch. Primary scoring technique in sport karate. Explosive hip rotation from a bladed stance.',
      keyPoints: ['Explosive hip rotation', 'Drive from rear leg', 'Retract immediately', 'Bladed stance for distance'],
      commonMistakes: ['Telegraphing', 'No hip rotation', 'Leaning too far forward', 'Slow retraction'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['punch', 'reverse-punch', 'fundamental', 'scoring'], metadata: { range: 'long' }, effectivenessScore: 0.9,
    },
    {
      id: id('kizami_zuki'), categoryId: 'kar_cat_punches', discipline: 'karate', name: 'Kizami Zuki (Jab / Lead Punch)',
      japaneseName: 'Kizami Zuki', koreanName: null,
      description: 'Lead hand punch. Quick scoring technique. Used to set up combinations or score on its own with timing.',
      keyPoints: ['Snap from the shoulder', 'Step in with the punch', 'Retract fast', 'Use as setup or standalone'],
      commonMistakes: ['No body behind it', 'Telegraphing', 'Not retracting'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['punch', 'jab', 'lead-hand', 'fundamental'], metadata: { range: 'long' }, effectivenessScore: 0.8,
    },
    {
      id: id('oi_zuki'), categoryId: 'kar_cat_punches', discipline: 'karate', name: 'Oi Zuki (Lunge Punch)',
      japaneseName: 'Oi Zuki', koreanName: null,
      description: 'Stepping punch with the same hand as the stepping foot. Used in blitz attacks to close distance explosively.',
      keyPoints: ['Explosive forward step', 'Punch lands as foot lands', 'Full commitment', 'Drive through target'],
      commonMistakes: ['Punch before step (telegraphs)', 'Not enough commitment', 'Off balance after'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['punch', 'lunge-punch', 'blitz', 'closing-distance'], metadata: { range: 'long' }, effectivenessScore: 0.82,
    },
    {
      id: id('mawashi_geri'), categoryId: 'kar_cat_kicks', discipline: 'karate', name: 'Mawashi Geri (Roundhouse Kick)',
      japaneseName: 'Mawashi Geri', koreanName: null,
      description: 'Roundhouse kick to head scores 3 points (ippon). Chamber knee, snap kick, retract. Karate style uses more knee snap than Muay Thai.',
      keyPoints: ['Chamber knee high', 'Snap the kick (knee extension)', 'Ball of foot or instep', 'Retract quickly'],
      commonMistakes: ['No chamber', 'Kicking through (Muay Thai style)', 'Telegraphing', 'Off balance'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['kick', 'roundhouse', 'head-kick', 'scoring', 'ippon'], metadata: { range: 'mid' }, effectivenessScore: 0.9,
    },
    {
      id: id('mae_geri'), categoryId: 'kar_cat_kicks', discipline: 'karate', name: 'Mae Geri (Front Kick)',
      japaneseName: 'Mae Geri', koreanName: null,
      description: 'Front kick to body or face. Snap kick using ball of foot. Controls distance and scores.',
      keyPoints: ['Chamber knee high', 'Snap kick forward', 'Ball of foot strikes', 'Retract quickly'],
      commonMistakes: ['Pushing instead of snapping', 'No chamber', 'Kicking too low'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['kick', 'front-kick', 'fundamental', 'range-control'], metadata: { range: 'long' }, effectivenessScore: 0.82,
    },
    {
      id: id('ura_mawashi'), categoryId: 'kar_cat_kicks', discipline: 'karate', name: 'Ura Mawashi Geri (Hook Kick)',
      japaneseName: 'Ura Mawashi Geri', koreanName: null,
      description: 'Reverse roundhouse / hook kick. Comes from the opposite direction of a normal roundhouse. Deceptive and scores high.',
      keyPoints: ['Chamber like a front kick', 'Hook the kick around', 'Heel strikes the target', 'Deceptive angle'],
      commonMistakes: ['Telegraphing the hook', 'Missing the target', 'Off balance after'],
      difficulty: 'advanced', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['kick', 'hook-kick', 'deceptive', 'scoring', 'advanced'], metadata: { range: 'mid' }, effectivenessScore: 0.85,
    },
    {
      id: id('ashi_barai'), categoryId: 'kar_cat_sweeps', discipline: 'karate', name: 'Ashi Barai (Foot Sweep)',
      japaneseName: 'Ashi Barai', koreanName: null,
      description: 'Sweep opponents foot as they step. Follow with a punch for ippon (3 points). Timing-based technique.',
      keyPoints: ['Time the sweep on their step', 'Sweep low at the ankle', 'Follow immediately with punch', 'Sweep + punch = ippon'],
      commonMistakes: ['Bad timing', 'Sweeping too high', 'Not following with punch'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['sweep', 'foot-sweep', 'timing', 'ippon-setup'], metadata: { range: 'close' }, effectivenessScore: 0.88,
    },
    {
      id: id('blitz_entry'), categoryId: 'kar_cat_strategy', discipline: 'karate', name: 'Blitz Attack (Sen no Sen)',
      japaneseName: null, koreanName: null,
      description: 'Explosive forward movement to close distance and score. Commit fully to the attack. Key karate strategy.',
      keyPoints: ['Explosive first step', 'Full commitment', 'Attack on their preparation', 'Multiple technique options on entry'],
      commonMistakes: ['Telegraphing', 'Half-committed', 'Running into a counter'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['strategy', 'blitz', 'sen-no-sen', 'closing-distance'], metadata: {}, effectivenessScore: 0.85,
    },
    {
      id: id('counter_timing'), categoryId: 'kar_cat_strategy', discipline: 'karate', name: 'Go no Sen (Counter After Attack)',
      japaneseName: null, koreanName: null,
      description: 'Counter-attacking after evading or blocking opponents attack. Step back, let them miss, counter immediately.',
      keyPoints: ['Read their attack', 'Step back or angle off', 'Counter immediately as they miss', 'Timing over speed'],
      commonMistakes: ['Stepping back too far', 'Slow counter', 'Not reading the attack'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['strategy', 'counter', 'go-no-sen', 'timing'], metadata: {}, effectivenessScore: 0.87,
    },
    {
      id: id('deai'), categoryId: 'kar_cat_strategy', discipline: 'karate', name: 'Deai (Intercepting)',
      japaneseName: null, koreanName: null,
      description: 'Intercepting opponents attack with your own technique. Strike them as they initiate. Highest level of timing.',
      keyPoints: ['Read their intention', 'Attack as they start', 'Your technique arrives first', 'Requires excellent maai (distance)'],
      commonMistakes: ['Too early (they havent committed)', 'Too late (you get hit)', 'Wrong distance'],
      difficulty: 'advanced', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['strategy', 'intercepting', 'deai', 'advanced', 'timing'], metadata: {}, effectivenessScore: 0.9,
    },
  ]

  const sequences: SeqSeed[] = [
    {
      id: 'kar_seq_kizami_gyaku', discipline: 'karate', name: 'Kizami Zuki - Gyaku Zuki', description: 'Fundamental karate combination. Jab then reverse punch.',
      steps: [
        { techniqueId: id('kizami_zuki'), notes: 'Lead hand to set range', transitionCue: 'Immediately follow with reverse punch' },
        { techniqueId: id('gyaku_zuki'), notes: 'Reverse punch with full hip rotation', transitionCue: 'Retract and reset' },
      ],
      difficulty: 'beginner', tags: ['combo', 'fundamental'],
    },
    {
      id: 'kar_seq_sweep_punch', discipline: 'karate', name: 'Ashi Barai - Gyaku Zuki (Ippon)', description: 'Sweep followed by punch for maximum points.',
      steps: [
        { techniqueId: id('ashi_barai'), notes: 'Sweep their front foot', transitionCue: 'As they fall' },
        { techniqueId: id('gyaku_zuki'), notes: 'Punch immediately for ippon', transitionCue: 'Score' },
      ],
      difficulty: 'intermediate', tags: ['combo', 'ippon', 'sweep-punch'],
    },
    {
      id: 'kar_seq_blitz_combo', discipline: 'karate', name: 'Blitz Entry - Kizami - Mawashi Geri', description: 'Close distance and attack with hand-kick combo.',
      steps: [
        { techniqueId: id('blitz_entry'), notes: 'Explosive entry', transitionCue: 'Into jab' },
        { techniqueId: id('kizami_zuki'), notes: 'Jab to occupy guard', transitionCue: 'Into head kick' },
        { techniqueId: id('mawashi_geri'), notes: 'Head kick for ippon', transitionCue: 'Score and reset' },
      ],
      difficulty: 'advanced', tags: ['combo', 'blitz', 'ippon'],
    },
  ]

  const counters: CounterSeed[] = [
    { id: 'kar_ctr_1', techniqueId: id('gyaku_zuki'), counterTechniqueId: id('counter_timing'), effectiveness: 'high', notes: 'Step back and counter as they extend' },
    { id: 'kar_ctr_2', techniqueId: id('mawashi_geri'), counterTechniqueId: id('gyaku_zuki'), effectiveness: 'high', notes: 'Step in under the kick and punch' },
    { id: 'kar_ctr_3', techniqueId: id('blitz_entry'), counterTechniqueId: id('deai'), effectiveness: 'high', notes: 'Intercept their blitz with your own attack' },
    { id: 'kar_ctr_4', techniqueId: id('oi_zuki'), counterTechniqueId: id('ashi_barai'), effectiveness: 'high', notes: 'Sweep as they step in' },
    { id: 'kar_ctr_5', techniqueId: id('mae_geri'), counterTechniqueId: id('gyaku_zuki'), effectiveness: 'medium', notes: 'Angle off the kick and counter punch' },
  ]

  return { categories, entries, sequences, counters }
}
