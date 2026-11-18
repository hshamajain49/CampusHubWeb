// npm run security:scan                      static checks: dependencies, secrets (incl. git history), static analysis
// npm run security:audit -- [options]       the static checks, plus:
//   --api <url> --site <url> --sentinel <url>   passive header/exposure checks (safe against production)
//   --target <local or staging API> [--xff] [--spike N]   the active probe (never production; see probe.mjs)
//   --env local|staging|production|ci        label for the report (default: local)
//   --semgrep <file> / --zap <file>          import Semgrep JSON / OWASP ZAP JSON output as report sections
//   --upload                                 send the combined report to Sentinel (needs SENTINEL_URL,
//                                            SENTINEL_INGEST_KEY_ID, SENTINEL_INGEST_SECRET in the environment)
//   --quiet                                  print counts only (public CI logs; the details go to Sentinel)
// Writes security/reports/<timestamp>/ (git-ignored): one JSON + Markdown file per script and summary.md.
import { createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, arg, reportDir, run } from './lib.mjs';
import { importSemgrep, importZap } from './importers.mjs';

const staticOnly = process.argv.includes('--static-only');
if (arg('quiet')) process.env.SECURITY_QUIET = '1';
const dir = reportDir();
const node = (script, args = []) => {
  console.log(`\n▶ ${script} ${args.join(' ')}`);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'security', 'scripts', script), ...args], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, SECURITY_REPORT_DIR: dir } });
  return r.status;
};

const statuses = [];
statuses.push(node('dependencies.mjs'));
statuses.push(node('secrets.mjs', ['--history']));
statuses.push(node('sast.mjs'));
if (!staticOnly) {
  const passive = ['api', 'site', 'sentinel'].flatMap((k) => (arg(k) ? [`--${k}`, arg(k)] : []));
  if (passive.length) statuses.push(node('headers.mjs', passive));
  if (arg('target')) statuses.push(node('probe.mjs', ['--target', arg('target'), ...(arg('xff') ? ['--xff'] : []), ...(arg('spike') ? ['--spike', arg('spike')] : [])]));
}
for (const [flag, load] of [
  ['semgrep', importSemgrep],
  ['zap', importZap],
]) {
  const file = arg(flag);
  if (typeof file !== 'string') continue;
  if (!fs.existsSync(file)) {
    console.error(`--${flag}: ${file} not found`);
    statuses.push(2);
    continue;
  }
  const r = load(file);
  r.print();
  r.save(dir);
  statuses.push(r.failed ? 1 : 0);
}

// ───────────────────────────── combined report ─────────────────────────────
const sections = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.json') && f !== 'summary.json' && f !== 'expected-rules.json')
  .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
const total = { pass: 0, fail: 0, warn: 0, info: 0, skip: 0 };
for (const s of sections) for (const k of Object.keys(total)) total[k] += s.summary[k];
const commit = run('git', ['rev-parse', '--short', 'HEAD']).stdout.trim();
const env = String(arg('env', 'local'));
const summary = {
  source: 'campushub security:audit',
  environment: env,
  gitCommit: commit || null,
  startedAt: sections.map((s) => s.startedAt).sort()[0] ?? new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  summary: total,
  sections,
};
fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(
  path.join(dir, 'summary.md'),
  [
    `# CampusHub security audit`,
    '',
    `Environment: ${env} · commit ${commit} · ${summary.finishedAt}`,
    '',
    `**${total.pass} pass, ${total.fail} fail, ${total.warn} warn, ${total.info} info, ${total.skip} skip.**`,
    '',
    'Automated checks only: a clean run is not proof that CampusHub is secure. Active-probe results come from',
    'simulated attacks on a local or staging environment, not from production monitoring.',
    '',
    ...sections.map((s) => `- ${s.name} (${s.kind}): ${s.summary.pass} pass, ${s.summary.fail} fail, ${s.summary.warn} warn`),
    '',
  ].join('\n'),
);
console.log(`\nReport: ${path.relative(ROOT, dir)}  ·  ${total.pass} pass, ${total.fail} fail, ${total.warn} warn, ${total.info} info, ${total.skip} skip`);

// ───────────────────────────── upload to Sentinel ─────────────────────────────
if (arg('upload')) {
  const { SENTINEL_URL, SENTINEL_INGEST_KEY_ID, SENTINEL_INGEST_SECRET } = process.env;
  if (!SENTINEL_URL || !SENTINEL_INGEST_KEY_ID || !SENTINEL_INGEST_SECRET) {
    console.error('--upload needs SENTINEL_URL, SENTINEL_INGEST_KEY_ID and SENTINEL_INGEST_SECRET in the environment.');
    process.exitCode = 2;
  } else {
    const p = '/ingest/v1/reports';
    const body = JSON.stringify({
      ...summary,
      sections: sections.map((s) => ({ ...s, checks: s.checks.slice(0, 1000).map((c) => ({ ...c, detail: c.detail?.slice(0, 500) })) })),
    });
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', SENTINEL_INGEST_SECRET).update(`${t}.POST.${p}.`).update(body).digest('hex');
    const res = await fetch(`${SENTINEL_URL.replace(/\/+$/, '')}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sentinel-key': SENTINEL_INGEST_KEY_ID, 'x-sentinel-signature': `t=${t},v1=${sig}` },
      body,
      signal: AbortSignal.timeout(60_000),
    });
    console.log(res.ok ? `Uploaded to Sentinel (${res.status}).` : `Upload failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    if (!res.ok) process.exitCode = 2;
  }
}
if (statuses.some((s) => s === 1)) process.exitCode = process.exitCode || 1;
