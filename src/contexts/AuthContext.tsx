'use client'

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { checkSession, login as authLogin, logout as authLogout, type User } from '@/lib/auth'

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  checkSession: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const checkSessionHandler = useCallback(async () => {
    try {
      const sessionUser = await checkSession()
      setUser(sessionUser)
    } catch (err) {
      console.error('Session check failed:', err)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    checkSessionHandler()
  }, [checkSessionHandler])

  const login = useCallback(async (email: string, password: string) => {
    const loggedInUser = await authLogin(email, password)
    setUser(loggedInUser)
  }, [])

  const logout = useCallback(async () => {
    await authLogout()
    setUser(null)
  }, [])

  const value: AuthContextType = {
    user,
    loading,
    login,
    logout,
    checkSession: checkSessionHandler,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
