# Complaint Registration — implementation notes

How `COMPLAINT_REGISTRATION_SPEC.md` (v1.1) is built into CampusHub, and where this stack differs from the spec's
Supabase/Vercel assumptions. Put the spec itself next to this file as `docs/COMPLAINT_REGISTRATION_SPEC.md`.

## What it does

Anyone signed in reports a campus problem. The **category** routes it to a **service department**; that department's
**staff** start the work and mark it done (note + "after" photos); the **reporter** approves the fix or sends it back.
The **Super Admin** sees everything, reassigns misrouted complaints, closes invalid ones, manages departments and
categories, and reads reports. Unreviewed fixes resolve automatically after 7 days; the reporter can still reopen an
auto-resolved complaint for 7 more days (owner decision CD-03, option D).

| Who | Where |
|---|---|
| Reporter (every role) | `/complaints`, `/complaints/new` (also "Report an issue" in the header and on venue pages), `/complaints/:id` |
| Department staff (`department_staff`) | `/staff` (dashboard), `/staff/complaints` (queue), `/staff/complaints/:id`; they are members too and can book venues (CD-02) |
| Super Admin | `/admin/complaints`, `/admin/complaints/:id`, `/admin/complaints/new`, `/admin/complaint-setup`, Reports → Complaints, Settings → Rules |

## Setting it up

1. **Migrations** `database/migrations/20261112000100…300` (dbmate, forward-only) add the tables, triggers, the
   `department_staff` role and the 7 Flutter departments/categories.
2. **Photo bucket**: `neon.ts` declares the private bucket `complaint-photos`. `neon deploy` creates it on the pinned
   branch (done for `dev`; run it for `production` before the first deploy).
3. **Staff accounts**: Users → New user → *Department Staff* → choose the service department.
4. **Categories**: Departments & categories. Changing a category's department affects new complaints only.
5. **Rules**: Settings → Rules → Complaints (auto-resolve days or Off, reporter reopen window, max open per user).

## Coordination with venue booking

- A complaint can name a bookable venue (the form searches active venues; venue pages link to the form pre-filled).
- Admin venue pages have an **Issues** tab and an open-complaint count; reports list the top venues with issues.
- On an open complaint about a venue, the admin can **Block venue for maintenance** — the existing block dialog,
  pre-filled with the venue and the complaint reference, so nobody books a room that is being repaired.
- Department staff are members: they book venues like students and faculty.
- Venues with complaints can still be deactivated (the link stays) or deleted (`venue_id` becomes null, CEC-21).

## Deviations from the spec (stack adaptations)

| Spec | Here | Why |
|---|---|---|
| `supabase/migrations/` | `database/migrations/` (dbmate markers) | The app uses dbmate on Neon |
| Replace `handle_new_auth_user()` with an `app_metadata` version | Unchanged trigger; the API sets `role` + `service_department_id` in the same transaction | Better Auth, not Supabase Auth: the trigger always creates a student, exactly as for faculty accounts |
| RLS policies (§10.3), `current_service_department_id()` | Not created | The API is the only database client (no client-side DB access); visibility is enforced in every query |
| `pg_cron` job `auto-resolve-complaints` | `public.auto_resolve_complaints()` called by `POST /internal/jobs/run` (new task `complaints`, in the default set) and opportunistically at most once a minute | No pg_cron; cron-job.org already drives the job runner every 30 minutes |
| Supabase Storage private bucket, `createSignedUrls` | Neon Object Storage private bucket `complaint-photos`, SigV4 presigned GET (600 s) via `@aws-sdk/s3-request-presigner`; `COMPLAINT_PHOTO_STORE=fake` stores on disk with HMAC-signed, expiring `/dev-files` URLs for local runs and tests | Same privacy semantics on this stack. `fake` is refused in production |
| `SUPABASE_COMPLAINT_BUCKET` | `NEON_COMPLAINT_BUCKET` (default `complaint-photos`) | |
| CSP `img-src https://<ref>.supabase.co` | Unchanged: `https://*.aws.neon.tech` already covers the storage host | |
| Vercel (`vercel.json`) | Cloudflare Pages (`frontend/headers.template`) | |
| Module `complaint-categories` | C01 lives in `modules/complaints`; admin category writes in `modules/complaint-setup` | Fewer files, same endpoints |
| `DomainEventPublisher` "publish complaint.*" | No events published | Notifications are out of scope (§3.2); the existing notifier is booking-specific |
| Corrupt JPEG → 422 | Type checked by file signature (JPEG/PNG/WebP magic bytes → else 415), then decoded (failure → 422) | Matches CBT-02: a PDF renamed `.jpg` is 415, a broken JPEG 422 |
| Order "version check, then status check" (CA-2) | Status first, then version | A reporter on a stale page learns *why* ("This complaint was already resolved.", CEC-14) instead of a generic conflict |
| CA05 "By status" / "By reporter role" donuts, "By category" bars in category colours | Single-hue bar charts with labels; backlog age as a green/amber/red segmented bar | Dataviz validation: the six status colours fail colour-blind separation; colouring one series by category is a rainbow; this reports page already avoids donuts. Every chart has a table twin |
| Spec list DTO | `ComplaintSummary` gains `awaitingReporter` and `version` (for inline "Start work"); `Complaint` gains `viewerRole` | Additive |
| Staff "Department queue" link | Shown as "Queue" between 768 and 1023 px | Five nav links must fit the tablet header |

Edge-case notes: an optional withdrawal reason shorter than 3 characters is kept in the timeline but not in
`closure_reason` (its CHECK requires 3–500). The orphan sweep is `npm run storage:sweep -w @campushub/backend
[-- --dry-run]`.

## Tests

| Suite | Files |
|---|---|
| Database (CDT-01…11) | `backend/tests/db/02-complaint-constraints.test.ts` |
| API (CBT-01…17) | `backend/tests/integration/complaints.test.ts` |
| Rules | `backend/tests/unit/complaint-rules.test.ts` |
| Components (CFT) | `frontend/src/features/complaints/components/*.test.tsx` |
| End to end (CE2E-01, 02, 03, 05, 07, 08, 10) | `e2e/tests/complaints.spec.ts`, `e2e/tests/responsive.spec.ts` |

The e2e suite removes complaints titled `E2E …` from earlier runs. The complaint-creation rate limit (10 per hour per
user) is in memory, so rerunning the e2e suite several times within an hour needs an API restart.
