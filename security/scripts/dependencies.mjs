// npm run security:dependencies
// Known-vulnerable packages (npm audit, every workspace) and registry signature checks (npm audit signatures).
// FAIL: a high/critical advisory in a production dependency that isn't accepted in security/accepted.json.
// WARN: anything else unaccepted, or an acceptance whose review date has passed.
import { ACCEPTED, Report, isExpired, run } from './lib.mjs';

const report = new Report('Dependencies', 'static');

function audit(extra) {
  const r = run('npm', ['audit', '--json', '--workspaces', '--include-workspace-root', ...extra]);
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { error: (r.stderr || r.stdout).slice(0, 300) };
  }
}

/** The advisories behind a package entry, following "via" chains to their source. */
function advisoriesOf(vulns, name, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const out = [];
  for (const v of vulns[name]?.via ?? []) {
    if (typeof v === 'string') out.push(...advisoriesOf(vulns, v, seen));
    else out.push({ id: v.url?.split('/').pop() ?? String(v.source), title: v.title, severity: v.severity, pkg: v.name, url: v.url });
  }
  return out;
}

const all = audit([]);
const prod = audit(['--omit=dev']);
if (all.error || !all.vulnerabilities) {
  report.add('DEP-00', 'npm audit could not run', 'warn', { detail: all.error ?? 'no output' });
} else {
  const prodNames = new Set(Object.keys(prod.vulnerabilities ?? {}));
  const advisories = new Map();
  for (const name of Object.keys(all.vulnerabilities)) {
    for (const a of advisoriesOf(all.vulnerabilities, name)) {
      const cur = advisories.get(a.id) ?? { ...a, via: new Set(), prod: false };
      cur.via.add(name);
      if (prodNames.has(name)) cur.prod = true;
      advisories.set(a.id, cur);
    }
  }
  const deps = all.metadata?.dependencies ?? {};
  report.add('DEP-01', 'Packages audited', 'info', { detail: `${deps.total ?? '?'} packages (${deps.prod ?? '?'} production, ${deps.dev ?? '?'} development)` });
  if (!advisories.size) report.add('DEP-02', 'No known vulnerabilities in any dependency', 'pass');
  for (const a of advisories.values()) {
    const acc = ACCEPTED.advisories.find((x) => x.id === a.id);
    const where = a.prod ? 'production dependency' : 'development tooling only';
    const detail = `${a.severity} · ${a.pkg} · ${where} · via ${[...a.via].join(', ')} · ${a.url ?? ''}`;
    let status;
    if (acc && !isExpired(acc.until)) status = 'info';
    else if (acc) status = 'warn';
    else if (a.prod && ['high', 'critical'].includes(a.severity)) status = 'fail';
    else status = 'warn';
    const note = acc ? (isExpired(acc.until) ? ` · ACCEPTANCE EXPIRED ${acc.until}` : ` · accepted until ${acc.until}: ${acc.reason}`) : '';
    report.add(a.id, a.title, status, { severity: a.severity, detail: detail + note });
  }
  const prodCount = Object.keys(prod.vulnerabilities ?? {}).length;
  report.expect('DEP-03', 'Production dependencies have no known vulnerabilities', prodCount === 0, `${prodCount} vulnerable production package(s)`, 'warn');
}

// Registry signatures and provenance: detects tampered tarballs in the lockfile's packages.
const sig = run('npm', ['audit', 'signatures']);
const sigText = `${sig.stdout}\n${sig.stderr}`;
const verified = /(\d+) packages? ha(?:s|ve) verified registry signatures/.exec(sigText)?.[1];
const invalid = /(\d+) packages? ha(?:s|ve) (?:an )?invalid registry signatures?/.exec(sigText)?.[1];
if (invalid) report.add('DEP-04', 'Registry signatures', 'fail', { detail: `${invalid} package(s) with invalid signatures` });
else if (verified) report.add('DEP-04', 'Registry signatures', 'pass', { detail: `${verified} packages verified` });
else report.add('DEP-04', 'Registry signatures', 'warn', { detail: `could not verify: ${sigText.trim().slice(0, 200)}` });

report.print();
report.save();
process.exitCode = report.failed ? 1 : 0;
