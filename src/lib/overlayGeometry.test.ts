import { describe, expect, it } from 'vitest'
import {
  clampOverlayBoxToRect,
  clampPointToBox,
  insetOverlayBox,
  isPointInsideBox,
  mapLandmarkToBox,
  unionOverlayBoxes,
  type OverlayBox,
} from './overlayGeometry'
import type { VideoContentRect } from './videoCanvas'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

const rect: VideoContentRect = {
  left: 20,
  top: 10,
  width: 640,
  height: 360,
  canvasWidth: 680,
  canvasHeight: 420,
}

const box: OverlayBox = { x: 120, y: 60, w: 180, h: 220 }

const landmark = (x: number, y: number): NormalizedLandmark => ({
  x,
  y,
  z: 0,
  visibility: 1,
})

describe('overlayGeometry', () => {
  it('clamps normalized landmarks into the actor box with drawing padding', () => {
    const p = mapLandmarkToBox(landmark(-0.4, 1.4), rect, box, 7)

    expect(isPointInsideBox(p, box, 7)).toBe(true)
    expect(p.x).toBe(box.x + 7)
    expect(p.y).toBe(box.y + box.h - 7)
  })

  it('keeps a point unchanged when it is already inside the actor box', () => {
    const source = { x: 180, y: 120 }
    const p = clampPointToBox(source, box, 4)

    expect(p).toEqual(source)
  })

  it('clamps smoothed boxes so width and height cannot overflow the video content rect', () => {
    const escaped = { x: 610, y: 330, w: 160, h: 120 }
    const clamped = clampOverlayBoxToRect(escaped, rect)

    expect(clamped.x).toBeLessThanOrEqual(rect.left + rect.width - 2 - clamped.w)
    expect(clamped.y).toBeLessThanOrEqual(rect.top + rect.height - 2 - clamped.h)
    expect(clamped.x).toBeGreaterThanOrEqual(rect.left + 2)
    expect(clamped.y).toBeGreaterThanOrEqual(rect.top + 2)
  })

  it('unions boxes without letting the result leave the video content rect', () => {
    const a = { x: 18, y: 8, w: 120, h: 120 }
    const b = { x: 620, y: 330, w: 120, h: 120 }
    const union = unionOverlayBoxes(a, b, rect)

    expect(union.x).toBeGreaterThanOrEqual(rect.left + 2)
    expect(union.y).toBeGreaterThanOrEqual(rect.top + 2)
    expect(union.x + union.w).toBeLessThanOrEqual(rect.left + rect.width - 2)
    expect(union.y + union.h).toBeLessThanOrEqual(rect.top + rect.height - 2)
  })

  it('insets very small boxes without producing negative dimensions', () => {
    const tiny = insetOverlayBox({ x: 1, y: 2, w: 4, h: 3 }, 20)

    expect(tiny.w).toBeGreaterThan(0)
    expect(tiny.h).toBeGreaterThan(0)
  })
})
