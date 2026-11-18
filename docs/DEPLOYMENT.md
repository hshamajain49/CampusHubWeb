# Deploying and operating CampusHub

This is the runbook for the CampusHub application: the API, the website and the database. The developers'
monitoring service, CampusHub Sentinel, has its own runbook in its private repository. This file is public, so it
names settings and steps, never values.

## 1. What runs where

| Part | Where | Deployed by |
|---|---|---|
| API (Express, `backend/`) | Render web service `campushub-api` (free plan, Singapore), defined in `render.yaml` | CI: migrations, then the Render deploy hook. Render's own auto-deploy is off. |
| Website (React, `frontend/`) | Cloudflare Pages | Cloudflare Pages: build `npm run build -w @campushub/shared && npm run build -w @campushub/frontend`, output `frontend/dist` (the build writes `dist/_headers`: CSP, HSTS, caching) |
| Database and photos | Neon project `campus-hub`, branch `production` (PostgreSQL 18, Singapore); object storage buckets `venue-photos` (public read) and `complaint-photos` (private, signed URLs) | Migrations by CI. Buckets: `neon deploy` with the `production` branch pinned (`neon.ts`). |
| Scheduled jobs | cron-job.org calls `POST /internal/jobs/run` (Bearer `CRON_SECRET`) every 30 minutes by day and hourly at night, plus `GET /health` every 14 minutes during campus hours to keep the free instance awake. `jobs-backup.yml` is a backup scheduler. | |
| Backups | `.github/workflows/backup.yml`: weekly encrypted `pg_dump` | |
| Monitoring | CampusHub Sentinel (separate service): security events, request counts and visitor analytics | Its own repository |

Neon has exactly two branches: `production`, and `dev` (seeded demo data). Don't create others.

## 2. Settings and secrets (names only)

**Render, `campushub-api`** (`render.yaml` lists them; `sync: false` ones are entered in the dashboard):
- **Core:** `DATABASE_URL` (direct endpoint, role `campushub_app`, see §4), `BETTER_AUTH_SECRET`,
  `BETTER_AUTH_URL`, `FRONTEND_URL`, `CORS_ORIGINS`, `CRON_SECRET`.
- **Storage:** `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, from
  `neon env pull --branch production`.
- **Integrations:** `BREVO_API_KEY`, `EMAIL_FROM_ADDRESS`, `ABLY_API_KEY`, `VAPID_*`.
- **Monitoring:** `SENTINEL_URL`, `SENTINEL_INGEST_KEY_ID`, `SENTINEL_INGEST_SECRET`. Set all three or none.
- **Hardening, already set in `render.yaml`:** `SUPER_ADMIN_SESSION_HOURS`. `SUPER_ADMIN_MFA` is `required` by
  default and `off` is refused. Leave `ALLOW_DEMO_DATA` unset: the API refuses to start on a database holding the
  seeded demo accounts.

**Cloudflare Pages:**
- `VITE_API_ORIGIN`: the API's URL.
- `VITE_SENTINEL_URL` and `VITE_SENTINEL_SITE_KEY`: visitor analytics; off unless both are set. The site key is
  public by design.

**GitHub repository secrets:**
- **CI:** `PROD_DATABASE_URL` (owner role, direct endpoint: migrations and backups) and `RENDER_DEPLOY_HOOK_URL`.
- **Backups:** `BACKUP_PASSPHRASE`.
- **Backup scheduler:** `CRON_SECRET` and `JOBS_URL` (`jobs-backup.yml`).
- **Weekly security scan:** `SENTINEL_URL`, `SENTINEL_INGEST_KEY_ID`, `SENTINEL_INGEST_SECRET`, the same values as
  the API's.

## 3. A normal deploy

1. Push to `main`. CI (`.github/workflows/ci.yml`) runs lint and typecheck, unit tests, database tests,
   integration tests and e2e tests, plus two secret scans (the built bundle, and gitleaks over the pushed commits).
2. Only if all of them pass, the `deploy` job applies migrations to `production` with `PROD_DATABASE_URL`, then calls
   the Render deploy hook. Migrations always land before the code that needs them.
3. Cloudflare Pages builds the site from the same push when it is connected to the repository; otherwise deploy the
   build output by hand. After changing a `VITE_*` setting, redeploy the site: these values are fixed at build time.
4. Check the deploy (§6).

**If CI fails, the API isn't deployed.** Fix the cause and push again. A manual deploy from the Render dashboard
skips the migrations: if one is unavoidable, apply pending migrations by hand first (§5).

CI's database runs PostgreSQL 18, like production. The local clusters (`npm run db:local`) are PostgreSQL 17, so a
test can pass locally and fail in CI when the versions differ. For example, PostgreSQL 18 reports a RESTRICT
foreign-key violation as `23001`, where 17 reports `23503`.

## 4. Database roles

The API connects as `campushub_app`. It can read and write application data, but it can't change the schema,
truncate tables, or edit or delete the audit log. `audit_logs` is append-only for every role, the owner included.
Migrations and backups use the owner role.

The migration `20261118000100_least_privilege_rate_limits.sql` creates the role without a login. Once per Neon
branch:

1. Generate a password: `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`.
2. In the Neon SQL editor for that branch, run `alter role campushub_app with login password '<password>';`.
   Use SQL: a role created in the Neon console is added to `neon_superuser`.
3. Set Render's `DATABASE_URL` to the owner's direct URL with the user and password replaced.
4. Keep GitHub's `PROD_DATABASE_URL` on the owner role.

To rotate the password, repeat steps 1–3. The API reconnects after Render restarts it with the new value.

## 5. Migrations

- **Writing them:** forward-only and additive where possible, so the previous release still works against the new
  schema. **ASCII only**: the local Windows clusters use the WIN1252 encoding and refuse other characters.
- **Applied by:** CI on every deploy. By hand (only when needed), from the repository root:

  ```
  npx dbmate --env-file .env.production.local --env DATABASE_URL_UNPOOLED --migrations-dir database/migrations status
  npx dbmate --env-file .env.production.local --env DATABASE_URL_UNPOOLED --migrations-dir database/migrations up
  ```

  `.env.production.local` comes from `neon env pull --branch production --file .env.production.local` and is
  git-ignored. Run `status` first. For the `dev` branch use `--env-file .env.local`.

## 6. Checking a deploy

1. `GET /health` on the API shows the new commit (`version` ends with its short hash).
2. Run the passive check. It sends only GET and CORS-preflight requests, so it is safe against production:

   ```
   npm run security:headers -- --api https://<api> --site https://<site> --sentinel https://<sentinel>
   ```

   Expect 0 failures.
3. Sentinel's overview shows CampusHub's ingestion as current, within a minute of traffic.
4. Sign in once as a member, and once as the Super Admin with your authenticator.

## 7. Rolling back

- **Code:** in Render, open the service, then **Deploys**, then roll back to the previous deploy. Migrations are
  additive, so the previous release runs against the current schema.
- **Website:** in Cloudflare Pages, open **Deployments** and roll back.
- **Data:** Neon can restore a branch to a point in time. Restoring in place leaves a backup branch named after the
  old state; delete it afterwards to keep exactly two branches. The weekly `pg_dump` in `backup.yml` is the second
  line of defence (decrypt it with `BACKUP_PASSPHRASE`).

## 8. Accounts

- **First or extra Super Admin:**
  1. Run `neon env pull --branch production --file .env.production.local`.
  2. Run `npm run create-super-admin:prod -- --email <address> --name "<Full name>"`. It prints a one-time
     password; at first sign-in the admin chooses a new one (12+ characters) and sets up an authenticator app.
     An existing account's email is promoted instead. Don't prefix the plain `create-super-admin` with
     `DATABASE_URL=`: `backend/.env` wins over shell variables, so it would write to the dev branch.
  3. Within 5 minutes Sentinel raises a privilege-change alert for the new Super Admin. That's expected:
     acknowledge it.
- **Lost authenticator (Super Admin):** run `npm run reset-mfa:prod -- --email <address>`. It removes two-step
  verification and signs the account out everywhere; the admin sets up a new authenticator at the next sign-in.
- **Locked out after failed sign-ins:** the lock lifts by itself (1 to 15 minutes), or immediately after a
  password reset.

## 9. Rotating secrets

| Secret | Effect of rotating | Also update |
|---|---|---|
| `BETTER_AUTH_SECRET` | Every session ends; everyone signs in again | Render only |
| `CRON_SECRET` | The scheduler's calls fail until updated | cron-job.org and GitHub (`jobs-backup.yml`) |
| `SENTINEL_INGEST_*` | Events queue up until the API has the new pair (up to 1,000 are kept) | Rotate in Sentinel (`app:rotate-secret`), then Render and GitHub |
| `campushub_app` password | The API can't connect until Render has the new value | Render `DATABASE_URL` |
| Neon owner password | CI migrations and backups fail until updated | GitHub `PROD_DATABASE_URL` |
| Brevo / Ably / VAPID keys | That integration stops until updated | Render (changing VAPID keys also invalidates existing push subscriptions) |

## 10. When something breaks

| Symptom | Likely cause | What to do |
|---|---|---|
| API answers 503 `SERVICE_UNAVAILABLE`; `/health/ready` is 503 while `/health` is 200 | Database unreachable (Neon compute suspended, quota, outage) | Check Neon's console. The API recovers on its own when the database is back. |
| `403 ACCESS_BLOCKED` for some users | Their address is blocked in Sentinel | Lift the block in Sentinel (Suspicious IPs, then Blocks), and allowlist the network if it's the campus gateway |
| Sign-ins answer "too many attempts" for everyone on one network | A campus NAT sharing one address, hitting the per-address limit | Check Sentinel for an attack first. If it's legitimate load, raise the limit in `lib/auth.ts` |
| Sentinel shows ingestion as stale | The API is asleep (free plan, at night) or the ingestion secret is wrong | Expected at night; otherwise check the API logs for "Sentinel unreachable" |
| The free instance stops responding near the end of the month | Render's free instance hours are used up (shared by every free service in the workspace) | See §11 |

Sentinel being down never stops CampusHub: events wait in memory, and existing blocks expire on schedule.

## 11. Free-plan limits

Render's free plan sleeps a service after 15 minutes without requests, and gives each workspace a monthly pool of
free instance hours, shared by every free service. CampusHub's scheduler keeps the API awake by day and wakes it
hourly at night. Sentinel stays awake while CampusHub is awake, because CampusHub reports to it every minute. Two
services awake most of the day can exhaust the pool before the month ends. Check Render's usage page in the first
month. If it's tight, move one service (Sentinel is the natural candidate) to a paid instance.
