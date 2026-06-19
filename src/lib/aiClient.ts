import { getActivePromptContent } from './musashiPrompts'
import { getDisciplinePrompt, type Discipline } from './disciplinePrompts'

/**
 * Central AI client to fetch active prompt rules and compose final system prompts.
 * Used by chat, analysis, and reflex endpoints.
 */

export type PromptRuleKey = 'fight_chat_system' | 'fight_preset_gameplan' | 'fight_preset_counters' | 'fight_preset_corner'

export const DEFAULT_PROMPTS: Record<PromptRuleKey, string> = {
  fight_chat_system:
    'You are Musashi Fight Coach: elite corner, analyst, and strategist.\n' +
    'Be high-signal and practical. No fluff, no disclaimers, no generic motivation.\n' +
    'Always blend tactics + strategy in the SAME answer (do not treat "strategy" as separate).\n' +
    'When possible, structure responses as:\n' +
    '1) Immediate fixes (1-3 short cues)\n' +
    '2) Plan (range + tempo + primary win condition)\n' +
    '3) Counters/setups (2-4 concrete options)\n' +
    '4) Drill (one drill to install it)\n' +
    'If context includes an analysis with fighter candidates, reference Fighter A/B and the selected fighter.\n',
  fight_preset_gameplan:
    '{{context}}\n' +
    '{{pov}}\n' +
    'Give me a Round 1 gameplan for THIS ruleset and styles. Include:\n' +
    '- Range + tempo control\n' +
    '- 1 primary win condition\n' +
    '- 2 setups to enter safely\n' +
    '- 2 exits/resets to stay safe\n' +
    '- 2 "if they adjust…" branches\n' +
    '- 1 drill to install it\n' +
    'Be specific: name the triggers (lead hand battle, stance matchup, angle, timing window).',
  fight_preset_counters:
    '{{context}}\n' +
    '{{pov}}\n' +
    'Read the opponent: what are they trying to make me do (trap)?\n' +
    'Give a simple IF→THEN decision tree (3 branches) and 2 high-percentage punish sequences that match the ruleset and their style archetype.\n' +
    'Include one counter that punishes footwork/angle, not just the hands.',
  fight_preset_corner:
    '{{context}}\n' +
    '{{pov}}\n' +
    'Corner talk between rounds: give me 3 priorities (10 seconds), 1 tactical adjustment, and 1 mental cue.\n' +
    'Make it realistic for this ruleset and style matchup. No fluff.',
}

/**
 * Fetch the active prompt rule for a given key and prepend it to the system prompt.
 * If no active rule exists, falls back to the provided fallback or default.
 */
export async function composeSystemPrompt(
  key: PromptRuleKey,
  fallback?: string,
  context?: string,
  knowledgeContext?: string,
  discipline?: Discipline | string
): Promise<string> {
  const basePrompt = fallback || DEFAULT_PROMPTS[key]
  const activeRule = await getActivePromptContent(key, basePrompt)

  let final = activeRule.trim()

  // Inject discipline-specific coaching context
  if (discipline && discipline !== 'unknown') {
    final += '\n\n' + getDisciplinePrompt(discipline as Discipline)
  }

  // Append context if provided
  if (context) {
    final += '\n\nContext JSON:\n' + context
  }

  // Append knowledge context if provided
  if (knowledgeContext) {
    final += '\n\n' + knowledgeContext
  }

  return final
}

/**
 * Helper to substitute placeholders in preset prompts (e.g., {{context}}, {{pov}})
 */
export function substitutePlaceholders(template: string, variables: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`
    result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value)
  }
  return result
}
