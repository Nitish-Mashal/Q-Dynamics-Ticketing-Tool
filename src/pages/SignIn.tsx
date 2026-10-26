import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { isHosted } from '../lib/supabase'

// Development-only preview accounts (seed data). Never rendered in production builds.
const DEV_ACCOUNTS = [
  { label: 'Ananya Rao — Owner', email: 'ananya.rao@quantumberg.com' },
  { label: 'Vikram Shetty — Manager', email: 'vikram.shetty@quantumberg.com' },
  { label: 'Priya Nair — Employee', email: 'priya.nair@quantumberg.com' },
  { label: 'Sneha Iyer — Employee', email: 'sneha.iyer@quantumberg.com' },
]

const DEV_PASSWORD = 'Quantum@2026'

export function SignInPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(target?: { email: string; password: string }) {
    setBusy(true)
    setError(null)
    const result = await signIn(target?.email ?? email, target?.password ?? password)
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    navigate('/dashboard', { replace: true })
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-indigo font-heading text-lg font-bold text-white">
            Q
          </span>
          <div>
            <h1 className="font-heading text-lg font-semibold">Quantumberg Technologies</h1>
            <p className="text-sm text-muted">Task, project &amp; employee management</p>
          </div>
        </div>

        <form
          className="qb-card p-6"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <h2 className="mb-4 text-base font-semibold">Sign in</h2>

          <label className="mb-3 block text-sm">
            <span className="mb-1 block text-muted">Work email</span>
            <input
              className="qb-input"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@quantumberg.com"
              data-testid="sign-in-email"
            />
          </label>

          <label className="mb-4 block text-sm">
            <span className="mb-1 block text-muted">Password</span>
            <input
              className="qb-input"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              data-testid="sign-in-password"
            />
          </label>

          {error ? (
            <p className="mb-3 rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose" role="alert" data-testid="sign-in-error">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            className="qb-btn qb-btn-primary w-full"
            disabled={busy}
            data-testid="sign-in-submit"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="mt-4 flex items-center justify-between text-sm">
            <Link to="/forgot-password" className="text-indigo hover:underline">
              Forgot password?
            </Link>
            {!isHosted ? (
              <span className="text-xs text-muted">Local dev backend</span>
            ) : null}
          </div>
        </form>

        {!isHosted && import.meta.env.DEV ? (
          <div className="qb-card mt-4 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              Dev preview accounts
            </p>
            <div className="flex flex-wrap gap-2">
              {DEV_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  className="qb-btn qb-btn-secondary !py-1 text-xs"
                  onClick={() => {
                    setEmail(account.email)
                    setPassword(DEV_PASSWORD)
                    void submit({ email: account.email, password: DEV_PASSWORD })
                  }}
                  data-testid={`preview-${account.email.split('@')[0]}`}
                >
                  {account.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted">Password: {DEV_PASSWORD}</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
