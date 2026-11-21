import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { printSection } from '../lib/print'
import { loadCompany, type Company, type TicketFormat } from '../services/companyService'
import { TestVersionBanner } from './TestVersionBanner'

export type TicketLine = { label: string; quantity?: string; amount?: string; detail?: string; strong?: boolean }
export type TicketData = {
  title: string
  /** Document number, date and time, cashier, customer… */
  meta: [string, string][]
  lines?: TicketLine[]
  totals?: TicketLine[]
  notes?: ReactNode
  /** Text under the totals (validity, signatures…). */
  footer?: ReactNode
}

/**
 * Transaction document laid out for an 80 mm thermal printer (72 mm printable),
 * also printable on A4/Letter. Hidden on screen; printed alone by useTicketPrinter.
 */
export function ThermalTicket({ data, company, sectionRef }: { data: TicketData; company: Company | null; sectionRef: Ref<HTMLElement> }) {
  return <section ref={sectionRef} aria-label={data.title} className="ticket print-only mx-auto hidden w-[72mm] bg-white font-sans text-[9.5pt] leading-snug text-black">
    <TestVersionBanner className="mb-2 justify-center text-[8pt]" />
    <header className="text-center">
      {company?.logo_url && <img src={company.logo_url} alt="" className="mx-auto mb-1 max-h-14 max-w-[40mm] object-contain" />}
      <p className="text-[12pt] font-bold uppercase">{company?.name ?? 'Makèt Peyizan'}</p>
      {company?.address && <p>{company.address}</p>}
      {(company?.phone || company?.email) && <p>{[company.phone, company.email].filter(Boolean).join(' · ')}</p>}
      {company?.tax_id && <p>NIF : {company.tax_id}</p>}
    </header>
    <p className="mt-2 border-y border-dashed border-black py-1 text-center text-[10.5pt] font-bold uppercase">{data.title}</p>
    <dl className="mt-1.5 space-y-0.5">{data.meta.map(([label, value]) => <div key={label} className="flex justify-between gap-2"><dt>{label}</dt><dd className="text-right font-medium">{value}</dd></div>)}</dl>
    {data.lines && data.lines.length > 0 && <div className="mt-2 border-t border-dashed border-black pt-1.5">
      {data.lines.map((line, index) => <div key={index} className="py-0.5">
        <div className="flex justify-between gap-2"><span className={line.strong ? 'font-bold' : ''}>{line.label}</span>{line.amount && !line.quantity && <span className="whitespace-nowrap text-right tabular-nums">{line.amount}</span>}</div>
        {line.quantity && <div className="flex justify-between gap-2 pl-2 text-[8.5pt]"><span>{line.quantity}</span><span className="whitespace-nowrap tabular-nums">{line.amount}</span></div>}
        {line.detail && <div className="pl-2 text-[8pt]">{line.detail}</div>}
      </div>)}
    </div>}
    {data.totals && data.totals.length > 0 && <div className="mt-1.5 space-y-0.5 border-t border-dashed border-black pt-1.5">
      {data.totals.map((line) => <div key={line.label} className={`flex justify-between gap-2 ${line.strong ? 'text-[11pt] font-bold' : ''}`}><span>{line.label}</span><span className="whitespace-nowrap tabular-nums">{line.amount}</span></div>)}
    </div>}
    {data.notes && <div className="mt-2 border-t border-dashed border-black pt-1.5 text-[8.5pt]">{data.notes}</div>}
    <footer className="mt-3 text-center text-[8pt]">
      {data.footer}
      {company?.receipt_footer && <p className="mt-1">{company.receipt_footer}</p>}
      <p className="mt-1">Imprimé le {new Date().toLocaleString('fr-HT', { dateStyle: 'short', timeStyle: 'short' })}</p>
    </footer>
  </section>
}

/** Company details, and printing of a ticket in the format chosen in Paramètres (80 mm by default). */
export function useTicketPrinter() {
  const ref = useRef<HTMLElement>(null)
  const [company, setCompany] = useState<(Company & { ticketFormat: TicketFormat }) | null>(null)
  useEffect(() => { void loadCompany().then(setCompany) }, [])
  const print = () => printSection(ref.current, { thermal: (company?.ticketFormat ?? '80mm') === '80mm' })
  return { ref, company, print }
}

export const ticketMoney = (value: number, currency = 'HTG') => `${value.toLocaleString('fr-HT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
export const ticketDate = (value: string | Date) => new Date(value).toLocaleString('fr-HT', { dateStyle: 'short', timeStyle: 'short' })

/** For lists: `print(data)` lays out that ticket and prints it; place `element` in the page. */
export function useTicket() {
  const printer = useTicketPrinter()
  const [data, setData] = useState<TicketData | null>(null)
  useEffect(() => {
    if (!data) return
    const timer = window.setTimeout(printer.print, 80)
    return () => window.clearTimeout(timer)
  }, [data])
  return {
    element: data ? <ThermalTicket data={data} company={printer.company} sectionRef={printer.ref} /> : null,
    print: (next: TicketData) => setData({ ...next }),
  }
}
