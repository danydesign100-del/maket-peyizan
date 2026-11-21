import type { JournalEntryDraft, JournalEntryWithLines, JournalLineDraft } from '../../types/accounting'

const today = () => new Date().toLocaleDateString('en-CA')
export const emptyLine = (account_id = ''): JournalLineDraft => ({ account_id, description: '', debit: 0, credit: 0 })
export function draftFromEntry(entry: JournalEntryWithLines): JournalEntryDraft {
  return {
    id: entry.id, entry_date: entry.entry_date, description: entry.description, reference: entry.reference ?? '',
    entry_type: entry.entry_type === 'regularisation' || entry.entry_type === 'opening' ? entry.entry_type : 'standard',
    regularisation_kind: entry.regularisation_kind ?? 'other',
    justification: entry.justification ?? '',
    lines: [...entry.lines].sort((a, b) => a.line_number - b.line_number).map((line) => ({ account_id: line.account_id, description: line.description ?? '', debit: Number(line.debit_amount), credit: Number(line.credit_amount) })),
  }
}

export const newDraft = (accountId = '', type: JournalEntryDraft['entry_type'] = 'standard'): JournalEntryDraft =>
  ({ entry_date: today(), description: '', reference: '', entry_type: type, regularisation_kind: 'accrued_expense', justification: '', lines: [emptyLine(accountId), emptyLine()] })
