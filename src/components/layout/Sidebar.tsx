import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../../lib/auth-context'
import { navForRole } from '../../lib/nav'
import { NavIconSvg } from '../icons'
import { Avatar } from '../ui'
import { ROLE_LABEL } from '../../lib/format'

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { profile, role } = useAuth()
  const items = navForRole(role)
  const location = useLocation()

  return (
    <aside
      className="flex h-full w-[248px] shrink-0 flex-col border-r border-line bg-card"
      data-testid="sidebar"
    >
      <div className="flex items-center gap-2.5 border-b border-line px-5 py-4">
        <span className="flex size-8 items-center justify-center rounded-lg bg-indigo font-heading text-sm font-bold text-white">
          Q
        </span>
        <div className="leading-tight">
          <p className="font-heading text-sm font-semibold">Quantumberg</p>
          <p className="text-[11px] text-muted">Task Planning</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-soft text-indigo'
                      : 'text-muted hover:bg-bg hover:text-ink'
                  }`
                }
              >
                <NavIconSvg icon={item.icon} />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {profile ? (
        <div className="flex items-center gap-3 border-t border-line px-4 py-3.5">
          <Avatar name={profile.full_name} id={profile.id} size={34} />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold">{profile.full_name}</p>
            <p className="truncate text-[11px] text-muted">
              {ROLE_LABEL[profile.role]}
              {profile.designation ? ` · ${profile.designation}` : ''}
            </p>
          </div>
        </div>
      ) : null}

      <span className="sr-only">{location.pathname}</span>
    </aside>
  )
}
