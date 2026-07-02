import { describe, expect, it } from 'vitest'
import { buildFightClipAiMetadata, clipTypeLabelFor, sportLabelFor } from './fightClipMetadata'

describe('fight clip AI metadata', () => {
  it('passes selected ruleset and clip context to AI calls', () => {
    expect(buildFightClipAiMetadata({ sport: 'boxing', clipType: 'sparring' })).toEqual({
      discipline: 'boxing',
      sport: 'boxing',
      clipType: 'sparring',
    })
  })

  it('omits empty metadata instead of sending blank prompt fields', () => {
    expect(buildFightClipAiMetadata({ sport: '', clipType: '' })).toEqual({})
  })

  it('labels selected values for the upload dialog and header controls', () => {
    expect(sportLabelFor('muay_thai')).toBe('Muay Thai')
    expect(sportLabelFor('')).toBe('Auto-detect')
    expect(clipTypeLabelFor('competition')).toBe('Competition')
    expect(clipTypeLabelFor('')).toBe('Clip context')
  })
})
