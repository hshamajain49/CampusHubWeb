// break-ui fixtures (dev only). Worst-case values are realistic or the schema limit (see comments).
import type { AdminBookingListItem, BookingSummary, NotificationItem, VenueSummary } from '@campushub/shared';

const perms = { canEdit: true, canCancel: true, canDownloadConfirmation: false, canRebook: true };
const adminPerms = { canApprove: true, canReject: true, canCancel: false, canDownloadConfirmation: false };

function venue(id: string, name: string, building: string, extra: Partial<VenueSummary> = {}): VenueSummary {
  return { id, name, venueType: 'seminar_hall', building, locationDetails: null, capacity: 120, amenities: ['Projector', 'Whiteboard', 'AC'], imageUrl: null, imageThumbUrl: null, isActive: true, ...extra };
}

function booking(id: string, v: VenueSummary, purpose: string, extra: Partial<BookingSummary> = {}): BookingSummary {
  return {
    id,
    reference: 'BK-2026-000123',
    venue: { id: v.id, name: v.name, building: v.building, isActive: true },
    date: '2026-11-20',
    startTime: '10:00',
    endTime: '12:00',
    start: '2026-11-20T10:00:00',
    end: '2026-11-20T12:00:00',
    durationMinutes: 120,
    purpose,
    expectedAttendees: 90,
    status: 'pending',
    rejectionReason: null,
    cancellationReason: null,
    isUpcoming: true,
    isHappeningNow: false,
    createdAt: '2026-11-08T09:15:22.000Z',
    updatedAt: '2026-11-08T09:15:22.000Z',
    permissions: perms,
    ...extra,
  };
}

function adminItem(b: BookingSummary, requester: AdminBookingListItem['requester'], capacity: number): AdminBookingListItem {
  return {
    id: b.id,
    reference: b.reference,
    venue: { ...b.venue, capacity },
    requester,
    date: b.date,
    startTime: b.startTime,
    endTime: b.endTime,
    start: b.start,
    end: b.end,
    durationMinutes: b.durationMinutes,
    purpose: b.purpose,
    expectedAttendees: b.expectedAttendees,
    status: b.status,
    createdAt: b.createdAt,
    decidedAt: null,
    version: 1,
    permissions: adminPerms,
  };
}

// ── Demo ────────────────────────────────────────────────────────────────
const demoVenues = [
  venue('d1', 'Seminar Hall A', 'Academic Block A', { locationDetails: '2nd floor, Room A-204', amenities: ['Projector', 'Whiteboard', 'Microphone', 'AC'] }),
  venue('d2', 'Conference Room 1', 'Administration Block', { capacity: 24, venueType: 'conference_room' }),
  venue('d3', 'Computer Lab 2', 'IT Block', { capacity: 60, venueType: 'laboratory' }),
];
const demoBookings = [
  booking('db1', demoVenues[0]!, 'Department seminar on responsible AI'),
  booking('db2', demoVenues[1]!, 'Faculty meeting', { status: 'approved', date: '2026-11-21' }),
];
const demoAdmin = [adminItem(demoBookings[0]!, { id: 'u1', fullName: 'Priya Sharma', email: 'priya.sharma@college.edu', role: 'student', isActive: true }, 120)];
const demoNotes: NotificationItem[] = [
  { id: 'n1', type: 'booking_approved', title: 'Booking approved', body: 'Seminar Hall A · Fri 20 Nov · 10:00–12:00.', bookingId: 'db1', linkPath: '/bookings/db1', isRead: false, readAt: null, createdAt: new Date(Date.now() - 5 * 60_000).toISOString() },
];

// ── Worst case ───────────────────────────────────────────────────────────
const longVenueName = 'Dr. A. P. J. Abdul Kalam Centre for Interdisciplinary Research — Main Lecture Theatre'; // ~90 of 120
const longBuilding = 'Sir Mokshagundam Visvesvaraya Engineering Sciences and Technology Block'; // ~70 of 120
const longLocation = 'Ground floor, east wing, enter through the courtyard gate opposite the central library; lift access via the service corridor behind the auditorium foyer'; // ~150 of 200
const twentyAmenities = [
  'Projector', 'Wireless presentation casting (Miracast)', 'Whiteboard', 'AC', 'Wi-Fi', 'Microphone', 'Sound system', 'Stage', 'Computers',
  'Video conferencing', 'Lecture capture', 'Hearing loop', 'Wheelchair access', 'Podium', 'Document camera', 'Green room', 'Blackout blinds',
  'Charging points', 'Water dispenser', 'Benachrichtigungseinstellungen',
];
const purpose500 =
  'Inter-college symposium on sustainable infrastructure: keynote by the visiting chair, two panel discussions with industry partners, a poster session for final-year students and a closing networking hour.\nWe need the stage, two wireless microphones, the projector with HDMI and USB-C adapters, and the hall set up theatre-style with an aisle for the accessibility route. Catering will be served in the foyer, not the hall. Volunteers arrive at 08:30 for setup and will clear the room by 18:00.';

const worstVenues = [
  venue('w1', longVenueName, longBuilding, { locationDetails: longLocation, amenities: twentyAmenities, capacity: 100000, venueType: 'outdoor_space' }),
  venue('w2', 'Q', 'B', { amenities: [], capacity: 1 }), // 1-char name is below the 2-char floor; "Q" stands in for the shortest realistic code
  venue('w3', '王秀英多功能厅', 'Konstantin-Oberhauser-Wettstein-Gebäude', { amenities: ['customer-feedback-from-enterprise-onboarding'], capacity: 1284 }),
];
const worstBookings = [
  booking('wb1', worstVenues[0]!, purpose500, { reference: 'BK-2026-1234567', expectedAttendees: 100000 }),
  booking('wb2', worstVenues[1]!, 'Viv', { status: 'rejected', isUpcoming: false, rejectionReason: 'The venue is reserved for university examinations during the entire week, including the reading days before and after.' }),
  booking('wb3', worstVenues[2]!, '<script>alert(1)</script> &amp; **bold**', { status: 'expired', isUpcoming: false }),
  booking('wb4', worstVenues[0]!, 'Happening now check', { status: 'approved', isHappeningNow: true, date: '2026-11-09' }),
];
const worstAdmin = [
  adminItem(worstBookings[0]!, { id: 'u1', fullName: 'Aleksandra Wiśniewska-Kowalczyk', email: 'bartholomew.fitzgerald@northwind-industries-holdings.example.com', role: 'faculty_staff', isActive: true }, 100000),
  adminItem(worstBookings[1]!, { id: 'u2', fullName: 'Jo', email: 'a@b.co', role: 'student', isActive: false }, 1),
  adminItem(worstBookings[2]!, { id: 'u3', fullName: '🦊 Fox', email: 'first.last+billing-notifications@example.com', role: 'student', isActive: true }, 1284),
];
const worstNotes: NotificationItem[] = [
  {
    id: 'w1',
    type: 'booking_rejected',
    title: 'Booking request rejected — Dr. A. P. J. Abdul Kalam Centre for Interdisciplinary Research — Main Lecture Theatre', // ~115 of 120
    body: `${longVenueName} · 20 Nov · 10:00–12:00. Reason: The venue is reserved for university examinations during the entire week, including the reading days before and after. Please choose another week or contact the examinations office for an exception.`,
    bookingId: 'wb1',
    linkPath: '/bookings/wb1',
    isRead: false,
    readAt: null,
    createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  },
  { id: 'w2', type: 'booking_reminder', title: 'Upcoming booking', body: 'Q · today at 10:00. Reference BK-2026-1234567.', bookingId: 'wb2', linkPath: '/bookings/wb2', isRead: true, readAt: null, createdAt: new Date().toISOString() },
];

export type Dataset = 'demo' | 'worst' | 'one' | 'empty';
export function fixtures(d: Dataset) {
  if (d === 'empty') return { venues: [], bookings: [], admin: [], notes: [] };
  if (d === 'one') return { venues: demoVenues.slice(0, 1), bookings: demoBookings.slice(0, 1), admin: demoAdmin, notes: demoNotes };
  if (d === 'worst') return { venues: worstVenues, bookings: worstBookings, admin: worstAdmin, notes: worstNotes };
  return { venues: demoVenues, bookings: demoBookings, admin: demoAdmin, notes: demoNotes };
}

export const worstNames = ['Aleksandra Wiśniewska-Kowalczyk', 'Christopher Alexander Montgomery III', 'Jo', '🦊 Fox', '👩🏽‍💻 Priya', '王秀英', 'Ólafur Darri Ólafsson', '  Sam   Lee '];
