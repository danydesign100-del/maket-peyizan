export type Category = { id: string; name: string; description: string | null; active: boolean; created_at: string; updated_at: string; product_count?: number }
export type CategoryInput = Pick<Category, 'name' | 'description'>
export type SupplierOption = { id: string; name: string }
export type Product = { id: string; barcode: string | null; name: string; category_id: string | null; supplier_id: string | null; brand: string | null; description: string | null; purchase_price: number; selling_price: number; proforma_price: number; stock_quantity: number; minimum_stock: number; unit: string; image_url: string | null; expiration_date: string | null; active: boolean; created_at: string; updated_at: string; category?: { name: string } | null; supplier?: { name: string } | null }
export type ProductInput = Omit<Product, 'id' | 'created_at' | 'updated_at' | 'category' | 'supplier' | 'image_url'> & { image_url?: string | null }
export type Customer = { id: string; customer_number: string; full_name: string; phone: string | null; email: string | null; address: string | null; company_name: string | null; tax_id: string | null; customer_type: 'individual' | 'business'; notes: string | null; active: boolean; created_at: string; updated_at: string }
export type CustomerInput = Omit<Customer, 'id' | 'customer_number' | 'active' | 'created_at' | 'updated_at'>
