import { getSupabaseClient, isLocalDbConfigured } from '../lib/supabase'
import { localApi } from '../lib/localApi'
import type { Product } from '../types/catalog'
import { withOffline } from '../lib/offline/wrap'
import { getSnapshot } from '../lib/offline/snapshot'
import { isLowStock } from './productService'

async function fetchInventoryMetrics() {
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
    client.from('products').select('stock_quantity, purchase_price, minimum_stock').eq('active', true),
    client.from('products').select('*', { count: 'exact', head: true }).eq('active', true).eq('stock_quantity', 0),
  ])
  if (products.error) throw products.error
  if (outOfStock.error) throw outOfStock.error
  return { productCount: products.data.length, outOfStock: outOfStock.count ?? 0, lowStock: products.data.filter((product) => Number(product.stock_quantity) > 0 && Number(product.stock_quantity) <= Number(product.minimum_stock)).length, stockValue: products.data.reduce((total, product) => total + Number(product.stock_quantity) * Number(product.purchase_price), 0) }
}

async function fetchSalesMetrics() {
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

// SQLite stores UTC timestamps without a zone; Supabase returns ISO strings.
export const parseTimestamp = (value: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`)
export const localDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const daysAgo = (days: number) => { const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - days + 1); return date }

export type DailySales = { date: string; total: number; count: number }

/** Completed sales per local day, oldest first, including days without sales. */
async function fetchSalesTrend(days = 14): Promise<DailySales[]> {
  const start = daysAgo(days)
  const rows = isLocalDbConfigured
    ? await localApi.query<{ sold_at: string; total_amount: number }>(`select sold_at, total_amount from sales where status = 'completed' and sold_at >= ?`, [start.toISOString().replace('T', ' ').slice(0, 19)])
    : await (async () => {
      const { data, error } = await getSupabaseClient().from('sales').select('sold_at, total_amount').eq('status', 'completed').gte('sold_at', start.toISOString())
      if (error) throw error
      return (data ?? []) as { sold_at: string; total_amount: number }[]
    })()
  const byDay = new Map<string, DailySales>()
  for (let index = 0; index < days; index += 1) {
    const date = new Date(start); date.setDate(start.getDate() + index)
    byDay.set(localDay(date), { date: localDay(date), total: 0, count: 0 })
  }
  for (const row of rows) {
    const bucket = byDay.get(localDay(parseTimestamp(row.sold_at)))
    if (bucket) { bucket.total += Number(row.total_amount); bucket.count += 1 }
  }
  return [...byDay.values()]
}

export type TopProduct = { name: string; revenue: number; quantity: number }

/** Best-selling products by revenue over the last `days` days. */
async function fetchTopProducts(days = 30, limit = 5): Promise<TopProduct[]> {
  const start = daysAgo(days)
  type Line = { description: string; quantity: number; line_total: number }
  const lines: Line[] = isLocalDbConfigured
    ? await localApi.query<Line>(`select si.description, si.quantity, si.line_total from sale_items si join sales s on s.id = si.sale_id where s.status = 'completed' and s.sold_at >= ?`, [start.toISOString().replace('T', ' ').slice(0, 19)])
    : await (async () => {
      const { data, error } = await getSupabaseClient().from('sales').select('items:sale_items(description, quantity, line_total)').eq('status', 'completed').gte('sold_at', start.toISOString())
      if (error) throw error
      return ((data ?? []) as unknown as { items: Line[] | null }[]).flatMap((sale) => sale.items ?? [])
    })()
  const totals = new Map<string, TopProduct>()
  for (const line of lines) {
    const current = totals.get(line.description) ?? { name: line.description, revenue: 0, quantity: 0 }
    current.revenue += Number(line.line_total); current.quantity += Number(line.quantity)
    totals.set(line.description, current)
  }
  return [...totals.values()].sort((a, b) => b.revenue - a.revenue).slice(0, limit)
}

const dashboard = withOffline('dashboard', { getInventoryMetrics: fetchInventoryMetrics, getSalesMetrics: fetchSalesMetrics, getSalesTrend: fetchSalesTrend, getTopProducts: fetchTopProducts }, {
  style: 'throw',
  reads: {
    getInventoryMetrics: { fallback: async () => {
      const rows = (await getSnapshot<Product>('products'))?.filter((product) => product.active)
      if (!rows) return undefined
      return {
        productCount: rows.length,
        outOfStock: rows.filter((product) => Number(product.stock_quantity) === 0).length,
        lowStock: rows.filter(isLowStock).length,
        stockValue: rows.reduce((total, product) => total + Number(product.stock_quantity) * Number(product.purchase_price ?? (product as { cost_price?: number }).cost_price ?? 0), 0),
      }
    } },
    getSalesMetrics: true,
    getSalesTrend: true,
    getTopProducts: true,
  },
})
export const { getInventoryMetrics, getSalesMetrics, getSalesTrend, getTopProducts } = dashboard
