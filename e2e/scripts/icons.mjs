// Renders the PWA / push icons in frontend/public/icons from the brand mark (run: node e2e/scripts/icons.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/public/icons');
fs.mkdirSync(out, { recursive: true });

const gradient = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#1E3A8A"/><stop offset="1" stop-color="#0D9488"/></linearGradient></defs>`;
const bars = (fill = '#FFFFFF', track = '#FFFFFF', trackOpacity = '.28', accent = '#F59E0B') => `
  <rect x="14" y="17" width="36" height="7" rx="3.5" fill="${track}" fill-opacity="${trackOpacity}"/>
  <rect x="14" y="17" width="22" height="7" rx="3.5" fill="${fill}"/>
  <rect x="14" y="28.5" width="36" height="7" rx="3.5" fill="${track}" fill-opacity="${trackOpacity}"/>
  <rect x="26" y="28.5" width="24" height="7" rx="3.5" fill="${fill}"/>
  <rect x="14" y="40" width="36" height="7" rx="3.5" fill="${track}" fill-opacity="${trackOpacity}"/>
  <rect x="14" y="40" width="14" height="7" rx="3.5" fill="${accent}"/>`;

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%">${body}</svg>`;

const icons = [
  // Standard: the rounded mark, transparent corners.
  { name: 'icon-192.png', size: 192, body: `${gradient}<rect width="64" height="64" rx="16" fill="url(#g)"/>${bars()}` },
  { name: 'icon-512.png', size: 512, body: `${gradient}<rect width="64" height="64" rx="16" fill="url(#g)"/>${bars()}` },
  // Maskable: full-bleed background, glyph scaled into the 80 % safe circle.
  {
    name: 'icon-maskable-512.png',
    size: 512,
    body: `${gradient}<rect width="64" height="64" fill="url(#g)"/><g transform="translate(32 32) scale(.72) translate(-32 -32)">${bars()}</g>`,
  },
  // iOS rounds the corners itself and ignores transparency.
  { name: 'apple-touch-icon.png', size: 180, body: `${gradient}<rect width="64" height="64" fill="url(#g)"/>${bars()}` },
  // Android notification badge: alpha-only silhouette.
  {
    name: 'badge-72.png',
    size: 72,
    body: `<g transform="translate(32 32) scale(1.3) translate(-32 -32)">${bars('#FFFFFF', '#FFFFFF', '.45', '#FFFFFF')}</g>`,
  },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const icon of icons) {
  await page.setViewportSize({ width: icon.size, height: icon.size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><div style="width:${icon.size}px;height:${icon.size}px">${svg(icon.body)}</div></body></html>`,
  );
  await page.screenshot({ path: path.join(out, icon.name), omitBackground: true, clip: { x: 0, y: 0, width: icon.size, height: icon.size } });
  console.log('wrote', icon.name);
}
await browser.close();
