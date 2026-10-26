import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development the app talks to the local Supabase-compatible dev server
// (server/index.ts, PGlite). In production set VITE_SUPABASE_URL to your
// Supabase project URL. The anon key is safe to expose; the service-role key
// must never be referenced from frontend code.
const localBackend = process.env.VITE_LOCAL_BACKEND_URL ?? 'http://localhost:54321'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/auth/v1': { target: localBackend, changeOrigin: true },
      '/rest/v1': { target: localBackend, changeOrigin: true },
      '/rpc': { target: localBackend, changeOrigin: true },
      '/storage/v1': { target: localBackend, changeOrigin: true },
    },
  },
})
