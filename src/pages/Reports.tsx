import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import type { Profile, Project, Task, WeeklyReview } from '../lib/types'
import { PRIORITIES, TASK_STATUSES } from '../lib/types'
import {
  PRIORITY_META,
  PROJECT_STATUS_META,
  ROLE_LABEL,
  STATUS_META,
  taskProgressPercent,
} from '../lib/format'
import {
  formatDate,
  isOverdue,
  startOfWeekMonday,
  todayIso,
} from '../lib/time'
import {
  CAPACITY_HOURS,
  computeWorkloads,
  workloadBarTone,
  workloadLevel,
} from '../lib/workload'
import { Avatar, EmptyState, ProgressBar, Spinner } from '../components/ui'
import { useDirectory } from '../lib/tasks'

type Tab = 'overview' | 'delivery' | 'reviews'

interface WeeklyReviewRow extends WeeklyReview {
  profile?: Profile
}

function downloadCsv(filename: string, rows: Array<Array<string | number | null>>) {
  const escape = (value: string | number | null) =>
    `"${String(value ?? '').replace(/"/g, '""')}"`
  const csv = rows.map((row) => row.map(escape).join(',')).join('\r\n')
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function pct(part: number, whole: number): number {
  if (whole === 0) return 0
  return Math.round((part / whole) * 100)
}

function DistributionBar({
  label,
  count,
  total,
  tone = 'indigo',
}: {
  label: string
  count: number
  total: number
  tone?: 'indigo' | 'amber' | 'rose' | 'magenta' | 'low'
}) {
  const barColor: Record<string, string> = {
    indigo: 'bg-indigo',
    amber: 'bg-amber',
    rose: 'bg-rose',
    magenta: 'bg-magenta',
    low: 'bg-low',
  }
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-28 shrink-0 truncate text-muted">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-line">
        <div
          className={`h-full rounded-full ${barColor[tone] ?? barColor.indigo}`}
          style={{ width: `${pct(count, total)}%` }}
        />
      </div>
      <span className="w-14 shrink-0 text-right font-medium">
        {count} <span className="text-muted">({pct(count, total)}%)</span>
      </span>
    </div>
  )
}

export function ReportsPage() {
  const { profile } = useAuth()
  const { profiles } = useDirectory()
  const [tab, setTab] = useState<Tab>('overview')
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [reviews, setReviews] = useState<WeeklyReviewRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isAdminOrManager = profile?.role === 'admin' || profile?.role === 'manager'
  const weekStart = startOfWeekMonday(todayIso())

  useEffect(() => {
    if (!isAdminOrManager) return
    let cancelled = false
    void (async () => {
      const [taskResult, projectResult, reviewResult] = await Promise.all([
        supabase.from('tasks').select('*'),
        supabase.from('projects').select('*').order('code'),
        supabase
          .from('weekly_reviews')
          .select('*')
          .order('week_start', { ascending: false })
          .limit(40),
      ])
      if (cancelled) return
      if (taskResult.error) {
        setError(taskResult.error.message)
        setTasks([])
      } else {
        setTasks((taskResult.data as Task[] | null) ?? [])
        setError(null)
      }
      setProjects((projectResult.data as Project[] | null) ?? [])
      const rows = (reviewResult.data as WeeklyReviewRow[] | null) ?? []
      setReviews(rows)
    })()
    return () => {
      cancelled = true
    }
  }, [isAdminOrManager])

  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles])
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  const workloads = useMemo(() => {
    if (!tasks) return []
    return computeWorkloads(tasks, profiles.map((p) => p.id), todayIso()).sort(
      (a, b) => b.hours - a.hours,
    )
  }, [tasks, profiles])

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const task of tasks ?? []) counts.set(task.status, (counts.get(task.status) ?? 0) + 1)
    return counts
  }, [tasks])

  const priorityCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const task of tasks ?? []) counts.set(task.priority, (counts.get(task.priority) ?? 0) + 1)
    return counts
  }, [tasks])

  const delivery = useMemo(() => {
    const list = tasks ?? []
    const completedWithDue = list.filter(
      (t) => t.status === 'completed' && t.due_date && t.completed_at,
    )
    const onTime = completedWithDue.filter(
      (t) => t.completed_at!.slice(0, 10) <= t.due_date!,
    )
    const overdueOpen = list.filter((t) => isOverdue(t.due_date, t.status))
    const open = list.filter((t) => !['completed', 'cancelled'].includes(t.status))
    const avgLeadDays =
      completedWithDue.length === 0
        ? 0
        : Math.round(
            (completedWithDue.reduce((sum, t) => {
              const created = t.created_at.slice(0, 10)
              const done = t.completed_at!.slice(0, 10)
              const days = (new Date(done).getTime() - new Date(created).getTime()) / 86400000
              return sum + Math.max(0, days)
            }, 0) /
              completedWithDue.length) *
              10,
          ) / 10
    return {
      completedWithDue: completedWithDue.length,
      onTime: onTime.length,
      overdueOpen: overdueOpen.length,
      open: open.length,
      avgLeadDays,
    }
  }, [tasks])

  const projectHealth = useMemo(() => {
    return projects.map((project) => {
      const list = (tasks ?? []).filter((t) => t.project_id === project.id)
      const open = list.filter((t) => !['completed', 'cancelled'].includes(t.status))
      const overdue = list.filter((t) => isOverdue(t.due_date, t.status))
      const computed =
        list.length === 0
          ? 0
          : Math.round(
              list.reduce((sum, t) => sum + taskProgressPercent(t), 0) / list.length,
            )
      const progress = project.progress_override ?? computed
      return { project, open: open.length, overdue: overdue.length, progress }
    })
  }, [projects, tasks])

  // Weekly review form
  const [targetUserId, setTargetUserId] = useState<string | null>(null)
  const [accomplishments, setAccomplishments] = useState('')
  const [priorities, setPriorities] = useState('')
  const [managerNotes, setManagerNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveNote, setSaveNote] = useState<string | null>(null)

  const effectiveTarget = targetUserId ?? profile?.id ?? null
  const canEditManagerNotes =
    profile?.role === 'admin' || effectiveTarget !== profile?.id

  // Re-sync the form when the target/week changes or reviews first arrive
  // (render-phase adjustment; see react.dev "You Might Not Need an Effect").
  const formSyncKey = `${effectiveTarget ?? ''}|${weekStart}|${reviews === null ? 'loading' : 'ready'}`
  const [syncedFormKey, setSyncedFormKey] = useState(formSyncKey)
  if (syncedFormKey !== formSyncKey) {
    setSyncedFormKey(formSyncKey)
    const existing = reviews?.find(
      (r) => r.user_id === effectiveTarget && r.week_start === weekStart,
    )
    setAccomplishments(existing?.accomplishments ?? '')
    setPriorities(existing?.next_week_priorities ?? '')
    setManagerNotes(existing?.manager_notes ?? '')
    setSaveNote(null)
  }

  async function saveReview() {
    if (!profile || !effectiveTarget) return
    setSaving(true)
    setSaveNote(null)
    const payload = {
      accomplishments: accomplishments.trim() || null,
      next_week_priorities: priorities.trim() || null,
      manager_notes: canEditManagerNotes ? managerNotes.trim() || null : null,
    }
    const existing = reviews?.find(
      (r) => r.user_id === effectiveTarget && r.week_start === weekStart,
    )
    let result
    if (existing) {
      result = await supabase
        .from('weekly_reviews')
        .update(payload)
        .eq('id', existing.id)
        .select()
        .maybeSingle()
    } else {
      result = await supabase
        .from('weekly_reviews')
        .insert({ user_id: effectiveTarget, week_start: weekStart, ...payload })
        .select()
        .maybeSingle()
    }
    setSaving(false)
    if (result.error) {
      setSaveNote(result.error.message)
      return
    }
    setReviews((prev) => {
      const row = result.data as WeeklyReviewRow | null
      if (!row || !prev) return prev
      const without = prev.filter((r) => r.id !== row.id)
      return [row, ...without]
    })
    setSaveNote('Saved.')
  }

  if (!isAdminOrManager) {
    return (
      <div className="px-4 py-6">
        <EmptyState
          title="Reports are for managers"
          description="Your manager or the business owner can see team reporting."
        />
      </div>
    )
  }

  if (!tasks) {
    return (
      <div className="px-4 py-6">
        <Spinner label="Loading reports…" />
      </div>
    )
  }

  const onTimePct = pct(delivery.onTime, delivery.completedWithDue)

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'delivery', label: 'Delivery & health' },
    { id: 'reviews', label: 'Weekly reviews' },
  ]

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Reports</h2>
          <p className="mt-1 text-sm text-muted">
            {tasks.length} tasks · {projects.length} projects · week of{' '}
            {formatDate(weekStart)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="qb-btn qb-btn-secondary"
            onClick={() =>
              downloadCsv('tasks.csv', [
                ['Project', 'Title', 'Assignee', 'Status', 'Priority', 'Start', 'Due', 'Est. hours', 'Progress %', 'Completed at'],
                ...tasks.map((t) => [
                  t.project_id ? (projectById.get(t.project_id)?.code ?? '') : 'Personal',
                  t.title,
                  profileById.get(t.assignee_id)?.full_name ?? '',
                  STATUS_META[t.status].label,
                  PRIORITY_META[t.priority].label,
                  t.start_date ?? '',
                  t.due_date ?? '',
                  t.estimated_hours ?? '',
                  taskProgressPercent(t),
                  t.completed_at ?? '',
                ]),
              ])
            }
          >
            Export tasks.csv
          </button>
          <button
            type="button"
            className="qb-btn qb-btn-secondary"
            onClick={() =>
              downloadCsv('projects.csv', [
                ['Code', 'Name', 'Status', 'Manager', 'Target date', 'Open tasks', 'Overdue tasks', 'Progress %'],
                ...projectHealth.map((row) => [
                  row.project.code,
                  row.project.name,
                  PROJECT_STATUS_META[row.project.status].label,
                  profileById.get(row.project.manager_id)?.full_name ?? '',
                  row.project.target_date ?? '',
                  row.open,
                  row.overdue,
                  row.progress,
                ]),
              ])
            }
          >
            Export projects.csv
          </button>
          <button
            type="button"
            className="qb-btn qb-btn-secondary"
            onClick={() =>
              downloadCsv('workload.csv', [
                ['Employee', 'Role', 'Hours due (7d)', 'Capacity', 'Level'],
                ...workloads.map((w) => {
                  const person = profileById.get(w.userId)
                  return [
                    person?.full_name ?? w.userId,
                    person ? ROLE_LABEL[person.role] : '',
                    w.hours,
                    CAPACITY_HOURS,
                    workloadLevel(w.hours),
                  ]
                }),
              ])
            }
          >
            Export workload.csv
          </button>
        </div>
      </div>

      <div className="mb-5 flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t.id
                ? 'border-indigo text-ink'
                : 'border-transparent text-muted hover:text-ink'
            }`}
            data-testid={`report-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="mb-4 rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose" role="alert">
          {error}
        </p>
      ) : null}

      {tab === 'overview' ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <section className="qb-card p-5 lg:col-span-1">
            <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">
              Utilisation · next 7 days
            </h3>
            <p className="mb-4 text-xs text-muted">
              Remaining hours due within 7 days against {CAPACITY_HOURS} h capacity.
            </p>
            <ul className="space-y-3">
              {workloads.map((w) => {
                const person = profileById.get(w.userId)
                if (!person) return null
                return (
                  <li key={w.userId} data-testid={`report-workload-${person.work_email}`}>
                    <div className="mb-1 flex items-center gap-2">
                      <Avatar name={person.full_name} id={person.id} size={22} />
                      <span className="truncate text-sm font-medium">{person.full_name}</span>
                      <span
                        className={`ml-auto text-xs font-semibold ${
                          w.level === 'red'
                            ? 'text-rose'
                            : w.level === 'amber'
                              ? 'text-amber'
                              : 'text-muted'
                        }`}
                      >
                        {w.hours.toFixed(1)}h
                      </span>
                    </div>
                    <ProgressBar
                      value={(w.hours / CAPACITY_HOURS) * 100}
                      tone={workloadBarTone(w.level)}
                    />
                  </li>
                )
              })}
              {workloads.length === 0 ? (
                <li className="text-sm text-muted">No active employees.</li>
              ) : null}
            </ul>
          </section>

          <section className="qb-card p-5">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">
              Task status distribution
            </h3>
            <div className="space-y-3">
              {TASK_STATUSES.map((status) => (
                <DistributionBar
                  key={status}
                  label={STATUS_META[status].label}
                  count={statusCounts.get(status) ?? 0}
                  total={tasks.length}
                  tone={
                    status === 'completed'
                      ? 'indigo'
                      : status === 'blocked'
                        ? 'rose'
                        : status === 'in_progress'
                          ? 'magenta'
                          : 'low'
                  }
                />
              ))}
            </div>
          </section>

          <section className="qb-card p-5">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">
              Priority distribution
            </h3>
            <div className="space-y-3">
              {PRIORITIES.map((priority) => (
                <DistributionBar
                  key={priority}
                  label={PRIORITY_META[priority].label}
                  count={priorityCounts.get(priority) ?? 0}
                  total={tasks.length}
                  tone={
                    priority === 'critical'
                      ? 'rose'
                      : priority === 'high'
                        ? 'amber'
                        : priority === 'medium'
                          ? 'indigo'
                          : 'low'
                  }
                />
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {tab === 'delivery' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="qb-card p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                On-time delivery
              </p>
              <p
                className={`mt-2 text-3xl font-semibold ${
                  onTimePct >= 80 ? 'text-indigo' : onTimePct >= 60 ? 'text-amber' : 'text-rose'
                }`}
              >
                {onTimePct}%
              </p>
              <p className="mt-1 text-xs text-muted">
                {delivery.onTime} of {delivery.completedWithDue} completed tasks with a due date
              </p>
            </div>
            <div className="qb-card p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Overdue now
              </p>
              <p
                className={`mt-2 text-3xl font-semibold ${
                  delivery.overdueOpen > 0 ? 'text-rose' : 'text-indigo'
                }`}
              >
                {delivery.overdueOpen}
              </p>
              <p className="mt-1 text-xs text-muted">of {delivery.open} open tasks</p>
            </div>
            <div className="qb-card p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Avg. completion lead
              </p>
              <p className="mt-2 text-3xl font-semibold text-ink">{delivery.avgLeadDays}d</p>
              <p className="mt-1 text-xs text-muted">created → completed</p>
            </div>
            <div className="qb-card p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Active projects
              </p>
              <p className="mt-2 text-3xl font-semibold text-ink">
                {
                  projects.filter((p) => !['completed', 'cancelled'].includes(p.status))
                    .length
                }
              </p>
              <p className="mt-1 text-xs text-muted">of {projects.length} total</p>
            </div>
          </div>

          <section className="qb-card overflow-x-auto">
            <div className="border-b border-line px-5 py-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
                Project health
              </h3>
            </div>
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-semibold">Project</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold">Manager</th>
                  <th className="px-5 py-3 font-semibold">Target</th>
                  <th className="px-5 py-3 font-semibold">Open</th>
                  <th className="px-5 py-3 font-semibold">Overdue</th>
                  <th className="w-44 px-5 py-3 font-semibold">Progress</th>
                </tr>
              </thead>
              <tbody>
                {projectHealth.map(({ project, open, overdue, progress }) => (
                  <tr key={project.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-3">
                      <p className="font-medium">{project.name}</p>
                      <p className="mt-0.5 text-xs text-muted">{project.code}</p>
                    </td>
                    <td className="px-5 py-3 text-xs">
                      <span
                        className={`rounded-full px-2 py-0.5 font-medium ${PROJECT_STATUS_META[project.status].chip}`}
                      >
                        {PROJECT_STATUS_META[project.status].label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-muted">
                      {profileById.get(project.manager_id)?.full_name ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-xs text-muted">
                      {formatDate(project.target_date)}
                    </td>
                    <td className="px-5 py-3 text-xs font-medium">{open}</td>
                    <td
                      className={`px-5 py-3 text-xs font-semibold ${
                        overdue > 0 ? 'text-rose' : 'text-muted'
                      }`}
                    >
                      {overdue}
                    </td>
                    <td className="px-5 py-3">
                      <ProgressBar value={progress} showLabel />
                    </td>
                  </tr>
                ))}
                {projectHealth.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-6 text-center text-sm text-muted">
                      No projects yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </section>
        </div>
      ) : null}

      {tab === 'reviews' ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <section className="qb-card p-5 lg:col-span-2">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
                  Weekly review · week of {formatDate(weekStart)}
                </h3>
                <p className="mt-1 text-xs text-muted">
                  Employees write their own review; managers can add notes for their team.
                </p>
              </div>
              {profile?.role !== 'employee' ? (
                <select
                  className="qb-input w-52"
                  value={effectiveTarget ?? ''}
                  onChange={(e) => setTargetUserId(e.target.value)}
                  aria-label="Select employee"
                  data-testid="review-target"
                >
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name} · {ROLE_LABEL[p.role]}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>

            <div className="space-y-4">
              <label className="block text-sm">
                <span className="mb-1 block text-muted">Accomplishments this week</span>
                <textarea
                  className="qb-input min-h-24 resize-y"
                  value={accomplishments}
                  onChange={(e) => setAccomplishments(e.target.value)}
                  placeholder="Shipped the calendar view, fixed RLS gaps…"
                  data-testid="review-accomplishments"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted">Priorities for next week</span>
                <textarea
                  className="qb-input min-h-24 resize-y"
                  value={priorities}
                  onChange={(e) => setPriorities(e.target.value)}
                  placeholder="Close out PRJ-003, start migration tests…"
                  data-testid="review-priorities"
                />
              </label>
              {canEditManagerNotes ? (
                <label className="block text-sm">
                  <span className="mb-1 block text-muted">Manager notes</span>
                  <textarea
                    className="qb-input min-h-24 resize-y"
                    value={managerNotes}
                    onChange={(e) => setManagerNotes(e.target.value)}
                    placeholder="Feedback, blockers to escalate, wins…"
                    data-testid="review-manager-notes"
                  />
                </label>
              ) : null}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="qb-btn qb-btn-primary"
                  onClick={() => void saveReview()}
                  disabled={saving}
                  data-testid="review-save"
                >
                  {saving ? 'Saving…' : 'Save review'}
                </button>
                {saveNote ? <span className="text-sm text-muted">{saveNote}</span> : null}
              </div>
            </div>
          </section>

          <section className="qb-card p-5">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">
              Recent reviews
            </h3>
            <ul className="space-y-3">
              {(reviews ?? []).slice(0, 12).map((review) => {
                const person = profileById.get(review.user_id)
                return (
                  <li
                    key={review.id}
                    className="rounded-lg border border-line px-3 py-2"
                    data-testid={`review-row-${review.week_start}`}
                  >
                    <div className="flex items-center gap-2">
                      <Avatar
                        name={person?.full_name ?? '?'}
                        id={review.user_id}
                        size={20}
                      />
                      <span className="truncate text-sm font-medium">
                        {person?.full_name ?? 'Unknown'}
                      </span>
                      <span className="ml-auto text-xs text-muted">
                        {formatDate(review.week_start)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted">
                      {review.accomplishments || 'No accomplishments recorded.'}
                    </p>
                  </li>
                )
              })}
              {(reviews ?? []).length === 0 ? (
                <li className="text-sm text-muted">No reviews submitted yet.</li>
              ) : null}
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  )
}
