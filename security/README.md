# Security tooling

This folder holds CampusHub's repeatable security checks: dependency audit, secret scanning, static analysis and
safe active probes. Run them against local or staging environments only.

- **Reports:** generated reports go to `security/reports/`. That folder is git-ignored, because this repository is
  public and a report describes weaknesses before they are fixed.
- **Findings and the monitoring plan:** these live in the private CampusHub Sentinel repository, not here.
