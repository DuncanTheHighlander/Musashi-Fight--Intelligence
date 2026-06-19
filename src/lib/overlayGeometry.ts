import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { VideoContentRect } from '@/lib/videoCanvas'

export type OverlayBox = { x: number; y: number; w: number; h: number }
export type OverlayPoint = { x: number; y: number }
export type NormalizedOverlayPoint = { x: number; y: number }

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  if (max < min) return (min + max) / 2
  return Math.max(min, Math.min(max, value))
}

export function rectToOverlayBox(rect: VideoContentRect): OverlayBox {
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
}

export function insetOverlayBox(box: OverlayBox, padding: number): OverlayBox {
  const safePadding = Math.max(0, padding)
  const maxPadX = Math.max(0, (box.w - 1) / 2)
  const maxPadY = Math.max(0, (box.h - 1) / 2)
  const px = Math.min(safePadding, maxPadX)
  const py = Math.min(safePadding, maxPadY)
  return {
    x: box.x + px,
    y: box.y + py,
    w: Math.max(1, box.w - px * 2),
    h: Math.max(1, box.h - py * 2),
  }
}

export function clampOverlayBoxToRect(box: OverlayBox, rect: VideoContentRect, inset = 2): OverlayBox {
  const minX = rect.left + inset
  const minY = rect.top + inset
  const maxX = rect.left + rect.width - inset
  const maxY = rect.top + rect.height - inset
  const maxW = Math.max(1, maxX - minX)
  const maxH = Math.max(1, maxY - minY)
  const w = Math.max(1, Math.min(box.w, maxW))
  const h = Math.max(1, Math.min(box.h, maxH))

  return {
    x: clamp(box.x, minX, maxX - w),
    y: clamp(box.y, minY, maxY - h),
    w,
    h,
  }
}

export function unionOverlayBoxes(
  a: OverlayBox,
  b: OverlayBox,
  rect: VideoContentRect,
  inset = 2
): OverlayBox {
  const left = Math.min(a.x, b.x)
  const top = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.w, b.x + b.w)
  const bottom = Math.max(a.y + a.h, b.y + b.h)
  return clampOverlayBoxToRect({ x: left, y: top, w: right - left, h: bottom - top }, rect, inset)
}

export function mapNormalizedPointToRect(point: NormalizedOverlayPoint, rect: VideoContentRect): OverlayPoint {
  return {
    x: rect.left + point.x * rect.width,
    y: rect.top + point.y * rect.height,
  }
}

export function clampPointToBox(point: OverlayPoint, box: OverlayBox, padding = 0): OverlayPoint {
  const inner = insetOverlayBox(box, padding)
  return {
    x: clamp(point.x, inner.x, inner.x + inner.w),
    y: clamp(point.y, inner.y, inner.y + inner.h),
  }
}

export function mapNormalizedPointToBox(
  point: NormalizedOverlayPoint,
  rect: VideoContentRect,
  box?: OverlayBox | null,
  padding = 0
): OverlayPoint {
  const mapped = mapNormalizedPointToRect(point, rect)
  return box ? clampPointToBox(mapped, box, padding) : mapped
}

export function mapLandmarkToBox(
  landmark: NormalizedLandmark,
  rect: VideoContentRect,
  box?: OverlayBox | null,
  padding = 0
): OverlayPoint {
  return mapNormalizedPointToBox(landmark, rect, box, padding)
}

export function isPointInsideBox(point: OverlayPoint, box: OverlayBox, padding = 0): boolean {
  const inner = insetOverlayBox(box, padding)
  return point.x >= inner.x && point.x <= inner.x + inner.w && point.y >= inner.y && point.y <= inner.y + inner.h
}
