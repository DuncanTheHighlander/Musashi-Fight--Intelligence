/**
 * SSRF-safe URL checks for server-side fetches of user-supplied http(s) URLs.
 * Blocks loopback, link-local, and RFC1918 hosts before handing URLs to third parties.
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
])

function parseIpv4(host: string): number[] | null {
  const parts = host.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map((p) => Number(p))
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
  return octets
}

function isPrivateOrReservedIpv4(octets: number[]): boolean {
  const [a, b] = octets
  if (a === 127) return true
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  if (a === 0) return true
  return false
}

function isBlockedHostname(host: string): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, '')
  if (!normalized) return true
  if (BLOCKED_HOSTNAMES.has(normalized)) return true
  if (normalized.endsWith('.localhost')) return true

  const v4 = parseIpv4(normalized)
  if (v4) return isPrivateOrReservedIpv4(v4)

  if (normalized === '::1' || normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true
  }

  return false
}

function extraAllowedHosts(): Set<string> {
  const raw = String(process.env.MUSASHI_SAM3_ALLOWED_HOSTS || '').trim()
  if (!raw) return new Set()
  return new Set(
    raw
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean)
  )
}

export type PublicUrlCheckOptions = {
  /** Request origin (e.g. https://app.example.com) — same-host URLs are allowed. */
  requestOrigin?: string | null
}

/**
 * Validates an http(s) URL for use with external fetchers (fal.ai SAM3, etc.).
 * Returns the parsed URL or throws with a short message safe to return to clients.
 */
export function assertPublicHttpUrl(raw: string, opts?: PublicUrlCheckOptions): URL {
  let url: URL
  try {
    url = new URL(String(raw || '').trim())
  } catch {
    throw new Error('INVALID_VIDEO_URL')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('INVALID_VIDEO_URL')
  }

  if (url.username || url.password) {
    throw new Error('INVALID_VIDEO_URL')
  }

  const host = url.hostname.toLowerCase()
  if (isBlockedHostname(host)) {
    throw new Error('VIDEO_URL_NOT_ALLOWED')
  }

  if (opts?.requestOrigin) {
    try {
      const origin = new URL(opts.requestOrigin)
      if (url.host === origin.host) return url
    } catch {
      /* ignore malformed origin */
    }
  }

  if (extraAllowedHosts().has(host)) return url

  // Default: only same-origin or explicitly allowlisted hosts (when origin known).
  if (opts?.requestOrigin) {
    throw new Error('VIDEO_URL_NOT_ALLOWED')
  }

  // No origin context (e.g. unit tests): allow any non-private host.
  return url
}
