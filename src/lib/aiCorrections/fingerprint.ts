/**
 * Server-side video fingerprint for exact-clip correction memory.
 * Never computed in the browser. Lazily at first correction-save.
 *
 * Formula: sha256(size | durationMs | first1MB | last1MB) hex.
 * Falls back to sha256(size | durationMs | asset.sha256) when range reads fail.
 */
import type { D1Database } from '@/lib/db'
import { getReadableAsset } from '@/lib/storage/assets'

const MB = 1024 * 1024

async function sha256HexBytes(parts: Array<BufferSource | string>): Promise<string> {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  let total = 0
  for (const p of parts) {
    const u8 = typeof p === 'string' ? enc.encode(p) : new Uint8Array(p as ArrayBuffer)
    chunks.push(u8)
    total += u8.byteLength
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.byteLength
  }
  const digest = await crypto.subtle.digest('SHA-256', merged)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function fetchRange(url: string, start: number, end: number): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, {
      headers: { Range: `bytes=${start}-${end}` },
    })
    if (!res.ok && res.status !== 206) return null
    return await res.arrayBuffer()
  } catch {
    return null
  }
}

export async function computeVideoFingerprint(args: {
  db: D1Database
  assetId: string
  userId: string
  isAdmin?: boolean
  durationMs?: number | null
}): Promise<string | null> {
  const assetId = String(args.assetId || '').trim()
  if (!assetId) return null

  try {
    const { asset, readUrl } = await getReadableAsset(args.db, {
      assetId,
      userId: args.userId,
      isAdmin: Boolean(args.isAdmin),
    })
    const size = Math.trunc(Number(asset.size_bytes) || 0)
    const durationMs = Math.trunc(Number(args.durationMs) || 0)
    const parts: Array<BufferSource | string> = [`size:${size}|dur:${durationMs}|`]

    if (size > 0) {
      const firstEnd = Math.min(size, MB) - 1
      const lastStart = Math.max(0, size - MB)
      const first = await fetchRange(readUrl, 0, firstEnd)
      const last = lastStart > firstEnd ? await fetchRange(readUrl, lastStart, size - 1) : null
      if (first) parts.push(first)
      if (last) parts.push(last)
      if (!first && !last && asset.sha256) {
        parts.push(`sha:${asset.sha256}`)
      }
    } else if (asset.sha256) {
      parts.push(`sha:${asset.sha256}`)
    }

    return await sha256HexBytes(parts)
  } catch (err) {
    console.warn(
      '[aiCorrections] fingerprint failed (non-fatal):',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}
