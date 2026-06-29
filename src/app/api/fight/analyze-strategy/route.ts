/**
 * Analyze Strategy API Endpoint
 * 
 * Macro-level analysis for full rounds or longer clips.
 * Accepts compressed pose timeline + select keyframes (NOT raw video).
 * 
 * Uses Gemini 2.0 Flash Thinking for strategic pattern recognition.
 */

import { NextResponse } from 'next/server'
import { generateJson } from '@/lib/gemini/gemini-client'
import { resolvedModels } from '@/lib/gemini/models'
import { aiGuard, aiErrorResponse } from '@/lib/ai/aiGuard'
import { maybeEnforceVideoFromAnalyzeRequest } from '@/lib/musashiUsage'

interface PoseTimelineEntry {
  tMs: number
  landmarks: number[][]
  velocity?: number
}

interface Keyframe {
  tMs: number
  jpegBase64: string
  landmarks: number[][]
  eventKind?: string
}

interface StrategyAnalysisRequest {
  durationMs?: number
  poseTimeline?: PoseTimelineEntry[]  // Downsampled to 5-10hz
  keyframes?: Keyframe[]              // 4-10 max, from events
  frames?: string[]                   // Base64 frames (fallback)
  videoFileUri?: string               // Gemini Files API URI (preferred)
  focusTarget: 'A' | 'B' | 'both'
  analysis?: any                      // Current frame analysis
  kinematics?: any                    // Current kinematics snapshot
  patterns?: string                   // Pattern analysis formatted for AI
  exchangeSummary?: {                 // Exchange timeline summary
    totalExchanges: number
    avgDuration: number
    phases: string[]
  }
  metadata?: {
    ruleset?: string
    roundNumber?: number
    fightContext?: string
  }
}

interface StrategyAnalysisResult {
  pacing: {
    summary: string
    highActivityPeriods: Array<{ startMs: number; endMs: number }>
    fatigueDropoffMs?: number
    recommendations: string[]
  }
  habits: {
    detected: Array<{
      pattern: string
      frequency: number
      timestamps: number[]
      exploitability: 'high' | 'medium' | 'low'
    }>
    summary: string
  }
  weaknesses: {
    tactical: string[]
    technical: string[]
    physical: string[]
  }
  strengths: {
    identified: string[]
    leverage: string
  }
  gameplan: {
    priority1: string
    priority2: string
    priority3: string
    roundStrategy: string
  }
  confidenceScore: number
}

const STRATEGY_ANALYSIS_PROMPT = `You are Musashi, a legendary fight strategist analyzing a full combat round or extended clip.

You receive:
1. A compressed pose timeline (sampled at 5-10hz) showing fighter movement patterns over time
2. 4-10 keyframes captured at significant moments (strikes, level changes, etc.)

YOUR STRATEGIC ANALYSIS MUST COVER:

1. PACING ANALYSIS
   - When is the fighter most active?
   - Where does cardio/intensity drop?
   - Work rate patterns

2. HABIT DETECTION
   - Repeated movement patterns
   - Predictable responses to specific situations
   - Exploitable tendencies

3. WEAKNESS IDENTIFICATION
   - Tactical gaps (positioning, timing, range management)
   - Technical flaws (stance, guard, transitions)
   - Physical limitations (reach, speed, power indicators)

4. STRENGTH RECOGNITION
   - What's working well
   - Natural advantages to leverage

5. GAMEPLAN
   - Top 3 training priorities (each = issue + SPECIFIC drill prescription with reps/rounds/equipment)
   - Round strategy = tactical sequence for HOW to fight the round (guard, feints, counters, distance)

GAMEPLAN FORMAT (critical):
- priority1, priority2, priority3: Each MUST be "Issue - specific drill prescription"
  Example: "Fix rear hand discipline - 3 rounds shadowboxing holding a tennis ball under the right chin"
  Example: "Active reset drills - hit the heavy bag, step out at an angle, immediately snap hands to eyebrows"
  Example: "Shoulder conditioning - 3x3min rounds of speed bag or burnout punches with light dumbbells"
  NOT generic like "Fix telegraph" or "Improve cardio" — always include the exact drill, rounds, or equipment.

- roundStrategy: Tactical sequence for the round. Start with guard/stance, then feint approach, counter plan, distance management when resetting.
  Example: "Start with a high, tight guard. Feint to draw out their attacks, counter off the stable base, and strictly manage distance when resetting to protect the exposed centerline."
  NOT generic like "Fast start, control center" — describe the actual tactical sequence.

OUTPUT FORMAT (JSON only):
{
  "pacing": {
    "summary": "Brief pacing analysis",
    "highActivityPeriods": [{"startMs": 0, "endMs": 15000}],
    "fatigueDropoffMs": 45000,
    "recommendations": ["Increase work rate in first 30 seconds"]
  },
  "habits": {
    "detected": [
      {
        "pattern": "Drops right hand before jab",
        "frequency": 4,
        "timestamps": [12000, 28000, 41000, 55000],
        "exploitability": "high"
      }
    ],
    "summary": "Two major exploitable habits detected"
  },
  "weaknesses": {
    "tactical": ["Poor cut-off angles", "Chases too much"],
    "technical": ["Right cross telegraphed", "Lazy jab return"],
    "physical": ["Cardio drops after 45s"]
  },
  "strengths": {
    "identified": ["Strong left hook", "Good head movement"],
    "leverage": "Use left hook as primary weapon, set up with feints"
  },
  "gameplan": {
    "priority1": "Fix rear hand discipline - 3 rounds shadowboxing holding a tennis ball under the right chin",
    "priority2": "Active reset drills - hit the heavy bag, step out at an angle, immediately snap hands to eyebrows",
    "priority3": "Shoulder conditioning - 3x3min rounds of speed bag or burnout punches with light dumbbells",
    "roundStrategy": "Start with a high, tight guard. Feint to draw out their attacks, counter off the stable base, and strictly manage distance when resetting to protect the exposed centerline."
  },
  "confidenceScore": 0.85
}

Be specific with timestamps (in milliseconds). Reference actual patterns from the pose data.
Keep it actionable. Fighter needs to implement this TODAY.`

export const maxDuration = 60

export async function POST(request: Request) {
  const jsonError = (err: unknown, status: number) =>
    NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err), hint: 'Check dev server logs.' },
      { status }
    )

  let data: StrategyAnalysisRequest
  try {
    data = await request.json()
  } catch (parseErr) {
    return jsonError(parseErr instanceof Error ? parseErr.message : 'Invalid JSON', 400)
  }

  const guard = await aiGuard(request, 'analyze')
  if (!guard.ok) return guard.response

  try {
    await maybeEnforceVideoFromAnalyzeRequest(guard.user, {
      clipDurationMs: data.durationMs,
      videoFileUri: data.videoFileUri,
      enabled: Boolean(data.videoFileUri),
    })
  } catch (err) {
    return aiErrorResponse(err)
  }

  try {

    const hasPoseTimeline = Array.isArray(data.poseTimeline) && data.poseTimeline.length > 0
    const hasNativeVideo = typeof data.videoFileUri === 'string' && data.videoFileUri.trim().length > 0
    const hasFrameFallback = Array.isArray(data.frames) && data.frames.length > 0

    if (!hasPoseTimeline && !hasNativeVideo && !hasFrameFallback) {
      return NextResponse.json(
        { error: 'Provide poseTimeline, videoFileUri, or frames for strategy analysis' },
        { status: 400 }
      )
    }
    
    const model = resolvedModels.strategy()

    // Build multimodal payload
    const parts: Array<Record<string, unknown>> = []
    if (hasNativeVideo && data.videoFileUri) {
      parts.push({ fileData: { fileUri: data.videoFileUri, mimeType: 'video/mp4' } })
    }
    parts.push({ text: STRATEGY_ANALYSIS_PROMPT })
    
    // Add keyframe images
    if (data.keyframes && data.keyframes.length > 0) {
      for (const kf of data.keyframes) {
        if (kf.jpegBase64 && kf.jpegBase64.length > 0) {
          parts.push({
            inlineData: {
              mimeType: 'image/jpeg',
              data: kf.jpegBase64
            }
          })
        }
      }
    }
    
    // Compress timeline for API (sample every nth entry if too long)
    const sourceTimeline = hasPoseTimeline ? (data.poseTimeline as PoseTimelineEntry[]) : []
    let timeline = sourceTimeline
    const maxTimelineEntries = 300 // Keep timeline manageable
    if (timeline.length > maxTimelineEntries) {
      const step = Math.ceil(timeline.length / maxTimelineEntries)
      timeline = timeline.filter((_, i) => i % step === 0)
    }
    
    // Add structured data with pattern context
    parts.push({
      text: `
STRATEGY ANALYSIS REQUEST

${data.durationMs ? `Duration: ${(data.durationMs / 1000).toFixed(1)} seconds` : ''}
Focus Target: ${data.focusTarget}
${hasPoseTimeline ? `Pose Samples: ${timeline.length} (sampled from ${sourceTimeline.length} total)` : ''}
${data.keyframes ? `Keyframes: ${data.keyframes.length}` : ''}
${data.frames ? `Frames: ${data.frames.length}` : ''}
${data.videoFileUri ? `Video: Native video analysis (full temporal context)` : ''}
${data.metadata?.ruleset ? `Ruleset: ${data.metadata.ruleset}` : ''}
${data.metadata?.roundNumber ? `Round: ${data.metadata.roundNumber}` : ''}
${data.metadata?.fightContext ? `Context: ${data.metadata.fightContext}` : ''}

${data.exchangeSummary ? `
EXCHANGE ANALYSIS:
Total Exchanges: ${data.exchangeSummary.totalExchanges ?? 0}
Average Duration: ${(data.exchangeSummary.avgDuration ?? 0).toFixed(0)}ms
Phases Detected: ${(data.exchangeSummary.phases ?? []).join(', ')}
` : ''}

${data.patterns ? `
DETECTED PATTERNS (Evidence-Backed):
${data.patterns}

These patterns were detected with confidence scores and timestamps.
Consider these when forming your strategic recommendations.
` : ''}

${data.kinematics ? `
CURRENT KINEMATICS:
${JSON.stringify(data.kinematics, null, 2)}
` : ''}

${data.keyframes ? `
KEYFRAME EVENTS:
${data.keyframes.map((kf, i) => `  ${i + 1}. T=${(kf.tMs / 1000).toFixed(2)}s - ${kf.eventKind || 'manual capture'}`).join('\n')}
` : ''}

${hasPoseTimeline && timeline.length > 0 ? `
POSE TIMELINE (compressed, ${timeline.length} samples):
${JSON.stringify(timeline.slice(0, 50), null, 2)}
${timeline.length > 50 ? `\n... (${timeline.length - 50} more samples)` : ''}

VELOCITY PEAKS (top 10):
${timeline
  .filter(t => t.velocity !== undefined)
  .sort((a, b) => (b.velocity || 0) - (a.velocity || 0))
  .slice(0, 10)
  .map(t => `  T=${(t.tMs / 1000).toFixed(2)}s: velocity=${t.velocity?.toFixed(3)}`)
  .join('\n') || 'No velocity data'}
` : ''}

Analyze this fight data for patterns, habits, weaknesses, and strategic opportunities.
${data.patterns ? 'IMPORTANT: Reference the detected patterns with their timestamps in your analysis.' : ''}
Return ONLY valid JSON matching the schema above.`
    })

    const { data: analysis } = await generateJson<StrategyAnalysisResult>({
      model,
      parts,
      temperature: 0.4,
      maxOutputTokens: 4096,
    })

    return NextResponse.json({
      success: true,
      durationMs: data.durationMs,
      analysis,
      model,
      timelineSamples: timeline.length,
      keyframesAnalyzed: data.keyframes?.length || 0,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[analyze-strategy]', msg)
    return NextResponse.json(
      {
        success: false,
        error: msg,
        hint: 'Strategy analysis failed. Check GEMINI_API_KEY and dev server logs.',
      },
      { status: 502 }
    )
  }
}
