# CampusHub

Venue booking and complaint registration for a campus.

- **Venue booking.** Students, faculty and department staff request campus venues (seminar halls, labs,
  auditoriums); a Super Admin reviews, approves or rejects them. Bookings are conflict-free by construction:
  PostgreSQL exclusion constraints make double-booking impossible even under concurrent requests.
- **Complaints.** Anyone reports a campus problem (a broken fan, no Wi-Fi). The category routes it to a service
  department, whose staff do the work; the reporter approves the fix or sends it back. See [Complaints](#complaints).

| Layer | Stack |
|---|---|
| Frontend (`frontend/`) | React 19 · Vite 7 · TypeScript · Tailwind CSS v4 · Radix UI · TanStack Query 5 · React Router 7 (data router) · React Hook Form + Zod · FullCalendar 6 · Recharts 3 · sonner |
| API (`backend/`) | Node 22 · Express 5 · Better Auth (bearer sessions) · `pg` · Zod · PDFKit · pino |
| Shared (`shared/`) | Enums, Zod request schemas, DTO types and the pure slot rules used by **both** the form and the API |
| Database (`database/`) | Neon Postgres 18 (local: PostgreSQL 17) · dbmate forward-only migrations · `btree_gist` exclusion constraints, triggers, history and audit |
| Files | Neon Object Storage (`venue-photos` bucket, declared in `neon.ts`); photos resized to WebP with `sharp` |
| Integrations (all optional locally) | Brevo email · Ably realtime · Web Push (VAPID) · cron-job.org |

## Run it locally

Requirements: **Node 22+**. Docker is optional.

```bash
npm install --include=dev
npm run local
```

`npm run local` starts two embedded PostgreSQL 17 clusters (dev on `5432`, tests on `5433`, data in `.localdb/`),
applies the migrations to both, seeds demo data the first time, and starts everything in watch mode:

| | URL |
|---|---|
| Web app | http://localhost:5173 (Vite moves to 5174/5175 if the port is taken) |
| API | http://localhost:4000 (`/health`, `/api/v1/*`, `/api/auth/*`) |
| Dev-only stress harness | http://localhost:5173/dev/break-ui?data=worst (sign in as admin first) |

Demo accounts (seeded):

| Role | Email | Password |
|---|---|---|
| Super Admin | `admin@demo.edu` | `Admin12345` (sign in at `/admin/login`) |
| Student | `student@demo.edu` | `Student12345` |
| Faculty/Staff | `faculty@demo.edu` | `Faculty12345` |
| Department Staff (Electrical) | `staff.electrical@demo.edu` | `Staff12345` |
| Department Staff (Plumbing) | `staff.plumbing@demo.edu` | `Staff12345` |

Locally, email goes to `backend/.tmp/outbox/*.html` (`EMAIL_TRANSPORT=file`). Realtime and push stay off until you add
Ably/VAPID keys; the app polls instead.

### Neon (database + photo storage)

The repo is linked to the Neon project `campus-hub` (`.neon`, `neon.ts`). Local development runs on the long-lived **`dev`**
branch; **`production`** is only for the deployed API. Tests always use the local cluster on `5433`, never Neon.

```bash
neon checkout dev              # pin a branch; writes its DATABASE_URL*/AWS_* values into the repo-root .env.local
npm run neon:env               # copy them into backend/.env (managed block): direct DATABASE_URL + IMAGE_STORE=neon
npm run db:migrate             # dbmate over the direct endpoint
npm run dev                    # API on the Neon branch (its host is logged at startup)
npm run neon:env -- --off      # switch the API back to the local cluster and on-disk photos
```

- The API uses the **direct** endpoint (not `-pooler`): its connections set `statement_timeout`/`lock_timeout`, which
  Neon's PgBouncer rejects as startup parameters. A pool of 5 on a long-running server doesn't need PgBouncer.
- `neon deploy` applies `neon.ts` (the public-read `venue-photos` bucket) to the pinned branch. New branches other than
  `dev` expire after 7 days.
- `npm run seed:if-empty -w @campushub/backend` seeds any Neon branch except `production`.

With Docker instead of the embedded clusters: `npm run db:up`, then `npm run db:migrate && npm run db:migrate:test && npm run dev`.
Stop the embedded clusters with `npm run db:local:stop`.

> If your shell exports `NODE_ENV=production`, npm skips dev dependencies; that is why install uses
> `--include=dev`. The dev scripts set `NODE_ENV` themselves through `scripts/with-node-env.mjs`.

## Scripts

| Command | What it does |
|---|---|
| `npm run local` | Databases + migrations + seed (if empty) + all dev servers |
| `npm run dev` | Dev servers only (shared watch, API `tsx watch`, Vite) |
| `npm run build` | Builds shared, the API (`backend/dist`) and the SPA (`frontend/dist`, including `_headers` with the CSP) |
| `npm run lint` / `npm run typecheck` | ESLint (includes a rule that forbids interpolating values into SQL) / `tsc` for all packages |
| `npm test` | Shared, backend unit and frontend component tests |
| `npm run test:db` | Database invariants against the test cluster (overlaps, triggers, transitions, history, settings, expiry) |
| `npm run test:integration` | Supertest against the real app + Better Auth, plus concurrency races (CT-01, 03, 05, 09) |
| `npm run e2e` | Playwright: Chromium desktop, WebKit iPhone 13, Chromium tablet (needs `npm run local` running) |
| `npm run neon:env` | Point `backend/.env` at the Neon branch in `.env.local` (`-- --off` reverts to the local cluster) |
| `npm run db:reset` | Drop, recreate, migrate and seed the **local** dev database (refuses remote hosts) |
| `npm run db:dump` | `pg_dump` of the configured database into `backups/` |
| `npm run create-super-admin -w @campushub/backend` | Provision a Super Admin account from the command line (on the database in `backend/.env`) |
| `npm run create-super-admin:prod -- --email … --name "…"` | The same on the Neon **production** branch, using `.env.production.local` |
| `npm run storage:sweep -w @campushub/backend` | Delete complaint photos older than 24 h that no complaint references (`-- --dry-run` to preview) |

## Complaints

Implemented from `COMPLAINT_REGISTRATION_SPEC.md` v1.1; stack adaptations and deviations are in
[docs/COMPLAINTS.md](docs/COMPLAINTS.md).

| Role | What they do | Where |
|---|---|---|
| Any signed-in user | File a complaint (category, title, optional venue/location/description, up to 3 photos), track it, approve or reject the fix, withdraw before work starts, reopen an auto-resolved one within the window | `/complaints` |
| Department Staff | Work their department's queue: start, mark done (note + "after" photos), reopen, request reassignment; also book venues | `/staff` |
| Super Admin | All complaints (filters, CSV), reassign, close, act for any department, departments & categories, reports | `/admin/complaints`, `/admin/complaint-setup` |

- **Routing**: the category decides the department (7 departments/categories seeded from the Flutter app; managed
  under Departments & categories). Staff accounts are created in Users with role *Department Staff* and a service
  department.
- **Lifecycle**: Pending Review → In Progress → Awaiting Approval → Resolved, plus Withdrawn and Closed (final). A
  database trigger enforces the transitions; every change lands in the complaint timeline, admin actions also in the
  audit log.
- **Auto-resolve**: awaiting approval for 7 days → resolved by the job runner (`complaints` task); the reporter can
  reopen an auto-resolved complaint for 7 days. Both are in Settings → Rules.
- **Photos**: compressed in the browser, re-encoded to WebP by the API (EXIF/GPS removed), stored in the **private**
  Neon bucket `complaint-photos`, and shown through 10-minute presigned URLs. Locally (`IMAGE_STORE=fake`) they go
  to `backend/.tmp/private-files` behind signed `/dev-files` URLs.
- **With venue booking**: complaints can name a venue; admin venue pages show an Issues tab; an admin can block a
  venue for maintenance straight from a complaint about it.

## Project layout

```
shared/      enums, schemas, DTOs, slot rules (consumed as source by Vite, built for the API)
backend/
  src/app.ts              middleware order: request id → helmet → CORS → logging → rate limit → health → Better Auth → JSON → routes
  src/routes.ts           every router declares the roles it admits (startup self-check)
  src/modules/*           one service per area: bookings, admin-bookings, venues, venue-blocks, admin-users, settings, reports, notifications, jobs …
  src/db/                 pool (timeouts, type parsers), transactions (actor/note for triggers, deadlock retry, after-commit hooks)
  tests/{unit,db,integration,concurrency}
frontend/
  src/features/*          screens by area (member, admin, auth); admin and member pages are lazy route chunks
  src/components/{ui,common}  primitives (Radix-based) and shared product components
  src/styles/globals.css  design tokens, motion curves, reduced-motion rules
database/migrations       §14 SQL, forward-only
e2e/                      Playwright specs and QA scripts (screenshots, overflow checks, icon rendering)
```

## Design and motion

The interface uses a calm institutional palette (navy `#1E3A8A`, teal `#0D9488`, amber accents), Poppins for display
and Inter for text. Motion follows a few rules: custom ease-out curves, sub-300 ms UI transitions, `scale(0.97)` press
feedback, popovers that grow from their trigger, faster exits than entrances, hover effects only on
hover-capable pointers, and a reduced-motion fallback for every animation. Charts use a colour-blind-checked
two-hue palette, and each one has a table equivalent. On phones, tables become cards, filters move into a sheet,
action bars respect safe areas, and inputs are 16 px so iOS doesn't zoom.

## Deployment

- **API on Render** via `render.yaml` (free plan, Singapore, `/health` check). Secrets are prompted (`sync: false`).
- **SPA on Cloudflare Pages**: build `npm run build -w @campushub/shared && npm run build -w @campushub/frontend`,
  output `frontend/dist`, env `VITE_API_ORIGIN=<API URL>`. The build writes `dist/_headers` (CSP, HSTS, caching).
- **Database and photos on Neon**, `production` branch (PostgreSQL 18, Singapore, same region as Render). Use the
  **direct** connection string everywhere (API, migrations, backups): `neon connection-string production`. The object
  storage values (`AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) come from
  `neon env pull --branch production`. Migrate with
  `DATABASE_URL=<direct url> npx dbmate --migrations-dir database/migrations --no-dump-schema up`.
- **First Super Admin**: `neon env pull --branch production --file .env.production.local`, then
  `npm run create-super-admin:prod -- --email you@college.edu --name "Your Name"`. It prints a one-time password
  (changed at first sign-in). Don't prefix the plain `create-super-admin` with `DATABASE_URL=`: `backend/.env` wins
  over shell variables, so it would write to the dev branch. The app itself only creates students and faculty, so
  run this again for each extra Super Admin (an existing account's email is promoted instead).
- **Complaint photos**: run `neon deploy` with the `production` branch pinned to create the private
  `complaint-photos` bucket (`neon.ts`). The API uses the same `AWS_*` storage credentials as venue photos.
- **Jobs**: cron-job.org calls `POST /internal/jobs/run` with `Authorization: Bearer <CRON_SECRET>` every 30 minutes
  by day and hourly at night; `GET /health` every 14 minutes during campus hours keeps the free instance awake.
- **CI** (`.github/workflows/ci.yml`): lint/typecheck → unit → db → integration → e2e, a secrets scan of the built
  bundle plus gitleaks, then a gated deploy (migrate, then the Render deploy hook). `backup.yml` stores a weekly
  GPG-encrypted `pg_dump`; `jobs-backup.yml` is an optional second scheduler.

Required production secrets: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `FRONTEND_URL`, `CORS_ORIGINS`,
`CRON_SECRET`, `AWS_ENDPOINT_URL_S3`/`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (Neon storage), plus
`BREVO_API_KEY`/`EMAIL_FROM_ADDRESS`, `ABLY_API_KEY`, `VAPID_*` for the integrations. GitHub needs `PROD_DATABASE_URL`
(direct), `RENDER_DEPLOY_HOOK_URL` and `BACKUP_PASSPHRASE`. See `backend/.env.example` and `frontend/.env.example`.
"# CampusHubWeb" 
