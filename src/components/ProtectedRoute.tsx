import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { isLocalDbConfigured, isSupabaseConfigured } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { RoleCode } from '../types/auth'

export function ProtectedRoute({ roles }: { roles?: RoleCode[] }) {
  const { session, profile, loading } = useAuth()
  const location = useLocation()
  if (!isSupabaseConfigured && !isLocalDbConfigured) return <Navigate to="/login" replace />
  if (loading) return <main className="p-8">Chargement de la session...</main>
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />
  // A Supabase session arrives before its profile query; never bounce a valid
  // user back to the login screen during that short interval.
  if (!profile) return <main className="grid min-h-screen place-items-center p-8 text-sm text-slate-600">Chargement de votre profil…</main>
  if (!profile?.active) return <Navigate to="/login" replace />
  if (roles && (!profile.role || !roles.includes(profile.role.code))) return <Navigate to="/" replace />
  return <Outlet />
}
