// Types pour le module de caisse/POS

export type CartItem = {
  productId: string
  barcode: string | null
  name: string
  unit: string
  quantity: number
  unitPrice: number
  discount: number
  taxRate: number
  lineTotal: number
  /** Stock available when the line was added (server stock minus sales still waiting on this device). */
  available?: number
}

export type Cart = {
  items: CartItem[]
  subtotal: number
  totalDiscount: number
  totalTax: number
  totalAmount: number
  customerId: string | null
  customerName: string | null
  notes: string
}

/** Payments are recorded manually; MonCash/NatCash are not API-verified. */
export type PaymentMethod = 'cash' | 'card' | 'moncash' | 'natcash' | 'bank_transfer' | 'check'

/** Labels of every method stored in payments (mobile_money and other: sales recorded before MonCash/NatCash were separated). */
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Espèces', card: 'Carte', moncash: 'MonCash', natcash: 'NatCash', mobile_money: 'Monnaie électronique',
  bank_transfer: 'Virement', check: 'Chèque', other: 'Autre',
}

export type Payment = {
  method: PaymentMethod
  amount: number
  reference?: string
}

export type CashSession = {
  id: string
  opened_by: string
  opened_at: string
  opening_amount: number
  closed_at: string | null
  closing_amount: number | null
  notes: string | null
  created_at: string
  updated_at: string
  opener?: { full_name: string } | null
}

export type CashSessionInput = {
  opening_amount: number
  notes?: string
}

export type SaleInput = {
  customer_id: string | null
  items: Omit<CartItem, 'lineTotal'>[]
  payments: Payment[]
  notes?: string
  /** Real time of the sale (kept when it is sent later). */
  soldAt?: string
  /** Proforma cashed by this sale (marked « transformée en vente » once the sale is on the server). */
  proformaId?: string
}
