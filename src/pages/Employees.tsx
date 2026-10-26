import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'
import type { Profile, Task, UserRole } from '../lib/types'
import { Avatar, Dialog, EmptyState, ProgressBar, Spinner } from '../components/ui'
import { ROLE_LABEL } from '../lib/format'
import { addDays, todayIso } from '../lib/time'
import {
  CAPACITY_HOURS,
  computeWorkloads,
  workloadBarTone,
  type WorkloadRow,
} from '../lib/workload'
import { SearchIcon } from '../components/icons'

type StatusFilter = 'all' | 'active' | 'inactive'

const ROLE_OPTIONS: UserRole[] = ['admin', 'manager', 'employee']

interface Row extends Profile {
  workload: WorkloadRow
  openTasks: number
}

export function EmployeesPage() {
  const { profile: me, refreshProfile } = useAuth()
  const [params, setParams] = useSearchParams()
  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [tasks, setTasks] = useState<
    Pick<Task, 'assignee_id' | 'estimated_hours' | 'progress' | 'status' | 'due_date'>[]
  >([])
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmDeactivate, setConfirmDeactivate] = useState<Profile | null>(null)

  const fetchAll = useCallback(async () => {
    const [peopleResult, tasksResult] = await Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase
        .from('tasks')
        .select('assignee_id, estimated_hours, progress, status, due_date')
        .in('status', ['not_started', 'in_progress', 'on_hold', 'blocked'])
        .gte('due_date', todayIso())
        .lte('due_date', addDays(todayIso(), 7)),
    ])
    return {
      people: (peopleResult.data as Profile[] | null) ?? [],
      peopleError: peopleResult.error?.message ?? null,
      tasks: (tasksResult.data as Task[] | null) ?? [],
    }
  }, [])

  const load = useCallback(async () => {
    const result = await fetchAll()
    if (result.peopleError) {
      setError(result.peopleError)
      setProfiles([])
      setTasks(result.tasks)
      return
    }
    setProfiles(result.people)
    setTasks(result.tasks)
    setError(null)
  }, [fetchAll])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await fetchAll()
      if (cancelled) return
      setProfiles(result.peopleError ? [] : result.people)
      setTasks(result.tasks)
      setError(result.peopleError)
    })()
    return () => {
      cancelled = true
    }
  }, [fetchAll])

  useEffect(() => {
    const desired = search || null
    if ((params.get('q') ?? null) === desired) return
    const next = new URLSearchParams(params)
    if (search) next.set('q', search)
    else next.delete('q')
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const rows = useMemo<Row[]>(() => {
    if (!profiles) return []
    const today = todayIso()
    const workloads = computeWorkloads(
      tasks,
      profiles.map((p) => p.id),
      today,
    )
    const byUser = new Map(workloads.map((w) => [w.userId, w]))
    const openCount = new Map<string, number>()
    for (const t of tasks) {
      openCount.set(t.assignee_id, (openCount.get(t.assignee_id) ?? 0) + 1)
    }

    const query = search.trim().toLowerCase()
    return profiles
      .map((p) => ({
        ...p,
        workload: byUser.get(p.id) ?? { userId: p.id, hours: 0, level: 'none' as const },
        openTasks: openCount.get(p.id) ?? 0,
      }))
      .filter((row) => {
        if (statusFilter === 'active' && !row.is_active) return false
        if (statusFilter === 'inactive' && row.is_active) return false
        if (!query) return true
        return (
          row.full_name.toLowerCase().includes(query) ||
          row.work_email.toLowerCase().includes(query) ||
          row.employee_code.toLowerCase().includes(query) ||
          (row.designation ?? '').toLowerCase().includes(query) ||
          (row.department ?? '').toLowerCase().includes(query)
        )
      })
  }, [profiles, tasks, search, statusFilter])

  async function changeRole(person: Profile, role: UserRole) {
    setBusyId(person.id)
    setError(null)
    const { error: err } = await supabase
      .from('profiles')
      .update({ role })
      .eq('id', person.id)
      .select()
    setBusyId(null)
    if (err) {
      setError(err.message)
      return
    }
    await load()
    if (person.id === me?.id) await refreshProfile()
  }

  async function setDeactivated(person: Profile, deactivated: boolean) {
    setBusyId(person.id)
    setError(null)
    const { error: err } = await supabase
      .from('profiles')
      .update({ is_active: !deactivated })
      .eq('id', person.id)
      .select()
    setBusyId(null)
    if (err) {
      setError(err.message)
      return
    }
    setConfirmDeactivate(null)
    await load()
  }

  if (!profiles) {
    return (
      <div className="px-4 py-6 lg:px-6">
        <Spinner label="Loading employees…" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 lg:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Employees</h2>
          <p className="mt-1 text-sm text-muted">
            {profiles.filter((p) => p.is_active).length} active ·{' '}
            {profiles.filter((p) => !p.is_active).length} deactivated
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">Search employees</span>
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              className="qb-input w-56 !pl-9"
              placeholder="Name, email, code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="employee-search"
            />
          </label>
          <select
            className="qb-input w-36"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Deactivated</option>
          </select>
        </div>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose" role="alert">
          {error}
        </p>
      ) : null}

      <p className="mb-2 text-xs text-muted">
        Workload = remaining hours on open tasks due in the next 7 days (capacity {CAPACITY_HOURS} h).
      </p>

      {rows.length === 0 ? (
        <EmptyState
          title="No employees match"
          description="Try a different search term or status filter."
        />
      ) : (
        <div className="qb-card overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-semibold">Employee</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Department</th>
                <th className="px-4 py-3 font-semibold">Workload (7d)</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isSelf = row.id === me?.id
                const canManage = me?.role === 'admin' && !isSelf
                return (
                  <tr
                    key={row.id}
                    className="border-b border-line last:border-0 hover:bg-bg"
                    data-testid={`employee-row-${row.work_email}`}
                  >
                    <td className="px-4 py-3">
                      <Link to={`/employees/${row.id}`} className="flex items-center gap-3 hover:underline">
                        <Avatar name={row.full_name} id={row.id} size={32} />
                        <span>
                          <span className="block font-semibold">
                            {row.full_name}
                            {isSelf ? <span className="ml-1 text-xs text-muted">(you)</span> : null}
                          </span>
                          <span className="block text-xs text-muted">
                            {row.employee_code} · {row.work_email}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {canManage ? (
                        <select
                          className="qb-input w-36 !py-1"
                          value={row.role}
                          disabled={busyId === row.id}
                          aria-label={`Role for ${row.full_name}`}
                          onChange={(e) => void changeRole(row, e.target.value as UserRole)}
                        >
                          {ROLE_OPTIONS.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="qb-chip bg-indigo-soft text-indigo">
                          {ROLE_LABEL[row.role]}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {row.department ?? '—'}
                      {row.designation ? (
                        <span className="block text-xs">{row.designation}</span>
                      ) : null}
                    </td>
                    <td className="w-44 px-4 py-3">
                      <div className="flex items-center justify-between text-xs">
                        <span
                          className={`font-semibold ${
                            row.workload.level === 'red'
                              ? 'text-rose'
                              : row.workload.level === 'amber'
                                ? 'text-amber'
                                : 'text-muted'
                          }`}
                          data-testid="workload-hours"
                        >
                          {row.workload.hours.toFixed(1)} h
                        </span>
                        <span className="text-muted">{row.openTasks} open</span>
                      </div>
                      <ProgressBar
                        value={(row.workload.hours / CAPACITY_HOURS) * 100}
                        tone={workloadBarTone(row.workload.level)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`qb-chip ${row.is_active ? 'bg-success-soft text-success' : 'bg-slate-soft text-muted'}`}
                      >
                        {row.is_active ? 'Active' : 'Deactivated'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Link to={`/employees/${row.id}`} className="qb-btn qb-btn-secondary !py-1 text-xs">
                          View
                        </Link>
                        {me?.role === 'admin' && !isSelf ? (
                          row.is_active ? (
                            <button
                              type="button"
                              className="qb-btn qb-btn-secondary !py-1 text-xs !text-critical"
                              disabled={busyId === row.id}
                              onClick={() => setConfirmDeactivate(row)}
                              data-testid={`deactivate-${row.work_email}`}
                            >
                              Deactivate
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="qb-btn qb-btn-secondary !py-1 text-xs !text-success"
                              disabled={busyId === row.id}
                              onClick={() => void setDeactivated(row, false)}
                              data-testid={`reactivate-${row.work_email}`}
                            >
                              Reactivate
                            </button>
                          )
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={confirmDeactivate !== null}
        title="Deactivate employee?"
        onClose={() => setConfirmDeactivate(null)}
        footer={
          <>
            <button type="button" className="qb-btn qb-btn-secondary" onClick={() => setConfirmDeactivate(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="qb-btn qb-btn-danger"
              disabled={busyId !== null}
              onClick={() => confirmDeactivate && void setDeactivated(confirmDeactivate, true)}
              data-testid="confirm-deactivate"
            >
              {busyId ? 'Deactivating…' : 'Deactivate'}
            </button>
          </>
        }
      >
        {confirmDeactivate ? (
          <div className="space-y-3 text-sm">
            <p>
              <strong>{confirmDeactivate.full_name}</strong> ({confirmDeactivate.work_email}) will
              no longer be able to sign in. Their tasks, comments and history are kept exactly as
              they are — nothing is deleted.
            </p>
            <p className="rounded-lg bg-amber-soft px-3 py-2 text-amber">
              You can reactivate them at any time from this page.
            </p>
          </div>
        ) : null}
      </Dialog>
    </div>
  )
}
