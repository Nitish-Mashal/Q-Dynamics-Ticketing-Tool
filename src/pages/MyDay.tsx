import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'
import { updateTask, TaskApiError } from '../lib/tasks'
import type { Task } from '../lib/types'
import { formatHours, taskProgressPercent } from '../lib/format'
import { addDays, isOverdue, relativeDayLabel, todayIso } from '../lib/time'
import { EmptyState, PriorityChip, ProgressBar, Spinner, StatusChip } from '../components/ui'
import { TaskDetailPanel } from '../components/TaskDetailPanel'
import { TaskForm } from '../components/TaskForm'
import { PlusIcon } from '../components/icons'

type Bucket = 'overdue' | 'today' | 'upcoming' | 'progress'

export function MyDayPage() {
  const { profile } = useAuth()
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [openTask, setOpenTask] = useState<Task | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const reload = async () => {
    const { data, error: err } = await supabase
      .from('tasks')
      .select('*')
      .order('due_date', { ascending: true, nullsFirst: false })
    if (err) {
      setError(err.message)
      return
    }
    setTasks((data as Task[] | null) ?? [])
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data, error: err } = await supabase
        .from('tasks')
        .select('*')
        .order('due_date', { ascending: true, nullsFirst: false })
      if (cancelled) return
      if (err) {
        setError(err.message)
        setTasks([])
      } else {
        setTasks((data as Task[] | null) ?? [])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const today = todayIso()
  const horizon = addDays(today, 7)

  const mine = useMemo(() => {
    if (!tasks || !profile) return []
    return tasks.filter(
      (t) =>
        t.assignee_id === profile.id ||
        t.creator_id === profile.id ||
        t.reviewer_id === profile.id,
    )
  }, [tasks, profile])

  const buckets = useMemo(() => {
    const open = mine.filter((t) => ['not_started', 'in_progress', 'on_hold', 'blocked'].includes(t.status))
    const overdue = open.filter((t) => isOverdue(t.due_date, t.status))
    const dueToday = open.filter((t) => t.due_date === today)
    const inProgress = open.filter((t) => t.status === 'in_progress' && t.due_date !== today && !isOverdue(t.due_date, t.status))
    const upcoming = open.filter(
      (t) =>
        t.due_date != null &&
        t.due_date > today &&
        t.due_date <= horizon &&
        t.due_date !== today &&
        !isOverdue(t.due_date, t.status) &&
        t.status !== 'in_progress',
    )
    const doneToday = mine.filter((t) => t.status === 'completed' && t.completed_at?.slice(0, 10) === today)
    return { overdue, dueToday, inProgress, upcoming, doneToday }
  }, [mine, today, horizon])

  async function quickComplete(task: Task) {
    setBusyId(task.id)
    setError(null)
    try {
      await updateTask(task.id, { status: 'completed' })
      const { data } = await supabase.from('tasks').select('*').eq('id', task.id).maybeSingle()
      setTasks((prev) => (prev ?? []).map((t) => (t.id === task.id ? (data as Task) : t)))
      setOpenTask((prev) => (prev?.id === task.id ? (data as Task) : prev))
    } catch (err) {
      setError(err instanceof TaskApiError ? err.message : 'Could not complete the task.')
    } finally {
      setBusyId(null)
    }
  }

  if (!tasks || !profile) {
    return (
      <div className="px-4 py-6">
        <Spinner label="Loading your day…" />
      </div>
    )
  }

  const sections: { key: Bucket; title: string; hint: string; tasks: Task[] }[] = [
    {
      key: 'overdue',
      title: 'Overdue',
      hint: 'Past due — clear these first.',
      tasks: buckets.overdue,
    },
    {
      key: 'today',
      title: 'Due today',
      hint: 'Your commitments for today.',
      tasks: buckets.dueToday,
    },
    {
      key: 'progress',
      title: 'In progress',
      hint: 'Already moving — keep the momentum.',
      tasks: buckets.inProgress,
    },
    {
      key: 'upcoming',
      title: `Next 7 days`,
      hint: 'Coming up soon.',
      tasks: buckets.upcoming,
    },
  ]

  const focusCount = buckets.overdue.length + buckets.dueToday.length

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 lg:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">My Day</h2>
          <p className="mt-1 text-sm text-muted">
            {new Intl.DateTimeFormat('en-IN', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              timeZone: 'Asia/Kolkata',
            }).format(new Date())}
            {' · '}
            <span className={focusCount > 0 ? 'font-semibold text-ink' : ''}>
              {focusCount} to focus on
            </span>
          </p>
        </div>
        <button type="button" className="qb-btn qb-btn-primary" onClick={() => setCreateOpen(true)}>
          <PlusIcon /> New task
        </button>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose" role="alert">
          {error}
        </p>
      ) : null}

      {buckets.doneToday.length > 0 ? (
        <div className="mb-5 rounded-lg border border-line bg-success-soft/60 px-4 py-3">
          <p className="text-sm font-semibold text-success">
            {buckets.doneToday.length} completed today 🎉
          </p>
          <ul className="mt-1 space-y-0.5">
            {buckets.doneToday.map((t) => (
              <li key={t.id} className="text-sm text-success/90">
                ✓ {t.title}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {sections.every((s) => s.tasks.length === 0) && buckets.doneToday.length === 0 ? (
        <EmptyState
          title="Nothing on your plate"
          description="No open tasks are due soon. Enjoy the breathing room, or plan ahead with a new task."
          action={
            <button type="button" className="qb-btn qb-btn-primary" onClick={() => setCreateOpen(true)}>
              <PlusIcon /> New task
            </button>
          }
        />
      ) : (
        sections
          .filter((section) => section.tasks.length > 0)
          .map((section) => (
            <section key={section.key} className="mb-6">
              <div className="mb-2 flex items-baseline gap-2">
                <h3
                  className={`text-sm font-semibold uppercase tracking-wide ${
                    section.key === 'overdue' ? 'text-rose' : 'text-muted'
                  }`}
                >
                  {section.title} ({section.tasks.length})
                </h3>
                <span className="text-xs text-muted">{section.hint}</span>
              </div>

              <ul className="space-y-2">
                {section.tasks.map((task) => {
                  const overdue = isOverdue(task.due_date, task.status)
                  return (
                    <li
                      key={task.id}
                      className="qb-card flex cursor-pointer items-center gap-3 p-3.5 hover:border-indigo/40"
                      onClick={() => setOpenTask(task)}
                      data-testid={`day-task-${task.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{task.title}</p>
                          <PriorityChip priority={task.priority} />
                          <StatusChip status={task.status} />
                        </div>
                        <p className="mt-1 text-xs text-muted">
                          {task.due_date ? (
                            <span className={overdue ? 'font-semibold text-rose' : ''}>
                              {relativeDayLabel(task.due_date, today)}
                            </span>
                          ) : (
                            'No due date'
                          )}
                          {task.estimated_hours ? <> · {formatHours(task.estimated_hours)}</> : null}
                          {task.estimated_hours ? (
                            <>
                              {' · '}
                              {formatHours(
                                task.estimated_hours * (1 - taskProgressPercent(task) / 100),
                              )}{' '}
                              left
                            </>
                          ) : null}
                        </p>
                        <div className="mt-1.5 max-w-56">
                          <ProgressBar
                            value={taskProgressPercent(task)}
                            tone={task.status === 'completed' ? 'success' : 'indigo'}
                          />
                        </div>
                      </div>

                      <button
                        type="button"
                        className="qb-btn qb-btn-secondary !py-1 text-xs"
                        disabled={busyId === task.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          void quickComplete(task)
                        }}
                        data-testid={`complete-${task.id}`}
                      >
                        {busyId === task.id ? '…' : '✓ Done'}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))
      )}

      <TaskDetailPanel
        task={openTask}
        open={openTask !== null}
        onClose={() => {
          setOpenTask(null)
          void reload()
        }}
        onTaskUpdated={(updated) => setOpenTask(updated)}
      />

      <TaskForm
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={(saved) => {
          setCreateOpen(false)
          setOpenTask(saved)
          void reload()
        }}
      />
    </div>
  )
}
