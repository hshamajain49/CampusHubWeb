// Every /api/v1 router with its guard chain (§10.2 step 11). Thin controllers: HTTP ↔ service calls only.
import { Router, type Express, type RequestHandler } from 'express';
import {
  MEMBER_ROLES,
  ROLES,
  adminSuggestionsQuery,
  closeComplaintBody,
  complaintReassignBody,
  deleteAccountBody,
  dismissReassignmentBody,
  mfaCodeBody,
  mfaSetupBody,
  mySuggestionsQuery,
  suggestionCreateBody,
  suggestionIdParam,
  suggestionReviewBody,
  adminComplaintsExportQuery,
  adminComplaintsQuery,
  categoryCreateBody,
  categoryIdParam,
  categoryUpdateBody,
  completeWorkData,
  complaintCreateData,
  complaintIdParam,
  complaintRejectBody,
  complaintReportsQuery,
  complaintReporterReopenBody,
  complaintVersionBody,
  complaintWithdrawBody,
  departmentCreateBody,
  departmentIdParam,
  departmentUpdateBody,
  myComplaintsQuery,
  requestReassignmentBody,
  staffComplaintsQuery,
  staffNoteBody,
  adminBookingsQuery,
  adminCancelBody,
  adminExportQuery,
  adminVenuesQuery,
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
import { actorOf, authenticate, guard, loadProfile, requireActive, requireMfa, requireRole } from './middleware/authenticate.js';
import { validate } from './middleware/validate.js';
import { limits } from './middleware/rate-limiters.js';
import { uploadImage } from './middleware/upload-image.js';
import { photosOf, uploadPhotos } from './middleware/upload.js';
import { requireServiceDepartment } from './middleware/require-service-department.js';
import { appError } from './errors/app-error.js';
import { pool } from './db/pool.js';
import { loadCampus } from './domain/settings.js';
import { createTokenRequest, realtimeEnabled } from './lib/realtime.js';
import * as me from './modules/me/me.service.js';
import * as mfa from './modules/mfa/mfa.service.js';
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
import * as complaints from './modules/complaints/complaints.service.js';
import * as staff from './modules/staff-complaints/staff-complaints.service.js';
import * as adminComplaints from './modules/admin-complaints/admin-complaints.service.js';
import * as complaintSetup from './modules/complaint-setup/complaint-setup.service.js';
import * as complaintReports from './modules/complaint-reports/complaint-reports.service.js';
import * as suggestions from './modules/suggestions/suggestions.service.js';
import { deleteOwnAccount } from './modules/account/account-deletion.service.js';

/** Members (student, faculty_staff, department_staff) use venues and bookings (COMPLAINT_REGISTRATION_SPEC.md CD-02). */
const MEMBERS: Role[] = [...MEMBER_ROLES];
const STAFF: Role[] = ['department_staff'];
const ADMINS: Role[] = ['super_admin'];
/** Who can book venues: every member, and the Super Admin for their own events (from the admin area). */
const BOOKERS: Role[] = [...MEMBER_ROLES, 'super_admin'];
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
  const mfaStatusOf = (req: Req) => mfa.mfaStatus(req.profile!.id, req.profile!.role, req.auth!.sessionId);
  // GET /me answers before the second step too: the SPA reads mfa.{required,enrolled,verified} from it.
  r.get('/', async (req, res) => void res.json({ data: me.toMe(req.profile!, await mfaStatusOf(req)) }));
  r.patch('/', requireMfa(), validate({ body: updateMeBody }), async (req, res) => {
    res.json({ data: await me.updateMe(req.profile!, req.valid.body, await mfaStatusOf(req)) });
  });
  // A temporary password is replaced before two-step verification is set up, so this is open to unenrolled admins.
  r.post('/change-password', limits.changePassword, requireMfa({ allowUnenrolled: true }), validate({ body: changePasswordBody }), async (req, res) => {
    await me.changePassword(req.profile!.id, req.profile!.role, req.auth!.sessionId, req.valid.body);
    res.status(204).end();
  });
  // Permanent account deletion (password + typed DELETE); the last Super Admin is refused (docs/ACCOUNTS.md).
  r.delete('/', limits.changePassword, requireMfa(), validate({ body: deleteAccountBody }), async (req, res) => {
    res.json({ data: await deleteOwnAccount(req.profile!, req.valid.body) });
  });

  // Two-step verification (security/AUDIT.md F-02): Super Admins only. These are the steps an unverified session
  // may take, so they sit outside requireMfa.
  const mfaRoute = [requireRole('super_admin'), limits.mfa] as const;
  const withEmail = (req: Req) => ({ ...actorOf(req), email: req.profile!.email });
  r.post('/mfa/setup', ...mfaRoute, validate({ body: mfaSetupBody }), async (req, res) => {
    res.json({ data: await mfa.setupMfa(withEmail(req), req.valid.body.password) });
  });
  r.post('/mfa/enable', ...mfaRoute, validate({ body: mfaCodeBody }), async (req, res) => {
    res.json({ data: await mfa.enableMfa(actorOf(req), req.auth!.sessionId, req.valid.body.code) });
  });
  r.post('/mfa/verify', ...mfaRoute, validate({ body: mfaCodeBody }), async (req, res) => {
    res.json({ data: await mfa.verifyMfa(actorOf(req), req.auth!.sessionId, req.valid.body.code) });
  });
  r.post('/mfa/recovery-codes', ...mfaRoute, requireMfa(), validate({ body: mfaCodeBody }), async (req, res) => {
    res.json({ data: await mfa.regenerateRecoveryCodes(actorOf(req), req.valid.body.code) });
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
  r.use(...guard({ roles: BOOKERS }), opportunisticExpiry);
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
  r.use(...guard({ roles: BOOKERS }), opportunisticExpiry);
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

// ───────────────────────────── complaints: reporter (any role, §11.2 C01–C07, C30) ─────────────────────────────
type Req = Parameters<RequestHandler>[0];
type Res = Parameters<RequestHandler>[1];

function idempotencyKeyOf(req: Req): string | null {
  const key = idempotencyKey.safeParse(req.get('idempotency-key') || undefined);
  if (!key.success) throw appError('VALIDATION_ERROR', 'Idempotency-Key must be a UUID', { fieldErrors: {}, formErrors: [] });
  return key.data ?? null;
}

function complaintCategoriesRouter() {
  const r = Router();
  r.use(...guard({ roles: ANY }));
  r.get('/', async (_req, res) => void res.json({ data: await complaints.listActiveCategories() }));
  return r;
}

function complaintsRouter() {
  const r = Router();
  r.use(...guard({ roles: ANY }), opportunisticExpiry);
  r.post('/', limits.complaintCreate, uploadPhotos, validate({ body: complaintCreateData }), async (req, res) => {
    const { complaint, replay } = await complaints.createComplaint(actorOf(req), req.valid.body, photosOf(req), idempotencyKeyOf(req));
    if (replay) {
      res.setHeader('Idempotent-Replay', 'true');
      return void res.status(200).json({ data: complaint });
    }
    res.setHeader('Location', `/api/v1/complaints/${complaint.id}`);
    res.status(201).json({ data: complaint });
  });
  r.get('/', validate({ query: myComplaintsQuery }), async (req, res) => void res.json(await complaints.listMyComplaints(req.profile!.id, req.valid.query)));
  r.get('/:complaintId', validate({ params: complaintIdParam }), async (req, res) => {
    res.json({ data: await complaints.getMyComplaint(req.profile!.id, req.valid.params.complaintId) });
  });
  r.post('/:complaintId/approve', limits.complaintActions, validate({ params: complaintIdParam, body: complaintVersionBody }), async (req, res) => {
    res.json({ data: await complaints.approveComplaint(actorOf(req), req.valid.params.complaintId, req.valid.body) });
  });
  r.post('/:complaintId/reject', limits.complaintActions, validate({ params: complaintIdParam, body: complaintRejectBody }), async (req, res) => {
    res.json({ data: await complaints.rejectComplaint(actorOf(req), req.valid.params.complaintId, req.valid.body) });
  });
  r.post('/:complaintId/withdraw', limits.complaintActions, validate({ params: complaintIdParam, body: complaintWithdrawBody }), async (req, res) => {
    res.json({ data: await complaints.withdrawComplaint(actorOf(req), req.valid.params.complaintId, req.valid.body) });
  });
  r.post('/:complaintId/reopen', limits.complaintActions, validate({ params: complaintIdParam, body: complaintReporterReopenBody }), async (req, res) => {
    res.json({ data: await complaints.reporterReopenComplaint(actorOf(req), req.valid.params.complaintId, req.valid.body) });
  });
  // The reporter decides where the complaint belongs (no admin step).
  r.post('/:complaintId/reassign', limits.complaintActions, validate({ params: complaintIdParam, body: complaintReassignBody }), async (req, res) => {
    res.json({ data: await complaints.reassignComplaint(actorOf(req), req.valid.params.complaintId, req.valid.body) });
  });
  r.post(
    '/:complaintId/dismiss-reassignment',
    limits.complaintActions,
    validate({ params: complaintIdParam, body: dismissReassignmentBody }),
    async (req, res) => {
      res.json({ data: await complaints.dismissReassignment(actorOf(req), req.valid.params.complaintId, req.valid.body) });
    },
  );
  return r;
}

// ───────────────────────────── suggestion box (any signed-in user) ─────────────────────────────
function suggestionsRouter() {
  const r = Router();
  r.use(...guard({ roles: ANY }));
  r.post('/', limits.complaintCreate, validate({ body: suggestionCreateBody }), async (req, res) => {
    res.status(201).json({ data: await suggestions.createSuggestion(actorOf(req), req.valid.body) });
  });
  r.get('/', validate({ query: mySuggestionsQuery }), async (req, res) => void res.json(await suggestions.listMySuggestions(req.profile!.id, req.valid.query)));
  return r;
}

// ───────────────────────────── complaints: department staff (§11.2 C08–C14) ─────────────────────────────
function staffRouter() {
  const r = Router();
  r.use(...guard({ roles: STAFF }), requireServiceDepartment, opportunisticExpiry);
  const dept = (req: Req) => req.serviceDepartment!;
  const scope = (req: Req) => ({ kind: 'staff' as const, departmentId: dept(req).id });
  const reply = async (req: Req, res: Res) =>
    void res.json({ data: await staff.getDepartmentComplaint(dept(req).id, req.valid.params.complaintId) });

  r.get('/dashboard', async (req, res) => void res.json({ data: await staff.staffDashboard(dept(req)) }));
  r.get('/complaints', validate({ query: staffComplaintsQuery }), async (req, res) => {
    res.json(await staff.listDepartmentComplaints(dept(req).id, req.valid.query));
  });
  r.get('/complaints/:complaintId', validate({ params: complaintIdParam }), reply);
  r.post('/complaints/:complaintId/start', limits.complaintActions, validate({ params: complaintIdParam, body: staffNoteBody }), async (req, res) => {
    await staff.startWork(actorOf(req), scope(req), req.valid.params.complaintId, req.valid.body);
    await reply(req, res);
  });
  r.post(
    '/complaints/:complaintId/complete',
    limits.workComplete,
    validate({ params: complaintIdParam }),
    uploadPhotos,
    validate({ body: completeWorkData }),
    async (req, res) => {
      await staff.completeWork(actorOf(req), scope(req), req.valid.params.complaintId, req.valid.body, photosOf(req));
      await reply(req, res);
    },
  );
  r.post('/complaints/:complaintId/reopen', limits.complaintActions, validate({ params: complaintIdParam, body: staffNoteBody }), async (req, res) => {
    await staff.reopenWork(actorOf(req), scope(req), req.valid.params.complaintId, req.valid.body);
    await reply(req, res);
  });
  r.post(
    '/complaints/:complaintId/request-reassignment',
    limits.complaintActions,
    validate({ params: complaintIdParam, body: requestReassignmentBody }),
    async (req, res) => {
      await staff.requestReassignment(actorOf(req), dept(req).id, req.valid.params.complaintId, req.valid.body);
      await reply(req, res);
    },
  );
  r.post('/complaints/:complaintId/close', limits.complaintActions, validate({ params: complaintIdParam, body: closeComplaintBody }), async (req, res) => {
    await staff.closeComplaint(actorOf(req), scope(req), req.valid.params.complaintId, req.valid.body);
    await reply(req, res);
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

  // Complaints (COMPLAINT_REGISTRATION_SPEC.md §11.2 C15–C29). Admins file their own complaints through C02.
  r.get('/complaints', validate({ query: adminComplaintsQuery }), async (req, res) => {
    res.json(await adminComplaints.listAdminComplaints(actorOf(req), req.valid.query));
  });
  r.get('/complaints/export.csv', limits.exports, validate({ query: adminComplaintsExportQuery }), async (req, res) => {
    const { csv, filename } = await adminComplaints.exportComplaintsCsv(actorOf(req), req.valid.query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  });
  const adminDetail = async (req: Req, res: Res) =>
    void res.json({ data: await adminComplaints.getAdminComplaint(actorOf(req), req.valid.params.complaintId) });
  // Monitoring only: the department manages the work and the reporter decides where it belongs. An admin acts on a
  // complaint only as its reporter, through the reporter endpoints (/complaints/:id/...).
  r.get('/complaints/:complaintId', validate({ params: complaintIdParam }), adminDetail);

  r.get('/suggestions', validate({ query: adminSuggestionsQuery }), async (req, res) => void res.json(await suggestions.listAdminSuggestions(req.valid.query)));
  r.patch('/suggestions/:suggestionId', validate({ params: suggestionIdParam, body: suggestionReviewBody }), async (req, res) => {
    res.json({ data: await suggestions.reviewSuggestion(actorOf(req), req.valid.params.suggestionId, req.valid.body) });
  });
  r.get('/service-departments', async (_req, res) => void res.json({ data: await complaintSetup.listDepartments() }));
  r.post('/service-departments', validate({ body: departmentCreateBody }), async (req, res) => {
    res.status(201).json({ data: await complaintSetup.createDepartment(actorOf(req), req.valid.body) });
  });
  r.patch('/service-departments/:departmentId', validate({ params: departmentIdParam, body: departmentUpdateBody }), async (req, res) => {
    res.json({ data: await complaintSetup.updateDepartment(actorOf(req), req.valid.params.departmentId, req.valid.body) });
  });
  r.get('/complaint-categories', async (_req, res) => void res.json({ data: await complaintSetup.listAdminCategories() }));
  r.post('/complaint-categories', validate({ body: categoryCreateBody }), async (req, res) => {
    res.status(201).json({ data: await complaintSetup.createCategory(actorOf(req), req.valid.body) });
  });
  r.patch('/complaint-categories/:categoryId', validate({ params: categoryIdParam, body: categoryUpdateBody }), async (req, res) => {
    res.json({ data: await complaintSetup.updateCategory(actorOf(req), req.valid.params.categoryId, req.valid.body) });
  });
  r.get('/reports/complaints', validate({ query: complaintReportsQuery }), async (req, res) => {
    res.json({ data: await complaintReports.complaintReport(req.valid.query) });
  });
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
    { path: '/api/v1/venues', router: venuesRouter(), roles: BOOKERS },
    { path: '/api/v1/bookings', router: bookingsRouter(), roles: BOOKERS },
    { path: '/api/v1/suggestions', router: suggestionsRouter(), roles: ANY },
    { path: '/api/v1/complaint-categories', router: complaintCategoriesRouter(), roles: ANY },
    { path: '/api/v1/complaints', router: complaintsRouter(), roles: ANY },
    { path: '/api/v1/staff', router: staffRouter(), roles: STAFF },
    { path: '/api/v1/admin', router: adminRouter(), roles: ADMINS },
  ];
  // Startup self-check: only the explicitly public router may lack a role list.
  for (const m of mounts) {
    if (m.roles === null && m.path !== '/api/v1') throw new Error(`Router ${m.path} has no role guard`);
  }
  for (const m of mounts) app.use(m.path, m.router);
}
