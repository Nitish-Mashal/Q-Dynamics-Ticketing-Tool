import { useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth-context'
import { canAccess } from '../../lib/nav'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { Spinner } from '../ui'

const TITLES: [string, string][] = [
  ['/dashboard', 'Dashboard'],
  ['/my-tasks', 'My Tasks'],
  ['/my-day', 'My Day'],
  ['/calendar', 'Calendar'],
  ['/projects', 'Projects'],
  ['/team-tasks', 'Team Tasks'],
  ['/employees', 'Employees'],
  ['/reports', 'Reports'],
  ['/notifications', 'Notifications'],
]

function pageTitle(pathname: string): string {
  const match = TITLES.find(([prefix]) => pathname.startsWith(prefix))
  return match?.[1] ?? 'Quantumberg'
}

export function AppShell() {
  const { role, loading } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [lastPath, setLastPath] = useState(location.pathname)

  // Close the mobile drawer whenever the route changes.
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname)
    setMobileNavOpen(false)
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg">
        <Spinner label="Loading your workspace…" />
      </div>
    )
  }

  if (!role) {
    navigate('/sign-in', { replace: true })
    return null
  }

  const section = `/${location.pathname.split('/')[1] ?? ''}`
  const allowed = canAccess(role, section)

  return (
    <div className="flex h-dvh overflow-hidden bg-bg">
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {mobileNavOpen ? (
        <div
          className="fixed inset-0 z-40 flex md:hidden"
          role="presentation"
          onClick={() => setMobileNavOpen(false)}
        >
          <div
            className="w-[248px] max-w-[80vw] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <Sidebar onNavigate={() => setMobileNavOpen(false)} />
          </div>
          <div className="flex-1 bg-ink/40" />
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={pageTitle(location.pathname)} onToggleMobileNav={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto" data-testid="page-content">
          {allowed ? (
            <Outlet />
          ) : (
            <div className="mx-auto max-w-lg px-4 py-16 text-center">
              <h2 className="mb-2 text-xl font-semibold">You don’t have access to this page</h2>
              <p className="mb-6 text-sm text-muted">
                This section is limited to the business owner and managers. Your account is a
                employee account, so team-wide pages are hidden.
              </p>
              <button type="button" className="qb-btn qb-btn-primary" onClick={() => navigate('/dashboard')}>
                Back to Dashboard
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
