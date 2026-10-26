import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'
import { updateTask, TaskApiError } from '../lib/tasks'
import type { Milestone, Profile, Project, ProjectStatus, Task, TaskStatus } from '../lib/types'
import { PROJECT_STATUSES, TASK_STATUSES } from '../lib/types'
import {
  PROJECT_STATUS_META,
  STATUS_META,
  formatHours,
  taskProgressPercent,
} from '../lib/format'
import { formatDate, todayIso } from '../lib/time'
import { Avatar, Dialog, EmptyState, PriorityChip, ProgressBar, Spinner, StatusChip } from '../components/ui'
import { TaskDetailPanel } from '../components/TaskDetailPanel'
import { TaskForm } from '../components/TaskForm'
import { PlusIcon } from '../components/icons'

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  const [project, setProject] = useState<Project | null | undefined>(undefined)
  const [members, setMembers] = useState<{ user_id: string; responsibility: string | null }[]>([])
  const [memberProfiles, setMemberProfiles] = useState<Profile[]>([])
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [error, setError] = useState<string | null>(null)
  const [openTask, setOpenTask] = useState<Task | null>(null)
  const [createTaskOpen, setCreateTaskOpen] = useState(false)
  const [addMilestoneOpen, setAddMilestoneOpen] = useState(false)
  const [newMilestone, setNewMilestone] = useState('')
  const [milestoneDate, setMilestoneDate] = useState('')
  const [busy, setBusy] = useState(false)

  const canManage =
    profile &&
    project &&
    (profile.role === 'admin' ||
      project.manager_id === profile.id ||
      project.owner_id === profile.id)

  const load = useCallback(async () => {
    if (!id) return
    const [projResult, memberResult, milestoneResult, taskResult] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).maybeSingle(),
      supabase.from('project_members').select('user_id, responsibility').eq('project_id', id),
      supabase.from('milestones').select('*').eq('project_id', id).order('due_date', { ascending: true, nullsFirst: false }),
      supabase.from('tasks').select('*').eq('project_id', id).order('due_date', { ascending: true, nullsFirst: false }),
    ])
    if (projResult.error) {
      setError(projResult.error.message)
      setProject(null)
      return
    }
    const row = projResult.data as Project | null
    setProject(row)
    const memberRows = (memberResult.data as { user_id: string; responsibility: string | null }[]) ?? []
    setMembers(memberRows)
    if (memberRows.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .in('id', memberRows.map((m) => m.user_id))
      setMemberProfiles((profiles as Profile[] | null) ?? [])
    } else {
      setMemberProfiles([])
    }
    setMilestones((milestoneResult.data as Milestone[] | null) ?? [])
    setTasks((taskResult.data as Task[] | null) ?? [])
  }, [id])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!id) return
      const [projResult, memberResult, milestoneResult, taskResult] = await Promise.all([
        supabase.from('projects').select('*').eq('id', id).maybeSingle(),
        supabase.from('project_members').select('user_id, responsibility').eq('project_id', id),
        supabase.from('milestones').select('*').eq('project_id', id).order('due_date', { ascending: true, nullsFirst: false }),
        supabase.from('tasks').select('*').eq('project_id', id).order('due_date', { ascending: true, nullsFirst: false }),
      ])
      if (cancelled) return
      if (projResult.error) {
        setError(projResult.error.message)
        setProject(null)
        return
      }
      const row = projResult.data as Project | null
      setProject(row)
      const memberRows = (memberResult.data as { user_id: string; responsibility: string | null }[]) ?? []
      setMembers(memberRows)
      if (memberRows.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('*')
          .in('id', memberRows.map((m) => m.user_id))
        setMemberProfiles((profiles as Profile[] | null) ?? [])
      } else {
        setMemberProfiles([])
      }
      setMilestones((milestoneResult.data as Milestone[] | null) ?? [])
      setTasks((taskResult.data as Task[] | null) ?? [])
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const progress = useMemo(() => {
    if (!project) return 0
    if (project.progress_override != null) return project.progress_override
    if (tasks.length === 0) return 0
    return Math.round(tasks.reduce((sum, t) => sum + taskProgressPercent(t), 0) / tasks.length)
  }, [project, tasks])

  async function saveStatus(status: ProjectStatus) {
    if (!project) return
    setBusy(true)
    setError(null)
    const { error: err } = await supabase
      .from('projects')
      .update({ status })
      .eq('id', project.id)
      .select()
      .maybeSingle()
    setBusy(false)
    if (err) setError(err.message)
    else await load()
  }

  async function addMilestone() {
    if (!project || !newMilestone.trim()) return
    setBusy(true)
    const { error: err } = await supabase
      .from('milestones')
      .insert({
        project_id: project.id,
        title: newMilestone.trim(),
        due_date: milestoneDate || null,
      })
      .select()
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setNewMilestone('')
    setMilestoneDate('')
    setAddMilestoneOpen(false)
    await load()
  }

  async function completeMilestone(m: Milestone) {
    setBusy(true)
    const { error: err } = await supabase
      .from('milestones')
      .update({ completed_at: new Date().toISOString() })
      .eq('id', m.id)
      .select()
    setBusy(false)
    if (err) setError(err.message)
    else await load()
  }

  async function quickStatus(task: Task, status: TaskStatus) {
    setBusy(true)
    try {
      await updateTask(task.id, { status })
      await load()
    } catch (err) {
      setError(err instanceof TaskApiError ? err.message : 'Could not update the task.')
    } finally {
      setBusy(false)
    }
  }

  if (project === undefined) {
    return (
      <div className="px-4 py-6">
        <Spinner label="Loading project…" />
      </div>
    )
  }

  if (project === null) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <EmptyState
          title="Project not found"
          description="It may have been deleted, or you don’t have access."
          action={
            <Link to="/projects" className="qb-btn qb-btn-primary">
              Back to Projects
            </Link>
          }
        />
      </div>
    )
  }

  const today = todayIso()
  const openTasks = tasks.filter((t) => ['not_started', 'in_progress', 'on_hold', 'blocked'].includes(t.status))
  const overdueCount = openTasks.filter((t) => t.due_date && t.due_date < today).length

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 lg:px-6">
      <Link to="/projects" className="mb-4 inline-block text-sm text-indigo hover:underline">
        ← Back to Projects
      </Link>

      {error ? (
        <p className="mb-4 rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose" role="alert">
          {error}
        </p>
      ) : null}

      <div className="qb-card mb-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo">
              {project.code}
            </p>
            <h2 className="mt-0.5 text-xl font-semibold">{project.name}</h2>
            {project.description ? (
              <p className="mt-1 max-w-2xl text-sm text-muted">{project.description}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <PriorityChip priority={project.priority} />
            {canManage ? (
              <select
                className="qb-input w-36 !py-1"
                value={project.status}
                disabled={busy}
                onChange={(e) => void saveStatus(e.target.value as ProjectStatus)}
                data-testid="project-status"
              >
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {PROJECT_STATUS_META[s].label}
                  </option>
                ))}
              </select>
            ) : (
              <span className={`qb-chip ${PROJECT_STATUS_META[project.status].chip}`}>
                {PROJECT_STATUS_META[project.status].label}
              </span>
            )}
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-muted">
            <span>Progress</span>
            <span>{progress}%</span>
          </div>
          <ProgressBar value={progress} showLabel tone={project.status === 'at_risk' ? 'rose' : 'indigo'} />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4 text-sm md:grid-cols-4">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Start</dt>
            <dd className="mt-0.5">{formatDate(project.start_date)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Target</dt>
            <dd className="mt-0.5">{formatDate(project.target_date)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Open tasks</dt>
            <dd className="mt-0.5">
              {openTasks.length}
              {overdueCount > 0 ? <span className="ml-1 font-semibold text-rose">({overdueCount} overdue)</span> : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Category</dt>
            <dd className="mt-0.5">{project.category ?? '—'}</dd>
          </div>
        </dl>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="qb-card p-4 lg:col-span-1">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Members ({members.length})
            </h3>
          </div>
          {members.length === 0 ? (
            <p className="text-sm text-muted">No members yet.</p>
          ) : (
            <ul className="space-y-2">
              {members.map((m) => {
                const p = memberProfiles.find((x) => x.id === m.user_id)
                return (
                  <li key={m.user_id} className="flex items-center gap-2.5">
                    <Avatar name={p?.full_name ?? '?'} id={m.user_id} size={30} />
                    <div className="min-w-0">
                      <Link
                        to={`/employees/${m.user_id}`}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {p?.full_name ?? 'Unknown'}
                      </Link>
                      <p className="truncate text-xs text-muted">
                        {m.responsibility ?? p?.designation ?? p?.role ?? ''}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="qb-card p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Milestones ({milestones.filter((m) => m.completed_at).length}/{milestones.length})
            </h3>
            {canManage ? (
              <button
                type="button"
                className="qb-btn qb-btn-secondary !py-1 text-xs"
                onClick={() => setAddMilestoneOpen(true)}
                data-testid="add-milestone"
              >
                <PlusIcon /> Add
              </button>
            ) : null}
          </div>
          {milestones.length === 0 ? (
            <p className="text-sm text-muted">No milestones yet.</p>
          ) : (
            <ul className="space-y-2">
              {milestones.map((m) => {
                const done = Boolean(m.completed_at)
                const overdue = !done && m.due_date && m.due_date < today
                return (
                  <li key={m.id} className="flex items-center gap-3 text-sm">
                    <span
                      className={`inline-flex size-5 items-center justify-center rounded-full border text-[10px] ${
                        done
                          ? 'border-success bg-success text-white'
                          : overdue
                            ? 'border-rose text-rose'
                            : 'border-line text-muted'
                      }`}
                      aria-hidden
                    >
                      {done ? '✓' : ''}
                    </span>
                    <span className={done ? 'text-muted line-through' : ''}>{m.title}</span>
                    <span className={`ml-auto text-xs ${overdue ? 'font-semibold text-rose' : 'text-muted'}`}>
                      {m.due_date ? formatDate(m.due_date) : ''}
                    </span>
                    {!done && canManage ? (
                      <button
                        type="button"
                        className="qb-btn qb-btn-ghost !py-0.5 text-xs"
                        disabled={busy}
                        onClick={() => void completeMilestone(m)}
                      >
                        Complete
                      </button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="qb-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Tasks ({tasks.length})
          </h3>
          <button
            type="button"
            className="qb-btn qb-btn-primary !py-1.5 text-xs"
            onClick={() => setCreateTaskOpen(true)}
            data-testid="new-project-task"
          >
            <PlusIcon /> New task
          </button>
        </div>

        {tasks.length === 0 ? (
          <div className="px-4 py-8">
            <EmptyState
              title="No tasks in this project yet"
              description="Break the work down and assign it to the team."
              action={
                <button type="button" className="qb-btn qb-btn-primary" onClick={() => setCreateTaskOpen(true)}>
                  <PlusIcon /> New task
                </button>
              }
            />
          </div>
        ) : (
          <ul>
            {tasks.map((task) => (
              <li
                key={task.id}
                className="flex cursor-pointer items-center gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-bg"
                onClick={() => setOpenTask(task)}
                data-testid={`project-task-${task.id}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{task.title}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                    <PriorityChip priority={task.priority} />
                    {task.estimated_hours ? <span>{formatHours(task.estimated_hours)}</span> : null}
                    <span className={task.due_date && task.due_date < today ? 'font-semibold text-rose' : ''}>
                      {task.due_date ? formatDate(task.due_date) : 'No due date'}
                    </span>
                  </p>
                </div>
                <span className="hidden w-32 sm:block">
                  <ProgressBar value={taskProgressPercent(task)} />
                </span>
                <span className="hidden md:block">
                  <StatusChip status={task.status} />
                </span>
                <select
                  className="qb-input hidden w-32 !py-1 lg:block"
                  value={task.status}
                  disabled={busy}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    e.stopPropagation()
                    void quickStatus(task, e.target.value as TaskStatus)
                  }}
                  aria-label={`Status for ${task.title}`}
                >
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_META[s].label}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}
      </section>

      <TaskDetailPanel
        task={openTask}
        open={openTask !== null}
        onClose={() => {
          setOpenTask(null)
          void load()
        }}
        onTaskUpdated={() => void load()}
      />

      <TaskForm
        open={createTaskOpen}
        task={null}
        defaultProjectId={project.id}
        onClose={() => setCreateTaskOpen(false)}
        onSaved={() => {
          setCreateTaskOpen(false)
          void load()
        }}
      />

      <Dialog
        open={addMilestoneOpen}
        title="Add milestone"
        onClose={() => setAddMilestoneOpen(false)}
        footer={
          <>
            <button type="button" className="qb-btn qb-btn-secondary" onClick={() => setAddMilestoneOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="qb-btn qb-btn-primary"
              disabled={!newMilestone.trim() || busy}
              onClick={() => void addMilestone()}
              data-testid="save-milestone"
            >
              {busy ? 'Saving…' : 'Add'}
            </button>
          </>
        }
      >
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Title *</span>
          <input
            className="qb-input"
            value={newMilestone}
            onChange={(e) => setNewMilestone(e.target.value)}
            maxLength={160}
            data-testid="milestone-title"
          />
        </label>
        <label className="mt-3 block text-sm">
          <span className="mb-1 block text-muted">Due date</span>
          <input
            className="qb-input"
            type="date"
            value={milestoneDate}
            onChange={(e) => setMilestoneDate(e.target.value)}
          />
        </label>
      </Dialog>
    </div>
  )
}
