import { chromium } from '@playwright/test';
const res = await fetch('http://localhost:4000/api/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' }, body: JSON.stringify({ email: 'student@demo.edu', password: 'Student12345' }) });
const tok = res.headers.get('set-auth-token');
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript((t) => localStorage.setItem('campushub.session', t), tok);
const p = await ctx.newPage();
for (const path of ['/dashboard', '/bookings', '/venues']) {
  await p.goto('http://localhost:5173' + path, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const rect = el.getBoundingClientRect();
      if (rect.right > W + 1 && rect.width > 0) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 80)} w=${Math.round(rect.width)} right=${Math.round(rect.right)}`);
    }
    return { W, sw: document.documentElement.scrollWidth, offenders: out.slice(0, 6) };
  });
  console.log(path, JSON.stringify(r, null, 1));
}
await b.close();
