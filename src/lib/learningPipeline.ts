/**
 * Musashi Learning Pipeline - Continuous AI Knowledge System
 * Ingests fight videos, extracts techniques, and enables RAG-based coaching
 */

import { logger } from './logger'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { KinematicsSnapshot } from './kinematics'
import { getDb } from '@/lib/db'

// ============================================================================
// Types
// ============================================================================

export interface FightKnowledgeEntry {
  id: string
  type: 'technique' | 'fight' | 'pattern' | 'drill' | 'combo'
  title: string
  description: string
  videoUrl?: string
  frames?: string[] // Base64 encoded key frames
  kinematics?: KinematicsSnapshot[]
  tags: string[]
  embedding?: number[] // For semantic search
  metadata: {
    discipline: 'boxing' | 'kickboxing' | 'muay_thai' | 'mma' | 'wrestling' | 'bjj' | 'judo' | 'karate' | 'taekwondo' | 'sumo' | 'sambo' | 'other'
    difficulty: 'beginner' | 'intermediate' | 'advanced' | 'pro'
    effectivenessScore?: number
    viewCount?: number
    successRate?: number
    relatedTechniques?: string[]
  }
  createdAt: string
  updatedAt: string
}

export interface TechniquePattern {
  techniqueId: string
  name: string
  keyPoses: NormalizedLandmark[][] // Sequence of landmark positions
  kinematicsProfile: {
    avgHandSpeed: number
    avgPowerIndex: number
    avgFootSpeed: number
    rangePreference: 'close' | 'mid' | 'long'
  }
  commonTelegraphs: string[]
  counters: string[]
  drills: string[]
}

export interface UserLearningProfile {
  userId: string
  strengths: string[] // Technique IDs
  weaknesses: string[] // Technique IDs
  recentActivity: {
    techniqueId: string
    attempts: number
    successRate: number
    lastPracticed: string
  }[]
  preferredStyle: string
  skillLevel: 'beginner' | 'intermediate' | 'advanced' | 'pro'
}

/**
 * Store a new knowledge entry in the library
 */
export async function storeKnowledge(entry: Omit<FightKnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<FightKnowledgeEntry> {
  const db = getDb()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  const fullEntry: FightKnowledgeEntry = {
    ...entry,
    id,
    createdAt: now,
    updatedAt: now
  }

  await db.prepare(`
    INSERT INTO musashi_library_documents (
      id, title, source_type, content, tags, status, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    entry.title,
    'api', // Source type
    entry.description,
    JSON.stringify(entry.tags),
    'ready',
    JSON.stringify(entry.metadata),
    now,
    now
  ).run()

  logger.info('Knowledge entry stored', { id, type: entry.type, title: entry.title })

  return fullEntry
}

/**
 * Search knowledge base by tags and type
 */
export async function searchKnowledgeBase(
  query: string,
  filters: {
    tags?: string[]
    type?: string[]
    discipline?: string
    difficulty?: string
    limit?: number
  } = {}
): Promise<FightKnowledgeEntry[]> {
  const db = getDb()
  const { tags = [], type = [], discipline, difficulty, limit = 10 } = filters

  // Build dynamic query
  let sql = 'SELECT * FROM musashi_library_documents WHERE status = ?'
  const params: any[] = ['ready']

  if (tags.length > 0) {
    // Simple tag matching (in production, use full-text search or vector search)
    const tagConditions = tags.map(() => 'tags LIKE ?').join(' OR ')
    sql += ` AND (${tagConditions})`
    tags.forEach(tag => params.push(`%"${tag}"%`))
  }

  if (type.length > 0) {
    const typeConditions = type.map(() => 'metadata LIKE ?').join(' OR ')
    sql += ` AND (${typeConditions})`
    type.forEach(t => params.push(`%"type":"${t}"%`))
  }

  if (discipline) {
    sql += ' AND metadata LIKE ?'
    params.push(`%"discipline":"${discipline}"%`)
  }

  if (difficulty) {
    sql += ' AND metadata LIKE ?'
    params.push(`%"difficulty":"${difficulty}"%`)
  }

  if (query) {
    sql += ' AND (title LIKE ? OR content LIKE ?)'
    params.push(`%${query}%`, `%${query}%`)
  }

  sql += ' ORDER BY created_at DESC LIMIT ?'
  params.push(limit)

  const result = await db.prepare(sql).bind(...params).all()

  const entries: FightKnowledgeEntry[] = (result.results || []).map((row: any) => ({
    id: row.id,
    type: JSON.parse(row.metadata).type || 'technique',
    title: row.title,
    description: row.content,
    tags: JSON.parse(row.tags),
    metadata: JSON.parse(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }))

  return entries
}

/**
 * Get knowledge entry by ID
 */
export async function getKnowledgeById(id: string): Promise<FightKnowledgeEntry | null> {
  const db = getDb()
  
  const row = await db.prepare(`
    SELECT * FROM musashi_library_documents WHERE id = ?
  `).bind(id).first()

  if (!row) return null

  return {
    id: row.id as string,
    type: (JSON.parse(row.metadata as string).type || 'technique') as any,
    title: row.title as string,
    description: row.content as string,
    tags: JSON.parse(row.tags as string),
    metadata: JSON.parse(row.metadata as string),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

// ============================================================================
// User Learning Profile Management
// ============================================================================

/**
 * Get or create user learning profile
 */
export async function getUserLearningProfile(userId: string): Promise<UserLearningProfile> {
  const db = getDb()

  const profile = await db.prepare(`
    SELECT * FROM user_fight_profiles WHERE user_id = ?
  `).bind(userId).first()

  if (profile) {
    return {
      userId: profile.user_id as string,
      strengths: JSON.parse(profile.strengths as string),
      weaknesses: JSON.parse(profile.weaknesses as string),
      recentActivity: [],
      preferredStyle: (profile.preferred_discipline as string) || 'boxing',
      skillLevel: (profile.skill_level as any) || 'beginner'
    }
  }

  // Create new profile
  const now = new Date().toISOString()
  await db.prepare(`
    INSERT INTO user_fight_profiles (
      user_id, preferred_discipline, skill_level, strengths, weaknesses, 
      goals, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    userId,
    'boxing',
    'beginner',
    '[]',
    '[]',
    '[]',
    '{}',
    now,
    now
  ).run()

  return {
    userId,
    strengths: [],
    weaknesses: [],
    recentActivity: [],
    preferredStyle: 'boxing',
    skillLevel: 'beginner'
  }
}

/**
 * Update user technique performance
 */
export async function updateTechniquePerformance(
  userId: string,
  techniqueId: string,
  success: boolean,
  metrics?: {
    powerIndex?: number
    speedBwps?: number
  }
): Promise<void> {
  const db = getDb()

  // Get existing history
  const existing = await db.prepare(`
    SELECT * FROM user_technique_history 
    WHERE user_id = ? AND technique_id = ?
  `).bind(userId, techniqueId).first()

  const now = new Date().toISOString()

  if (existing) {
    // Update existing
    const attempts = (existing.attempts as number) + 1
    const successes = (existing.successes as number) + (success ? 1 : 0)
    const successRate = successes / attempts

    await db.prepare(`
      UPDATE user_technique_history
      SET attempts = ?, successes = ?, success_rate = ?,
          avg_power_index = ?, avg_speed_bwps = ?,
          last_practiced = ?, updated_at = ?
      WHERE user_id = ? AND technique_id = ?
    `).bind(
      attempts,
      successes,
      successRate,
      metrics?.powerIndex || existing.avg_power_index,
      metrics?.speedBwps || existing.avg_speed_bwps,
      now,
      now,
      userId,
      techniqueId
    ).run()
  } else {
    // Create new
    const id = crypto.randomUUID()
    await db.prepare(`
      INSERT INTO user_technique_history (
        id, user_id, technique_id, attempts, successes, success_rate,
        avg_power_index, avg_speed_bwps, last_practiced, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      userId,
      techniqueId,
      1,
      success ? 1 : 0,
      success ? 1.0 : 0.0,
      metrics?.powerIndex || null,
      metrics?.speedBwps || null,
      now,
      now,
      now
    ).run()
  }

  logger.info('Technique performance updated', { userId, techniqueId, success })
}

// ============================================================================
// RAG Enhancement
// ============================================================================

/**
 * Enhance coaching prompt with relevant knowledge
 */
export async function enhancePromptWithKnowledge(
  userQuery: string,
  context: {
    discipline?: string
    focusTarget?: string
    currentTechnique?: string
  }
): Promise<string> {
  // Search for relevant knowledge
  const knowledge = await searchKnowledgeBase(userQuery, {
    discipline: context.discipline,
    limit: 3
  })

  if (knowledge.length === 0) {
    return '' // No additional context
  }

  // Build knowledge context string
  const knowledgeContext = knowledge.map(k => 
    `### ${k.title}\n${k.description}\nTags: ${k.tags.join(', ')}`
  ).join('\n\n')

  return `
RELEVANT KNOWLEDGE FROM LIBRARY:
${knowledgeContext}

Use this knowledge to enhance your coaching advice.
`
}

/**
 * Get personalized coaching based on user history
 */
export async function getPersonalizedCoaching(
  userId: string,
  currentAnalysis: any
): Promise<{
  focus: string[]
  recommendedDrills: FightKnowledgeEntry[]
  personalizedFeedback: string
}> {
  const profile = await getUserLearningProfile(userId)

  // Get technique history
  const db = getDb()
  const weakTechniques = await db.prepare(`
    SELECT technique_id, success_rate, attempts
    FROM user_technique_history
    WHERE user_id = ? AND success_rate < 0.6
    ORDER BY last_practiced DESC
    LIMIT 5
  `).bind(userId).all()

  const focus = (weakTechniques.results || []).map((t: any) => t.technique_id as string)

  // Find drills for weak areas
  const drills = await searchKnowledgeBase('', {
    type: ['drill'],
    tags: focus,
    difficulty: profile.skillLevel,
    limit: 3
  })

  const feedback = focus.length > 0
    ? `Based on your training history, focus on improving: ${focus.join(', ')}. Your success rate in these areas is below 60%.`
    : 'Great progress! Continue practicing your current techniques.'

  return {
    focus,
    recommendedDrills: drills,
    personalizedFeedback: feedback
  }
}

// ============================================================================
// Session Summary Storage
// ============================================================================

/**
 * Store a fight session summary in the knowledge base so the AI can reference past sessions.
 */
export async function storeSessionSummary(params: {
  userId: string
  sessionId: string
  summary: string
  techniques: string[]
  patterns: string[]
  discipline?: string
}): Promise<void> {
  const { userId, sessionId, summary, techniques, patterns, discipline } = params

  try {
    await storeKnowledge({
      type: 'fight',
      title: `Session Summary — ${new Date().toLocaleDateString()}`,
      description: summary,
      tags: ['session-summary', ...techniques, ...patterns],
      metadata: {
        discipline: (discipline as any) || 'mma',
        difficulty: 'intermediate' as const,
        effectivenessScore: undefined,
        relatedTechniques: techniques,
      }
    })

    logger.info('Session summary stored', { userId, sessionId, techniqueCount: techniques.length })
  } catch (error) {
    logger.warn('Failed to store session summary', {
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

// ============================================================================
// Seed Default Knowledge
// ============================================================================

/**
 * Seed basic fight techniques for new installations
 */
export async function seedDefaultKnowledge(): Promise<void> {
  const techniques = [
    // ========== BOXING ==========
    {
      type: 'technique' as const,
      title: 'Jab - Boxing Fundamentals',
      description: 'The jab is the most fundamental punch in boxing. Extends the lead hand straight from the guard position. Used for range finding, setting up combinations, and controlling distance.',
      tags: ['boxing', 'punch', 'fundamental', 'jab', 'lead-hand'],
      metadata: {
        discipline: 'boxing' as const,
        difficulty: 'beginner' as const,
        effectivenessScore: 0.8,
        relatedTechniques: ['cross', 'jab-cross']
      }
    },
    {
      type: 'technique' as const,
      title: 'Cross - Power Punch',
      description: 'The cross (rear straight) generates power from hip rotation. Thrown from the rear hand, it\'s boxing\'s primary power punch. Key: rotate hips, pivot rear foot, keep elbow down.',
      tags: ['boxing', 'punch', 'power', 'cross', 'rear-hand'],
      metadata: {
        discipline: 'boxing' as const,
        difficulty: 'beginner' as const,
        effectivenessScore: 0.9,
        relatedTechniques: ['jab', 'jab-cross', 'hook']
      }
    },
    {
      type: 'combo' as const,
      title: '1-2 Combo (Jab-Cross)',
      description: 'The most fundamental boxing combination. Jab to measure distance and occupy opponent\'s vision, immediately follow with a powerful cross. Essential timing: jab retracts as cross extends.',
      tags: ['boxing', 'combo', 'fundamental', 'jab-cross'],
      metadata: {
        discipline: 'boxing' as const,
        difficulty: 'beginner' as const,
        effectivenessScore: 0.95,
        relatedTechniques: ['jab', 'cross']
      }
    },
    {
      type: 'technique' as const,
      title: 'Lead Hook',
      description: 'Short-range power punch thrown in a horizontal arc with the lead hand. Elbow stays at 90 degrees, power comes from hip rotation. Devastating at close range. Common follow-up after the cross.',
      tags: ['boxing', 'punch', 'power', 'hook', 'lead-hand', 'close-range'],
      metadata: {
        discipline: 'boxing' as const,
        difficulty: 'intermediate' as const,
        effectivenessScore: 0.9,
        relatedTechniques: ['cross', 'uppercut', '1-2-3']
      }
    },
    {
      type: 'technique' as const,
      title: 'Uppercut',
      description: 'Vertical punch thrown upward from a crouched position. Targets chin or body. Power generated from legs driving upward through hips. Most effective at close range or when opponent dips head.',
      tags: ['boxing', 'punch', 'power', 'uppercut', 'close-range'],
      metadata: {
        discipline: 'boxing' as const,
        difficulty: 'intermediate' as const,
        effectivenessScore: 0.85,
        relatedTechniques: ['hook', 'body-shot', 'cross']
      }
    },
    {
      type: 'technique' as const,
      title: 'Slip and Counter',
      description: 'Defensive head movement to evade a straight punch by rotating the torso and moving the head off the centerline. Immediately counter with a cross or hook while opponent is extended. Key: bend at the waist, keep eyes on opponent.',
      tags: ['boxing', 'defense', 'counter', 'slip', 'head-movement'],
      metadata: {
        discipline: 'boxing' as const,
        difficulty: 'intermediate' as const,
        effectivenessScore: 0.88,
        relatedTechniques: ['roll', 'parry', 'cross']
      }
    },
    {
      type: 'technique' as const,
      title: 'Body Shot - Liver Punch',
      description: 'Targeting the liver (right side of opponent\'s body) with a left hook or straight. One of boxing\'s most devastating attacks. Set up by going upstairs first, then dig to the body. Delayed pain effect can cause knockdowns.',
      tags: ['boxing', 'punch', 'body', 'liver-shot', 'power'],
      metadata: {
        discipline: 'boxing' as const,
        difficulty: 'advanced' as const,
        effectivenessScore: 0.95,
        relatedTechniques: ['hook', 'jab-body', 'uppercut']
      }
    },
    {
      type: 'combo' as const,
      title: '1-2-3 Combo (Jab-Cross-Hook)',
      description: 'Three-punch combination building on the 1-2. After the cross lands, immediately throw a lead hook. The cross turns the opponent\'s head, exposing the chin for the hook. Maintain balance throughout.',
      tags: ['boxing', 'combo', 'intermediate', '1-2-3'],
      metadata: {
        discipline: 'boxing' as const,
        difficulty: 'intermediate' as const,
        effectivenessScore: 0.92,
        relatedTechniques: ['jab', 'cross', 'hook']
      }
    },
    {
      type: 'technique' as const,
      title: 'Parry and Counter',
      description: 'Use the rear hand to deflect an incoming jab downward or to the side, then immediately counter with your own jab or cross. Minimal energy expenditure, keeps you in range to counter.',
      tags: ['boxing', 'defense', 'counter', 'parry', 'fundamental'],
      metadata: {
        discipline: 'boxing' as const,
        difficulty: 'beginner' as const,
        effectivenessScore: 0.82,
        relatedTechniques: ['slip', 'jab', 'cross']
      }
    },

    // ========== MUAY THAI ==========
    {
      type: 'technique' as const,
      title: 'Teep (Push Kick)',
      description: 'The teep is Muay Thai\'s primary range management tool. A front push kick using the ball of the foot to the opponent\'s midsection or hip. Controls distance, disrupts rhythm, and can off-balance the opponent. Snap the hip forward, extend the leg, retract quickly.',
      tags: ['muay-thai', 'kick', 'fundamental', 'teep', 'range-control'],
      metadata: {
        discipline: 'muay_thai' as const,
        difficulty: 'beginner' as const,
        effectivenessScore: 0.85,
        relatedTechniques: ['roundhouse', 'jab', 'clinch-entry']
      }
    },
    {
      type: 'technique' as const,
      title: 'Roundhouse Kick',
      description: 'The signature Muay Thai weapon. Rotate on the ball of the support foot, swing the shin through the target like a baseball bat. Power comes from hip rotation, not the knee snap. Targets: leg (low kick), body, head. The shin is the striking surface.',
      tags: ['muay-thai', 'kick', 'power', 'roundhouse', 'shin'],
      metadata: {
        discipline: 'muay_thai' as const,
        difficulty: 'beginner' as const,
        effectivenessScore: 0.95,
        relatedTechniques: ['teep', 'low-kick', 'head-kick']
      }
    },
    {
      type: 'technique' as const,
      title: 'Muay Thai Clinch (Plum)',
      description: 'Double collar tie: both hands clasped behind the opponent\'s head, elbows tight against their collarbones. Control their posture, pull their head down, deliver knees and elbows. Key: fight for inside position, keep elbows tight, use off-balancing.',
      tags: ['muay-thai', 'clinch', 'plum', 'grappling', 'control'],
      metadata: {
        discipline: 'muay_thai' as const,
        difficulty: 'intermediate' as const,
        effectivenessScore: 0.9,
        relatedTechniques: ['knee', 'elbow', 'sweep']
      }
    },
    {
      type: 'technique' as const,
      title: 'Elbow Strike (Sok)',
      description: 'Close-range cutting weapon unique to Muay Thai. Horizontal, diagonal, uppercut, and spinning variations. The elbow\'s sharp bone edge causes cuts easily. Set up from clinch or after closing distance. Devastating in close quarters.',
      tags: ['muay-thai', 'elbow', 'close-range', 'cutting', 'power'],
      metadata: {
        discipline: 'muay_thai' as const,
        difficulty: 'advanced' as const,
        effectivenessScore: 0.92,
        relatedTechniques: ['clinch', 'hook', 'knee']
      }
    },
    {
      type: 'technique' as const,
      title: 'Knee Strike (Khao)',
      description: 'Powerful strike using the knee, most effective from the clinch. Straight knee (khao trong) drives upward into the body or head. Clinch knee (khao khlong) delivered while controlling opponent\'s head in the plum. Can end fights instantly.',
      tags: ['muay-thai', 'knee', 'clinch', 'power', 'close-range'],
      metadata: {
        discipline: 'muay_thai' as const,
        difficulty: 'intermediate' as const,
        effectivenessScore: 0.93,
        relatedTechniques: ['clinch', 'elbow', 'teep']
      }
    },
    {
      type: 'technique' as const,
      title: 'Low Kick (Leg Kick)',
      description: 'Roundhouse kick targeting the opponent\'s lead or rear thigh. Accumulative damage reduces mobility over time. Target the outer thigh (common peroneal nerve) or inner thigh. Set up with punches to draw attention high, then attack low.',
      tags: ['muay-thai', 'kick', 'low-kick', 'leg', 'attrition'],
      metadata: {
        discipline: 'muay_thai' as const,
        difficulty: 'beginner' as const,
        effectivenessScore: 0.88,
        relatedTechniques: ['roundhouse', 'teep', 'jab']
      }
    },
    {
      type: 'technique' as const,
      title: 'Muay Thai Sweep (Dump)',
      description: 'From the clinch or after catching a kick, use hip rotation and leg positioning to off-balance and dump the opponent. Score points and reset position. Key: timing, hip placement, and pulling the opponent over your hip.',
      tags: ['muay-thai', 'sweep', 'clinch', 'takedown', 'technique'],
      metadata: {
        discipline: 'muay_thai' as const,
        difficulty: 'intermediate' as const,
        effectivenessScore: 0.78,
        relatedTechniques: ['clinch', 'catch-kick', 'teep']
      }
    },

    // ========== WRESTLING ==========
    {
      type: 'technique' as const,
      title: 'Double Leg Takedown',
      description: 'Fundamental wrestling takedown. Shoot by changing levels (drop hips), penetrate with a deep step between opponent\'s legs, drive shoulder into their midsection, wrap both legs behind the knees, and drive through. Finish by lifting or running the pipe.',
      tags: ['wrestling', 'takedown', 'fundamental', 'double-leg', 'shooting'],
      metadata: {
        discipline: 'wrestling' as const,
        difficulty: 'beginner' as const,
        effectivenessScore: 0.92,
        relatedTechniques: ['single-leg', 'sprawl', 'level-change']
      }
    },
    {
      type: 'technique' as const,
      title: 'Single Leg Takedown',
      description: 'Grab one of the opponent\'s legs while changing levels. Variations: head inside (safer) or head outside (more power). Finish options: run the pipe, trip, lift, or dump. More versatile than double leg, works at longer range.',
      tags: ['wrestling', 'takedown', 'fundamental', 'single-leg', 'shooting'],
      metadata: {
        discipline: 'wrestling' as const,
        difficulty: 'beginner' as const,
        effectivenessScore: 0.9,
        relatedTechniques: ['double-leg', 'high-crotch', 'ankle-pick']
      }
    },
    {
      type: 'technique' as const,
      title: 'Sprawl Defense',
      description: 'Primary defense against takedown attempts. When opponent shoots, kick legs back and drop hips down onto their shoulders/back. Hands push down on their head. Creates a whizzer (overhook) opportunity. Key: react early, heavy hips, head pressure.',
      tags: ['wrestling', 'defense', 'sprawl', 'takedown-defense', 'fundamental'],
      metadata: {
        discipline: 'wrestling' as const,
        difficulty: 'beginner' as const,
        effectivenessScore: 0.88,
        relatedTechniques: ['whizzer', 'front-headlock', 'guillotine']
      }
    },
    {
      type: 'technique' as const,
      title: 'Underhook Battle',
      description: 'The underhook (arm under opponent\'s armpit, hand on their back) is the most important clinch position in wrestling. Controls posture and enables takedowns. Fight for double underhooks. Counter opponent\'s underhook with a whizzer (overhook).',
      tags: ['wrestling', 'clinch', 'underhook', 'control', 'position'],
      metadata: {
        discipline: 'wrestling' as const,
        difficulty: 'intermediate' as const,
        effectivenessScore: 0.85,
        relatedTechniques: ['body-lock', 'single-leg', 'whizzer']
      }
    },
    {
      type: 'technique' as const,
      title: 'Body Lock Takedown',
      description: 'Secure a tight grip around the opponent\'s torso (over-under or double underhooks), lock hands, and use hip pressure to lift or trip them. Extremely effective against the cage in MMA. Key: chest-to-chest pressure, heavy hips, trip the far leg.',
      tags: ['wrestling', 'takedown', 'body-lock', 'clinch', 'power'],
      metadata: {
        discipline: 'wrestling' as const,
        difficulty: 'intermediate' as const,
        effectivenessScore: 0.87,
        relatedTechniques: ['underhook', 'double-leg', 'trip']
      }
    },
    {
      type: 'technique' as const,
      title: 'Front Headlock / Snap Down',
      description: 'Control position achieved by snapping the opponent\'s head down and wrapping around their neck from the front. Leads to go-behinds, guillotines, and anaconda chokes. Set up by pushing opponent\'s head down with collar ties.',
      tags: ['wrestling', 'control', 'front-headlock', 'snap-down', 'transition'],
      metadata: {
        discipline: 'wrestling' as const,
        difficulty: 'intermediate' as const,
        effectivenessScore: 0.83,
        relatedTechniques: ['guillotine', 'go-behind', 'sprawl']
      }
    },

    // ========== BJJ / GRAPPLING ==========
    {
      type: 'technique' as const,
      title: 'Closed Guard Fundamentals',
      description: 'Bottom position with legs wrapped around opponent\'s waist, ankles crossed. Defensive position that offers many attacks: armbar, triangle, omoplata, sweeps. Control opponent\'s posture by pulling their head down. Break their grips to set up submissions.',
      tags: ['bjj', 'guard', 'closed-guard', 'fundamental', 'bottom-position'],
      metadata: {
        discipline: 'mma' as const,
        difficulty: 'beginner' as const,
        effectivenessScore: 0.82,
        relatedTechniques: ['armbar', 'triangle', 'hip-bump-sweep']
      }
    },
    {
      type: 'technique' as const,
      title: 'Armbar from Guard',
      description: 'Classic submission from closed guard. Control opponent\'s wrist, pivot hips to the side, throw leg over their head, squeeze knees together, and extend hips against the elbow joint. Key: control the arm before moving, high guard, tight squeeze.',
      tags: ['bjj', 'submission', 'armbar', 'guard', 'fundamental'],
      metadata: {
        discipline: 'mma' as const,
        difficulty: 'beginner' as const,
        effectivenessScore: 0.9,
        relatedTechniques: ['triangle', 'omoplata', 'closed-guard']
      }
    },
    {
      type: 'technique' as const,
      title: 'Triangle Choke',
      description: 'Blood choke using the legs to form a triangle around the opponent\'s neck and one arm. From guard: control one arm in, one arm out, throw leg over their neck, lock the triangle (ankle behind opposite knee), squeeze and angle off. Cuts blood flow to the brain.',
      tags: ['bjj', 'submission', 'triangle', 'choke', 'guard'],
      metadata: {
        discipline: 'mma' as const,
        difficulty: 'intermediate' as const,
        effectivenessScore: 0.92,
        relatedTechniques: ['armbar', 'omoplata', 'closed-guard']
      }
    },
    {
      type: 'technique' as const,
      title: 'Rear Naked Choke (RNC)',
      description: 'The highest-percentage submission in MMA. From back control: slide choking arm under the chin, grab your own bicep, place the other hand behind their head, squeeze elbows together. Key: get the seatbelt grip first, hooks in, then work for the choke.',
      tags: ['bjj', 'submission', 'rnc', 'choke', 'back-control'],
      metadata: {
        discipline: 'mma' as const,
        difficulty: 'intermediate' as const,
        effectivenessScore: 0.97,
        relatedTechniques: ['back-take', 'body-triangle', 'armbar']
      }
    },
    {
      type: 'technique' as const,
      title: 'Guillotine Choke',
      description: 'Front headlock submission. Wrap arm around opponent\'s neck (chin in the crook of your elbow), clasp hands, pull upward while arching back. Standing or from guard. Arm-in guillotine is tighter. Common counter to failed takedowns.',
      tags: ['bjj', 'submission', 'guillotine', 'choke', 'front-headlock'],
      metadata: {
        discipline: 'mma' as const,
        difficulty: 'intermediate' as const,
        effectivenessScore: 0.88,
        relatedTechniques: ['front-headlock', 'darce', 'anaconda']
      }
    },
    {
      type: 'technique' as const,
      title: 'Kimura Lock',
      description: 'Shoulder lock (double wristlock). Grip opponent\'s wrist with one hand, thread the other arm under their arm and grab your own wrist (figure-four grip). Rotate their arm behind their back. Works from guard, side control, north-south, and mount.',
      tags: ['bjj', 'submission', 'kimura', 'shoulder-lock', 'versatile'],
      metadata: {
        discipline: 'mma' as const,
        difficulty: 'intermediate' as const,
        effectivenessScore: 0.85,
        relatedTechniques: ['americana', 'armbar', 'hip-bump-sweep']
      }
    },
    {
      type: 'technique' as const,
      title: 'Mount Position Control',
      description: 'Dominant top position sitting on opponent\'s torso. Highest-value position in BJJ/MMA. Maintain by keeping hips low, grapevining legs, and posting hands. Attacks: armbar, cross-collar choke, americana, mounted triangle, ground and pound.',
      tags: ['bjj', 'position', 'mount', 'dominant', 'top-control'],
      metadata: {
        discipline: 'mma' as const,
        difficulty: 'beginner' as const,
        effectivenessScore: 0.93,
        relatedTechniques: ['armbar', 'americana', 'ground-and-pound']
      }
    },
    {
      type: 'technique' as const,
      title: 'Side Control',
      description: 'Dominant top position perpendicular to opponent. Chest-to-chest pressure, underhook the far arm, crossface with the near arm. Transitions: mount, knee-on-belly, north-south, back take. Submissions: americana, kimura, arm triangle.',
      tags: ['bjj', 'position', 'side-control', 'dominant', 'top-control'],
      metadata: {
        discipline: 'mma' as const,
        difficulty: 'beginner' as const,
        effectivenessScore: 0.88,
        relatedTechniques: ['mount', 'knee-on-belly', 'americana']
      }
    },
    {
      type: 'technique' as const,
      title: 'Guard Pass - Knee Slice',
      description: 'Fundamental guard pass. From combat base, slide the lead knee across opponent\'s thigh while controlling their far hip. Drive crossface pressure to flatten them. Finish by clearing the legs and establishing side control. Works against open and half guard.',
      tags: ['bjj', 'guard-pass', 'knee-slice', 'fundamental', 'top-game'],
      metadata: {
        discipline: 'mma' as const,
        difficulty: 'intermediate' as const,
        effectivenessScore: 0.86,
        relatedTechniques: ['side-control', 'torreando', 'stack-pass']
      }
    },
    {
      type: 'technique' as const,
      title: 'Hip Bump Sweep',
      description: 'Fundamental sweep from closed guard. When opponent postures up, sit up explosively, post one hand behind you, bump their body with your hip, and roll them over. End in mount. Key: timing when they posture, explosive hip drive.',
      tags: ['bjj', 'sweep', 'guard', 'fundamental', 'reversal'],
      metadata: {
        discipline: 'mma' as const,
        difficulty: 'beginner' as const,
        effectivenessScore: 0.8,
        relatedTechniques: ['closed-guard', 'mount', 'kimura']
      }
    },
    {
      type: 'technique' as const,
      title: 'Back Take',
      description: 'Transitioning to back control — the most dominant position. Methods: from turtle (seat belt + hooks), from mount (when opponent turns), from guard (arm drag), from scrambles. Secure seatbelt grip (over-under), insert hooks, flatten opponent.',
      tags: ['bjj', 'position', 'back-take', 'transition', 'dominant'],
      metadata: {
        discipline: 'mma' as const,
        difficulty: 'intermediate' as const,
        effectivenessScore: 0.94,
        relatedTechniques: ['rnc', 'body-triangle', 'arm-drag']
      }
    },

    // ========== MMA-SPECIFIC ==========
    {
      type: 'technique' as const,
      title: 'Ground and Pound',
      description: 'Striking from a dominant grappling position (mount, side control, guard top). Use posture to generate power, alternate hands, target openings. In MMA, forces opponent to defend strikes which opens submissions. Key: maintain position while striking.',
      tags: ['mma', 'ground-and-pound', 'striking', 'top-control', 'finishing'],
      metadata: {
        discipline: 'mma' as const,
        difficulty: 'intermediate' as const,
        effectivenessScore: 0.9,
        relatedTechniques: ['mount', 'side-control', 'guard-pass']
      }
    },
    {
      type: 'technique' as const,
      title: 'Cage Work - Wall Walking',
      description: 'Technique for getting back to feet when pressed against the cage. Walk hands up the cage while hip-escaping, create frames, time the stand-up when opponent adjusts. Key: keep back against cage for support, create space with frames, explode up.',
      tags: ['mma', 'cage-work', 'wall-walk', 'escape', 'defense'],
      metadata: {
        discipline: 'mma' as const,
        difficulty: 'intermediate' as const,
        effectivenessScore: 0.82,
        relatedTechniques: ['sprawl', 'underhook', 'takedown-defense']
      }
    },
    {
      type: 'technique' as const,
      title: 'Takedown Defense - Stuffing Shots',
      description: 'Defending wrestling takedowns in MMA. Sprawl on double/single legs, use underhooks to prevent body locks, frame on the head to create distance. Dirty boxing in the clinch to discourage entries. Key: stance width, hand fighting, hip position.',
      tags: ['mma', 'takedown-defense', 'sprawl', 'defense', 'fundamental'],
      metadata: {
        discipline: 'mma' as const,
        difficulty: 'intermediate' as const,
        effectivenessScore: 0.87,
        relatedTechniques: ['sprawl', 'underhook', 'whizzer']
      }
    },
    {
      type: 'technique' as const,
      title: 'Dirty Boxing (Clinch Striking)',
      description: 'Close-range punching from the clinch. Use collar ties, underhooks, and wrist control to create angles for short hooks, uppercuts, and elbows. Effective against wrestlers who close distance. Key: inside position, short punches, knees to body.',
      tags: ['mma', 'clinch', 'dirty-boxing', 'striking', 'close-range'],
      metadata: {
        discipline: 'mma' as const,
        difficulty: 'advanced' as const,
        effectivenessScore: 0.86,
        relatedTechniques: ['clinch', 'uppercut', 'knee', 'elbow']
      }
    },

    // ========== DRILLS ==========
    {
      type: 'drill' as const,
      title: 'Shadow Boxing Rounds',
      description: '3-minute rounds of shadow boxing focusing on technique, footwork, and combinations. Round 1: single shots with movement. Round 2: 2-3 punch combos with head movement. Round 3: full combinations with defensive exits. Rest 1 minute between rounds.',
      tags: ['drill', 'boxing', 'shadow-boxing', 'fundamental', 'conditioning'],
      metadata: {
        discipline: 'boxing' as const,
        difficulty: 'beginner' as const,
        effectivenessScore: 0.85,
        relatedTechniques: ['jab', 'cross', 'hook', 'slip']
      }
    },
    {
      type: 'drill' as const,
      title: 'Positional Sparring - Guard Passing',
      description: 'Start with one person in closed guard. Top person works to pass, bottom person works to sweep or submit. Reset after pass, sweep, or submission. 5-minute rounds. Develops guard retention and passing under pressure.',
      tags: ['drill', 'bjj', 'positional-sparring', 'guard', 'passing'],
      metadata: {
        discipline: 'mma' as const,
        difficulty: 'intermediate' as const,
        effectivenessScore: 0.9,
        relatedTechniques: ['guard-pass', 'closed-guard', 'sweep']
      }
    },
    {
      type: 'drill' as const,
      title: 'Takedown Entry Drill',
      description: 'Partner drill: practice level changes and penetration steps without completing the takedown. Focus on speed of entry, head position, and knee placement. 10 reps each side, then add the finish. Builds muscle memory for shot mechanics.',
      tags: ['drill', 'wrestling', 'takedown', 'entry', 'fundamental'],
      metadata: {
        discipline: 'wrestling' as const,
        difficulty: 'beginner' as const,
        effectivenessScore: 0.88,
        relatedTechniques: ['double-leg', 'single-leg', 'level-change']
      }
    }
  ]

  for (const tech of techniques) {
    try {
      await storeKnowledge(tech)
    } catch (error) {
      logger.warn('Failed to seed technique', { 
        title: tech.title, 
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  logger.info('Default knowledge seeded', { count: techniques.length })
}
