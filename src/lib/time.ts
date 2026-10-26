// All dates are stored as plain dates (YYYY-MM-DD) and timestamps as timestamptz
// (UTC). The company default time zone is Asia/Kolkata; every display helper
// formats in that zone unless a profile says otherwise.

export const APP_TIME_ZONE = 'Asia/Kolkata'

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: APP_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

const timeFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: APP_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

/** Today's date in the app time zone as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  return dateFmt.format(now)
}

/** Calendar-date arithmetic on YYYY-MM-DD strings (no timezone drift). */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d + days))
  return utc.toISOString().slice(0, 10)
}

/** Weekday index (0 = Sunday … 6 = Saturday) for a YYYY-MM-DD string. */
export function weekdayIndex(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export function isOverdue(dueDate: string | null, status: string, now = todayIso()): boolean {
  if (!dueDate) return false
  if (status === 'completed' || status === 'cancelled') return false
  return dueDate < now
}

/** "26 Oct 2026" for a YYYY-MM-DD date. */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return dateStr
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)))
}

/** "26 Oct 2026, 3:45 pm" for a timestamptz value, in Asia/Kolkata. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return dateTimeFmt.format(date)
}

/** "3:45 pm" for a timestamptz value. */
export function formatTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return timeFmt.format(date)
}

/** "10:00:00" DB time -> "10:00 am". */
export function formatClockTime(value: string | null | undefined): string {
  if (!value) return ''
  const [h, m] = value.split(':').map(Number)
  if (Number.isNaN(h)) return value
  const suffix = h >= 12 ? 'pm' : 'am'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${String(m ?? 0).padStart(2, '0')} ${suffix}`
}

export function monthStart(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`
}

export function daysInMonth(dateStr: string): number {
  const [y, m] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function startOfWeekMonday(dateStr: string): string {
  const wd = weekdayIndex(dateStr)
  const backToMonday = wd === 0 ? 6 : wd - 1
  return addDays(dateStr, -backToMonday)
}

export function relativeDayLabel(dateStr: string, now = todayIso()): string {
  if (dateStr === now) return 'Today'
  if (dateStr === addDays(now, 1)) return 'Tomorrow'
  if (dateStr === addDays(now, -1)) return 'Yesterday'
  return formatDate(dateStr)
}
