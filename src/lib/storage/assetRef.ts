/**
 * Asset reference helpers — marketplace jobs store uploads as asset:<id> strings
 * alongside legacy pasted URLs.
 */
export const ASSET_REF_PREFIX = 'asset:'

export function toAssetRef(assetId: string): string {
  return `${ASSET_REF_PREFIX}${assetId}`
}

export function parseAssetRef(value: string): string | null {
  const v = String(value || '').trim()
  return v.startsWith(ASSET_REF_PREFIX) ? v.slice(ASSET_REF_PREFIX.length) : null
}

/** Client-safe href for an asset ref or passthrough URL. */
export function resolveAssetHref(value: string): string {
  const id = parseAssetRef(value)
  return id ? `/api/uploads/${id}/content` : value
}

export function displayAssetLabel(value: string): string {
  const id = parseAssetRef(value)
  return id ? `Uploaded file (${id.slice(0, 8)}…)` : value
}
