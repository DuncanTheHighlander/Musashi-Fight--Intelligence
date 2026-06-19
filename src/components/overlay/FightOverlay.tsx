'use client'

import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { POSE_CONNECTIONS, jointVisibilityThreshold, displayJointVisibilityThreshold } from '@/lib/kinematics'
import { getCornerColors } from '@/lib/kinematics'
import { drawBroadcastLines } from '@/components/overlay/drawBroadcastLines'
import type { FightEvidenceLedger } from '@/lib/fightlang/ledger'
import type { OverlayAnnotation } from '@/lib/fightlang/fightlang.types'
import { getVideoContentRect, syncCanvasToElement, type VideoContentRect } from '@/lib/videoCanvas'
import {
  appendPoseHistorySample,
  actorPoseAgeMs,
  isPoseAlignedToFrame,
  resolvePoseAt,
  staleFadeAlpha,
  type PosePair,
  type TimedPosePair,
} from '@/lib/poseTimeline'
import {
  clamp,
  clampOverlayBoxToRect,
  mapLandmarkToBox,
  unionOverlayBoxes,
  type OverlayBox,
} from '@/lib/overlayGeometry'

type Corner = 'blue' | 'red'
type FighterKey = 'A' | 'B'
type ActorDrawState = {
  actor: FighterKey
  pose: NormalizedLandmark[] | null
  rawBox: OverlayBox | null
  box: OverlayBox | null
  quality: number
  drawSkeleton: boolean
  holdOnly: boolean
}

const POSE_CANVAS_LINGER_WALL_MS = 1200
// Mean per-joint distance (normalized coords) below which two "fighters" are
// actually the same body detected twice — the held duplicate must not draw.
const DUPLICATE_POSE_MEAN_DIST = 0.045

const ACTOR_COLORS = {
  A: { bg: 'rgba(59,130,246,0.85)', text: '#dbeafe', glow: 'rgba(59,130,246,0.6)', ring: 'rgba(96,165,250,0.9)' },
  B: { bg: 'rgba(239,68,68,0.85)', text: '#fee2e2', glow: 'rgba(239,68,68,0.6)', ring: 'rgba(248,113,113,0.9)' },
  neutral: { bg: 'rgba(245,158,11,0.9)', text: '#fef3c7', glow: 'rgba(245,158,11,0.65)', ring: 'rgba(251,191,36,0.9)' },
} as const

const skeletonVisibilityThreshold = jointVisibilityThreshold

function drawSkeletonMapped(
  ctx: CanvasRenderingContext2D,
  lms: NormalizedLandmark[],
  rect: VideoContentRect,
  color: { line: string; joint: string; glow: string },
  alpha = 1,
  // Box is accepted for call-site symmetry but intentionally NOT used to clamp
  // or clip the skeleton. Bones are mapped directly to the video content rect
  // (like /skeleton-test) so limbs aren't distorted or cut off by the box.
  _box?: OverlayBox | null
) {
  // Bone/joint drawing uses the DISPLAY-only threshold (higher for leaf joints)
  // so faint hand/foot landmarks don't draw as ghost limbs. Box framing,
  // identity tracking, and quality scoring keep using the permissive tracking
  // threshold (skeletonVisibilityThreshold) elsewhere.
  const isDrawableLandmark = (lm: NormalizedLandmark | undefined, idx: number) =>
    Boolean(
      lm &&
      Number.isFinite(lm.x) &&
      Number.isFinite(lm.y) &&
      (lm.visibility ?? 1) >= displayJointVisibilityThreshold(idx)
    )

  // Scale stroke weight to the fighter's on-screen size so a distant fighter
  // gets a fine line and a close-up gets a confident one — a fixed 4.5 px
  // stroke reads chunky at distance and spindly up close.
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < lms.length; i++) {
    const lm = lms[i]
    if (!isDrawableLandmark(lm, i)) continue
    const y = lm.y * rect.height
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const bodyPx = maxY > minY ? maxY - minY : rect.height * 0.4
  const stroke = Math.max(2.5, Math.min(5.5, bodyPx * 0.016))

  ctx.save()
  ctx.globalAlpha = alpha
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Pass 1: colored bone with glow.
  ctx.shadowColor = color.glow
  ctx.shadowBlur = 14
  ctx.strokeStyle = color.line
  ctx.lineWidth = stroke

  const segments: Array<[{ x: number; y: number }, { x: number; y: number }]> = []
  for (const [a, b] of POSE_CONNECTIONS) {
    const la = lms[a]
    const lb = lms[b]
    if (!isDrawableLandmark(la, a) || !isDrawableLandmark(lb, b)) continue
    const pa = mapLandmarkToBox(la, rect, null)
    const pb = mapLandmarkToBox(lb, rect, null)
    segments.push([pa, pb])
    ctx.beginPath()
    ctx.moveTo(pa.x, pa.y)
    ctx.lineTo(pb.x, pb.y)
    ctx.stroke()
  }

  // Pass 2: bright core down the middle of each bone — the neon-tube look.
  ctx.shadowBlur = 0
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = Math.max(1, stroke * 0.32)
  for (const [pa, pb] of segments) {
    ctx.beginPath()
    ctx.moveTo(pa.x, pa.y)
    ctx.lineTo(pb.x, pb.y)
    ctx.stroke()
  }

  // Joints: proportional, with a bright center.
  ctx.shadowColor = color.glow
  ctx.shadowBlur = 6
  for (let i = 0; i < lms.length; i++) {
    const lm = lms[i]
    if (!isDrawableLandmark(lm, i)) continue
    const r = (i <= 10 ? 0.65 : 1) * Math.max(2.5, stroke * 1.05)
    const p = mapLandmarkToBox(lm, rect, null)
    ctx.fillStyle = color.joint
    ctx.beginPath()
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.beginPath()
    ctx.arc(p.x, p.y, r * 0.4, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

function computeFighterBoxMapped(
  lms: NormalizedLandmark[],
  rect: VideoContentRect
): OverlayBox | null {
  const points = lms.filter((lm, idx) =>
    lm &&
    Number.isFinite(lm.x) &&
    Number.isFinite(lm.y) &&
    lm.x >= -0.08 &&
    lm.x <= 1.08 &&
    lm.y >= -0.08 &&
    lm.y <= 1.08 &&
    (lm.visibility ?? 1) >= skeletonVisibilityThreshold(idx)
  )
  // During heavy occlusion, we may only have 2-3 visible joints.
  // Lowered from 4 → 2 so bounding box renders even with minimal visibility.
  // The box helps frame the skeleton and keeps identity locked during crossing.
  if (points.length < 2) return null

  const xs = points.map((lm) => rect.left + lm.x * rect.width)
  const ys = points.map((lm) => rect.top + lm.y * rect.height)
  const minX = Math.max(rect.left, Math.min(...xs))
  const maxX = Math.min(rect.left + rect.width, Math.max(...xs))
  const minY = Math.max(rect.top, Math.min(...ys))
  const maxY = Math.min(rect.top + rect.height, Math.max(...ys))

  const rawW = maxX - minX
  const rawH = maxY - minY
  // Lowered from 0.03/0.06 → 0.015/0.025 so that occluded fighters with only
  // a few visible joints (head + one shoulder, etc.) still get a bounding box.
  // This keeps the fighter "framed" and helps maintain identity during crossing.
  if (rawW < rect.width * 0.015 || rawH < rect.height * 0.025) return null

  const padX = Math.min(rect.width * 0.065, Math.max(18, rawW * 0.34))
  const padY = Math.min(rect.height * 0.07, Math.max(22, rawH * 0.22))
  const paddedLeft = Math.max(rect.left + 2, minX - padX)
  const paddedTop = Math.max(rect.top + 2, minY - padY)
  const paddedRight = Math.min(rect.left + rect.width - 2, maxX + padX)
  const paddedBottom = Math.min(rect.top + rect.height - 2, maxY + padY)

  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  // A real person detector gives a body-sized box even when only a few joints
  // are visible. Our Tier-1 local path is pose-first, so enforce a conservative
  // body-sized minimum here. This keeps the "Jabbr-style" box visually attached
  // to the fighter instead of shrinking to a floating wrist/head fragment during
  // crossings or low-confidence footwork.
  const minBodyW = Math.min(rect.width * 0.42, Math.max(rect.width * 0.2, rawW * 1.8))
  const minBodyH = Math.min(rect.height * 0.62, Math.max(rect.height * 0.32, rawH * 1.55))
  const minLeft = centerX - minBodyW / 2
  const minTop = centerY - minBodyH * 0.42
  const minRight = centerX + minBodyW / 2
  const minBottom = minTop + minBodyH

  const x = Math.min(paddedLeft, minLeft)
  const y = Math.min(paddedTop, minTop)
  const right = Math.max(paddedRight, minRight)
  const bottom = Math.max(paddedBottom, minBottom)
  const w = right - x
  const h = bottom - y

  return clampOverlayBoxToRect({ x, y, w, h }, rect)
}

function smoothFighterBox(next: OverlayBox | null, previous: OverlayBox | null, rect: VideoContentRect): OverlayBox | null {
  const safeNext = next ? clampOverlayBoxToRect(next, rect) : null
  const safePrevious = previous ? clampOverlayBoxToRect(previous, rect) : null
  if (!safeNext) return safePrevious
  if (!safePrevious) return safeNext

  const prevCx = safePrevious.x + safePrevious.w / 2
  const prevCy = safePrevious.y + safePrevious.h / 2
  const nextCx = safeNext.x + safeNext.w / 2
  const nextCy = safeNext.y + safeNext.h / 2

  // DURING OCCLUSION: Boxes can snap/jump as skeleton fragments update.
  // Each constant is the WEIGHT of the previous box (history). 0.85 means
  // the new MediaPipe-derived box only contributes 15% per frame, so the box
  // takes ~5 frames to settle into a new position. This is the stickiness
  // that prevents the box from flipping to the wrong fighter mid-crossing.
  //
  // (Earlier code used the inverse formula with the same constants, which
  //  silently made the box LESS sticky than the prior 0.72 value. Fixed.)
  const HISTORY_WEIGHT_CENTER = 0.85
  const HISTORY_WEIGHT_SIZE = 0.60

  const cx = prevCx * HISTORY_WEIGHT_CENTER + nextCx * (1 - HISTORY_WEIGHT_CENTER)
  const cy = prevCy * HISTORY_WEIGHT_CENTER + nextCy * (1 - HISTORY_WEIGHT_CENTER)
  const w = safePrevious.w * HISTORY_WEIGHT_SIZE + safeNext.w * (1 - HISTORY_WEIGHT_SIZE)
  const h = safePrevious.h * HISTORY_WEIGHT_SIZE + safeNext.h * (1 - HISTORY_WEIGHT_SIZE)
  const smoothed = clampOverlayBoxToRect({ x: cx - w / 2, y: cy - h / 2, w, h }, rect)

  // The box may move smoothly, but it must never visually exclude the current
  // skeleton. Unioning with the current pose box keeps the analytics layer
  // "stuck" to the drawn figure even during low-confidence limbs or quick steps.
  return unionOverlayBoxes(smoothed, safeNext, rect)
}

function overlayBoxArea(box: OverlayBox | null): number {
  if (!box) return 0
  return Math.max(0, box.w) * Math.max(0, box.h)
}

function overlayBoxIntersection(a: OverlayBox | null, b: OverlayBox | null): number {
  if (!a || !b) return 0
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.w, b.x + b.w)
  const bottom = Math.min(a.y + a.h, b.y + b.h)
  return Math.max(0, right - left) * Math.max(0, bottom - top)
}

function overlayBoxOverlapMin(a: OverlayBox | null, b: OverlayBox | null): number {
  const minArea = Math.min(overlayBoxArea(a), overlayBoxArea(b))
  if (minArea <= 0) return 0
  return overlayBoxIntersection(a, b) / minArea
}

function overlayBoxCenterDistance(a: OverlayBox | null, b: OverlayBox | null): number {
  if (!a || !b) return Number.POSITIVE_INFINITY
  const ax = a.x + a.w / 2
  const ay = a.y + a.h / 2
  const bx = b.x + b.w / 2
  const by = b.y + b.h / 2
  return Math.hypot(ax - bx, ay - by)
}

function poseTrackQuality(lms: NormalizedLandmark[] | null): number {
  if (!lms) return 0
  let quality = 0
  for (let i = 0; i < lms.length; i++) {
    const lm = lms[i]
    if (!lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.y)) continue
    const visibility = lm.visibility ?? 1
    if (visibility < skeletonVisibilityThreshold(i)) continue
    const coreBonus = i === 11 || i === 12 || i === 23 || i === 24 ? 1.25 : 1
    quality += coreBonus * clamp(visibility, 0.05, 1)
  }
  return quality
}

function boxJumpPenalty(next: OverlayBox | null, previous: OverlayBox | null, rect: VideoContentRect): number {
  if (!next || !previous) return 0
  const diagonal = Math.max(1, Math.hypot(rect.width, rect.height))
  return overlayBoxCenterDistance(next, previous) / diagonal
}

/**
 * Mean per-joint distance between two poses in NORMALIZED coordinates, over
 * joints that are mutually visible. Distinguishes "MediaPipe returned the
 * same body twice" (near-zero distance) from "two fighters in a clinch"
 * (boxes overlap heavily but heads/limbs are still in different places).
 */
function poseMeanJointDistance(a: NormalizedLandmark[], b: NormalizedLandmark[]): number {
  let total = 0
  let count = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const la = a[i]
    const lb = b[i]
    if (!la || !lb) continue
    if (!Number.isFinite(la.x) || !Number.isFinite(la.y) || !Number.isFinite(lb.x) || !Number.isFinite(lb.y)) continue
    if (Math.min(la.visibility ?? 1, lb.visibility ?? 1) < 0.15) continue
    total += Math.hypot(la.x - lb.x, la.y - lb.y)
    count++
  }
  return count >= 6 ? total / count : Number.POSITIVE_INFINITY
}

function maybeHoldDuplicateTrack(
  states: { A: ActorDrawState; B: ActorDrawState },
  previousBoxes: { A: OverlayBox | null; B: OverlayBox | null },
  rect: VideoContentRect
) {
  const a = states.A
  const b = states.B
  if (!a.rawBox || !b.rawBox || !a.pose || !b.pose) return

  const rawOverlap = overlayBoxOverlapMin(a.rawBox, b.rawBox)
  const centerDistance = overlayBoxCenterDistance(a.rawBox, b.rawBox)
  const nearSameBody =
    rawOverlap > 0.72 ||
    (rawOverlap > 0.56 && centerDistance < rect.width * 0.15)
  if (!nearSameBody) return

  const scoreA = a.quality - boxJumpPenalty(a.rawBox, previousBoxes.A, rect) * 10
  const scoreB = b.quality - boxJumpPenalty(b.rawBox, previousBoxes.B, rect) * 10
  const keepActor: FighterKey = scoreA >= scoreB ? 'A' : 'B'
  const holdActor: FighterKey = keepActor === 'A' ? 'B' : 'A'
  const keep = states[keepActor]
  const hold = states[holdActor]
  const previousHoldBox = previousBoxes[holdActor]

  // Keep BOTH skeletons drawing during a real overlap/clinch — suppressing the
  // held (lower-confidence) track made an entire fighter disappear whenever
  // the two tracks overlapped. EXCEPTION: when the two poses are nearly
  // identical joint-for-joint, this isn't a clinch — MediaPipe detected the
  // SAME body twice (or the held track collapsed onto the kept one). Drawing
  // both then renders two skeletons stacked on one person, so the duplicate
  // is suppressed while the genuinely-distinct clinch case keeps both.
  const duplicateSameBody = poseMeanJointDistance(a.pose, b.pose) < DUPLICATE_POSE_MEAN_DIST
  hold.drawSkeleton = !duplicateSameBody
  hold.holdOnly = true

  if (previousHoldBox && overlayBoxOverlapMin(previousHoldBox, keep.rawBox) < 0.7) {
    hold.box = clampOverlayBoxToRect(previousHoldBox, rect)
  } else {
    hold.box = null
  }
}

function drawFighterBoxMapped(
  ctx: CanvasRenderingContext2D,
  box: OverlayBox,
  color: { line: string; glow: string },
  alpha = 1
) {
  const { x, y, w, h } = box

  // Broadcast-HUD style: solid corner brackets + a fine dashed perimeter.
  // No filled wash — the old translucent fill tinted the fighter's body and
  // read as cheap. Bracket length scales with the box so it never dominates.
  const bl = Math.max(10, Math.min(26, Math.min(w, h) * 0.18))

  ctx.save()

  // Fine dashed perimeter (subtle, sits behind the brackets)
  ctx.globalAlpha = alpha * 0.45
  ctx.strokeStyle = color.line
  ctx.lineWidth = 1.25
  ctx.setLineDash([4, 7])
  ctx.strokeRect(x, y, w, h)
  ctx.setLineDash([])

  // Solid corner brackets with glow
  ctx.globalAlpha = alpha * 0.95
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.shadowColor = color.glow
  ctx.shadowBlur = 12
  ctx.beginPath()
  // top-left
  ctx.moveTo(x, y + bl); ctx.lineTo(x, y); ctx.lineTo(x + bl, y)
  // top-right
  ctx.moveTo(x + w - bl, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + bl)
  // bottom-right
  ctx.moveTo(x + w, y + h - bl); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - bl, y + h)
  // bottom-left
  ctx.moveTo(x + bl, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - bl)
  ctx.stroke()

  ctx.restore()
}

function drawFighterIdLabel(
  ctx: CanvasRenderingContext2D,
  actorId: 'A' | 'B',
  lms: NormalizedLandmark[],
  rect: VideoContentRect,
  _cornerColors: { line: string; glow: string },
  box?: OverlayBox | null
) {
  const nose = lms[0]
  if ((!nose || (nose.visibility ?? 1) < 0.12) && !box) return

  const x = box ? box.x + box.w / 2 : rect.left + (nose?.x ?? 0.5) * rect.width
  const y = box ? Math.max(rect.top + 14, box.y - 10) : rect.top + (nose?.y ?? 0.15) * rect.height - 36

  const ac = ACTOR_COLORS[actorId]
  const label = actorId === 'A' ? 'BLUE CORNER' : 'RED CORNER'

  ctx.save()
  ctx.shadowColor = ac.glow
  ctx.shadowBlur = 16

  ctx.font = '800 13px system-ui, sans-serif'
  const tw = ctx.measureText(label).width
  const pw = tw + 18
  const ph = 24
  const px = clamp(x - pw / 2, rect.left + 4, rect.left + rect.width - pw - 4)
  const py = clamp(y - ph / 2, rect.top + 4, rect.top + rect.height - ph - 4)

  const r = 12
  ctx.fillStyle = ac.bg
  ctx.beginPath()
  ctx.moveTo(px + r, py)
  ctx.lineTo(px + pw - r, py)
  ctx.quadraticCurveTo(px + pw, py, px + pw, py + r)
  ctx.lineTo(px + pw, py + ph - r)
  ctx.quadraticCurveTo(px + pw, py + ph, px + pw - r, py + ph)
  ctx.lineTo(px + r, py + ph)
  ctx.quadraticCurveTo(px, py + ph, px, py + ph - r)
  ctx.lineTo(px, py + r)
  ctx.quadraticCurveTo(px, py, px + r, py)
  ctx.closePath()
  ctx.fill()

  ctx.strokeStyle = ac.ring
  ctx.lineWidth = 1.5
  ctx.stroke()

  ctx.shadowBlur = 0
  ctx.fillStyle = ac.text
  ctx.font = '800 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, px + pw / 2, py + ph / 2)
  ctx.restore()
}

function resolveOverlayPoint(
  annotation: OverlayAnnotation,
  pose: PosePair,
  rect: VideoContentRect
): { x: number; y: number } | null {
  const first = annotation.anchorPoints?.[0]
  if (!first) return null

  if (first.kind === 'normalized_xy') {
    return {
      x: rect.left + first.x * rect.width,
      y: rect.top + first.y * rect.height,
    }
  }

  if (first.kind === 'bbox_center') {
    const lms = first.actorId === 'A' ? pose.A : pose.B
    if (!lms || lms.length === 0) return null
    const xs = lms.map((x) => x.x)
    const ys = lms.map((x) => x.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    return {
      x: rect.left + ((minX + maxX) / 2) * rect.width,
      y: rect.top + ((minY + maxY) / 2) * rect.height,
    }
  }

  if (first.kind === 'landmark') {
    const lms = first.actorId === 'A' ? pose.A : pose.B
    const lm = lms?.[first.landmarkIndex]
    if (!lm) return null
    return {
      x: rect.left + lm.x * rect.width,
      y: rect.top + lm.y * rect.height,
    }
  }

  return null
}

function drawOverlayAnnotation(
  ctx: CanvasRenderingContext2D,
  annotation: OverlayAnnotation,
  pose: PosePair,
  rect: VideoContentRect,
  alpha = 1,
  pulse = 0
) {
  const p = resolveOverlayPoint(annotation, pose, rect)
  if (!p) return

  const ac = annotation.actorId ? ACTOR_COLORS[annotation.actorId] : ACTOR_COLORS.neutral

  ctx.save()
  ctx.globalAlpha = alpha

  const pulseMod = 1 + pulse * 0.15

  if (annotation.annotationType === 'circle') {
    ctx.strokeStyle = ac.ring
    ctx.shadowColor = ac.glow
    ctx.shadowBlur = 18 * pulseMod
    ctx.lineWidth = 3.5
    ctx.beginPath()
    ctx.arc(p.x, p.y, 30 * pulseMod, 0, Math.PI * 2)
    ctx.stroke()
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(p.x, p.y, 38 * pulseMod, 0, Math.PI * 2)
    ctx.stroke()
  } else if (annotation.annotationType === 'arrow') {
    ctx.strokeStyle = ac.ring
    ctx.fillStyle = ac.ring
    ctx.shadowColor = ac.glow
    ctx.shadowBlur = 14
    ctx.lineWidth = 4.5
    ctx.lineCap = 'round'
    const sx = p.x
    const sy = p.y - 48
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    const angle = Math.atan2(p.y - sy, p.x - sx)
    const headLen = 14
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.lineTo(p.x - headLen * Math.cos(angle - 0.5), p.y - headLen * Math.sin(angle - 0.5))
    ctx.lineTo(p.x - headLen * Math.cos(angle + 0.5), p.y - headLen * Math.sin(angle + 0.5))
    ctx.closePath()
    ctx.fill()
  } else if (annotation.annotationType === 'zone') {
    ctx.strokeStyle = ac.ring
    ctx.shadowColor = ac.glow
    ctx.shadowBlur = 20
    ctx.lineWidth = 2.5
    ctx.setLineDash([8, 5])
    ctx.beginPath()
    ctx.arc(p.x, p.y, 50 * pulseMod, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
  } else {
    ctx.fillStyle = ac.ring
    ctx.shadowColor = ac.glow
    ctx.shadowBlur = 12 * pulseMod
    ctx.beginPath()
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2)
    ctx.fill()
  }

  const label = annotation.message || annotation.annotationType
  ctx.font = '700 15px system-ui, sans-serif'
  const m = ctx.measureText(label)
  const w = m.width + 20
  const h = 30
  const lx = Math.max(rect.left + 4, Math.min(p.x - w / 2, rect.left + rect.width - w - 4))
  const ly = Math.max(rect.top + 4, p.y - 54)

  ctx.shadowBlur = 8
  ctx.shadowColor = 'rgba(0,0,0,0.6)'

  const radius = 8
  ctx.fillStyle = ac.bg
  ctx.beginPath()
  ctx.moveTo(lx + radius, ly)
  ctx.lineTo(lx + w - radius, ly)
  ctx.quadraticCurveTo(lx + w, ly, lx + w, ly + radius)
  ctx.lineTo(lx + w, ly + h - radius)
  ctx.quadraticCurveTo(lx + w, ly + h, lx + w - radius, ly + h)
  ctx.lineTo(lx + radius, ly + h)
  ctx.quadraticCurveTo(lx, ly + h, lx, ly + h - radius)
  ctx.lineTo(lx, ly + radius)
  ctx.quadraticCurveTo(lx, ly, lx + radius, ly)
  ctx.closePath()
  ctx.fill()

  ctx.strokeStyle = ac.ring
  ctx.lineWidth = 1.2
  ctx.stroke()

  ctx.shadowBlur = 0
  ctx.fillStyle = '#ffffff'
  ctx.font = '700 15px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, lx + 10, ly + h / 2)
  ctx.restore()
}

function drawAnnotationTimeline(
  ctx: CanvasRenderingContext2D,
  rect: VideoContentRect,
  annotations: OverlayAnnotation[],
  nowMs: number,
  clipDurationMs: number
) {
  if (!annotations.length || clipDurationMs <= 0) return

  const barH = 4
  const barY = rect.top + rect.height - 14
  const barX = rect.left + 8
  const barW = rect.width - 16
  if (barW < 20) return

  ctx.save()
  ctx.globalAlpha = 0.5
  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  ctx.fillRect(barX, barY, barW, barH)

  for (const ann of annotations) {
    const ac = ann.actorId ? ACTOR_COLORS[ann.actorId] : ACTOR_COLORS.neutral
    const x0 = barX + (ann.time.startMs / clipDurationMs) * barW
    const x1 = barX + (ann.time.endMs / clipDurationMs) * barW
    const segW = Math.max(3, x1 - x0)
    ctx.fillStyle = ac.ring
    ctx.globalAlpha = 0.7
    ctx.fillRect(x0, barY, segW, barH)
  }

  const playX = barX + (nowMs / clipDurationMs) * barW
  ctx.globalAlpha = 0.9
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(playX, barY + barH / 2, 4, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}

export function FightOverlay(props: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  enabled: boolean
  latestPose: PosePair
  /**
   * Synchronous mirror of `latestPose` — updated in the same tick as
   * `onPoseVideoTime` inside FightAnalyzer's seeked/RVFC handler. The RAF
   * redraw loop reads this so it never paints one frame behind React state
   * (which made seek/scrub look like fixes "did nothing").
   */
  latestPoseLiveRef?: React.RefObject<PosePair>
  /**
   * Video-clock time (ms) of the frame that produced `latestPose`.
   */
  latestPoseVideoTimeMsRef?: React.RefObject<number | null>
  skeletonVisible: { A: boolean; B: boolean }
  aiFocusPose: 'A' | 'B' | 'both'
  myCorner: Corner
  ledger?: FightEvidenceLedger | null
  overlayAnnotations?: OverlayAnnotation[] | null
  /** Parent can call the registered fn immediately after syncing pose refs. */
  registerRedraw?: (fn: () => void) => void
}) {
  const {
    videoRef,
    canvasRef,
    enabled,
    latestPose,
    latestPoseLiveRef,
    latestPoseVideoTimeMsRef,
    skeletonVisible,
    aiFocusPose,
    myCorner,
    ledger,
    overlayAnnotations,
    registerRedraw,
  } = props

  const colors = useMemo(() => getCornerColors(myCorner), [myCorner])
  const rafIdRef = useRef<number | null>(null)
  const lastPaintedPoseWallMsRef = useRef<number>(0)
  /**
   * True from the moment a seek invalidates the pose history until a fresh
   * post-seek pose sample arrives. While set, redraw must NOT fall back to
   * `latestPose` — that pose belongs to the PRE-seek frame and would flash a
   * skeleton at the wrong position over the new frame.
   */
  const awaitingFreshPoseRef = useRef(false)
  const stableBoxesRef = useRef<{ A: OverlayBox | null; B: OverlayBox | null; cw: number; ch: number }>({
    A: null,
    B: null,
    cw: 0,
    ch: 0,
  })
  const poseHistoryRef = useRef<TimedPosePair[]>([])
  /** RVFC media clock (ms) of the frame being composited — matches detection timestamps. */
  const displayMediaTimeMsRef = useRef<number | null>(null)

  const stateRef = useRef({
    enabled,
    latestPose,
    skeletonVisible,
    aiFocusPose,
    myCorner,
    ledger,
    overlayAnnotations,
    colors,
  })
  stateRef.current = {
    enabled,
    latestPose,
    skeletonVisible,
    aiFocusPose,
    myCorner,
    ledger,
    overlayAnnotations,
    colors,
  }

  const poseSyncRef = useRef({
    latestPoseLiveRef,
    latestPoseVideoTimeMsRef,
  })
  poseSyncRef.current = {
    latestPoseLiveRef,
    latestPoseVideoTimeMsRef,
  }

  useEffect(() => {
    const video = videoRef.current
    if (!enabled) {
      poseHistoryRef.current = []
      stableBoxesRef.current = { ...stableBoxesRef.current, A: null, B: null }
      return
    }
    const live = poseSyncRef.current.latestPoseLiveRef?.current
    const poseSample =
      live && (live.A || live.B) ? live : latestPose
    if (!poseSample.A && !poseSample.B) return

    const refTime = latestPoseVideoTimeMsRef?.current
    const videoTime = video && Number.isFinite(video.currentTime) ? video.currentTime * 1000 : null
    const tMs = typeof refTime === 'number' && Number.isFinite(refTime) ? refTime : videoTime
    if (typeof tMs !== 'number' || !Number.isFinite(tMs)) return

    appendPoseHistorySample(poseHistoryRef.current, tMs, poseSample, stableBoxesRef.current)
    awaitingFreshPoseRef.current = false
  }, [enabled, latestPose, latestPoseLiveRef, latestPoseVideoTimeMsRef, videoRef])

  const redraw = useMemo(() => {
    const readLivePose = (): PosePair => {
      const s = stateRef.current
      const live = poseSyncRef.current.latestPoseLiveRef?.current
      if (live && (live.A || live.B)) return live
      return s.latestPose
    }

    const clearAwaitingFreshPoseIfLive = (videoTimeMs: number | null) => {
      const live = readLivePose()
      if (!live.A && !live.B) return
      const poseTime = poseSyncRef.current.latestPoseVideoTimeMsRef?.current
      if (typeof poseTime !== 'number' || !Number.isFinite(poseTime)) {
        awaitingFreshPoseRef.current = false
        return
      }
      if (videoTimeMs == null) {
        awaitingFreshPoseRef.current = false
        return
      }
      if (Math.abs(poseTime - videoTimeMs) <= 900) {
        awaitingFreshPoseRef.current = false
      }
    }

    return () => {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas) return
      const rect = getVideoContentRect(video, canvas)
      if (!rect) return

      syncCanvasToElement(canvas, rect)
      if (stableBoxesRef.current.cw !== rect.canvasWidth || stableBoxesRef.current.ch !== rect.canvasHeight) {
        stableBoxesRef.current = { A: null, B: null, cw: rect.canvasWidth, ch: rect.canvasHeight }
      }

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const s = stateRef.current
      if (!s.enabled) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        lastPaintedPoseWallMsRef.current = 0
        return
      }

      const currentTimeMs =
        Number.isFinite(video.currentTime) && video.currentTime >= 0
          ? Math.round(video.currentTime * 1000)
          : null
      // During playback, prefer the RVFC media clock — the same clock
      // FightAnalyzer keys on via metadata.mediaTime. video.currentTime can
      // lag/jitter vs the composited frame and made resolvePoseAt extrapolate
      // from the wrong playhead, so the skeleton visibly trailed the body.
      const playing = !video.paused && !video.ended
      const currentVideoMs =
        playing && displayMediaTimeMsRef.current != null
          ? displayMediaTimeMsRef.current
          : currentTimeMs
      clearAwaitingFreshPoseIfLive(currentVideoMs)
      const livePose = readLivePose()
      const poseTimeMs = poseSyncRef.current.latestPoseVideoTimeMsRef?.current
      // Keep history in sync with the synchronous live ref so RAF frames between
      // React renders still bracket the playhead for interpolation.
      if (
        currentVideoMs != null &&
        typeof poseTimeMs === 'number' &&
        Number.isFinite(poseTimeMs) &&
        (livePose.A || livePose.B)
      ) {
        appendPoseHistorySample(
          poseHistoryRef.current,
          poseTimeMs,
          livePose,
          stableBoxesRef.current
        )
        awaitingFreshPoseRef.current = false
      }
      // Always resolve against the displayed frame clock — history samples are
      // keyed on the same RVFC / currentTime ms that onPoseVideoTime publishes.
      const queryMs = currentVideoMs
      // After a seek, stale React state may still hold the pre-seek frame. Prefer
      // the synchronous live ref; only blank the fallback when we're still
      // waiting AND the live sample is time-mismatched to the displayed frame.
      let fallbackPose: PosePair = livePose
      if (awaitingFreshPoseRef.current) {
        const poseMatchesFrame =
          currentVideoMs == null ||
          typeof poseTimeMs !== 'number' ||
          !Number.isFinite(poseTimeMs) ||
          Math.abs(poseTimeMs - currentVideoMs) <= 900
        fallbackPose = poseMatchesFrame && (livePose.A || livePose.B) ? livePose : { A: null, B: null }
      }
      // Paint the raw detection only when its media timestamp matches the
      // composited frame (≤ ~1.5 frames ahead). isPoseFreshForDisplay allows
      // up to 180 ms of lag for staleness gating, but pinning that stale pose
      // on every RVFC tick made the skeleton trail the body during playback.
      // When the playhead is ahead, interpolate history at queryMs instead.
      const poseTimeForSync =
        typeof poseTimeMs === 'number' && Number.isFinite(poseTimeMs) ? poseTimeMs : null
      const poseAlignedToFrame = isPoseAlignedToFrame(poseTimeForSync, currentVideoMs)
      // When the RVFC playhead is even slightly ahead of the detection timestamp,
      // pinning the raw live pose makes the skeleton trail the body. Force history
      // forward-interpolation until the next detection lands.
      const displayAheadOfPose =
        currentVideoMs != null &&
        poseTimeForSync != null &&
        currentVideoMs > poseTimeForSync + 8
      const liveSynced =
        !displayAheadOfPose &&
        !video.seeking &&
        !awaitingFreshPoseRef.current &&
        poseAlignedToFrame &&
        (livePose.A || livePose.B)
      // Fresh detection aligned to the composited frame: draw it directly.
      // Otherwise interpolate history at the RVFC playhead (capped at the
      // newest sample — no forward extrapolation in poseTimeline).
      const drawPose: PosePair =
        liveSynced
          ? livePose
          : queryMs == null
            ? fallbackPose
            : poseHistoryRef.current.length > 0
              ? resolvePoseAt(poseHistoryRef.current, queryMs, fallbackPose)
              : fallbackPose

      // If no pose, nothing to draw
      if (!drawPose.A && !drawPose.B) {
        const shouldKeepLastPaint =
          lastPaintedPoseWallMsRef.current > 0 &&
          !video.seeking &&
          performance.now() - lastPaintedPoseWallMsRef.current <= POSE_CANVAS_LINGER_WALL_MS

        if (!shouldKeepLastPaint) {
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          stableBoxesRef.current.A = null
          stableBoxesRef.current.B = null
          lastPaintedPoseWallMsRef.current = 0
        }
        return
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const dimA = s.aiFocusPose !== 'both' && s.aiFocusPose !== 'A'
      const dimB = s.aiFocusPose !== 'both' && s.aiFocusPose !== 'B'
      const alphaA = dimA ? 0.35 : 1
      const alphaB = dimB ? 0.35 : 1
      const drawBoxes: { A: OverlayBox | null; B: OverlayBox | null } = { A: null, B: null }
      const previousBoxes = {
        A: stableBoxesRef.current.A,
        B: stableBoxesRef.current.B,
      }
      const drawStates: { A: ActorDrawState; B: ActorDrawState } = {
        A: {
          actor: 'A',
          pose: s.skeletonVisible.A ? drawPose.A : null,
          rawBox: s.skeletonVisible.A && drawPose.A ? computeFighterBoxMapped(drawPose.A, rect) : null,
          box: null,
          quality: poseTrackQuality(s.skeletonVisible.A ? drawPose.A : null),
          drawSkeleton: Boolean(s.skeletonVisible.A && drawPose.A),
          holdOnly: false,
        },
        B: {
          actor: 'B',
          pose: s.skeletonVisible.B ? drawPose.B : null,
          rawBox: s.skeletonVisible.B && drawPose.B ? computeFighterBoxMapped(drawPose.B, rect) : null,
          box: null,
          quality: poseTrackQuality(s.skeletonVisible.B ? drawPose.B : null),
          drawSkeleton: Boolean(s.skeletonVisible.B && drawPose.B),
          holdOnly: false,
        },
      }

      maybeHoldDuplicateTrack(drawStates, previousBoxes, rect)

      for (const actor of ['A', 'B'] as const) {
        const state = drawStates[actor]
        // Fade held/stale poses out instead of freezing them at full opacity:
        // a fighter lost by detection dims over ~1 s rather than leaving a
        // solid ghost pinned to an empty patch of canvas.
        const staleFade =
          queryMs == null
            ? 1
            : staleFadeAlpha(actorPoseAgeMs(poseHistoryRef.current, actor, queryMs))
        const alpha = (actor === 'A' ? alphaA : alphaB) * staleFade
        const color = actor === 'A' ? s.colors.A : s.colors.B
        if (!state.pose) {
          stableBoxesRef.current[actor] = null
          continue
        }

        const box = state.holdOnly
          ? state.box
          : smoothFighterBox(state.rawBox, previousBoxes[actor], rect)
        stableBoxesRef.current[actor] = box
        drawBoxes[actor] = box

        if (box) drawFighterBoxMapped(ctx, box, color, state.holdOnly ? alpha * 0.55 : alpha)
        // Skeleton draws from the pose itself — the box is optional decoration.
        // Held/duplicate tracks (during overlap) draw at reduced alpha so both
        // fighters stay visible without the held one dominating.
        if (state.drawSkeleton) {
          const skeletonAlpha = state.holdOnly ? alpha * 0.5 : alpha
          drawSkeletonMapped(ctx, state.pose, rect, color, skeletonAlpha, box ?? null)
        }
        if (box) drawFighterIdLabel(ctx, actor, state.pose, rect, color, box)
      }

      const visiblePose: PosePair = {
        A: drawStates.A.drawSkeleton ? drawStates.A.pose : null,
        B: drawStates.B.drawSkeleton ? drawStates.B.pose : null,
      }

      drawBroadcastLines(ctx, visiblePose, { myCorner: s.myCorner, ledger: s.ledger, rect, actorBoxes: drawBoxes })

      const nowMs = (video.currentTime || 0) * 1000
      const lingerMs = 2000
      const fadeMs = 400
      const anns = s.overlayAnnotations
      const activeAnnotations =
        anns?.filter((a) => nowMs >= a.time.startMs - fadeMs && nowMs <= a.time.endMs + lingerMs) ?? []

      const pulseT = (Date.now() % 1600) / 1600
      const pulse = Math.sin(pulseT * Math.PI * 2) * 0.5 + 0.5

      for (const ann of activeAnnotations.slice(0, 12)) {
        let alpha = 1
        if (nowMs < ann.time.startMs) {
          alpha = Math.max(0, (nowMs - (ann.time.startMs - fadeMs)) / fadeMs)
        } else if (nowMs > ann.time.endMs) {
          alpha = Math.max(0, 1 - (nowMs - ann.time.endMs) / lingerMs)
        }
        drawOverlayAnnotation(ctx, ann, visiblePose, rect, alpha, pulse)
      }

      if (anns && anns.length > 0) {
        const dur = video.duration
        if (Number.isFinite(dur) && dur > 0) {
          drawAnnotationTimeline(ctx, rect, anns, nowMs, Math.round(dur * 1000))
        }
      }

      if (activeAnnotations.length > 0) {
        ctx.save()
        ctx.globalAlpha = 0.75
        ctx.fillStyle = 'rgba(17,24,39,0.75)'
        const badge = `${activeAnnotations.length} active`
        ctx.font = '600 11px system-ui, sans-serif'
        const bm = ctx.measureText(badge)
        const bw = bm.width + 14
        const bh = 20
        const bx = rect.left + rect.width - bw - 8
        const by = rect.top + 8
        ctx.beginPath()
        if (ctx.roundRect) {
          ctx.roundRect(bx, by, bw, bh, 10)
        } else {
          ctx.rect(bx, by, bw, bh)
        }
        ctx.fill()
        ctx.fillStyle = '#a5f3fc'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(badge, bx + bw / 2, by + bh / 2)
        ctx.restore()
      }

      lastPaintedPoseWallMsRef.current = performance.now()
    }
  }, [videoRef, canvasRef])

  useLayoutEffect(() => {
    const video = videoRef.current
    if (!video) return
    const ro = new ResizeObserver(() => redraw())
    ro.observe(video)
    const onLoaded = () => redraw()
    video.addEventListener('loadeddata', onLoaded)
    video.addEventListener('loadedmetadata', onLoaded)
    return () => {
      ro.disconnect()
      video.removeEventListener('loadeddata', onLoaded)
      video.removeEventListener('loadedmetadata', onLoaded)
    }
  }, [redraw, videoRef])

  useEffect(() => {
    redraw()
  }, [redraw, enabled, latestPose, skeletonVisible, aiFocusPose, myCorner, ledger, overlayAnnotations, colors])

  useEffect(() => {
    registerRedraw?.(redraw)
    return () => registerRedraw?.(() => {})
  }, [registerRedraw, redraw])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let running = true
    const v = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, metadata: { mediaTime: number }) => void) => number
      cancelVideoFrameCallback?: (handle: number) => void
    }
    const hasRvfc = typeof v.requestVideoFrameCallback === 'function'

    const loop = (_now?: number, metadata?: { mediaTime: number }) => {
      if (!running) return
      if (metadata && Number.isFinite(metadata.mediaTime) && metadata.mediaTime >= 0) {
        displayMediaTimeMsRef.current = Math.round(metadata.mediaTime * 1000)
      }
      redraw()
      if (hasRvfc) {
        rafIdRef.current = v.requestVideoFrameCallback!(loop) as unknown as number
      } else {
        rafIdRef.current = requestAnimationFrame(loop)
      }
    }

    const onPlay = () => {
      if (rafIdRef.current != null) return
      running = true
      loop()
    }
    const onPause = () => {
      running = false
      displayMediaTimeMsRef.current = null
      if (rafIdRef.current != null) {
        if (hasRvfc) {
          try {
            v.cancelVideoFrameCallback?.(rafIdRef.current)
          } catch {
            /* best effort */
          }
        } else {
          cancelAnimationFrame(rafIdRef.current)
        }
        rafIdRef.current = null
      }
      redraw()
    }
    const resetTemporalTracking = () => {
      poseHistoryRef.current = []
      awaitingFreshPoseRef.current = true
      displayMediaTimeMsRef.current = null
      lastPaintedPoseWallMsRef.current = 0
      stableBoxesRef.current = { ...stableBoxesRef.current, A: null, B: null }
      redraw()
    }
    const onSeeked = () => {
      // FightAnalyzer's seeked handler runs in the same event turn and updates
      // latestPoseLiveRef before React re-renders. Defer one frame so redraw
      // sees the fresh detection instead of a blank awaiting-fresh frame.
      requestAnimationFrame(() => redraw())
    }

    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onPause)
    video.addEventListener('seeking', resetTemporalTracking)
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('timeupdate', onSeeked)

    // CRITICAL: kick the loop if video is ALREADY playing when this effect mounts
    // (e.g. when `enabled` flipped from false→true while video kept playing).
    // Without this, skeletons never appear because `onPlay` fired before this listener
    // was attached. This is the #1 reason skeletons randomly fail to render.
    if (enabled && !video.paused && !video.ended && video.readyState >= 2) {
      onPlay()
    }

    return () => {
      running = false
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onPause)
      video.removeEventListener('seeking', resetTemporalTracking)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('timeupdate', onSeeked)
      if (rafIdRef.current != null) {
        if (typeof v.requestVideoFrameCallback === 'function') {
          try {
            v.cancelVideoFrameCallback?.(rafIdRef.current)
          } catch {
            /* best effort */
          }
        } else {
          cancelAnimationFrame(rafIdRef.current)
        }
        rafIdRef.current = null
      }
    }
  }, [redraw, videoRef, enabled])

  // h-full/w-full are REQUIRED: `inset-0` alone does not stretch a canvas
  // (replaced elements keep their intrinsic attribute size under absolute
  // positioning), and syncCanvasToElement sizes the bitmap FROM the CSS box —
  // without explicit sizing the canvas can lock at the 300x150 default and
  // every skeleton draws outside the bitmap (invisible overlay).
  return (
    <canvas
      ref={canvasRef}
      className={['pointer-events-none absolute inset-0 h-full w-full', enabled ? '' : 'hidden'].join(' ')}
      style={{ zIndex: 15 }}
    />
  )
}
