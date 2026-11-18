// Shared helpers for the security scripts: a check list that prints as a table and saves as JSON + Markdown.
// Reports go to security/reports/ (git-ignored: this repository is public).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ACCEPTED = JSON.parse(fs.readFileSync(path.join(ROOT, 'security', 'accepted.json'), 'utf8'));

const ORDER = { fail: 0, warn: 1, pass: 2, info: 3, skip: 4 };

export class Report {
  /** @param {string} name  @param {string} kind static | passive | active */
  constructor(name, kind) {
    this.name = name;
    this.kind = kind;
    this.startedAt = new Date().toISOString();
    /** @type {{id: string, title: string, status: 'pass'|'fail'|'warn'|'info'|'skip', severity?: string, detail?: string, location?: string}[]} */
    this.checks = [];
  }
  add(id, title, status, extra = {}) {
    this.checks.push({ id, title, status, ...extra });
    return status;
  }
  /** pass when ok, otherwise fail (or the given status). */
  expect(id, title, ok, detail = '', whenNot = 'fail', extra = {}) {
    return this.add(id, title, ok ? 'pass' : whenNot, { detail: String(detail ?? '').slice(0, 300), ...extra });
  }
  summary() {
    const s = { pass: 0, fail: 0, warn: 0, info: 0, skip: 0 };
    for (const c of this.checks) s[c.status]++;
    return s;
  }
  print() {
    const s = this.summary();
    console.log(`\n${this.name} (${this.kind}): ${s.pass} pass, ${s.fail} fail, ${s.warn} warn, ${s.info} info, ${s.skip} skip`);
    // Public CI logs: counts only, never the findings themselves (the full report goes to Sentinel).
    if (process.env.SECURITY_QUIET === '1') return;
    const rows = [...this.checks].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
    for (const c of rows) {
      const mark = { pass: 'PASS', fail: 'FAIL', warn: 'WARN', info: 'INFO', skip: 'SKIP' }[c.status];
      console.log(`  ${mark}  ${c.id}  ${c.title}${c.location ? `  [${c.location}]` : ''}${c.detail ? `\n          ${c.detail}` : ''}`);
    }
  }
  toJSON() {
    return { name: this.name, kind: this.kind, startedAt: this.startedAt, finishedAt: new Date().toISOString(), summary: this.summary(), checks: this.checks };
  }
  toMarkdown() {
    const s = this.summary();
    const esc = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    return [
      `## ${this.name}`,
      '',
      `Kind: ${this.kind} · ${s.pass} pass, ${s.fail} fail, ${s.warn} warn, ${s.info} info, ${s.skip} skip`,
      '',
      '| Status | Check | Title | Location | Detail |',
      '|---|---|---|---|---|',
      ...[...this.checks].sort((a, b) => ORDER[a.status] - ORDER[b.status]).map((c) => `| ${c.status.toUpperCase()} | ${c.id} | ${esc(c.title)} | ${esc(c.location)} | ${esc(c.detail)} |`),
      '',
    ].join('\n');
  }
  /** Saves <dir>/<slug>.json and .md and returns the directory. */
  save(dir = reportDir()) {
    fs.mkdirSync(dir, { recursive: true });
    const slug = this.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    fs.writeFileSync(path.join(dir, `${slug}.json`), JSON.stringify(this.toJSON(), null, 2));
    fs.writeFileSync(path.join(dir, `${slug}.md`), this.toMarkdown());
    return dir;
  }
  get failed() {
    return this.checks.some((c) => c.status === 'fail');
  }
}

/** security/reports/<timestamp>/ (or SECURITY_REPORT_DIR when security:audit runs several scripts into one folder). */
export function reportDir() {
  if (process.env.SECURITY_REPORT_DIR) return process.env.SECURITY_REPORT_DIR;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(ROOT, 'security', 'reports', stamp);
  process.env.SECURITY_REPORT_DIR = dir;
  return dir;
}

/** Runs a command (npm, git…) and returns { status, stdout, stderr }. */
export function run(cmd, args, opts = {}) {
  // npm is a .cmd on Windows and needs a shell; nothing else gets one (a shell would split arguments with spaces).
  const shell = process.platform === 'win32' && cmd === 'npm';
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell, maxBuffer: 256 * 1024 * 1024, ...opts });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

export function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

/** "abcd…(40 chars)": enough to find a value, never enough to use it. */
export function mask(value) {
  const v = String(value);
  return `${v.slice(0, 4)}…(${v.length} chars)`;
}

export function isExpired(until) {
  return until ? Date.parse(until) < Date.now() : false;
}
