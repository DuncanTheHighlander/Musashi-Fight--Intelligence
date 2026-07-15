/**
 * Vision flash-scan + verification pass (Gemini Flash on video).
 * Shared by /api/fight/analyze and mirrors the streaming pipeline in route.ts.
 */

import { getServerSecret } from '@/lib/cloudflare/secrets'
import {
  buildEvidenceLedgerPrompt,
  buildEvidenceVerificationPrompt,
  type FactualLedger,
} from '@/lib/fightAnalysisPrompt'
import { resolvedModels } from '@/lib/gemini/models'
import {
  buildGrapplingEvidenceLedgerPrompt,
  buildGrapplingVerificationPrompt,
  GRAPPLING_LEDGER_RESPONSE_SCHEMA,
  sanitizeGrapplingVisionLedger,
} from '@/lib/grapplingAnalysisPrompt'
import {
  fightLangToVerificationCandidate,
  type SessionEvidenceProvenance,
} from '@/lib/evidence/sessionEvidence'

function extractJsonObject<T = Record<string, unknown>>(raw: string): T | null {
  const text = raw.trim()
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0]) as T
    } catch {
      return null
    }
  }
}

function hasMeaningfulLedgerData(ledger: FactualLedger | null | undefined): boolean {
  if (!ledger || typeof ledger !== 'object') return false
  if (Array.isArray(ledger.video_analysis_ledger) && ledger.video_analysis_ledger.length > 0) return true
  if (Array.isArray(ledger.techniques_observed) && ledger.techniques_observed.length > 0) return true
  if (Array.isArray(ledger.observed_facts) && ledger.observed_facts.length > 0) return true
  return false
}

async function flashGenerate(args: {
  videoFileUri: string
  videoMimeType: string
  prompt: string
  useGrapplingSchema?: boolean
  timeoutMs?: number
}): Promise<FactualLedger | null> {
  const geminiKey = await getServerSecret('GEMINI_API_KEY')
  if (!geminiKey) return null

  const model = resolvedModels.flash()
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 35_000)

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { fileData: { fileUri: args.videoFileUri, mimeType: args.videoMimeType } },
              { text: args.prompt },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          ...(args.useGrapplingSchema ? { responseSchema: GRAPPLING_LEDGER_RESPONSE_SCHEMA } : {}),
        },
      }),
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      console.warn('[verifyEvidenceLedger] Flash request failed:', resp.status, errText.slice(0, 200))
      return null
    }

    const data = (await resp.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    return extractJsonObject<FactualLedger>(rawText)
  } catch (e) {
    console.warn('[verifyEvidenceLedger] Flash error:', e instanceof Error ? e.message : e)
    return null
  } finally {
    clearTimeout(timer)
  }
}

export type BuildVisionLedgerArgs = {
  videoFileUri: string
  videoMimeType?: string
  mode: SessionEvidenceProvenance['mode']
  clipDurationMs?: number
  focusTarget?: string
  fightLangCandidate?: FactualLedger | null
  poseEvidenceText?: string
}

/** Flash scan: grappling timeline or striking factual ledger from video. */
export async function buildVisionLedger(args: BuildVisionLedgerArgs): Promise<FactualLedger | null> {
  const mime = args.videoMimeType || 'video/mp4'
  const clipDurationSec =
    typeof args.clipDurationMs === 'number' && args.clipDurationMs > 0
      ? args.clipDurationMs / 1000
      : undefined

  if (args.mode === 'grappling') {
    let ledger = await flashGenerate({
      videoFileUri: args.videoFileUri,
      videoMimeType: mime,
      useGrapplingSchema: true,
      prompt: buildGrapplingEvidenceLedgerPrompt({
        clipDuration: args.clipDurationMs,
        focusTarget: args.focusTarget,
      }),
    })
    if (!hasMeaningfulLedgerData(ledger)) {
      ledger = await flashGenerate({
        videoFileUri: args.videoFileUri,
        videoMimeType: mime,
        useGrapplingSchema: true,
        prompt: buildGrapplingEvidenceLedgerPrompt({
          clipDuration: args.clipDurationMs,
          focusTarget: args.focusTarget,
          attempt: 'emergency',
        }),
      })
    }
    return ledger ? sanitizeGrapplingVisionLedger(ledger) : null
  }

  // Striking: use provided candidate from FightLang or flash-scan fresh.
  if (args.fightLangCandidate && hasMeaningfulLedgerData(args.fightLangCandidate)) {
    return args.fightLangCandidate
  }

  return flashGenerate({
    videoFileUri: args.videoFileUri,
    videoMimeType: mime,
    prompt: buildEvidenceLedgerPrompt({
      clipDuration: clipDurationSec,
      focusTarget: args.focusTarget as 'both' | 'blue' | 'red' | 'A' | 'B' | undefined,
      poseEvidenceText: args.poseEvidenceText,
    }),
  })
}

export type VerifyVisionLedgerArgs = {
  candidate: FactualLedger | null
  videoFileUri: string
  videoMimeType?: string
  mode: SessionEvidenceProvenance['mode']
  clipDurationMs?: number
  poseEvidenceText?: string
}

/** Re-watch video and correct/remove unsupported ledger entries. */
export async function verifyVisionLedger(args: VerifyVisionLedgerArgs): Promise<FactualLedger | null> {
  if (!args.candidate) return null

  const mime = args.videoMimeType || 'video/mp4'
  const clipDurationSec =
    typeof args.clipDurationMs === 'number' && args.clipDurationMs > 0
      ? args.clipDurationMs / 1000
      : undefined

  const prompt =
    args.mode === 'grappling'
      ? buildGrapplingVerificationPrompt(args.candidate, { clipDuration: args.clipDurationMs })
      : buildEvidenceVerificationPrompt(args.candidate, {
          clipDuration: clipDurationSec,
          poseEvidenceText: args.poseEvidenceText,
        })

  const verified = await flashGenerate({
    videoFileUri: args.videoFileUri,
    videoMimeType: mime,
    useGrapplingSchema: args.mode === 'grappling',
    prompt,
    timeoutMs: 40_000,
  })

  if (!verified || !hasMeaningfulLedgerData(verified)) {
    return args.mode === 'grappling'
      ? sanitizeGrapplingVisionLedger(args.candidate)
      : args.candidate
  }

  return args.mode === 'grappling'
    ? sanitizeGrapplingVisionLedger(verified)
    : verified
}

export { fightLangToVerificationCandidate, hasMeaningfulLedgerData }
