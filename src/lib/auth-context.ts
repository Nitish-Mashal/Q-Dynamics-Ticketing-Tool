import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Profile, UserRole } from './types'

export interface AuthContextValue {
  session: Session | null
  profile: Profile | null
  loading: boolean
  /** Deactivated accounts are blocked with a clear message. */
  deactivated: boolean
  role: UserRole | null
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  sendPasswordReset: (email: string) => Promise<{ error: string | null }>
  refreshProfile: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
