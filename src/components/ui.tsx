import type { ReactNode } from 'react'
import { avatarColor, initials, PRIORITY_CHIP, PRIORITY_META, STATUS_META } from '../lib/format'
import type { PriorityLevel, TaskStatus } from '../lib/types'

export function Avatar({
  name,
  id,
  size = 28,
  title,
}: {
  name: string
  id?: string
  size?: number
  title?: string
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${avatarColor(id ?? name)}`}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38) }}
      title={title ?? name}
      aria-hidden={title ? undefined : true}
    >
      {initials(name || '?')}
    </span>
  )
}

export function PriorityChip({ priority }: { priority: PriorityLevel }) {
  return (
    <span className={`qb-chip ${PRIORITY_CHIP[priority]}`} data-testid="priority-chip">
      {PRIORITY_META[priority].label}
    </span>
  )
}

export function StatusChip({ status }: { status: TaskStatus }) {
  return (
    <span className={`qb-chip ${STATUS_META[status].chip}`} data-testid="status-chip">
      {STATUS_META[status].label}
    </span>
  )
}

export function ProgressBar({
  value,
  tone = 'indigo',
  showLabel = false,
}: {
  value: number
  tone?: 'indigo' | 'magenta' | 'success' | 'amber' | 'rose'
  showLabel?: boolean
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  const bar =
    tone === 'magenta'
      ? 'bg-magenta'
      : tone === 'success'
        ? 'bg-success'
        : tone === 'amber'
          ? 'bg-amber'
          : tone === 'rose'
            ? 'bg-rose'
            : 'bg-indigo'
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-soft"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      {showLabel ? <span className="w-9 text-right text-xs text-muted">{pct}%</span> : null}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="qb-card flex flex-col items-center gap-2 px-6 py-12 text-center">
      <h3 className="text-base font-semibold">{title}</h3>
      {description ? <p className="max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted" role="status">
      <span
        className="inline-block size-4 animate-spin rounded-full border-2 border-indigo border-t-transparent"
        aria-hidden
      />
      {label}
    </div>
  )
}

export function Dialog({
  open,
  title,
  children,
  onClose,
  footer,
  wide = false,
}: {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
  footer?: ReactNode
  wide?: boolean
}) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`qb-card max-h-[85dvh] w-full ${wide ? 'max-w-2xl' : 'max-w-md'} overflow-y-auto p-5 shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            className="qb-btn qb-btn-ghost size-8 !p-0"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>
        {children}
        {footer ? <div className="mt-5 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`qb-card p-4 ${className}`}>{children}</section>
}

export function SectionTitle({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{children}</h2>
      {extra}
    </div>
  )
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p className="qb-chip bg-rose-soft text-rose" role="alert">
      {message}
    </p>
  )
}
