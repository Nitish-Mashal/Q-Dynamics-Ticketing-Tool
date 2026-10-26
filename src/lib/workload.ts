import { OPEN_TASK_STATUSES } from './types'
import type { Task } from './types'
import { addDays, todayIso } from './time'
import { remainingHours } from './format'

export const WORKLOAD_WINDOW_DAYS = 7
export const CAPACITY_HOURS = 40

export type WorkloadLevel = 'none' | 'ok' | 'amber' | 'red'

export interface WorkloadRow {
  userId: string
  hours: number
  level: WorkloadLevel
}

/** Remaining hours due within the next 7 days for a single person. */
export function hoursDueSoon(
  tasks: Pick<Task, 'assignee_id' | 'estimated_hours' | 'progress' | 'status' | 'due_date'>[],
  userId: string,
  today = todayIso(),
): number {
  const horizon = addDays(today, WORKLOAD_WINDOW_DAYS)
  return tasks
    .filter(
      (t) =>
        t.assignee_id === userId &&
        t.due_date != null &&
        t.due_date >= today &&
        t.due_date <= horizon &&
        OPEN_TASK_STATUSES.includes(t.status),
    )
    .reduce((sum, t) => sum + remainingHours(t), 0)
}

export function workloadLevel(hours: number): WorkloadLevel {
  if (hours <= 0) return 'none'
  if (hours > CAPACITY_HOURS) return 'red'
  if (hours > CAPACITY_HOURS * 0.8) return 'amber'
  return 'ok'
}

export function workloadBarTone(level: WorkloadLevel): 'rose' | 'amber' | 'indigo' {
  if (level === 'red') return 'rose'
  if (level === 'amber') return 'amber'
  return 'indigo'
}

export function computeWorkloads(
  tasks: Pick<Task, 'assignee_id' | 'estimated_hours' | 'progress' | 'status' | 'due_date'>[],
  userIds: string[],
  today = todayIso(),
): WorkloadRow[] {
  return userIds.map((userId) => {
    const hours = Math.round(hoursDueSoon(tasks, userId, today) * 10) / 10
    return { userId, hours, level: workloadLevel(hours) }
  })
}
