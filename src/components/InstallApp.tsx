import { useEffect, useState } from 'react'
import { Download, MonitorDown, MoreVertical, PlusSquare, RefreshCw, Share, X } from 'lucide-react'
import { applyUpdate, promptInstall, useInstallState } from '../lib/install'

/** Shows how to add the app where the browser has no install prompt (iPhone, iPad, Safari on Mac). */
function ManualInstallDialog({ platform, onClose }: { platform: 'ios' | 'mac-safari'; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const steps = platform === 'ios'
    ? [
      { icon: Share, text: <>Touchez le bouton <strong>Partager</strong> en bas de Safari.</> },
      { icon: PlusSquare, text: <>Choisissez <strong>Sur l’écran d’accueil</strong>.</> },
      { icon: Download, text: <>Touchez <strong>Ajouter</strong>. L’icône Makèt Peyizan apparaît sur l’écran d’accueil.</> },
    ]
    : [
      { icon: MoreVertical, text: <>Dans la barre de menus, ouvrez <strong>Fichier</strong> (ou le bouton <strong>Partager</strong>).</> },
      { icon: MonitorDown, text: <>Choisissez <strong>Ajouter au Dock</strong>.</> },
      { icon: Download, text: <>Confirmez avec <strong>Ajouter</strong>. L’application s’ouvre ensuite depuis le Dock.</> },
    ]
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div role="dialog" aria-modal="true" aria-labelledby="install-title" className="w-full max-w-md rounded-t-2xl bg-white p-6 text-slate-700 shadow-2xl sm:rounded-2xl animate-fade-up">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3"><img src="/icons/icon-96.png" alt="" className="h-12 w-12 rounded-xl" /><div><h2 id="install-title" className="text-base font-bold text-slate-950">Installer Makèt Peyizan</h2><p className="text-xs text-slate-500">{platform === 'ios' ? 'iPhone et iPad' : 'Safari sur Mac'}</p></div></div>
        <button type="button" onClick={onClose} aria-label="Fermer" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" aria-hidden="true" /></button>
      </div>
      <ol className="mt-5 space-y-3">
        {steps.map((step, index) => <li key={index} className="flex items-start gap-3 text-sm">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-100 text-brand-800"><step.icon className="h-4 w-4" aria-hidden="true" /></span>
          <span className="pt-1.5"><span className="mr-1 font-semibold text-slate-400">{index + 1}.</span>{step.text}</span>
        </li>)}
      </ol>
      <p className="mt-5 rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-600">Connectez-vous une première fois avec Internet : l’application et vos données sont alors enregistrées sur l’appareil et restent disponibles hors ligne.</p>
      <button type="button" onClick={onClose} className="ui-button-primary mt-5 w-full">J’ai compris</button>
    </div>
  </div>
}

/** "Install the app" action; hidden once the app is installed or when the browser cannot install it. */
export function InstallButton({ tone = 'dark', className = '' }: { tone?: 'dark' | 'light'; className?: string }) {
  const { canPrompt, installed, manual } = useInstallState()
  const [showHelp, setShowHelp] = useState(false)
  if (installed || (!canPrompt && !manual)) return null
  const style = tone === 'dark'
    ? 'flex w-full items-center gap-2.5 rounded-lg bg-accent-500/15 px-3 py-2 text-left text-sm font-semibold text-accent-100 ring-1 ring-accent-500/30 transition hover:bg-accent-500/25'
    : 'ui-button-secondary w-full'
  return <>
    <button type="button" onClick={() => canPrompt ? void promptInstall() : setShowHelp(true)} title="Installer sur cet ordinateur ou ce téléphone" className={`${style} ${className}`}>
      <MonitorDown className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">Installer l’application</span>
    </button>
    {showHelp && manual && <ManualInstallDialog platform={manual} onClose={() => setShowHelp(false)} />}
  </>
}

/** Offers the new version of an installed app without interrupting work in progress. */
export function UpdateBanner() {
  const { updateReady } = useInstallState()
  const [updating, setUpdating] = useState(false)
  if (!updateReady) return null
  return <div role="status" className="no-print fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-md items-center gap-3 rounded-xl bg-brand-950 px-4 py-3 text-sm text-white shadow-2xl ring-1 ring-white/10 animate-fade-up sm:inset-x-auto sm:right-6">
    <RefreshCw className={`h-5 w-5 shrink-0 text-accent-500 ${updating ? 'animate-spin' : ''}`} aria-hidden="true" />
    <p className="flex-1"><strong className="block font-semibold">Nouvelle version disponible</strong><span className="text-xs text-white/70">Terminez la vente en cours, puis mettez à jour.</span></p>
    <button type="button" disabled={updating} onClick={() => { setUpdating(true); applyUpdate() }} className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-brand-950 transition hover:bg-brand-100 disabled:opacity-70">Mettre à jour</button>
  </div>
}
