import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Milestone, Task } from '../lib/types'
import { PRIORITY_CHIP, formatHours, taskProgressPercent } from '../lib/format'
import {
  daysInMonth,
  formatDate,
  isOverdue,
  monthStart,
  addDays,
  todayIso,
  weekdayIndex,
} from '../lib/time'
import { EmptyState, PriorityChip, Spinner, StatusChip } from '../components/ui'
import { TaskDetailPanel } from '../components/TaskDetailPanel'
import { ChevronLeftIcon, ChevronRightIcon } from '../components/icons'

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function CalendarPage() {
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [cursor, setCursor] = useState(() => `${todayIso().slice(0, 7)}-01`)
  const [selectedDay, setSelectedDay] = useState<string | null>(todayIso())
  const [openTask, setOpenTask] = useState<Task | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [taskResult, milestoneResult] = await Promise.all([
        supabase
          .from('tasks')
          .select('*')
          .not('due_date', 'is', null)
          .order('due_date', { ascending: true }),
        supabase.from('milestones').select('*').not('due_date', 'is', null),
      ])
      if (cancelled) return
      if (taskResult.error) setError(taskResult.error.message)
      setTasks((taskResult.data as Task[] | null) ?? [])
      setMilestones((milestoneResult.data as Milestone[] | null) ?? [])
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const today = todayIso()

  const grid = useMemo(() => {
    const start = monthStart(cursor)
    const total = daysInMonth(start)
    const firstWeekday = weekdayIndex(start) // 0 = Sunday
    const leading = firstWeekday === 0 ? 6 : firstWeekday - 1 // Monday-first grid
    const cells: (string | null)[] = Array.from({ length: leading }, () => null)
    for (let day = 1; day <= total; day += 1) {
      cells.push(`${start.slice(0, 7)}-${String(day).padStart(2, '0')}`)
    }
    while (cells.length % 7 !== 0) cells.push(null)
    return cells
  }, [cursor])

  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const t of tasks ?? []) {
      if (!t.due_date) continue
      const list = map.get(t.due_date) ?? []
      list.push(t)
      map.set(t.due_date, list)
    }
    return map
  }, [tasks])

  const milestonesByDay = useMemo(() => {
    const map = new Map<string, Milestone[]>()
    for (const m of milestones) {
      if (!m.due_date) continue
      const list = map.get(m.due_date) ?? []
      list.push(m)
      map.set(m.due_date, list)
    }
    return map
  }, [milestones])

  const dayTasks = selectedDay ? (tasksByDay.get(selectedDay) ?? []) : []
  const dayMilestones = selectedDay ? (milestonesByDay.get(selectedDay) ?? []) : []

  if (!tasks) {
    return (
      <div className="px-4 py-6">
        <Spinner label="Loading calendar…" />
      </div>
    )
  }

  const monthLabel = new Intl.DateTimeFormat('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${cursor}T00:00:00Z`))

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 lg:px-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Calendar</h2>
          <p className="mt-1 text-sm text-muted">Task due dates and project milestones</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="qb-btn qb-btn-secondary size-9 !p-0"
            aria-label="Previous month"
            onClick={() => setCursor(monthStart(addDays(monthStart(cursor), -1)))}
            data-testid="cal-prev"
          >
            <ChevronLeftIcon />
          </button>
          <span className="w-36 text-center font-heading text-sm font-semibold" data-testid="cal-month">
            {monthLabel}
          </span>
          <button
            type="button"
            className="qb-btn qb-btn-secondary size-9 !p-0"
            aria-label="Next month"
            onClick={() => setCursor(monthStart(addDays(`${cursor.slice(0, 7)}-28`, 15)))}
            data-testid="cal-next"
          >
            <ChevronRightIcon />
          </button>
          <button
            type="button"
            className="qb-btn qb-btn-secondary !py-1.5 text-xs"
            onClick={() => {
              setCursor(`${today.slice(0, 7)}-01`)
              setSelectedDay(today)
            }}
          >
            Today
          </button>
        </div>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose" role="alert">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="qb-card overflow-hidden lg:col-span-2">
          <div className="grid grid-cols-7 border-b border-line bg-bg">
            {WEEKDAY_LABELS.map((d) => (
              <div key={d} className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {grid.map((date, i) => {
              if (!date) return <div key={`empty-${i}`} className="min-h-24 border-b border-r border-line bg-bg/40" />
              const dayTasksList = tasksByDay.get(date) ?? []
              const dayMs = milestonesByDay.get(date) ?? []
              const isToday = date === today
              const isSelected = date === selectedDay
              const outside = date.slice(0, 7) !== cursor.slice(0, 7)
              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => setSelectedDay(date)}
                  className={`min-h-24 border-b border-r border-line p-1.5 text-left transition-colors ${
                    isSelected ? 'bg-indigo-soft/70' : 'hover:bg-bg'
                  } ${outside ? 'opacity-40' : ''}`}
                  data-testid={`cal-day-${date}`}
                >
                  <span
                    className={`inline-flex size-6 items-center justify-center rounded-full text-xs ${
                      isToday ? 'bg-indigo font-bold text-white' : 'text-muted'
                    }`}
                  >
                    {Number(date.slice(8))}
                  </span>

                  <div className="mt-1 space-y-0.5">
                    {dayTasksList.slice(0, 2).map((t) => (
                      <span
                        key={t.id}
                        className={`block truncate rounded px-1 text-[10px] font-medium leading-4 ${
                          t.status === 'completed'
                            ? 'bg-success-soft text-success'
                            : isOverdue(t.due_date, t.status)
                              ? 'bg-rose-soft text-rose'
                              : PRIORITY_CHIP[t.priority]
                        }`}
                        title={t.title}
                      >
                        {t.title}
                      </span>
                    ))}
                    {dayTasksList.length > 2 ? (
                      <span className="block text-[10px] text-muted">+{dayTasksList.length - 2} more</span>
                    ) : null}
                    {dayMs.slice(0, 1).map((m) => (
                      <span
                        key={m.id}
                        className={`block truncate rounded px-1 text-[10px] font-semibold leading-4 ${
                          m.completed_at ? 'bg-slate-soft text-muted line-through' : 'bg-magenta-soft text-magenta'
                        }`}
                        title={`Milestone: ${m.title}`}
                      >
                        ◆ {m.title}
                      </span>
                    ))}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <aside className="qb-card h-fit p-4">
          <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">
            {selectedDay ? formatDate(selectedDay) : 'Select a day'}
          </h3>

          {dayMilestones.length > 0 ? (
            <ul className="mb-3 space-y-1.5">
              {dayMilestones.map((m) => (
                <li key={m.id} className="rounded-lg bg-magenta-soft px-2.5 py-1.5 text-sm text-magenta">
                  ◆ {m.title}
                  {m.completed_at ? ' ✓' : ''}
                </li>
              ))}
            </ul>
          ) : null}

          {dayTasks.length === 0 && dayMilestones.length === 0 ? (
            <EmptyState title="Nothing due" description="No tasks or milestones on this day." />
          ) : dayTasks.length === 0 ? (
            <p className="text-sm text-muted">Only milestones on this day.</p>
          ) : (
            <ul className="space-y-2">
              {dayTasks.map((t) => (
                <li
                  key={t.id}
                  className="cursor-pointer rounded-lg border border-line p-2.5 hover:border-indigo/50"
                  onClick={() => setOpenTask(t)}
                  data-testid={`cal-task-${t.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium leading-snug">{t.title}</p>
                    <PriorityChip priority={t.priority} />
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-xs text-muted">
                    <StatusChip status={t.status} />
                    {t.estimated_hours ? <span>{formatHours(t.estimated_hours)}</span> : null}
                    <span>{taskProgressPercent(t)}%</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
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
