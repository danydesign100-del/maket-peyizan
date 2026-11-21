import { callUsersFunction } from '../services/userService';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { getCurrentProfile, isInitialSetupComplete } from '../services/authService'
import { localApi } from '../lib/localApi'
import type { Profile } from '../types/auth'
import { isNetworkError } from '../lib/offline/network'
import { isOnline } from '../lib/offline/status'
import { setSyncUser } from '../services/syncService'
import { cachedPermissions, clearPermissions, defaultPermissions, savePermissions, type PermissionCode } from '../lib/permissions'

// The last profile is kept so that a signed-in user can keep working offline.
const PROFILE_KEY = 'mp:profile'
const saveProfile = (profile: Profile) => { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)) } catch { /* storage unavailable */ } }
const clearProfile = () => { try { localStorage.removeItem(PROFILE_KEY) } catch { /* storage unavailable */ } }
function cachedProfile(id?: string): Profile | null {
  try { const profile = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null') as Profile | null; return profile && (!id || profile.id === id) ? profile : null } catch { return null }
}

type LocalSession = {
  user: {
    id: string;
    email: string;
    full_name: string;
    role: {
      code: string;
      name: string;
    };
  };
  token: string;
};

type AuthState = { session: Session | LocalSession | null; profile: Profile | null; loading: boolean; error: string | null; refreshProfile: () => Promise<void>; signIn: (email: string, password: string) => Promise<void>; signOut: () => Promise<void>; permissions: PermissionCode[]; can: (code: PermissionCode) => boolean }
const AuthContext = createContext<AuthState | undefined>(undefined)

const USE_LOCAL_DB = import.meta.env.VITE_USE_LOCAL_DB === 'true';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | LocalSession | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const remember = (next: Profile) => { saveProfile(next); return next };

  const refreshProfile = async () => {
    if (!session) {
      setProfile(null);
      return;
    }
    try {
      if (USE_LOCAL_DB) {
        const localProfile = await localApi.getProfile();
        setProfile(remember({
          id: localProfile.id,
          full_name: localProfile.full_name,
          email: localProfile.email,
          role_id: localProfile.role_id,
          active: localProfile.active,
          role: {
            code: localProfile.role_code as any,
            name: localProfile.role_name,
          },
        }));
      } else {
        const userId = (session as Session).user.id
        let nextProfile = await getCurrentProfile(userId)
        if (!nextProfile && !(await isInitialSetupComplete())) {
          const { error: bootstrapError } = await supabase!.rpc('create_first_admin_user', { user_uuid: userId })
          if (bootstrapError) throw bootstrapError
          nextProfile = await getCurrentProfile(userId)
        }
        setProfile(nextProfile && remember(nextProfile))
      }
    } catch (cause) {
      const offlineProfile = isNetworkError(cause) ? cachedProfile(USE_LOCAL_DB ? undefined : (session as Session).user.id) : null
      if (offlineProfile) return setProfile(offlineProfile)
      setError(cause instanceof Error ? cause.message : 'Profil inaccessible');
    }
  };

  const signIn = async (email: string, password: string) => {
    if (USE_LOCAL_DB) {
      const response = await localApi.login(email, password);
      localApi.setToken(response.token);
      setSession(response as LocalSession);
    } else if (supabase) {
      // A user name (no « @ ») is resolved by the `users` Edge Function, which returns the session.
      if (!email.includes('@')) {
        const { session: tokens } = await callUsersFunction<{ session: { access_token: string; refresh_token: string } }>({ action: 'login', identifier: email, password });
        const { data, error } = await supabase.auth.setSession({ access_token: tokens.access_token, refresh_token: tokens.refresh_token });
        if (error) throw error;
        setSession(data.session);
        return;
      }
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      setSession(data.session);
    }
  };

  const signOut = async () => {
    clearProfile();
    clearPermissions();
    setSyncUser(null);
    if (USE_LOCAL_DB) {
      localApi.clearToken();
      setSession(null);
      setProfile(null);
    } else if (supabase) {
      // A global sign-out needs the server; offline, only the local session is removed.
      await supabase.auth.signOut(isOnline() ? undefined : { scope: 'local' });
      setSession(null);
      setProfile(null);
    }
  };

  useEffect(() => {
    if (USE_LOCAL_DB) {
      const token = localApi.getToken();
      if (token) {
        localApi.getProfile().then((profile) => {
          setSession({
            user: {
              id: profile.id,
              email: profile.email,
              full_name: profile.full_name,
              role: {
                code: profile.role_code,
                name: profile.role_name,
              },
            },
            token,
          } as LocalSession);
          setLoading(false);
        }).catch((cause) => {
          const profile = isNetworkError(cause) ? cachedProfile() : null;
          if (profile) setSession({ user: { id: profile.id, email: profile.email, full_name: profile.full_name, role: { code: profile.role?.code ?? '', name: profile.role?.name ?? '' } }, token } as LocalSession);
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
      return;
    }

    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setProfile(null);
      setLoading(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    void refreshProfile();
  }, [session]);

  useEffect(() => {
    if (profile) setSyncUser(profile.id, profile.role?.code ?? '');
  }, [profile]);

  // The role's permissions from the database; until they arrive (or offline), the last ones loaded, else the role defaults.
  const [loadedPermissions, setLoadedPermissions] = useState<{ userId: string; codes: PermissionCode[] } | null>(null);
  useEffect(() => {
    if (!profile || USE_LOCAL_DB || !supabase) return;
    let current = true;
    void supabase.rpc('my_permissions').then(({ data, error: loadError }) => {
      if (!current || loadError || !Array.isArray(data)) return;
      savePermissions(profile.id, data as PermissionCode[]);
      setLoadedPermissions({ userId: profile.id, codes: data as PermissionCode[] });
    });
    return () => { current = false };
  }, [profile]);
  const permissions = useMemo(() => {
    if (!profile) return [];
    if (USE_LOCAL_DB) return defaultPermissions(profile.role?.code);
    if (loadedPermissions?.userId === profile.id) return loadedPermissions.codes;
    return cachedPermissions(profile.id) ?? defaultPermissions(profile.role?.code);
  }, [profile, loadedPermissions]);

  const value = useMemo(() => ({ session, profile, loading, error, refreshProfile, signIn, signOut, permissions, can: (code: PermissionCode) => permissions.includes(code) }), [session, profile, loading, error, permissions]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth doit être utilisé dans AuthProvider');
  return value;
}
