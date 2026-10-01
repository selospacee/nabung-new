import {
  format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval,
  differenceInDays, addMonths, subMonths, isThisMonth, isSameMonth,
  startOfDay, isToday, formatDistanceToNow,
} from 'date-fns'

/** Parse ISO date string to Date */
export function parseDate(dateStr: string): Date {
  return parseISO(dateStr)
}

/** Format date as YYYY-MM-DD */
export function toISODate(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

/** Format date as YYYY-MM for month selectors */
export function toYearMonth(date: Date): string {
  return format(date, 'yyyy-MM')
}

/** Format date for display */
export function formatDate(dateStr: string, fmt = 'MMM d, yyyy'): string {
  try {
    return format(parseISO(dateStr), fmt)
  } catch {
    return dateStr
  }
}

/** Get start and end of month for a given date */
export function getMonthRange(dateStr: string) {
  const date = parseISO(dateStr)
  const start = startOfMonth(date)
  const end = endOfMonth(date)
  return { start: toISODate(start), end: toISODate(end), startDate: start, endDate: end }
}

/** Get last N days range */
export function getLastNDaysRange(n: number) {
  const end = startOfDay(new Date())
  const start = addMonths(subMonths(end, Math.ceil(n / 30)), 0)
  return { start: toISODate(start), end: toISODate(end) }
}

/** Check if a date is in the current month */
export function isCurrentMonth(dateStr: string): boolean {
  return isThisMonth(parseISO(dateStr))
}

/** Check if a date is today */
export function isDateToday(dateStr: string): boolean {
  return isToday(parseISO(dateStr))
}

/** Relative time description */
export function relativeDate(dateStr: string): string {
  try {
    return formatDistanceToNow(parseISO(dateStr), { addSuffix: true })
  } catch {
    return dateStr
  }
}

/** Quick presets for date filters */
export const DATE_PRESETS = {
  thisMonth: { label: 'This Month', range: () => getMonthRange(toISODate(new Date())) },
  last30Days: { label: 'Last 30 Days', range: () => getLastNDaysRange(30) },
  last90Days: { label: 'Last 90 Days', range: () => getLastNDaysRange(90) },
  thisYear: { label: 'This Year', range: () => {
    const d = new Date()
    return { start: `${d.getFullYear()}-01-01`, end: toISODate(d) }
  }},
  allTime: { label: 'All Time', range: () => ({ start: '1970-01-01', end: toISODate(new Date()) })},
} as const
