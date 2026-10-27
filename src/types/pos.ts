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
}
