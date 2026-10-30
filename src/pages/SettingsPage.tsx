import { KeyRound, Save, SlidersHorizontal, UserRound } from 'lucide-react'
import { CardsSkeleton } from '../components/Skeleton'
import { PageHeader } from '../components/PageHeader'
import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { cachedRead } from '../lib/offline/wrap'
import { getSupabaseClient, isLocalDbConfigured, isSupabaseConfigured, supabase } from '../lib/supabase'
import { localApi } from '../lib/localApi'

export function SettingsPage() {
  const { profile } = useAuth()
  const canManageSettings = profile?.role?.code === 'director' || profile?.role?.code === 'administrator'
  
  const [settings, setSettings] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showAccountTab, setShowAccountTab] = useState(false)
  const [accountForm, setAccountForm] = useState({ full_name: '', email: '' })
  const [accountSubmitting, setAccountSubmitting] = useState(false)
  
  useEffect(() => {
    void loadSettings()
  }, [])
  
  const loadSettings = async () => {
    setLoading(true)
    try {
      setSettings(await cachedRead('settings', async () => {
        const settingsMap: Record<string, any> = {}
        if (isLocalDbConfigured) {
          const data = await localApi.getSettings()
          data.forEach((setting) => {
            settingsMap[setting.key] = setting.value
          })
          return settingsMap
        }
        const client = getSupabaseClient()
        const { data, error: requestError } = await client.from('settings').select('*')
        if (requestError) throw requestError
        data?.forEach((setting: any) => {
          settingsMap[setting.key] = setting.value
        })
        return settingsMap
      }, { style: 'throw' }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur de chargement')
    } finally {
      setLoading(false)
    }
  }
  
  const updateSetting = async (key: string, value: any) => {
    try {
      if (isLocalDbConfigured) {
        const setting = await localApi.updateSetting(key, value)
        setSettings((current) => ({ ...current, [setting.key]: setting.value }))
        return
      }
      const client = getSupabaseClient()
      const { error } = await client.from('settings').upsert({ key, value })
      if (error) throw error
      await loadSettings()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur de modification')
    }
  }

  const updateAccount = async (event: FormEvent) => {
    event.preventDefault()
    setAccountSubmitting(true)
    setError(null)
    setNotice(null)

    try {
      if (isLocalDbConfigured) {
        // Pour local API, utiliser mutate directement
        await localApi.mutate('update', 'profiles', {
          full_name: accountForm.full_name,
          email: accountForm.email
        }, profile?.id)
      } else {
        const client = getSupabaseClient()
        const { error: updateError } = await client
          .from('profiles')
          .update({ 
            full_name: accountForm.full_name,
            email: accountForm.email
          })
          .eq('id', profile?.id ?? '')
        
        if (updateError) throw updateError
      }

      setNotice('Informations mises à jour')
      void loadSettings()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur de mise à jour')
    } finally {
      setAccountSubmitting(false)
    }
  }

  const handlePasswordReset = async () => {
    if (!isSupabaseConfigured || !supabase) {
      setError('La récupération de mot de passe nécessite Supabase.')
      return
    }

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(profile?.email || '', {
        redirectTo: `${window.location.origin}/reset-password`
      })

      if (resetError) throw resetError

      setNotice('Email de récupération envoyé')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur lors de la demande')
    }
  }

  useEffect(() => {
    if (profile) {
      setAccountForm({ full_name: profile.full_name || '', email: profile.email || '' })
    }
  }, [profile])
  
  if (!canManageSettings) {
    return (
      <div className="rounded-lg bg-red-50 p-6 text-red-800">
        <h2 className="text-lg font-semibold">Accès refusé</h2>
        <p className="mt-2">Seuls les directeurs peuvent modifier les paramètres.</p>
      </div>
    )
  }
  
  return (
    <div>
      <PageHeader title="Paramètres" description="Configuration de l'application" />
      
      {error && <div className="mt-4 rounded bg-red-50 p-3 text-red-800">{error}</div>}
      {notice && <div className="mt-4 rounded bg-emerald-50 p-3 text-emerald-800">{notice}</div>}
      
      {/* Tabs */}
      <div className="mt-6 flex gap-2 border-b">
        <button
          onClick={() => setShowAccountTab(false)}
          className={`inline-flex items-center gap-1.5 px-4 py-2 ${!showAccountTab ? 'border-b-2 border-brand-700 font-semibold' : ''}`}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />Paramètres système
        </button>
        <button
          onClick={() => setShowAccountTab(true)}
          className={`inline-flex items-center gap-1.5 px-4 py-2 ${showAccountTab ? 'border-b-2 border-brand-700 font-semibold' : ''}`}
        >
          <UserRound className="h-4 w-4" aria-hidden="true" />Mon compte
        </button>
      </div>
      
      {showAccountTab ? (
        <div className="mt-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h3 className="text-lg font-semibold">Mon compte</h3>
          <form onSubmit={updateAccount} className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium">Nom complet</label>
              <input
                type="text"
                value={accountForm.full_name}
                onChange={(e) => setAccountForm({ ...accountForm, full_name: e.target.value })}
                className="mt-1 w-full rounded border p-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Email</label>
              <input
                type="email"
                value={accountForm.email}
                onChange={(e) => setAccountForm({ ...accountForm, email: e.target.value })}
                className="mt-1 w-full rounded border p-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Rôle</label>
              <input
                type="text"
                value={profile?.role?.name || ''}
                disabled
                className="mt-1 w-full rounded border p-2 bg-slate-50"
              />
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={accountSubmitting} className="ui-button-primary">
                <Save className="h-4 w-4" aria-hidden="true" />{accountSubmitting ? 'Mise à jour...' : 'Mettre à jour'}
              </button>
              {isSupabaseConfigured && (
                <button type="button" onClick={handlePasswordReset} className="ui-button-secondary">
                  <KeyRound className="h-4 w-4" aria-hidden="true" />Changer mon mot de passe
                </button>
              )}
            </div>
          </form>
        </div>
      ) : loading ? (
        <CardsSkeleton count={4} className="mt-6 grid gap-4 lg:grid-cols-2" />
      ) : (
        <div className="mt-6 space-y-6">
          {/* Informations entreprise */}
          <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h3 className="text-lg font-semibold">Informations entreprise</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium">Nom de l'entreprise</label>
                <input
                  type="text"
                  value={settings['company.name'] || ''}
                  onChange={(e) => setSettings({ ...settings, 'company.name': e.target.value })}
                  onBlur={() => void updateSetting('company.name', settings['company.name'])}
                  className="mt-1 w-full rounded border p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Devise</label>
                <input
                  type="text"
                  value={settings['company.currency'] || 'HTG'}
                  onChange={(e) => setSettings({ ...settings, 'company.currency': e.target.value })}
                  onBlur={() => void updateSetting('company.currency', settings['company.currency'])}
                  className="mt-1 w-full rounded border p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Taux de TVA (%)</label>
                <input
                  type="number"
                  step="0.1"
                  value={settings['company.tax_rate'] || 18.5}
                  onChange={(e) => setSettings({ ...settings, 'company.tax_rate': Number(e.target.value) })}
                  onBlur={() => void updateSetting('company.tax_rate', settings['company.tax_rate'])}
                  className="mt-1 w-full rounded border p-2"
                />
              </div>
            </div>
          </div>
          
          {/* Numérotation */}
          <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h3 className="text-lg font-semibold">Numérotation des documents</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium">Préfixe reçus</label>
                <input
                  type="text"
                  value={settings['pos.receipt_prefix'] || 'REC'}
                  onChange={(e) => setSettings({ ...settings, 'pos.receipt_prefix': e.target.value })}
                  onBlur={() => void updateSetting('pos.receipt_prefix', settings['pos.receipt_prefix'])}
                  className="mt-1 w-full rounded border p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium">Préfixe factures</label>
                <input
                  type="text"
                  value={settings['pos.invoice_prefix'] || 'FAC'}
                  onChange={(e) => setSettings({ ...settings, 'pos.invoice_prefix': e.target.value })}
                  onBlur={() => void updateSetting('pos.invoice_prefix', settings['pos.invoice_prefix'])}
                  className="mt-1 w-full rounded border p-2"
                />
              </div>
            </div>
          </div>
          
          {/* Options POS */}
          <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h3 className="text-lg font-semibold">Options de caisse</h3>
            <div className="mt-4 space-y-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings['pos.allow_negative_stock'] || false}
                  onChange={(e) => void updateSetting('pos.allow_negative_stock', e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm">Autoriser les stocks négatifs (non recommandé)</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings['pos.require_customer'] || false}
                  onChange={(e) => void updateSetting('pos.require_customer', e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm">Client obligatoire pour les ventes</span>
              </label>
            </div>
          </div>
          
          {/* Comptabilité */}
          <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h3 className="text-lg font-semibold">Comptabilité</h3>
            <div className="mt-4">
              <label className="block text-sm font-medium">Méthode de valorisation du stock</label>
              <select
                value={settings['stock.valuation_method'] || 'weighted_average'}
                onChange={(e) => void updateSetting('stock.valuation_method', e.target.value)}
                className="mt-1 w-full rounded border p-2"
              >
                <option value="weighted_average">Coût moyen pondéré</option>
                <option value="fifo">FIFO (Premier entré, premier sorti)</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
