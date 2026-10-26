import type { PriorityLevel, ProjectStatus, TaskStatus, UserRole } from './types'

export const PRIORITY_META: Record<
  PriorityLevel,
  { label: string; fg: string; bg: string }
> = {
  critical: { label: 'Critical', fg: 'text-critical', bg: 'bg-critical-soft' },
  high: { label: 'High', fg: 'text-high', bg: 'bg-high-soft' },
  medium: { label: 'Medium', fg: 'text-medium', bg: 'bg-medium-soft' },
  low: { label: 'Low', fg: 'text-low', bg: 'bg-low-soft' },
}

// Tailwind cannot see dynamically-composed class names, so priority/status
// colours are mapped through complete class strings.
export const PRIORITY_CHIP: Record<PriorityLevel, string> = {
  critical: 'bg-critical-soft text-critical',
  high: 'bg-high-soft text-high',
  medium: 'bg-medium-soft text-medium',
  low: 'bg-low-soft text-low',
}

export const STATUS_META: Record<TaskStatus, { label: string; chip: string }> = {
  not_started: { label: 'Not Started', chip: 'bg-slate-soft text-muted' },
  in_progress: { label: 'In Progress', chip: 'bg-indigo-soft text-indigo' },
  on_hold: { label: 'On Hold', chip: 'bg-amber-soft text-amber' },
  blocked: { label: 'Blocked', chip: 'bg-rose-soft text-rose' },
  completed: { label: 'Completed', chip: 'bg-success-soft text-success' },
  cancelled: { label: 'Cancelled', chip: 'bg-slate-soft text-muted' },
}

export const PROJECT_STATUS_META: Record<ProjectStatus, { label: string; chip: string }> = {
  planning: { label: 'Planning', chip: 'bg-slate-soft text-muted' },
  not_started: { label: 'Not Started', chip: 'bg-slate-soft text-muted' },
  in_progress: { label: 'In Progress', chip: 'bg-indigo-soft text-indigo' },
  on_hold: { label: 'On Hold', chip: 'bg-amber-soft text-amber' },
  at_risk: { label: 'At Risk', chip: 'bg-rose-soft text-rose' },
  completed: { label: 'Completed', chip: 'bg-success-soft text-success' },
  cancelled: { label: 'Cancelled', chip: 'bg-slate-soft text-muted' },
}

export const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Business Owner',
  manager: 'Manager',
  employee: 'Employee',
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')
}

const AVATAR_COLORS = [
  'bg-indigo text-white',
  'bg-magenta text-white',
  'bg-[#0f766e] text-white',
  'bg-[#b45309] text-white',
  'bg-[#1d4ed8] text-white',
  'bg-[#be123c] text-white',
]

export function avatarColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 100000
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!
}

export function formatHours(value: number | null | undefined): string {
  const n = Number(value ?? 0)
  if (Number.isInteger(n)) return `${n}h`
  return `${n.toFixed(1)}h`
}

export function taskProgressPercent(task: { status: TaskStatus; progress: number }): number {
  if (task.status === 'completed') return 100
  return Math.max(0, Math.min(100, task.progress))
}

/** Remaining effort: estimated_hours x (1 - progress/100). */
export function remainingHours(task: {
  estimated_hours: number | null
  progress: number
  status: TaskStatus
}): number {
  if (task.status === 'completed') return 0
  if (task.status === 'cancelled') return 0
  const estimated = Number(task.estimated_hours ?? 0)
  const progress = Math.max(0, Math.min(100, task.progress))
  return estimated * (1 - progress / 100)
}
