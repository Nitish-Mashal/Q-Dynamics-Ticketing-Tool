import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'
import type { Profile, Task } from '../lib/types'
import { Avatar, EmptyState, PriorityChip, ProgressBar, Spinner, StatusChip } from '../components/ui'
import { ROLE_LABEL, remainingHours } from '../lib/format'
import { addDays, formatDate, todayIso } from '../lib/time'
import { CAPACITY_HOURS, hoursDueSoon, workloadLevel } from '../lib/workload'

export function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { profile: me } = useAuth()
  const [person, setPerson] = useState<Profile | null | undefined>(undefined)
  const [manager, setManager] = useState<Profile | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    if (!id) return null
    const { data, error: err } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (err) return { error: err.message, person: null as Profile | null, manager: null as Profile | null, tasks: [] as Task[] }

    const row = data as Profile | null
    let mgr: Profile | null = null
    if (row?.reporting_manager_id) {
      const { data: mgrData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', row.reporting_manager_id)
        .maybeSingle()
      mgr = (mgrData as Profile | null) ?? null
    }

    const { data: taskRows, error: taskErr } = await supabase
      .from('tasks')
      .select('*')
      .eq('assignee_id', id)
      .in('status', ['not_started', 'in_progress', 'on_hold', 'blocked'])
      .order('due_date', { ascending: true, nullsFirst: false })

    return {
      error: taskErr?.message ?? null,
      person: row,
      manager: mgr,
      tasks: (taskRows as Task[] | null) ?? [],
    }
  }, [id])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await fetchAll()
      if (cancelled || !result) return
      setPerson(result.person)
      setManager(result.manager)
      setTasks(result.tasks)
      setError(result.error)
    })()
    return () => {
      cancelled = true
    }
  }, [fetchAll])

  const workloadHours = useMemo(
    () => Math.round(hoursDueSoon(tasks, id ?? '', todayIso()) * 10) / 10,
    [tasks, id],
  )

  if (person === undefined) {
    return (
      <div className="px-4 py-6">
        <Spinner label="Loading employee…" />
      </div>
    )
  }

  if (person === null) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <EmptyState
          title="Employee not found"
          description="They may have been removed, or you don’t have access to this profile."
          action={
            <Link to="/employees" className="qb-btn qb-btn-primary">
              Back to Employees
            </Link>
          }
        />
      </div>
    )
  }

  const level = workloadLevel(workloadHours)
  const isSelf = person.id === me?.id

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 lg:px-6">
      <Link to="/employees" className="mb-4 inline-block text-sm text-indigo hover:underline">
        ← Back to Employees
      </Link>

      {error ? (
        <p className="mb-4 rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose" role="alert">
          {error}
        </p>
      ) : null}

      <div className="qb-card mb-4 p-5">
        <div className="flex flex-wrap items-start gap-4">
          <Avatar name={person.full_name} id={person.id} size={56} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">{person.full_name}</h2>
              {isSelf ? <span className="qb-chip bg-magenta-soft text-magenta">You</span> : null}
              <span className="qb-chip bg-indigo-soft text-indigo">{ROLE_LABEL[person.role]}</span>
              <span
                className={`qb-chip ${person.is_active ? 'bg-success-soft text-success' : 'bg-slate-soft text-muted'}`}
              >
                {person.is_active ? 'Active' : 'Deactivated'}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted">
              {person.employee_code} · {person.work_email}
            </p>
            <p className="mt-0.5 text-sm text-muted">
              {[person.designation, person.department].filter(Boolean).join(' · ') || 'No designation'}
              {manager ? ` · Reports to ${manager.full_name}` : ''}
            </p>
          </div>
          <div className="w-48">
            <p className="mb-1 text-xs uppercase tracking-wide text-muted">
              Workload next 7 days
            </p>
            <p
              className={`text-lg font-semibold ${
                level === 'red' ? 'text-rose' : level === 'amber' ? 'text-amber' : 'text-ink'
              }`}
              data-testid="detail-workload"
            >
              {workloadHours.toFixed(1)} h / {CAPACITY_HOURS} h
            </p>
            <ProgressBar value={(workloadHours / CAPACITY_HOURS) * 100} tone={level === 'red' ? 'rose' : level === 'amber' ? 'amber' : 'indigo'} />
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4 text-sm md:grid-cols-4">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Time zone</dt>
            <dd className="mt-0.5">{person.timezone}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Reminders</dt>
            <dd className="mt-0.5 capitalize">{person.reminder_preference.replace(/_/g, ' ')}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Open tasks</dt>
            <dd className="mt-0.5">{tasks.length}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Joined</dt>
            <dd className="mt-0.5">{formatDate(person.created_at.slice(0, 10))}</dd>
          </div>
        </dl>
      </div>

      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
        Open tasks due by {formatDate(addDays(todayIso(), 7))}
      </h3>

      {tasks.length === 0 ? (
        <EmptyState
          title="No open tasks"
          description="Nothing due in the next 7 days is assigned to this person."
        />
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => {
            const remaining = remainingHours(task)
            return (
              <li key={task.id} className="qb-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{task.title}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      Due {formatDate(task.due_date)}
                      {task.due_date && task.due_date < todayIso() ? (
                        <span className="ml-1 font-semibold text-rose">· overdue</span>
                      ) : null}
                      {task.estimated_hours ? (
                        <span className="ml-2">
                          {task.estimated_hours}h est · {remaining.toFixed(1)}h left
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <PriorityChip priority={task.priority} />
                    <StatusChip status={task.status} />
                  </div>
                </div>
                <div className="mt-2">
                  <ProgressBar value={task.progress} showLabel />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
