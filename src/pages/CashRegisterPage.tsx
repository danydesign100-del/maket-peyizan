import { useEffect, useState, type FormEvent } from 'react'
import { PageHeader } from '../components/PageHeader'
import { posService } from '../services/posService'
import { productService } from '../services/productService'
import { customerService } from '../services/customerService'
import type { CartItem, PaymentMethod } from '../types/pos'
import type { Customer, Product } from '../types/catalog'
import { useAuth } from '../contexts/AuthContext'

const emptyCart: CartItem[] = []

export function CashRegisterPage() {
  const { profile } = useAuth()
  const canUsePOS = profile?.role?.code === 'cashier' || profile?.role?.code === 'director' || profile?.role?.code === 'administrator'
  
  // Session de caisse
  const [session, setSession] = useState<any>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [openingAmount, setOpeningAmount] = useState(0)
  
  // Panier
  const [cart, setCart] = useState<CartItem[]>(emptyCart)
  const [barcodeInput, setBarcodeInput] = useState('')
  const [productQuery, setProductQuery] = useState('')
  const [productMatches, setProductMatches] = useState<Product[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerMatches, setCustomerMatches] = useState<Customer[]>([])
  const [cartNotes, setCartNotes] = useState('')
  
  // Paiement
  const [showPayment, setShowPayment] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [paymentAmount, setPaymentAmount] = useState(0)
  const [paymentReference, setPaymentReference] = useState('')
  
  // États
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [changeDue, setChangeDue] = useState<number | null>(null)
  const [completedSale, setCompletedSale] = useState<{ saleNumber: string; items: CartItem[]; total: number; paid: number; change: number; customer: string | null; method: PaymentMethod; soldAt: string } | null>(null)
  
  // Charger la session de caisse
  useEffect(() => {
    void loadSession()
  }, [])
  
  const loadSession = async () => {
    setSessionLoading(true)
    try {
      const currentSession = await posService.getCurrentSession()
      setSession(currentSession)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur de chargement de session')
    } finally {
      setSessionLoading(false)
    }
  }
  
  const openSession = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await posService.openSession({ opening_amount: openingAmount })
      setSuccess('Session de caisse ouverte')
      void loadSession()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur d\'ouverture')
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
      setSuccess('Session de caisse fermée')
      setSession(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur de fermeture')
    } finally {
      setLoading(false)
    }
  }
  
  // Recherche produit par barcode
  const handleBarcodeSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!barcodeInput.trim()) return
    
    setLoading(true)
    try {
      const { data: product } = await productService.findByBarcode(barcodeInput.trim())
      if (product) {
        addToCart(product as Product)
        setBarcodeInput('')
      } else {
        setError('Produit non trouvé')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur de recherche')
    } finally {
      setLoading(false)
    }
  }

  const searchProducts = async (e: FormEvent) => {
    e.preventDefault()
    if (!productQuery.trim()) return setProductMatches([])
    setLoading(true); setError(null)
    try {
      const { data, error: requestError } = await productService.getProducts(0, { search: productQuery.trim(), status: 'active' })
      if (requestError) throw requestError
      setProductMatches((data ?? []) as Product[])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Recherche impossible')
    } finally { setLoading(false) }
  }

  const searchCustomers = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true); setError(null)
    try {
      const { data, error: requestError } = await customerService.searchCustomers(customerQuery)
      if (requestError) throw requestError
      setCustomerMatches((data ?? []) as Customer[])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Recherche client impossible')
    } finally { setLoading(false) }
  }
  
  const addToCart = (product: Product) => {
    const existingIndex = cart.findIndex(item => item.productId === product.id)
    if (existingIndex >= 0) {
      const updated = [...cart]
      updated[existingIndex].quantity += 1
      updated[existingIndex].lineTotal = updated[existingIndex].quantity * updated[existingIndex].unitPrice
      setCart(updated)
    } else {
      const newItem: CartItem = {
        productId: product.id,
        barcode: product.barcode,
        name: product.name,
        unit: product.unit,
        quantity: 1,
        unitPrice: product.selling_price,
        discount: 0,
        taxRate: 0,
        lineTotal: product.selling_price
      }
      setCart([...cart, newItem])
    }
  }
  
  const updateCartItem = (index: number, field: keyof CartItem, value: number) => {
    const updated = [...cart]
    updated[index] = { ...updated[index], [field]: value }
    if (field === 'quantity' || field === 'unitPrice' || field === 'discount') {
      updated[index].lineTotal = updated[index].quantity * updated[index].unitPrice - updated[index].discount + updated[index].taxRate
    }
    setCart(updated)
  }
  
  const removeCartItem = (index: number) => {
    setCart(cart.filter((_, i) => i !== index))
  }
  
  const cartTotals = posService.calculateCartTotals(cart)
  
  const processPayment = async (e: FormEvent) => {
    e.preventDefault()
    if (cart.length === 0) return setError('Panier vide')
    if (cart.some((item) => !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unitPrice) || item.unitPrice < 0 || !Number.isFinite(item.discount) || item.discount < 0 || item.discount > item.quantity * item.unitPrice || !Number.isFinite(item.taxRate) || item.taxRate < 0)) {
      return setError('Vérifiez les quantités, prix et remises du panier')
    }

    const paid = paymentAmount || cartTotals.totalAmount
    if (!Number.isFinite(paid) || paid <= 0) return setError('Le montant reçu doit être positif')
    if (paid + 0.01 < cartTotals.totalAmount) return setError('Le montant reçu est insuffisant')
    if (paymentMethod !== 'cash' && Math.abs(paid - cartTotals.totalAmount) > 0.01) {
      return setError('Un paiement autre qu’en espèces doit être égal au total de la vente')
    }
    
    setLoading(true)
    setError(null)
    try {
      const sale = await posService.createSale({
        customer_id: selectedCustomer?.id ?? null,
        items: cart,
        payments: [{ method: paymentMethod, amount: paid, reference: paymentReference || undefined }],
        notes: cartNotes
      })
      const change = Number((sale as { change_amount?: number }).change_amount ?? 0)
      setCompletedSale({
        saleNumber: String((sale as { sale_number?: string }).sale_number ?? 'VENTE'),
        items: [...cart],
        total: cartTotals.totalAmount,
        paid,
        change,
        customer: selectedCustomer?.full_name ?? null,
        method: paymentMethod,
        soldAt: new Date().toISOString(),
      })
      setSuccess('Vente enregistrée')
      setCart(emptyCart)
      setCartNotes('')
      setSelectedCustomer(null)
      setCustomerQuery('')
      setShowPayment(false)
      setPaymentAmount(0)
      setPaymentReference('')
      setChangeDue(change)
      
      // Déclencher l'impression automatique du reçu
      setTimeout(() => {
        window.print()
      }, 500)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur de vente')
    } finally {
      setLoading(false)
    }
  }
  
  if (!canUsePOS) {
    return (
      <div className="rounded-lg bg-red-50 p-6 text-red-800">
        <h2 className="text-lg font-semibold">Accès refusé</h2>
        <p className="mt-2">Seuls les caissiers et directeurs peuvent accéder à la caisse.</p>
      </div>
    )
  }
  
  if (sessionLoading) {
    return <div className="p-8">Chargement de la session...</div>
  }
  
  if (!session) {
    return (
      <div className="max-w-md">
        <PageHeader title="Caisse" description="Ouvrez votre session de caisse pour commencer" />
        <form onSubmit={openSession} className="mt-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div>
            <label className="block text-sm font-medium text-slate-700">Montant d'ouverture (HTG)</label>
            <input
              type="number"
              step="0.01"
              value={openingAmount}
              onChange={(e) => setOpeningAmount(Number(e.target.value))}
              className="mt-1 w-full rounded border p-2"
              required
            />
          </div>
          <button type="submit" disabled={loading} className="mt-4 rounded-lg bg-brand-700 px-4 py-2 text-white disabled:opacity-50">
            {loading ? 'Ouverture...' : 'Ouvrir la caisse'}
          </button>
        </form>
      </div>
    )
  }
  
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <div>
        <PageHeader title="Caisse" description={`Session ouverte le ${new Date(session.opened_at).toLocaleString()}`} />
        
        {error && <div className="mt-4 rounded bg-red-50 p-3 text-red-800">{error}</div>}
        {success && <div className="mt-4 rounded bg-emerald-50 p-3 text-emerald-800">{success}</div>}
        
        {/* Scan barcode */}
        <form onSubmit={handleBarcodeSubmit} className="ui-card mt-6 flex gap-2 p-3">
          <input
            type="text"
            value={barcodeInput}
            onChange={(e) => setBarcodeInput(e.target.value)}
            placeholder="Scanner un code-barres..."
            className="flex-1"
            autoFocus
          />
          <button type="submit" disabled={loading} className="ui-button-primary px-5">
            Ajouter
          </button>
        </form>
        <div className="ui-card mt-4 p-3">
          {selectedCustomer ? <div className="flex items-center justify-between gap-3"><span className="text-sm"><strong>{selectedCustomer.full_name}</strong><span className="ml-2 text-slate-500">Client sélectionné</span></span><button type="button" onClick={() => setSelectedCustomer(null)} className="text-sm text-red-700">Retirer</button></div> : <form onSubmit={searchCustomers} className="flex gap-2"><input value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="Rechercher un client (optionnel)" className="min-w-0 flex-1" /><button disabled={loading} className="ui-button-secondary px-4">Client</button></form>}
          {!selectedCustomer && customerMatches.length > 0 && <div className="mt-2 divide-y rounded border">{customerMatches.map((customer) => <button key={customer.id} type="button" onClick={() => { setSelectedCustomer(customer); setCustomerMatches([]) }} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"><strong>{customer.full_name}</strong>{customer.phone && <span className="ml-2 text-slate-500">{customer.phone}</span>}</button>)}</div>}
        </div>
        
        {/* Panier */}
        <div className="ui-card mt-6 overflow-x-auto">
          <table className="ui-table min-w-[38rem]">
            <thead className="bg-slate-50">
              <tr>
                <th className="p-3">Produit</th>
                <th className="p-3">Qté</th>
                <th className="p-3">Prix unit.</th>
                <th className="p-3">Total</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {cart.length === 0 ? (
                <tr><td colSpan={5} className="ui-empty">Ajoutez un produit par code-barres ou par recherche.</td></tr>
              ) : cart.map((item, index) => (
                <tr key={index} className="border-t">
                  <td className="p-3">
                    <div className="font-medium">{item.name}</div>
                    <div className="text-xs text-slate-500">{item.barcode}</div>
                  </td>
                  <td className="p-3">
                    <input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => updateCartItem(index, 'quantity', Number(e.target.value))}
                      className="w-16 rounded border p-1 text-center"
                    />
                  </td>
                  <td className="p-3 font-medium text-slate-700">{item.unitPrice.toFixed(2)} HTG</td>
                  <td className="p-3 font-medium">{item.lineTotal.toFixed(2)} HTG</td>
                  <td className="p-3">
                    <button onClick={() => removeCartItem(index)} className="text-red-600 hover:text-red-800">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {/* Totaux */}
        <div className="ui-card mt-4 p-5">
          <div className="flex justify-between">
            <span>Sous-total</span>
            <span>{cartTotals.subtotal.toFixed(2)} HTG</span>
          </div>
          {cartTotals.totalDiscount > 0 && (
            <div className="flex justify-between text-emerald-600">
              <span>Remise</span>
              <span>-{cartTotals.totalDiscount.toFixed(2)} HTG</span>
            </div>
          )}
          <div className="mt-2 flex justify-between text-lg font-bold">
            <span>Total</span>
            <span>{cartTotals.totalAmount.toFixed(2)} HTG</span>
          </div>
        </div>
        
        {/* Actions */}
        <div className="mt-4 flex gap-3">
          {changeDue !== null && changeDue > 0 && <p className="rounded-lg bg-amber-50 px-4 py-3 text-amber-900">Monnaie à rendre : <strong>{changeDue.toFixed(2)} HTG</strong></p>}
          <button
            onClick={() => setShowPayment(true)}
            disabled={cart.length === 0 || loading}
            className="ui-button-primary flex-1 py-3"
          >
            Encaisser ({cartTotals.totalAmount.toFixed(2)} HTG)
          </button>
          <button
            onClick={closeSession}
            className="rounded-lg border px-6 py-3"
          >
            Fermer la caisse
          </button>
          {completedSale && (
        <div className="flex gap-3">
          <button type="button" onClick={() => window.print()} className="rounded-lg border px-4 py-3">Réimprimer le reçu</button>
          <button type="button" onClick={() => setCompletedSale(null)} className="rounded-lg border px-4 py-3">Nouvelle vente</button>
        </div>
      )}
        </div>
      </div>
      <aside className="ui-card h-fit p-5 xl:sticky xl:top-6">
        <h2 className="text-base font-bold text-slate-950">Recherche produit</h2>
        <p className="mt-1 text-sm leading-5 text-slate-600">Trouvez un article si le code-barres n’est pas disponible.</p>
        <form onSubmit={searchProducts} className="mt-4 space-y-2"><input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Nom, référence ou marque" className="w-full" /><button disabled={loading} className="ui-button-secondary w-full">Rechercher</button></form>
        {productMatches.length > 0 && <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">{productMatches.map((product) => <button key={product.id} type="button" onClick={() => { addToCart(product); setProductMatches([]); setProductQuery('') }} className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-slate-50"><span><strong className="block text-sm text-slate-900">{product.name}</strong><small className="text-xs text-slate-500">{product.stock_quantity} {product.unit} disponible(s)</small></span><strong className="text-sm text-brand-700">{Number(product.selling_price).toFixed(2)} HTG</strong></button>)}</div>}
        {productQuery && productMatches.length === 0 && !loading && <p className="mt-4 text-sm text-slate-500">Aucun produit correspondant.</p>}
      </aside>
      
      {/* Modal paiement */}
      {showPayment && (
        <div role="dialog" aria-modal="true" aria-label="Encaissement" className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/45 p-4 sm:items-center">
          <form onSubmit={processPayment} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h2 className="text-lg font-semibold">Encaissement</h2>
            <p className="mt-2 text-2xl font-bold">{cartTotals.totalAmount.toFixed(2)} HTG</p>
            
            <div className="mt-4">
              <label className="block text-sm font-medium">Mode de paiement</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                className="mt-1 w-full rounded border p-2"
              >
                <option value="cash">Espèces</option>
                <option value="card">Carte</option>
                <option value="moncash">MonCash (saisie manuelle)</option>
                <option value="natcash">NatCash (saisie manuelle)</option>
                <option value="bank_transfer">Virement</option>
                <option value="check">Chèque</option>
              </select>
            </div>
            
            <div className="mt-4">
              <label className="block text-sm font-medium">Montant reçu</label>
              <input
                type="number"
                step="0.01"
                value={paymentAmount || cartTotals.totalAmount}
                onChange={(e) => setPaymentAmount(Number(e.target.value))}
                className="mt-1 w-full rounded border p-2"
              />
            </div>
            
            {paymentMethod !== 'cash' && (
              <div className="mt-4">
                <label className="block text-sm font-medium">Référence de transaction (si disponible)</label>
                <input
                  type="text"
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  className="mt-1 w-full rounded border p-2"
                />
              </div>
            )}
            {paymentMethod === 'cash' && paymentAmount > cartTotals.totalAmount && (
              <p className="mt-3 rounded bg-amber-50 p-2 text-sm text-amber-900">Monnaie à rendre : {(paymentAmount - cartTotals.totalAmount).toFixed(2)} HTG</p>
            )}
            
            <div className="mt-6 flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 rounded-lg bg-brand-700 px-4 py-2 text-white disabled:opacity-50"
              >
                {loading ? 'Traitement...' : 'Confirmer'}
              </button>
              <button
                type="button"
                onClick={() => setShowPayment(false)}
                className="rounded-lg border px-4 py-2"
              >
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}
      {completedSale && <section className="print-only mx-auto hidden max-w-sm bg-white p-6 text-slate-950">
        <div className="text-center">
          <h1 className="text-xl font-bold">Makèt Peyizan</h1>
          <p className="mt-1 text-sm text-slate-600">Sistèm jesyon komès</p>
        </div>
        <div className="my-4 border-y border-slate-300 py-3 text-sm">
          <p className="font-semibold">Reçu de vente</p>
          <p className="mt-1">N°: {completedSale.saleNumber}</p>
          <p>Date: {new Date(completedSale.soldAt).toLocaleString('fr-FR')}</p>
          {completedSale.customer && <p>Client: {completedSale.customer}</p>}
        </div>
        <div className="space-y-2 text-sm">
          <p className="font-semibold border-b border-slate-200 pb-1">Articles</p>
          {completedSale.items.map((item) => (
            <div key={item.productId} className="flex justify-between gap-3">
              <span>{item.quantity} × {item.name}</span>
              <strong>{item.lineTotal.toFixed(2)} HTG</strong>
            </div>
          ))}
        </div>
        <div className="mt-4 border-t border-slate-300 pt-3 text-sm">
          <div className="flex justify-between text-base font-bold">
            <span>Total</span>
            <span>{completedSale.total.toFixed(2)} HTG</span>
          </div>
          <div className="mt-1 flex justify-between">
            <span>Payé ({completedSale.method})</span>
            <span>{completedSale.paid.toFixed(2)} HTG</span>
          </div>
          {completedSale.change > 0 && (
            <div className="mt-1 flex justify-between font-semibold">
              <span>Monnaie rendue</span>
              <span>{completedSale.change.toFixed(2)} HTG</span>
            </div>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-slate-600">Merci pour votre visite.</p>
        <p className="mt-2 text-center text-xs text-slate-500">{new Date().toLocaleString('fr-FR')}</p>
      </section>}
    </div>
  )
}
