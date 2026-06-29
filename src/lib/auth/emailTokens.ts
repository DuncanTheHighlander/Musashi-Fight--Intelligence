import type { D1Database } from '@/lib/db'

export type EmailTokenPurpose = 'verify_email' | 'password_reset'

export type CreatedEmailToken = {
  id: string
  token: string
  userId: string
  email: string
  purpose: EmailTokenPurpose
  expiresAt: string
}

export type ConsumedEmailToken = {
  id: string
  userId: string
  email: string
  purpose: EmailTokenPurpose
}

const getTextEncoder = () => new TextEncoder()

const base64FromBytes = (bytes: Uint8Array): string => {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

const base64UrlFromBytes = (bytes: Uint8Array): string =>
  base64FromBytes(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const hashToken = async (token: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', getTextEncoder().encode(token))
  return base64FromBytes(new Uint8Array(digest))
}

export async function createEmailToken(
  db: D1Database,
  args: { userId: string; email: string; purpose: EmailTokenPurpose; ttlMs: number },
): Promise<CreatedEmailToken> {
  const id = crypto.randomUUID()
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32))
  const token = base64UrlFromBytes(tokenBytes)
  const tokenHash = await hashToken(token)
  const now = Date.now()
  const createdAt = new Date(now).toISOString()
  const expiresAt = new Date(now + args.ttlMs).toISOString()

  await db
    .prepare(
      `INSERT INTO auth_email_tokens (id, user_id, email, purpose, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, args.userId, args.email, args.purpose, tokenHash, expiresAt, createdAt)
    .run()

  return {
    id,
    token,
    userId: args.userId,
    email: args.email,
    purpose: args.purpose,
    expiresAt,
  }
}

export async function consumeEmailToken(
  db: D1Database,
  token: string,
  expectedPurpose: EmailTokenPurpose,
): Promise<ConsumedEmailToken> {
  const raw = String(token || '').trim()
  if (!raw) throw new Error('TOKEN_INVALID')

  const tokenHash = await hashToken(raw)
  const row = await db
    .prepare(
      `SELECT id, user_id, email, purpose, expires_at, used_at
         FROM auth_email_tokens
        WHERE token_hash = ?`,
    )
    .bind(tokenHash)
    .first<{
      id: string
      user_id: string
      email: string
      purpose: EmailTokenPurpose
      expires_at: string
      used_at: string | null
    }>()

  if (!row?.id || row.used_at) throw new Error('TOKEN_INVALID')
  if (row.purpose !== expectedPurpose) throw new Error('TOKEN_INVALID')

  const expires = Date.parse(String(row.expires_at || ''))
  if (!Number.isFinite(expires) || expires <= Date.now()) throw new Error('TOKEN_EXPIRED')

  const usedAt = new Date().toISOString()
  await db.prepare('UPDATE auth_email_tokens SET used_at = ? WHERE id = ?').bind(usedAt, row.id).run()

  return {
    id: String(row.id),
    userId: String(row.user_id),
    email: String(row.email),
    purpose: row.purpose,
  }
}
