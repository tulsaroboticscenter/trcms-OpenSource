# Contributing to TRCMS

Thanks for your interest! TRCMS is a program-management system built for FIRST robotics
organizations (and, increasingly, other youth/STEM programs). Contributions — bug fixes, features,
docs, translations — are welcome.

## Before you start
- **Security issues:** do NOT open a public issue — see [SECURITY.md](SECURITY.md).
- For anything non-trivial, **open an issue first** to discuss the approach before writing code.
- By contributing, you agree your contributions are licensed under the project's license
  (**AGPL-3.0** — see [LICENSE](LICENSE)).

## Project shape
- **Backend:** PHP (Slim 4) + MySQL/MariaDB. Code in `src/`, routes in `src/Routes/api.php`,
  schema in `deploy/migrations/` (sequential, numbered, forward-only; each ends by recording itself
  in `schema_migrations`).
- **Frontend:** React + TypeScript + Vite. The app is organized into **modules** — the module
  registry (`moduleRegistry.ts`) is the single place a module is wired in.
- Docs and design notes live in `docs/`.

## Dev setup
See the setup docs (`SETUP_WINDOWS.md`, `PLESK_DEPLOYMENT.md`) and `.env.example`. In short: create
a database, copy `.env.example` to `.env` and fill it in (generate your own `SECRET_KEY`), run the
migrations, and start the backend + `npm run dev` for the frontend.

## Pull requests
- Keep each PR focused on one change; write a clear description of what and why.
- **Backend:** no secrets or real personal data in code, commits, or fixtures — ever. Use
  placeholders/synthetic data. Parameterize SQL (no string interpolation of user input).
- **Frontend:** type-check with `tsc -b` before submitting.
- Gate access on **permission keys**, not hardcoded roles or member types.
- Add a user-facing changelog line for anything users will notice (`src/core/version.ts`).
- Don't commit real credentials, DB dumps, or organization-specific one-off scripts.

## Adding or changing a module
Register it in `moduleRegistry.ts` (frontend) and add its routes/permissions on the backend. Prefer
extending existing shared systems (members, permissions, communications, reports) over new
parallel ones. Note module **dependencies** — most everything builds on the members module.

## Code of conduct
Be respectful and constructive. This project exists to help volunteers serve kids; keep that spirit.
