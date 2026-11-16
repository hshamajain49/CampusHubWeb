# Venue booking: instant confirmation and FIFO queue

Bookings need **no approval**. The first valid request for a time is confirmed immediately; anyone who asks for a time
that is already booked joins a queue for it, and the queue is served first-in, first-out when the time frees up. The
administrator is kept informed (in-app notifications, every booking in the admin views) but never has to act.

Migrations: `database/migrations/20261113000100_booking_queue.sql` (instant confirmation, queue) and
`20261116000100_multiday_suggestions_account_deletion.sql` (multi-day bookings, "venue booked" notifications,
suggestion box, account deletion).

## Statuses

| Status | Meaning | Holds the time? |
|---|---|---|
| **Confirmed** | The member has the venue for that time. | Yes |
| **In Queue** (`queued`) | The time was already booked; waiting for it to free up. | No |
| **Completed** | A confirmed booking that has ended. | — |
| **Cancelled** | Cancelled by the member, an admin, a block or a deactivation. | — |
| **Expired** | A queued request whose start time arrived while the time was still booked. | — |

Transitions (enforced by the `bookings_guard_update` trigger): queued → confirmed | cancelled | expired;
confirmed → completed | cancelled. Completed, cancelled and expired are final.

## Booking a time (`POST /bookings`)

1. The request is validated like before (operating hours, steps, duration, lead time, advance window, capacity) plus
   the new **USN / Faculty ID** field (`idNumber`, required, 3–30 letters/digits, `-` `/` `.` allowed, stored upper
   case). The form pre-fills it from the member's latest booking.
2. The API locks the **venue row**. Every write that can take or free a slot (create, edit, cancel, admin cancel,
   blocks, user deactivation) takes this lock first, so requests for one venue are handled strictly one at a time.
3. A block on that time, or the member's own confirmed/queued booking for an overlapping time at the same venue
   (`DUPLICATE_BOOKING`), stops the request.
4. No confirmed booking overlaps → **confirmed**. Otherwise → **queued** behind everyone already waiting.
5. The member's upcoming bookings (confirmed + queued) are capped by *Settings → Rules → Max upcoming bookings per
   member* (default 10; `BOOKING_LIMIT_REACHED`).

Last line of defence: `bookings_no_overlap` excludes overlapping **confirmed** rows of a venue, so two members can
never both be confirmed for the same time, whatever the application does. Queued rows are outside the constraint.

The form calls the availability check as you pick a time and says which will happen ("confirmed instantly" or
"you'll join the queue as #N"); the submit button reads **Book now** or **Join the queue**.

## Multi-day bookings

A booking can cover **consecutive days**: turn on **Multiple days** in the form and pick the first and last day. The
same time window is booked on every day (e.g. 20–22 Nov, 09:00–13:00 each day).

- Up to **14 days** (`MAX_BOOKING_DAYS`, `TOO_MANY_DAYS`), all inside the advance window. Every day must satisfy the
  usual rules (hours, steps, duration); the lead time applies to the first day.
- **All or nothing.** The booking is confirmed only if every day is free; if any day is already booked, the whole
  booking joins the queue, and it is confirmed automatically once every day is free. A block on any day stops it.
- Stored as one row: `end_date` (inclusive, equal to `date` for one day) and a generated `slot` that is a
  `tsmultirange` with one range per day, so `bookings_no_overlap` still compares confirmed bookings day by day
  (`public.booking_slot(start, end, from, to)`).
- Editing: moving the first day keeps the number of days; the last day can be changed or multi-day turned off. A
  multi-day booking is "happening now" during its window on any of its days and completes after its last day.
- Lists, the admin calendar (one event per day, "day n of N"), reports (hours × days in range), the confirmation PDF
  and notifications all show the date range ("20 Nov – 22 Nov · 09:00–13:00 daily").

## Super Admin bookings

The Super Admin books venues like a member, from the admin area: **Dashboard → Book a venue**, **Venues → (venue) →
Book**, and **Bookings → My bookings** (`/admin/book`, `/admin/my-bookings`). The same rules, queue and limits apply.
The admin booking pages reuse the member pages (`features/bookings/paths.ts` switches the links under `/admin`).

## The queue (FIFO)

- Order is `queued_at`, stamped with `clock_timestamp()` while the venue lock is held, i.e. the order in which the
  server processed the requests (ties broken by id). Twenty simultaneous requests get positions 1–20 with no ties
  (`backend/tests/concurrency/races.test.ts`).
- A request's **position** is 1 + the number of queued requests that overlap it and arrived earlier. Times can
  overlap partially, so each request has its own line.
- When a confirmed booking is cancelled (or moved, or cut by a block), `promote_queued_bookings(venue)` walks the
  venue's queued requests oldest first and confirms each one whose time no longer overlaps a confirmed booking or a
  block. A later request can be confirmed when an earlier one still clashes with something else; two clashing
  requests are never both confirmed, because the earlier one is confirmed first.
- Only requests that have not started, from active members, on an active venue are promoted.
- The promoted member gets a notification (in-app, email, push): "Good news: your booking is confirmed". Their
  timeline shows "Slot freed up: confirmed" by the system; it never says who cancelled.
- A queued request still waiting when its start time arrives becomes **expired** (the member is notified).

## Cancelling and editing

- Members can cancel **at any time** until the booking ends: a queued request until it starts, a confirmed booking
  until its end. The old cancellation cut-off setting is gone.
- Editing details (purpose, attendees, ID) never changes the status. A **confirmed** booking can move only to a free
  time: if the new time is booked, the change is refused and the slot is kept. A **queued** request moved to a free
  time is confirmed; moved to another booked time, it goes to the back of that queue. The modification cut-off
  setting still applies.
- Admins can cancel a confirmed booking or a queued request with a reason; the freed time goes to the queue.

## Background job

`POST /internal/jobs/run` task `expire` (name kept for existing cron configs) calls `settle_bookings()`: queued
requests past their start → expired, confirmed bookings past their end → completed. The API also runs it at most once
a minute while it serves requests, and reads always show the settled status.

## Notifications

| Event | Member | Admins | Everyone else |
|---|---|---|---|
| Booked, confirmed | "Booking confirmed" (in-app + email) | "New booking" (in-app) | "*Venue* is booked" (in-app) |
| Booked, queued | "You're #N in the queue" (in-app + email) | "New booking (queued)" (in-app) | — |
| Promoted from the queue | "Good news: your booking is confirmed" (in-app + email + push) | — | "*Venue* is booked" (in-app) |
| Changed | — | "Booking changed" (in-app) | — |
| Cancelled (by anyone) | "Booking cancelled" with the venue, dates and times, reference, **Status: Cancelled** and what happened to the time (in-app + email; push when someone else cancelled) | "Booking cancelled by requester" when a member cancels a confirmed booking (in-app) | "*Venue* is available again" when nobody was queued (in-app) |
| Queued request expired | "Queued slot didn't free up" (in-app + email + push) | — | — |
| Reminder | unchanged | — | — |

**Everyone else** means every active member except the booker, the person who acted and Super Admins. It is in-app
only (no email or push) and written with one `INSERT … SELECT` after the transaction commits, so a large campus costs
one statement and never holds the venue lock. The link opens the venue. Complaints never broadcast.

The cancellation notice always reaches the member, including when they cancelled it themselves, and ends with one
of: "The time went to the next person in the queue." / "The time is available again: anyone can book it." / "The
venue is unavailable at that time." (block or deactivation) / "You left the queue for this time." A cancelled queued
request frees nothing, so it is never announced.

## Existing data (the migration)

| Before | After |
|---|---|
| Approved | Confirmed (or Completed if it already ended) |
| Pending, still ahead | Confirmed — pending requests never overlapped each other or an approved booking; timeline note "Confirmed automatically" |
| Pending, already started | Expired |
| Rejected | Cancelled, reason "Request rejected: …", cancelled by the admin who rejected it |

History rows keep their original events (submitted / approved / rejected) and are shown with their old labels.
`rejection_reason`, `decided_by`, `decided_at` and `cancellation_cutoff_minutes` are dropped;
`max_pending_per_user` becomes `max_active_per_user` (raised from the old default 5 to 10, since it now also counts
confirmed bookings). Old notification types stay valid so the 180-day notification history still renders.

## API changes

- `POST /bookings` requires `idNumber`; `PATCH /bookings/:id` accepts it.
- Removed: `POST /admin/bookings/:id/approve`, `POST /admin/bookings/:id/reject` (404 now).
- `GET /venues/:id/availability/check` adds `outcome` (`confirm` | `queue` | `unavailable`) and `queuePosition`.
- Booking DTOs: `status` uses the new values; added `idNumber`, `queuePosition`, `confirmedAt`, `queuedAt`; removed
  `rejectionReason`, `decidedBy`, `decidedAt`, `approvalNote`. Admin permissions are `canCancel` and
  `canDownloadConfirmation` only.
- `/admin/approvals` in the app redirects to *All bookings → In queue*.
- Multi-day: `POST /bookings`, `PATCH /bookings/:id` and `GET /venues/:id/availability/check` accept `endDate`;
  booking DTOs add `endDate` and `days`; block conflicts add `endDate`. List date filters match any overlapping day.
- `/venues` and `/bookings` routes accept the Super Admin.
- New notification types `venue_booked` and `venue_available`.
