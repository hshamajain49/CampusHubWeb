// Super Admin two-step verification in the browser (security/AUDIT.md F-02). Needs an API started with
// SUPER_ADMIN_MFA=required (the default in production, off in development), so it is skipped unless E2E_MFA=1:
//   SUPER_ADMIN_MFA=required on the API, then  E2E_MFA=1 npx playwright test two-factor
// A throwaway Super Admin is created in the database with a temporary password (copied from the seeded demo admin's
// hash) and deleted afterwards.
import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

test.skip(process.env.E2E_MFA !== '1', 'needs an API with SUPER_ADMIN_MFA=required (set E2E_MFA=1)');

const EMAIL = `e2e.mfa.${Date.now()}@demo.edu`;
const TEMP_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin12345';
const NEW_PASSWORD = 'E2e-mfa-admin-pass-2026';
const db = () => new pg.Client({ connectionString: process.env.DATABASE_URL });

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) — what the authenticator app would show. */
function totp(base32: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of base32.replace(/\s+/g, '').toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac('sha1', Buffer.from(bytes)).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  return String((((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!) % 1_000_000).padStart(6, '0');
}

async function signInAdmin(page: Page, password: string) {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.beforeAll(async () => {
  const c = db();
  await c.connect();
  try {
    const { rows } = await c.query(
      `with u as (insert into auth_users (email, name, email_verified) values ($1, 'E2E Two-Step Admin', true) returning id)
       insert into auth_accounts (user_id, account_id, provider_id, password)
       select u.id, u.id, 'credential', (select a.password from auth_accounts a join profiles p on p.id = a.user_id
                                          where lower(p.email) = lower($2) and a.provider_id = 'credential')
         from u returning user_id`,
      [EMAIL, process.env.E2E_ADMIN_EMAIL ?? 'admin@demo.edu'],
    );
    await c.query("update profiles set role = 'super_admin', must_change_password = true where id = $1", [rows[0].user_id]);
  } finally {
    await c.end();
  }
});

test.afterAll(async () => {
  const c = db();
  await c.connect();
  await c.query('delete from auth_users where lower(email) = $1', [EMAIL]).finally(() => c.end());
});

test('2FA-01: first sign-in → new password → set up the authenticator → save recovery codes → admin area; next sign-in asks for a code', async ({ page }) => {
  test.skip(test.info().project.name !== 'chromium-desktop', 'desktop only');

  // 1. The temporary password must be replaced first (and it's a published demo password: the form says so).
  await signInAdmin(page, TEMP_PASSWORD);
  await expect(page).toHaveURL(/\/change-password/);
  await expect(page.getByText('At least 12 characters')).toBeVisible();
  await page.getByLabel('Current (temporary) password').fill(TEMP_PASSWORD);
  await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel('Confirm new password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Update password' }).click();

  // 2. Then two-step verification is set up; the admin area stays closed until it is.
  await expect(page).toHaveURL(/\/admin\/two-factor/);
  await page.goto('/admin/dashboard');
  await expect(page).toHaveURL(/\/admin\/two-factor/);
  await expect(page.getByRole('heading', { name: 'Set up two-step verification' })).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
  await page.getByText("Can't scan? Enter the key instead").click();
  const secret = (await page.locator('details code').innerText()).trim();
  expect(secret.replace(/\s+/g, '')).toMatch(/^[A-Z2-7]{32}$/);
  await page.getByLabel('Code from the app').fill(totp(secret));
  await page.getByRole('button', { name: 'Turn on two-step verification' }).click();

  // 3. Recovery codes are shown once; Continue waits for the confirmation checkbox. Refocusing the window (a /me
  //    refetch) must not navigate away from them.
  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  await expect(page.locator('ul.font-mono li')).toHaveCount(10);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(1500);
  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  const continueBtn = page.getByRole('button', { name: 'Continue' });
  await expect(continueBtn).toBeDisabled();
  await page.getByRole('checkbox').click();
  await continueBtn.click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);

  // 4. The profile shows the status.
  await page.goto('/admin/profile');
  await expect(page.getByText('10 recovery codes left.')).toBeVisible();

  // 5. Sign out and back in: the second step is asked for, and a wrong code is refused.
  await page.getByRole('button', { name: 'Sign out' }).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/admin\/login/);
  await signInAdmin(page, NEW_PASSWORD);
  await expect(page).toHaveURL(/\/admin\/two-factor/);
  await expect(page.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
  const right = totp(secret, Date.now() + 30_000); // the next time step: the enrolment code's step is used up
  const wrong = String((Number(right) + 500_000) % 1_000_000).padStart(6, '0');
  await page.getByLabel('Code', { exact: true }).fill(wrong);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText("That code didn't work")).toBeVisible();
  await page.getByLabel('Code', { exact: true }).fill(right);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
});
