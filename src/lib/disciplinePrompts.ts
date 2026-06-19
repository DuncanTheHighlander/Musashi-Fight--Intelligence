/**
 * Discipline-specific coaching prompts for Musashi AI.
 * Each discipline has its own vocabulary, techniques, and coaching style.
 * Used to augment the base system prompt with discipline-aware context.
 */

export type Discipline =
  | 'boxing'
  | 'kickboxing'
  | 'muay_thai'
  | 'mma'
  | 'wrestling'
  | 'bjj'
  | 'judo'
  | 'karate'
  | 'taekwondo'
  | 'sumo'
  | 'sambo'
  | 'other'
  | 'unknown'

export interface DisciplineProfile {
  name: string
  coachingFocus: string
  keyTechniques: string[]
  positionNames: string[]
  commonCues: string[]
  scoringSystem?: string
  promptBlock: string
}

export const DISCIPLINE_PROFILES: Record<Discipline, DisciplineProfile> = {
  boxing: {
    name: 'Boxing',
    coachingFocus: 'Hands, footwork, head movement, ring generalship',
    keyTechniques: ['jab', 'cross', 'hook', 'uppercut', 'body shot', 'check hook', 'pull counter', 'slip', 'roll', 'parry', 'shoulder roll'],
    positionNames: ['orthodox', 'southpaw', 'philly shell', 'peek-a-boo', 'high guard'],
    commonCues: [
      'Double up the jab',
      'Pivot off the back foot',
      'Hands up after every combination',
      'Sit down on the cross',
      'Jab to the body to bring the guard down',
    ],
    scoringSystem: '10-point must system; clean punches, effective aggression, ring generalship, defense',
    promptBlock: `DISCIPLINE: BOXING
You are coaching a boxer. Focus on:
- Punch selection and combination flow (jab, cross, hook, uppercut, body shots)
- Footwork: pivots, angles, lateral movement, cutting off the ring
- Head movement: slips, rolls, pulls, level changes
- Guard position: high guard, philly shell, peek-a-boo
- Ring generalship: controlling center, cutting angles, managing distance
- Defense: parries, catches, shoulder rolls, clinch entries
Use boxing terminology: "sit down on the cross", "double the jab", "pivot off the back foot", "work the body".
Reference specific punch names and combinations (1-2, 1-1-2, 3-2, etc.).`,
  },

  kickboxing: {
    name: 'Kickboxing',
    coachingFocus: 'Kicks + hands, distance management, leg kicks',
    keyTechniques: ['jab', 'cross', 'hook', 'roundhouse kick', 'front kick', 'side kick', 'spinning back kick', 'low kick', 'body kick', 'head kick', 'switch kick'],
    positionNames: ['orthodox', 'southpaw', 'bladed stance', 'square stance'],
    commonCues: [
      'Check that low kick',
      'Teep to reset range',
      'Set up the head kick with the body kick',
      'Return the kicking leg fast',
      'Use the jab to measure distance for the kick',
    ],
    promptBlock: `DISCIPLINE: KICKBOXING
You are coaching a kickboxer. Focus on:
- Kick selection: roundhouse (low/body/head), front kick (teep), side kick, spinning techniques
- Punch-kick combinations: setting up kicks with hands and vice versa
- Distance management: teep to control range, angle off after kicking
- Low kick defense: checking, catching, stepping out
- Stance and balance: weight distribution for quick kicks, recovery after throwing
Use kickboxing terminology: "check the low kick", "teep to reset", "switch kick", "Dutch-style combinations".`,
  },

  muay_thai: {
    name: 'Muay Thai',
    coachingFocus: 'Eight weapons, clinch, elbows, knees, sweeps',
    keyTechniques: ['teep', 'roundhouse', 'elbow', 'knee', 'clinch', 'sweep', 'dump', 'catch and kick', 'long guard', 'plum clinch', 'body kick'],
    positionNames: ['muay thai stance', 'long guard', 'plum clinch', 'single collar tie', 'double collar tie'],
    commonCues: [
      'Plum clinch — drive the knee',
      'Catch the kick and sweep',
      'Use the long guard to control range',
      'Elbow on the break',
      'Turn the hip over on the kick',
    ],
    scoringSystem: 'Judges favor clean techniques, kicks over punches, knees and elbows score high, sweeps and dumps score',
    promptBlock: `DISCIPLINE: MUAY THAI
You are coaching a nak muay (Muay Thai fighter). Focus on:
- All 8 weapons: fists, elbows, knees, shins
- Clinch work: plum clinch, single/double collar tie, knee strikes in clinch, sweeps, dumps
- Kick technique: turning the hip, kicking through the target, checking kicks
- Elbow strikes: horizontal, diagonal, spinning, uppercut elbow
- Teep (push kick): offensive and defensive use
- Sweep and dump techniques from kick catches
Use Muay Thai terminology: "plum", "teep", "sok" (elbow), "khao" (knee), "tiip", "sweep the base leg".`,
  },

  wrestling: {
    name: 'Wrestling',
    coachingFocus: 'Takedowns, scrambles, mat returns, riding, escapes',
    keyTechniques: ['single leg', 'double leg', 'high crotch', 'fireman\'s carry', 'ankle pick', 'snap down', 'front headlock', 'sprawl', 'underhook', 'overhook', 'cradle', 'half nelson', 'arm bar (wrestling)', 'gut wrench', 'tilt'],
    positionNames: ['neutral', 'top/referee\'s position', 'bottom/referee\'s position', 'front headlock', 'underhook position'],
    commonCues: [
      'Level change — shoot the double',
      'Underhook and circle',
      'Hand fight — clear the tie',
      'Sprawl and crossface',
      'Stand up from bottom — tripod base',
    ],
    scoringSystem: 'Takedown: 2pts, Reversal: 2pts, Escape: 1pt, Near fall: 2-3pts, Riding time: 1pt',
    promptBlock: `DISCIPLINE: WRESTLING
You are coaching a wrestler. Focus on:
- Takedowns: single leg, double leg, high crotch, fireman's carry, ankle pick, snap down
- Hand fighting: clearing ties, establishing underhooks, pummeling
- Sprawl defense: hips down, crossface, front headlock counters
- Mat wrestling: rides, tilts, gut wrenches, cradles, half nelsons
- Escapes: stand-up, sit-out, switch, granby roll
- Scrambles: chain wrestling, re-attacks, go-behinds
Use wrestling terminology: "level change", "penetration step", "underhook", "pummel", "sprawl and crossface", "re-attack".`,
  },

  bjj: {
    name: 'Brazilian Jiu-Jitsu',
    coachingFocus: 'Guard, passes, sweeps, submissions, positional hierarchy',
    keyTechniques: ['armbar', 'triangle', 'kimura', 'guillotine', 'rear naked choke', 'omoplata', 'sweep', 'guard pass', 'back take', 'mount', 'side control', 'knee on belly', 'half guard', 'closed guard', 'open guard', 'de la riva', 'berimbolo', 'leg lock'],
    positionNames: ['closed guard', 'open guard', 'half guard', 'butterfly guard', 'de la riva', 'spider guard', 'mount', 'side control', 'back mount', 'north-south', 'knee on belly', 'turtle'],
    commonCues: [
      'Frame on the hip — don\'t let them flatten you',
      'Pummel for the underhook',
      'Trap the arm for the kimura',
      'Break the grip and re-guard',
      'Hip escape to create space',
    ],
    scoringSystem: 'IBJJF: Takedown 2pts, Sweep 2pts, Guard pass 3pts, Mount 4pts, Back mount 4pts, Knee on belly 2pts, Advantage, Submission = instant win',
    promptBlock: `DISCIPLINE: BRAZILIAN JIU-JITSU
You are coaching a BJJ practitioner. Focus on:
- Positional hierarchy: back mount > mount > knee on belly > side control > half guard > guard
- Guard game: closed guard attacks, open guard retention, sweeps, submissions from guard
- Passing: pressure passing, speed passing, leg drags, knee cuts, torreando
- Submissions: armbar, triangle, kimura, guillotine, RNC, omoplata, leg locks
- Escapes: hip escape (shrimp), bridge and roll, frame and re-guard
- Transitions: chaining positions, scramble awareness, back takes
Use BJJ terminology: "shrimp", "frame", "underhook", "re-guard", "knee cut", "berimbolo", "de la riva".
Reference positions precisely: "from closed guard", "in side control", "from half guard bottom".`,
  },

  judo: {
    name: 'Judo',
    coachingFocus: 'Grips, throws, newaza, combinations',
    keyTechniques: ['osoto gari', 'ouchi gari', 'seoi nage', 'uchi mata', 'harai goshi', 'tai otoshi', 'tomoe nage', 'ko soto gake', 'sasae tsurikomi ashi', 'juji gatame', 'osaekomi', 'sankaku jime'],
    positionNames: ['tachi-waza (standing)', 'ne-waza (ground)', 'kumi-kata (gripping)'],
    commonCues: [
      'Dominate the sleeve grip',
      'Load the hip for osoto gari',
      'Break balance forward then attack',
      'Combination: ouchi to seoi nage',
      'Transition to newaza on the throw',
    ],
    scoringSystem: 'Ippon (full throw/submission/30s pin) = instant win, Waza-ari (half throw/20s pin), Two waza-ari = ippon',
    promptBlock: `DISCIPLINE: JUDO
You are coaching a judoka. Focus on:
- Kumi-kata (gripping): sleeve grip, lapel grip, grip fighting, breaking grips
- Kuzushi (breaking balance): pulling, pushing, circular movement
- Nage-waza (throws): hip throws, hand throws, foot sweeps, sacrifice throws
- Ne-waza (ground): pins (osaekomi), armlocks (juji gatame), chokes (shime-waza)
- Combination attacks: chaining throws, feints to throws, counter-throws
- Transition from standing to ground
Use Japanese terminology: "osoto gari", "seoi nage", "uchi mata", "kuzushi", "kumi-kata".
Reference the throwing mechanics: "load the hip", "turn in", "pull and rotate", "sweep the leg".`,
  },

  karate: {
    name: 'Karate',
    coachingFocus: 'Distance, timing, blitzes, counter-attacks',
    keyTechniques: ['gyaku-zuki', 'oi-zuki', 'mawashi geri', 'mae geri', 'ura mawashi geri', 'ashi-barai', 'kizami-zuki', 'yoko geri'],
    positionNames: ['zenkutsu-dachi', 'kokutsu-dachi', 'fighting stance', 'side-on stance'],
    commonCues: [
      'Gyaku-zuki off the back hand',
      'Ashi-barai timing on their step',
      'Blitz entry — close distance explosively',
      'Counter off the backstep',
      'Control the distance with mae geri',
    ],
    scoringSystem: 'WKF: Yuko (1pt punch), Waza-ari (2pt kick to body), Ippon (3pt kick to head/sweep + punch)',
    promptBlock: `DISCIPLINE: KARATE
You are coaching a karateka. Focus on:
- Distance management: staying at kicking range, explosive entries
- Timing: counter-attacks, deai (intercepting), go-no-sen (after the attack)
- Blitz attacks: explosive forward movement with technique
- Foot sweeps (ashi-barai): timing sweeps on opponent's step
- Kicks: mawashi geri, mae geri, ura mawashi geri, yoko geri
- Punches: gyaku-zuki (reverse punch), kizami-zuki (jab), oi-zuki (lunge punch)
Use karate terminology: "gyaku-zuki", "mawashi geri", "ashi-barai", "deai", "maai" (distance).`,
  },

  taekwondo: {
    name: 'Taekwondo',
    coachingFocus: 'Kicks, spinning techniques, scoring, footwork',
    keyTechniques: ['dollyo chagi', 'ap chagi', 'yeop chagi', 'dwi chagi', 'naeryeo chagi', 'bandal chagi', 'tornado kick', 'spinning hook kick', 'cut kick'],
    positionNames: ['fighting stance', 'open stance', 'closed stance', 'side stance'],
    commonCues: [
      'Dollyo chagi to the body for points',
      'Back kick counter when they rush',
      'Cut kick to stop their attack',
      'Spinning hook kick off the feint',
      'Fast feet — bounce and change angles',
    ],
    scoringSystem: 'WT: Body kick 2pts, Head kick 3pts, Spinning body 4pts, Spinning head 5pts, Punch to body 1pt',
    promptBlock: `DISCIPLINE: TAEKWONDO
You are coaching a taekwondo fighter. Focus on:
- Scoring kicks: dollyo chagi (roundhouse), ap chagi (front kick), yeop chagi (side kick)
- Spinning techniques: dwi chagi (back kick), spinning hook kick, tornado kick (bonus points)
- Footwork: bouncing, angle changes, distance control
- Cut kicks: stopping opponent's attacks with fast checking kicks
- Head kicks: naeryeo chagi (axe kick), high dollyo chagi, spinning head kicks
- Electronic scoring: clean contact to scoring zones
Use taekwondo terminology: "dollyo chagi", "dwi chagi", "ap chagi", "bandal chagi".`,
  },

  sumo: {
    name: 'Sumo',
    coachingFocus: 'Tachi-ai, grip fighting, ring awareness, kimarite',
    keyTechniques: ['tachi-ai', 'oshi-dashi', 'yori-kiri', 'uwate-nage', 'shitate-nage', 'hataki-komi', 'tsuki-dashi', 'henka'],
    positionNames: ['tachi-ai (initial charge)', 'migi-yotsu (right inside)', 'hidari-yotsu (left inside)', 'oshi (pushing)'],
    commonCues: [
      'Low tachi-ai — get under their center',
      'Yorikiri — drive forward with inside grip',
      'Keep your hips low and centered',
      'Mawashi grip — control the belt',
      'Ring awareness — know where the tawara is',
    ],
    promptBlock: `DISCIPLINE: SUMO
You are coaching a sumotori (sumo wrestler). Focus on:
- Tachi-ai (initial charge): low, explosive, winning the first contact
- Grip fighting: mawashi (belt) grips, inside vs outside position
- Pushing techniques: oshi-dashi (push out), tsuki-dashi (thrust out)
- Throwing techniques: uwate-nage (overarm throw), shitate-nage (underarm throw)
- Ring awareness: position relative to tawara (straw bales), avoiding ring-out
- Kimarite (winning techniques): 82 official winning moves
Use sumo terminology: "tachi-ai", "mawashi", "yorikiri", "oshi-dashi", "hataki-komi".`,
  },

  sambo: {
    name: 'Sambo',
    coachingFocus: 'Throws, leg locks, ground control, jacket wrestling',
    keyTechniques: ['leg lock', 'knee bar', 'ankle lock', 'throw', 'takedown', 'ground control', 'arm lock'],
    positionNames: ['standing', 'ground top', 'ground bottom', 'leg entanglement'],
    commonCues: [
      'Attack the legs — sambo specializes in leg locks',
      'Use the jacket for grips and throws',
      'Transition from throw to ground control',
      'Knee bar from the scramble',
      'Control the hips for the ankle lock',
    ],
    promptBlock: `DISCIPLINE: SAMBO
You are coaching a sambo practitioner. Focus on:
- Throws: judo-style throws adapted for sambo jacket, wrestling takedowns
- Leg locks: knee bars, ankle locks, toe holds (legal in sport sambo)
- Ground control: pins, transitions, maintaining top position
- Jacket grips: using the kurtka (sambo jacket) for control and throws
- Scramble wrestling: chain attacks, transitions between standing and ground
Use sambo terminology and reference both sport sambo and combat sambo contexts.`,
  },

  mma: {
    name: 'Mixed Martial Arts',
    coachingFocus: 'Range transitions, cage work, ground-and-pound, all ranges',
    keyTechniques: ['takedown defense', 'cage clinch', 'ground and pound', 'wall walk', 'sprawl', 'submission defense', 'dirty boxing', 'leg kicks', 'elbows from guard'],
    positionNames: ['striking range', 'clinch range', 'cage clinch', 'ground top', 'ground bottom', 'guard', 'half guard', 'mount', 'back control'],
    commonCues: [
      'Sprawl and circle off the cage',
      'Wall walk to get back to your feet',
      'Dirty boxing in the clinch',
      'Ground and pound — posture up and strike',
      'Manage distance — don\'t get stuck in the pocket',
    ],
    scoringSystem: 'Unified Rules: 10-point must, effective striking, grappling, aggression, cage control',
    promptBlock: `DISCIPLINE: MIXED MARTIAL ARTS
You are coaching an MMA fighter. Focus on:
- Range management: striking range, clinch, ground — and transitions between them
- Takedown offense and defense: level changes, sprawls, underhooks
- Cage work: clinch against the cage, wall walking, dirty boxing
- Ground game: guard passing, ground and pound, submissions, sweeps
- Striking: boxing, kicks, knees, elbows — adapted for MMA (smaller gloves, takedown threat)
- Fight IQ: when to strike vs grapple, energy management, reading the opponent
Reference specific MMA contexts: "cage clinch", "wall walk", "ground and pound", "dirty boxing".`,
  },

  other: {
    name: 'General Martial Arts',
    coachingFocus: 'Universal combat principles',
    keyTechniques: [],
    positionNames: [],
    commonCues: [],
    promptBlock: `DISCIPLINE: GENERAL MARTIAL ARTS
Provide coaching based on universal combat principles: distance management, timing, balance, technique execution, and tactical awareness.`,
  },

  unknown: {
    name: 'Auto-Detect',
    coachingFocus: 'Observe and identify the discipline from visual cues',
    keyTechniques: [],
    positionNames: [],
    commonCues: [],
    promptBlock: `DISCIPLINE: AUTO-DETECT
First identify the martial art being practiced from visual cues:
- Gloves type (boxing gloves, MMA gloves, none)
- Attire (gi/kimono, shorts, rashguard, mawashi belt)
- Techniques being used (punches only, kicks, throws, ground work)
- Environment (ring, cage, mat, dohyo)
Then provide discipline-specific coaching accordingly.`,
  },
}

/**
 * Get the discipline-specific prompt block to inject into the system prompt.
 * Falls back to 'unknown' (auto-detect) if discipline not recognized.
 */
export function getDisciplinePrompt(discipline: Discipline | string): string {
  const profile = DISCIPLINE_PROFILES[discipline as Discipline] || DISCIPLINE_PROFILES.unknown
  return profile.promptBlock
}

/**
 * Get the full discipline profile for UI display or advanced prompt composition.
 */
export function getDisciplineProfile(discipline: Discipline | string): DisciplineProfile {
  return DISCIPLINE_PROFILES[discipline as Discipline] || DISCIPLINE_PROFILES.unknown
}

/**
 * List all supported disciplines (excluding 'unknown' and 'other').
 */
export function listDisciplines(): Array<{ value: Discipline; label: string }> {
  return [
    { value: 'boxing', label: 'Boxing' },
    { value: 'kickboxing', label: 'Kickboxing' },
    { value: 'muay_thai', label: 'Muay Thai' },
    { value: 'mma', label: 'MMA' },
    { value: 'wrestling', label: 'Wrestling' },
    { value: 'bjj', label: 'Brazilian Jiu-Jitsu' },
    { value: 'judo', label: 'Judo' },
    { value: 'karate', label: 'Karate' },
    { value: 'taekwondo', label: 'Taekwondo' },
    { value: 'sumo', label: 'Sumo' },
    { value: 'sambo', label: 'Sambo' },
  ]
}
