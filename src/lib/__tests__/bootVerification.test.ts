import { describe, expect, it } from 'vitest'
import { verifyBootReadiness } from '@/lib/bootVerification'

describe('verifyBootReadiness', () => {
  it('passes when buffer is ready and pre-scan completes', () => {
    const r = verifyBootReadiness({
      media: 'buffered',
      lastPassTotalSteps: 10,
      lastPassFramesCompleted: 10,
    })
    expect(r.ok).toBe(true)
    expect(r.summary).toContain('Buffer OK')
    expect(r.warnings).toHaveLength(0)
  })

  it('fails when last pass frames mismatch', () => {
    const r = verifyBootReadiness({
      media: 'buffered',
      lastPassTotalSteps: 10,
      lastPassFramesCompleted: 3,
    })
    expect(r.ok).toBe(false)
  })

  it('warns when buffer wait timed out', () => {
    const r = verifyBootReadiness({
      media: 'timeout',
      lastPassTotalSteps: 0,
      lastPassFramesCompleted: 0,
    })
    expect(r.warnings.some((w) => w.toLowerCase().includes('timeout'))).toBe(true)
  })
})
