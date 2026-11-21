import { ImagePlus, KeyRound, Save, SlidersHorizontal, Trash2, UserRound } from 'lucide-react'
import { CardsSkeleton } from '../components/Skeleton'
import { PageHeader } from '../components/PageHeader'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { cachedRead } from '../lib/offline/wrap'
import { getSupabaseClient, isLocalDbConfigured, isSupabaseConfigured, supabase } from '../lib/supabase'
import { localApi } from '../lib/localApi'

export function SettingsPage() {
  const { profile, can } = useAuth()
  const canManageSettings = can('settings.manage')
  
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
        <p className="mt-2">Seuls les responsables autorisés modifient les paramètres.</p>
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
          <Section title="Entreprise" hint="Imprimé en tête des reçus, tickets de caisse, proformas et rapports.">
            <div className="grid gap-4 md:grid-cols-2">
              <TextSetting label="Nom de l’entreprise" name="company.name" settings={settings} setSettings={setSettings} save={updateSetting} />
              <TextSetting label="NIF" name="company.tax_id" settings={settings} setSettings={setSettings} save={updateSetting} />
              <TextSetting label="Adresse" name="company.address" settings={settings} setSettings={setSettings} save={updateSetting} />
              <TextSetting label="Téléphone" name="company.phone" settings={settings} setSettings={setSettings} save={updateSetting} />
              <TextSetting label="E-mail" name="company.email" type="email" settings={settings} setSettings={setSettings} save={updateSetting} />
              <TextSetting label="Message en bas des reçus" name="company.receipt_footer" placeholder="Merci de votre visite !" settings={settings} setSettings={setSettings} save={updateSetting} />
            </div>
            <LogoSetting value={settings['company.logo_url'] || ''} onChange={(value) => { setSettings({ ...settings, 'company.logo_url': value }); void updateSetting('company.logo_url', value) }} onError={setError} />
            <p className="mt-3 text-xs text-slate-500">Monnaie : <strong>gourde (HTG)</strong>. Les prix sont saisis toutes taxes comprises ; aucune TVA n’est ajoutée aux ventes.</p>
          </Section>

          <Section title="Impression" hint="Format des reçus de vente, tickets de clôture, bons de sortie, comptages et proformas en ticket.">
            <div className="flex flex-wrap gap-3">
              {([['80mm', 'Imprimante thermique 80 mm'], ['a4', 'Imprimante A4 / Lettre']] as const).map(([value, label]) => <label key={value} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-3 text-sm ${(settings['print.ticket_format'] ?? '80mm') === value ? 'border-brand-600 bg-brand-50 font-semibold text-brand-900' : 'border-slate-200'}`}>
                <input type="radio" name="ticket-format" checked={(settings['print.ticket_format'] ?? '80mm') === value} onChange={() => void updateSetting('print.ticket_format', value)} />{label}
              </label>)}
            </div>
            <p className="mt-2 text-xs text-slate-500">Les rapports et les proformas complètes s’impriment toujours en A4. Numérotation automatique et non modifiable : ventes, proformas, sorties et écritures reçoivent un numéro unique attribué par le serveur.</p>
          </Section>

          <Section title="Caisse" hint="Règles appliquées par le serveur à toutes les caisses.">
            <div className="space-y-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={settings['pos.require_customer'] || false} onChange={(e) => void updateSetting('pos.require_customer', e.target.checked)} className="rounded" />
                Client obligatoire pour les ventes
              </label>
              <NumberSetting label="Sorties de caisse à faire valider au-delà de (HTG)" name="cash.outflow_approval_threshold" fallback={5000} min={0} settings={settings} setSettings={setSettings} save={updateSetting}
                hint="Au-delà, une sortie enregistrée par un caissier ou un comptable attend l’accord d’un responsable autorisé. 0 = aucune validation." />
              <NumberSetting label="Ventes hors ligne acceptées jusqu’à (jours)" name="pos.offline_sale_max_days" fallback={7} min={1} max={60} settings={settings} setSettings={setSettings} save={updateSetting}
                hint="Une vente faite hors ligne et envoyée plus tard garde son heure réelle ; au-delà de ce délai, elle est refusée et doit être vérifiée." />
              {!isLocalDbConfigured && <NumberSetting label="Fonds fixe de la petite caisse (HTG)" name="petty_cash.float" fallback={0} min={0} settings={settings} setSettings={setSettings} save={updateSetting}
                hint="Montant que la petite caisse doit retrouver à chaque réapprovisionnement." />}
            </div>
          </Section>

          <Section title="Stock" hint="Règles fixes, appliquées par la base de données.">
            <ul className="space-y-2 text-sm text-slate-700">
              <li className="rounded-lg bg-slate-50 px-3 py-2">Stock négatif : <strong>interdit</strong>. Une vente au-delà du stock disponible est refusée.</li>
              <li className="rounded-lg bg-slate-50 px-3 py-2">Valorisation : <strong>coût moyen pondéré</strong>, recalculé à chaque entrée de stock avec prix d’achat.</li>
            </ul>
          </Section>
        </div>
      )}
    </div>
  )
}

type SettingsMap = Record<string, any>
type FieldProps = { label: string; name: string; settings: SettingsMap; setSettings: (next: SettingsMap) => void; save: (key: string, value: unknown) => Promise<void> }

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return <section className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
    <h3 className="text-lg font-semibold">{title}</h3>
    <p className="mb-4 mt-0.5 text-sm text-slate-500">{hint}</p>
    {children}
  </section>
}

/** Saved when the field is left, if it changed. */
function TextSetting({ label, name, settings, setSettings, save, type = 'text', placeholder }: FieldProps & { type?: string; placeholder?: string }) {
  const [initial, setInitial] = useState<string>(settings[name] ?? '')
  return <label className="block text-sm font-medium">{label}
    <input type={type} value={settings[name] ?? ''} placeholder={placeholder} onFocus={() => setInitial(settings[name] ?? '')}
      onChange={(e) => setSettings({ ...settings, [name]: e.target.value })}
      onBlur={() => { const value = String(settings[name] ?? '').trim(); if (value !== initial) void save(name, value) }}
      className="mt-1 w-full rounded border p-2 font-normal" />
  </label>
}

function NumberSetting({ label, name, settings, setSettings, save, fallback, min, max, hint }: FieldProps & { fallback: number; min: number; max?: number; hint: string }) {
  return <label className="block text-sm">
    <span className="font-medium">{label}</span>
    <input type="number" min={min} max={max} step="1" value={settings[name] ?? fallback}
      onChange={(e) => setSettings({ ...settings, [name]: e.target.value === '' ? '' : Number(e.target.value) })}
      onBlur={() => { const value = Math.min(max ?? Infinity, Math.max(min, Number(settings[name] ?? fallback) || 0)); setSettings({ ...settings, [name]: value }); void save(name, value) }}
      className="mt-1 block w-40 rounded border p-2" />
    <span className="mt-1 block text-xs text-slate-500">{hint}</span>
  </label>
}

/** The logo is reduced (300 px at most) and kept in the settings, so it also prints offline. */
function LogoSetting({ value, onChange, onError }: { value: string; onChange: (value: string) => void; onError: (message: string) => void }) {
  const pick = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) return onError('Choisissez une image (PNG, JPG…).')
    try {
      const image = await createImageBitmap(file)
      const scale = Math.min(1, 300 / Math.max(image.width, image.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(image.width * scale)
      canvas.height = Math.round(image.height * scale)
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
      onChange(canvas.toDataURL('image/png'))
    } catch { onError('Image illisible.') }
  }
  return <div className="mt-4 flex flex-wrap items-center gap-4">
    <div className="grid h-20 w-32 place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50">
      {value ? <img src={value} alt="Logo de l’entreprise" className="max-h-16 max-w-28 object-contain" /> : <span className="text-xs text-slate-400">Aucun logo</span>}
    </div>
    <label className="ui-button-secondary cursor-pointer"><ImagePlus className="h-4 w-4" aria-hidden="true" />{value ? 'Changer le logo' : 'Ajouter un logo'}
      <input type="file" accept="image/*" className="sr-only" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} />
    </label>
    {value && <button type="button" onClick={() => onChange('')} className="ui-button-secondary"><Trash2 className="h-4 w-4" aria-hidden="true" />Retirer</button>}
  </div>
}
