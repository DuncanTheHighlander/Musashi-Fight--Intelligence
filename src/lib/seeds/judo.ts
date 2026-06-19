import type { DisciplineSeedData, CatSeed, EntrySeed, SeqSeed, CounterSeed } from '../taxonomySeed'

const id = (name: string) => `judo_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '')}`

export function getJudoData(): DisciplineSeedData {
  const categories: CatSeed[] = [
    { id: 'judo_cat_tewaza', discipline: 'judo', name: 'Te-waza (Hand Techniques)', parentId: null, description: 'Throws using primarily the arms', sortOrder: 1 },
    { id: 'judo_cat_koshiwaza', discipline: 'judo', name: 'Koshi-waza (Hip Techniques)', parentId: null, description: 'Hip throws', sortOrder: 2 },
    { id: 'judo_cat_ashiwaza', discipline: 'judo', name: 'Ashi-waza (Foot/Leg Techniques)', parentId: null, description: 'Foot sweeps and reaps', sortOrder: 3 },
    { id: 'judo_cat_newaza', discipline: 'judo', name: 'Ne-waza (Ground Techniques)', parentId: null, description: 'Pins, chokes, and armlocks', sortOrder: 4 },
    { id: 'judo_cat_gripping', discipline: 'judo', name: 'Kumi-kata (Gripping)', parentId: null, description: 'Grip fighting strategies', sortOrder: 5 },
  ]

  const entries: EntrySeed[] = [
    {
      id: id('osoto_gari'), categoryId: 'judo_cat_ashiwaza', discipline: 'judo', name: 'Osoto Gari (Major Outer Reap)',
      japaneseName: 'Osoto Gari', koreanName: null,
      description: 'Reap opponents leg from outside while driving them backward. One of judos most powerful throws. Break balance backward, step beside them, reap their leg.',
      keyPoints: ['Break balance backward (kuzushi)', 'Step deep beside them', 'Reap their leg with yours', 'Drive through with upper body'],
      commonMistakes: ['No kuzushi first', 'Not stepping deep enough', 'Reaping too low on the leg'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['throw', 'ashi-waza', 'reap', 'fundamental', 'power'], metadata: {}, effectivenessScore: 0.92,
    },
    {
      id: id('seoi_nage'), categoryId: 'judo_cat_tewaza', discipline: 'judo', name: 'Seoi Nage (Shoulder Throw)',
      japaneseName: 'Seoi Nage', koreanName: null,
      description: 'Turn in and throw opponent over your shoulder. Pull their arm, turn your back to them, load them on your back, throw.',
      keyPoints: ['Pull their arm forward', 'Turn in deep — back to their chest', 'Load them on your back/shoulder', 'Bend knees and throw over'],
      commonMistakes: ['Not turning in deep enough', 'Not bending knees', 'Opponent takes your back'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['throw', 'te-waza', 'shoulder-throw', 'fundamental'], metadata: {}, effectivenessScore: 0.9,
    },
    {
      id: id('uchi_mata'), categoryId: 'judo_cat_ashiwaza', discipline: 'judo', name: 'Uchi Mata (Inner Thigh Throw)',
      japaneseName: 'Uchi Mata', koreanName: null,
      description: 'Sweep opponents inner thigh while rotating. One of the most effective and popular judo throws at all levels.',
      keyPoints: ['Break balance forward', 'Sweep inner thigh with your leg', 'Rotate and pull with arms', 'Follow through with the throw'],
      commonMistakes: ['Sweeping too low', 'Not enough rotation', 'Poor balance on support leg'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['throw', 'ashi-waza', 'inner-thigh', 'popular'], metadata: {}, effectivenessScore: 0.93,
    },
    {
      id: id('harai_goshi'), categoryId: 'judo_cat_koshiwaza', discipline: 'judo', name: 'Harai Goshi (Sweeping Hip Throw)',
      japaneseName: 'Harai Goshi', koreanName: null,
      description: 'Hip throw combined with a sweeping leg action. Turn in, load on hip, sweep their legs with yours.',
      keyPoints: ['Turn in and load on hip', 'Sweep their legs with yours', 'Pull with arms', 'Drive through the throw'],
      commonMistakes: ['Not loading on hip', 'Sweep timing off', 'Not pulling hard enough'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['throw', 'koshi-waza', 'hip-throw', 'sweep'], metadata: {}, effectivenessScore: 0.88,
    },
    {
      id: id('ouchi_gari'), categoryId: 'judo_cat_ashiwaza', discipline: 'judo', name: 'Ouchi Gari (Major Inner Reap)',
      japaneseName: 'Ouchi Gari', koreanName: null,
      description: 'Reap opponents leg from inside while driving them backward. Often used as setup for other throws.',
      keyPoints: ['Break balance backward', 'Step inside and reap their leg', 'Drive forward with chest', 'Follow to ground'],
      commonMistakes: ['No kuzushi', 'Reaping wrong leg', 'Not driving forward'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['throw', 'ashi-waza', 'inner-reap', 'setup'], metadata: {}, effectivenessScore: 0.82,
    },
    {
      id: id('tai_otoshi'), categoryId: 'judo_cat_tewaza', discipline: 'judo', name: 'Tai Otoshi (Body Drop)',
      japaneseName: 'Tai Otoshi', koreanName: null,
      description: 'Turn and drop body in front of opponent, blocking their leg with yours. They trip over your extended leg.',
      keyPoints: ['Strong pull forward', 'Turn and extend blocking leg', 'Drop your center of gravity', 'Pull them over your leg'],
      commonMistakes: ['Blocking leg not extended enough', 'Not enough pull', 'Losing balance'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['throw', 'te-waza', 'body-drop', 'trip'], metadata: {}, effectivenessScore: 0.86,
    },
    {
      id: id('tomoe_nage'), categoryId: 'judo_cat_tewaza', discipline: 'judo', name: 'Tomoe Nage (Circle Throw / Stomach Throw)',
      japaneseName: 'Tomoe Nage', koreanName: null,
      description: 'Sacrifice throw. Fall backward, place foot on opponents stomach, throw them over you in a circle.',
      keyPoints: ['Pull them forward', 'Fall backward placing foot on stomach', 'Extend leg to throw them over', 'Roll to top position'],
      commonMistakes: ['Foot placement wrong', 'Not pulling enough', 'Ending up on bottom'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['throw', 'sacrifice', 'circle-throw', 'spectacular'], metadata: {}, effectivenessScore: 0.8,
    },
    {
      id: id('sasae'), categoryId: 'judo_cat_ashiwaza', discipline: 'judo', name: 'Sasae Tsurikomi Ashi (Propping Drawing Ankle)',
      japaneseName: 'Sasae Tsurikomi Ashi', koreanName: null,
      description: 'Block opponents ankle with your foot while pulling them forward and around. Timing-based throw.',
      keyPoints: ['Pull them forward and to the side', 'Block their ankle with sole of foot', 'Rotate them around the block point', 'Timing is everything'],
      commonMistakes: ['Bad timing', 'Not enough pull', 'Blocking too high on the leg'],
      difficulty: 'intermediate', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['throw', 'ashi-waza', 'foot-sweep', 'timing'], metadata: {}, effectivenessScore: 0.82,
    },
    {
      id: id('deashi_barai'), categoryId: 'judo_cat_ashiwaza', discipline: 'judo', name: 'De Ashi Barai (Forward Foot Sweep)',
      japaneseName: 'De Ashi Barai', koreanName: null,
      description: 'Sweep opponents advancing foot as they step. Pure timing technique. Considered the perfect judo throw.',
      keyPoints: ['Time the sweep as they step', 'Sweep sole-to-sole', 'Pull with arms in direction of sweep', 'Minimal force, maximum timing'],
      commonMistakes: ['Bad timing', 'Sweeping too hard (telegraphs)', 'Not pulling with arms'],
      difficulty: 'advanced', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['throw', 'ashi-waza', 'foot-sweep', 'timing', 'perfect'], metadata: {}, effectivenessScore: 0.88,
    },
    {
      id: id('juji_gatame'), categoryId: 'judo_cat_newaza', discipline: 'judo', name: 'Juji Gatame (Cross Armlock)',
      japaneseName: 'Juji Gatame', koreanName: null,
      description: 'Armbar from judo. Control arm, pinch knees, extend hips. Often transitioned to directly from throws.',
      keyPoints: ['Control the arm', 'Pinch knees tight', 'Hips against elbow', 'Extend hips to finish'],
      commonMistakes: ['Knees too wide', 'Not controlling arm', 'Opponent escapes before lock'],
      difficulty: 'intermediate', positionContext: 'ground_top', videoUrl: null, thumbnailUrl: null,
      tags: ['submission', 'armbar', 'ne-waza', 'fundamental'], metadata: {}, effectivenessScore: 0.9,
    },
    {
      id: id('kesa_gatame'), categoryId: 'judo_cat_newaza', discipline: 'judo', name: 'Kesa Gatame (Scarf Hold)',
      japaneseName: 'Kesa Gatame', koreanName: null,
      description: 'Pin with your side against opponents chest, arm wrapped around their head, controlling their arm. 20-second pin wins.',
      keyPoints: ['Side against their chest', 'Arm around their head', 'Control their arm under yours', 'Spread base wide'],
      commonMistakes: ['Not enough pressure', 'Base too narrow', 'Opponent bridges out'],
      difficulty: 'beginner', positionContext: 'ground_top', videoUrl: null, thumbnailUrl: null,
      tags: ['pin', 'osaekomi', 'ne-waza', 'fundamental'], metadata: {}, effectivenessScore: 0.82,
    },
    {
      id: id('sankaku_jime'), categoryId: 'judo_cat_newaza', discipline: 'judo', name: 'Sankaku Jime (Triangle Choke)',
      japaneseName: 'Sankaku Jime', koreanName: null,
      description: 'Triangle choke in judo. Legs form triangle around neck and one arm. Often set up from guard or turnovers.',
      keyPoints: ['One arm in one arm out', 'Lock triangle with legs', 'Squeeze and angle', 'Pull head down'],
      commonMistakes: ['Both arms in', 'Not angling', 'Triangle too loose'],
      difficulty: 'intermediate', positionContext: 'guard_bottom', videoUrl: null, thumbnailUrl: null,
      tags: ['submission', 'choke', 'triangle', 'ne-waza'], metadata: {}, effectivenessScore: 0.88,
    },
    {
      id: id('sleeve_grip'), categoryId: 'judo_cat_gripping', discipline: 'judo', name: 'Standard Sleeve-Lapel Grip',
      japaneseName: null, koreanName: null,
      description: 'Fundamental judo grip: one hand on sleeve, one on lapel. Controls opponents posture and movement.',
      keyPoints: ['Sleeve grip controls their arm', 'Lapel grip controls their posture', 'Fight for dominant grips', 'Break their grips before they settle'],
      commonMistakes: ['Passive gripping', 'Letting opponent get dominant grips', 'Not breaking grips'],
      difficulty: 'beginner', positionContext: 'standing', videoUrl: null, thumbnailUrl: null,
      tags: ['gripping', 'kumi-kata', 'fundamental', 'control'], metadata: {}, effectivenessScore: 0.8,
    },
  ]

  const sequences: SeqSeed[] = [
    {
      id: 'judo_seq_ouchi_seoi', discipline: 'judo', name: 'Ouchi Gari to Seoi Nage', description: 'Classic judo combination. Attack backward then forward.',
      steps: [
        { techniqueId: id('ouchi_gari'), notes: 'Attack with ouchi gari', transitionCue: 'As they resist backward, they lean forward' },
        { techniqueId: id('seoi_nage'), notes: 'Turn in for seoi nage on their forward reaction', transitionCue: 'Throw' },
      ],
      difficulty: 'intermediate', tags: ['combination', 'classic', 'action-reaction'],
    },
    {
      id: 'judo_seq_osoto_ouchi', discipline: 'judo', name: 'Osoto Gari to Ouchi Gari', description: 'Attack same direction, different legs.',
      steps: [
        { techniqueId: id('osoto_gari'), notes: 'Attack with osoto gari', transitionCue: 'If they shift weight, attack other leg' },
        { techniqueId: id('ouchi_gari'), notes: 'Ouchi gari on the other leg', transitionCue: 'Follow to ground' },
      ],
      difficulty: 'beginner', tags: ['combination', 'same-direction'],
    },
    {
      id: 'judo_seq_throw_to_pin', discipline: 'judo', name: 'Throw to Pin (Ippon Sequence)', description: 'Complete judo sequence from standing to ground.',
      steps: [
        { techniqueId: id('uchi_mata'), notes: 'Throw with uchi mata', transitionCue: 'Follow to ground immediately' },
        { techniqueId: id('kesa_gatame'), notes: 'Secure kesa gatame pin', transitionCue: 'Hold for 20 seconds or transition to submission' },
        { techniqueId: id('juji_gatame'), notes: 'If they escape pin, attack armbar', transitionCue: 'Finish' },
      ],
      difficulty: 'intermediate', tags: ['complete', 'standing-to-ground', 'ippon'],
    },
  ]

  const counters: CounterSeed[] = [
    { id: 'judo_ctr_1', techniqueId: id('osoto_gari'), counterTechniqueId: id('osoto_gari'), effectiveness: 'high', notes: 'Counter osoto with osoto (osoto gaeshi)' },
    { id: 'judo_ctr_2', techniqueId: id('seoi_nage'), counterTechniqueId: id('uchi_mata'), effectiveness: 'medium', notes: 'Step around and counter with uchi mata' },
    { id: 'judo_ctr_3', techniqueId: id('ouchi_gari'), counterTechniqueId: id('tai_otoshi'), effectiveness: 'medium', notes: 'Use their forward pressure for tai otoshi' },
    { id: 'judo_ctr_4', techniqueId: id('uchi_mata'), counterTechniqueId: id('osoto_gari'), effectiveness: 'high', notes: 'Block and counter with osoto' },
    { id: 'judo_ctr_5', techniqueId: id('tomoe_nage'), counterTechniqueId: id('kesa_gatame'), effectiveness: 'medium', notes: 'Dont follow them down, establish pin' },
  ]

  return { categories, entries, sequences, counters }
}
