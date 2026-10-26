import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Profile, Project, Task } from './types'

interface DirectoryState {
  profiles: Profile[]
  projects: Project[]
  loading: boolean
}

/**
 * Active profiles and projects the signed-in user can see (RLS decides).
 * Used by the task form and pickers.
 */
export function useDirectory(): DirectoryState & { reload: () => Promise<void> } {
  const [state, setState] = useState<DirectoryState>({
    profiles: [],
    projects: [],
    loading: true,
  })

  const reload = useCallback(async () => {
    const [peopleResult, projectResult] = await Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('projects').select('*').eq('is_archived', false).order('name'),
    ])
    const people = ((peopleResult.data as Profile[] | null) ?? []).filter((p) => p.is_active)
    const projects = (projectResult.data as Project[] | null) ?? []
    setState({ profiles: people, projects, loading: false })
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [peopleResult, projectResult] = await Promise.all([
        supabase.from('profiles').select('*').order('full_name'),
        supabase.from('projects').select('*').eq('is_archived', false).order('name'),
      ])
      if (cancelled) return
      const people = ((peopleResult.data as Profile[] | null) ?? []).filter((p) => p.is_active)
      const projects = (projectResult.data as Project[] | null) ?? []
      setState({ profiles: people, projects, loading: false })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return { ...state, reload }
}

export class TaskApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaskApiError'
  }
}

function friendly(err: { message?: string }): string {
  const msg = (err.message ?? '').trim()
  if (!msg) return 'Something went wrong. Please try again.'
  // Strip Postgres exception prefixes for readability.
  return msg
    .replace(/^.*?Exception:\s*/i, '')
    .replace(/\s*DETAIL:.*$/i, '')
    .trim()
}

export async function createTask(input: Partial<Task>): Promise<Task> {
  const { data, error } = await supabase.from('tasks').insert(input).select().single()
  if (error) throw new TaskApiError(friendly(error))
  return data as Task
}

export async function updateTask(id: string, patch: Partial<Task>): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .update(patch)
    .eq('id', id)
    .select()
    .maybeSingle()
  if (error) throw new TaskApiError(friendly(error))
  if (!data) throw new TaskApiError('You do not have access to that task.')
  return data as Task
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) throw new TaskApiError(friendly(error))
}
