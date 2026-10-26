import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import { useAuth } from './lib/auth-context'
import { AppShell } from './components/layout/AppShell'
import { Spinner } from './components/ui'
import { SignInPage } from './pages/SignIn'
import { ForgotPasswordPage, ResetPasswordPage } from './pages/Auth'
import { DashboardPage } from './pages/Dashboard'
import { ReportsPage } from './pages/Reports'
import { NotificationsPage } from './pages/Notifications'
import { CalendarPage } from './pages/Calendar'
import { EmployeesPage } from './pages/Employees'
import { EmployeeDetailPage } from './pages/EmployeeDetail'
import { ProfilePage } from './pages/Profile'
import { MyTasksPage } from './pages/MyTasks'
import { MyDayPage } from './pages/MyDay'
import { ProjectsPage } from './pages/Projects'
import { ProjectDetailPage } from './pages/ProjectDetail'
import { TeamTasksPage } from './pages/TeamTasks'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, profile, loading, deactivated } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg">
        <Spinner label="Checking your session…" />
      </div>
    )
  }

  if (!session) return <Navigate to="/sign-in" replace />

  if (deactivated) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
        <div className="qb-card max-w-md p-6 text-center">
          <h1 className="mb-2 text-lg font-semibold">Account deactivated</h1>
          <p className="mb-4 text-sm text-muted">
            Your account has been deactivated. Contact the business owner if you need access
            restored.
          </p>
          <button
            type="button"
            className="qb-btn qb-btn-secondary"
            onClick={() => void import('./lib/supabase').then((m) => m.supabase.auth.signOut())}
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg">
        <Spinner label="Loading your profile…" />
      </div>
    )
  }

  return children
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          <Route
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/my-tasks" element={<MyTasksPage />} />
            <Route path="/my-day" element={<MyDayPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
            <Route path="/team-tasks" element={<TeamTasksPage />} />
            <Route path="/employees" element={<EmployeesPage />} />
            <Route path="/employees/:id" element={<EmployeeDetailPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
