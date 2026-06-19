import type { FactualLedger } from '@/lib/fightAnalysisPrompt'

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean) : [])

export function buildLedgerSummaryText(ledger: FactualLedger | null): string {
  if (!ledger) return ''

  const lines: string[] = []
  if (typeof ledger.combat_type === 'string' && ledger.combat_type) lines.push(`combat_type: ${ledger.combat_type}`)
  if (typeof ledger.ruleset_context === 'string' && ledger.ruleset_context) lines.push(`ruleset_context: ${ledger.ruleset_context}`)
  if (typeof ledger.stance_matchup === 'string' && ledger.stance_matchup) lines.push(`stance_matchup: ${ledger.stance_matchup}`)
  if (typeof ledger.matchup_style === 'string' && ledger.matchup_style) lines.push(`matchup_style: ${ledger.matchup_style}`)
  if (typeof ledger.exchange_volume === 'string' && ledger.exchange_volume) lines.push(`exchange_volume: ${ledger.exchange_volume}`)
  if (typeof ledger.tempo_controller === 'string' && ledger.tempo_controller) lines.push(`tempo_controller: ${ledger.tempo_controller}`)
  if (typeof ledger.space_controller === 'string' && ledger.space_controller) lines.push(`space_controller: ${ledger.space_controller}`)

  const fighters = Array.isArray(ledger.fighters) ? ledger.fighters : []
  for (const f of fighters) {
    if (!f || typeof f !== 'object') continue
    const id = (f as any).id
    if (typeof id !== 'string' || !id) continue
    const stance = typeof (f as any).stance === 'string' ? (f as any).stance : 'unknown'
    const desc = typeof (f as any).description === 'string' ? (f as any).description : ''
    lines.push(`fighter_${id}: stance=${stance}${desc ? `; appearance=${desc}` : ''}`)
  }

  const pushSection = (label: string, v: unknown, max = 20) => {
    const items = arr(v).slice(0, max)
    if (items.length) lines.push(`${label}: ${items.join(' | ')}`)
  }

  pushSection('observed_facts', ledger.observed_facts, 18)
  pushSection('techniques_observed', ledger.techniques_observed, 18)
  pushSection('combos_observed', ledger.combos_observed, 10)
  pushSection('pace_and_positioning', ledger.pace_and_positioning, 12)
  pushSection('range_and_distance', ledger.range_and_distance, 12)
  pushSection('power_hand_read', ledger.power_hand_read, 10)
  pushSection('key_moments', ledger.key_moments, 12)

  return lines.join('\n').trim()
}

export function buildRetrievalQueryText(args: {
  ledger: FactualLedger | null
  userIntent?: string
}): string {
  const { ledger, userIntent } = args
  const base = buildLedgerSummaryText(ledger)
  const intent = typeof userIntent === 'string' ? userIntent.trim() : ''
  return [intent ? `intent: ${intent}` : '', base].filter(Boolean).join('\n').trim()
}

