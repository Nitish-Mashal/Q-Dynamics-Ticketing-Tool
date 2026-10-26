import { useMemo, useState } from 'react'
import { Dialog } from './ui'
import { useAuth } from '../lib/auth-context'
import { useDirectory, createTask, updateTask, TaskApiError } from '../lib/tasks'
import type { PriorityLevel, Project, Task, TaskStatus } from '../lib/types'
import { OPEN_TASK_STATUSES, PRIORITIES, TASK_STATUSES } from '../lib/types'
import { PRIORITY_META, STATUS_META } from '../lib/format'

interface TaskFormProps {
  open: boolean
  onClose: () => void
  /** When set, the form edits this task instead of creating one. */
  task?: Task | null
  /** Preselected project for creation (e.g. from a project page). */
  defaultProjectId?: string | null
  /** Called with the saved task. */
  onSaved?: (task: Task) => void
}

interface FormState {
  title: string
  description: string
  project_id: string
  assignee_id: string
  reviewer_id: string
  priority: PriorityLevel
  status: TaskStatus
  category: string
  tags: string
  start_date: string
  due_date: string
  start_time: string
  end_time: string
  estimated_hours: string
  progress: string
  expected_deliverable: string
  blocker_note: string
  recurrence_kind: 'none' | 'daily' | 'weekly' | 'monthly'
}

function toFormState(task: Task | null | undefined, fallback: Partial<FormState>): FormState {
  return {
    title: task?.title ?? '',
    description: task?.description ?? '',
    project_id: task?.project_id ?? fallback.project_id ?? '',
    assignee_id: task?.assignee_id ?? fallback.assignee_id ?? '',
    reviewer_id: task?.reviewer_id ?? '',
    priority: task?.priority ?? 'medium',
    status: task?.status ?? 'not_started',
    category: task?.category ?? '',
    tags: (task?.tags ?? []).join(', '),
    start_date: task?.start_date ?? '',
    due_date: task?.due_date ?? '',
    start_time: task?.start_time ?? '',
    end_time: task?.end_time ?? '',
    estimated_hours: task?.estimated_hours != null ? String(task.estimated_hours) : '',
    progress: String(task?.progress ?? 0),
    expected_deliverable: task?.expected_deliverable ?? '',
    blocker_note: task?.blocker_note ?? '',
    recurrence_kind:
      task?.recurrence && ['daily', 'weekly', 'monthly'].includes(task.recurrence.kind)
        ? (task.recurrence.kind as 'daily' | 'weekly' | 'monthly')
        : 'none',
  }
}

export function TaskForm({ open, onClose, task, defaultProjectId, onSaved }: TaskFormProps) {
  const { profile } = useAuth()
  const { profiles, projects, loading } = useDirectory()
  const isEdit = Boolean(task)
  const [form, setForm] = useState<FormState>(() => toFormState(task, { project_id: defaultProjectId ?? '' }))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const me = profile
  const isEmployee = me?.role === 'employee'
  const personalSelected = isEdit ? task!.project_id === null : form.project_id === ''

  // Employees may only create for themselves; admins/managers pick freely.
  const assigneeLocked = isEmployee || personalSelected

  const visibleProjects: Project[] = useMemo(() => projects, [projects])

  const canSubmit =
    form.title.trim().length > 0 &&
    form.assignee_id.length > 0 &&
    (!personalSelected || !isEmployee || form.assignee_id === me?.id)

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function submit() {
    if (!profile) return
    setBusy(true)
    setError(null)

    const base = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      project_id: form.project_id || null,
      assignee_id: form.assignee_id,
      reviewer_id: form.reviewer_id || null,
      priority: form.priority,
      status: form.status,
      category: form.category.trim() || null,
      tags: form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      start_date: form.start_date || null,
      due_date: form.due_date || null,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      estimated_hours: form.estimated_hours ? Number(form.estimated_hours) : null,
      progress: Number(form.progress) || 0,
      expected_deliverable: form.expected_deliverable.trim() || null,
      blocker_note: form.status === 'blocked' ? form.blocker_note.trim() || null : null,
      recurrence:
        form.recurrence_kind === 'none'
          ? null
          : { kind: form.recurrence_kind, interval: 1 },
    }

    try {
      const saved = isEdit ? await updateTask(task!.id, base) : await createTask(base)
      setBusy(false)
      onSaved?.(saved)
      onClose()
      if (!isEdit) setForm(toFormState(null, { project_id: defaultProjectId ?? '' }))
    } catch (err) {
      setBusy(false)
      setError(err instanceof TaskApiError ? err.message : 'Unexpected error.')
    }
  }

  return (
    <Dialog
      open={open}
      title={isEdit ? 'Edit task' : 'New task'}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="qb-btn qb-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="qb-btn qb-btn-primary"
            disabled={!canSubmit || busy}
            onClick={() => void submit()}
            data-testid="task-form-submit"
          >
            {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create task'}
          </button>
        </>
      }
    >
      {loading ? <p className="text-sm text-muted">Loading directory…</p> : null}

      {error ? (
        <p className="mb-3 rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose" role="alert" data-testid="task-form-error">
          {error}
        </p>
      ) : null}

      <div className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Title *</span>
          <input
            className="qb-input"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            maxLength={200}
            required
            data-testid="task-title"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-muted">Description</span>
          <textarea
            className="qb-input min-h-20"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            rows={3}
            data-testid="task-description"
          />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Project</span>
            <select
              className="qb-input"
              value={form.project_id}
              onChange={(e) => set('project_id', e.target.value)}
              disabled={isEdit && !isEmployee ? false : isEdit}
              data-testid="task-project"
            >
              <option value="">{isEmployee ? 'Personal task (only you)' : 'Personal task'}</option>
              {visibleProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.name}
                </option>
              ))}
            </select>
            {personalSelected ? (
              <span className="mt-1 block text-xs text-muted">
                Private — nobody else, including the owner, can see it.
              </span>
            ) : null}
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-muted">Assignee *</span>
            <select
              className="qb-input"
              value={form.assignee_id}
              onChange={(e) => set('assignee_id', e.target.value)}
              disabled={assigneeLocked && Boolean(form.assignee_id)}
              data-testid="task-assignee"
            >
              {!form.assignee_id ? <option value="">Select…</option> : null}
              {profiles
                .filter((p) => (assigneeLocked ? p.id === (isEmployee ? me?.id : form.assignee_id) : true))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              {isEmployee && me && !profiles.some((p) => p.id === me.id) ? (
                <option value={me.id}>{me.full_name}</option>
              ) : null}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-muted">Reviewer</span>
            <select
              className="qb-input"
              value={form.reviewer_id}
              onChange={(e) => set('reviewer_id', e.target.value)}
              disabled={isEmployee}
              data-testid="task-reviewer"
            >
              <option value="">No reviewer</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-muted">Priority</span>
            <select
              className="qb-input"
              value={form.priority}
              onChange={(e) => set('priority', e.target.value as PriorityLevel)}
              data-testid="task-priority"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_META[p].label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-muted">Status</span>
            <select
              className="qb-input"
              value={form.status}
              onChange={(e) => set('status', e.target.value as TaskStatus)}
              data-testid="task-status"
            >
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-muted">Category</span>
            <input
              className="qb-input"
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
              placeholder="Design, Engineering…"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-muted">Tags (comma separated)</span>
            <input
              className="qb-input"
              value={form.tags}
              onChange={(e) => set('tags', e.target.value)}
              placeholder="ui, backend"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-muted">Start date</span>
            <input
              className="qb-input"
              type="date"
              value={form.start_date}
              onChange={(e) => set('start_date', e.target.value)}
              data-testid="task-start-date"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-muted">Due date</span>
            <input
              className="qb-input"
              type="date"
              value={form.due_date}
              onChange={(e) => set('due_date', e.target.value)}
              data-testid="task-due-date"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-muted">Start time</span>
            <input
              className="qb-input"
              type="time"
              value={form.start_time}
              onChange={(e) => set('start_time', e.target.value)}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-muted">End time</span>
            <input
              className="qb-input"
              type="time"
              value={form.end_time}
              onChange={(e) => set('end_time', e.target.value)}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-muted">Estimated hours</span>
            <input
              className="qb-input"
              type="number"
              min={0}
              step={0.5}
              value={form.estimated_hours}
              onChange={(e) => set('estimated_hours', e.target.value)}
              data-testid="task-estimated-hours"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-muted">Progress (%)</span>
            <input
              className="qb-input"
              type="number"
              min={0}
              max={100}
              value={form.progress}
              onChange={(e) => set('progress', e.target.value)}
              data-testid="task-progress"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-muted">Repeats</span>
            <select
              className="qb-input"
              value={form.recurrence_kind}
              onChange={(e) => set('recurrence_kind', e.target.value as FormState['recurrence_kind'])}
              data-testid="task-recurrence"
            >
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
            {form.recurrence_kind !== 'none' ? (
              <span className="mt-1 block text-xs text-muted">
                Completing this task creates the next occurrence automatically.
              </span>
            ) : null}
          </label>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block text-muted">Expected deliverable</span>
          <input
            className="qb-input"
            value={form.expected_deliverable}
            onChange={(e) => set('expected_deliverable', e.target.value)}
            placeholder="What “done” looks like"
          />
        </label>

        {form.status === 'blocked' ? (
          <label className="block text-sm">
            <span className="mb-1 block text-muted">What is blocking this? *</span>
            <input
              className="qb-input"
              value={form.blocker_note}
              onChange={(e) => set('blocker_note', e.target.value)}
              placeholder="Waiting on client content…"
              data-testid="task-blocker"
            />
          </label>
        ) : null}
      </div>
    </Dialog>
  )
}

export { OPEN_TASK_STATUSES }
