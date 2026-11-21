import { useEffect, useState } from 'react'
import { loadCompany, type Company } from '../services/companyService'
import { TestVersionBanner } from './TestVersionBanner'

/**
 * Header of printed reports: company name and logo when configured, report
 * title, period or reference date, and print date. Hidden on screen.
 */
export function PrintHeader({ title, period, note }: { title: string; period: string; note?: string }) {
  const [company, setCompany] = useState<Company>({ name: '' })
  useEffect(() => { void loadCompany().then(setCompany) }, [])
  const printedAt = new Intl.DateTimeFormat('fr-HT', { dateStyle: 'long', timeStyle: 'short' }).format(new Date())
  return <div className="hidden print:block">
    <div className="flex items-start justify-between gap-6 border-b-2 border-slate-800 pb-3">
      <div className="flex items-center gap-3">
        {company.logo_url && <img src={company.logo_url} alt="" className="h-14 w-14 object-contain" />}
        <div>
          <p className="text-lg font-bold text-slate-950">{company.name || 'Makèt Peyizan'}</p>
          {[company.address, company.phone, company.tax_id && `NIF ${company.tax_id}`].filter(Boolean).length > 0 && <p className="text-xs text-slate-600">{[company.address, company.phone, company.tax_id && `NIF ${company.tax_id}`].filter(Boolean).join(' · ')}</p>}
        </div>
      </div>
      <p className="text-right text-xs text-slate-600">Imprimé le {printedAt}</p>
    </div>
    <TestVersionBanner className="mt-3" />
    <h1 className="mt-4 text-xl font-bold text-slate-950">{title}</h1>
    <p className="text-sm font-medium text-slate-700">{period}</p>
    {note && <p className="mt-1 text-xs text-slate-600">{note}</p>}
  </div>
}
