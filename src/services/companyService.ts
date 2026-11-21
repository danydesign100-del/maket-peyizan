import { readSettings } from './settingsService'

/** Company details printed on every document (Paramètres › Entreprise). */
export type Company = { name: string; logo_url?: string; address?: string; phone?: string; tax_id?: string; email?: string; receipt_footer?: string }
/** Tickets (sales, cash, proformas) print on an 80 mm thermal printer or on A4/Letter paper. */
export type TicketFormat = '80mm' | 'a4'

const KEYS = ['company.name', 'company.logo_url', 'company.address', 'company.phone', 'company.tax_id', 'company.email', 'company.receipt_footer', 'print.ticket_format']
const text = (value: unknown) => typeof value === 'string' ? value.trim() : value === null || value === undefined ? '' : String(value)

export async function loadCompany(): Promise<Company & { ticketFormat: TicketFormat }> {
  const values = await readSettings(KEYS)
  return {
    name: text(values['company.name']) || 'Makèt Peyizan',
    logo_url: text(values['company.logo_url']) || undefined,
    address: text(values['company.address']) || undefined,
    phone: text(values['company.phone']) || undefined,
    tax_id: text(values['company.tax_id']) || undefined,
    email: text(values['company.email']) || undefined,
    receipt_footer: text(values['company.receipt_footer']) || undefined,
    ticketFormat: values['print.ticket_format'] === 'a4' ? 'a4' : '80mm',
  }
}
