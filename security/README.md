# Security tooling

Repeatable security checks for CampusHub. Reports go to `security/reports/` (git-ignored) and, with `--upload`, to
CampusHub Sentinel, the developers' private monitoring service. They never go into this repository, which is public.

**A clean run is not proof that CampusHub is secure.** These are automated checks: they find known patterns and
regressions, not every weakness.

## Commands

| Command | What it does | Safe against production? |
|---|---|---|
| `npm run security:dependencies` | `npm audit` for every workspace, split into production and dev-only; registry signature check | Doesn't touch any server |
| `npm run security:secrets` | Credentials in tracked files, untracked files, the built site (`frontend/dist`) and the whole git history; prints values masked | Doesn't touch any server |
| `npm run security:sast` | CampusHub-specific static checks: eval, raw HTML, TLS off, CORS wildcard, open redirects, request values in SQL, unreviewed SQL interpolation | Doesn't touch any server |
| `npm run security:headers -- --api <url> --site <url> [--sentinel <url>]` | **Passive**: TLS, security headers, CORS, anonymous access refused, no credentials in the site bundle, no leaky errors | **Yes**: GET and preflight requests only |
| `npm run security:probe -- --target <url> [--xff] [--spike N]` | **Active, non-destructive** attack simulation (below) | **No. Local or staging only** |
| `npm run security:scan` | dependencies + secrets + static analysis | Doesn't touch any server |
| `npm run security:audit -- [options]` | all of the above, combined into one report: `--api/--site/--sentinel`, `--target`, `--semgrep file`, `--zap file`, `--env`, `--upload`, `--quiet` | Depends on the options |

`.github/workflows/security.yml` runs the scan weekly with Semgrep (OWASP, JavaScript, TypeScript and Node rule
sets). On a manual run it can also run the OWASP ZAP baseline, which is passive. The log shows counts only; the
details are uploaded to Sentinel.

## The active probe

Rules it enforces:

- **Targets:** it refuses any target that isn't `localhost` unless the host is listed in
  `SECURITY_PROBE_ALLOWED_HOSTS`. Only test environments you own or are authorised to assess, and never production.
- **Simulated:** every request carries `X-Sentinel-Simulated: 1`, so Sentinel files the alerts as simulated. They
  send no email and never score or block an address. Production ignores the header.
- **No denial of service:** a few hundred requests. `--spike N` adds one burst of N cheap requests, to exercise the
  traffic-spike rule.
- **Clean-up:** data it creates is titled `SECPROBE` and withdrawn at the end. It changes one setting and one
  student's role, then reverts both; the audit log keeps the record, by design. With a Super Admin that has no
  two-step verification, it enrols one, then deliberately locks it with wrong codes. Reset that account afterwards
  (`npm run reset-mfa -w @campushub/backend -- --email <admin>`).
- **`--xff`:** varies `X-Forwarded-For` to emulate several attackers. It only works when the target trusts exactly
  one proxy hop (`TRUST_PROXY=1`).

What it covers:

- **Sign-in:** spraying, brute force, per-account lockout, account enumeration (answers and timing), forged and
  signed-out tokens, password-reset enumeration and redirect.
- **Access control:** anonymous and member calls to the admin API; complaint ownership across students and
  departments; record enumeration; mass assignment; prototype pollution.
- **Input:** SQL / script / traversal / template payloads, including a time-based SQL check; stored script text;
  oversized and malformed bodies; encoded traversal.
- **Uploads:** SVG with a script, HTML disguised as an image, a decompression bomb, an oversized file, and an image
  with a PHP payload (it must be re-encoded); photo URLs must be signed.
- **Rate limits** and `Retry-After`.
- **Super Admin:** the admin area is closed until two-step verification is set up, a new session is held at the
  second step, wrong codes lock it, and the API can't create or change a Super Admin.

The authorization matrix, every route × every role, is an automated test:
`backend/tests/integration/authz-matrix.test.ts`.

## Accepted risks

`security/accepted.json` lists risks accepted on purpose (advisories with a review date, test-only values, reviewed
SQL fragments), each with a reason. The scripts report those as INFO, and as WARN again once a review date passes.
