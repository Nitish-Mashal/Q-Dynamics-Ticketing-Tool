import type { UserRole } from './types'

export interface NavItem {
  /** Route path */
  to: string
  label: string
  /** Lucide-style inline icon key */
  icon: NavIcon
  /** Roles that may see this item. Empty = everyone. */
  roles?: UserRole[]
  /** Hidden from employees even by URL. */
  ownerManagerOnly?: boolean
}

export type NavIcon =
  | 'dashboard'
  | 'myTasks'
  | 'myDay'
  | 'calendar'
  | 'projects'
  | 'teamTasks'
  | 'employees'
  | 'reports'
  | 'notifications'

export const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: '/my-tasks', label: 'My Tasks', icon: 'myTasks' },
  { to: '/my-day', label: 'My Day', icon: 'myDay' },
  { to: '/calendar', label: 'Calendar', icon: 'calendar' },
  { to: '/projects', label: 'Projects', icon: 'projects' },
  { to: '/team-tasks', label: 'Team Tasks', icon: 'teamTasks', roles: ['admin', 'manager'] },
  { to: '/employees', label: 'Employees', icon: 'employees', roles: ['admin', 'manager'] },
  { to: '/reports', label: 'Reports', icon: 'reports', roles: ['admin', 'manager'] },
  { to: '/notifications', label: 'Notifications', icon: 'notifications' },
]

export function navForRole(role: UserRole | null): NavItem[] {
  if (!role) return []
  return NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role))
}

export function canAccess(role: UserRole | null, to: string): boolean {
  if (!role) return false
  const item = NAV_ITEMS.find((n) => to.startsWith(n.to))
  if (!item) return true
  if (!item.roles) return true
  return item.roles.includes(role)
}
