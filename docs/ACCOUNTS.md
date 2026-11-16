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
