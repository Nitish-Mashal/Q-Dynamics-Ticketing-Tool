export type UserRole = 'admin' | 'manager' | 'employee'
export type PriorityLevel = 'critical' | 'high' | 'medium' | 'low'
export type TaskStatus =
  | 'not_started'
  | 'in_progress'
  | 'on_hold'
  | 'blocked'
  | 'completed'
  | 'cancelled'
export type ProjectStatus =
  | 'planning'
  | 'not_started'
  | 'in_progress'
  | 'on_hold'
  | 'at_risk'
  | 'completed'
  | 'cancelled'
export type ReminderPreference = 'on_due_date' | 'one_day_before' | 'three_days_before'
export type NotificationKind =
  | 'task_assigned'
  | 'task_reassigned'
  | 'priority_changed'
  | 'comment'
  | 'mention'
  | 'blocked'
  | 'awaiting_approval'
  | 'milestone_update'
  | 'due_soon'
  | 'overdue'

export interface Profile {
  id: string
  employee_code: string
  full_name: string
  work_email: string
  department: string | null
  designation: string | null
  reporting_manager_id: string | null
  role: UserRole
  is_active: boolean
  timezone: string
  reminder_preference: ReminderPreference
  created_at: string
}

export interface Project {
  id: string
  code: string
  name: string
  description: string | null
  objectives: string | null
  owner_id: string
  manager_id: string
  category: string | null
  priority: PriorityLevel
  status: ProjectStatus
  start_date: string | null
  target_date: string | null
  budget: number | null
  progress_override: number | null
  progress_override_reason: string | null
  is_archived: boolean
  created_at: string
}

export interface ProjectMember {
  project_id: string
  user_id: string
  responsibility: string | null
}

export interface Milestone {
  id: string
  project_id: string
  title: string
  due_date: string | null
  completed_at: string | null
}

export interface RecurrenceRule {
  kind: 'daily' | 'weekly' | 'monthly' | 'custom'
  interval?: number
  unit?: 'days' | 'weeks' | 'months'
  weekdays?: number[]
  month_day?: number
  end_date?: string | null
}

export interface Task {
  id: string
  project_id: string | null
  parent_task_id: string | null
  title: string
  description: string | null
  category: string | null
  tags: string[]
  priority: PriorityLevel
  status: TaskStatus
  assignee_id: string
  creator_id: string
  reviewer_id: string | null
  assigned_by: string | null
  assigned_at: string | null
  expected_deliverable: string | null
  start_date: string | null
  due_date: string | null
  start_time: string | null
  end_time: string | null
  estimated_hours: number | null
  actual_hours: number | null
  progress: number
  blocker_note: string | null
  completed_at: string | null
  recurrence: RecurrenceRule | null
  is_private: boolean
  created_at: string
  updated_at: string
}

export interface ChecklistItem {
  id: string
  task_id: string
  text: string
  is_done: boolean
  position: number
}

export interface TaskDependency {
  task_id: string
  depends_on_task_id: string
  created_at: string
}

export interface CommentRow {
  id: string
  task_id: string | null
  project_id: string | null
  author_id: string
  body: string
  mentions: string[]
  created_at: string
}

export interface Attachment {
  id: string
  task_id: string | null
  project_id: string | null
  uploader_id: string
  storage_path: string
  file_name: string
  file_size: number | null
  content_type: string | null
  created_at: string
}

export interface ActivityLogEntry {
  id: string
  entity_type: string
  entity_id: string
  actor_id: string | null
  action: string
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  created_at: string
}

export interface NotificationRow {
  id: string
  user_id: string
  task_id: string | null
  project_id: string | null
  kind: NotificationKind
  message: string
  dedupe_key: string
  is_read: boolean
  created_at: string
}

export interface WeeklyReview {
  id: string
  user_id: string
  week_start: string
  accomplishments: string | null
  next_week_priorities: string | null
  manager_notes: string | null
  created_at: string
  updated_at: string
}

export const OPEN_TASK_STATUSES: TaskStatus[] = [
  'not_started',
  'in_progress',
  'on_hold',
  'blocked',
]

export const TASK_STATUSES: TaskStatus[] = [
  'not_started',
  'in_progress',
  'on_hold',
  'blocked',
  'completed',
  'cancelled',
]

export const BOARD_COLUMNS: TaskStatus[] = [
  'not_started',
  'in_progress',
  'on_hold',
  'blocked',
  'completed',
]

export const PRIORITIES: PriorityLevel[] = ['critical', 'high', 'medium', 'low']

export const PROJECT_STATUSES: ProjectStatus[] = [
  'planning',
  'not_started',
  'in_progress',
  'on_hold',
  'at_risk',
  'completed',
  'cancelled',
]
