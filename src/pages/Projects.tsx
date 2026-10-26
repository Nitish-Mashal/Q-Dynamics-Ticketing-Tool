import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'
import type { PriorityLevel, Project, ProjectStatus, Task } from '../lib/types'
import { PRIORITIES, PROJECT_STATUSES } from '../lib/types'
import { PRIORITY_CHIP, PRIORITY_META, PROJECT_STATUS_META, taskProgressPercent } from '../lib/format'
import { formatDate } from '../lib/time'
import { Dialog, EmptyState, ProgressBar, Spinner } from '../components/ui'
import { PlusIcon, SearchIcon } from '../components/icons'
import { useDirectory } from '../lib/tasks'

function nextProjectCode(existing: string[]): string {
  const max = existing.reduce((acc, code) => {
    const n = Number(code.replace('PRJ-', ''))
    return Number.isFinite(n) ? Math.max(acc, n) : acc
  }, 0)
  return `PRJ-${String(max + 1).padStart(3, '0')}`
}

export function ProjectsPage() {
  const { profile } = useAuth()
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [tasks, setTasks] = useState<Pick<Task, 'project_id' | 'status' | 'progress'>[]>([])
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all')
  const [createOpen, setCreateOpen] = useState(false)

  const canCreate = profile?.role === 'admin' || profile?.role === 'manager'

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [projResult, taskResult] = await Promise.all([
        supabase.from('projects').select('*').order('code'),
        supabase.from('tasks').select('project_id, status, progress'),
      ])
      if (cancelled) return
      if (projResult.error) {
        setError(projResult.error.message)
        setProjects([])
      } else {
        setProjects((projResult.data as Project[] | null) ?? [])
        setError(null)
      }
      setTasks((taskResult.data as Task[] | null) ?? [])
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const progressByProject = useMemo(() => {
    const map = new Map<string, { sum: number; count: number }>()
    for (const t of tasks) {
      if (!t.project_id) continue
      const entry = map.get(t.project_id) ?? { sum: 0, count: 0 }
      entry.sum += taskProgressPercent(t as Task)
      entry.count += 1
      map.set(t.project_id, entry)
    }
    return map
  }, [tasks])

  const filtered = useMemo(() => {
    if (!projects) return []
    const q = search.trim().toLowerCase()
    return projects.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q)
      )
    })
  }, [projects, search, statusFilter])

  if (!projects) {
    return (
      <div className="px-4 py-6">
        <Spinner label="Loading projects…" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 lg:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Projects</h2>
          <p className="mt-1 text-sm text-muted">{projects.length} projects visible to you</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">Search projects</span>
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              className="qb-input w-52 !pl-9"
              placeholder="Search projects…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="project-search"
            />
          </label>
          <select
            className="qb-input w-36"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ProjectStatus | 'all')}
            aria-label="Filter projects by status"
          >
            <option value="all">All statuses</option>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_META[s].label}
              </option>
            ))}
          </select>
          {canCreate ? (
            <button
              type="button"
              className="qb-btn qb-btn-primary"
              onClick={() => setCreateOpen(true)}
              data-testid="new-project"
            >
              <PlusIcon /> New project
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose" role="alert">
          {error}
        </p>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState title="No projects match" description="Try another search or status filter." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((project) => {
            const entry = progressByProject.get(project.id)
            const progress =
              project.progress_override ?? (entry && entry.count > 0 ? Math.round(entry.sum / entry.count) : 0)
            return (
              <Link
                key={project.id}
                to={`/projects/${project.id}`}
                className="qb-card flex flex-col gap-3 p-4 transition-shadow hover:shadow-md"
                data-testid={`project-card-${project.code}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-indigo">
                      {project.code}
                    </p>
                    <h3 className="mt-0.5 font-heading text-base font-semibold leading-snug">
                      {project.name}
                    </h3>
                  </div>
                  <span className={`qb-chip ${PROJECT_STATUS_META[project.status].chip}`}>
                    {PROJECT_STATUS_META[project.status].label}
                  </span>
                </div>

                {project.description ? (
                  <p className="line-clamp-2 text-sm text-muted">{project.description}</p>
                ) : null}

                <div className="mt-auto space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span>
                      {entry?.count ?? 0} tasks
                      {project.target_date ? ` · target ${formatDate(project.target_date)}` : ''}
                    </span>
                    <span className={`qb-chip ${PRIORITY_CHIP[project.priority]}`}>
                      {PRIORITY_META[project.priority].label}
                    </span>
                  </div>
                  <ProgressBar value={progress} tone={project.status === 'at_risk' ? 'rose' : 'indigo'} showLabel />
                </div>
              </Link>
            )
          })}
        </div>
      )}

      <CreateProjectDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        existingCodes={projects.map((p) => p.code)}
        onCreated={() => {
          setCreateOpen(false)
          // refresh
          void (async () => {
            const { data } = await supabase.from('projects').select('*').order('code')
            setProjects((data as Project[] | null) ?? [])
          })()
        }}
      />
    </div>
  )
}

interface CreateDialogProps {
  open: boolean
  onClose: () => void
  existingCodes: string[]
  onCreated: (project: Project) => void
}

function CreateProjectDialog({ open, onClose, existingCodes, onCreated }: CreateDialogProps) {
  const { profile } = useAuth()
  const { profiles } = useDirectory()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<PriorityLevel>('medium')
  const [status, setStatus] = useState<ProjectStatus>('planning')
  const [startDate, setStartDate] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [category, setCategory] = useState('')
  const [managerId, setManagerId] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Managers can only create projects they manage (owner/manager = self).
  const locked = profile?.role !== 'admin'
  const effectiveManager = locked ? profile?.id ?? '' : managerId || profile?.id || ''
  const effectiveOwner = locked ? profile?.id ?? '' : ownerId || profile?.id || ''

  async function submit() {
    if (!profile) return
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('projects')
      .insert({
        code: nextProjectCode(existingCodes),
        name: name.trim(),
        description: description.trim() || null,
        priority,
        status,
        start_date: startDate || null,
        target_date: targetDate || null,
        category: category.trim() || null,
        owner_id: effectiveOwner || profile.id,
        manager_id: effectiveManager || profile.id,
      })
      .select()
      .single()
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    const project = data as Project
    // Creator joins as a member automatically when possible.
    await supabase
      .from('project_members')
      .insert({ project_id: project.id, user_id: profile.id, responsibility: 'Owner' })
      .select()
    setName('')
    setDescription('')
    onCreated(project)
  }

  return (
    <Dialog
      open={open}
      title="New project"
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
            disabled={name.trim().length < 2 || busy}
            onClick={() => void submit()}
            data-testid="create-project-submit"
          >
            {busy ? 'Creating…' : 'Create project'}
          </button>
        </>
      }
    >
      {error ? (
        <p className="mb-3 rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose" role="alert">
          {error}
        </p>
      ) : null}

      <div className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Project name *</span>
          <input
            className="qb-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={160}
            data-testid="project-name"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-muted">Description</span>
          <textarea
            className="qb-input min-h-16"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Status</span>
            <select
              className="qb-input"
              value={status}
              onChange={(e) => setStatus(e.target.value as ProjectStatus)}
            >
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PROJECT_STATUS_META[s].label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-muted">Priority</span>
            <select
              className="qb-input"
              value={priority}
              onChange={(e) => setPriority(e.target.value as PriorityLevel)}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_META[p].label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-muted">Start date</span>
            <input
              className="qb-input"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-muted">Target date</span>
            <input
              className="qb-input"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-muted">Category</span>
            <input
              className="qb-input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Internal, Client…"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-muted">Manager</span>
            <select
              className="qb-input"
              value={effectiveManager}
              onChange={(e) => setManagerId(e.target.value)}
              disabled={locked}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-muted">Owner</span>
            <select
              className="qb-input"
              value={effectiveOwner}
              onChange={(e) => setOwnerId(e.target.value)}
              disabled={locked}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </Dialog>
  )
}
