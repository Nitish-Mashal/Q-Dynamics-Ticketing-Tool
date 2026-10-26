import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from './supabase'
import { AuthContext, type AuthContextValue } from './auth-context'
import type { Profile } from './types'

const REDIRECT_LOCATION = `${window.location.origin}/`

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthContextValue['session']>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setProfile(null)
      return
    }
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    setProfile((data as Profile | null) ?? null)
  }, [])

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return
      setSession(data.session ?? null)
      await loadProfile(data.session?.user?.id)
      if (!cancelled) setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession ?? null)
      await loadProfile(newSession?.user?.id)
      setLoading(false)
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    if (error) {
      const msg = error.message || 'Sign-in failed'
      if (msg.toLowerCase().includes('deactivated') || msg.toLowerCase().includes('user_banned')) {
        return {
          error:
            'Your account has been deactivated. Contact the business owner if you need access restored.',
        }
      }
      if (msg.toLowerCase().includes('invalid login')) {
        return { error: 'Invalid email or password.' }
      }
      return { error: msg }
    }
    setSession(data.session)
    await loadProfile(data.user?.id)
    return { error: null }
  }, [loadProfile])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
  }, [])

  const sendPasswordReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${REDIRECT_LOCATION}reset-password`,
    })
    if (error) return { error: error.message }
    return { error: null }
  }, [])

  const refreshProfile = useCallback(async () => {
    await loadProfile(session?.user?.id)
  }, [loadProfile, session?.user?.id])

  const deactivated = Boolean(profile && !profile.is_active)
  const role = profile?.is_active ? profile.role : null

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      loading,
      deactivated,
      role,
      signIn,
      signOut,
      sendPasswordReset,
      refreshProfile,
    }),
    [session, profile, loading, deactivated, role, signIn, signOut, sendPasswordReset, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
