import { FlaskConical } from 'lucide-react'
import { isTestVersion, TEST_VERSION_NOTICE } from '../lib/appEnv'

/** Shown on every screen of the test version (and on its printouts). */
export function TestVersionBanner({ className = '' }: { className?: string }) {
  if (!isTestVersion) return null
  return <p role="note" className={`flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-950 print:border-slate-800 print:bg-white ${className}`}>
    <FlaskConical className="h-4 w-4 shrink-0" aria-hidden="true" />VERSION DE TEST<span className="font-normal">· {TEST_VERSION_NOTICE}</span>
  </p>
}
