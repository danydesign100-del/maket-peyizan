export type Supplier = { id: string; name: string; category_id: string | null; category?: { name: string } | null; company_name: string | null; phone: string | null; email: string | null; address: string | null; tax_id: string | null; notes: string | null; active: boolean; created_at: string; updated_at: string }
export type SupplierInput = Omit<Supplier, 'id' | 'active' | 'created_at' | 'updated_at' | 'category'>
export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock'
export type StockMovementType = 'entry' | 'exit' | 'adjustment' | 'customer_return' | 'supplier_return'
export type StockMovement = { id: string; product_id: string; movement_type: StockMovementType; quantity: number; old_stock: number; new_stock: number; reason: string | null; supplier_id: string | null; purchase_price: number | null; movement_at: string; created_by: string; product?: { name: string; barcode: string | null } | null; user?: { full_name: string } | null }
/** Counterpart of a purchase or supplier return: 201000 Fournisseurs, 102000 Banque or 304000 (opening stock). */
export type StockSettlement = 'supplier' | 'bank' | 'opening'
export type StockMovementInput = { product_id: string; movement_type: StockMovementType; quantity: number; reason: string; supplier_id?: string | null; purchase_price?: number | null; reference_type?: string | null; reference_id?: string | null; movement_at?: string; settlement?: StockSettlement | null }
