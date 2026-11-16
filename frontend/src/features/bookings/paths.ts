// Where the booking pages link to. Members use /bookings and /venues; the Super Admin books from the admin area, where
// the same pages are mounted under /admin/my-bookings and /admin/book (and venues are the admin venue pages).
import { useLocation } from 'react-router';

export interface BookingPaths {
  list: string;
  history: string;
  /** New booking form; `query` starts with "?" when given. */
  create: (query?: string) => string;
  detail: (id: string) => string;
  edit: (id: string) => string;
  submitted: (id: string) => string;
  venue: (id: string) => string;
  venues: string;
  home: string;
  profile: string;
}

export const MEMBER_BOOKING_PATHS: BookingPaths = {
  list: '/bookings',
  history: '/bookings/history',
  create: (query = '') => `/bookings/new${query}`,
  detail: (id) => `/bookings/${id}`,
  edit: (id) => `/bookings/${id}/edit`,
  submitted: (id) => `/bookings/${id}/submitted`,
  venue: (id) => `/venues/${id}`,
  venues: '/venues',
  home: '/dashboard',
  profile: '/profile',
};

export const ADMIN_BOOKING_PATHS: BookingPaths = {
  list: '/admin/my-bookings',
  history: '/admin/my-bookings/history',
  create: (query = '') => `/admin/book${query}`,
  detail: (id) => `/admin/my-bookings/${id}`,
  edit: (id) => `/admin/my-bookings/${id}/edit`,
  submitted: (id) => `/admin/my-bookings/${id}/submitted`,
  venue: (id) => `/admin/venues/${id}`,
  venues: '/admin/venues',
  home: '/admin/dashboard',
  profile: '/admin/profile',
};

export function useBookingPaths(): BookingPaths {
  return useLocation().pathname.startsWith('/admin') ? ADMIN_BOOKING_PATHS : MEMBER_BOOKING_PATHS;
}
