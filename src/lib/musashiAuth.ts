import { getDb } from '@/lib/db'

export type MusashiRole = 'user' | 'shogun'

export type MusashiUser = {
  id: string
  email: string
  display_name: string | null
  role: MusashiRole
  emailVerifiedAt: string | null
  passwordUpdatedAt: string | null
  createdAt: string
  updatedAt: string
}

const getTextEncoder = () => new TextEncoder()

const base64FromBytes = (bytes: Uint8Array): string => {
  // Node (open-next) + Cloudflare nodejs_compat both support Buffer
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

const bytesFromBase64 = (b64: string): Uint8Array => {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'))
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

const timingSafeEqual = (a: string, b: string): boolean => {
  const aa = getTextEncoder().encode(a)
  const bb = getTextEncoder().encode(b)
  if (aa.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i]
  return diff === 0
}

const hmacSign = async (secret: string, payload: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    getTextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, getTextEncoder().encode(payload))
  return base64FromBytes(new Uint8Array(sig))
}

const pbkdf2Hash = async (password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> => {
  const keyMaterial = await crypto.subtle.importKey('raw', getTextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  )
  return new Uint8Array(bits)
}

export const hashPassword = async (password: string): Promise<string> => {
  const iterations = 120_000
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await pbkdf2Hash(password, salt, iterations)
  return `pbkdf2$${iterations}$${base64FromBytes(salt)}$${base64FromBytes(hash)}`
}

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const parts = String(stored || '').split('$')
  if (parts.length !== 4) return false
  const [scheme, iterStr, saltB64, hashB64] = parts
  if (scheme !== 'pbkdf2') return false
  const iterations = Number(iterStr)
  if (!Number.isFinite(iterations) || iterations < 50_000) return false
  const salt = bytesFromBase64(saltB64)
  const expected = bytesFromBase64(hashB64)
  const actual = await pbkdf2Hash(password, salt, iterations)
  if (actual.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i]
  return diff === 0
}

const SESSION_COOKIE = 'musashi_session'

const parseCookieHeader = (cookieHeader: string | null): Record<string, string> => {
  const out: Record<string, string> = {}
  const raw = String(cookieHeader || '')
  if (!raw) return out
  const parts = raw.split(';')
  for (const part of parts) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k) out[k] = decodeURIComponent(v)
  }
  return out
}

export const getSessionCookieFromRequest = (req: Request): string | null => {
  const map = parseCookieHeader(req.headers.get('cookie'))
  return map[SESSION_COOKIE] || null
}

export const buildSessionCookieHeader = (value: string, opts?: { maxAgeSeconds?: number }) => {
  const maxAge = opts?.maxAgeSeconds ?? 60 * 60 * 24 * 14
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`
}

export const buildClearSessionCookieHeader = () => {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`
}

export const createSession = async (req: Request, userId: string): Promise<{ sessionId: string; cookieValue: string }> => {
  const secret = process.env.MUSASHI_SESSION_SECRET
  if (!secret) throw new Error('MUSASHI_SESSION_SECRET not set')

  const sessionId = crypto.randomUUID()
  const now = Date.now()
  const expiresAt = new Date(now + 1000 * 60 * 60 * 24 * 14).toISOString()

  const ua = req.headers.get('user-agent') || null
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null

  const db = getDb()
  await db
    .prepare(
      'INSERT INTO musashi_sessions (id, user_id, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?)'
    )
    .bind(sessionId, userId, expiresAt, ua, ip)
    .run()

  const sig = await hmacSign(secret, sessionId)
  const cookieValue = `${sessionId}.${sig}`
  return { sessionId, cookieValue }
}

export const verifySessionCookie = async (cookieValue: string): Promise<string | null> => {
  const secret = process.env.MUSASHI_SESSION_SECRET
  if (!secret) return null

  const [sessionId, sig] = String(cookieValue || '').split('.')
  if (!sessionId || !sig) return null

  const expected = await hmacSign(secret, sessionId)
  if (!timingSafeEqual(expected, sig)) return null

  const db = getDb()
  const row = await db
    .prepare(
      `SELECT s.id, s.user_id, s.expires_at, s.revoked_at, s.created_at, u.password_updated_at
         FROM musashi_sessions s
         JOIN musashi_users u ON u.id = s.user_id
        WHERE s.id = ?`,
    )
    .bind(sessionId)
    .first()

  if (!row?.id || !row?.user_id) return null
  if (row.revoked_at) return null

  const expires = Date.parse(String(row.expires_at || ''))
  if (!Number.isFinite(expires) || expires <= Date.now()) return null

  const passwordUpdatedAt = row.password_updated_at ? Date.parse(String(row.password_updated_at)) : null
  const sessionCreatedAt = Date.parse(String(row.created_at || ''))
  if (
    passwordUpdatedAt !== null &&
    Number.isFinite(passwordUpdatedAt) &&
    Number.isFinite(sessionCreatedAt) &&
    passwordUpdatedAt > sessionCreatedAt
  ) {
    return null
  }

  return String(row.user_id)
}

/** Synthetic user returned when MUSASHI_DISABLE_AUTH=1. Lets local dev and
 *  investor demos browse the app without signing in. Role is `shogun` so admin
 *  routes (limits, prompts) work too. */
const DEV_BYPASS_USER: MusashiUser = {
  id: 'dev',
  email: 'dev@local',
  display_name: 'Dev User',
  role: 'shogun',
  emailVerifiedAt: null,
  passwordUpdatedAt: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
}

export const getCurrentUser = async (req: Request): Promise<MusashiUser | null> => {
  // Dev/demo bypass — every auth-gated route inherits this without a per-route
  // change. The NODE_ENV guard is a safety net; production deploys must NOT set
  // this flag, and it is explicitly rejected at the API level if they do.
  if (process.env.MUSASHI_DISABLE_AUTH === '1' && process.env.NODE_ENV !== 'production') return DEV_BYPASS_USER

  const cookieValue = getSessionCookieFromRequest(req)
  if (!cookieValue) return null

  const userId = await verifySessionCookie(cookieValue)
  if (!userId) return null

  const db = getDb()
  const row = await db
    .prepare(
      'SELECT id, email, display_name, role, email_verified_at, password_updated_at, created_at, updated_at FROM musashi_users WHERE id = ?',
    )
    .bind(userId)
    .first()

  if (!row?.id) return null

  return {
    id: String(row.id),
    email: String(row.email),
    display_name: row.display_name ? String(row.display_name) : null,
    role: String(row.role) as MusashiRole,
    emailVerifiedAt: row.email_verified_at ? String(row.email_verified_at) : null,
    passwordUpdatedAt: row.password_updated_at ? String(row.password_updated_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

export const requireUser = async (req: Request, opts?: { role?: MusashiRole }) => {
  const user = await getCurrentUser(req)
  if (!user) throw new Error('UNAUTHORIZED')
  if (opts?.role && user.role !== opts.role) throw new Error('FORBIDDEN')
  return user
}

export const revokeAllUserSessions = async (userId: string): Promise<void> => {
  const db = getDb()
  await db
    .prepare('UPDATE musashi_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
    .bind(new Date().toISOString(), userId)
    .run()
}

export const revokeCurrentSession = async (req: Request): Promise<void> => {
  const cookieValue = getSessionCookieFromRequest(req)
  if (!cookieValue) return

  const [sessionId] = String(cookieValue || '').split('.')
  if (!sessionId) return

  const db = getDb()
  await db
    .prepare('UPDATE musashi_sessions SET revoked_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), sessionId)
    .run()
}

/**
 * Mirror a musashi_users account into the legacy `users` table.
 *
 * Auth lives in musashi_users, but the social/marketplace tables
 * (fighter_profiles, marketplace_jobs, content_products, messages pre-0008, ...)
 * declare FOREIGN KEYs against `users`. Without this row, real signups would
 * orphan their social data. Best-effort: a sync failure must never block auth.
 * (Migration 0017 backfills accounts created before this code shipped.)
 */
const syncLegacyUserRow = async (user: { id: string; email: string; display_name?: string | null }): Promise<void> => {
  try {
    const db = getDb()
    try {
      // Legacy 0001 schema: role CHECK ('admin','manager','cleaner','client'),
      // NOT NULL password_hash/first_name/last_name.
      await db
        .prepare(
          `INSERT OR IGNORE INTO users (id, role, email, password_hash, first_name, last_name, created_at, updated_at)
           VALUES (?, 'client', ?, '', ?, '', ?, ?)`
        )
        .bind(user.id, user.email, user.display_name || '', new Date().toISOString(), new Date().toISOString())
        .run()
    } catch {
      // Simplified schema variant (src/lib/database.sql): id/email/role only.
      await db
        .prepare(
          `INSERT OR IGNORE INTO users (id, email, role, created_at, updated_at)
           VALUES (?, ?, 'user', ?, ?)`
        )
        .bind(user.id, user.email, new Date().toISOString(), new Date().toISOString())
        .run()
    }
  } catch {
    // No users table at all (or DB unavailable) — never block auth on this.
  }
}

export const createUser = async (params: { email: string; password: string; role: MusashiRole; display_name?: string }) => {
  const email = String(params.email || '').trim().toLowerCase()
  if (!email || !email.includes('@') || email.length > 254) throw new Error('Invalid email')
  if (!params.password || params.password.length < 10) throw new Error('Password must be at least 10 characters')
  if (!/[A-Z]/.test(params.password)) throw new Error('Password must contain an uppercase letter')
  if (!/[a-z]/.test(params.password)) throw new Error('Password must contain a lowercase letter')
  if (!/[0-9]/.test(params.password)) throw new Error('Password must contain a number')

  const displayName = params.display_name ? String(params.display_name).trim().slice(0, 100) : null

  const db = getDb()
  const existing = await db.prepare('SELECT id FROM musashi_users WHERE email = ?').bind(email).first()
  if (existing?.id) throw new Error('Email already in use')

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const passwordHash = await hashPassword(params.password)

  await db
    .prepare(
      'INSERT INTO musashi_users (id, email, password_hash, role, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(id, email, passwordHash, params.role, displayName, now, now)
    .run()

  const user: MusashiUser = {
    id,
    email,
    display_name: displayName,
    role: params.role,
    emailVerifiedAt: null,
    passwordUpdatedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  await syncLegacyUserRow(user)
  return user
}

export const ensureShogunUserExists = async (): Promise<MusashiUser> => {
  const configuredEmail = String(process.env.MUSASHI_SHOGUN_EMAIL || '').trim().toLowerCase()
  const email = configuredEmail.includes('@') ? configuredEmail : 'shogun@musashi.local'
  const passwordHashEnv = String(process.env.MUSASHI_SHOGUN_PASSWORD_HASH || '').trim()
  const passwordEnv = String(process.env.MUSASHI_SHOGUN_PASSWORD || '')

  if (!passwordHashEnv && !passwordEnv) {
    throw new Error('Shogun password not configured')
  }

  const db = getDb()
  const existing = await db
    .prepare(
      'SELECT id, email, display_name, role, email_verified_at, password_updated_at, created_at, updated_at FROM musashi_users WHERE email = ?',
    )
    .bind(email)
    .first()

  if (existing?.id) {
    return {
      id: String(existing.id),
      email: String(existing.email),
      display_name: existing.display_name ? String(existing.display_name) : null,
      role: String(existing.role) as MusashiRole,
      emailVerifiedAt: existing.email_verified_at ? String(existing.email_verified_at) : null,
      passwordUpdatedAt: existing.password_updated_at ? String(existing.password_updated_at) : null,
      createdAt: String(existing.created_at),
      updatedAt: String(existing.updated_at),
    }
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const passwordHash = passwordHashEnv ? passwordHashEnv : await hashPassword(passwordEnv)

  await db
    .prepare(
      'INSERT INTO musashi_users (id, email, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .bind(id, email, passwordHash, 'shogun', now, now)
    .run()

  await syncLegacyUserRow({ id, email, display_name: null })
  return {
    id,
    email,
    display_name: null,
    role: 'shogun',
    emailVerifiedAt: null,
    passwordUpdatedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

export const verifyLogin = async (params: { email: string; password: string }): Promise<MusashiUser> => {
  const email = String(params.email || '').trim().toLowerCase()
  const db = getDb()
  const row = await db
    .prepare(
      'SELECT id, email, display_name, role, password_hash, email_verified_at, password_updated_at, created_at, updated_at FROM musashi_users WHERE email = ?',
    )
    .bind(email)
    .first()

  if (!row?.id) throw new Error('Invalid credentials')

  const ok = await verifyPassword(String(params.password || ''), String(row.password_hash || ''))
  if (!ok) throw new Error('Invalid credentials')

  const user: MusashiUser = {
    id: String(row.id),
    email: String(row.email),
    display_name: row.display_name ? String(row.display_name) : null,
    role: String(row.role) as MusashiRole,
    emailVerifiedAt: row.email_verified_at ? String(row.email_verified_at) : null,
    passwordUpdatedAt: row.password_updated_at ? String(row.password_updated_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
  // Self-heals accounts created before the users-table sync shipped.
  await syncLegacyUserRow(user)
  return user
}

const assertPasswordPolicy = (password: string): void => {
  if (!password || password.length < 10) throw new Error('Password must be at least 10 characters')
  if (!/[A-Z]/.test(password)) throw new Error('Password must contain an uppercase letter')
  if (!/[a-z]/.test(password)) throw new Error('Password must contain a lowercase letter')
  if (!/[0-9]/.test(password)) throw new Error('Password must contain a number')
}

export const updateUserPassword = async (userId: string, password: string): Promise<void> => {
  assertPasswordPolicy(password)
  const passwordHash = await hashPassword(password)
  const now = new Date().toISOString()
  const db = getDb()
  await db
    .prepare('UPDATE musashi_users SET password_hash = ?, password_updated_at = ?, updated_at = ? WHERE id = ?')
    .bind(passwordHash, now, now, userId)
    .run()
}
