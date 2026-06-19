import { describe, expect, it } from 'vitest'
import {
  buildGeminiReflexFrameRequest,
  sanitizeReflexFrameAnalysis,
  SENSEI_CUE_MAX_WORDS,
} from './reflex-frame'

describe('reflex-frame Gemini request', () => {
  it('uses Gemini JSON mode, schema enforcement, and low-latency Flash thinking', () => {
    const body = buildGeminiReflexFrameRequest({
      imageBase64: 'abc123',
      mimeType: 'image/jpeg',
      context: {
        focusTarget: 'A',
        fighterProfile: {
          name: 'Blue corner',
          weaknesses: ['drops lead hand after jab'],
          strengths: ['fast counter cross'],
        },
        gymRules: {
          houseStyle: 'pressure without crossing feet',
          bannedAdvice: ['never tell beginners to spar hard'],
        },
      },
    })

    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(body.generationConfig.responseJsonSchema).toBeTruthy()
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 })
    expect(body.generationConfig.maxOutputTokens).toBeLessThanOrEqual(512)
    expect(body.contents[0].parts).toContainEqual({
      inlineData: { mimeType: 'image/jpeg', data: 'abc123' },
    })

    const firstPart = body.contents[0].parts[0]
    const prompt = 'text' in firstPart ? String(firstPart.text) : ''
    expect(prompt).toContain('RAW FRAME IS THE SOURCE OF TRUTH')
    expect(prompt).toContain('FIGHTER PROFILE RAM')
    expect(prompt).toContain('drops lead hand after jab')
    expect(prompt).toContain('CUSTOM GYM RULES RAM')
    expect(prompt).toContain('pressure without crossing feet')
  })

  it('enforces the Voice of Sensei cue limit and clamps 0-1000 spatial output', () => {
    const sanitized = sanitizeReflexFrameAnalysis({
      cue: 'hands must come back to your face after every jab immediately',
      focus: 'guard',
      target: 'A',
      urgency: 'high',
      confidence: 1.5,
      spatialMap: {
        fighterA: {
          center: { x: -25, y: 1100 },
          head: { x: 502, y: 130 },
          leadHand: { x: 721, y: 220 },
          rearHand: { x: 745, y: 235 },
          leadFoot: { x: 455, y: 980 },
          rearFoot: { x: 390, y: 990 },
        },
      },
      fighterA: {
        stance: 'orthodox',
        guard: 'lead hand low',
        position: 'outside',
        technique: 'jab recovery',
        openings: ['counter right'],
      },
      fighterB: {
        stance: 'unknown',
        guard: 'high',
        position: 'pressing',
        technique: 'waiting',
        openings: [],
      },
      exchange: {
        range: 'boxing',
        tempo: 'fast',
        advantage: 'B can counter',
      },
      coaching: {
        immediate: [],
        strategic: [],
        drills: [],
      },
    })

    expect(sanitized.cue.split(/\s+/)).toHaveLength(SENSEI_CUE_MAX_WORDS)
    expect(sanitized.confidence).toBe(1)
    expect(sanitized.spatialMap.fighterA?.center).toEqual({ x: 0, y: 1000 })
    expect(sanitized.coaching.immediate[0]).toBe(sanitized.cue)
  })
})
