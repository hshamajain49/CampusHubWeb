// npm run security:secrets [-- --history]
// Looks for credentials in: tracked files, untracked files that could be committed next, the built site
// (frontend/dist: what browsers download), and with --history every line ever added in git.
// Found values are printed masked (first 4 characters). FAIL on anything not accepted in security/accepted.json.
// CI also runs gitleaks; this is the quick local equivalent with CampusHub-specific patterns.
import fs from 'node:fs';
import path from 'node:path';
import { ACCEPTED, ROOT, Report, arg, mask, run } from './lib.mjs';

const report = new Report('Secrets', 'static');

const PATTERNS = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['brevo-api-key', /xkeysib-[a-f0-9]{64}-[A-Za-z0-9]{16}/],
  ['neon-api-key', /\bnapi_[a-z0-9]{40,}\b/],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['postgres-url-with-password', /postgres(?:ql)?:\/\/[^:\s/'"]+:[^@\s'"]{6,}@(?!localhost|127\.0\.0\.1|db[:/]|db-test[:/])[^\s/'"]+/],
  ['cloudinary-url', /cloudinary:\/\/\d+:[A-Za-z0-9_-]{10,}@/],
  ['ably-key', /\b[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{6}:[A-Za-z0-9_-]{30,}\b/],
  ['render-deploy-hook', /https:\/\/api\.render\.com\/deploy\/srv-[a-z0-9]+\?key=[A-Za-z0-9_-]+/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['sentinel-ingest-key', /\bik_[A-Za-z0-9]{16,}\b/],
  // NAME=value assignments (env files, YAML, shell) where the name says secret and the value looks real.
  ['secret-assignment', /\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY|PASSPHRASE)[A-Z0-9_]*)\s*[=:]\s*['"]?([A-Za-z0-9+/=_\-.]{16,})/],
];
const PLACEHOLDER = /replace|example|changeme|your[-_]|<[^>]*>|x{6,}|\$\{\{|\$\{|dummy|placeholder|test[-_]?only|local[-_]test/i;
const SKIP_FILE = /(^|\/)(package-lock\.json|.*\.(png|jpe?g|webp|gif|ico|woff2?|ttf|pdf|mmdb|zip|gz))$/i;

const accepted = (file) => ACCEPTED.secrets.find((a) => a.file === file);
const findings = new Map();

function scanText(text, where, file) {
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.length > 20_000) line = line.slice(0, 20_000);
    for (const [rule, re] of PATTERNS) {
      const m = re.exec(line);
      if (!m) continue;
      const value = rule === 'secret-assignment' ? m[2] : m[0];
      if (PLACEHOLDER.test(value)) continue;
      // A code reference (file.BETTER_AUTH_SECRET, process.env.X) names a secret; it isn't one.
      if (rule === 'secret-assignment' && (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(value) || /process\.env|import\.meta/.test(line))) continue;
      const key = `${rule}:${file}:${value}`;
      if (findings.has(key)) continue;
      findings.set(key, { rule, file, location: `${where}:${i + 1}`, value });
    }
  });
}

// 1. Tracked + untracked-but-not-ignored files.
const tracked = run('git', ['ls-files']).stdout.split('\n').filter(Boolean);
const untracked = run('git', ['ls-files', '--others', '--exclude-standard']).stdout.split('\n').filter(Boolean);
let scanned = 0;
for (const file of [...tracked, ...untracked]) {
  if (SKIP_FILE.test(file)) continue;
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full) || fs.statSync(full).size > 2_000_000) continue;
  scanText(fs.readFileSync(full, 'utf8'), file, file);
  scanned++;
}
report.add('SEC-01', 'Working tree scanned', 'info', { detail: `${scanned} files (${untracked.length} untracked, not ignored)` });

// 2. The built site: everything in it is public.
const dist = path.join(ROOT, 'frontend', 'dist');
if (fs.existsSync(dist)) {
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|html|css|json|txt|webmanifest|map)$|_headers$/.test(e.name)) {
        scanText(fs.readFileSync(p, 'utf8'), path.relative(ROOT, p).replace(/\\/g, '/'), 'frontend/dist');
        n++;
      }
    }
  };
  walk(dist);
  report.add('SEC-02', 'Built site (frontend/dist) scanned', 'info', { detail: `${n} files` });
} else report.add('SEC-02', 'Built site not scanned', 'skip', { detail: 'no frontend/dist: run npm run build first' });

// 3. Git history: every added line in every commit.
if (arg('history')) {
  const log = run('git', ['log', '-p', '--all', '--no-color', '--unified=0', '--format=commit %h']).stdout;
  let commit = '';
  let file = '';
  let added = 0;
  for (const line of log.split('\n')) {
    if (line.startsWith('commit ')) commit = line.slice(7).trim();
    else if (line.startsWith('+++ b/')) file = line.slice(6).trim();
    else if (line.startsWith('+') && !line.startsWith('+++') && !SKIP_FILE.test(file)) {
      scanText(line.slice(1), `${file}@${commit}`, file);
      added++;
    }
  }
  report.add('SEC-03', 'Git history scanned', 'info', { detail: `${added} added lines across ${run('git', ['rev-list', '--all', '--count']).stdout.trim()} commits` });
} else report.add('SEC-03', 'Git history not scanned', 'skip', { detail: 'pass --history (CI also runs gitleaks over the full history)' });

let i = 0;
for (const f of findings.values()) {
  const fixture = /(^|\/)(tests?|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$/.test(f.file) ? { reason: 'test fixture (local test value, not a deployed credential)' } : null;
  const acc = accepted(f.file) ?? fixture;
  report.add(`SEC-F${String(++i).padStart(2, '0')}`, `Possible ${f.rule}`, acc ? 'info' : 'fail', {
    location: f.location,
    detail: `${mask(f.value)}${acc ? ` · accepted: ${acc.reason}` : ' · if real: rotate it, then remove it (and from history)'}`,
  });
}
if (![...findings.values()].some((f) => !accepted(f.file) && !/(^|\/)(tests?|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$/.test(f.file))) report.add('SEC-04', 'No unaccepted credentials found', 'pass');

report.print();
report.save();
process.exitCode = report.failed ? 1 : 0;
