import { describe, expect, it } from 'vitest'
import { getVideoContentRect } from './videoCanvas'

describe('getVideoContentRect', () => {
  it('centers the picture rect for object-fit contain geometry', () => {
    const video = {
      clientWidth: 800,
      clientHeight: 600,
      videoWidth: 1600,
      videoHeight: 900,
      getBoundingClientRect: () => ({
        left: 100,
        top: 50,
        width: 800,
        height: 600,
        right: 900,
        bottom: 650,
      }),
    } as unknown as HTMLVideoElement

    const rect = getVideoContentRect(video)
    expect(rect).not.toBeNull()
    expect(rect!.width).toBeCloseTo(800, 3)
    expect(rect!.height).toBeCloseTo(450, 3)
    expect(rect!.left).toBeCloseTo(0, 3)
    expect(rect!.top).toBeCloseTo(75, 3)
    expect(rect!.canvasWidth).toBe(800)
    expect(rect!.canvasHeight).toBe(600)
  })

  it('offsets the picture rect when canvas and video DOM boxes differ', () => {
    const video = {
      clientWidth: 800,
      clientHeight: 450,
      videoWidth: 1600,
      videoHeight: 900,
      getBoundingClientRect: () => ({
        left: 120,
        top: 80,
        width: 800,
        height: 450,
        right: 920,
        bottom: 530,
      }),
    } as unknown as HTMLVideoElement

    const canvas = {
      clientWidth: 820,
      clientHeight: 470,
      getBoundingClientRect: () => ({
        left: 110,
        top: 70,
        width: 820,
        height: 470,
        right: 930,
        bottom: 540,
      }),
    } as unknown as HTMLCanvasElement

    const rect = getVideoContentRect(video, canvas)
    expect(rect).not.toBeNull()
    expect(rect!.left).toBeCloseTo(120 - 110, 3)
    expect(rect!.top).toBeCloseTo(80 - 70, 3)
    expect(rect!.width).toBeCloseTo(800, 3)
    expect(rect!.height).toBeCloseTo(450, 3)
    expect(rect!.canvasWidth).toBe(820)
    expect(rect!.canvasHeight).toBe(470)
  })

  it('letterboxes into the area above native video controls', () => {
    const video = {
      clientWidth: 800,
      clientHeight: 500,
      videoWidth: 1600,
      videoHeight: 900,
      controls: true,
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 500,
        right: 800,
        bottom: 500,
      }),
    } as unknown as HTMLVideoElement

    const withControls = getVideoContentRect(video)
    const withoutControls = getVideoContentRect({ ...video, controls: false } as HTMLVideoElement)

    expect(withControls).not.toBeNull()
    expect(withoutControls).not.toBeNull()
    expect(withControls!.height).toBeCloseTo(withoutControls!.height, 3)
    expect(withControls!.top).toBeLessThan(withoutControls!.top)
  })
})
