// Turns third-party scanner output into report sections, so everything lands in one report (and in Sentinel).
//   Semgrep: semgrep scan --json -o semgrep.json …   →  importSemgrep('semgrep.json')
//   OWASP ZAP baseline: zap-baseline.py -J zap.json  →  importZap('zap.json')
import fs from 'node:fs';
import { ACCEPTED, Report } from './lib.mjs';

export function importSemgrep(file) {
  const report = new Report('Semgrep', 'static');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const accepted = ACCEPTED.semgrep ?? [];
  for (const r of data.results ?? []) {
    const rule = r.check_id?.split('.').pop() ?? r.check_id;
    const acc = accepted.find((a) => a.rule === rule && (!a.file || a.file === r.path));
    const sev = r.extra?.severity ?? 'INFO';
    const status = acc ? 'info' : sev === 'ERROR' ? 'fail' : sev === 'WARNING' ? 'warn' : 'info';
    const owasp = [].concat(r.extra?.metadata?.owasp ?? []).join('; ');
    report.add(rule, (r.extra?.message ?? rule).split('\n')[0].slice(0, 200), status, {
      severity: sev.toLowerCase(),
      location: `${r.path}:${r.start?.line ?? '?'}`,
      detail: `${owasp}${acc ? ` · accepted: ${acc.reason}` : ''}`,
    });
  }
  for (const e of data.errors ?? []) report.add('semgrep-error', 'Semgrep could not analyse a file', 'warn', { detail: String(e.message ?? e.type).slice(0, 200), location: e.path });
  const scanned = data.paths?.scanned?.length;
  report.add('SEMGREP-00', 'Files analysed', 'info', { detail: `${scanned ?? '?'} files, ${data.results?.length ?? 0} findings` });
  if (!report.checks.some((c) => c.status === 'fail' || c.status === 'warn')) report.add('SEMGREP-01', 'No findings at WARNING or ERROR', 'pass');
  return report;
}

const RISK = { 3: ['fail', 'high'], 2: ['warn', 'medium'], 1: ['warn', 'low'], 0: ['info', 'info'] };
export function importZap(file) {
  const report = new Report('OWASP ZAP baseline', 'passive');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const accepted = ACCEPTED.zap ?? [];
  for (const site of [].concat(data.site ?? [])) {
    for (const a of site.alerts ?? []) {
      const acc = accepted.find((x) => String(x.pluginId) === String(a.pluginid));
      const [status, severity] = RISK[Number(a.riskcode)] ?? ['info', 'info'];
      const where = (a.instances ?? []).slice(0, 3).map((i) => i.uri).join(', ');
      report.add(`ZAP-${a.pluginid}`, a.alert ?? a.name, acc ? 'info' : status, {
        severity,
        location: site['@name'],
        detail: `${a.count ?? a.instances?.length ?? 0} instance(s) · ${where}${acc ? ` · accepted: ${acc.reason}` : ''}`.slice(0, 500),
      });
    }
  }
  if (!report.checks.some((c) => c.status === 'fail' || c.status === 'warn')) report.add('ZAP-00', 'No medium or high ZAP alerts', 'pass');
  return report;
}
