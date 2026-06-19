import type { DisciplineSeedData, CatSeed, EntrySeed, SeqSeed, CounterSeed } from '../taxonomySeed'

const id = (name: string) => `mma_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '')}`

export function getMmaData(): DisciplineSeedData {
  const categories: CatSeed[] = [
    { id: 'mma_cat_striking', discipline: 'mma', name: 'MMA Striking', parentId: null, description: 'Striking adapted for MMA', sortOrder: 1 },
    { id: 'mma_cat_clinch', discipline: 'mma', name: 'Cage Clinch & Dirty Boxing', parentId: null, description: 'Clinch work against the cage', sortOrder: 2 },
    { id: 'mma_cat_takedowns', discipline: 'mma', name: 'MMA Takedowns', parentId: null, description: 'Takedowns adapted for MMA', sortOrder: 3 },
    { id: 'mma_cat_td_defense', discipline: 'mma', name: 'Takedown Defense', parentId: null, description: 'Stuffing shots and cage work', sortOrder: 4 },
    { id: 'mma_cat_ground', discipline: 'mma', name: 'Ground & Pound', parentId: null, description: 'Striking from grappling positions', sortOrder: 5 },
    { id: 'mma_cat_transitions', discipline: 'mma', name: 'Range Transitions', parentId: null, description: 'Moving between striking, clinch, and ground', sortOrder: 6 },
  ]

  const entries: EntrySeed[] = [
    {
      id: id('ground_and_pound'), categoryId: 'mma_cat_ground', discipline: 'mma', name: 'Ground and Pound',
      japaneseName: null, koreanName: null,
      description: 'Striking from dominant grappling position. Use posture to generate power, alternate hands, target openings. Forces opponent to defend strikes opening submissions.',
      keyPoints: ['Posture up to generate power', 'Alternate hands', 'Target openings in guard', 'Maintain position while striking'],
      commonMistakes: ['Losing position while striking', 'Punching without posture', 'Getting swept while striking'],
      difficulty: 'intermediate', positionContext: 'mount_top', videoUrl: null, thumbnailUrl: null,
      tags: ['ground-and-pound', 'striking', 'top-control', 'finishing'], metadata: { positions: ['mount_top', 'side_control_top', 'guard_top', 'half_guard_top'] }, effectivenessScore: 0.9,
    },
    {
      id: id('wall_walk'), categoryId: 'mma_cat_td_defense', discipline: 'mma', name: 'Wall Walk',
      japaneseName: null, koreanName: null,
      description: 'Getting back to feet when pressed against cage. Walk hands up cage while hip-escaping, create frames, time stand-up.',
      keyPoints: ['Keep back against cage for support', 'Create space with frames', 'Walk hands up the cage', 'Explode up when they adjust'],
      commonMistakes: ['Not using cage for support', 'Standing up without frames', 'Getting taken down again immediately'],
      difficulty: 'intermediate', positionContext: 'cage_clinch_bottom', videoUrl: null, thumbnailUrl: null,
      tags: ['cage-work', 'wall-walk', 'escape', 'defense'], metadata: {}, effectivenessScore: 0.82,
    },
    {
      id: id('dirty_boxing'), categoryId: 'mma_cat_clinch', discipline: 'mma', name: 'Dirty Boxing',
      japaneseName: null, koreanName: null,
      description: 'Close-range punching from clinch. Use collar ties, underhooks, and wrist control for short hooks, uppercuts, and elbows.',
      keyPoints: ['Inside position is key', 'Short punches — hooks and uppercuts', 'Knees to body', 'Control head position'],
      commonMistakes: ['Throwing long punches in clinch', 'No head control', 'Getting taken down'],
      difficulty: 'advanced', positionContext: 'clinch', videoUrl: null, thumbnailUrl: null,
      tags: ['clinch', 'dirty-boxing', 'striking', 'close-range'], metadata: {}, effectivenessScore: 0.86,
    },
    {
      id: id('cage_clinch'), categoryId: 'mma_cat_clinch', discipline: 'mma', name: 'Cage Clinch Control',
      japaneseName: null, koreanName: null,
      description: 'Pressing opponent against the cage for control. Use underhooks, body lock, or double collar tie. Set up takedowns or dirty boxing.',
      keyPoints: ['Chest-to-chest pressure', 'Underhooks or body lock', 'Use cage as third hand', 'Set up takedowns or strikes'],
      commonMistakes: ['No pressure', 'Stalling without attacking', 'Opponent wall walks out'],
      difficulty: 'intermediate', positionContext: 'cage_clinch', videoUrl: null, thumbnailUrl: null,
      tags: ['clinch', 'cage', 'control', 'pressure'], metadata: {}, effectivenessScore: 0.83,
    },
    {
      id: id('td_defense_sprawl'), categoryId: 'mma_cat_td_defense', discipline: 'mma', name: 'MMA Takedown Defense',
      japaneseName: null, koreanName: null,
      description: 'Defending wrestling takedowns in MMA. Sprawl on shots, use underhooks to prevent body locks, frame on head.',
      keyPoints: ['Stance width matters', 'Hand fighting', 'Sprawl on doubles/singles', 'Underhooks prevent body locks'],
      commonMistakes: ['Stance too narrow', 'Hands too low', 'Not sprawling early enough'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['takedown-defense', 'sprawl', 'defense', 'fundamental'], metadata: {}, effectivenessScore: 0.87,
    },
    {
      id: id('level_change_shot'), categoryId: 'mma_cat_takedowns', discipline: 'mma', name: 'MMA Level Change to Takedown',
      japaneseName: null, koreanName: null,
      description: 'Setting up takedowns with strikes in MMA. Jab to occupy vision, level change, shoot. The threat of strikes opens takedowns.',
      keyPoints: ['Jab or feint first', 'Level change off the punch', 'Shoot while they react to strikes', 'Head position inside'],
      commonMistakes: ['Shooting without setup', 'Telegraphing the level change', 'Head down (guillotine risk)'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['takedown', 'level-change', 'setup', 'mma-specific'], metadata: {}, effectivenessScore: 0.88,
    },
    {
      id: id('cage_takedown'), categoryId: 'mma_cat_takedowns', discipline: 'mma', name: 'Cage Takedown (Body Lock)',
      japaneseName: null, koreanName: null,
      description: 'Takedown against the cage using body lock. Press opponent to cage, secure body lock, trip or lift.',
      keyPoints: ['Press them to cage first', 'Secure body lock', 'Trip the far leg', 'Use cage as leverage'],
      commonMistakes: ['No cage pressure', 'Grip breaks', 'Opponent wall walks'],
      difficulty: 'intermediate', positionContext: 'cage_clinch', videoUrl: null, thumbnailUrl: null,
      tags: ['takedown', 'cage', 'body-lock', 'clinch'], metadata: {}, effectivenessScore: 0.85,
    },
    {
      id: id('elbows_from_guard'), categoryId: 'mma_cat_ground', discipline: 'mma', name: 'Elbows from Guard (Bottom)',
      japaneseName: null, koreanName: null,
      description: 'Striking with elbows from bottom guard position. Pull opponent down, deliver short elbows to cut or damage.',
      keyPoints: ['Control their posture', 'Short sharp elbows', 'Target forehead for cuts', 'Use to set up sweeps or submissions'],
      commonMistakes: ['Opponent postures up', 'Elbows too wide', 'Not following up'],
      difficulty: 'intermediate', positionContext: 'guard_bottom', videoUrl: null, thumbnailUrl: null,
      tags: ['ground', 'elbows', 'guard', 'bottom', 'striking'], metadata: {}, effectivenessScore: 0.75,
    },
    {
      id: id('standing_up_from_guard'), categoryId: 'mma_cat_transitions', discipline: 'mma', name: 'Technical Stand-Up from Guard',
      japaneseName: null, koreanName: null,
      description: 'Getting back to feet from bottom guard. Create distance with kicks, technical stand-up, or wall walk.',
      keyPoints: ['Push them away with feet on hips', 'Technical stand-up (post hand, stand)', 'Keep distance as you rise', 'Dont turn your back'],
      commonMistakes: ['Standing up into punches', 'Turning back to opponent', 'Not creating distance first'],
      difficulty: 'intermediate', positionContext: 'guard_bottom', videoUrl: null, thumbnailUrl: null,
      tags: ['transition', 'stand-up', 'guard', 'escape'], metadata: {}, effectivenessScore: 0.8,
    },
    {
      id: id('clinch_to_strike'), categoryId: 'mma_cat_transitions', discipline: 'mma', name: 'Clinch Break to Striking',
      japaneseName: null, koreanName: null,
      description: 'Breaking from clinch back to striking range. Frame, create space, exit with a strike.',
      keyPoints: ['Frame on their chest/neck', 'Push off explosively', 'Exit with a strike (hook or knee)', 'Reset at range'],
      commonMistakes: ['Pushing without framing', 'Not striking on exit', 'Getting pulled back in'],
      difficulty: 'intermediate', positionContext: 'clinch', videoUrl: null, thumbnailUrl: null,
      tags: ['transition', 'clinch-break', 'striking', 'range-change'], metadata: {}, effectivenessScore: 0.8,
    },
  ]

  const sequences: SeqSeed[] = [
    {
      id: 'mma_seq_jab_takedown', discipline: 'mma', name: 'Jab-Level Change-Takedown', description: 'Use striking to set up wrestling.',
      steps: [
        { techniqueId: 'box_jab', notes: 'Jab to occupy their vision', transitionCue: 'Level change off the jab' },
        { techniqueId: id('level_change_shot'), notes: 'Shoot as they react to jab', transitionCue: 'Finish takedown' },
      ],
      difficulty: 'intermediate', tags: ['mma', 'setup', 'striking-to-grappling'],
    },
    {
      id: 'mma_seq_td_gnp', discipline: 'mma', name: 'Takedown-Pass-Ground and Pound', description: 'Complete top game MMA sequence.',
      steps: [
        { techniqueId: id('level_change_shot'), notes: 'Secure takedown', transitionCue: 'Pass guard' },
        { techniqueId: 'bjj_knee_slice_pass', notes: 'Pass to side control', transitionCue: 'Advance to mount' },
        { techniqueId: id('ground_and_pound'), notes: 'Ground and pound from mount', transitionCue: 'Finish or submit' },
      ],
      difficulty: 'intermediate', tags: ['mma', 'complete', 'top-game'],
    },
    {
      id: 'mma_seq_sprawl_dirty_box', discipline: 'mma', name: 'Sprawl-Dirty Boxing-Knee', description: 'Defend takedown into clinch offense.',
      steps: [
        { techniqueId: id('td_defense_sprawl'), notes: 'Sprawl on their shot', transitionCue: 'Secure clinch' },
        { techniqueId: id('dirty_boxing'), notes: 'Short punches in clinch', transitionCue: 'Create space for knee' },
        { techniqueId: 'mt_straight_knee', notes: 'Knee to body', transitionCue: 'Reset or continue clinch' },
      ],
      difficulty: 'advanced', tags: ['mma', 'defense-to-offense', 'clinch'],
    },
  ]

  const counters: CounterSeed[] = [
    { id: 'mma_ctr_1', techniqueId: id('level_change_shot'), counterTechniqueId: id('td_defense_sprawl'), effectiveness: 'high', notes: 'Sprawl and crossface' },
    { id: 'mma_ctr_2', techniqueId: id('cage_clinch'), counterTechniqueId: id('wall_walk'), effectiveness: 'high', notes: 'Wall walk back to feet' },
    { id: 'mma_ctr_3', techniqueId: id('ground_and_pound'), counterTechniqueId: id('standing_up_from_guard'), effectiveness: 'medium', notes: 'Create distance and stand up' },
    { id: 'mma_ctr_4', techniqueId: id('dirty_boxing'), counterTechniqueId: id('clinch_to_strike'), effectiveness: 'medium', notes: 'Frame and break to striking range' },
  ]

  return { categories, entries, sequences, counters }
}
