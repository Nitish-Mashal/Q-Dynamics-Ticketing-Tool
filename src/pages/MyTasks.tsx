import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { TaskApiError, updateTask } from '../lib/tasks'
import type { PriorityLevel, Task, TaskStatus } from '../lib/types'
import { PRIORITIES, TASK_STATUSES } from '../lib/types'
import {
  PRIORITY_META,
  STATUS_META,
  formatHours,
  taskProgressPercent,
} from '../lib/format'
import { formatDate, isOverdue, todayIso, relativeDayLabel, addDays } from '../lib/time'
import { EmptyState, PriorityChip, ProgressBar, Spinner, StatusChip } from '../components/ui'
import { TaskDetailPanel } from '../components/TaskDetailPanel'
import { TaskForm } from '../components/TaskForm'
import { KanbanBoard } from '../components/KanbanBoard'
import { PlusIcon, SearchIcon } from '../components/icons'

type DueFilter = 'all' | 'overdue' | 'today' | 'week' | 'none'
type ViewMode = 'list' | 'board'

export function MyTasksPage() {
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openTask, setOpenTask] = useState<Task | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'open' | 'all'>('all')
  const [priorityFilter, setPriorityFilter] = useState<PriorityLevel | 'all'>('all')
  const [dueFilter, setDueFilter] = useState<DueFilter>('all')
  const [view, setView] = useState<ViewMode>('list')

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('tasks')
      .select('*')
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('priority', { ascending: false })
    if (err) {
      setError(err.message)
      setTasks([])
      return
    }
    setTasks((data as Task[] | null) ?? [])
    setError(null)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data, error: err } = await supabase
        .from('tasks')
        .select('*')
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('priority', { ascending: false })
      if (cancelled) return
      if (err) {
        setError(err.message)
        setTasks([])
      } else {
        setTasks((data as Task[] | null) ?? [])
        setError(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    if (!tasks) return []
    const today = todayIso()
    const weekEnd = addDays(today, 7)
    const q = search.trim().toLowerCase()
    return tasks.filter((task) => {
      if (q && !task.title.toLowerCase().includes(q) && !(task.description ?? '').toLowerCase().includes(q)) {
        return false
      }
      if (statusFilter === 'open' && !['not_started', 'in_progress', 'on_hold', 'blocked'].includes(task.status)) {
        return false
      }
      if (statusFilter !== 'all' && statusFilter !== 'open' && task.status !== statusFilter) return false
      if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false
      if (dueFilter === 'overdue' && !isOverdue(task.due_date, task.status)) return false
      if (dueFilter === 'today' && task.due_date !== today) return false
      if (dueFilter === 'week' && !(task.due_date && task.due_date >= today && task.due_date <= weekEnd)) return false
      if (dueFilter === 'none' && task.due_date) return false
      return true
    })
  }, [tasks, search, statusFilter, priorityFilter, dueFilter])

  const openCount = useMemo(
    () => (tasks ?? []).filter((t) => ['not_started', 'in_progress', 'on_hold', 'blocked'].includes(t.status)).length,
    [tasks],
  )

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelected((prev) =>
      prev.size === filtered.length ? new Set() : new Set(filtered.map((t) => t.id)),
    )
  }

  async function bulkStatus(status: TaskStatus) {
    if (selected.size === 0) return
    setBusy(true)
    setError(null)
    try {
      for (const id of selected) {
        await updateTask(id, { status })
      }
      setSelected(new Set())
      await load()
    } catch (err) {
      setError(err instanceof TaskApiError ? err.message : 'Bulk update failed.')
    } finally {
      setBusy(false)
    }
  }

  async function onCreated(task: Task) {
    await load()
    setOpenTask(task)
  }

  if (!tasks) {
    return (
      <div className="px-4 py-6">
        <Spinner label="Loading your tasks…" />
      </div>
    )
  }

  const today = todayIso()

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 lg:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">My Tasks</h2>
          <p className="mt-1 text-sm text-muted">
            {openCount} open · {tasks.length} total visible to you
          </p>
        </div>
        <button
          type="button"
          className="qb-btn qb-btn-primary"
          onClick={() => setCreateOpen(true)}
          data-testid="new-task"
        >
          <PlusIcon /> New task
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="relative">
          <span className="sr-only">Search tasks</span>
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            className="qb-input w-56 !pl-9"
            placeholder="Search title or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="task-search"
          />
        </label>

        <select
          className="qb-input w-40"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="open">Open only</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </select>

        <select
          className="qb-input w-36"
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as typeof priorityFilter)}
          aria-label="Filter by priority"
        >
          <option value="all">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_META[p].label}
            </option>
          ))}
        </select>

        <select
          className="qb-input w-40"
          value={dueFilter}
          onChange={(e) => setDueFilter(e.target.value as DueFilter)}
          aria-label="Filter by due date"
        >
          <option value="all">Any due date</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due today</option>
          <option value="week">Next 7 days</option>
          <option value="none">No due date</option>
        </select>

        <div className="ml-auto flex overflow-hidden rounded-lg border border-line">
          {(['list', 'board'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`px-3 py-1.5 text-xs font-semibold capitalize ${
                view === mode ? 'bg-indigo text-white' : 'bg-card text-muted hover:bg-bg'
              }`}
              onClick={() => setView(mode)}
              data-testid={`view-${mode}`}
            >
              {mode === 'list' ? 'List' : 'Board'}
            </button>
          ))}
        </div>
      </div>

      {selected.size > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card px-3 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <button
            type="button"
            className="qb-btn qb-btn-secondary !py-1 text-xs"
            disabled={busy}
            onClick={() => void bulkStatus('in_progress')}
            data-testid="bulk-in-progress"
          >
            Mark in progress
          </button>
          <button
            type="button"
            className="qb-btn qb-btn-secondary !py-1 text-xs"
            disabled={busy}
            onClick={() => void bulkStatus('completed')}
            data-testid="bulk-complete"
          >
            Mark completed
          </button>
          <button
            type="button"
            className="qb-btn qb-btn-ghost !py-1 text-xs"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="mb-4 rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose" role="alert">
          {error}
        </p>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState
          title="No tasks match"
          description="Adjust the filters, or create a new task to get started."
          action={
            <button type="button" className="qb-btn qb-btn-primary" onClick={() => setCreateOpen(true)}>
              <PlusIcon /> New task
            </button>
          }
        />
      ) : view === 'board' ? (
        <KanbanBoard
          tasks={filtered}
          onTaskClick={(t) => setOpenTask(t)}
          onTasksChanged={() => void load()}
        />
      ) : (
        <div className="qb-card overflow-hidden">
          <div className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={selected.size === filtered.length && filtered.length > 0}
              onChange={toggleSelectAll}
              aria-label="Select all"
              className="size-4 accent-[#4F46E5]"
            />
            <span className="flex-1">Task</span>
            <span className="hidden w-28 sm:block">Due</span>
            <span className="hidden w-32 md:block">Progress</span>
            <span className="hidden w-24 lg:block">Priority</span>
            <span className="hidden w-28 lg:block">Status</span>
          </div>

          <ul>
            {filtered.map((task) => {
              const overdue = isOverdue(task.due_date, task.status)
              return (
                <li
                  key={task.id}
                  className="flex cursor-pointer items-center gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-bg"
                  onClick={() => setOpenTask(task)}
                  data-testid={`task-row-${task.id}`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(task.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleSelect(task.id)}
                    aria-label={`Select ${task.title}`}
                    className="size-4 accent-[#4F46E5]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{task.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                      {task.project_id ? (
                        <span className="qb-chip bg-indigo-soft text-indigo">Project</span>
                      ) : (
                        <span className="qb-chip bg-magenta-soft text-magenta">Personal</span>
                      )}
                      {task.estimated_hours ? <span>{formatHours(task.estimated_hours)}</span> : null}
                      {task.due_date ? (
                        <span className={overdue ? 'font-semibold text-rose' : ''}>
                          {relativeDayLabel(task.due_date, today)}
                        </span>
                      ) : (
                        <span>No due date</span>
                      )}
                    </p>
                  </div>

                  <span
                    className={`hidden w-28 text-xs sm:block ${overdue ? 'font-semibold text-rose' : 'text-muted'}`}
                  >
                    {task.due_date ? formatDate(task.due_date) : '—'}
                  </span>

                  <span className="hidden w-32 md:block">
                    <ProgressBar
                      value={taskProgressPercent(task)}
                      tone={task.status === 'completed' ? 'success' : 'indigo'}
                    />
                  </span>

                  <span className="hidden w-24 lg:block">
                    <PriorityChip priority={task.priority} />
                  </span>

                  <span className="hidden w-28 lg:block">
                    <StatusChip status={task.status} />
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <TaskDetailPanel
        task={openTask}
        open={openTask !== null}
        onClose={() => {
          setOpenTask(null)
          void load()
        }}
        onTaskUpdated={(updated) => {
          setOpenTask(updated)
          void load()
        }}
      />

      <TaskForm
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={(saved) => void onCreated(saved)}
      />
    </div>
  )
}
