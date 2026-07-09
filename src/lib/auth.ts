import { parseApiResponse } from '@/lib/safeJson'

export interface User {
  id: string
  email: string
  display_name: string
  role?: string
  emailVerifiedAt?: string | null
}

interface AuthResponse {
  user?: {
    id: string
    email: string
    display_name?: string
    role?: string
    emailVerifiedAt?: string | null
  }
  error?: string
  code?: string
}

export async function checkSession(): Promise<User | null> {
  try {
    const res = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'include',
    })

    if (!res.ok) return null

    const data = await res.json() as AuthResponse
    if (!data?.user) return null

    return {
      id: data.user.id,
      email: data.user.email,
      display_name: data.user.display_name || data.user.email.split('@')[0],
      role: data.user.role,
      emailVerifiedAt: data.user.emailVerifiedAt ?? null,
    }
  } catch (err) {
    console.error('Session check failed:', err)
    return null
  }
}

export async function login(email: string, password: string): Promise<User> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  })

  const data = await parseApiResponse(res) as AuthResponse
  
  if (!res.ok) {
    throw new Error(data?.error || 'Login failed')
  }

  if (!data?.user) {
    throw new Error('No user data returned')
  }

  return {
    id: data.user.id,
    email: data.user.email,
    display_name: data.user.display_name || data.user.email.split('@')[0],
    role: data.user.role,
    emailVerifiedAt: data.user.emailVerifiedAt ?? null,
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    })
  } catch (err) {
    console.error('Logout failed:', err)
  }
}

export async function register(params: {
  email: string
  password: string
  display_name?: string
}): Promise<User> {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(params),
  })

  const data = await parseApiResponse(res) as AuthResponse
  
  if (!res.ok) {
    throw new Error(data?.error || 'Registration failed')
  }

  if (!data?.user) {
    throw new Error('No user data returned')
  }

  return {
    id: data.user.id,
    email: data.user.email,
    display_name: data.user.display_name || data.user.email.split('@')[0],
    role: data.user.role,
    emailVerifiedAt: data.user.emailVerifiedAt ?? null,
  }
}

/** Resend verification email for the current session. */
export async function sendVerificationEmail(): Promise<{ ok: boolean; alreadyVerified?: boolean; dryRun?: boolean }> {
  const res = await fetch('/api/auth/email/verify/send', {
    method: 'POST',
    credentials: 'include',
  })
  const data = (await parseApiResponse(res)) as {
    ok?: boolean
    alreadyVerified?: boolean
    dryRun?: boolean
    error?: string
  }
  if (!res.ok) throw new Error(data?.error || 'Could not send verification email')
  return {
    ok: Boolean(data?.ok),
    alreadyVerified: data?.alreadyVerified,
    dryRun: data?.dryRun,
  }
}
