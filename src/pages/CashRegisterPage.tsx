import { ArrowUpRight, Banknote, Lock, LockOpen, Plus, Printer, RotateCcw } from 'lucide-react'
import { CardsSkeleton, Skeleton, TableSkeleton } from '../components/Skeleton'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useTicketPrinter } from '../components/ThermalTicket'
import { errorText } from '../lib/errors'
import { isOnline } from '../lib/offline/status'
import { isNetworkError } from '../lib/offline/network'
import { PageHeader } from '../components/PageHeader'
import { posService } from '../services/posService'
import { productService } from '../services/productService'
import { pendingSales } from '../services/offlineSales'
import { readSettings } from '../services/settingsService'
import { ledgerService } from '../services/ledgerService'
import type { CartItem, Payment } from '../types/pos'
import type { Customer, Product, ProductInput } from '../types/catalog'
import type { Account } from '../types/accounting'
import { useAuth } from '../contexts/AuthContext'
import { useLocation, useNavigate } from 'react-router-dom'
import { proformaService, type Proforma } from '../services/proformaService'
import { ProductFormDialog } from './products/ProductFormDialog'
import { MovementFormDialog } from './cash/MovementForm'
import { CartTable } from './pos/CartTable'
import { CustomerPicker } from './pos/CustomerPicker'
import { PaymentDialog } from './pos/PaymentDialog'
import { ProductSearch } from './pos/ProductSearch'
import { Receipt, type CompletedSale } from './pos/Receipt'

const lineTotal = (item: CartItem) => Math.round((item.quantity * item.unitPrice - item.discount + item.taxRate) * 100) / 100

export function CashRegisterPage() {
  const { profile, can } = useAuth()
  const canUsePOS = can('pos.sell')
  // Same rights as the Products page: cashiers cannot create products.
  const canCreateProduct = can('catalog.manage')
  // Discounts: directors and administrators until the management sets the rule.
  const canDiscount = can('pos.discount')
  const canUseOtherCash = can('cash.other_accounts')
  const [creatingProduct, setCreatingProduct] = useState<Partial<ProductInput> | null>(null)
  const [missingBarcode, setMissingBarcode] = useState<string | null>(null)

  // Session de caisse
  const [session, setSession] = useState<{ opened_at: string } | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [openingAmount, setOpeningAmount] = useState(0)
  // When the session cannot be read, the page must not offer to open a register that may already be open.
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [offlineUnknown, setOfflineUnknown] = useState(false)

  // Vente en cours
  const [cart, setCart] = useState<CartItem[]>([])
  const [barcodeInput, setBarcodeInput] = useState('')
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [requireCustomer, setRequireCustomer] = useState(false)
  const [paying, setPaying] = useState(false)
  const [paymentFailure, setPaymentFailure] = useState<string | null>(null)
  const [outflow, setOutflow] = useState(false)
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  // Proforma being cashed (from Proformas › « Encaisser à la caisse »).
  const location = useLocation()
  const navigate = useNavigate()
  const [fromProforma, setFromProforma] = useState<{ id: string; number: string } | null>(null)
  // Quantities sold on this device and not yet on the server.
  const [pendingQty, setPendingQty] = useState<Map<string, number>>(new Map())

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [completedSale, setCompletedSale] = useState<CompletedSale | null>(null)
  // Only the ticket is printed (80 mm by default), not the cash register screen.
  const ticket = useTicketPrinter()
  const printReceipt = ticket.print

  const refreshPending = useCallback(() => pendingSales().then((sales) => {
    const map = new Map<string, number>()
    for (const sale of sales) if (sale.state === 'pending_sync' || sale.state === 'syncing') for (const item of sale.input.items) map.set(item.productId, (map.get(item.productId) ?? 0) + item.quantity)
    setPendingQty(map)
  }).catch(() => undefined), [])

  const loadSession = async () => {
    setSessionLoading(true)
    setSessionError(null)
    setOfflineUnknown(false)
    try {
      setSession(await posService.getCurrentSession() as { opened_at: string } | null)
    } catch (cause) {
      // Offline with nothing saved on this device: the register can still be opened; the
      // server keeps (and returns) any session already open when the opening is sent.
      if (isNetworkError(cause)) { setSession(null); setOfflineUnknown(true) }
      else setSessionError(errorText(cause, 'Erreur de chargement de session'))
    } finally {
      setSessionLoading(false)
    }
  }
  useEffect(() => {
    void loadSession()
    void refreshPending()
    void readSettings(['pos.require_customer']).then((values) => setRequireCustomer(values['pos.require_customer'] === true))
  }, [refreshPending])

  /** Fills the cart from a proforma: current stock, proforma prices kept with a discount per line. */
  const loadProforma = async (proformaId: string) => {
    const { data } = await proformaService.list()
    const proforma = ((data ?? []) as Proforma[]).find((row) => row.id === proformaId)
    if (!proforma) return say('Proforma introuvable.')
    const lines: CartItem[] = []
    const problems: string[] = []
    for (const item of proforma.items ?? []) {
      const { data: found } = await productService.getProductById(item.product_id)
      const product = found as Product | null
      if (!product) { problems.push(`${item.description} : produit introuvable`); continue }
      const stock = available(product)
      const quantity = Number(item.quantity)
      if (quantity > stock) problems.push(`${item.description} : seulement ${stock} ${product.unit} en stock`)
      const unitPrice = Number(product.selling_price)
      const discount = Math.max(0, Math.round((quantity * unitPrice - Number(item.line_total)) * 100) / 100)
      if (Number(item.line_total) > quantity * unitPrice + 0.005) problems.push(`${item.description} : prix de la proforma supérieur au prix de vente actuel, vendu au prix actuel`)
      const line: CartItem = { productId: product.id, barcode: product.barcode, name: product.name, unit: product.unit, quantity: Math.min(quantity, stock), unitPrice, discount: 0, taxRate: 0, lineTotal: 0, available: stock }
      line.discount = Math.min(discount, line.quantity * unitPrice)
      if (line.quantity > 0) lines.push({ ...line, lineTotal: lineTotal(line) })
    }
    setCart(lines)
    if (proforma.customer_id && proforma.customer) setCustomer({ id: proforma.customer_id, ...proforma.customer } as unknown as Customer)
    setFromProforma({ id: proforma.id, number: proforma.proforma_number })
    if (problems.length) say(`Proforma ${proforma.proforma_number} chargée avec des écarts : ${problems.join(' ; ')}.`)
    else say(`Proforma ${proforma.proforma_number} chargée : vérifiez puis encaissez.`, true)
  }
  useEffect(() => {
    const proformaId = (location.state as { proformaId?: string } | null)?.proformaId
    if (!session || !proformaId) return
    navigate(location.pathname, { replace: true, state: null })
    void loadProforma(proformaId)
  }, [session, location.state])

  /** Stock that can still be sold: the server's (or the local copy offline, already reduced) minus sales waiting on this device. */
  const available = (product: Product) => Math.max(0, Number(product.stock_quantity) - (isOnline() ? pendingQty.get(product.id) ?? 0 : 0))
  const say = (message: string | null, ok = false) => { if (ok) { setSuccess(message); setError(null) } else { setError(message); setSuccess(null) } }

  const openSession = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true); setError(null)
    try {
      await posService.openSession({ opening_amount: openingAmount })
      say('Session de caisse ouverte', true)
      void loadSession()
    } catch (cause) {
      say(errorText(cause, 'Erreur d’ouverture'))
    } finally {
      setLoading(false)
    }
  }

  const closeSession = async () => {
    if (!confirm('Fermer la session de caisse ?')) return
    const closingAmount = prompt('Montant en caisse :', '0')
    if (!closingAmount) return
    setLoading(true)
    try {
      await posService.closeSession(Number(closingAmount))
      say('Session de caisse fermée', true)
      setSession(null)
    } catch (cause) {
      say(errorText(cause, 'Erreur de fermeture'))
    } finally {
      setLoading(false)
    }
  }

  const addToCart = (product: Product) => {
    const stock = available(product)
    const index = cart.findIndex((item) => item.productId === product.id)
    const quantity = (index >= 0 ? cart[index].quantity : 0) + 1
    if (quantity > stock) return say(stock <= 0 ? `Stock insuffisant : « ${product.name} » est en rupture de stock.` : `Stock insuffisant : seulement ${stock} ${product.unit} disponible(s) pour « ${product.name} ».`)
    setError(null)
    if (index >= 0) return setCart(cart.map((item, i) => i === index ? { ...item, quantity, available: stock, lineTotal: lineTotal({ ...item, quantity }) } : item))
    const item: CartItem = { productId: product.id, barcode: product.barcode, name: product.name, unit: product.unit, quantity: 1, unitPrice: Number(product.selling_price), discount: 0, taxRate: 0, lineTotal: 0, available: stock }
    setCart([...cart, { ...item, lineTotal: lineTotal(item) }])
  }

  const setQuantity = (index: number, quantity: number) => {
    const item = cart[index]
    if (!Number.isFinite(quantity) || quantity <= 0) return
    if (item.available !== undefined && quantity > item.available) return say(`Stock insuffisant : seulement ${item.available} ${item.unit} disponible(s) pour « ${item.name} ».`)
    setError(null)
    setCart(cart.map((line, i) => i === index ? { ...line, quantity, discount: Math.min(line.discount, quantity * line.unitPrice), lineTotal: lineTotal({ ...line, quantity, discount: Math.min(line.discount, quantity * line.unitPrice) }) } : line))
  }
  const setDiscount = (index: number, discount: number) => setCart(cart.map((line, i) => {
    if (i !== index) return line
    const value = Math.min(Math.max(0, Number.isFinite(discount) ? discount : 0), line.quantity * line.unitPrice)
    return { ...line, discount: value, lineTotal: lineTotal({ ...line, discount: value }) }
  }))

  const handleBarcodeSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const code = barcodeInput.trim()
    if (!code) return
    setLoading(true)
    try {
      const { data: product } = await productService.findByBarcode(code)
      if (product) {
        addToCart(product as Product)
        setBarcodeInput('')
        setMissingBarcode(null)
      } else {
        say(`Aucun produit actif avec le code-barres ${code}.`)
        if (canCreateProduct) setMissingBarcode(code)
      }
    } catch (cause) {
      say(errorText(cause, 'Erreur de recherche'))
    } finally {
      setLoading(false)
    }
  }

  const cartTotals = posService.calculateCartTotals(cart)
  const startPayment = () => {
    if (cart.length === 0) return say('Panier vide')
    if (requireCustomer && !customer) return say('Client obligatoire : recherchez ou créez le client de la vente.')
    setPaymentFailure(null)
    setPaying(true)
  }

  const confirmSale = async (payment: Payment) => {
    setLoading(true)
    setPaymentFailure(null)
    try {
      const sale = await posService.createSale({ customer_id: customer?.id ?? null, items: cart, payments: [payment], notes: fromProforma ? `Proforma ${fromProforma.number}` : '', proformaId: fromProforma?.id })
      // Queued (offline) sales have no server answer yet: compute the change here.
      const change = Number((sale as { change_amount?: number }).change_amount ?? (payment.method === 'cash' ? Math.max(0, Math.round((payment.amount - cartTotals.totalAmount) * 100) / 100) : 0))
      setCompletedSale({
        saleNumber: String((sale as { sale_number?: string }).sale_number ?? 'VENTE'),
        items: [...cart], subtotal: cartTotals.subtotal, discount: cartTotals.totalDiscount, tax: cartTotals.totalTax, total: cartTotals.totalAmount,
        paid: payment.amount, change, customer: customer?.full_name ?? null, cashier: profile?.full_name ?? null, method: payment.method, reference: payment.reference ?? null, soldAt: new Date().toISOString(),
      })
      const where = isOnline() ? 'Vente enregistrée.' : 'Vente enregistrée sur cet appareil : elle sera envoyée au serveur au retour de la connexion.'
      say(change > 0 ? `${where} Monnaie à rendre : ${change.toFixed(2)} HTG.` : where, true)
      setCart([]); setCustomer(null); setPaying(false); setFromProforma(null)
      void refreshPending()
      setTimeout(printReceipt, 500)
    } catch (cause) {
      setPaymentFailure(errorText(cause, 'Vente refusée'))
    } finally {
      setLoading(false)
    }
  }

  const openOutflow = async () => {
    if (!accounts) {
      const { data, error: loadError } = await ledgerService.listAccounts()
      if (loadError) return say(errorText(loadError, 'Comptes indisponibles'))
      setAccounts((data ?? []).filter((account) => account.is_active))
    }
    setOutflow(true)
  }

  if (!canUsePOS) {
    return <div className="rounded-lg bg-red-50 p-6 text-red-800">
      <h2 className="text-lg font-semibold">Accès refusé</h2>
      <p className="mt-2">Seuls les caissiers et directeurs peuvent accéder à la caisse.</p>
    </div>
  }

  if (sessionLoading) {
    return <div role="status" aria-label="Chargement de la session"><Skeleton className="h-3 w-40" /><Skeleton className="mt-3 h-8 w-56" /><div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]"><TableSkeleton rows={5} cols={5} className="" /><CardsSkeleton count={2} className="grid gap-4" /></div></div>
  }

  if (sessionError) {
    return <div className="max-w-md">
      <PageHeader title="Caisse" description="Votre session de caisse n’a pas pu être vérifiée." />
      <p role="alert" className="ui-alert-error">{sessionError}</p>
      <button type="button" onClick={() => void loadSession()} className="ui-button-secondary mt-4"><RotateCcw className="h-4 w-4" aria-hidden="true" />Réessayer</button>
    </div>
  }

  if (!session) {
    return <div className="max-w-md">
      <PageHeader title="Caisse" description="Ouvrez votre session de caisse pour commencer" />
      {error && <p role="alert" className="ui-alert-error">{error}</p>}
      {offlineUnknown && <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Hors ligne : votre session n’a pas pu être vérifiée. Si une session est déjà ouverte sur le serveur, c’est elle qui sera utilisée au retour de la connexion.</p>}
      <form onSubmit={openSession} className="mt-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <label className="block text-sm font-medium text-slate-700">Montant d’ouverture (HTG)
          <input type="number" step="0.01" min="0" value={openingAmount} onChange={(event) => setOpeningAmount(Number(event.target.value))} className="mt-1 w-full rounded border p-2" required />
        </label>
        <button type="submit" disabled={loading} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-700 px-4 py-2 text-white disabled:opacity-50">
          <LockOpen className="h-4 w-4" aria-hidden="true" />{loading ? 'Ouverture...' : 'Ouvrir la caisse'}
        </button>
      </form>
    </div>
  }

  return <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_21rem]">
    <div>
      <PageHeader title="Caisse" description={`Session ouverte le ${new Date(session.opened_at).toLocaleString('fr-HT')}`} />
      {fromProforma && <p className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-900"><span>Encaissement de la proforma <strong>{fromProforma.number}</strong> : elle sera marquée « transformée en vente ».</span><button type="button" onClick={() => { setFromProforma(null); setCart([]); setCustomer(null) }} className="font-semibold hover:underline">Abandonner</button></p>}
      {error && <div role="alert" className="mt-4 rounded bg-red-50 p-3 text-red-800">{error}</div>}
      {success && <div role="status" className="mt-4 rounded bg-emerald-50 p-3 text-emerald-800">{success}</div>}

      <form onSubmit={handleBarcodeSubmit} className="ui-card mt-6 flex gap-2 p-3">
        <input type="text" value={barcodeInput} onChange={(event) => setBarcodeInput(event.target.value)} placeholder="Scanner un code-barres..." className="flex-1" autoFocus />
        <button type="submit" disabled={loading} className="ui-button-primary px-5"><Plus className="h-4 w-4" aria-hidden="true" />Ajouter</button>
      </form>
      <CustomerPicker customer={customer} onChange={setCustomer} required={requireCustomer} />
      <CartTable items={cart} canDiscount={canDiscount} onQuantity={setQuantity} onDiscount={setDiscount} onRemove={(index) => setCart(cart.filter((_, i) => i !== index))} />

      <div className="ui-card mt-4 space-y-1 p-5 text-sm">
        <div className="flex justify-between"><span>Sous-total</span><span className="tabular-nums">{cartTotals.subtotal.toFixed(2)} HTG</span></div>
        <div className={`flex justify-between ${cartTotals.totalDiscount > 0 ? 'text-emerald-700' : 'text-slate-500'}`}><span>Remises</span><span className="tabular-nums">− {cartTotals.totalDiscount.toFixed(2)} HTG</span></div>
        <div className="flex justify-between text-slate-500"><span>Taxes</span><span className="tabular-nums">{cartTotals.totalTax.toFixed(2)} HTG</span></div>
        <div className="flex justify-between pt-1 text-lg font-bold"><span>Total</span><span className="tabular-nums">{cartTotals.totalAmount.toFixed(2)} HTG</span></div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={startPayment} disabled={cart.length === 0 || loading} className="ui-button-primary min-w-56 flex-1 py-3"><Banknote className="h-4 w-4" aria-hidden="true" />Encaisser ({cartTotals.totalAmount.toFixed(2)} HTG)</button>
        <button type="button" onClick={() => void openOutflow()} className="inline-flex items-center gap-1.5 rounded-lg border px-4 py-3"><ArrowUpRight className="h-4 w-4 text-red-700" aria-hidden="true" />Sortie de caisse</button>
        <button type="button" onClick={() => void closeSession()} className="inline-flex items-center gap-1.5 rounded-lg border px-4 py-3"><Lock className="h-4 w-4" aria-hidden="true" />Fermer la caisse</button>
        {completedSale && <button type="button" onClick={printReceipt} className="inline-flex items-center gap-1.5 rounded-lg border px-4 py-3"><Printer className="h-4 w-4" aria-hidden="true" />Réimprimer le reçu</button>}
      </div>
    </div>

    <ProductSearch available={available} onPick={addToCart} canCreate={canCreateProduct} missingBarcode={missingBarcode} onCreate={setCreatingProduct} />

    {creatingProduct && <ProductFormDialog quick initial={creatingProduct} onClose={() => setCreatingProduct(null)} onSaved={(product, message) => {
      setCreatingProduct(null); setMissingBarcode(null); setBarcodeInput('')
      if (product.active && Number(product.stock_quantity) > 0) { addToCart(product); say(`${message} Ajouté au panier.`, true) }
      else say(`${message} Il sera vendable après une entrée de stock.`, true)
    }} />}
    {paying && <PaymentDialog items={cart} totals={cartTotals} customer={customer?.full_name ?? null} saving={loading} failure={paymentFailure} onConfirm={(payment) => void confirmSale(payment)} onClose={() => setPaying(false)} />}
    {outflow && accounts && <MovementFormDialog outOnly preset={{ cashAccount: '101000', type: 'expense' }} accounts={accounts} canUsePettyCash={canUseOtherCash} onClose={() => setOutflow(false)} onSaved={(message) => { setOutflow(false); say(message, true) }} />}
    {completedSale && <Receipt sale={completedSale} company={ticket.company} sectionRef={ticket.ref} />}
  </div>
}
