import { describe, it, expect } from 'vitest'
import {
  compactPoseFrames,
  extractPoseWindow,
  toTrainingExportRecord,
  type CompactPoseFrame,
} from './trainingDatasetStore'
import type { PoseFrame } from './fightlang/fightlang.types'

describe('trainingDatasetStore', () => {
  it('compacts pose frames for storage', () => {
    const frames: PoseFrame[] = [
      { tMs: 1000, videoTimeSec: 1, actors: { A: [{ x: 0.3, y: 0.5, visibility: 0.9 }] } },
      { tMs: 1033, videoTimeSec: 1.033, actors: { B: [{ x: 0.7, y: 0.5, visibility: 0.9 }] } },
    ]
    const compact = compactPoseFrames(frames)
    expect(compact).toHaveLength(2)
    expect(compact[0]?.tMs).toBe(1000)
    expect(compact[0]?.A?.[0]?.[0]).toBeCloseTo(0.3)
  })

  it('extracts ±500ms pose window around event center', () => {
    const frames: CompactPoseFrame[] = [
      { tMs: 900, A: [[0.3, 0.5]] },
      { tMs: 1200, A: [[0.31, 0.5]] },
      { tMs: 2000, A: [[0.4, 0.5]] },
    ]
    const window = extractPoseWindow(frames, 1000)
    expect(window.map((f) => f.tMs)).toEqual([900, 1200])
  })

  it('formats export record for ML pipelines', () => {
    const record = toTrainingExportRecord({
      id: 'tds_1',
      clipId: 'clip-abc',
      ledgerId: 'ledg_1',
      correctionId: 'corr_1',
      sport: 'boxing',
      raw2dKeypoints: [{ tMs: 1000, A: [[0.3, 0.5]] }],
      originalLabel: 'jab',
      correctedLabel: 'cross',
      confidence: 1,
      createdAt: '2026-07-08T00:00:00.000Z',
    })
    expect(record).toEqual({
      clipId: 'clip-abc',
      sport: 'boxing',
      raw_2d_keypoints: [{ tMs: 1000, A: [[0.3, 0.5]] }],
      corrected_label: 'cross',
      confidence: 1,
      original_label: 'jab',
      ledgerId: 'ledg_1',
      correctionId: 'corr_1',
      createdAt: '2026-07-08T00:00:00.000Z',
    })
  })
})
