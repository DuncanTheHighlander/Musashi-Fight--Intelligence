import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  defaultOutputDimensionality,
  embedText,
  embedVideo,
  GEMINI_EMBED_DIMENSION_DEFAULT,
} from './gemini-embed'

const lastFetchBody = (fetchMock: ReturnType<typeof vi.fn>): Record<string, any> => {
  const call = fetchMock.mock.calls.at(-1)
  const init = call?.[1] as RequestInit | undefined
  return JSON.parse(String(init?.body))
}

describe('Gemini embedding dimensionality', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('defaults to the Vectorize-compatible dimension', () => {
    expect(defaultOutputDimensionality()).toBe(GEMINI_EMBED_DIMENSION_DEFAULT)
  })

  it('allows a positive integer env override', () => {
    vi.stubEnv('GEMINI_EMBED_DIMENSION', '768')

    expect(defaultOutputDimensionality()).toBe(768)
  })

  it('falls back when the env override is invalid', () => {
    vi.stubEnv('GEMINI_EMBED_DIMENSION', 'wide')

    expect(defaultOutputDimensionality()).toBe(GEMINI_EMBED_DIMENSION_DEFAULT)
  })

  it('sends default outputDimensionality for single text embeddings', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    const fetchMock = vi.fn(async () => Response.json({ embedding: { values: [1, 2, 3] } }))
    vi.stubGlobal('fetch', fetchMock)

    await embedText('jab cross', { taskType: 'RETRIEVAL_DOCUMENT' })

    const body = lastFetchBody(fetchMock)
    expect(body.outputDimensionality).toBe(GEMINI_EMBED_DIMENSION_DEFAULT)
  })

  it('sends default outputDimensionality for batched text embeddings', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    const fetchMock = vi.fn(async () =>
      Response.json({ embeddings: [{ values: [1] }, { values: [2] }] })
    )
    vi.stubGlobal('fetch', fetchMock)

    await embedText(['jab', 'cross'], { taskType: 'RETRIEVAL_DOCUMENT' })

    const body = lastFetchBody(fetchMock)
    expect(body.requests).toEqual([
      expect.objectContaining({ outputDimensionality: GEMINI_EMBED_DIMENSION_DEFAULT }),
      expect.objectContaining({ outputDimensionality: GEMINI_EMBED_DIMENSION_DEFAULT }),
    ])
  })

  it('sends default outputDimensionality for video embeddings', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    const fetchMock = vi.fn(async () => Response.json({ embedding: { values: [1, 2] } }))
    vi.stubGlobal('fetch', fetchMock)

    await embedVideo({
      kind: 'inline',
      mimeType: 'video/mp4',
      base64: 'AAAA',
    })

    const body = lastFetchBody(fetchMock)
    expect(body.outputDimensionality).toBe(GEMINI_EMBED_DIMENSION_DEFAULT)
  })
})
