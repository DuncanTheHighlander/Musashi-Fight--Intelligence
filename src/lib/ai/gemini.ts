/** @deprecated Use gemini-embed.ts + gemini-reason.ts + gemini-client.ts instead. */
import { GoogleGenerativeAI } from '@google/generative-ai'
import { GEMINI_MODEL_DEFAULT, GEMINI_EMBED_MODEL_DEFAULT } from '@/lib/gemini/models'

function getGenAI() {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set')
  return new GoogleGenerativeAI(apiKey)
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const genAI = getGenAI()
  const model = genAI.getGenerativeModel({ model: process.env.GEMINI_EMBED_MODEL || GEMINI_EMBED_MODEL_DEFAULT })
  const resp = await model.embedContent(text)
  const values = resp?.embedding?.values
  if (!values || !Array.isArray(values)) throw new Error('Embedding response missing values')
  return values
}

export async function generateCoachNarrative(prompt: string): Promise<string> {
  const genAI = getGenAI()
  const modelName = process.env.GEMINI_MODEL || GEMINI_MODEL_DEFAULT
  const model = genAI.getGenerativeModel({ model: modelName })
  const resp = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 1400,
    },
  })
  const out = resp.response.text()
  return String(out || '').trim()
}

