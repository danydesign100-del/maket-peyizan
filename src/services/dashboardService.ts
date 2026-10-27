import { getSupabaseClient, isLocalDbConfigured } from '../lib/supabase'
import { localApi } from '../lib/localApi'

export async function getInventoryMetrics() {
  if (isLocalDbConfigured) {
    const rows = await localApi.query<{ product_count: number; out_of_stock: number; low_stock: number; stock_value: number }>(`
      select count(*) as product_count,
        coalesce(sum(case when stock_quantity = 0 then 1 else 0 end), 0) as out_of_stock,
        coalesce(sum(case when stock_quantity > 0 and stock_quantity <= minimum_stock then 1 else 0 end), 0) as low_stock,
        coalesce(sum(stock_quantity * purchase_price), 0) as stock_value
      from products where active = 1
    `)
    const row = rows[0] ?? { product_count: 0, out_of_stock: 0, low_stock: 0, stock_value: 0 }
    return { productCount: Number(row.product_count), outOfStock: Number(row.out_of_stock), lowStock: Number(row.low_stock), stockValue: Number(row.stock_value) }
  }
  const client = getSupabaseClient()
  const [products, outOfStock] = await Promise.all([
    client.from('products').select('stock_quantity, cost_price, min_stock_quantity').eq('is_active', true),
    client.from('products').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('stock_quantity', 0),
  ])
  if (products.error) throw products.error
  if (outOfStock.error) throw outOfStock.error
  return { productCount: products.data.length, outOfStock: outOfStock.count ?? 0, lowStock: products.data.filter((product) => Number(product.stock_quantity) > 0 && Number(product.stock_quantity) <= Number(product.min_stock_quantity)).length, stockValue: products.data.reduce((total, product) => total + Number(product.stock_quantity) * Number(product.cost_price), 0) }
}

export async function getSalesMetrics() {
  const today = new Date().toISOString().split('T')[0]
  if (isLocalDbConfigured) {
    const rows = await localApi.query<{ sales_count: number; total_sales: number; transaction_count: number }>(`
      select 
        count(*) as sales_count,
        coalesce(sum(total_amount), 0) as total_sales,
        count(distinct id) as transaction_count
      from sales 
      where sold_at >= ? and status = 'completed'
    `, [today])
    const row = rows[0] ?? { sales_count: 0, total_sales: 0, transaction_count: 0 }
    return { salesCount: Number(row.sales_count), totalSales: Number(row.total_sales), transactionCount: Number(row.transaction_count) }
  }
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('sales')
    .select('total_amount')
    .gte('sold_at', today)
    .eq('status', 'completed')
  if (error) throw error
  return { 
    salesCount: data.length, 
    totalSales: data.reduce((sum, sale) => sum + Number(sale.total_amount), 0),
    transactionCount: data.length
  }
}
