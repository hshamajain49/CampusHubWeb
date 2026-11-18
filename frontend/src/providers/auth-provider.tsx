// Session + profile state (§9.4). Profile always comes from GET /me; Better Auth is used only for credentials.
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Me } from '@campushub/shared';
import { authClient } from '@/lib/auth-client';
import { apiFetch, ApiError, setApiHandlers } from '@/lib/api-client';
import { clearToken, getToken, onTokenRemovedElsewhere } from '@/lib/session-token';
import { navigate } from '@/lib/navigation';
import { setAnalyticsUser } from '@/lib/analytics';
import { authErrorMessage } from '@/features/auth/lib/auth-error-messages';

type Status = 'loading' | 'unauthenticated' | 'authenticated';
type SignOutReason = 'signed_out' | 'session_expired' | 'deactivated' | 'account_deleted';

interface AuthValue {
  status: Status;
  profile: Me | null;
  signIn(email: string, password: string): Promise<Me>;
  /** callApi: false skips the sign-out request (the session is already gone, e.g. after deleting the account). */
  signOut(reason?: SignOutReason, opts?: { callApi?: boolean }): Promise<void>;
  refreshProfile(): Promise<Me | null>;
  /**
   * Where a sign-out in progress is sending the user (for a few seconds after it). The guards redirect there too, so
   * their own "/login?redirectTo=…" redirect can't win the race and drop the reason banner.
   */
  signOutTarget: string | null;
}

const AuthContext = React.createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function useMe(): Me {
  const { profile } = useAuth();
  if (!profile) throw new Error('useMe requires an authenticated user');
  return profile;
}

const fetchMe = () => apiFetch<Me>('/me', { silentAuth: true });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = React.useState<Status>(() => (getToken() ? 'loading' : 'unauthenticated'));
  const signingOut = React.useRef(false);
  const [signOutTarget, setSignOutTarget] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!signOutTarget) return;
    const t = setTimeout(() => setSignOutTarget(null), 3000);
    return () => clearTimeout(t);
  }, [signOutTarget]);

  // Role changes apply quickly: /me is refetched every 60 s and on focus (§16.11).
  const me = useQuery({
    queryKey: ['me'],
    queryFn: fetchMe,
    enabled: status !== 'unauthenticated' && !!getToken(),
    staleTime: 60_000,
    refetchInterval: status === 'authenticated' ? 60_000 : false,
    retry: (count, err) => (err instanceof ApiError && err.status > 0 && err.status < 500 ? false : count < 2),
  });

  const profile = status === 'authenticated' ? (me.data ?? null) : null;
  // Analytics links page views to the account only when VITE_SENTINEL_LINK_USERS=true (off by default).
  React.useEffect(() => setAnalyticsUser(profile?.id ?? null), [profile?.id]);

  const signOut = React.useCallback(
    async (reason: SignOutReason = 'signed_out', opts: { callApi?: boolean } = {}) => {
      if (signingOut.current) return;
      signingOut.current = true;
      const wasAdmin = qc.getQueryData<Me>(['me'])?.role === 'super_admin' || window.location.pathname.startsWith('/admin');
      const here = window.location.pathname + window.location.search;
      try {
        if (opts.callApi !== false && getToken()) {
          const { disablePush } = await import('@/lib/push');
          await disablePush().catch(() => undefined);
          await authClient.signOut().catch(() => undefined);
        }
      } finally {
        clearToken();
        qc.clear();
        const base = wasAdmin ? '/admin/login' : '/login';
        const params = new URLSearchParams({ reason });
        if (reason === 'session_expired' && !here.startsWith('/login') && !here.startsWith('/admin/login')) params.set('redirectTo', here);
        const target = `${base}?${params.toString()}`;
        // Same render: the guards see the target together with the signed-out status.
        setSignOutTarget(target);
        setStatus('unauthenticated');
        navigate(target, { replace: true });
        signingOut.current = false;
      }
    },
    [qc],
  );

  // Resolve the initial session.
  React.useEffect(() => {
    if (status !== 'loading') return;
    if (me.isSuccess) setStatus('authenticated');
    if (me.isError) {
      const err = me.error;
      clearToken();
      setStatus('unauthenticated');
      if (err instanceof ApiError && err.code === 'ACCOUNT_DEACTIVATED') navigate('/login?reason=deactivated', { replace: true });
    }
  }, [status, me.isSuccess, me.isError, me.error]);

  React.useEffect(() => {
    setApiHandlers({
      onUnauthenticated: () => void signOut('session_expired', { callApi: false }),
      onDeactivated: () => void signOut('deactivated', { callApi: false }),
      onPasswordChangeRequired: () => navigate('/change-password', { replace: true }),
      // The profile's mfa.verified is stale (e.g. the session was reset): refetch it and go to the second step.
      onMfaRequired: () => {
        void qc.invalidateQueries({ queryKey: ['me'] });
        if (window.location.pathname !== TWO_FACTOR_PATH) navigate(TWO_FACTOR_PATH, { replace: true });
      },
    });
    return onTokenRemovedElsewhere(() => void signOut('signed_out', { callApi: false }));
  }, [signOut, qc]);

  const signIn = React.useCallback(
    async (email: string, password: string) => {
      const { error } = await authClient.signIn.email({ email, password });
      if (error) throw new Error(authErrorMessage(error as any));
      try {
        const profile = await fetchMe();
        qc.setQueryData(['me'], profile);
        setStatus('authenticated');
        return profile;
      } catch (err) {
        clearToken();
        if (err instanceof ApiError && err.code === 'ACCOUNT_DEACTIVATED') throw new Error(err.message);
        throw new Error(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      }
    },
    [qc],
  );

  const refreshProfile = React.useCallback(async () => {
    const r = await me.refetch();
    return r.data ?? null;
  }, [me]);

  const value = React.useMemo<AuthValue>(
    () => ({ status, profile, signIn, signOut: (r, o) => signOut(r, o), refreshProfile, signOutTarget }),
    [status, profile, signIn, signOut, refreshProfile, signOutTarget],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const TWO_FACTOR_PATH = '/admin/two-factor';

/**
 * Set while the two-step page shows the one-time recovery codes: the session is already verified, but the guard must
 * not send the user away (a /me refetch on window focus would) until they've saved the codes and pressed Continue.
 */
export const twoFactorHold = { current: false };

/**
 * The step a signed-in user must finish before anything else, or null. An enrolled Super Admin proves the second
 * factor first (even before replacing a temporary password); a new one replaces the temporary password, then sets
 * up the authenticator. The API enforces the same order (requireMfa, requirePasswordFresh).
 */
export function nextStep(profile: Me): '/change-password' | typeof TWO_FACTOR_PATH | null {
  const mfaPending = profile.mfa.required && !profile.mfa.verified;
  if (mfaPending && profile.mfa.enrolled) return TWO_FACTOR_PATH;
  if (profile.mustChangePassword) return '/change-password';
  if (mfaPending) return TWO_FACTOR_PATH;
  return null;
}

export function roleHome(role: Me['role']): string {
  return role === 'super_admin' ? '/admin/dashboard' : role === 'department_staff' ? '/staff' : '/dashboard';
}

export function canAccess(role: Me['role'], path: string): boolean {
  const adminPath = path.startsWith('/admin');
  return role === 'super_admin' ? adminPath || path.startsWith('/change-password') : !adminPath;
}
