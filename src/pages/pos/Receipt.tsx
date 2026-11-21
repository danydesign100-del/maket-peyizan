import type { Ref } from 'react'
import { ThermalTicket, ticketDate, ticketMoney } from '../../components/ThermalTicket'
import type { Company } from '../../services/companyService'
import { PAYMENT_METHOD_LABELS, type CartItem, type PaymentMethod } from '../../types/pos'

export type CompletedSale = { saleNumber: string; items: CartItem[]; subtotal: number; discount: number; tax: number; total: number; paid: number; change: number; customer: string | null; cashier?: string | null; method: PaymentMethod; reference: string | null; soldAt: string }

/** Sale ticket (80 mm), printed alone right after the sale. */
export function Receipt({ sale, company, sectionRef }: { sale: CompletedSale; company: Company | null; sectionRef: Ref<HTMLElement> }) {
  const method = PAYMENT_METHOD_LABELS[sale.method] ?? sale.method
  return <ThermalTicket sectionRef={sectionRef} company={company} data={{
    title: 'Ticket de vente',
    meta: [['N°', sale.saleNumber], ['Date', ticketDate(sale.soldAt)], ...(sale.cashier ? [['Caissier', sale.cashier] as [string, string]] : []), ...(sale.customer ? [['Client', sale.customer] as [string, string]] : [])],
    lines: sale.items.map((item) => ({ label: item.name, quantity: `${item.quantity} ${item.unit} × ${ticketMoney(item.unitPrice, '')}`.trim(), amount: ticketMoney(item.lineTotal, ''), detail: item.discount > 0 ? `Remise : − ${ticketMoney(item.discount, '')}` : undefined })),
    totals: [
      ...(sale.discount > 0 || sale.tax > 0 ? [{ label: 'Sous-total', amount: ticketMoney(sale.subtotal) }] : []),
      ...(sale.discount > 0 ? [{ label: 'Remises', amount: `− ${ticketMoney(sale.discount)}` }] : []),
      ...(sale.tax > 0 ? [{ label: 'Taxes', amount: ticketMoney(sale.tax) }] : []),
      { label: 'TOTAL', amount: ticketMoney(sale.total), strong: true },
      { label: `Payé (${method})`, amount: ticketMoney(sale.paid) },
      ...(sale.change > 0 ? [{ label: 'Monnaie rendue', amount: ticketMoney(sale.change) }] : []),
    ],
    notes: sale.reference ? <p>{sale.method === 'check' ? 'Chèque n°' : `ID de transaction ${method}`} : {sale.reference}</p> : undefined,
    // The message of Paramètres replaces the default thanks.
    footer: company?.receipt_footer ? undefined : <p className="font-semibold">Merci pour votre visite !</p>,
  }} />
}
