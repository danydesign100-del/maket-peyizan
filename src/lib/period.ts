// Date ranges for the accounting screens (local calendar days, YYYY-MM-DD).
export type Period = { from: string; to: string }

const iso = (date: Date) => date.toLocaleDateString('en-CA')
export const monthToDate = (): Period => { const now = new Date(); return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) } }
export const yearToDate = (): Period => { const now = new Date(); return { from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(now) } }
export const periodError = (period: Period) => period.from && period.to && period.from > period.to ? 'La date de début ne peut pas être postérieure à la date de fin.' : null
export const formatDay = (value: string) => value ? new Intl.DateTimeFormat('fr-HT', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${value}T12:00:00`)) : '…'
export const describePeriod = (period: Period) => `Du ${formatDay(period.from)} au ${formatDay(period.to)}`
export const formatDateTime = (value: string) => new Intl.DateTimeFormat('fr-HT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
