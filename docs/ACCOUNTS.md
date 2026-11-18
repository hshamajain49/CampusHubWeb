# Accounts: deletion, retention and the suggestion box

Migration: `database/migrations/20261116000100_multiday_suggestions_account_deletion.sql`.

## Deleting an account

Every user, including the Super Admin, can permanently delete their own account: **Profile → Delete account**
(`/profile`, `/admin/profile`). The dialog explains what is deleted and what is kept, and asks for the password and
for `DELETE` to be typed. After deletion the app signs out to the login page with "Your account and its data were
deleted.", and the email address can register again as a new account.

`DELETE /api/v1/me` with `{ "password": "…", "confirm": "DELETE" }` (rate-limited like a password change). In one
transaction (`backend/src/modules/account/account-deletion.service.ts`):

1. Check the password (`INVALID_CURRENT_PASSWORD`). Lock the venues of the user's upcoming bookings, then the profile.
2. Refuse if this is the last active Super Admin (`LAST_SUPER_ADMIN`, 409): create or promote another one first.
3. Cancel the user's upcoming confirmed bookings and promote each venue's queue, so whoever was waiting gets the time
   and is notified as usual.
4. Delete the user's bookings, the complaints they reported (photos are removed from storage after commit) and their
   suggestions.
5. Write one anonymous audit entry, then delete the login: profile, sessions, credentials, notifications and push
   devices go with it.

### What is kept (retention)

| Kept | Why | Shown as |
|---|---|---|
| Entries the user wrote on **other people's** records: booking and complaint timelines, notes, cancellations, blocks they created, complaints they handled as department staff | The other person's record stays complete and auditable | "Deleted user" (the foreign keys are `ON DELETE SET NULL`) |
| Audit-log entries they caused | The admin audit trail stays complete | Actor "Deleted user" |
| One `user.deleted` audit entry: role and how many bookings, complaints and suggestions were removed | Proof that the deletion happened, with no name, email, IP or device | Audit log → "Account deleted" |

Nothing else about the person is kept: their name, email, department, ID numbers (USN / Faculty ID on their
bookings), photos and messages are gone. Database backups follow Neon's history retention for the branch and age
out on their own.

The guard triggers on bookings and complaints allow exactly one change to final records: clearing the reference to a
deleted user (`cancelled_by`, `handled_by`). Everything else about a final record stays frozen.

## Suggestion box

Members send ideas to the administration; the Super Admin replies.

| Who | Where | What |
|---|---|---|
| Any member | `/suggestions` (account menu, mobile menu and a dashboard quick action) | Send a suggestion (subject 3–120, message 10–2,000 characters); see their own suggestions, status and the admin's reply |
| Super Admin | **Insights → Suggestion box** (`/admin/suggestions`, badge = new suggestions) | Filter New / Reviewed, search subject, text or sender, reply (shown to the author), mark reviewed or back to new |

API: `POST /api/v1/suggestions`, `GET /api/v1/suggestions` (own, paginated); `GET /api/v1/admin/suggestions`
(`status`, `q`, pagination; `meta.statusCounts`), `PATCH /api/v1/admin/suggestions/:id` (`status`, optional
`response`, `null` or empty clears it). Sending is rate-limited like filing a complaint. The dashboard KPI
`newSuggestions` drives the sidebar badge. A user's suggestions are deleted with their account.

## Signing in safely

Migration: `database/migrations/20261117000100_auth_hardening.sql`. These controls run inside the API and don't depend
on any monitoring service.

### Failed sign-ins (every account)

Better Auth limits sign-in per IP (10 per 5 minutes in production). On top of that, `backend/src/lib/login-throttle.ts`
counts failures **per account**, in Postgres, so the counts survive restarts:

| Counter | Trigger | Lock |
|---|---|---|
| Account + IP | 5 failures within 15 minutes | 1 minute, doubling with each further failure, at most 15 minutes |
| Account (any IP) | 20 failures within 60 minutes | 15 minutes |

- A locked account is refused **before** the password is checked (`429`, code `SIGN_IN_LOCKED`, `Retry-After`). The
  message tells the user how long to wait and suggests resetting the password.
- Unknown emails are counted and locked exactly like real ones, so the answer never reveals whether an account exists.
- The table stores keyed hashes, never email addresses.
- A successful sign-in clears its account + IP counter. **A password reset clears every lock of the account**, so the
  owner always has a way back in.
- A deactivated account (`403`) is not counted as a guess.

### Two-step verification (Super Admin)

Super Admins must use an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…; TOTP, 6
digits, 30 seconds). It is required in production. `SUPER_ADMIN_MFA=off` is refused there and is the default only in
development and tests.

- **First sign-in:** replace the temporary password, then `/admin/two-factor`:
  1. confirm the password;
  2. scan the QR code, or type the key;
  3. enter a code;
  4. save the 10 one-time recovery codes.

  Nothing in the admin API works until this is done (`403 MFA_ENROLLMENT_REQUIRED`).
- **Every sign-in after that:** the session must pass the code step before anything else (`403 MFA_REQUIRED`). Each
  code works once (its time step is recorded). After 5 wrong codes the step pauses for 5 minutes, doubling up to an hour
  (`429 MFA_LOCKED`).
- **Recovery codes:** each signs in once (audited as `user.mfa_recovery_code_used`). **Profile → Two-step verification**
  shows how many are left and generates a new set; that needs a current authenticator code.
- **Lost phone and no recovery codes:** someone with access to the server runs:
  - local: `npm run reset-mfa -w @campushub/backend -- --email <address>`
  - production: `npm run reset-mfa:prod -- --email <address>`

  This removes the authenticator and signs the account out everywhere; a new one is set up at the next sign-in.
- The secret is stored encrypted (AES-256-GCM, key derived from `BETTER_AUTH_SECRET`), and recovery codes only as
  hashes. Rotating `BETTER_AUTH_SECRET` therefore means resetting every Super Admin's two-step verification.
- Better Auth's `twoFactor` plugin isn't used: its sign-in step keeps state in a cookie, and the SPA and API are on
  different sites with bearer tokens. The API instead records verified sessions in `auth_session_mfa`; signing out,
  expiry or a password change deletes the record.

API (Super Admin only): `POST /api/v1/me/mfa/setup` `{password}`, `POST /api/v1/me/mfa/enable` `{code}`,
`POST /api/v1/me/mfa/verify` `{code}` (a 6-digit code or a recovery code), `POST /api/v1/me/mfa/recovery-codes` `{code}`.
`GET /api/v1/me` returns `mfa: { required, enrolled, verified, recoveryCodesLeft }`.

### Super Admin sessions and passwords

- A Super Admin session ends **12 hours after sign-in**, whatever its activity (`SUPER_ADMIN_SESSION_HOURS`). Members
  keep the 7-day rolling session.
- Super Admin passwords need **at least 12 characters**. This applies when changing or resetting the password and in
  `create-super-admin`.
- Every password, for any role, must not be a common one (`isCommonPassword` in `shared/src/rules/security-rules.ts`).
  Examples: `Password123`, `Admin@123`, `CampusHub#1` and this repository's published demo passwords.

### Production start-up guard

With `NODE_ENV=production`, the API **refuses to start** if its database contains seeded `@demo.edu` accounts. Their
passwords are public, so such a deployment would hand anyone a Super Admin sign-in. Fix `DATABASE_URL`, or set
`ALLOW_DEMO_DATA=true` for a deliberate public demo.
