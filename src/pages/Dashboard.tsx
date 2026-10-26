import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'
import type { Profile, Project, Task } from '../lib/types'
import {
  formatHours,
  taskProgressPercent,
  STATUS_META,
} from '../lib/format'
import { addDays, formatDate, isOverdue, relativeDayLabel, todayIso } from '../lib/time'
import { CAPACITY_HOURS, hoursDueSoon, workloadLevel } from '../lib/workload'
import {
  Avatar,
  EmptyState,
  PriorityChip,
  ProgressBar,
  Spinner,
  StatusChip,
} from '../components/ui'
import { TaskDetailPanel } from '../components/TaskDetailPanel'

interface ActivityRow {
  id: string
  entity_type: string
  entity_id: string
  actor_id: string | null
  action: string
  created_at: string
}

export function DashboardPage() {
  const { profile, role } = useAuth()
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [activity, setActivity] = useState<ActivityRow[]>([])
  const [openTask, setOpenTask] = useState<Task | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [taskResult, profileResult, projectResult, activityResult] = await Promise.all([
        supabase.from('tasks').select('*').order('due_date', { ascending: true, nullsFirst: false }),
        supabase.from('profiles').select('*').order('full_name'),
        supabase.from('projects').select('*').order('target_date', { ascending: true, nullsFirst: false }),
        supabase
          .from('activity_log')
          .select('id, entity_type, entity_id, actor_id, action, created_at')
          .order('created_at', { ascending: false })
          .limit(8),
      ])
      if (cancelled) return
      if (taskResult.error) setError(taskResult.error.message)
      setTasks((taskResult.data as Task[] | null) ?? [])
      setProfiles(((profileResult.data as Profile[] | null) ?? []).filter((p) => p.is_active))
      setProjects((projectResult.data as Project[] | null) ?? [])
      setActivity((activityResult.data as ActivityRow[] | null) ?? [])
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const today = todayIso()
  const horizon = addDays(today, 7)

  const stats = useMemo(() => {
    if (!tasks || !profile) return null
    const mine = tasks.filter(
      (t) => t.assignee_id === profile.id || t.creator_id === profile.id,
    )
    const open = mine.filter((t) => ['not_started', 'in_progress', 'on_hold', 'blocked'].includes(t.status))
    const overdue = open.filter((t) => isOverdue(t.due_date, t.status))
    const dueToday = open.filter((t) => t.due_date === today)
    const dueSoon = open.filter((t) => t.due_date && t.due_date > today && t.due_date <= horizon)
    const completedThisWeek = mine.filter(
      (t) => t.status === 'completed' && (t.completed_at?.slice(0, 10) ?? '') >= addDays(today, -6),
    )
    const myHours = hoursDueSoon(tasks, profile.id, today)
    return { mine, open, overdue, dueToday, dueSoon, completedThisWeek, myHours }
  }, [tasks, profile, today, horizon])

  const teamWorkload = useMemo(() => {
    if (!tasks || !role || role === 'employee') return []
    return profiles
      .map((p) => ({ person: p, hours: Math.round(hoursDueSoon(tasks, p.id, today) * 10) / 10 }))
      .filter((w) => w.hours > 0)
      .sort((a, b) => b.hours - a.hours)
  }, [tasks, profiles, role, today])

  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles])

  if (!tasks || !profile || !stats) {
    return (
      <div className="px-4 py-6">
        <Spinner label="Loading your dashboard…" />
      </div>
    )
  }

  const isManagerish = role === 'admin' || role === 'manager'
  const activeProjects = projects.filter((p) => !p.is_archived && !['completed', 'cancelled'].includes(p.status))

  const statCards = [
    { label: 'Open tasks', value: String(stats.open.length), tone: 'text-ink', testid: 'stat-open' },
    { label: 'Due today', value: String(stats.dueToday.length), tone: stats.dueToday.length ? 'text-indigo' : 'text-ink', testid: 'stat-today' },
    { label: 'Overdue', value: String(stats.overdue.length), tone: stats.overdue.length ? 'text-rose' : 'text-ink', testid: 'stat-overdue' },
    { label: 'Completed (7d)', value: String(stats.completedThisWeek.length), tone: 'text-success', testid: 'stat-completed' },
  ]

  const myLevel = workloadLevel(stats.myHours)

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 lg:px-6">
      <div className="mb-5">
        <h2 className="text-xl font-semibold">
          Hello, {profile.full_name.split(' ')[0]}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {new Intl.DateTimeFormat('en-IN', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'Asia/Kolkata',
          }).format(new Date())}
        </p>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {statCards.map((card) => (
          <div key={card.label} className="qb-card p-4" data-testid={card.testid}>
            <p className="text-xs uppercase tracking-wide text-muted">{card.label}</p>
            <p className={`mt-1 text-2xl font-bold ${card.tone}`}>{card.value}</p>
          </div>
        ))}
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="qb-card p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
              My workload · next 7 days
            </h3>
            <Link to="/my-day" className="text-xs font-medium text-indigo hover:underline">
              Open My Day →
            </Link>
          </div>
          <div className="mb-2 flex items-baseline gap-2">
            <span
              className={`text-2xl font-bold ${
                myLevel === 'red' ? 'text-rose' : myLevel === 'amber' ? 'text-amber' : 'text-ink'
              }`}
              data-testid="my-workload-hours"
            >
              {stats.myHours.toFixed(1)}h
            </span>
            <span className="text-sm text-muted">/ {CAPACITY_HOURS}h capacity</span>
            {myLevel === 'red' ? (
              <span className="qb-chip bg-rose-soft text-rose">Over capacity</span>
            ) : myLevel === 'amber' ? (
              <span className="qb-chip bg-amber-soft text-amber">Near capacity</span>
            ) : (
              <span className="qb-chip bg-success-soft text-success">Healthy</span>
            )}
          </div>
          <ProgressBar
            value={(stats.myHours / CAPACITY_HOURS) * 100}
            tone={myLevel === 'red' ? 'rose' : myLevel === 'amber' ? 'amber' : 'indigo'}
          />

          {stats.overdue.length > 0 ? (
            <div className="mt-4 rounded-lg bg-rose-soft/70 px-3 py-2.5">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-rose">
                {stats.overdue.length} overdue — clear these first
              </p>
              <ul className="space-y-1">
                {stats.overdue.slice(0, 4).map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className="text-left text-sm text-rose hover:underline"
                      onClick={() => setOpenTask(t)}
                    >
                      {t.title} · due {t.due_date ? formatDate(t.due_date) : ''}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        {isManagerish ? (
          <section className="qb-card p-4">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
              Team workload · 7 days
            </h3>
            {teamWorkload.length === 0 ? (
              <p className="text-sm text-muted">Nobody has work due in the next 7 days.</p>
            ) : (
              <ul className="space-y-2.5">
                {teamWorkload.slice(0, 6).map(({ person, hours }) => {
                  const level = workloadLevel(hours)
                  return (
                    <li key={person.id}>
                      <div className="mb-1 flex items-center gap-2 text-sm">
                        <Avatar name={person.full_name} id={person.id} size={22} />
                        <Link to={`/employees/${person.id}`} className="truncate hover:underline">
                          {person.full_name}
                        </Link>
                        <span
                          className={`ml-auto text-xs font-semibold ${
                            level === 'red' ? 'text-rose' : level === 'amber' ? 'text-amber' : 'text-muted'
                          }`}
                        >
                          {hours.toFixed(1)}h
                        </span>
                      </div>
                      <ProgressBar
                        value={(hours / CAPACITY_HOURS) * 100}
                        tone={level === 'red' ? 'rose' : level === 'amber' ? 'amber' : 'indigo'}
                      />
                    </li>
                  )
                })}
              </ul>
            )}
            <Link to="/team-tasks" className="mt-3 inline-block text-xs font-medium text-indigo hover:underline">
              Open Team Tasks →
            </Link>
          </section>
        ) : (
          <section className="qb-card p-4">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
              Coming up
            </h3>
            {stats.dueSoon.length === 0 ? (
              <p className="text-sm text-muted">Nothing else due this week.</p>
            ) : (
              <ul className="space-y-2">
                {stats.dueSoon.slice(0, 6).map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-bg"
                      onClick={() => setOpenTask(t)}
                    >
                      <p className="truncate text-sm font-medium">{t.title}</p>
                      <p className="text-xs text-muted">
                        {relativeDayLabel(t.due_date!, today)} · {formatHours(t.estimated_hours)}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="qb-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
              My tasks due soon
            </h3>
            <Link to="/my-tasks" className="text-xs font-medium text-indigo hover:underline">
              View all →
            </Link>
          </div>
          {stats.dueSoon.length === 0 && stats.dueToday.length === 0 ? (
            <EmptyState title="All clear" description="No open tasks due in the next 7 days." />
          ) : (
            <ul className="space-y-2">
              {[...stats.dueToday, ...stats.dueSoon].slice(0, 6).map((t) => (
                <li
                  key={t.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-2.5 hover:border-indigo/40"
                  onClick={() => setOpenTask(t)}
                  data-testid={`dashboard-task-${t.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.title}</p>
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                      <PriorityChip priority={t.priority} />
                      <span className={t.due_date === today ? 'font-semibold text-indigo' : ''}>
                        {t.due_date ? relativeDayLabel(t.due_date, today) : 'No due date'}
                      </span>
                    </p>
                  </div>
                  <span className="w-24">
                    <ProgressBar value={taskProgressPercent(t)} />
                  </span>
                  <span className="hidden sm:block">
                    <StatusChip status={t.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="qb-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
              {isManagerish ? 'Recent activity' : 'Projects in flight'}
            </h3>
            {isManagerish ? null : (
              <Link to="/projects" className="text-xs font-medium text-indigo hover:underline">
                View projects →
              </Link>
            )}
          </div>

          {isManagerish ? (
            <ul className="space-y-2.5">
              {activity.length === 0 ? (
                <li className="text-sm text-muted">No recent activity.</li>
              ) : (
                activity.map((row) => {
                  const actor = row.actor_id ? profileById.get(row.actor_id) : null
                  return (
                    <li key={row.id} className="flex items-start gap-2 text-sm">
                      <Avatar name={actor?.full_name ?? 'System'} id={row.actor_id ?? 'sys'} size={24} />
                      <span className="text-muted">
                        <span className="font-medium text-ink">{actor?.full_name ?? 'System'}</span>{' '}
                        {row.action.replace(/_/g, ' ')}{' '}
                        <span className="text-xs">· {relativeDayLabel(row.created_at.slice(0, 10), today)}</span>
                      </span>
                    </li>
                  )
                })
              )}
            </ul>
          ) : (
            <ul className="space-y-2">
              {activeProjects.slice(0, 6).map((p) => (
                <li key={p.id}>
                  <Link
                    to={`/projects/${p.id}`}
                    className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 hover:border-indigo/40"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-muted">
                        {p.code} · target {formatDate(p.target_date)}
                      </p>
                    </div>
                    <span className={`qb-chip ${p.status === 'at_risk' ? 'bg-rose-soft text-rose' : 'bg-indigo-soft text-indigo'}`}>
                      {STATUS_META.not_started.label ? p.status.replace(/_/g, ' ') : p.status}
                    </span>
                  </Link>
                </li>
              ))}
              {activeProjects.length === 0 ? (
                <li className="text-sm text-muted">No active projects.</li>
              ) : null}
            </ul>
          )}
        </section>
      </div>

      <TaskDetailPanel
        task={openTask}
        open={openTask !== null}
        onClose={() => setOpenTask(null)}
        onTaskUpdated={(updated) => setOpenTask(updated)}
      />
    </div>
  )
}
