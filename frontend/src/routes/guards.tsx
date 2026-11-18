// Route guards (§9.3). UX only — the API is authoritative.
import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router';
import { safeRedirect } from '@/lib/navigation';
import type { Role } from '@campushub/shared';
import { FullScreenSpinner } from '@/components/ui/spinner';
import { canAccess, nextStep, roleHome, TWO_FACTOR_PATH, twoFactorHold, useAuth } from '@/providers/auth-provider';

/**
 * step: the page under this guard IS that step (the change-password or two-step verification page). Any other
 * pending step wins first; once nothing is pending, the two-step page sends the user home.
 */
export function RequireAuth({ step }: { step?: '/change-password' | typeof TWO_FACTOR_PATH }) {
  const { status, profile, signOutTarget } = useAuth();
  const loc = useLocation();
  if (status === 'loading') return <FullScreenSpinner />;
  if (status === 'unauthenticated' || !profile) {
    if (signOutTarget) return <Navigate to={signOutTarget} replace />;
    const login = loc.pathname.startsWith('/admin') ? '/admin/login' : '/login';
    return <Navigate to={`${login}?redirectTo=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  }
  const pending = nextStep(profile);
  if (pending && pending !== step) return <Navigate to={pending} replace />;
  // Voluntary password changes stay possible; the two-step page only makes sense while that step is pending.
  if (!pending && step === TWO_FACTOR_PATH && !twoFactorHold.current) return <Navigate to={roleHome(profile.role)} replace />;
  return <Outlet />;
}

export function RequireRole({ roles }: { roles: Role[] }) {
  const { profile } = useAuth();
  if (profile && !roles.includes(profile.role)) return <Navigate to={roleHome(profile.role)} replace />;
  return <Outlet />;
}

export function RedirectIfAuthenticated() {
  const { status, profile } = useAuth();
  const [params] = useSearchParams();
  if (status === 'loading') return <FullScreenSpinner />;
  if (status === 'authenticated' && profile) {
    // Signing in re-renders this guard before the login form's own navigate runs, so the deep link
    // (?redirectTo=, e.g. after a session expired) is honoured here too — same checks as the login page.
    const target = safeRedirect(params.get('redirectTo'));
    const keep = target && canAccess(profile.role, target) ? target : null;
    const step = nextStep(profile);
    if (step) return <Navigate to={keep ? `${step}?redirectTo=${encodeURIComponent(keep)}` : step} replace />;
    return <Navigate to={keep ?? roleHome(profile.role)} replace />;
  }
  return <Outlet />;
}

export function RootRedirect() {
  const { status, profile } = useAuth();
  if (status === 'loading') return <FullScreenSpinner />;
  if (!profile) return <Navigate to="/login" replace />;
  return <Navigate to={roleHome(profile.role)} replace />;
}
