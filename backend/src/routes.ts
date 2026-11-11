// Every /api/v1 router with its guard chain (§10.2 step 11). Thin controllers: HTTP ↔ service calls only.
import { Router, type Express, type RequestHandler } from 'express';
import {
  ROLES,
  adminBookingsQuery,
  adminCancelBody,
  adminExportQuery,
  adminVenuesQuery,
  approveBody,
  auditQuery,
  availabilityCheckQuery,
  availabilityQuery,
  blockCreateBody,
  blockIdParam,
  blockListQuery,
  blockUpdateBody,
  bookingCancelBody,
  bookingCreateBody,
  bookingIdParam,
  bookingUpdateBody,
  calendarQuery,
  changePasswordBody,
  createUserBody,
  deactivateUserBody,
  deactivateVenueBody,
  myBookingsQuery,
  notificationIdParam,
  notificationsQuery,
  pushSubscriptionBody,
  pushUnsubscribeBody,
  registerBody,
  rejectBody,
  reportsQuery,
  settingsUpdateBody,
  updateMeBody,
  updateUserBody,
  userIdParam,
  usersQuery,
  venueCreateBody,
  venueIdParam,
  venueListQuery,
  venueUpdateBody,
  type Role,
} from '@campushub/shared';
import { z } from 'zod';
import { actorOf, authenticate, guard, loadProfile, requireActive } from './middleware/authenticate.js';
import { validate } from './middleware/validate.js';
import { limits } from './middleware/rate-limiters.js';
import { uploadImage } from './middleware/upload-image.js';
import { appError } from './errors/app-error.js';
import { pool } from './db/pool.js';
import { loadCampus } from './domain/settings.js';
import { createTokenRequest, realtimeEnabled } from './lib/realtime.js';
import * as me from './modules/me/me.service.js';
import * as settings from './modules/settings/settings.service.js';
import * as venues from './modules/venues/venues.service.js';
import * as bookings from './modules/bookings/bookings.service.js';
import { renderConfirmationPdf } from './modules/bookings/confirmation-pdf.js';
import * as adminBookings from './modules/admin-bookings/admin-bookings.service.js';
import * as adminVenues from './modules/admin-venues/admin-venues.service.js';
import * as blocks from './modules/venue-blocks/venue-blocks.service.js';
import * as users from './modules/admin-users/admin-users.service.js';
import * as reports from './modules/reports/reports.service.js';
import * as dashboard from './modules/admin-dashboard/admin-dashboard.service.js';
import * as notifications from './modules/notifications/notifications.service.js';
import { maybeRunExpiry } from './modules/jobs/jobs.service.js';

const MEMBERS: Role[] = ['student', 'faculty_staff'];
const ADMINS: Role[] = ['super_admin'];
const ANY: Role[] = [...ROLES];

/** K2: opportunistic expiry after authenticated responses (at most once a minute). */
const opportunisticExpiry: RequestHandler = (_req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode < 500) maybeRunExpiry();
  });
  next();
};

async function sendPdf(res: Parameters<RequestHandler>[1], booking: Awaited<ReturnType<typeof bookings.getMemberBooking>>) {
  const { settings: s } = await loadCampus(pool);
  const pdf = await renderConfirmationPdf(booking, {
    institutionName: s.institutionName,
    supportEmail: s.supportEmail,
    campusTimezone: s.campusTimezone,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="booking-confirmation-${booking.reference}.pdf"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(pdf);
}

// ───────────────────────────── public ─────────────────────────────
function publicRouter() {
  const r = Router();
  r.get('/settings/public', async (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ data: await settings.publicSettings() });
  });
  r.post('/auth/register', limits.register, validate({ body: registerBody }), async (req, res) => {
    res.status(201).json({ data: await me.register(req.valid.body) });
  });
  return r;
}

// ───────────────────────────── /me ─────────────────────────────
function meRouter() {
  const r = Router();
  r.use(authenticate, loadProfile, requireActive);
  r.get('/', (req, res) => void res.json({ data: me.toMe(req.profile!) }));
  r.patch('/', validate({ body: updateMeBody }), async (req, res) => {
    res.json({ data: await me.updateMe(req.profile!, req.valid.body) });
  });
  r.post('/change-password', limits.changePassword, validate({ body: changePasswordBody }), async (req, res) => {
    await me.changePassword(req.profile!.id, req.auth!.sessionId, req.valid.body);
    res.status(204).end();
  });
  const fresh = guard({ roles: MEMBERS }).slice(3);
  r.get('/dashboard', ...fresh, async (req, res) => {
    res.json({ data: await bookings.memberDashboard(req.profile!.id) });
  });
  const pushGuard = guard({ roles: ANY }).slice(3);
  r.post('/push-subscriptions', ...pushGuard, limits.push, validate({ body: pushSubscriptionBody }), async (req, res) => {
    await me.addPushSubscription(req.profile!.id, req.get('user-agent') ?? null, req.valid.body);
    res.status(204).end();
  });
  r.delete('/push-subscriptions', ...pushGuard, limits.push, validate({ body: pushUnsubscribeBody }), async (req, res) => {
    await me.removePushSubscription(req.profile!.id, req.valid.body.endpoint);
    res.status(204).end();
  });
  return r;
}

// ───────────────────────────── notifications + realtime ─────────────────────────────
function notificationsRouter() {
  const r = Router();
  r.use(...guard({ roles: ANY }));
  r.get('/', validate({ query: notificationsQuery }), async (req, res) => {
    res.json(await notifications.listNotifications(req.profile!.id, req.valid.query));
  });
  r.get('/unread-count', async (req, res) => void res.json({ data: await notifications.unreadCount(req.profile!.id) }));
  r.post('/read-all', async (req, res) => void res.json({ data: await notifications.markAllRead(req.profile!.id) }));
  r.post('/:notificationId/read', validate({ params: notificationIdParam }), async (req, res) => {
    await notifications.markRead(req.profile!.id, req.valid.params.notificationId);
    res.status(204).end();
  });
  return r;
}

function realtimeRouter() {
  const r = Router();
  r.use(...guard({ roles: ANY }));
  r.post('/token', limits.realtimeToken, async (req, res) => {
    if (!realtimeEnabled) throw appError('NOT_FOUND', 'Realtime is not configured.');
    res.json({ data: await createTokenRequest(req.profile!.id, req.profile!.role === 'super_admin') });
  });
  return r;
}

// ───────────────────────────── member: venues + bookings ─────────────────────────────
function venuesRouter() {
  const r = Router();
  r.use(...guard({ roles: MEMBERS }), opportunisticExpiry);
  r.get('/', validate({ query: venueListQuery }), async (req, res) => void res.json(await venues.listActiveVenues(req.valid.query)));
  r.get('/:venueId', validate({ params: venueIdParam }), async (req, res) => {
    res.json({ data: await venues.getActiveVenue(req.valid.params.venueId) });
  });
  r.get('/:venueId/availability', validate({ params: venueIdParam, query: availabilityQuery }), async (req, res) => {
    res.json({ data: await venues.venueAvailability(req.valid.params.venueId, req.profile!.id, req.valid.query) });
  });
  r.get(
    '/:venueId/availability/check',
    limits.availabilityCheck,
    validate({ params: venueIdParam, query: availabilityCheckQuery }),
    async (req, res) => {
      res.json({ data: await venues.availabilityCheck(req.valid.params.venueId, req.profile!.id, req.valid.query) });
    },
  );
  return r;
}

const idempotencyKey = z.guid().optional();

function bookingsRouter() {
  const r = Router();
  r.use(...guard({ roles: MEMBERS }), opportunisticExpiry);
  r.post('/', limits.bookingWrites, validate({ body: bookingCreateBody }), async (req, res) => {
    const key = idempotencyKey.safeParse(req.get('idempotency-key') || undefined);
    if (!key.success) throw appError('VALIDATION_ERROR', 'Idempotency-Key must be a UUID', { fieldErrors: {}, formErrors: [] });
    const { booking, replay } = await bookings.createBooking(actorOf(req), req.valid.body, key.data ?? null);
    if (replay) {
      res.setHeader('Idempotent-Replay', 'true');
      return void res.status(200).json({ data: booking });
    }
    res.setHeader('Location', `/api/v1/bookings/${booking.id}`);
    res.status(201).json({ data: booking });
  });
  r.get('/', validate({ query: myBookingsQuery }), async (req, res) => void res.json(await bookings.listMyBookings(req.profile!.id, req.valid.query)));
  r.get('/:bookingId', validate({ params: bookingIdParam }), async (req, res) => {
    res.json({ data: await bookings.getMemberBooking(req.profile!.id, req.valid.params.bookingId) });
  });
  r.patch('/:bookingId', limits.bookingWrites, validate({ params: bookingIdParam, body: bookingUpdateBody }), async (req, res) => {
    res.json({ data: await bookings.updateBooking(actorOf(req), req.valid.params.bookingId, req.valid.body) });
  });
  r.post('/:bookingId/cancel', limits.bookingWrites, validate({ params: bookingIdParam, body: bookingCancelBody }), async (req, res) => {
    res.json({ data: await bookings.cancelBooking(actorOf(req), req.valid.params.bookingId, req.valid.body) });
  });
  r.get('/:bookingId/confirmation.pdf', limits.exports, validate({ params: bookingIdParam }), async (req, res) => {
    await sendPdf(res, await bookings.getMemberBooking(req.profile!.id, req.valid.params.bookingId));
  });
  return r;
}

// ───────────────────────────── admin ─────────────────────────────
function adminRouter() {
  const r = Router();
  r.use(...guard({ roles: ADMINS }), opportunisticExpiry);

  r.get('/dashboard', async (_req, res) => void res.json({ data: await dashboard.adminDashboard() }));

  r.get('/bookings', validate({ query: adminBookingsQuery }), async (req, res) => void res.json(await adminBookings.listAdminBookings(req.valid.query)));
  r.get('/bookings/export.csv', limits.exports, validate({ query: adminExportQuery }), async (req, res) => {
    const { csv, filename } = await adminBookings.exportCsv(req.valid.query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  });
  r.get('/bookings/:bookingId', validate({ params: bookingIdParam }), async (req, res) => {
    res.json({ data: await adminBookings.getAdminBooking(req.valid.params.bookingId) });
  });
  r.post('/bookings/:bookingId/approve', validate({ params: bookingIdParam, body: approveBody }), async (req, res) => {
    res.json({ data: await adminBookings.approveBooking(actorOf(req), req.valid.params.bookingId, req.valid.body) });
  });
  r.post('/bookings/:bookingId/reject', validate({ params: bookingIdParam, body: rejectBody }), async (req, res) => {
    res.json({ data: await adminBookings.rejectBooking(actorOf(req), req.valid.params.bookingId, req.valid.body) });
  });
  r.post('/bookings/:bookingId/cancel', validate({ params: bookingIdParam, body: adminCancelBody }), async (req, res) => {
    res.json({ data: await adminBookings.adminCancelBooking(actorOf(req), req.valid.params.bookingId, req.valid.body) });
  });
  r.get('/bookings/:bookingId/confirmation.pdf', limits.exports, validate({ params: bookingIdParam }), async (req, res) => {
    await sendPdf(res, await bookings.getBookingAnyOwner(req.valid.params.bookingId));
  });

  r.get('/calendar', validate({ query: calendarQuery }), async (req, res) => void res.json({ data: await dashboard.calendar(req.valid.query) }));

  r.get('/venues', validate({ query: adminVenuesQuery }), async (req, res) => void res.json(await adminVenues.listAdminVenues(req.valid.query)));
  r.post('/venues', validate({ body: venueCreateBody }), async (req, res) => {
    res.status(201).json({ data: await adminVenues.createVenue(actorOf(req), req.valid.body) });
  });
  r.get('/venues/:venueId', validate({ params: venueIdParam }), async (req, res) => {
    res.json({ data: await adminVenues.getAdminVenue(req.valid.params.venueId) });
  });
  r.patch('/venues/:venueId', validate({ params: venueIdParam, body: venueUpdateBody }), async (req, res) => {
    res.json({ data: await adminVenues.updateVenue(actorOf(req), req.valid.params.venueId, req.valid.body) });
  });
  r.post('/venues/:venueId/deactivate', validate({ params: venueIdParam, body: deactivateVenueBody }), async (req, res) => {
    res.json({ data: await adminVenues.deactivateVenue(actorOf(req), req.valid.params.venueId, req.valid.body) });
  });
  r.post('/venues/:venueId/activate', validate({ params: venueIdParam }), async (req, res) => {
    res.json({ data: await adminVenues.activateVenue(actorOf(req), req.valid.params.venueId) });
  });
  r.delete('/venues/:venueId', validate({ params: venueIdParam }), async (req, res) => {
    await adminVenues.deleteVenue(actorOf(req), req.valid.params.venueId);
    res.status(204).end();
  });
  r.put('/venues/:venueId/image', limits.photo, validate({ params: venueIdParam }), uploadImage, async (req, res) => {
    res.json({ data: await adminVenues.uploadVenueImage(actorOf(req), req.valid.params.venueId, req.file!.buffer) });
  });
  r.delete('/venues/:venueId/image', validate({ params: venueIdParam }), async (req, res) => {
    res.json({ data: await adminVenues.removeVenueImage(actorOf(req), req.valid.params.venueId) });
  });

  r.get('/venue-blocks', validate({ query: blockListQuery }), async (req, res) => void res.json(await blocks.listBlocks(req.valid.query)));
  r.post('/venue-blocks', validate({ body: blockCreateBody }), async (req, res) => {
    res.status(201).json({ data: await blocks.createBlock(actorOf(req), req.valid.body) });
  });
  r.patch('/venue-blocks/:blockId', validate({ params: blockIdParam, body: blockUpdateBody }), async (req, res) => {
    res.json({ data: await blocks.updateBlock(actorOf(req), req.valid.params.blockId, req.valid.body) });
  });
  r.delete('/venue-blocks/:blockId', validate({ params: blockIdParam }), async (req, res) => {
    await blocks.deleteBlock(actorOf(req), req.valid.params.blockId);
    res.status(204).end();
  });

  r.get('/users', validate({ query: usersQuery }), async (req, res) => void res.json(await users.listUsers(req.valid.query)));
  r.post('/users', validate({ body: createUserBody }), async (req, res) => {
    res.status(201).json({ data: await users.createUser(actorOf(req), req.valid.body) });
  });
  r.get('/users/:userId', validate({ params: userIdParam }), async (req, res) => {
    res.json({ data: await users.getUser(actorOf(req), req.valid.params.userId) });
  });
  r.patch('/users/:userId', validate({ params: userIdParam, body: updateUserBody }), async (req, res) => {
    res.json({ data: await users.updateUser(actorOf(req), req.valid.params.userId, req.valid.body) });
  });
  r.post('/users/:userId/deactivate', validate({ params: userIdParam, body: deactivateUserBody }), async (req, res) => {
    res.json({ data: await users.deactivateUser(actorOf(req), req.valid.params.userId, req.valid.body) });
  });
  r.post('/users/:userId/activate', validate({ params: userIdParam }), async (req, res) => {
    res.json({ data: await users.activateUser(actorOf(req), req.valid.params.userId) });
  });
  r.post('/users/:userId/password-reset', limits.passwordResetByAdmin, validate({ params: userIdParam }), async (req, res) => {
    res.status(202).json({ data: await users.sendUserPasswordReset(actorOf(req), req.valid.params.userId) });
  });

  r.get('/reports/summary', validate({ query: reportsQuery }), async (req, res) => void res.json({ data: await reports.reportSummary(req.valid.query) }));
  r.get('/settings', async (_req, res) => void res.json({ data: await settings.adminSettings() }));
  r.patch('/settings', validate({ body: settingsUpdateBody }), async (req, res) => {
    res.json({ data: await settings.updateSettings(actorOf(req), req.valid.body) });
  });
  r.get('/audit-logs', validate({ query: auditQuery }), async (req, res) => void res.json(await dashboard.auditLogs(req.valid.query)));
  return r;
}

interface Mount {
  path: string;
  router: Router;
  /** null = public. Every other router must declare the roles it admits (default deny, §21.5). */
  roles: Role[] | null;
}

export function mountRoutes(app: Express) {
  const mounts: Mount[] = [
    { path: '/api/v1', router: publicRouter(), roles: null },
    { path: '/api/v1/me', router: meRouter(), roles: ANY },
    { path: '/api/v1/notifications', router: notificationsRouter(), roles: ANY },
    { path: '/api/v1/realtime', router: realtimeRouter(), roles: ANY },
    { path: '/api/v1/venues', router: venuesRouter(), roles: MEMBERS },
    { path: '/api/v1/bookings', router: bookingsRouter(), roles: MEMBERS },
    { path: '/api/v1/admin', router: adminRouter(), roles: ADMINS },
  ];
  // Startup self-check: only the explicitly public router may lack a role list.
  for (const m of mounts) {
    if (m.roles === null && m.path !== '/api/v1') throw new Error(`Router ${m.path} has no role guard`);
  }
  for (const m of mounts) app.use(m.path, m.router);
}
