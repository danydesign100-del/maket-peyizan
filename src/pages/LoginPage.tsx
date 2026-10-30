import { ArrowLeft, LogIn, Mail } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { isSupabaseConfigured, isLocalDbConfigured, supabase } from '../lib/supabase'
import { isInitialSetupComplete, signUpFirstOwner } from '../services/authService'
import { InstallButton } from '../components/InstallApp'

export function LoginPage() {
  const { session, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [setupAvailable, setSetupAvailable] = useState(false)
  const [checked, setChecked] = useState(false)
  const [createMode, setCreateMode] = useState(false)
  const [resetMode, setResetMode] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetSubmitting, setResetSubmitting] = useState(false)
  
  const isConfigured = isSupabaseConfigured || isLocalDbConfigured
  
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setChecked(true)
      return
    }
    void isInitialSetupComplete()
      .then((complete) => {
        setSetupAvailable(!complete)
        setCreateMode(!complete)
        setChecked(true)
      })
      .catch(() => setChecked(true))
  }, [])
  
  if (session) return <Navigate to="/" replace />
  
  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await signIn(email, password)
      navigate((location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/', { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Connexion impossible.')
    } finally {
      setSubmitting(false)
    }
  }
  
  async function setup(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setSubmitting(true)
    try {
      const data = await signUpFirstOwner(email, password, fullName)
      if (data.session) {
        navigate('/', { replace: true })
      } else {
        setNotice('Kont lan kreye. Verifye e-mail ou, apre sa chwazi "Mwen deja gen kont" pou konekte.')
        setCreateMode(false)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kreyasyon kont lan pa mache.')
    } finally {
      setSubmitting(false)
    }
  }
  
  async function handlePasswordReset(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setResetSubmitting(true)
    
    try {
      if (!isSupabaseConfigured || !supabase) {
        setError('La récupération de mot de passe nécessite Supabase.')
        return
      }
      
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: `${window.location.origin}/reset-password`
      })
      
      if (resetError) throw resetError
      
      setNotice('Si cette adresse est associée à un compte, vous recevrez un email de récupération.')
      setResetEmail('')
      setResetMode(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur lors de la demande de récupération.')
    } finally {
      setResetSubmitting(false)
    }
  }
  
  const heading = createMode ? 'Créer le premier administrateur' : 'Connexion'
  
  return (
    <main className="grid min-h-screen bg-[#f6f8f6] lg:grid-cols-2">
      <section className="hidden bg-brand-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-500 font-black text-brand-950">MP</span>
          <strong>Makèt Peyizan</strong>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-500">Point de vente</p>
          <h1 className="mt-4 max-w-md text-4xl font-bold leading-tight">Votre commerce, clairement piloté.</h1>
          <p className="mt-5 max-w-lg leading-7 text-white/70">Une caisse, un stock et une comptabilité conçus pour le travail quotidien.</p>
        </div>
        <p className="text-sm text-white/45">Accès réservé au personnel autorisé.</p>
      </section>
      
      <section className="flex flex-col items-center justify-center p-5 sm:p-8">
        {resetMode ? (
          <form onSubmit={handlePasswordReset} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-900/5 sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">Récupération</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">Mot de passe oublié ?</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">Entrez votre adresse email pour recevoir un lien de récupération.</p>
            
            <label className="mt-6 block text-sm font-semibold text-slate-700">
              E-mail
              <input
                required
                type="email"
                autoComplete="email"
                value={resetEmail}
                onChange={(event) => setResetEmail(event.target.value)}
                className="mt-1.5 w-full"
              />
            </label>
            
            {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            {notice && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
            
            <button disabled={resetSubmitting} className="inline-flex items-center gap-1.5 justify-center mt-6 w-full rounded-lg bg-brand-700 px-4 py-3 font-semibold text-white disabled:opacity-50">
              <Mail className="h-4 w-4" aria-hidden="true" />{resetSubmitting ? 'Traitement…' : 'Envoyer le lien de récupération'}
            </button>
            
            <button
              type="button"
              onClick={() => { setResetMode(false); setError(null); setNotice(null) }}
              className="inline-flex items-center gap-1.5 justify-center mt-3 w-full text-sm font-semibold text-brand-700 hover:underline"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />Retour à la connexion
            </button>
          </form>
        ) : (
          <form onSubmit={createMode ? setup : submit} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-900/5 sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-700">{createMode ? 'Configuration initiale' : 'Espace sécurisé'}</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">{heading}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">{createMode ? 'Ce compte deviendra le propriétaire initial.' : 'Entrez vos identifiants pour continuer.'}</p>
            
            {!checked ? (
              <p className="mt-6 text-sm text-slate-500">Vérification de la configuration…</p>
            ) : !isConfigured ? (
              <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Supabase n'est pas configuré.</p>
            ) : (
              <>
                {createMode && (
                  <label className="mt-6 block text-sm font-semibold text-slate-700">
                    Nom complet
                    <input required value={fullName} onChange={(event) => setFullName(event.target.value)} className="mt-1.5 w-full" />
                  </label>
                )}
                <label className="mt-4 block text-sm font-semibold text-slate-700">
                  E-mail
                  <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full" />
                </label>
                <label className="mt-4 block text-sm font-semibold text-slate-700">
                  Mot de passe
                  <input required minLength={8} type="password" autoComplete={createMode ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full" />
                </label>
                
                {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
                {notice && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
                
                <button disabled={submitting} className="inline-flex items-center gap-1.5 justify-center mt-6 w-full rounded-lg bg-brand-700 px-4 py-3 font-semibold text-white disabled:opacity-50">
                  <LogIn className="h-4 w-4" aria-hidden="true" />{submitting ? 'Traitement…' : createMode ? 'Créer mon compte administrateur' : 'Se connecter'}
                </button>
                
                {!createMode && isSupabaseConfigured && (
                  <button
                    type="button"
                    onClick={() => setResetMode(true)}
                    className="mt-3 w-full text-sm text-slate-600 hover:text-brand-700"
                  >
                    Mot de passe oublié ?
                  </button>
                )}
                
                {setupAvailable && (
                  <button
                    type="button"
                    onClick={() => { setCreateMode((value) => !value); setError(null); setNotice(null) }}
                    className="mt-3 w-full text-sm font-semibold text-brand-700 hover:underline"
                  >
                    {createMode ? 'Mwen deja gen kont — konekte' : 'Kreye premye administratè a'}
                  </button>
                )}
              </>
            )}
          </form>
        )}
        <div className="mt-4 w-full max-w-md"><InstallButton tone="light" /></div>
      </section>
    </main>
  )
}
