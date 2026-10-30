import { ChevronLeft, ChevronRight, FileSpreadsheet, Plus, Save, Trash2, X } from 'lucide-react'
import { ImportDialog } from '../components/ImportDialog'
import { expenseImporter } from '../services/importers'
import { Skeleton, TableRowsSkeleton } from '../components/Skeleton'
import { useEffect, useState, type FormEvent } from 'react'
import { PageHeader } from '../components/PageHeader'
import { expenseService, type ExpenseInput, type MonthlyExpenses } from '../services/expenseService'
import { ColumnChart } from '../components/charts/ColumnChart'
import { useAuth } from '../contexts/AuthContext'

const emptyExpense: ExpenseInput = { label: '', amount: 0, expense_date: '', notes: '' }

const formatAmount = (value: number) => new Intl.NumberFormat('fr-HT', { style: 'currency', currency: 'HTG', maximumFractionDigits: 0 }).format(value)

export function ExpensesPage() {
  const [importing, setImporting] = useState(false)

  const { profile } = useAuth()
  const canManage = profile?.role?.code === 'director' || profile?.role?.code === 'administrator' || profile?.role?.code === 'accountant'
  
  const [expenses, setExpenses] = useState<any[]>([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState<ExpenseInput>(emptyExpense)
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [monthly, setMonthly] = useState<MonthlyExpenses[] | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const { data, error: requestError, count: total } = await expenseService.getExpenses(page)
      if (requestError) throw requestError
      setExpenses(data || [])
      setCount(total ?? 0)
      setError(null)
      void expenseService.getMonthlyTotals(6).then(setMonthly).catch(() => setMonthly([]))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur de chargement')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [page])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.label.trim()) return setError('Le libellé est obligatoire')
    if (form.amount <= 0) return setError('Le montant doit être positif')
    
    setSubmitting(true)
    setError(null)
    try {
      const { error: requestError } = await expenseService.createExpense(form)
      if (requestError) throw requestError
      setNotice('Dépense enregistrée')
      setOpen(false)
      setForm(emptyExpense)
      void load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible d\'enregistrer la dépense')
    } finally {
      setSubmitting(false)
    }
  }

  const deleteExpense = async (id: string) => {
    if (!confirm('Supprimer cette dépense ?')) return
    try {
      const { error: requestError } = await expenseService.deleteExpense(id)
      if (requestError) throw requestError
      setNotice('Dépense supprimée')
      void load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de supprimer')
    }
  }

  if (!canManage) {
    return (
      <div className="rounded-lg bg-red-50 p-6 text-red-800">
        <h2 className="text-lg font-semibold">Accès refusé</h2>
        <p className="mt-2">Seuls les directeurs, administrateurs et comptables peuvent gérer les dépenses.</p>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Dépenses" description="Enregistrement et suivi des dépenses opérationnelles" />
      
      {notice && <div className="mt-4 rounded bg-emerald-50 p-3 text-emerald-800">{notice}</div>}
      {error && <div className="mt-4 rounded bg-red-50 p-3 text-red-800">{error}</div>}
      
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setImporting(true)} className="ui-button-secondary"><FileSpreadsheet className="h-4 w-4" aria-hidden="true" />Importer</button>
        <button 
          onClick={() => { setForm(emptyExpense); setOpen(true) }}
          className="ui-button-primary"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />Nouvelle dépense
        </button>
      </div>

      <section className="ui-card mt-6 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div><h2 className="text-base font-bold text-slate-950">Dépenses des 6 derniers mois</h2><p className="mt-1 text-sm text-slate-600">Total des dépenses enregistrées par mois.</p></div>
          {monthly && monthly.length > 0 && <p className="text-sm text-slate-600">Ce mois : <strong className="text-slate-950">{formatAmount(monthly[monthly.length - 1].total)}</strong></p>}
        </div>
        <div className="mt-5">
          {monthly === null
            ? <div role="status" aria-label="Chargement" className="flex h-[200px] items-end gap-6 pl-11">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="flex-1 rounded-b-none" style={{ height: `${35 + ((index * 29) % 55)}%` }} />)}</div>
            : monthly.length === 0 ? <p className="ui-empty">Historique indisponible hors ligne.</p>
            : <ColumnChart ariaLabel="Dépenses par mois sur 6 mois" height={200} formatValue={formatAmount} highlightKey={monthly[monthly.length - 1].month}
              data={monthly.map((month) => ({ key: month.month, label: new Intl.DateTimeFormat('fr-HT', { month: 'short' }).format(new Date(`${month.month}-15T12:00:00`)), value: month.total, detail: `${month.count} dépense(s)` }))} />}
        </div>
      </section>

      {open && (
        <form onSubmit={submit} className="mt-6 grid gap-4 rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200 md:grid-cols-2">
          <h2 className="md:col-span-2 text-lg font-semibold">Nouvelle dépense</h2>
          
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-700">Libellé *</label>
            <input
              required
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              className="mt-1 w-full"
              placeholder="Ex: Loyer, Électricité, Fournitures..."
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-slate-700">Montant (HTG) *</label>
            <input
              required
              type="number"
              step="0.01"
              min="0"
              value={form.amount || ''}
              onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
              className="mt-1 w-full"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-slate-700">Date</label>
            <input
              type="date"
              value={form.expense_date || ''}
              onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
              className="mt-1 w-full"
            />
          </div>
          
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-700">Notes</label>
            <textarea
              value={form.notes || ''}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="mt-1 w-full"
              rows={3}
              placeholder="Détails supplémentaires..."
            />
          </div>
          
          <div className="md:col-span-2 flex gap-3">
            <button type="submit" disabled={submitting} className="ui-button-primary">
              <Save className="h-4 w-4" aria-hidden="true" />{submitting ? 'Enregistrement...' : 'Enregistrer'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="ui-button-secondary">
              <X className="h-4 w-4" aria-hidden="true" />Annuler
            </button>
          </div>
        </form>
      )}

      <div className="mt-6 overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <table className="ui-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Libellé</th>
              <th>Montant</th>
              <th>Notes</th>
              <th>Créé par</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableRowsSkeleton cols={6} />
            ) : expenses.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-slate-500">Aucune dépense</td></tr>
            ) : expenses.map((expense) => (
              <tr key={expense.id} className="border-t">
                <td className="p-3">{new Date(`${String(expense.expense_date).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-HT')}</td>
                <td className="p-3 font-medium">{expense.label}</td>
                <td className="p-3 font-medium">{Number(expense.amount).toFixed(2)} HTG</td>
                <td className="p-3 text-slate-600">{expense.notes || '—'}</td>
                <td className="p-3">{expense.created_by_name || '—'}</td>
                <td className="p-3">
                  <button
                    onClick={() => void deleteExpense(expense.id)}
                    className="inline-flex items-center gap-1.5 text-red-600 hover:text-red-800"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />Supprimer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {count > 20 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-slate-600">
            Affichage de {page * 20 + 1} à {Math.min((page + 1) * 20, count)} sur {count}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="ui-button-secondary disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />Précédent
            </button>
            <button
              onClick={() => setPage(page + 1)}
              disabled={(page + 1) * 20 >= count}
              className="ui-button-secondary disabled:opacity-50"
            >
              Suivant<ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
{importing && <ImportDialog importer={expenseImporter} onClose={() => setImporting(false)} onDone={(imported) => { setNotice(`${imported} dépense(s) importé(s).`); void load() }} />}    </div>
  )
}
