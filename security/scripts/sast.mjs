// npm run security:sast
// Pattern checks tailored to CampusHub's stack (Express + pg + React). Quick and local; CI runs Semgrep's OWASP
// rule sets for broader coverage (.github/workflows/security.yml). Findings are leads to review, not proof.
import fs from 'node:fs';
import path from 'node:path';
import { ACCEPTED, ROOT, Report, run } from './lib.mjs';

const report = new Report('Static analysis', 'static');
const files = run('git', ['ls-files', 'backend/src', 'frontend/src', 'shared/src', 'frontend/scripts', 'scripts'])
  .stdout.split('\n')
  .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && !/\.test\.|\.spec\.|\.d\.ts$/.test(f));

/** [id, title, severity → status, file filter, regex, advice] */
const RULES = [
  ['eval', 'Dynamic code execution (eval / new Function)', 'fail', /./, /\beval\s*\(|new\s+Function\s*\(/, 'Never evaluate strings as code.'],
  ['dangerous-html', 'Raw HTML injection in React', 'fail', /\.tsx$/, /dangerouslySetInnerHTML/, 'Render text, or sanitise with a vetted library.'],
  ['inner-html', 'Assignment to innerHTML / outerHTML', 'fail', /^frontend/, /\.(inner|outer)HTML\s*=/, 'Use textContent or React.'],
  ['tls-off', 'TLS certificate checks switched off', 'fail', /./, /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/, 'Keep certificate verification on.'],
  ['cors-wildcard', 'CORS allows any origin', 'fail', /^backend/, /origin\s*:\s*(['"]\*['"]|true)\b/, 'Use the explicit allowlist (CORS_ORIGINS).'],
  ['child-process', 'Shell / process execution in the API', 'warn', /^backend\/src/, /from ['"]node:child_process['"]|require\(['"]child_process['"]\)|\bexecSync?\s*\(/, 'Avoid; if needed, never pass request data.'],
  ['math-random', 'Math.random() in server code', 'warn', /^backend\/src/, /Math\.random\(\)/, 'Use crypto.randomBytes / randomUUID for anything secret or guessable.'],
  ['open-redirect', 'Redirect target taken from the request', 'fail', /^backend\/src/, /res\.redirect\([^)]*req\.(query|body|params)/, 'Redirect to fixed paths only.'],
  ['log-secret', 'Logging a password, token or secret', 'warn', /^backend\/src/, /logger\.\w+\([^)]*\b(password|token|secret)\b\s*[:,})]/i, 'Log ids, never credentials.'],
  ['jwt-none', 'Insecure JWT handling', 'fail', /^backend\/src/, /algorithms\s*:\s*\[\s*['"]none['"]|jwt\.decode\(/, 'Verify signatures; never accept alg none.'],
  ['http-url', 'Plain http:// URL in shipped frontend code', 'warn', /^frontend\/src/, /['"`]http:\/\/(?!localhost|127\.0\.0\.1|www\.w3\.org)/, 'Use https (mixed content, interception).'],
  ['local-storage-secret', 'Secret-like value kept in localStorage', 'info', /^frontend\/src/, /localStorage\.setItem\([^)]*(token|session|secret)/i, 'Known design (AUDIT F-10): the session token lives in localStorage.'],
];

const acceptedFor = (rule, file) => ACCEPTED.sast.find((a) => a.rule === rule && a.file === file);
const hits = [];
for (const file of files) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const lines = text.split(/\r?\n/);
  for (const [id, title, status, fileRe, re, advice] of RULES) {
    if (!fileRe.test(file)) continue;
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line) || !re.test(line)) return;
      hits.push({ id, title, status: acceptedFor(id, file) ? 'info' : status, location: `${file}:${i + 1}`, detail: `${line.trim().slice(0, 140)} · ${acceptedFor(id, file)?.reason ?? advice}` });
    });
  }
}

// SQL built with template literals: every ${…} inside SQL text must be a fixed fragment, never a request value.
// Values go through $1, $2 parameters. Interpolations of req.*, body, query or params are failures; others are
// listed for review unless they are visibly fixed fragments (names ending in Sql/Clause/where/order, joins of
// fixed lists, placeholder numbers).
const SAFE_INTERP = /^(?:[A-Z_][A-Z0-9_]*|\w*(?:Sql|SQL|Clause|clause|where|Where|order|Order|cols|Cols|columns|sets|joins|filter|Filter)\w*(?:\.join\([^)]*\))?|\w+\.join\(['"`][^'"`]*['"`]\)|params\.length(?:\s*[+-]\s*\d+)?|p\(\)|i(?:\s*[+-]\s*\d+)?|n|idx|\w+\.length)$/;
let sqlTemplates = 0;
let reviewedCount = 0;
for (const file of files.filter((f) => f.startsWith('backend/src'))) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const m of text.matchAll(/`([^`]*)`/g)) {
    const body = m[1];
    if (!/\b(select|insert\s+into|update\s+\w|delete\s+from)\b/i.test(body) || !body.includes('${')) continue;
    sqlTemplates++;
    const line = text.slice(0, m.index).split('\n').length;
    for (const im of body.matchAll(/\$\{([^}]*)\}/g)) {
      const expr = im[1].trim();
      if (/\breq\.|\bbody\b|\bquery\.|\bparams\.(?!length)/.test(expr)) {
        hits.push({ id: 'sql-request-value', title: 'Request value interpolated into SQL', status: 'fail', location: `${file}:${line}`, detail: `\${${expr}} · use a $n parameter` });
      } else if (!SAFE_INTERP.test(expr)) {
        const reviewed = (ACCEPTED.sqlReviewed ?? []).find((r) => new RegExp(r.pattern).test(expr));
        if (reviewed) reviewedCount++;
        else hits.push({ id: 'sql-interpolation', title: 'SQL interpolation not yet reviewed', status: 'warn', location: `${file}:${line}`, detail: `\${${expr.slice(0, 80)}} · confirm it is a fixed fragment, then record it in security/accepted.json (sqlReviewed)` });
      }
    }
  }
}

report.add('SAST-00', 'Files analysed', 'info', { detail: `${files.length} source files · ${sqlTemplates} SQL template literals with interpolation · ${reviewedCount} interpolations match reviewed patterns` });
for (const h of hits) report.add(h.id, h.title, h.status, { location: h.location, detail: h.detail });
for (const [id, title] of RULES.map((r) => [r[0], r[1]])) if (!hits.some((h) => h.id === id)) report.add(id, `${title}: none found`, 'pass');
if (!hits.some((h) => h.id === 'sql-request-value')) report.add('sql-request-value', 'No request value interpolated into SQL', 'pass');
if (!hits.some((h) => h.id === 'sql-interpolation')) report.add('sql-interpolation', 'Every SQL interpolation is a fixed fragment or reviewed', 'pass');

report.print();
report.save();
process.exitCode = report.failed ? 1 : 0;
