import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'
import { updateTask, TaskApiError } from '../lib/tasks'
import type { ChecklistItem, PriorityLevel, Task, TaskStatus } from '../lib/types'
import { PRIORITIES, TASK_STATUSES } from '../lib/types'
import { PRIORITY_META, STATUS_META, formatHours } from '../lib/format'
import { formatDate, formatClockTime, formatDateTime, isOverdue } from '../lib/time'
import { Avatar, Dialog, PriorityChip, ProgressBar, StatusChip } from './ui'
import { TaskForm } from './TaskForm'

interface ActivityRow {
  id: string
  actor_id: string | null
  action: string
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  created_at: string
}

interface CommentRow {
  id: string
  task_id: string | null
  author_id: string
  body: string
  mentions: string[]
  created_at: string
}

interface PanelProps {
  task: Task | null
  open: boolean
  onClose: () => void
  onTaskUpdated?: (task: Task) => void
}

const ACTIVITY_LABELS: Record<string, string> = {
  task_created: 'created this task',
  task_title_changed: 'changed the title',
  task_status_changed: 'changed the status',
  task_priority_changed: 'changed the priority',
  task_assignee_changed: 'reassigned the task',
  task_due_date_changed: 'changed the due date',
  task_progress_changed: 'updated progress',
  task_estimated_hours_changed: 'changed the estimate',
  task_completed: 'completed the task',
}

export function TaskDetailPanel({ task, open, onClose, onTaskUpdated }: PanelProps) {
  const { profile } = useAuth()
  const [local, setLocal] = useState<Task | null>(task)
  const [syncedTask, setSyncedTask] = useState<Task | null>(task ?? null)
  const [checklist, setChecklist] = useState<ChecklistItem[]>([])
  const [activity, setActivity] = useState<ActivityRow[]>([])
  const [comments, setComments] = useState<CommentRow[]>([])
  const [commentAuthors, setCommentAuthors] = useState<Map<string, string>>(new Map())
  const [profiles, setProfiles] = useState<{ id: string; full_name: string }[]>([])
  const [newItem, setNewItem] = useState('')
  const [newComment, setNewComment] = useState('')
  const [editingComment, setEditingComment] = useState<string | null>(null)
  const [editCommentBody, setEditCommentBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // Re-sync panel state when the parent swaps the selected task.
  if (task !== syncedTask) {
    setSyncedTask(task)
    setLocal(task)
    setError(null)
  }

  const taskId = local?.id

  const fetchSideData = useCallback(async () => {
    if (!taskId) return null
    const [itemsResult, activityResult, commentResult, allPeopleResult] = await Promise.all([
      supabase.from('checklist_items').select('*').eq('task_id', taskId).order('position'),
      supabase
        .from('activity_log')
        .select('id, actor_id, action, old_value, new_value, created_at')
        .eq('entity_type', 'task')
        .eq('entity_id', taskId)
        .order('created_at', { ascending: false })
        .limit(15),
      supabase
        .from('comments')
        .select('*')
        .eq('task_id', taskId)
        .order('created_at', { ascending: true }),
      supabase.from('profiles').select('id, full_name').order('full_name'),
    ])
    const commentRows = (commentResult.data as CommentRow[] | null) ?? []
    const authorIds = [...new Set(commentRows.map((c) => c.author_id))]
    let authors = new Map<string, string>()
    if (authorIds.length > 0) {
      const { data: people } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', authorIds)
      authors = new Map(
        (people as { id: string; full_name: string }[] | null)?.map((p) => [p.id, p.full_name]) ?? [],
      )
    }
    return {
      items: (itemsResult.data as ChecklistItem[] | null) ?? [],
      activity: (activityResult.data as ActivityRow[] | null) ?? [],
      comments: commentRows,
      authors,
      profiles: (allPeopleResult.data as { id: string; full_name: string }[] | null) ?? [],
    }
  }, [taskId])

  const applySideData = useCallback(
    (data: NonNullable<Awaited<ReturnType<typeof fetchSideData>>>) => {
      setChecklist(data.items)
      setActivity(data.activity)
      setComments(data.comments)
      setCommentAuthors(data.authors)
      setProfiles(data.profiles)
    },
    [],
  )

  const loadSideData = useCallback(async () => {
    const data = await fetchSideData()
    if (data) applySideData(data)
    else {
      setChecklist([])
      setActivity([])
      setComments([])
    }
  }, [fetchSideData, applySideData])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const data = await fetchSideData()
      if (cancelled) return
      if (data) applySideData(data)
      else {
        setChecklist([])
        setActivity([])
        setComments([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [fetchSideData, applySideData])

  function parseMentions(body: string): string[] {
    const found = new Set<string>()
    for (const match of body.matchAll(/@([\w.-]+)/g)) {
      const token = match[1]!.toLowerCase()
      for (const p of profiles) {
        const first = p.full_name.split(/\s+/)[0]?.toLowerCase()
        const full = p.full_name.toLowerCase().replace(/\s+/g, '')
        if (token === first || token === full || token === p.id) found.add(p.id)
      }
    }
    return [...found]
  }

  async function addComment() {
    const body = newComment.trim()
    if (!local || !profile || !body) return
    const { error: err } = await supabase.from('comments').insert({
      task_id: local.id,
      author_id: profile.id,
      body,
      mentions: parseMentions(body),
    })
    if (err) {
      setError(err.message)
      return
    }
    setNewComment('')
    await loadSideData()
  }

  async function saveEditedComment(id: string) {
    const body = editCommentBody.trim()
    if (!body) return
    const { error: err } = await supabase
      .from('comments')
      .update({ body, mentions: parseMentions(body) })
      .eq('id', id)
      .select()
    if (err) setError(err.message)
    else {
      setEditingComment(null)
      await loadSideData()
    }
  }

  async function removeComment(id: string) {
    const { error: err } = await supabase.from('comments').delete().eq('id', id)
    if (err) setError(err.message)
    else await loadSideData()
  }

  async function patch(fields: Partial<Task>) {
    if (!local) return
    setBusy(true)
    setError(null)
    try {
      const saved = await updateTask(local.id, fields)
      setLocal(saved)
      onTaskUpdated?.(saved)
      await loadSideData()
    } catch (err) {
      setError(err instanceof TaskApiError ? err.message : 'Could not save changes.')
    } finally {
      setBusy(false)
    }
  }

  async function addChecklistItem() {
    const text = newItem.trim()
    if (!local || !text) return
    const { error: err } = await supabase
      .from('checklist_items')
      .insert({ task_id: local.id, text, position: checklist.length })
    if (err) {
      setError(err.message)
      return
    }
    setNewItem('')
    await loadSideData()
  }

  async function toggleChecklist(item: ChecklistItem) {
    const { error: err } = await supabase
      .from('checklist_items')
      .update({ is_done: !item.is_done })
      .eq('id', item.id)
      .select()
    if (err) setError(err.message)
    else await loadSideData()
  }

  async function removeChecklistItem(item: ChecklistItem) {
    const { error: err } = await supabase.from('checklist_items').delete().eq('id', item.id)
    if (err) setError(err.message)
    else await loadSideData()
  }

  async function removeTask() {
    if (!local) return
    setBusy(true)
    const { error: err } = await supabase.from('tasks').delete().eq('id', local.id)
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setDeleteOpen(false)
    onTaskUpdated?.(local)
    onClose()
  }

  if (!open || !local) return null

  const isPersonal = local.project_id === null
  const overdue = isOverdue(local.due_date, local.status)
  const canDelete =
    profile &&
    (profile.role === 'admin' ||
      (isPersonal && local.assignee_id === profile.id) ||
      profile.role === 'manager')
  const checklistDone = checklist.filter((c) => c.is_done).length

  return (
    <>
      <div
        className="fixed inset-0 z-40 flex justify-end bg-ink/30"
        role="presentation"
        onClick={onClose}
      >
        <aside
          role="dialog"
          aria-modal="true"
          aria-label={local.title}
          className="flex h-full w-full max-w-xl flex-col bg-card shadow-2xl"
          onClick={(e) => e.stopPropagation()}
          data-testid="task-detail-panel"
        >
          <header className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <PriorityChip priority={local.priority} />
                <StatusChip status={local.status} />
                {isPersonal ? (
                  <span className="qb-chip bg-magenta-soft text-magenta">Personal</span>
                ) : null}
                {overdue ? (
                  <span className="qb-chip bg-rose-soft text-rose">Overdue</span>
                ) : null}
              </div>
              <h2 className="text-lg font-semibold leading-snug">{local.title}</h2>
            </div>
            <button
              type="button"
              className="qb-btn qb-btn-ghost size-8 !p-0"
              onClick={onClose}
              aria-label="Close task detail"
              data-testid="close-task-panel"
            >
              ✕
            </button>
          </header>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {error ? (
              <p className="rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose" role="alert">
                {error}
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-3 text-sm">
              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-muted">Status</span>
                <select
                  className="qb-input"
                  value={local.status}
                  disabled={busy}
                  onChange={(e) => void patch({ status: e.target.value as TaskStatus })}
                  data-testid="panel-status"
                >
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_META[s].label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-muted">Priority</span>
                <select
                  className="qb-input"
                  value={local.priority}
                  disabled={busy}
                  onChange={(e) => void patch({ priority: e.target.value as PriorityLevel })}
                  data-testid="panel-priority"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_META[p].label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-muted">Due date</span>
                <input
                  className="qb-input"
                  type="date"
                  value={local.due_date ?? ''}
                  disabled={busy}
                  onChange={(e) => void patch({ due_date: e.target.value || null })}
                  data-testid="panel-due-date"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-muted">
                  Estimated hours
                </span>
                <input
                  className="qb-input"
                  type="number"
                  min={0}
                  step={0.5}
                  value={local.estimated_hours ?? ''}
                  disabled={busy}
                  onChange={(e) =>
                    void patch({ estimated_hours: e.target.value ? Number(e.target.value) : null })
                  }
                />
              </label>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs uppercase tracking-wide text-muted">Progress</span>
                <span className="text-xs font-semibold text-muted">{local.progress}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={local.progress}
                disabled={busy || local.status === 'completed'}
                onChange={(e) => void patch({ progress: Number(e.target.value) })}
                className="w-full accent-[#4F46E5]"
                data-testid="panel-progress"
                aria-label="Progress"
              />
              <ProgressBar value={local.progress} showLabel />
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Assignee</dt>
                <dd className="mt-0.5 flex items-center gap-2">
                  <AssigneeAvatar task={local} />
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Reviewer</dt>
                <dd className="mt-0.5">{local.reviewer_id ? 'Assigned' : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Start</dt>
                <dd className="mt-0.5">
                  {formatDate(local.start_date)}
                  {local.start_time ? ` · ${formatClockTime(local.start_time)}` : ''}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Due</dt>
                <dd className={`mt-0.5 ${overdue ? 'font-semibold text-rose' : ''}`}>
                  {formatDate(local.due_date)}
                  {local.end_time ? ` · ${formatClockTime(local.end_time)}` : ''}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Estimate</dt>
                <dd className="mt-0.5">{formatHours(local.estimated_hours)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">Actual</dt>
                <dd className="mt-0.5">{formatHours(local.actual_hours)}</dd>
              </div>
            </dl>

            {local.expected_deliverable ? (
              <div>
                <h3 className="mb-1 text-xs uppercase tracking-wide text-muted">
                  Expected deliverable
                </h3>
                <p className="text-sm">{local.expected_deliverable}</p>
              </div>
            ) : null}

            {local.description ? (
              <div>
                <h3 className="mb-1 text-xs uppercase tracking-wide text-muted">Description</h3>
                <p className="whitespace-pre-wrap text-sm text-ink/90">{local.description}</p>
              </div>
            ) : null}

            {local.status === 'blocked' && local.blocker_note ? (
              <div className="rounded-lg bg-rose-soft px-3 py-2">
                <h3 className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-rose">
                  Blocked
                </h3>
                <p className="text-sm text-rose">{local.blocker_note}</p>
              </div>
            ) : null}

            {local.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {local.tags.map((tag) => (
                  <span key={tag} className="qb-chip bg-slate-soft text-muted">
                    #{tag}
                  </span>
                ))}
              </div>
            ) : null}

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs uppercase tracking-wide text-muted">
                  Checklist ({checklistDone}/{checklist.length})
                </h3>
              </div>
              <ul className="mb-2 space-y-1.5">
                {checklist.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={item.is_done}
                      onChange={() => void toggleChecklist(item)}
                      className="size-4 accent-[#4F46E5]"
                      aria-label={`Mark ${item.text} ${item.is_done ? 'incomplete' : 'complete'}`}
                    />
                    <span className={item.is_done ? 'text-muted line-through' : ''}>{item.text}</span>
                    <button
                      type="button"
                      className="ml-auto text-xs text-muted hover:text-critical"
                      onClick={() => void removeChecklistItem(item)}
                      aria-label={`Remove ${item.text}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <input
                  className="qb-input"
                  placeholder="Add a step…"
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void addChecklistItem()
                    }
                  }}
                  data-testid="checklist-input"
                />
                <button
                  type="button"
                  className="qb-btn qb-btn-secondary"
                  onClick={() => void addChecklistItem()}
                  disabled={!newItem.trim()}
                >
                  Add
                </button>
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-xs uppercase tracking-wide text-muted">
                Comments ({comments.length})
              </h3>
              <ul className="mb-3 space-y-3">
                {comments.length === 0 ? (
                  <li className="text-sm text-muted">No comments yet.</li>
                ) : (
                  comments.map((c) => {
                    const author = commentAuthors.get(c.author_id) ?? 'Someone'
                    const isMine = c.author_id === profile?.id
                    const canEdit = isMine || profile?.role === 'admin'
                    return (
                      <li key={c.id} className="rounded-lg border border-line p-3" data-testid="comment">
                        <div className="mb-1 flex items-center gap-2">
                          <Avatar name={author} id={c.author_id} size={22} />
                          <span className="text-sm font-semibold">{isMine ? 'You' : author}</span>
                          <span className="text-xs text-muted">
                            {formatDateTime(c.created_at)}
                          </span>
                          {canEdit ? (
                            <span className="ml-auto flex gap-2 text-xs">
                              <button
                                type="button"
                                className="text-indigo hover:underline"
                                onClick={() => {
                                  setEditingComment(c.id)
                                  setEditCommentBody(c.body)
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="text-critical hover:underline"
                                onClick={() => void removeComment(c.id)}
                              >
                                Delete
                              </button>
                            </span>
                          ) : null}
                        </div>
                        {editingComment === c.id ? (
                          <div className="flex gap-2">
                            <input
                              className="qb-input"
                              value={editCommentBody}
                              onChange={(e) => setEditCommentBody(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void saveEditedComment(c.id)
                                if (e.key === 'Escape') setEditingComment(null)
                              }}
                            />
                            <button
                              type="button"
                              className="qb-btn qb-btn-primary !py-1 text-xs"
                              onClick={() => void saveEditedComment(c.id)}
                            >
                              Save
                            </button>
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap text-sm">{c.body}</p>
                        )}
                      </li>
                    )
                  })
                )}
              </ul>
              <div className="flex gap-2">
                <input
                  className="qb-input"
                  placeholder="Write a comment… use @name to mention"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void addComment()
                    }
                  }}
                  data-testid="comment-input"
                />
                <button
                  type="button"
                  className="qb-btn qb-btn-secondary"
                  disabled={!newComment.trim()}
                  onClick={() => void addComment()}
                  data-testid="comment-submit"
                >
                  Send
                </button>
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-xs uppercase tracking-wide text-muted">Activity</h3>
              <ul className="space-y-2">
                {activity.length === 0 ? (
                  <li className="text-sm text-muted">No activity yet.</li>
                ) : (
                  activity.map((row) => (
                    <li key={row.id} className="text-sm text-muted">
                      <span className="font-medium text-ink">
                        {row.actor_id === profile?.id ? 'You' : 'Someone'}
                      </span>{' '}
                      {ACTIVITY_LABELS[row.action] ?? row.action.replace(/_/g, ' ')} ·{' '}
                      <time dateTime={row.created_at}>{formatDateTime(row.created_at)}</time>
                    </li>
                  ))
                )}
              </ul>
            </section>
          </div>

          <footer className="flex items-center gap-2 border-t border-line px-5 py-3">
            <button
              type="button"
              className="qb-btn qb-btn-primary"
              onClick={() => setEditOpen(true)}
              data-testid="edit-task"
            >
              Edit task
            </button>
            {canDelete ? (
              <button
                type="button"
                className="qb-btn qb-btn-secondary !text-critical"
                onClick={() => setDeleteOpen(true)}
                data-testid="delete-task"
              >
                Delete
              </button>
            ) : null}
            <span className="ml-auto text-xs text-muted">
              Created {formatDate(local.created_at.slice(0, 10))}
            </span>
          </footer>
        </aside>
      </div>

      <TaskForm
        open={editOpen}
        task={local}
        onClose={() => setEditOpen(false)}
        onSaved={(saved) => {
          setLocal(saved)
          onTaskUpdated?.(saved)
        }}
      />

      <Dialog
        open={deleteOpen}
        title="Delete task?"
        onClose={() => setDeleteOpen(false)}
        footer={
          <>
            <button type="button" className="qb-btn qb-btn-secondary" onClick={() => setDeleteOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="qb-btn qb-btn-danger"
              disabled={busy}
              onClick={() => void removeTask()}
              data-testid="confirm-delete-task"
            >
              {busy ? 'Deleting…' : 'Delete'}
            </button>
          </>
        }
      >
        <p className="text-sm">
          “{local.title}” will be permanently removed, along with its checklist and comments. This
          cannot be undone.
        </p>
      </Dialog>
    </>
  )
}

function AssigneeAvatar({ task }: { task: Task }) {
  const [name, setName] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', task.assignee_id)
        .maybeSingle()
      if (!cancelled && data) setName((data as { full_name: string }).full_name)
    })()
    return () => {
      cancelled = true
    }
  }, [task.assignee_id])

  if (!name) return <span className="text-muted">…</span>
  return (
    <Link to={`/employees/${task.assignee_id}`} className="flex items-center gap-2 hover:underline">
      <Avatar name={name} id={task.assignee_id} size={22} />
      <span>{name}</span>
    </Link>
  )
}
