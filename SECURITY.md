# Security Policy

TRCMS handles sensitive data about minors (rosters, medical/consent info, guardian contacts,
payments). We take security seriously and appreciate responsible disclosure.

## Reporting a vulnerability

**Please do NOT open a public GitHub issue for security problems.**

Report privately to **security@tulsaroboticscenter.org** (or, if that is unavailable, via a
GitHub private security advisory on this repository). Include:

- a description of the issue and its impact,
- steps to reproduce (a proof of concept if you have one),
- affected version / commit, and
- any suggested remediation.

We aim to acknowledge reports within **3 business days** and to provide a remediation timeline
after triage. Please give us a reasonable window to fix and release before any public disclosure.

## Scope

In scope: the TRCMS application code in this repository (backend API, frontend, install/setup,
cron jobs). Out of scope: third-party dependencies (report upstream), and any individual
organization's own hosting/configuration.

## For operators (self-hosters)

Getting these right is part of running TRCMS safely:

- Serve the site from the **`public/`** directory as the web root — never the repository root.
- Keep `.env` outside the web root and never commit it. Each install must generate its **own**
  `SECRET_KEY` and `INCIDENT_VAULT_KEY` (the installer does this) — never reuse another install's.
- Run over **HTTPS** only.
- Restrict any kiosk/check-in endpoints to your local network where appropriate.
- Apply updates promptly; security fixes are noted in the changelog.
- Take and test **backups**, and store the incident-vault key somewhere you can recover it.

## Supported versions

Security fixes are applied to the latest release. Older versions are not maintained — please stay
current.
