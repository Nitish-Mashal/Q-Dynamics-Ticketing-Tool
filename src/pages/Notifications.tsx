import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'
import type { NotificationKind, NotificationRow } from '../lib/types'
import { formatDateTime } from '../lib/time'
import { EmptyState, Spinner } from '../components/ui'

const KIND_META: Record<NotificationKind, { label: string; chip: string }> = {
  task_assigned: { label: 'Assigned', chip: 'bg-indigo-soft text-indigo' },
  task_reassigned: { label: 'Reassigned', chip: 'bg-indigo-soft text-indigo' },
  priority_changed: { label: 'Priority', chip: 'bg-high-soft text-high' },
  comment: { label: 'Comment', chip: 'bg-slate-soft text-muted' },
  mention: { label: 'Mention', chip: 'bg-magenta-soft text-magenta' },
  blocked: { label: 'Blocked', chip: 'bg-rose-soft text-rose' },
  awaiting_approval: { label: 'Review', chip: 'bg-amber-soft text-amber' },
  milestone_update: { label: 'Milestone', chip: 'bg-indigo-soft text-indigo' },
  due_soon: { label: 'Due soon', chip: 'bg-amber-soft text-amber' },
  overdue: { label: 'Overdue', chip: 'bg-rose-soft text-rose' },
}

export function NotificationsPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [rows, setRows] = useState<NotificationRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'unread' | 'all'>('unread')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data, error: err } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)
      if (cancelled) return
      if (err) {
        setError(err.message)
        setRows([])
      } else {
        setRows((data as NotificationRow[] | null) ?? [])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const visible = useMemo(() => {
    if (!rows) return []
    return filter === 'unread' ? rows.filter((r) => !r.is_read) : rows
  }, [rows, filter])

  const unreadCount = rows?.filter((r) => !r.is_read).length ?? 0

  async function markRead(row: NotificationRow) {
    if (row.is_read) return
    const { error: err } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', row.id)
      .select()
    if (err) setError(err.message)
    else setRows((prev) => (prev ?? []).map((r) => (r.id === row.id ? { ...r, is_read: true } : r)))
  }

  async function markAllRead() {
    if (!profile || unreadCount === 0) return
    const { error: err } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', profile.id)
      .eq('is_read', false)
      .select()
    if (err) setError(err.message)
    else setRows((prev) => (prev ?? []).map((r) => ({ ...r, is_read: true })))
  }

  async function remove(row: NotificationRow) {
    const { error: err } = await supabase.from('notifications').delete().eq('id', row.id)
    if (err) setError(err.message)
    else setRows((prev) => (prev ?? []).filter((r) => r.id !== row.id))
  }

  if (!rows) {
    return (
      <div className="px-4 py-6">
        <Spinner label="Loading notifications…" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 lg:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Notifications</h2>
          <p className="mt-1 text-sm text-muted">
            {unreadCount} unread · {rows.length} recent
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-line">
            {(['unread', 'all'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`px-3 py-1.5 text-xs font-semibold ${
                  filter === f ? 'bg-indigo text-white' : 'bg-card text-muted hover:bg-bg'
                }`}
                onClick={() => setFilter(f)}
                data-testid={`notif-filter-${f}`}
              >
                {f === 'unread' ? 'Unread' : 'All'}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="qb-btn qb-btn-secondary !py-1.5 text-xs"
            disabled={unreadCount === 0}
            onClick={() => void markAllRead()}
            data-testid="mark-all-read"
          >
            Mark all read
          </button>
        </div>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose" role="alert">
          {error}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState
          title={filter === 'unread' ? 'You’re all caught up' : 'No notifications'}
          description={
            filter === 'unread'
              ? 'New assignments, comments and mentions will show up here.'
              : 'Nothing here yet.'
          }
        />
      ) : (
        <ul className="space-y-2">
          {visible.map((row) => {
            const meta = KIND_META[row.kind] ?? KIND_META.comment
            return (
              <li
                key={row.id}
                className={`qb-card flex items-start gap-3 p-4 ${row.is_read ? 'opacity-70' : ''}`}
                data-testid={`notification-${row.kind}`}
              >
                <span className={`qb-chip mt-0.5 ${meta.chip}`}>{meta.label}</span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${row.is_read ? 'text-muted' : 'font-medium text-ink'}`}>
                    {row.message}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    <time dateTime={row.created_at}>{formatDateTime(row.created_at)}</time>
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  {!row.is_read ? (
                    <button
                      type="button"
                      className="qb-btn qb-btn-ghost !py-0.5 text-xs"
                      onClick={() => void markRead(row)}
                      data-testid="mark-read"
                    >
                      Mark read
                    </button>
                  ) : null}
                  {row.task_id ? (
                    <button
                      type="button"
                      className="qb-btn qb-btn-ghost !py-0.5 text-xs !text-indigo"
                      onClick={async () => {
                        await markRead(row)
                        navigate('/my-tasks')
                      }}
                    >
                      Open task →
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="qb-btn qb-btn-ghost !py-0.5 text-xs"
                    onClick={() => void remove(row)}
                    aria-label="Dismiss notification"
                  >
                    ✕
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
