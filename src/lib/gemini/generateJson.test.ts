/**
 * generateJson — Gemini 3.x thinking-model safety.
 *
 * Regression cover for the production bug where Teach Musashi showed
 * "Gemini returned invalid JSON: … "position":" and leaked chain-of-thought:
 * generateJson was the only Gemini call site that never sent thinkingConfig,
 * so thinking tokens consumed the small maxOutputTokens budget and truncated
 * the payload, and it read parts[0] even when parts[0] was a thought part.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cloudflare/secrets', () => ({
  requireGeminiApiKey: vi.fn(async () => 'test-api-key'),
  getServerSecret: vi.fn(async () => 'test-api-key'),
}))

import { firstPayloadText, generateJson } from './gemini-client'

type Part = { text?: string; thought?: boolean }

function geminiResponse(parts: Part[], finishReason = 'STOP') {
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts }, finishReason }] }),
    text: async () => JSON.stringify({ candidates: [{ content: { parts }, finishReason }] }),
  } as unknown as Response
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

/** generationConfig of the Nth fetch call. */
function sentConfig(callIndex = 0): Record<string, any> {
  const body = JSON.parse(String(fetchMock.mock.calls[callIndex]![1]!.body))
  return body.generationConfig
}

describe('generateJson — thinking config', () => {
  it('pins thinkingLevel LOW on Gemini 3.x models', async () => {
    fetchMock.mockResolvedValueOnce(geminiResponse([{ text: '{"ok":true}' }]))
    await generateJson({ model: 'gemini-3.6-flash', parts: [{ text: 'hi' }] })
    expect(sentConfig().thinkingConfig).toEqual({ thinkingLevel: 'LOW' })
  })

  it('uses thinkingBudget 0 on pre-3.x models', async () => {
    fetchMock.mockResolvedValueOnce(geminiResponse([{ text: '{"ok":true}' }]))
    await generateJson({ model: 'gemini-2.5-flash', parts: [{ text: 'hi' }] })
    expect(sentConfig().thinkingConfig).toEqual({ thinkingBudget: 0 })
  })

  it('keeps the shared default budget at 2048 (no blanket raise)', async () => {
    fetchMock.mockResolvedValueOnce(geminiResponse([{ text: '{"ok":true}' }]))
    await generateJson({ model: 'gemini-3.6-flash', parts: [{ text: 'hi' }] })
    expect(sentConfig().maxOutputTokens).toBe(2048)
  })

  it('omits responseSchema unless supplied, and forwards it when given', async () => {
    fetchMock.mockResolvedValueOnce(geminiResponse([{ text: '{"ok":true}' }]))
    await generateJson({ model: 'gemini-3.6-flash', parts: [{ text: 'hi' }] })
    expect(sentConfig()).not.toHaveProperty('responseSchema')

    const schema = { type: 'OBJECT', properties: {} }
    fetchMock.mockResolvedValueOnce(geminiResponse([{ text: '{"ok":true}' }]))
    await generateJson({ model: 'gemini-3.6-flash', parts: [{ text: 'hi' }], responseSchema: schema })
    expect(sentConfig(1).responseSchema).toEqual(schema)
  })
})

describe('generateJson — thought parts', () => {
  it('skips a thought part and parses the real payload', async () => {
    fetchMock.mockResolvedValueOnce(
      geminiResponse([
        { thought: true, text: 'Let\'s check position/transition: Position: "front_headlock"' },
        { text: '{"incorrect_labels":["strikes"],"correct_labels":["guillotine"]}' },
      ]),
    )
    const { data } = await generateJson<{ correct_labels: string[] }>({
      model: 'gemini-3.6-flash',
      parts: [{ text: 'hi' }],
    })
    expect(data.correct_labels).toEqual(['guillotine'])
  })

  it('firstPayloadText ignores thought parts and empty text', () => {
    expect(
      firstPayloadText({ content: { parts: [{ thought: true, text: 'thinking' }, { text: '  ' }, { text: 'real' }] } }),
    ).toBe('real')
    expect(firstPayloadText({ content: { parts: [{ text: 'first' }, { text: 'second' }] } })).toBe('first')
    expect(firstPayloadText(undefined)).toBe('')
  })
})

describe('generateJson — finish reasons', () => {
  it('retries ONCE with a doubled budget on MAX_TOKENS, then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(geminiResponse([{ text: '{"incorrect_labels":["strikes"],"posi' }], 'MAX_TOKENS'))
      .mockResolvedValueOnce(geminiResponse([{ text: '{"ok":true}' }]))

    const { data } = await generateJson<{ ok: boolean }>({
      model: 'gemini-3.6-flash',
      parts: [{ text: 'hi' }],
      maxOutputTokens: 4096,
    })

    expect(data.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sentConfig(0).maxOutputTokens).toBe(4096)
    expect(sentConfig(1).maxOutputTokens).toBe(8192)
  })

  it('reports truncation as MAX_TOKENS, never as "invalid JSON"', async () => {
    fetchMock
      .mockResolvedValueOnce(geminiResponse([{ text: '{"incorrect_labels":["strikes"],"posi' }], 'MAX_TOKENS'))
      .mockResolvedValueOnce(geminiResponse([{ text: '{"correct_labels":["guill' }], 'MAX_TOKENS'))

    await expect(
      generateJson({ model: 'gemini-3.6-flash', parts: [{ text: 'hi' }] }),
    ).rejects.toThrow(/MAX_TOKENS/)
    // Exactly one retry — never recurses.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('surfaces SAFETY blocks distinctly and does not retry', async () => {
    fetchMock.mockResolvedValueOnce(geminiResponse([{ text: '' }], 'SAFETY'))
    await expect(
      generateJson({ model: 'gemini-3.6-flash', parts: [{ text: 'hi' }] }),
    ).rejects.toThrow(/SAFETY/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('still throws invalid-JSON for genuinely malformed output that finished normally', async () => {
    fetchMock.mockResolvedValueOnce(geminiResponse([{ text: 'not json at all' }], 'STOP'))
    await expect(
      generateJson({ model: 'gemini-3.6-flash', parts: [{ text: 'hi' }] }),
    ).rejects.toThrow(/invalid JSON/)
    // No retry on a parse failure — fetchWithRetry already covers 429/503.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
