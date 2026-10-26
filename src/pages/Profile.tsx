import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'
import { Avatar, Spinner } from '../components/ui'
import { ROLE_LABEL } from '../lib/format'
import type { ReminderPreference } from '../lib/types'

const REMINDER_OPTIONS: { value: ReminderPreference; label: string }[] = [
  { value: 'on_due_date', label: 'On the due date' },
  { value: 'one_day_before', label: '1 day before' },
  { value: 'three_days_before', label: '3 days before' },
]

export function ProfilePage() {
  const { profile, refreshProfile, signOut } = useAuth()
  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [reminder, setReminder] = useState<ReminderPreference>(
    profile?.reminder_preference ?? 'one_day_before',
  )
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null)

  const [profileSynced, setProfileSynced] = useState<string | null>(null)

  // Sync form fields when the loaded profile changes (render-time adjustment).
  if (profile && profileSynced !== profile.id + profile.full_name + profile.reminder_preference) {
    setProfileSynced(profile.id + profile.full_name + profile.reminder_preference)
    setFullName(profile.full_name)
    setReminder(profile.reminder_preference)
  }

  if (!profile) {
    return (
      <div className="px-4 py-6">
        <Spinner />
      </div>
    )
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setSaved(false)
    const { error: err } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim(), reminder_preference: reminder })
      .eq('id', profile!.id)
      .select()
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setSaved(true)
    await refreshProfile()
  }

  async function sendPasswordReset() {
    setPasswordBusy(true)
    setPasswordMsg(null)
    const { error: err } = await supabase.auth.resetPasswordForEmail(profile!.work_email)
    setPasswordBusy(false)
    setPasswordMsg(
      err
        ? err.message
        : `A password reset link was sent to ${profile!.work_email}.`,
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 lg:px-6">
      <h2 className="mb-1 text-xl font-semibold">Your profile</h2>
      <p className="mb-5 text-sm text-muted">
        Account details and notification preferences.
      </p>

      <div className="qb-card mb-4 flex items-center gap-4 p-5">
        <Avatar name={profile.full_name} id={profile.id} size={56} />
        <div>
          <p className="text-lg font-semibold">{profile.full_name}</p>
          <p className="text-sm text-muted">{profile.work_email}</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <span className="qb-chip bg-indigo-soft text-indigo">{ROLE_LABEL[profile.role]}</span>
            <span className="qb-chip bg-slate-soft text-muted">{profile.employee_code}</span>
            {profile.is_active ? (
              <span className="qb-chip bg-success-soft text-success">Active</span>
            ) : (
              <span className="qb-chip bg-rose-soft text-rose">Deactivated</span>
            )}
          </div>
        </div>
        <dl className="ml-auto hidden text-right text-sm sm:block">
          <dt className="text-xs uppercase tracking-wide text-muted">Department</dt>
          <dd>{profile.department ?? '—'}</dd>
          <dt className="mt-2 text-xs uppercase tracking-wide text-muted">Designation</dt>
          <dd>{profile.designation ?? '—'}</dd>
        </dl>
      </div>

      <form className="qb-card mb-4 p-5" onSubmit={save}>
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">
          Preferences
        </h3>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-muted">Display name</span>
          <input
            className="qb-input"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            maxLength={120}
            data-testid="profile-name"
          />
        </label>

        <label className="mb-4 block text-sm">
          <span className="mb-1 block text-muted">Due-date reminders</span>
          <select
            className="qb-input"
            value={reminder}
            onChange={(e) => setReminder(e.target.value as ReminderPreference)}
            data-testid="profile-reminder"
          >
            {REMINDER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        {error ? (
          <p className="mb-3 rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose" role="alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className="mb-3 rounded-lg bg-success-soft px-3 py-2 text-sm text-success" role="status">
            Saved.
          </p>
        ) : null}

        <button type="submit" className="qb-btn qb-btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      <div className="qb-card p-5">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Security</h3>
        <p className="mb-3 text-sm text-muted">
          Password changes are handled through a secure email link.
        </p>
        {passwordMsg ? (
          <p className="mb-3 rounded-lg bg-indigo-soft px-3 py-2 text-sm text-indigo" role="status">
            {passwordMsg}
          </p>
        ) : null}
        <div className="flex gap-2">
          <button
            type="button"
            className="qb-btn qb-btn-secondary"
            disabled={passwordBusy}
            onClick={() => void sendPasswordReset()}
            data-testid="send-reset"
          >
            {passwordBusy ? 'Sending…' : 'Email me a reset link'}
          </button>
          <button type="button" className="qb-btn qb-btn-ghost" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
