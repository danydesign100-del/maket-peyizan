// Cash count logsheet: denominations and totals. The same rules are applied
// again by the server (local server and Supabase trigger) before saving.
export type Currency = 'htg' | 'usd'
export type Shift = 'AM' | 'PM' | 'NIGHT'
export type Direction = 'in' | 'out'

export type Denomination = { key: string; value: number; label: string; short: string; kind: 'coin' | 'bill' }

export const DENOMINATIONS: Record<Currency, Denomination[]> = {
  htg: [
    { key: '5', value: 5, label: '5 gourdes', short: '5 G', kind: 'coin' },
    { key: '10', value: 10, label: '10 gourdes', short: '10 G', kind: 'bill' },
    { key: '25', value: 25, label: '25 gourdes', short: '25 G', kind: 'bill' },
    { key: '50', value: 50, label: '50 gourdes', short: '50 G', kind: 'bill' },
    { key: '100', value: 100, label: '100 gourdes', short: '100 G', kind: 'bill' },
    { key: '250', value: 250, label: '250 gourdes', short: '250 G', kind: 'bill' },
    { key: '500', value: 500, label: '500 gourdes', short: '500 G', kind: 'bill' },
    { key: '1000', value: 1000, label: '1000 gourdes', short: '1000 G', kind: 'bill' },
  ],
  usd: [
    { key: '0.01', value: 0.01, label: 'Pennies (1¢)', short: '1¢', kind: 'coin' },
    { key: '0.05', value: 0.05, label: 'Nickels (5¢)', short: '5¢', kind: 'coin' },
    { key: '0.1', value: 0.1, label: 'Dimes (10¢)', short: '10¢', kind: 'coin' },
    { key: '0.25', value: 0.25, label: 'Quarters (25¢)', short: '25¢', kind: 'coin' },
    { key: '1', value: 1, label: '1 dollar', short: '$1', kind: 'bill' },
    { key: '5', value: 5, label: '5 dollars', short: '$5', kind: 'bill' },
    { key: '10', value: 10, label: '10 dollars', short: '$10', kind: 'bill' },
    { key: '20', value: 20, label: '20 dollars', short: '$20', kind: 'bill' },
    { key: '50', value: 50, label: '50 dollars', short: '$50', kind: 'bill' },
    { key: '100', value: 100, label: '100 dollars', short: '$100', kind: 'bill' },
  ],
}

/** Amount fields entered directly, in the order shown on the form. */
export const AMOUNT_FIELDS = ['rolled_coins', 'checks', 'paid_outs', 'deposit', 'bank_till'] as const
export type AmountField = typeof AMOUNT_FIELDS[number]
export const AMOUNT_LABELS: Record<AmountField, { label: string; hint: string }> = {
  rolled_coins: { label: 'Rouleaux de pièces', hint: 'Montant total des rouleaux' },
  checks: { label: 'Chèques', hint: 'Montant total des chèques' },
  paid_outs: { label: 'Sorties de caisse', hint: 'Paiements faits depuis la caisse (avec reçu)' },
  deposit: { label: 'Dépôt / Retrait', hint: 'Montant retiré vers le coffre ou la banque' },
  bank_till: { label: 'Fond de caisse', hint: 'Montant fixe qui doit rester dans la caisse' },
}

export type CurrencyDetail = { counts: Record<string, number> } & Record<AmountField, number>
export const emptyDetail = (bankTill = 0): CurrencyDetail => ({ counts: {}, rolled_coins: 0, checks: 0, paid_outs: 0, deposit: 0, bank_till: bankTill })

export const SHIFTS: { value: Shift; label: string }[] = [
  { value: 'AM', label: 'Matin' },
  { value: 'PM', label: 'Après-midi' },
  { value: 'NIGHT', label: 'Nuit' },
]
export const DIRECTIONS: { value: Direction; label: string; short: string }[] = [
  { value: 'in', label: 'Début de quart', short: 'Début' },
  { value: 'out', label: 'Fin de quart', short: 'Fin' },
]

const cents = (value: number) => Math.round(value * 100) / 100

export const cashCounted = (currency: Currency, detail: CurrencyDetail) =>
  cents(DENOMINATIONS[currency].reduce((sum, item) => sum + item.value * (detail.counts[item.key] ?? 0), 0))

/** Total = cash counted + rolled coins + checks + paid-out receipts. */
export const countTotal = (currency: Currency, detail: CurrencyDetail) =>
  cents(cashCounted(currency, detail) + detail.rolled_coins + detail.checks + detail.paid_outs)

/** Over/short = total − deposit/drop − bank till: 0 when the drawer balances. */
export const overShort = (currency: Currency, detail: CurrencyDetail) =>
  cents(countTotal(currency, detail) - detail.deposit - detail.bank_till)

/** Keeps only positive whole quantities and non-negative amounts. */
export function cleanDetail(detail: CurrencyDetail): CurrencyDetail {
  const counts = Object.fromEntries(Object.entries(detail.counts).filter(([, qty]) => Number.isInteger(qty) && qty > 0))
  return { counts, ...Object.fromEntries(AMOUNT_FIELDS.map((field) => [field, Math.max(0, cents(Number(detail[field]) || 0))])) } as CurrencyDetail
}

export const CURRENCY_LABELS: Record<Currency, { name: string; code: string; symbol: string }> = {
  htg: { name: 'Gourdes', code: 'HTG', symbol: 'G' },
  usd: { name: 'Dollars US', code: 'USD', symbol: '$' },
}

export const formatCurrency = (currency: Currency, value: number) =>
  new Intl.NumberFormat('fr-HT', { style: 'currency', currency: currency === 'htg' ? 'HTG' : 'USD', minimumFractionDigits: 2 }).format(value)
