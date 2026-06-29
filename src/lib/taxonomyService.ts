/**
 * Taxonomy Service — Structured martial arts knowledge system
 * CRUD + query layer for technique_categories, technique_entries,
 * technique_sequences, and technique_counters tables.
 */

import type { Discipline } from './disciplinePrompts'
import { getDb } from '@/lib/db'

// ============================================================================
// Types
// ============================================================================

export interface TechniqueCategory {
  id: string
  discipline: string
  name: string
  parentId: string | null
  description: string | null
  sortOrder: number
  createdAt: string
}

export interface TechniqueEntry {
  id: string
  categoryId: string
  discipline: string
  name: string
  japaneseName: string | null
  koreanName: string | null
  description: string
  keyPoints: string[]
  commonMistakes: string[]
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'pro'
  positionContext: string | null
  videoUrl: string | null
  thumbnailUrl: string | null
  tags: string[]
  metadata: Record<string, any>
  effectivenessScore: number
  viewCount: number
  createdAt: string
  updatedAt: string
}

export interface TechniqueSequence {
  id: string
  discipline: string
  name: string
  description: string | null
  steps: SequenceStep[]
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'pro'
  tags: string[]
  createdAt: string
}

export interface SequenceStep {
  techniqueId: string
  notes: string
  transitionCue: string
}

export interface TechniqueCounter {
  id: string
  techniqueId: string
  counterTechniqueId: string
  effectiveness: 'high' | 'medium' | 'low'
  notes: string | null
  createdAt: string
}

export interface TechniqueTreeNode {
  category: TechniqueCategory
  children: TechniqueTreeNode[]
  techniques: TechniqueEntry[]
}

// ============================================================================
// Row mappers
// ============================================================================

const rowToCategory = (r: any): TechniqueCategory => ({
  id: String(r.id),
  discipline: String(r.discipline),
  name: String(r.name),
  parentId: r.parent_id ? String(r.parent_id) : null,
  description: r.description ? String(r.description) : null,
  sortOrder: Number(r.sort_order ?? 0),
  createdAt: String(r.created_at),
})

const rowToEntry = (r: any): TechniqueEntry => ({
  id: String(r.id),
  categoryId: String(r.category_id),
  discipline: String(r.discipline),
  name: String(r.name),
  japaneseName: r.japanese_name ? String(r.japanese_name) : null,
  koreanName: r.korean_name ? String(r.korean_name) : null,
  description: String(r.description),
  keyPoints: JSON.parse(r.key_points || '[]'),
  commonMistakes: JSON.parse(r.common_mistakes || '[]'),
  difficulty: r.difficulty as TechniqueEntry['difficulty'],
  positionContext: r.position_context ? String(r.position_context) : null,
  videoUrl: r.video_url ? String(r.video_url) : null,
  thumbnailUrl: r.thumbnail_url ? String(r.thumbnail_url) : null,
  tags: JSON.parse(r.tags || '[]'),
  metadata: JSON.parse(r.metadata || '{}'),
  effectivenessScore: Number(r.effectiveness_score ?? 0.5),
  viewCount: Number(r.view_count ?? 0),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
})

const rowToSequence = (r: any): TechniqueSequence => ({
  id: String(r.id),
  discipline: String(r.discipline),
  name: String(r.name),
  description: r.description ? String(r.description) : null,
  steps: JSON.parse(r.steps || '[]'),
  difficulty: r.difficulty as TechniqueSequence['difficulty'],
  tags: JSON.parse(r.tags || '[]'),
  createdAt: String(r.created_at),
})

const rowToCounter = (r: any): TechniqueCounter => ({
  id: String(r.id),
  techniqueId: String(r.technique_id),
  counterTechniqueId: String(r.counter_technique_id),
  effectiveness: r.effectiveness as TechniqueCounter['effectiveness'],
  notes: r.notes ? String(r.notes) : null,
  createdAt: String(r.created_at),
})

// ============================================================================
// CRUD — Categories
// ============================================================================

export async function insertCategory(cat: Omit<TechniqueCategory, 'createdAt'>): Promise<void> {
  const db = getDb()
  await db.prepare(
    `INSERT OR IGNORE INTO technique_categories (id, discipline, name, parent_id, description, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(cat.id, cat.discipline, cat.name, cat.parentId, cat.description, cat.sortOrder).run()
}

export async function insertEntry(entry: Omit<TechniqueEntry, 'createdAt' | 'updatedAt' | 'viewCount'>): Promise<void> {
  const db = getDb()
  await db.prepare(
    `INSERT OR IGNORE INTO technique_entries
     (id, category_id, discipline, name, japanese_name, korean_name, description,
      key_points, common_mistakes, difficulty, position_context, video_url, thumbnail_url,
      tags, metadata, effectiveness_score, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  ).bind(
    entry.id, entry.categoryId, entry.discipline, entry.name,
    entry.japaneseName, entry.koreanName, entry.description,
    JSON.stringify(entry.keyPoints), JSON.stringify(entry.commonMistakes),
    entry.difficulty, entry.positionContext, entry.videoUrl, entry.thumbnailUrl,
    JSON.stringify(entry.tags), JSON.stringify(entry.metadata), entry.effectivenessScore
  ).run()
}

export async function insertSequence(seq: Omit<TechniqueSequence, 'createdAt'>): Promise<void> {
  const db = getDb()
  await db.prepare(
    `INSERT OR IGNORE INTO technique_sequences (id, discipline, name, description, steps, difficulty, tags, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(seq.id, seq.discipline, seq.name, seq.description, JSON.stringify(seq.steps), seq.difficulty, JSON.stringify(seq.tags)).run()
}

export async function insertCounter(counter: Omit<TechniqueCounter, 'createdAt'>): Promise<void> {
  const db = getDb()
  await db.prepare(
    `INSERT OR IGNORE INTO technique_counters (id, technique_id, counter_technique_id, effectiveness, notes, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`
  ).bind(counter.id, counter.techniqueId, counter.counterTechniqueId, counter.effectiveness, counter.notes).run()
}

// ============================================================================
// Query — By Position
// ============================================================================

export async function queryByPosition(
  position: string,
  discipline?: string
): Promise<TechniqueEntry[]> {
  const db = getDb()
  let sql = `SELECT * FROM technique_entries WHERE position_context LIKE ?`
  const params: any[] = [`%${position}%`]

  if (discipline) {
    sql += ' AND discipline = ?'
    params.push(discipline)
  }

  sql += ' ORDER BY effectiveness_score DESC LIMIT 20'
  const rows = await db.prepare(sql).bind(...params).all()
  return (rows.results || []).map(rowToEntry)
}

// ============================================================================
// Query — Entries by category (vocabulary lookup for clip tagging)
// ============================================================================

export async function getEntriesByCategory(categoryId: string): Promise<TechniqueEntry[]> {
  const db = getDb()
  const rows = await db
    .prepare('SELECT * FROM technique_entries WHERE category_id = ? ORDER BY effectiveness_score DESC')
    .bind(categoryId)
    .all()
  return (rows.results || []).map(rowToEntry)
}

// ============================================================================
// Query — By Submission / Tag
// ============================================================================

export async function queryByTag(
  tag: string,
  discipline?: string
): Promise<TechniqueEntry[]> {
  const db = getDb()
  let sql = `SELECT * FROM technique_entries WHERE (tags LIKE ? OR name LIKE ? OR description LIKE ?)`
  const params: any[] = [`%${tag}%`, `%${tag}%`, `%${tag}%`]

  if (discipline) {
    sql += ' AND discipline = ?'
    params.push(discipline)
  }

  sql += ' ORDER BY effectiveness_score DESC LIMIT 20'
  const rows = await db.prepare(sql).bind(...params).all()
  return (rows.results || []).map(rowToEntry)
}

// ============================================================================
// Query — Counters for a technique
// ============================================================================

export async function queryCounters(techniqueId: string): Promise<{
  counter: TechniqueEntry
  effectiveness: string
  notes: string | null
}[]> {
  const db = getDb()
  const rows = await db.prepare(
    `SELECT tc.effectiveness, tc.notes, te.*
     FROM technique_counters tc
     JOIN technique_entries te ON te.id = tc.counter_technique_id
     WHERE tc.technique_id = ?
     ORDER BY tc.effectiveness ASC`
  ).bind(techniqueId).all()

  return (rows.results || []).map((r: any) => ({
    counter: rowToEntry(r),
    effectiveness: String(r.effectiveness),
    notes: r.notes ? String(r.notes) : null,
  }))
}

// ============================================================================
// Query — Counters by technique name (fuzzy)
// ============================================================================

export async function queryCountersByName(techniqueName: string, discipline?: string): Promise<{
  technique: TechniqueEntry
  counters: { counter: TechniqueEntry; effectiveness: string; notes: string | null }[]
}[]> {
  const db = getDb()
  let sql = `SELECT * FROM technique_entries WHERE name LIKE ?`
  const params: any[] = [`%${techniqueName}%`]
  if (discipline) {
    sql += ' AND discipline = ?'
    params.push(discipline)
  }
  sql += ' LIMIT 5'

  const techniques = await db.prepare(sql).bind(...params).all()
  const results: { technique: TechniqueEntry; counters: { counter: TechniqueEntry; effectiveness: string; notes: string | null }[] }[] = []

  for (const row of (techniques.results || [])) {
    const tech = rowToEntry(row)
    const counters = await queryCounters(tech.id)
    results.push({ technique: tech, counters })
  }

  return results
}

// ============================================================================
// Query — Sequences
// ============================================================================

export async function querySequences(
  discipline?: string,
  difficulty?: string
): Promise<TechniqueSequence[]> {
  const db = getDb()
  let sql = 'SELECT * FROM technique_sequences WHERE 1=1'
  const params: any[] = []

  if (discipline) {
    sql += ' AND discipline = ?'
    params.push(discipline)
  }
  if (difficulty) {
    sql += ' AND difficulty = ?'
    params.push(difficulty)
  }

  sql += ' ORDER BY created_at DESC LIMIT 20'
  const rows = await db.prepare(sql).bind(...params).all()
  return (rows.results || []).map(rowToSequence)
}

// ============================================================================
// Query — Full technique tree for a discipline
// ============================================================================

export async function getTechniqueTree(discipline: string): Promise<TechniqueTreeNode[]> {
  const db = getDb()

  const [catRows, entryRows] = await Promise.all([
    db.prepare('SELECT * FROM technique_categories WHERE discipline = ? ORDER BY sort_order').bind(discipline).all(),
    db.prepare('SELECT * FROM technique_entries WHERE discipline = ? ORDER BY effectiveness_score DESC').bind(discipline).all(),
  ])

  const categories = (catRows.results || []).map(rowToCategory)
  const entries = (entryRows.results || []).map(rowToEntry)

  // Build map
  const catMap = new Map<string, TechniqueTreeNode>()
  for (const cat of categories) {
    catMap.set(cat.id, { category: cat, children: [], techniques: [] })
  }

  // Assign entries to categories
  for (const entry of entries) {
    const node = catMap.get(entry.categoryId)
    if (node) node.techniques.push(entry)
  }

  // Build tree (parent-child)
  const roots: TechniqueTreeNode[] = []
  for (const node of catMap.values()) {
    if (node.category.parentId) {
      const parent = catMap.get(node.category.parentId)
      if (parent) {
        parent.children.push(node)
        continue
      }
    }
    roots.push(node)
  }

  return roots
}

// ============================================================================
// Query — Smart taxonomy search (used by AI coaching)
// ============================================================================

export async function taxonomySearch(query: string, discipline?: string): Promise<string> {
  const lowerQuery = query.toLowerCase()

  // Detect intent from query
  const positionKeywords = [
    'mount', 'side control', 'guard', 'half guard', 'back', 'turtle',
    'clinch', 'standing', 'north-south', 'knee on belly', 'closed guard',
    'open guard', 'butterfly', 'de la riva', 'spider guard',
  ]
  const submissionKeywords = [
    'armbar', 'triangle', 'kimura', 'guillotine', 'choke', 'rnc',
    'rear naked', 'omoplata', 'americana', 'leg lock', 'heel hook',
    'knee bar', 'ankle lock', 'darce', 'anaconda', 'ezekiel',
  ]
  const counterKeywords = ['counter', 'defend', 'defense', 'escape', 'stop', 'beat']
  const sequenceKeywords = ['combo', 'combination', 'chain', 'sequence', 'flow', 'drill']

  const blocks: string[] = []

  // Check for position queries
  const matchedPosition = positionKeywords.find(p => lowerQuery.includes(p))
  if (matchedPosition) {
    const entries = await queryByPosition(matchedPosition, discipline)
    if (entries.length > 0) {
      blocks.push(
        `## Techniques from ${matchedPosition}:\n` +
        entries.map(e =>
          `- **${e.name}** (${e.difficulty}, ${(e.effectivenessScore * 100).toFixed(0)}% effective)\n  ${e.description}\n  Key points: ${e.keyPoints.join('; ')}`
        ).join('\n')
      )
    }
  }

  // Check for submission queries
  const matchedSubmission = submissionKeywords.find(s => lowerQuery.includes(s))
  if (matchedSubmission) {
    const entries = await queryByTag(matchedSubmission, discipline)
    if (entries.length > 0) {
      blocks.push(
        `## ${matchedSubmission} techniques:\n` +
        entries.map(e =>
          `- **${e.name}** from ${e.positionContext || 'various'} (${e.difficulty})\n  ${e.description}`
        ).join('\n')
      )
    }
  }

  // Check for counter queries
  const hasCounterIntent = counterKeywords.some(k => lowerQuery.includes(k))
  if (hasCounterIntent) {
    // Extract what they want to counter
    const techniqueToCounter = lowerQuery
      .replace(/counter|defend|defense|escape|stop|beat|how|to|do|i|you|the|a|an|against|from|what/gi, '')
      .trim()
    if (techniqueToCounter.length > 2) {
      const counterResults = await queryCountersByName(techniqueToCounter, discipline)
      for (const result of counterResults) {
        if (result.counters.length > 0) {
          blocks.push(
            `## Counters to ${result.technique.name}:\n` +
            result.counters.map(c =>
              `- **${c.counter.name}** (${c.effectiveness} effectiveness)\n  ${c.counter.description}${c.notes ? `\n  Note: ${c.notes}` : ''}`
            ).join('\n')
          )
        }
      }
    }
  }

  // Check for sequence queries
  const hasSequenceIntent = sequenceKeywords.some(k => lowerQuery.includes(k))
  if (hasSequenceIntent) {
    const seqs = await querySequences(discipline)
    if (seqs.length > 0) {
      blocks.push(
        `## Training sequences:\n` +
        seqs.slice(0, 5).map(s =>
          `- **${s.name}** (${s.difficulty})\n  ${s.description || ''}\n  Steps: ${s.steps.map(st => st.notes || st.techniqueId).join(' → ')}`
        ).join('\n')
      )
    }
  }

  // Fallback: general tag search if no specific intent matched
  if (blocks.length === 0) {
    const words = lowerQuery.split(/\s+/).filter(w => w.length > 3)
    for (const word of words.slice(0, 3)) {
      const entries = await queryByTag(word, discipline)
      if (entries.length > 0) {
        blocks.push(
          `## Related techniques (${word}):\n` +
          entries.slice(0, 5).map(e =>
            `- **${e.name}** (${e.discipline}, ${e.positionContext || 'various'}): ${e.description.slice(0, 150)}...`
          ).join('\n')
        )
        break
      }
    }
  }

  if (blocks.length === 0) return ''

  return '## Structured Technique Knowledge\n\n' + blocks.join('\n\n')
}

// ============================================================================
// Bulk seed helper
// ============================================================================

export async function seedTaxonomy(data: {
  categories: Omit<TechniqueCategory, 'createdAt'>[]
  entries: Omit<TechniqueEntry, 'createdAt' | 'updatedAt' | 'viewCount'>[]
  sequences: Omit<TechniqueSequence, 'createdAt'>[]
  counters: Omit<TechniqueCounter, 'createdAt'>[]
}): Promise<{ categories: number; entries: number; sequences: number; counters: number }> {
  let catCount = 0
  let entryCount = 0
  let seqCount = 0
  let counterCount = 0

  for (const cat of data.categories) {
    try { await insertCategory(cat); catCount++ } catch { /* skip duplicates */ }
  }
  for (const entry of data.entries) {
    try { await insertEntry(entry); entryCount++ } catch { /* skip duplicates */ }
  }
  for (const seq of data.sequences) {
    try { await insertSequence(seq); seqCount++ } catch { /* skip duplicates */ }
  }
  for (const counter of data.counters) {
    try { await insertCounter(counter); counterCount++ } catch { /* skip duplicates */ }
  }

  return { categories: catCount, entries: entryCount, sequences: seqCount, counters: counterCount }
}
