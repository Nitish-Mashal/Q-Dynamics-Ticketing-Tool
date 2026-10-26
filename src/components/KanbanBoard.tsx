import { useState } from 'react'
import type { Task, TaskStatus } from '../lib/types'
import { BOARD_COLUMNS } from '../lib/types'
import { STATUS_META, formatHours, taskProgressPercent } from '../lib/format'
import { isOverdue, relativeDayLabel, todayIso } from '../lib/time'
import { PriorityChip, ProgressBar } from './ui'
import { updateTask, TaskApiError } from '../lib/tasks'

interface KanbanBoardProps {
  tasks: Task[]
  onTaskClick: (task: Task) => void
  onTasksChanged: () => void
}

export function KanbanBoard({ tasks, onTaskClick, onTasksChanged }: KanbanBoardProps) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropColumn, setDropColumn] = useState<TaskStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const byColumn = new Map<TaskStatus, Task[]>(BOARD_COLUMNS.map((c) => [c, []]))
  for (const task of tasks) {
    const list = byColumn.get(task.status)
    if (list) list.push(task)
  }

  async function moveTo(task: Task, status: TaskStatus) {
    if (task.status === status) return
    setBusy(true)
    setError(null)
    try {
      await updateTask(task.id, { status })
      onTasksChanged()
    } catch (err) {
      setError(err instanceof TaskApiError ? err.message : 'Could not move the task.')
    } finally {
      setBusy(false)
      setDragId(null)
      setDropColumn(null)
    }
  }

  const today = todayIso()

  return (
    <div>
      {error ? (
        <p className="mb-3 rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose" role="alert">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {BOARD_COLUMNS.map((status) => {
          const list = byColumn.get(status) ?? []
          const meta = STATUS_META[status]
          return (
            <div
              key={status}
              className={`flex min-h-40 flex-col rounded-xl border p-2.5 transition-colors ${
                dropColumn === status ? 'border-indigo bg-indigo-soft/50' : 'border-line bg-card'
              }`}
              data-testid={`kanban-column-${status}`}
              onDragOver={(e) => {
                e.preventDefault()
                setDropColumn(status)
              }}
              onDragLeave={() => setDropColumn((prev) => (prev === status ? null : prev))}
              onDrop={(e) => {
                e.preventDefault()
                const id = e.dataTransfer.getData('text/plain') || dragId
                const task = tasks.find((t) => t.id === id)
                if (task) void moveTo(task, status)
                setDropColumn(null)
              }}
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <span className={`qb-chip ${meta.chip}`}>{meta.label}</span>
                <span className="text-xs font-semibold text-muted">{list.length}</span>
              </div>

              <ul className="flex-1 space-y-2">
                {list.map((task) => {
                  const overdue = isOverdue(task.due_date, task.status)
                  return (
                    <li
                      key={task.id}
                      draggable={!busy}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', task.id)
                        e.dataTransfer.effectAllowed = 'move'
                        setDragId(task.id)
                      }}
                      onDragEnd={() => {
                        setDragId(null)
                        setDropColumn(null)
                      }}
                      onClick={() => onTaskClick(task)}
                      className={`cursor-grab rounded-lg border border-line bg-card p-2.5 text-sm shadow-sm transition hover:border-indigo/50 active:cursor-grabbing ${
                        dragId === task.id ? 'opacity-50' : ''
                      }`}
                      data-testid={`kanban-card-${task.id}`}
                    >
                      <p className="font-medium leading-snug">{task.title}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <PriorityChip priority={task.priority} />
                        {task.estimated_hours ? (
                          <span className="text-[11px] text-muted">{formatHours(task.estimated_hours)}</span>
                        ) : null}
                        {task.due_date ? (
                          <span
                            className={`text-[11px] ${overdue ? 'font-semibold text-rose' : 'text-muted'}`}
                          >
                            {relativeDayLabel(task.due_date, today)}
                          </span>
                        ) : null}
                      </div>
                      {task.status !== 'completed' && task.estimated_hours ? (
                        <div className="mt-1.5">
                          <ProgressBar value={taskProgressPercent(task)} />
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}
