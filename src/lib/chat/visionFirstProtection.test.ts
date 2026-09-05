import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GEMINI_FPS_DEFAULT, GEMINI_FPS_MAX, geminiConfiguredVideoFps } from '@/lib/gemini/videoFilePart'

const root = resolve(__dirname, '../../..')

describe('vision-first protection — follow-up chat fix must not regress core pipeline', () => {
  it('keeps Gemini FPS default at 24', () => {
    expect(GEMINI_FPS_DEFAULT).toBe(24)
    expect(GEMINI_FPS_MAX).toBe(24)
    expect(geminiConfiguredVideoFps()).toBe(24)
  })

  it('keeps gemini-3.6-flash as the configured model id in source', () => {
    const modelSource = readFileSync(resolve(root, 'src/lib/gemini/models.ts'), 'utf8')
    expect(modelSource).toMatch(/GEMINI_MODEL_DEFAULT\s*=\s*['"]gemini-3\.6-flash['"]/)
  })

  it('does not alter visionEvidence.ts in this change set (file still exports VisionEvidence)', () => {
    const src = readFileSync(resolve(root, 'src/lib/evidence/visionEvidence.ts'), 'utf8')
    expect(src).toMatch(/export (type|interface) VisionEvidence/)
    expect(src).toMatch(/SEEN|seen/i)
  })

  it('does not alter /api/fight/analyze route surface', () => {
    const src = readFileSync(resolve(root, 'src/app/api/fight/analyze/route.ts'), 'utf8')
    expect(src.length).toBeGreaterThan(100)
    // Analyze remains the initial full-video path; chat is a separate action.
    expect(src).not.toMatch(/action:\s*['"]chat['"]/)
  })
})
