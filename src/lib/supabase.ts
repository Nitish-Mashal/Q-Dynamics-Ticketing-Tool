import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are for the hosted Supabase project.
// In development the Vite proxy forwards /auth/v1 and /rest/v1 to the local
// dev server, so empty values fall back to the app's own origin (a valid
// absolute URL — createClient rejects relative paths like "/").
const url = import.meta.env.VITE_SUPABASE_URL || window.location.origin
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'local-anon-key'

export const supabase: SupabaseClient = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'quantumberg-auth',
  },
  global: {
    headers: anonKey ? { apikey: anonKey } : {},
  },
})

export const isHosted = Boolean(import.meta.env.VITE_SUPABASE_URL)
