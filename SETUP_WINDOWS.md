# Setting up the PHP environment on this Windows machine

Goal: install PHP + Composer, wire up PostgreSQL access, and run TRCPMS-PHP on
**port 8090** alongside the Python app.

> Already done for you: the PHP `.env` has the matching `SECRET_KEY` and is set to
> port 8090. You only need to finish the DB step below.

---

## 1. Install PHP 8.3 (Windows)

1. Download **PHP 8.3, VS16 x64 *Thread Safe*** (zip) from
   https://windows.php.net/download/
2. Extract it to **`C:\php`** (so `C:\php\php.exe` exists).
3. In `C:\php`, copy **`php.ini-development`** → **`php.ini`**.
4. Edit `C:\php\php.ini` and:
   - Set the extension dir: `extension_dir = "ext"`
   - Uncomment (remove the leading `;` from) these lines:
     ```
     extension=pdo_pgsql
     extension=pgsql
     extension=openssl
     extension=mbstring
     extension=curl
     extension=fileinfo
     ```
5. Add `C:\php` to your **PATH** (Start → "Edit the system environment variables" →
   Environment Variables → Path → New → `C:\php`).
6. **Open a new terminal** and verify:
   ```powershell
   php -v
   php -m | findstr /I "pgsql openssl mbstring curl"
   ```
   You should see `pdo_pgsql`, `pgsql`, `openssl`, `mbstring`, `curl`.

> Optional shortcut: `winget search php` may offer a PHP package, but the manual zip
> above is the most reliable on Windows.

## 2. Install Composer

1. Download and run **Composer-Setup.exe** from https://getcomposer.org/download/
2. When prompted, point it at `C:\php\php.exe` (it usually auto-detects).
3. New terminal → verify: `composer --version`

## 3. Install the app's dependencies

```powershell
cd C:\TRCPMS-PHP
composer install
```
This creates the `vendor\` folder (Slim, JWT, dotenv, …).

## 4. Database — create the test clone (`trcpms_php`)

Your `trcpms` DB user can't create databases, so use the Postgres **superuser**.
`psql.exe` ships with PostgreSQL, usually at
`C:\Program Files\PostgreSQL\<version>\bin\psql.exe`.

**First stop the Python app** (so `trcpms` has no open connections), then:
```powershell
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -h localhost ^
  -c "CREATE DATABASE trcpms_php TEMPLATE trcpms OWNER trcpms;"
```
(Enter the `postgres` password when prompted. Adjust `16` to your PG version.)

**Alternatives:**
- Grant the privilege once, then re-run the automated clone:
  `... psql -U postgres -c "ALTER ROLE trcpms CREATEDB;"`
- Or **test against the live DB** instead of a clone: edit `C:\TRCPMS-PHP\.env` and
  change the database name in `DATABASE_URL` from `trcpms_php` back to `trcpms`.
  (Reads are safe; writes would change real data.)

## 5. Run it (port 8090)

```powershell
cd C:\TRCPMS-PHP
php -S localhost:8090 -t public public\index.php
```
Leave this terminal running.

## 6. Test / compare against the Python app

```powershell
# Health
curl http://localhost:8090/

# Login (same credentials as the Python app — same DB + bcrypt hashes)
curl -X POST http://localhost:8090/api/v1/auth/token -d "username=admin&password=YOURPASS"

# Current user (paste the access_token)
curl http://localhost:8090/api/v1/auth/me -H "Authorization: Bearer <token>"
```
Compare the same calls to the Python app on `http://localhost:8000` — the JSON
shapes should match. Because both share `SECRET_KEY`, a token from one works on the
other.

## Troubleshooting
- **`could not find driver` / pgsql missing** → the `extension=pdo_pgsql`/`pgsql`
  lines aren't enabled, or you didn't open a fresh terminal after editing `php.ini`.
  Re-check `php -m`.
- **`SECRET_KEY is not set`** → confirm `C:\TRCPMS-PHP\.env` exists (it does) and the
  process is started from `C:\TRCPMS-PHP`.
- **DB connection refused** → confirm PostgreSQL is running on `localhost:5432` and
  the password in `DATABASE_URL` is correct.
- **Composer SSL errors** → the `openssl` extension isn't enabled in `php.ini`.
</content>
