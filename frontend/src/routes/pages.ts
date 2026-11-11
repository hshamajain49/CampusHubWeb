// Lazy page loaders, shared by the router and idle prefetching. Calling a loader warms the module cache, so the
// data router's later `lazy()` resolves at once and navigation never waits on the network.
import * as React from 'react';

export const memberPages = {
  dashboard: () => import('@/features/dashboard/dashboard-page'),
  venueList: () => import('@/features/venues/venue-list-page'),
  venueDetail: () => import('@/features/venues/venue-detail-page'),
  bookingLists: () => import('@/features/bookings/list-pages'),
  bookingForms: () => import('@/features/bookings/booking-form-pages'),
  bookingDetail: () => import('@/features/bookings/booking-detail-page'),
  bookingSubmitted: () => import('@/features/bookings/booking-submitted-page'),
  profile: () => import('@/features/profile/profile-page'),
  notifications: () => import('@/features/notifications/notifications-page'),
};

export const authPages = {
  register: () => import('@/features/auth/register-page'),
  passwords: () => import('@/features/auth/password-pages'),
  changePassword: () => import('@/features/auth/change-password-page'),
};

export const adminPages = {
  dashboard: () => import('@/features/admin/dashboard/admin-dashboard-page'),
  approvals: () => import('@/features/admin/approvals/approvals-page'),
  bookings: () => import('@/features/admin/bookings/bookings-page'),
  bookingDetail: () => import('@/features/admin/bookings/admin-booking-detail-page'),
  calendar: () => import('@/features/admin/calendar/admin-calendar-page'),
  venues: () => import('@/features/admin/venues/venues-page'),
  venueNew: () => import('@/features/admin/venues/venue-new-page'),
  venueDetail: () => import('@/features/admin/venues/venue-detail-admin-page'),
  venueEdit: () => import('@/features/admin/venues/venue-edit-page'),
  users: () => import('@/features/admin/users/users-page'),
  userNew: () => import('@/features/admin/users/create-user-page'),
  userDetail: () => import('@/features/admin/users/user-detail-page'),
  reports: () => import('@/features/admin/reports/reports-page'),
  settings: () => import('@/features/admin/settings/settings-page'),
  audit: () => import('@/features/admin/audit/audit-log-page'),
};

/** Warms the given page chunks once the browser is idle after the shell mounts. Skipped on Save-Data connections. */
export function usePrefetchPages(loaders: Record<string, () => Promise<unknown>>) {
  React.useEffect(() => {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;
    const run = () => Object.values(loaders).forEach((load) => void load().catch(() => undefined));
    // Safari has no requestIdleCallback; a short timeout keeps it off the first paint.
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(run, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(run, 1500);
    return () => clearTimeout(t);
  }, [loaders]);
}
