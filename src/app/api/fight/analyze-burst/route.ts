/**
 * Analyze Burst API Endpoint
 *
 * Accepts a KinematicBurst (1-second proof packet) and returns
 * detailed biomechanical analysis with frame-specific feedback.
 */

import { NextResponse } from 'next/server'
import { generateJson } from '@/lib/gemini/gemini-client'
import { resolvedModels } from '@/lib/gemini/models'
import { aiGuard } from '@/lib/ai/aiGuard'

interface BurstFrame {
  seq: number
  dtMs: number
  jpegBase64: string
  landmarks: number[][]
}

interface KinematicBurst {
  burstId: string
  centerMs: number
  focusTarget: 'A' | 'B' | 'both'
  frames: BurstFrame[]
  metadata: {
    captureReason: 'manual' | 'auto-detected' | 'peak-motion'
    videoDuration: number
    capturedAt: number
    eventKind?: string
  }
}

interface BurstAnalysisResult {
  primaryIssue: string
  evidence: Array<{ seq: number; what: string }>
  mechanics: string
  fix: string
  drill: string
  telegraphDetected?: boolean
  telegraphDetails?: {
    type: string
    detectionFrame: number
    executionFrame: number
    timeGapMs: number
  }
  severity: 'critical' | 'high' | 'medium' | 'low'
  confidenceScore: number
}

const BURST_ANALYSIS_PROMPT = `You are Musashi, an elite biomechanics coach with decades of martial arts experience. You are analyzing a 1-second burst of combat footage with millisecond precision.

INPUT DATA:
- Sequential frames spanning exactly 1 second
- Exact timestamps for each frame (dtMs = offset from center in milliseconds)
- Skeletal landmark coordinates (33 joints with x,y,z,visibility)

YOUR ANALYSIS PROCESS:
1. OBSERVE: Examine all frames in sequence, noting body positions
2. MEASURE: Calculate joint angles, distances, and velocities from landmark deltas
3. COMPARE: Compare against optimal biomechanics for the detected technique
4. DETECT: Identify telegraphs (pre-movement tells that signal intent)
5. DIAGNOSE: Determine root cause of any issues
6. PRESCRIBE: Provide specific, actionable corrections

TELEGRAPH DETECTION RULES:
A telegraph is ANY preparatory movement visible BEFORE the intended action:
- Shoulder raising before punch
- Hip dropping before kick
- Weight shift before level change
- Guard hand dropping before opposite hand throws
- Eye direction change before strike
- Elbow flaring before hook

OUTPUT FORMAT (JSON only, no markdown):
{
  "primaryIssue": "Main biomechanical problem detected",
  "evidence": [
    {"seq": 3, "what": "Right shoulder elevated 4cm"},
    {"seq": 7, "what": "Punch execution with telegraphed intent"}
  ],
  "mechanics": "Technical explanation using pose coordinate deltas",
  "fix": "Specific actionable correction",
  "drill": "Training exercise with reps/sets",
  "telegraphDetected": true,
  "telegraphDetails": {
    "type": "shoulder_raise",
    "detectionFrame": 3,
    "executionFrame": 7,
    "timeGapMs": 332
  },
  "severity": "high",
  "confidenceScore": 0.92
}

CRITICAL: Always cite specific frame sequence numbers (seq). The fighter needs to SEE the exact moment.
Be concise but precise. No fluff.`

export async function POST(request: Request) {
  try {
    const guard = await aiGuard(request, 'analyze')
    if (!guard.ok) return guard.response

    if (process.env.GEMINI_DRY_RUN === '1' || process.env.OFFLINE_MODE === '1') {
      return NextResponse.json({
        mocked: true,
        candidates: [],
        kinematics: {},
        message: '[OFFLINE] analyze-burst mocked',
      })
    }

    const burst: KinematicBurst = await request.json()

    if (!burst.frames || burst.frames.length === 0) {
      return NextResponse.json({ error: 'No frames provided in burst' }, { status: 400 })
    }

    const framesWithImages = burst.frames.filter((f) => f.jpegBase64 && f.jpegBase64.length > 0)

    const parts: Array<Record<string, unknown>> = [{ text: BURST_ANALYSIS_PROMPT }]

    for (const frame of framesWithImages) {
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: frame.jpegBase64 } })
    }

    const frameData = burst.frames.map((f) => ({
      seq: f.seq,
      dtMs: f.dtMs,
      hasImage: f.jpegBase64?.length > 0,
      landmarks: f.landmarks,
    }))

    parts.push({
      text: `
BURST ANALYSIS REQUEST

Burst ID: ${burst.burstId}
Focus Target: ${burst.focusTarget}
Capture Reason: ${burst.metadata.captureReason}
Event Kind: ${burst.metadata.eventKind || 'unknown'}
Center Time: ${burst.centerMs}ms

FRAME TIMELINE (${burst.frames.length} frames, 1 second window):
${burst.frames
  .map(
    (f) =>
      `  Frame ${f.seq}: T${f.dtMs >= 0 ? '+' : ''}${f.dtMs}ms ${f.jpegBase64?.length > 0 ? '[has image]' : '[pose only]'}`
  )
  .join('\n')}

POSE DATA (landmark coordinates for each frame):
${JSON.stringify(frameData, null, 2)}

Analyze this burst for:
1. Telegraphs (pre-movement tells)
2. Biomechanical errors (form issues)
3. Power leaks (inefficient mechanics)
4. Tactical opportunities

Return ONLY valid JSON matching the schema above.`,
    })

    const { data: analysis, model } = await generateJson<BurstAnalysisResult>({
      model: resolvedModels.burst(),
      parts,
      temperature: 0.3,
      maxOutputTokens: 2048,
    })

    return NextResponse.json({
      success: true,
      burstId: burst.burstId,
      analysis,
      model,
      framesAnalyzed: burst.frames.length,
      imagesIncluded: framesWithImages.length,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[analyze-burst]', message)
    return NextResponse.json(
      {
        success: false,
        error: message,
        hint: 'Burst analysis failed. Check GEMINI_API_KEY and dev server logs.',
      },
      { status: 502 }
    )
  }
}
