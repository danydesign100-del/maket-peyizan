import type { AccountBalance, AccountType } from '../types/accounting'

// Financial statements built from account_balances(from, to): every report uses
// the same posted entries, so their figures always agree.
//   net (debit-positive)  = debit − credit
//   a credit-nature figure = credit − debit

const n = (value: number | string) => Number(value)
// `|| 0` turns a rounded −0 into 0, so no « -0,00 » is ever displayed.
export const cents = (value: number) => Math.round(value * 100) / 100 || 0
const sum = <T>(items: T[], pick: (item: T) => number) => cents(items.reduce((total, item) => total + pick(item), 0))
/** A signed net amount shown in the debit or the credit column. */
export const sides = (net: number) => ({ debit: net > 0 ? cents(net) : 0, credit: net < 0 ? cents(-net) : 0 })
export const isBalanced = (debit: number, credit: number) => Math.abs(debit - credit) < 0.005

// ---------------------------------------------------------------------------
// Trial balance (balance de vérification)
// ---------------------------------------------------------------------------
export type TrialGroupId = 'asset_short' | 'asset_long' | 'asset_unclassified' | 'liability_short' | 'liability_long' | 'liability_unclassified' | 'equity' | 'revenue' | 'expense'
export const TRIAL_GROUP_LABELS: Record<TrialGroupId, string> = {
  asset_short: 'Actif à court terme', asset_long: 'Actif à long terme', asset_unclassified: 'Actif (terme non précisé)',
  liability_short: 'Passif à court terme', liability_long: 'Passif à long terme', liability_unclassified: 'Passif (terme non précisé)',
  equity: 'Capitaux propres', revenue: 'Produits', expense: 'Charges',
}
const GROUP_ORDER: TrialGroupId[] = ['asset_short', 'asset_long', 'asset_unclassified', 'liability_short', 'liability_long', 'liability_unclassified', 'equity', 'revenue', 'expense']

export type Columns = { openingDebit: number; openingCredit: number; movementDebit: number; movementCredit: number; closingDebit: number; closingCredit: number }
export type TrialRow = Columns & { account: AccountBalance }
export type TrialGroup = { id: TrialGroupId; rows: TrialRow[]; totals: Columns }

const groupOf = (row: AccountBalance): TrialGroupId => {
  if (row.account_type === 'asset' || row.account_type === 'liability') return `${row.account_type}_${row.term ?? 'unclassified'}` as TrialGroupId
  return row.account_type as TrialGroupId
}
const totalColumns = (rows: Columns[]): Columns => ({
  openingDebit: sum(rows, (r) => r.openingDebit), openingCredit: sum(rows, (r) => r.openingCredit),
  movementDebit: sum(rows, (r) => r.movementDebit), movementCredit: sum(rows, (r) => r.movementCredit),
  closingDebit: sum(rows, (r) => r.closingDebit), closingCredit: sum(rows, (r) => r.closingCredit),
})

/**
 * `before`: regularisation entries of the period are left out (balance avant régularisation).
 * Opening balances are netted per account; movements are shown gross.
 */
export function trialBalance(balances: AccountBalance[], { includeRegularisation = true, includeEmpty = false } = {}) {
  const rows: TrialRow[] = balances.map((account) => {
    const movementDebit = cents(n(account.period_debit) + (includeRegularisation ? n(account.regularisation_debit) : 0))
    const movementCredit = cents(n(account.period_credit) + (includeRegularisation ? n(account.regularisation_credit) : 0))
    const openingNet = n(account.opening_debit) - n(account.opening_credit)
    const opening = sides(openingNet)
    const closing = sides(openingNet + movementDebit - movementCredit)
    return { account, openingDebit: opening.debit, openingCredit: opening.credit, movementDebit, movementCredit, closingDebit: closing.debit, closingCredit: closing.credit }
  }).filter((row) => includeEmpty || row.openingDebit || row.openingCredit || row.movementDebit || row.movementCredit)
  const groups: TrialGroup[] = GROUP_ORDER.map((id) => {
    const groupRows = rows.filter((row) => groupOf(row.account) === id)
    return { id, rows: groupRows, totals: totalColumns(groupRows) }
  }).filter((group) => group.rows.length > 0)
  return { groups, totals: totalColumns(rows) }
}

// ---------------------------------------------------------------------------
// Income statement (état des résultats)
// ---------------------------------------------------------------------------
export type StatementLine = { account: AccountBalance; amount: number }
const periodNet = (row: AccountBalance) => n(row.period_debit) + n(row.regularisation_debit) - n(row.period_credit) - n(row.regularisation_credit)
const lines = (balances: AccountBalance[], type: AccountType, group: string, sign: 1 | -1) =>
  balances.filter((row) => row.account_type === type && row.statement_group === group)
    .map((account) => ({ account, amount: cents(sign * periodNet(account)) }))
    .filter((line) => line.amount !== 0)

/**
 * Net sales = gross sales − discounts − returns/cancellations (recorded as sales reductions).
 * Gross margin = net sales − cost of goods sold.
 * Net result = all revenue − all expenses of the period (posted entries, regularisations included).
 */
export function incomeStatement(balances: AccountBalance[]) {
  const sales = lines(balances, 'revenue', 'sales', -1)
  const deductions = lines(balances, 'revenue', 'sales_deduction', 1)
  const otherIncome = lines(balances, 'revenue', 'other_income', -1)
  const cogs = lines(balances, 'expense', 'cogs', 1)
  const expenses = lines(balances, 'expense', 'expense', 1)
  const grossSales = sum(sales, (l) => l.amount)
  const totalDeductions = sum(deductions, (l) => l.amount)
  const netSales = cents(grossSales - totalDeductions)
  const totalCogs = sum(cogs, (l) => l.amount)
  const grossMargin = cents(netSales - totalCogs)
  const totalOtherIncome = sum(otherIncome, (l) => l.amount)
  const totalExpenses = sum(expenses, (l) => l.amount)
  const netResult = cents(grossMargin + totalOtherIncome - totalExpenses)
  // Cross-check: the same result computed directly from every revenue and expense account.
  const control = cents(-sum(balances.filter((row) => row.account_type === 'revenue' || row.account_type === 'expense'), periodNet))
  return {
    sales, deductions, otherIncome, cogs, expenses,
    grossSales, totalDeductions, netSales, totalCogs, grossMargin, marginRate: netSales ? grossMargin / netSales : null,
    totalOtherIncome, totalExpenses, netResult,
    totalRevenue: cents(netSales + totalOtherIncome), totalCharges: cents(totalCogs + totalExpenses),
    consistent: isBalanced(control, netResult),
  }
}

// ---------------------------------------------------------------------------
// Balance sheet (bilan) at a date
// ---------------------------------------------------------------------------
export type SheetSection = { label: string; lines: StatementLine[]; total: number }
const closingNet = (row: AccountBalance) => n(row.closing_debit) - n(row.closing_credit)

/**
 * `balances` must come from account_balances(start of the financial year, date):
 * the opening of revenue/expense accounts is then the prior years' result, and
 * their movements are the current year's result.
 * Contra-accounts (e.g. accumulated depreciation) appear as negative amounts.
 */
export function balanceSheet(balances: AccountBalance[]) {
  const section = (label: string, type: 'asset' | 'liability', term: 'short' | 'long' | null, sign: 1 | -1): SheetSection => {
    const sectionLines = balances.filter((row) => row.account_type === type && row.term === term)
      .map((account) => ({ account, amount: cents(sign * closingNet(account)) })).filter((line) => line.amount !== 0)
    return { label, lines: sectionLines, total: sum(sectionLines, (l) => l.amount) }
  }
  const assets = [section('Actif à court terme', 'asset', 'short', 1), section('Actif à long terme', 'asset', 'long', 1), section('Actif (terme non précisé)', 'asset', null, 1)].filter((s) => s.lines.length || s.label !== 'Actif (terme non précisé)')
  const liabilities = [section('Passif à court terme', 'liability', 'short', -1), section('Passif à long terme', 'liability', 'long', -1), section('Passif (terme non précisé)', 'liability', null, -1)].filter((s) => s.lines.length || s.label !== 'Passif (terme non précisé)')
  const equityLines = balances.filter((row) => row.account_type === 'equity').map((account) => ({ account, amount: cents(-closingNet(account)) })).filter((line) => line.amount !== 0)
  const resultAccounts = balances.filter((row) => row.account_type === 'revenue' || row.account_type === 'expense')
  const priorResults = cents(-sum(resultAccounts, (row) => n(row.opening_debit) - n(row.opening_credit)))
  const currentResult = cents(-sum(resultAccounts, periodNet))
  const totalEquity = cents(sum(equityLines, (l) => l.amount) + priorResults + currentResult)
  const totalAssets = sum(assets, (s) => s.total)
  const totalLiabilities = sum(liabilities, (s) => s.total)
  const totalLiabilitiesAndEquity = cents(totalLiabilities + totalEquity)
  return { assets, liabilities, equityLines, priorResults, currentResult, totalEquity, totalAssets, totalLiabilities, totalLiabilitiesAndEquity, difference: cents(totalAssets - totalLiabilitiesAndEquity) }
}

/** Start of the financial year containing `date` (calendar year). */
export const financialYearStart = (date: string) => `${date.slice(0, 4)}-01-01`

// ---------------------------------------------------------------------------
// Partners' equity (état de l'avoir des associés)
// ---------------------------------------------------------------------------
export type PartnerInput = { id: string; name: string; share_percent: number | null; capital_account_id: string; current_account_id: string; is_active: boolean }
export type PartnerMovementInput = { account_id: string; debit_amount: number | string; credit_amount: number | string; entry: { entry_number: string; entry_date: string; description: string; reference: string | null; entry_type: string } }
export type PartnerCategory = 'capital_increase' | 'contribution' | 'withdrawal' | 'adjustment'
export const PARTNER_CATEGORY_LABELS: Record<PartnerCategory, string> = { capital_increase: 'Augmentation de capital', contribution: 'Apport supplémentaire', withdrawal: 'Retrait / distribution', adjustment: 'Autre ajustement' }
export type PartnerDetail = { category: PartnerCategory; amount: number; date: string; number: string; reference: string | null; description: string }
export type PartnerEquity = {
  partner: PartnerInput; share: number
  opening: number; capitalIncreases: number; contributions: number; resultShare: number; withdrawals: number; adjustments: number; closing: number
  details: PartnerDetail[]
}

/**
 * Per partner, for the period of `balances` (account_balances(from, to)) and the
 * posted `movements` on partner accounts in that period:
 *   closing = opening + capital increases + contributions + share of result ± adjustments − withdrawals
 * Credits to the capital account are capital increases, credits to the current
 * account are contributions, debits to it are withdrawals; regularisation
 * entries and capital reductions are other adjustments. The opening includes
 * the partner's share of prior unallocated results. Only active partners share
 * the result; whatever is not allocated stays in `unassigned`.
 */
export function partnersEquity(partners: PartnerInput[], balances: AccountBalance[], movements: PartnerMovementInput[]) {
  const byId = new Map(balances.map((row) => [row.account_id, row]))
  const resultAccounts = balances.filter((row) => row.account_type === 'revenue' || row.account_type === 'expense')
  const priorResult = cents(-sum(resultAccounts, (row) => n(row.opening_debit) - n(row.opening_credit)))
  const periodResult = cents(-sum(resultAccounts, periodNet))
  const creditOpening = (accountId: string) => { const row = byId.get(accountId); return row ? n(row.opening_credit) - n(row.opening_debit) : 0 }
  const shareOf = (partner: PartnerInput) => partner.is_active ? n(partner.share_percent ?? 0) / 100 : 0

  const rows: PartnerEquity[] = partners.map((partner) => {
    const share = shareOf(partner)
    const details: PartnerDetail[] = movements
      .filter((line) => line.account_id === partner.capital_account_id || line.account_id === partner.current_account_id)
      .map((line) => {
        const amount = cents(n(line.credit_amount) - n(line.debit_amount))
        const capital = line.account_id === partner.capital_account_id
        const category: PartnerCategory = line.entry.entry_type === 'regularisation' ? 'adjustment'
          : capital ? (amount > 0 ? 'capital_increase' : 'adjustment')
          : amount > 0 ? 'contribution' : 'withdrawal'
        return { category, amount, date: line.entry.entry_date, number: line.entry.entry_number, reference: line.entry.reference, description: line.entry.description }
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number))
    const total = (category: PartnerCategory) => sum(details.filter((d) => d.category === category), (d) => d.amount)
    const opening = cents(creditOpening(partner.capital_account_id) + creditOpening(partner.current_account_id) + share * priorResult)
    const capitalIncreases = total('capital_increase')
    const contributions = total('contribution')
    const withdrawals = cents(-total('withdrawal'))
    const adjustments = total('adjustment')
    const resultShare = cents(share * periodResult)
    return { partner, share, opening, capitalIncreases, contributions, resultShare, withdrawals, adjustments, closing: cents(opening + capitalIncreases + contributions + resultShare + adjustments - withdrawals), details }
  })

  const partnerAccounts = new Set(partners.flatMap((partner) => [partner.capital_account_id, partner.current_account_id]))
  const allocated = partners.reduce((total, partner) => total + shareOf(partner), 0)
  const otherEquity = sum(balances.filter((row) => row.account_type === 'equity' && !partnerAccounts.has(row.account_id)), (row) => n(row.closing_credit) - n(row.closing_debit))
  const unallocatedResult = cents((1 - allocated) * (priorResult + periodResult))
  const totals = {
    opening: sum(rows, (r) => r.opening), capitalIncreases: sum(rows, (r) => r.capitalIncreases), contributions: sum(rows, (r) => r.contributions),
    resultShare: sum(rows, (r) => r.resultShare), withdrawals: sum(rows, (r) => r.withdrawals), adjustments: sum(rows, (r) => r.adjustments), closing: sum(rows, (r) => r.closing),
  }
  return { rows, totals, priorResult, periodResult, allocatedPercent: cents(allocated * 100), otherEquity, unallocatedResult, totalEquity: cents(totals.closing + otherEquity + unallocatedResult) }
}

// ---------------------------------------------------------------------------
// Sales report (from the sales themselves, reconciled with the accounts)
// ---------------------------------------------------------------------------
export type SaleRecord = { id: string; sale_number: string; sold_at: string; status: string; subtotal: number | string; discount_amount: number | string; tax_amount: number | string; total_amount: number | string; accounting_synced: boolean; accounting_error: string | null; cancel_reason: string | null; customer?: { full_name: string } | null; payments?: { method: string; amount: number | string }[] }
export type SalesCategory = 'all' | 'discounted' | 'refunded' | 'cancelled' | 'completed' | 'pending'

/**
 * Net sales = gross sales − discounts − returns − cancellations (all excluding VAT),
 * the same definition as the income statement, so the two can be compared.
 * Commissions are not recorded by the application: shown as 0.
 */
export function salesSummary(sales: SaleRecord[]) {
  const live = sales.filter((sale) => sale.status !== 'draft')
  const net = (sale: SaleRecord) => n(sale.subtotal) - n(sale.discount_amount)
  const completed = live.filter((sale) => sale.status === 'completed')
  const refunded = live.filter((sale) => sale.status === 'refunded')
  const cancelled = live.filter((sale) => sale.status === 'cancelled')
  const grossSales = sum(live, (sale) => n(sale.subtotal))
  const discounts = sum(live, (sale) => n(sale.discount_amount))
  const returns = sum(refunded, net)
  const cancellations = sum(cancelled, net)
  const byMethod = new Map<string, number>()
  for (const sale of completed) for (const payment of sale.payments ?? []) byMethod.set(payment.method, cents((byMethod.get(payment.method) ?? 0) + n(payment.amount)))
  return {
    count: live.length, completedCount: completed.length, refundedCount: refunded.length, cancelledCount: cancelled.length,
    grossSales, discounts, commissions: 0, returns, cancellations,
    netSales: cents(grossSales - discounts - returns - cancellations),
    taxCollected: sum(completed, (sale) => n(sale.tax_amount)),
    collected: sum(completed, (sale) => n(sale.total_amount)),
    byMethod: [...byMethod].map(([method, amount]) => ({ method, amount })).sort((a, b) => b.amount - a.amount),
    pending: live.filter((sale) => !sale.accounting_synced),
  }
}

export function salesOf(sales: SaleRecord[], category: SalesCategory) {
  const live = sales.filter((sale) => sale.status !== 'draft')
  if (category === 'discounted') return live.filter((sale) => n(sale.discount_amount) > 0)
  if (category === 'pending') return live.filter((sale) => !sale.accounting_synced)
  if (category === 'all') return live
  return live.filter((sale) => sale.status === category)
}
