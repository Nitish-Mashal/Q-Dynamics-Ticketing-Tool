import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'

export function ForgotPasswordPage() {
  const { sendPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <form
        className="qb-card w-full max-w-md p-6"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(null)
          const result = await sendPasswordReset(email)
          setBusy(false)
          if (result.error) setError(result.error)
          else setSent(true)
        }}
      >
        <h1 className="mb-1 text-lg font-semibold">Reset your password</h1>
        <p className="mb-4 text-sm text-muted">
          We’ll email you a secure link to choose a new password.
        </p>

        {sent ? (
          <p className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success" role="status">
            If that address has an account, a reset link is on its way. Check your inbox.
          </p>
        ) : (
          <>
            <label className="mb-4 block text-sm">
              <span className="mb-1 block text-muted">Work email</span>
              <input
                className="qb-input"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                data-testid="reset-email"
              />
            </label>
            {error ? (
              <p className="mb-3 rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" className="qb-btn qb-btn-primary w-full" disabled={busy}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </>
        )}

        <p className="mt-4 text-sm">
          <Link to="/sign-in" className="text-indigo hover:underline">
            Back to sign in
          </Link>
        </p>
      </form>
    </div>
  )
}

export function ResetPasswordPage() {
  const { session } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <form
        className="qb-card w-full max-w-md p-6"
        onSubmit={async (e) => {
          e.preventDefault()
          if (password.length < 8) {
            setError('Password must be at least 8 characters.')
            return
          }
          if (password !== confirm) {
            setError('Passwords do not match.')
            return
          }
          setBusy(true)
          setError(null)
          const { supabase } = await import('../lib/supabase')
          const { error: err } = await supabase.auth.updateUser({ password })
          setBusy(false)
          if (err) setError(err.message)
          else setDone(true)
        }}
      >
        <h1 className="mb-4 text-lg font-semibold">Choose a new password</h1>

        {done ? (
          <p className="rounded-lg bg-success-soft px-3 py-2 text-sm text-success" role="status">
            Password updated. You can sign in now.
          </p>
        ) : !session ? (
          <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber" role="alert">
            This reset link is invalid or has expired. Request a new one from the sign-in page.
          </p>
        ) : (
          <>
            <label className="mb-3 block text-sm">
              <span className="mb-1 block text-muted">New password</span>
              <input
                className="qb-input"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            <label className="mb-4 block text-sm">
              <span className="mb-1 block text-muted">Confirm password</span>
              <input
                className="qb-input"
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            {error ? (
              <p className="mb-3 rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" className="qb-btn qb-btn-primary w-full" disabled={busy}>
              {busy ? 'Saving…' : 'Update password'}
            </button>
          </>
        )}

        <p className="mt-4 text-sm">
          <Link to="/sign-in" className="text-indigo hover:underline">
            Back to sign in
          </Link>
        </p>
      </form>
    </div>
  )
}
