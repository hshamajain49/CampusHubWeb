import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { setNavigate } from '@/lib/navigation';
import { RedirectIfAuthenticated, RequireAuth, RequireRole, RootRedirect } from '@/routes/guards';
import { adminPages as A, authPages, memberPages as M } from '@/routes/pages';
import { RouteErrorBoundary } from '@/components/common/route-error-boundary';
import { FullScreenSpinner } from '@/components/ui/spinner';
import { AuthLayout } from '@/layouts/auth-layout';
import { UserLayout } from '@/layouts/user-layout';
import { LoginPage } from '@/features/auth/login-page';
import { NotFoundPage } from '@/features/misc/not-found-page';

/** Route-level code splitting: admin pages export a default component… */
const admin = (load: () => Promise<{ default: React.ComponentType }>): Pick<RouteObject, 'lazy'> => ({
  lazy: async () => ({ Component: (await load()).default }),
});

/** …member and auth pages export named components. Login and 404 stay in the entry chunk (cold-start landings). */
const page = <T,>(load: () => Promise<T>, name: keyof T): Pick<RouteObject, 'lazy'> => ({
  lazy: async () => ({ Component: (await load())[name] as React.ComponentType }),
});

const routes: RouteObject[] = [
  {
    // Shown only while a deep-linked lazy route's chunk loads on first paint.
    HydrateFallback: FullScreenSpinner,
    errorElement: <RouteErrorBoundary />,
    children: [
      { path: '/', element: <RootRedirect /> },
      {
        element: <RedirectIfAuthenticated />,
        children: [
          {
            element: <AuthLayout />,
            children: [
              { path: '/login', element: <LoginPage variant="member" /> },
              { path: '/admin/login', element: <LoginPage variant="admin" /> },
              { path: '/register', ...page(authPages.register, 'RegisterPage') },
            ],
          },
        ],
      },
      {
        element: <AuthLayout />,
        children: [
          { path: '/forgot-password', ...page(authPages.passwords, 'ForgotPasswordPage') },
          { path: '/reset-password', ...page(authPages.passwords, 'ResetPasswordPage') },
        ],
      },
      {
        element: <RequireAuth allowPasswordChange />,
        children: [{ element: <AuthLayout />, children: [{ path: '/change-password', ...page(authPages.changePassword, 'ChangePasswordPage') }] }],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <RequireRole roles={['student', 'faculty_staff']} />,
            children: [
              {
                element: <UserLayout />,
                errorElement: <RouteErrorBoundary />,
                children: [
                  { path: '/dashboard', ...page(M.dashboard, 'DashboardPage') },
                  { path: '/venues', ...page(M.venueList, 'VenueListPage') },
                  { path: '/venues/:venueId', ...page(M.venueDetail, 'VenueDetailPage') },
                  { path: '/bookings', ...page(M.bookingLists, 'MyBookingsPage') },
                  { path: '/bookings/history', ...page(M.bookingLists, 'BookingHistoryPage') },
                  { path: '/bookings/new', ...page(M.bookingForms, 'NewBookingPage') },
                  { path: '/bookings/:bookingId', ...page(M.bookingDetail, 'BookingDetailPage') },
                  { path: '/bookings/:bookingId/edit', ...page(M.bookingForms, 'EditBookingPage') },
                  { path: '/bookings/:bookingId/submitted', ...page(M.bookingSubmitted, 'BookingSubmittedPage') },
                  { path: '/profile', ...page(M.profile, 'ProfilePage') },
                  { path: '/notifications', ...page(M.notifications, 'NotificationsPage') },
                ],
              },
            ],
          },
          {
            element: <RequireRole roles={['super_admin']} />,
            children: [
              {
                lazy: async () => ({ Component: (await import('@/layouts/admin-layout')).AdminLayout }),
                errorElement: <RouteErrorBoundary />,
                children: [
                  { path: '/admin', element: <Navigate to="/admin/dashboard" replace /> },
                  { path: '/admin/dashboard', ...admin(A.dashboard) },
                  { path: '/admin/approvals', ...admin(A.approvals) },
                  { path: '/admin/bookings', ...admin(A.bookings) },
                  { path: '/admin/bookings/:bookingId', ...admin(A.bookingDetail) },
                  { path: '/admin/calendar', ...admin(A.calendar) },
                  { path: '/admin/venues', ...admin(A.venues) },
                  { path: '/admin/venues/new', ...admin(A.venueNew) },
                  { path: '/admin/venues/:venueId', ...admin(A.venueDetail) },
                  { path: '/admin/venues/:venueId/edit', ...admin(A.venueEdit) },
                  { path: '/admin/users', ...admin(A.users) },
                  { path: '/admin/users/new', ...admin(A.userNew) },
                  { path: '/admin/users/:userId', ...admin(A.userDetail) },
                  { path: '/admin/reports', ...admin(A.reports) },
                  { path: '/admin/settings', ...admin(A.settings) },
                  { path: '/admin/settings/audit-log', ...admin(A.audit) },
                  { path: '/admin/profile', ...page(M.profile, 'ProfilePage') },
                  { path: '/admin/notifications', ...page(M.notifications, 'NotificationsPage') },
                ],
              },
            ],
          },
        ],
      },
      // Dev-only break-ui harness (worst-case fixtures). Tree-shaken out of production builds.
      ...(import.meta.env.DEV ? [{ path: '/dev/break-ui', ...admin(() => import('@/features/dev/break-ui-page')) }] : []),
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
setNavigate((to, opts) => void router.navigate(to, opts));
