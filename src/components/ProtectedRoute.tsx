import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { isLocalDbConfigured, isSupabaseConfigured } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import type { RoleCode } from '../types/auth'
import { AppShellSkeleton } from './Skeleton'

export function ProtectedRoute({ roles }: { roles?: RoleCode[] }) {
  const { session, profile, loading } = useAuth()
  const location = useLocation()
  if (!isSupabaseConfigured && !isLocalDbConfigured) return <Navigate to="/login" replace />
  if (loading) return <AppShellSkeleton label="Chargement de la session" />
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />
  // A Supabase session arrives before its profile query; never bounce a valid
  // user back to the login screen during that short interval.
  if (!profile) return <AppShellSkeleton label="Chargement de votre profil" />
  if (!profile?.active) return <Navigate to="/login" replace />
  if (roles && (!profile.role || !roles.includes(profile.role.code))) return <Navigate to="/" replace />
  return <Outlet />
}
