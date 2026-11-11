// Route guards (§9.3). UX only — the API is authoritative.
import { Navigate, Outlet, useLocation } from 'react-router';
import type { Role } from '@campushub/shared';
import { FullScreenSpinner } from '@/components/ui/spinner';
import { roleHome, useAuth } from '@/providers/auth-provider';

export function RequireAuth({ allowPasswordChange = false }: { allowPasswordChange?: boolean }) {
  const { status, profile } = useAuth();
  const loc = useLocation();
  if (status === 'loading') return <FullScreenSpinner />;
  if (status === 'unauthenticated' || !profile) {
    const login = loc.pathname.startsWith('/admin') ? '/admin/login' : '/login';
    return <Navigate to={`${login}?redirectTo=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  }
  if (profile.mustChangePassword && !allowPasswordChange) return <Navigate to="/change-password" replace />;
  return <Outlet />;
}

export function RequireRole({ roles }: { roles: Role[] }) {
  const { profile } = useAuth();
  if (profile && !roles.includes(profile.role)) return <Navigate to={roleHome(profile.role)} replace />;
  return <Outlet />;
}

export function RedirectIfAuthenticated() {
  const { status, profile } = useAuth();
  if (status === 'loading') return <FullScreenSpinner />;
  if (status === 'authenticated' && profile) {
    return <Navigate to={profile.mustChangePassword ? '/change-password' : roleHome(profile.role)} replace />;
  }
  return <Outlet />;
}

export function RootRedirect() {
  const { status, profile } = useAuth();
  if (status === 'loading') return <FullScreenSpinner />;
  if (!profile) return <Navigate to="/login" replace />;
  return <Navigate to={roleHome(profile.role)} replace />;
}
