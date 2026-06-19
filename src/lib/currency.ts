/**
 * Currency helpers. Money is stored as integer cents everywhere in the
 * marketplace schema to avoid float drift. UI converts at the edge.
 */

export function formatCents(
  cents: number | null | undefined,
  currency = 'USD',
  locale = 'en-US',
): string {
  const n = Number(cents || 0) / 100
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(n)
  } catch {
    return `$${n.toFixed(2)}`
  }
}

export function centsFromDollars(dollars: number | string): number {
  const n = typeof dollars === 'string' ? Number(dollars) : dollars
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.round(n * 100))
}

export function dollarsFromCents(cents: number): number {
  return Math.round(cents) / 100
}
