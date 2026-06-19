import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { getCornerColors } from '@/lib/kinematics'
import { computeTorsoAngle, computeTorsoLine, computeStanceWidth, computeStanceWidthLine } from '@/lib/geometry/fightMetrics'
import type { FightEvidenceLedger } from '@/lib/fightlang/ledger'
import {
  clamp,
  insetOverlayBox,
  mapNormalizedPointToBox,
  rectToOverlayBox,
  type OverlayBox,
} from '@/lib/overlayGeometry'

type PosePair = { A: NormalizedLandmark[] | null; B: NormalizedLandmark[] | null }

export function drawBroadcastLines(
  ctx: CanvasRenderingContext2D,
  poses: PosePair,
  options?: {
    ledger?: FightEvidenceLedger | null
    myCorner?: 'blue' | 'red'
    rect?: { left: number; top: number; width: number; height: number }
    actorBoxes?: Partial<Record<'A' | 'B', OverlayBox | null>>
  }
): void {
  const colors = getCornerColors(options?.myCorner || 'blue')
  const rect = options?.rect
    ? { ...options.rect, canvasWidth: ctx.canvas.width, canvasHeight: ctx.canvas.height }
    : {
        left: 0,
        top: 0,
        width: ctx.canvas.width,
        height: ctx.canvas.height,
        canvasWidth: ctx.canvas.width,
        canvasHeight: ctx.canvas.height,
      }

  const drawFor = (id: 'A' | 'B', lms: NormalizedLandmark[] | null) => {
    if (!lms) return
    const color = id === 'A' ? colors.A : colors.B
    const actorBox = options?.actorBoxes?.[id] ?? null
    const mapPoint = (point: { x: number; y: number }, padding = 0) =>
      mapNormalizedPointToBox(point, rect, actorBox, padding)

    const torso = computeTorsoLine(lms)
    const stance = computeStanceWidthLine(lms)

    ctx.save()
    if (actorBox) {
      const clipBox = insetOverlayBox(actorBox, 1)
      ctx.beginPath()
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(clipBox.x, clipBox.y, clipBox.w, clipBox.h, 8)
      } else {
        ctx.rect(clipBox.x, clipBox.y, clipBox.w, clipBox.h)
      }
      ctx.clip()
    }

    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.shadowColor = color.glow
    ctx.shadowBlur = 14

    if (torso) {
      const a = mapPoint(torso.a, 4)
      const b = mapPoint(torso.b, 4)
      ctx.strokeStyle = '#e5e7eb'
      ctx.lineWidth = 5
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()

      ctx.shadowBlur = 22
      ctx.strokeStyle = color.line
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }

    if (stance) {
      const a = mapPoint(stance.a, 4)
      const b = mapPoint(stance.b, 4)
      ctx.shadowBlur = 18
      ctx.strokeStyle = '#f0abfc'
      ctx.lineWidth = 5
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()

      ctx.shadowBlur = 26
      ctx.strokeStyle = color.line
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }

    const torsoAngleDeg = computeTorsoAngle(lms)
    const stanceWidthSw = computeStanceWidth(lms)
    if (torsoAngleDeg != null || stanceWidthSw != null) {
      const anchor = torso?.b || stance?.a
      if (anchor) {
        const p = mapPoint(anchor, 6)
        const parts: string[] = []
        if (torsoAngleDeg != null) parts.push(`Torso ${Math.round(torsoAngleDeg)} deg`)
        if (stanceWidthSw != null) parts.push(`Stance ${stanceWidthSw.toFixed(2)}sw`)
        const label = parts.join('  ')

        ctx.shadowBlur = 18
        ctx.font = '600 12px system-ui, sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        const padX = 8
        const padY = 6
        const w = ctx.measureText(label).width + padX * 2
        const h = 20
        const bounds = insetOverlayBox(actorBox ?? rectToOverlayBox(rect), 4)
        const labelX = clamp(p.x + 10, bounds.x, bounds.x + bounds.w - w)
        const labelY = clamp(p.y + 8, bounds.y, bounds.y + bounds.h - h)

        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.fillRect(labelX, labelY, w, h)
        ctx.fillStyle = '#ffffff'
        ctx.fillText(label, labelX + padX, labelY + padY)
      }
    }

    ctx.restore()
  }

  drawFor('A', poses.A)
  drawFor('B', poses.B)
}
