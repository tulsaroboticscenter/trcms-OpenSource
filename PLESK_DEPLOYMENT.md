# TRCPMS-PHP — Deployment on Plesk Obsidian 18 (Ubuntu)

This app is built to run on **Plesk Obsidian 18.x / Ubuntu**. Plesk serves the PHP
app through its per-domain **PHP-FPM** handler (Apache behind nginx by default) and
the React build as **static files**. The one wrinkle to plan for:

> ⚠️ **Plesk does not manage PostgreSQL.** Plesk's database UI handles MySQL/MariaDB
> only. PostgreSQL is installed and managed **outside Plesk** (via SSH/apt/psql).
> That's fully supported — Postgres just runs alongside Plesk on the same server and
> the app connects to it locally. You won't see the database in the Plesk panel.

---

## Compatibility summary

| Concern | How it's handled on Plesk |
|---|---|
| PHP runtime | Plesk PHP-FPM 8.2/8.3 (selected per domain in the panel) |
| PHP ⇄ Postgres | `pdo_pgsql` + `pgsql` from the `plesk-php8x-pgsql` package, enabled in PHP Settings |
| Web root | Domain **Document Root → `.../public`** (front controller + React build) |
| Routing | `public/.htaccess` (Apache rewrite, included) — or nginx directives (below) |
| Dependencies | Composer via Plesk's **PHP Composer** UI or the Plesk PHP CLI |
| Database | **PostgreSQL installed manually** (apt); not in the Plesk DB UI |
| Static frontend | React build copied into `public/`; served directly by the web server |
| TLS | Plesk **Let's Encrypt** extension (one click) |
| `.env` secrecy | Lives **above** the document root (`public/`), so it's never web-served |

---

## Step-by-step

### 1. Create the site in Plesk
- Add a domain/subdomain, e.g. `pms.tulsaroboticscenter.org`.
- Domains → (the domain) → **PHP Settings**: choose **PHP 8.2** (or 8.3), **FPM
  served by nginx** or **Apache** — either works with the included config.

### 2. Install & enable the PostgreSQL PHP extension (per Plesk PHP version)
SSH to the server as root:
```bash
# match the PHP version you selected in Plesk (php82 / php83)
apt-get install -y plesk-php82-pgsql
plesk bin php_handler --reread        # let Plesk pick up the new module
```
Then in **Plesk → Tools & Settings → PHP Settings → PHP 8.2** (or the domain's PHP
Settings) confirm `pdo_pgsql` / `pgsql` are enabled. Verify:
```bash
/opt/plesk/php/8.2/bin/php -m | grep -i pgsql      # expect: pdo_pgsql  pgsql
```

### 3. Provision the database
PostgreSQL is **provided by the host** (no `apt-get install` needed). Connect as the
server's superuser — **`postgres_ms`** (the `postgres` role login is retired) — and
create the app role + database. Use `-U postgres_ms` (password auth); you'll be
prompted for its password (`~/.pgpass` can store it to avoid the prompt):
```bash
psql -U postgres_ms -h localhost <<'SQL'
CREATE USER trcpms WITH PASSWORD 'STRONG_PASSWORD';
CREATE DATABASE trcpms OWNER trcpms;
SQL
```
**Provision the schema + data** by restoring a dump from your current install
(this brings the full schema, so no migrations need to run on the server):
```bash
# from your dev machine: pg_dump trcpms > trcpms.sql ; scp it up, then:
psql -U postgres_ms -h localhost -d trcpms < trcpms.sql
```
> The app itself connects as the unprivileged **`trcpms`** role, never as the
> superuser. `postgres_ms` is only used for these one-time provisioning steps.
> Confirm with the host whether Postgres listens on `localhost:5432` or a managed
> host/port (adjust `-h`/`-p` and `.env` `DATABASE_URL` accordingly).

### 4. Upload the app
Put the project in the subscription, with **`public/` as the document root** and the
rest (`src/`, `vendor/`, `config/`, `.env`) **one level above** it so they're not
web-accessible. Example using the subscription's home:
```
~/trcpms-php/            <- app root (src, config, .env, vendor)
~/trcpms-php/public/     <- set this as the domain's Document Root
```
In **Hosting Settings**, set **Document Root** to `trcpms-php/public`.

### 5. Install Composer dependencies
Either the Plesk UI (**Domains → domain → PHP Composer → Install**), or SSH:
```bash
cd ~/trcpms-php
/opt/plesk/php/8.2/bin/php /usr/lib/plesk-9.0/composer.phar install --no-dev -o
# (or just `composer install` if composer is on PATH)
```

### 6. Build & place the React frontend
Build the frontend (`npm run build` in the React project) and copy the **contents of
`dist/`** into `~/trcpms-php/public/` (so `public/index.html` + `public/assets/...`
sit next to `index.php`). The web server serves the assets directly; the front
controller serves `index.html` for SPA deep links.

### 7. Configure `.env`
```ini
DATABASE_URL=postgresql://trcpms:STRONG_PASSWORD@localhost:5432/trcpms
SECRET_KEY=<same value as the original app, or a fresh long random string>
ACCESS_TOKEN_EXPIRE_MINUTES=480
ALGORITHM=HS256
ENVIRONMENT=production
ALLOWED_ORIGINS=https://pms.tulsaroboticscenter.org
APP_URL=https://pms.tulsaroboticscenter.org
```
`chmod 600 .env`. (Single-origin serving means CORS rarely matters, but set it to
your real URL anyway.)

### 8. HTTPS
**Plesk → SSL/TLS Certificates → Let's Encrypt** — issue + enable, and turn on
"redirect HTTP→HTTPS." Done.

### 9. Verify
- Browse `https://pms.tulsaroboticscenter.org` → the app loads.
- `curl -sk https://.../api/v1/auth/token -d "username=admin&password=…"` returns a token.
- Log in; confirm the dashboard and a couple of modules render.

---

## nginx-only setups (no Apache)
If the domain is set to **"nginx only"** (no Apache), `.htaccess` is ignored. Add
this under **Domains → domain → Apache & nginx Settings → Additional nginx
directives**:
```nginx
location / {
    try_files $uri $uri/ /index.php?$query_string;
}
location ~ \.php$ {
    # Plesk wires PHP-FPM automatically; this block is usually unnecessary,
    # but ensures .php is handled if you switch to nginx-only.
}
```
With Apache enabled (Plesk default), the included `public/.htaccess` already handles
routing and you can skip this.

---

## Schema ownership going forward (important)

The original (Python) app auto-creates/updates the schema on boot. **This PHP app
does not run migrations** — by design. For Plesk, that's fine at go-live because the
schema arrives with the `pg_dump` restore (step 3). But for **future schema changes**
you have two options:

1. **Run the Python migrations once** against the production DB whenever the schema
   changes (Python only needs to touch the DB, not be web-hosted), **or**
2. **Port the migration runner to PHP** — our migrations are plain idempotent SQL
   (`CREATE/ALTER … IF NOT EXISTS`), so this becomes a small `php migrate.php` CLI
   script. This makes the deployment **100% Python-free**.

**Recommendation:** option 2 (PHP migration CLI) so Plesk hosting needs no Python at
all. Say the word and I'll add `bin/migrate.php` that runs the ported schema steps.

---

## Plesk gotchas checklist
- [ ] Document Root points at `public/` (not the project root).
- [ ] `plesk-php8x-pgsql` installed and `pgsql`/`pdo_pgsql` enabled for that PHP version.
- [ ] PostgreSQL installed via apt (not expected to appear in the Plesk DB UI).
- [ ] `.env` is above the document root and `chmod 600`.
- [ ] React build copied into `public/`.
- [ ] Let's Encrypt issued; HTTP→HTTPS redirect on.
- [ ] If "nginx only," added the `try_files` directive; otherwise `.htaccess` handles it.
