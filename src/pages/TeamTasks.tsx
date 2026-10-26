import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Profile, Task, TaskStatus } from '../lib/types'
import { TASK_STATUSES } from '../lib/types'
import { STATUS_META, taskProgressPercent } from '../lib/format'
import { formatDate, isOverdue, relativeDayLabel, todayIso } from '../lib/time'
import {
  CAPACITY_HOURS,
  computeWorkloads,
  workloadBarTone,
} from '../lib/workload'
import { Avatar, EmptyState, PriorityChip, ProgressBar, Spinner, StatusChip } from '../components/ui'
import { TaskDetailPanel } from '../components/TaskDetailPanel'
import { SearchIcon } from '../components/icons'

export function TeamTasksPage() {
  const [params, setParams] = useSearchParams()
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [openTask, setOpenTask] = useState<Task | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState(params.get('q') ?? '')
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'open' | 'all'>('open')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [taskResult, profileResult] = await Promise.all([
        supabase.from('tasks').select('*').order('due_date', { ascending: true, nullsFirst: false }),
        supabase.from('profiles').select('*').order('full_name'),
      ])
      if (cancelled) return
      if (taskResult.error) {
        setError(taskResult.error.message)
        setTasks([])
      } else {
        setTasks((taskResult.data as Task[] | null) ?? [])
        setError(null)
      }
      setProfiles(((profileResult.data as Profile[] | null) ?? []).filter((p) => p.is_active))
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const desired = search || null
    if ((params.get('q') ?? null) === desired) return
    const next = new URLSearchParams(params)
    if (search) next.set('q', search)
    else next.delete('q')
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles])

  const workloads = useMemo(() => {
    if (!tasks) return []
    return computeWorkloads(
      tasks,
      profiles.map((p) => p.id),
      todayIso(),
    ).sort((a, b) => b.hours - a.hours)
  }, [tasks, profiles])

  const filtered = useMemo(() => {
    if (!tasks) return []
    const q = search.trim().toLowerCase()
    return tasks.filter((task) => {
      if (statusFilter === 'open') {
        if (!['not_started', 'in_progress', 'on_hold', 'blocked'].includes(task.status)) return false
      } else if (statusFilter !== 'all' && task.status !== statusFilter) {
        return false
      }
      if (assigneeFilter !== 'all' && task.assignee_id !== assigneeFilter) return false
      if (!q) return true
      const assignee = profileById.get(task.assignee_id)?.full_name.toLowerCase() ?? ''
      return (
        task.title.toLowerCase().includes(q) ||
        (task.description ?? '').toLowerCase().includes(q) ||
        assignee.includes(q) ||
        task.tags.some((t) => t.toLowerCase().includes(q))
      )
    })
  }, [tasks, search, statusFilter, assigneeFilter, profileById])

  if (!tasks) {
    return (
      <div className="px-4 py-6">
        <Spinner label="Loading team tasks…" />
      </div>
    )
  }

  const today = todayIso()

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-6">
      <div className="mb-5">
        <h2 className="text-xl font-semibold">Team Tasks</h2>
        <p className="mt-1 text-sm text-muted">
          {filtered.length} of {tasks.length} tasks visible to you
        </p>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-4">
        <section className="qb-card p-4 lg:col-span-1">
          <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">
            Workload · next 7 days
          </h3>
          <p className="mb-3 text-xs text-muted">
            Remaining hours due within 7 days against {CAPACITY_HOURS} h capacity.
          </p>
          <ul className="space-y-3">
            {workloads.map((w) => {
              const person = profileById.get(w.userId)
              if (!person) return null
              return (
                <li key={w.userId} data-testid={`workload-${person.work_email}`}>
                  <div className="mb-1 flex items-center gap-2">
                    <Avatar name={person.full_name} id={person.id} size={24} />
                    <span className="truncate text-sm font-medium">{person.full_name}</span>
                    <span
                      className={`ml-auto text-xs font-semibold ${
                        w.level === 'red' ? 'text-rose' : w.level === 'amber' ? 'text-amber' : 'text-muted'
                      }`}
                    >
                      {w.hours.toFixed(1)}h
                    </span>
                  </div>
                  <ProgressBar value={(w.hours / CAPACITY_HOURS) * 100} tone={workloadBarTone(w.level)} />
                  <span className="sr-only">
                    {w.level === 'red' ? 'over capacity' : w.level === 'amber' ? 'near capacity' : 'within capacity'}
                  </span>
                </li>
              )
            })}
            {workloads.length === 0 ? <li className="text-sm text-muted">No active employees.</li> : null}
          </ul>
        </section>

        <div className="lg:col-span-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <label className="relative">
              <span className="sr-only">Search team tasks</span>
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input
                className="qb-input w-56 !pl-9"
                placeholder="Search tasks, people, tags…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="team-search"
              />
            </label>

            <select
              className="qb-input w-40"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              aria-label="Filter by status"
            >
              <option value="open">Open only</option>
              <option value="all">All statuses</option>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </select>

            <select
              className="qb-input w-48"
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              aria-label="Filter by assignee"
            >
              <option value="all">Everyone</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </div>

          {error ? (
            <p className="mb-3 rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose" role="alert">
              {error}
            </p>
          ) : null}

          {filtered.length === 0 ? (
            <EmptyState
              title="No tasks match"
              description="Adjust the filters or clear the search."
            />
          ) : (
            <div className="qb-card overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-3 font-semibold">Task</th>
                    <th className="px-4 py-3 font-semibold">Assignee</th>
                    <th className="px-4 py-3 font-semibold">Due</th>
                    <th className="px-4 py-3 font-semibold">Progress</th>
                    <th className="px-4 py-3 font-semibold">Priority</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((task) => {
                    const overdue = isOverdue(task.due_date, task.status)
                    const person = profileById.get(task.assignee_id)
                    return (
                      <tr
                        key={task.id}
                        className="cursor-pointer border-b border-line last:border-0 hover:bg-bg"
                        onClick={() => setOpenTask(task)}
                        data-testid={`team-task-${task.id}`}
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium">{task.title}</p>
                          <p className="mt-0.5 text-xs text-muted">
                            {task.project_id ? 'Project task' : 'Personal task'}
                            {task.tags.length > 0 ? ` · ${task.tags.map((t) => `#${t}`).join(' ')}` : ''}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-2">
                            <Avatar name={person?.full_name ?? '?'} id={task.assignee_id} size={24} />
                            <span className="text-xs">{person?.full_name ?? 'Unknown'}</span>
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-xs ${overdue ? 'font-semibold text-rose' : 'text-muted'}`}>
                          {task.due_date ? (
                            <>
                              {formatDate(task.due_date)}
                              <span className="block">{relativeDayLabel(task.due_date, today)}</span>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="w-32 px-4 py-3">
                          <ProgressBar value={taskProgressPercent(task)} showLabel />
                        </td>
                        <td className="px-4 py-3">
                          <PriorityChip priority={task.priority} />
                        </td>
                        <td className="px-4 py-3">
                          <StatusChip status={task.status} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
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
