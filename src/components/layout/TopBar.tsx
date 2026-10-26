import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth-context'
import { BellIcon, MenuIcon, SearchIcon } from '../icons'
import { Avatar } from '../ui'
import { useEffect, useState } from 'react'

interface TopBarProps {
  title: string
  onToggleMobileNav: () => void
}

export function TopBar({ title, onToggleMobileNav }: TopBarProps) {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function loadUnread() {
      if (!profile) return
      try {
        const { supabase } = await import('../../lib/supabase')
        const { count } = await supabase
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', profile.id)
          .eq('is_read', false)
        if (!cancelled) setUnread(count ?? 0)
      } catch {
        /* notifications are non-critical */
      }
    }
    void loadUnread()
    return () => {
      cancelled = true
    }
  }, [profile])

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-card/90 px-4 backdrop-blur">
      <button
        type="button"
        className="qb-btn qb-btn-ghost size-9 !p-0 md:hidden"
        onClick={onToggleMobileNav}
        aria-label="Open navigation"
      >
        <MenuIcon />
      </button>

      <h1 className="font-heading text-base font-semibold">{title}</h1>

      <div className="ml-auto flex items-center gap-2">
        <label className="relative hidden sm:block">
          <span className="sr-only">Search</span>
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            placeholder="Search tasks, projects…"
            className="qb-input w-56 !pl-9"
            data-testid="global-search"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const q = (e.target as HTMLInputElement).value.trim()
                navigate(q ? `/team-tasks?q=${encodeURIComponent(q)}` : '/team-tasks')
              }
            }}
          />
        </label>

        <button
          type="button"
          className="qb-btn qb-btn-ghost relative size-9 !p-0"
          onClick={() => navigate('/notifications')}
          aria-label={unread ? `${unread} unread notifications` : 'Notifications'}
        >
          <BellIcon />
          {unread > 0 ? (
            <span
              className="absolute right-1 top-1 min-w-4 rounded-full bg-critical px-1 text-[10px] font-bold leading-4 text-white"
              data-testid="unread-badge"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </button>

        <div className="flex items-center gap-2 border-l border-line pl-2">
          <button
            type="button"
            className="rounded-full"
            onClick={() => navigate('/profile')}
            aria-label="Your profile"
            title="Your profile"
          >
            <Avatar name={profile?.full_name ?? '?'} id={profile?.id} size={30} />
          </button>
          <button
            type="button"
            className="qb-btn qb-btn-ghost !py-1 text-xs"
            onClick={() => void signOut()}
            data-testid="sign-out"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  )
}
