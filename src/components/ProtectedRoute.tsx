import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { isLocalDbConfigured, isSupabaseConfigured } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { PermissionCode } from '../lib/permissions'
import { AppShellSkeleton } from './Skeleton'

export function ProtectedRoute({ anyOf }: { anyOf?: PermissionCode[] }) {
  const { session, profile, loading, can } = useAuth()
  const location = useLocation()
  if (!isSupabaseConfigured && !isLocalDbConfigured) return <Navigate to="/login" replace />
  if (loading) return <AppShellSkeleton label="Chargement de la session" />
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />
  // A Supabase session arrives before its profile query; never bounce a valid
  // user back to the login screen during that short interval.
  if (!profile) return <AppShellSkeleton label="Chargement de votre profil" />
  if (!profile?.active) return <Navigate to="/login" replace />
  if (anyOf && !anyOf.some(can)) return <Navigate to="/" replace />
  return <Outlet />
}
